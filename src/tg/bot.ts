import { TelegramApi, type TgUpdate, type TgCallbackQuery } from './api.js';
import * as kb from './keyboards.js';
import type { AppConfig } from '../config.js';
import type { AiClient } from '../ai/ai-client.js';
import type { PromptAssembler } from '../ai/prompt-assembler.js';
import type { ConversationStore } from '../storage/conversation-store.js';
import { getPersona, isPersonaId, type PersonaId } from '../ai/personas.js';
import { ensureUser, getPersonaId, setPersona, countUsers } from '../storage/users.js';
import { categoryLabel, type Db, type Product } from '../shop/db.js';
import {
  getProduct, getByCategory, getHits, getCategoryCounts,
  paginate, renderProductCard, getAll, escapeHtml, formatPrice,
} from '../shop/catalog.js';
import {
  getCart, addToCart, removeFromCart, clearCart, cartCount,
  renderCart, createOrder, getOrder, getOrderItems, markPaid, cancelOrder,
} from '../shop/cart.js';
import { makePaymentQr } from '../shop/qr.js';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  БОТ МАГАЗИНА                                                ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Здесь сходится всё: кнопки, каталог, корзина, оплата и живой продавец
 * с характером.
 *
 * Логика разделена ровно надвое:
 *   — нажатия кнопок     → строгий детерминированный код, никакого ИИ;
 *   — свободный текст    → продавец с личностью, ротация ключей и моделей.
 *
 * Это важное архитектурное решение. Деньги, остатки и корзину нельзя
 * доверять языковой модели: она может ошибиться в арифметике или
 * придумать товар. Поэтому всё, что считается, считает код,
 * а модель только разговаривает.
 */
export class ShopBot {
  private offset = 0;
  private running = false;

  /**
   * Очередь обработки на каждого пользователя.
   *
   * Человек написал вопрос, бот думает три секунды — человек написал ещё раз.
   * Без очереди оба сообщения обрабатываются одновременно: приходят два ответа,
   * а история диалога перемешивается, потому что реплики пишутся в базу
   * в порядке готовности, а не в порядке отправки.
   *
   * Держим на каждого пользователя цепочку промисов: следующее сообщение
   * начинает обрабатываться только после того, как закончилось предыдущее.
   * Разные пользователи при этом друг друга не ждут.
   */
  private queues = new Map<string, Promise<void>>();

  constructor(
    private api: TelegramApi,
    private db: Db,
    private ai: AiClient,
    private assembler: PromptAssembler,
    private conversations: ConversationStore,
    private config: AppConfig,
  ) {}

  async start(): Promise<void> {
    const me = await this.api.getMe();
    if (!me) {
      throw new Error(
        'Telegram не принял токен.\n' +
        '   Проверь TG_BOT_TOKEN в .env — он должен быть скопирован целиком, вместе с цифрами до двоеточия.',
      );
    }

    await this.api.setMyCommands([
      { command: 'start', description: 'Начать заново' },
      { command: 'menu', description: 'Главное меню' },
      { command: 'cart', description: 'Корзина' },
      { command: 'who', description: 'Сменить продавца' },
      { command: 'reset', description: 'Забыть наш разговор' },
    ]);

    console.log(`\n   🤖 Бот запущен: @${me.username}`);
    console.log('   Открой его в Telegram и напиши /start\n');

    this.running = true;
    void this.poll();
  }

  stop(): void {
    this.running = false;
  }

  /** Цикл long polling: спрашиваем Telegram о новых событиях и разбираем их */
  private async poll(): Promise<void> {
    while (this.running) {
      const updates = await this.api.getUpdates(this.offset);

      for (const update of updates) {
        this.offset = update.update_id + 1;

        try {
          await this.handleUpdate(update);
        } catch (error) {
          // Одно упавшее сообщение не должно ронять весь бот
          console.error('   ❌ Ошибка обработки:', error instanceof Error ? error.message : error);
        }
      }
    }
  }

  private async handleUpdate(update: TgUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }

    const message = update.message;
    if (!message?.text || !message.from) return;

    const chatId = message.chat.id;
    const tgId = String(message.from.id);
    const username = message.from.username || message.from.first_name || '';

    ensureUser(this.db, tgId, username, this.config.defaultPersona);

    const text = message.text.trim();

    if (text.startsWith('/')) {
      await this.handleCommand(chatId, tgId, text);
      return;
    }

    this.enqueue(tgId, () => this.handleFreeText(chatId, tgId, text));
  }

  /** Ставит работу в очередь этого пользователя — строго после предыдущей */
  private enqueue(tgId: string, work: () => Promise<void>): void {
    const previous = this.queues.get(tgId) ?? Promise.resolve();

    const next = previous
      .then(work)
      .catch(error => {
        console.error('   ❌ Ошибка в очереди:', error instanceof Error ? error.message : error);
      })
      .finally(() => {
        // Если за это время никто не встал следом — убираем запись,
        // чтобы Map не росла с каждым новым пользователем
        if (this.queues.get(tgId) === next) this.queues.delete(tgId);
      });

    this.queues.set(tgId, next);
  }

  // ════════════════════════════════════════════════════════════
  //  КОМАНДЫ
  // ════════════════════════════════════════════════════════════

  private async handleCommand(chatId: number, tgId: string, text: string): Promise<void> {
    const command = text.split(/[\s@]/)[0]?.toLowerCase();

    switch (command) {
      case '/start': {
        const persona = getPersona(getPersonaId(this.db, tgId, this.config.defaultPersona));
        this.conversations.clear(tgId);
        await this.api.sendMessage(
          chatId,
          `${persona.greeting}\n\n<i>Можно жать кнопки, а можно просто написать словами — отвечу.</i>`,
          kb.mainMenu(cartCount(this.db, tgId), persona.id),
        );
        return;
      }

      case '/menu':
        await this.sendMenu(chatId, tgId);
        return;

      case '/cart':
        await this.sendCart(chatId, tgId);
        return;

      case '/who': {
        const current = getPersonaId(this.db, tgId, this.config.defaultPersona);
        await this.api.sendMessage(chatId, this.personaScreenText(), kb.personaKeyboard(current));
        return;
      }

      case '/reset':
        this.conversations.clear(tgId);
        await this.api.sendMessage(chatId, '🧹 Всё, разговор забыт. Начинаем с чистого листа.', kb.backToMenu());
        return;

      case '/stats':
        await this.sendStats(chatId, tgId);
        return;

      default:
        await this.api.sendMessage(chatId, 'Такой команды не знаю. Жми /menu.', kb.backToMenu());
    }
  }

  // ════════════════════════════════════════════════════════════
  //  КНОПКИ
  // ════════════════════════════════════════════════════════════

  private async handleCallback(cb: TgCallbackQuery): Promise<void> {
    const data = cb.data || '';
    const chatId = cb.message?.chat.id;
    const messageId = cb.message?.message_id;
    const tgId = String(cb.from.id);

    if (!chatId || !messageId) {
      await this.api.answerCallback(cb.id);
      return;
    }

    ensureUser(this.db, tgId, cb.from.username || '', this.config.defaultPersona);

    // Кнопка-индикатор: нажали — просто гасим часики
    if (data === 'noop') {
      await this.api.answerCallback(cb.id);
      return;
    }

    const [action, ...args] = data.split(':');
    const personaId = getPersonaId(this.db, tgId, this.config.defaultPersona);
    const persona = getPersona(personaId);

    switch (action) {
      // ── Главное меню ──────────────────────────────────────
      case 'menu': {
        await this.api.answerCallback(cb.id);
        await this.api.editMessageText(
          chatId, messageId,
          this.menuText(tgId),
          kb.mainMenu(cartCount(this.db, tgId), personaId),
        );
        return;
      }

      // ── Категории ─────────────────────────────────────────
      case 'cat': {
        await this.api.answerCallback(cb.id);

        const category = args[0];
        if (!category) {
          await this.api.editMessageText(
            chatId, messageId,
            '🛍 <b>Каталог</b>\n\nВыбирай раздел:',
            kb.categoriesKeyboard(getCategoryCounts(this.db)),
          );
          return;
        }

        const page = Number(args[1] || 0);
        const all = getByCategory(this.db, category);
        const { items, page: safePage, totalPages } = paginate(all, page);

        await this.api.editMessageText(
          chatId, messageId,
          `${categoryLabel(category)}\n\nВсего товаров: ${all.length}`,
          kb.productListKeyboard(items, category, safePage, totalPages),
        );
        return;
      }

      // ── Хиты ──────────────────────────────────────────────
      case 'hits': {
        await this.api.answerCallback(cb.id);
        const hits = getHits(this.db);
        const { items, page, totalPages } = paginate(hits, 0);

        await this.api.editMessageText(
          chatId, messageId,
          '🔥 <b>Хиты продаж</b>\n\nЭто берут чаще всего:',
          kb.productListKeyboard(items, 'hits', page, totalPages),
        );
        return;
      }

      // ── Карточка товара ───────────────────────────────────
      case 'p': {
        await this.api.answerCallback(cb.id);

        const product = getProduct(this.db, Number(args[0]));
        if (!product) {
          await this.api.editMessageText(chatId, messageId, 'Такого товара уже нет.', kb.backToMenu());
          return;
        }

        const qty = Math.max(1, Number(args[1] || 1));
        const backTo = product.is_hit ? 'hits' : `cat:${product.category}:0`;

        await this.api.editMessageText(
          chatId, messageId,
          renderProductCard(product),
          kb.productCardKeyboard(product, qty, backTo),
        );
        return;
      }

      // ── В корзину ─────────────────────────────────────────
      case 'add': {
        const productId = Number(args[0]);
        const qty = Math.max(1, Number(args[1] || 1));
        const result = addToCart(this.db, tgId, productId, qty);

        if (!result.ok) {
          await this.api.answerCallback(cb.id, `⛔️ ${result.reason}`, true);
          return;
        }

        const product = getProduct(this.db, productId);
        await this.api.answerCallback(cb.id, `✅ ${product?.name} — в корзине`);

        await this.api.editMessageText(
          chatId, messageId,
          renderCart(getCart(this.db, tgId), persona),
          kb.cartKeyboard(getCart(this.db, tgId)),
        );
        return;
      }

      // ── Корзина ───────────────────────────────────────────
      case 'cart': {
        await this.api.answerCallback(cb.id);
        await this.api.editMessageText(
          chatId, messageId,
          renderCart(getCart(this.db, tgId), persona),
          kb.cartKeyboard(getCart(this.db, tgId)),
        );
        return;
      }

      case 'del': {
        removeFromCart(this.db, tgId, Number(args[0]));
        await this.api.answerCallback(cb.id, 'Убрала');
        await this.api.editMessageText(
          chatId, messageId,
          renderCart(getCart(this.db, tgId), persona),
          kb.cartKeyboard(getCart(this.db, tgId)),
        );
        return;
      }

      case 'clear': {
        clearCart(this.db, tgId);
        await this.api.answerCallback(cb.id, 'Корзина пуста');
        await this.api.editMessageText(
          chatId, messageId,
          renderCart([], persona),
          kb.cartKeyboard([]),
        );
        return;
      }

      // ── Оформление и оплата ───────────────────────────────
      case 'checkout': {
        await this.api.answerCallback(cb.id);
        await this.sendPayment(chatId, tgId, messageId);
        return;
      }

      case 'paid': {
        await this.api.answerCallback(cb.id, '✅ Спасибо!');
        await this.confirmPayment(chatId, tgId, Number(args[0]));
        return;
      }

      case 'cancel': {
        cancelOrder(this.db, Number(args[0]));
        await this.api.answerCallback(cb.id, 'Заказ отменён');
        await this.api.sendMessage(chatId, 'Заказ отменён. Ничего страшного, приходи ещё.', kb.backToMenu());
        return;
      }

      // ── Смена продавца ────────────────────────────────────
      case 'who': {
        await this.api.answerCallback(cb.id);
        await this.api.editMessageText(chatId, messageId, this.personaScreenText(), kb.personaKeyboard(personaId));
        return;
      }

      case 'set': {
        const next = args[0];
        if (!next || !isPersonaId(next)) {
          await this.api.answerCallback(cb.id);
          return;
        }

        setPersona(this.db, tgId, next);

        // Передаём смену: вопросы покупателя новый продавец видит,
        // реплики предыдущего — нет. Подробности в ConversationStore.handover().
        this.conversations.handover(tgId);

        const nextPersona = getPersona(next);
        await this.api.answerCallback(cb.id, `${nextPersona.emoji} ${nextPersona.name} на связи`);
        await this.api.editMessageText(
          chatId, messageId,
          nextPersona.greeting,
          kb.mainMenu(cartCount(this.db, tgId), next),
        );
        return;
      }

      // ── О магазине ────────────────────────────────────────
      case 'about': {
        await this.api.answerCallback(cb.id);
        await this.api.editMessageText(chatId, messageId, this.aboutText(), kb.backToMenu());
        return;
      }

      default:
        await this.api.answerCallback(cb.id);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  СВОБОДНЫЙ ТЕКСТ → ЖИВОЙ ПРОДАВЕЦ
  // ════════════════════════════════════════════════════════════

  private async handleFreeText(chatId: number, tgId: string, text: string): Promise<void> {
    const personaId = getPersonaId(this.db, tgId, this.config.defaultPersona);
    const persona = getPersona(personaId);

    await this.api.sendTyping(chatId);

    this.conversations.addUserMessage(tgId, text);

    // Промпт собирается заново на каждый запрос: значит каталог,
    // цены и остатки всегда актуальные, без всякой синхронизации.
    const systemPrompt = this.assembler.build(personaId);
    const history = this.conversations.getHistory(tgId);

    let answer: string;

    try {
      const result = await this.ai.generate(systemPrompt, history);
      answer = result.text;
    } catch (error) {
      // Сюда попадаем, только если легли ВСЕ ключи и ВСЕ модели.
      // Пользователю про это знать незачем — отвечаем в характере продавца.
      console.error('   ❌ Ответ не получен:', error instanceof Error ? error.message : error);
      await this.api.sendMessage(chatId, escapeHtml(persona.aiFallback), kb.backToMenu());
      return;
    }

    this.conversations.addBotMessage(tgId, answer);

    // Если продавец назвал товар — сразу подставляем кнопку на его карточку
    const mentioned = this.findMentionedProducts(answer);

    await this.api.sendMessage(chatId, escapeHtml(answer), kb.afterAnswerKeyboard(mentioned));
  }

  /**
   * Ищем в ответе названия товаров из каталога.
   *
   * Модель редко пишет название дословно («Soundcore P40i» вместо
   * «TWS Soundcore P40i»), поэтому сверяем не только полное имя,
   * но и характерные слова из него.
   */
  private findMentionedProducts(answer: string): Product[] {
    const lower = answer.toLowerCase();
    const found: Product[] = [];

    for (const product of getAll(this.db)) {
      if (found.length >= 3) break;

      const name = product.name.toLowerCase();
      if (lower.includes(name)) {
        found.push(product);
        continue;
      }

      // Характерные слова: длинные, их сложно встретить случайно
      const words = name.split(/[\s,]+/).filter(w => w.length >= 5);
      if (words.some(word => lower.includes(word))) {
        found.push(product);
      }
    }

    return found;
  }

  // ════════════════════════════════════════════════════════════
  //  ЭКРАНЫ
  // ════════════════════════════════════════════════════════════

  private async sendMenu(chatId: number, tgId: string): Promise<void> {
    const personaId = getPersonaId(this.db, tgId, this.config.defaultPersona);
    await this.api.sendMessage(chatId, this.menuText(tgId), kb.mainMenu(cartCount(this.db, tgId), personaId));
  }

  private async sendCart(chatId: number, tgId: string): Promise<void> {
    const persona = getPersona(getPersonaId(this.db, tgId, this.config.defaultPersona));
    const rows = getCart(this.db, tgId);
    await this.api.sendMessage(chatId, renderCart(rows, persona), kb.cartKeyboard(rows));
  }

  /**
   * Оформление заказа: создаём заказ, рисуем QR и отправляем картинкой.
   */
  private async sendPayment(chatId: number, tgId: string, menuMessageId: number): Promise<void> {
    const personaId = getPersonaId(this.db, tgId, this.config.defaultPersona);
    const persona = getPersona(personaId);

    const order = createOrder(this.db, tgId, persona);
    if (!order) {
      await this.api.editMessageText(chatId, menuMessageId, renderCart([], persona), kb.cartKeyboard([]));
      return;
    }

    const items = getOrderItems(this.db, order.id);
    const lines = items.map(i => `  ${escapeHtml(i.name)} × ${i.qty}`).join('\n');

    const caption =
      `🧾 <b>Заказ №${order.id}</b>\n\n` +
      `${lines}\n\n` +
      (order.discount_percent > 0 ? `Скидка ${order.discount_percent}% уже учтена.\n` : '') +
      `💰 <b>К оплате: ${formatPrice(order.total)}</b>\n\n` +
      escapeHtml(persona.qrCaption);

    const qr = await makePaymentQr(order.payload);
    await this.api.sendPhoto(chatId, qr, caption, kb.paymentKeyboard(order.id));

    // Меню с корзиной больше не актуально — обновляем его на пустую корзину
    await this.api.editMessageText(chatId, menuMessageId, renderCart([], persona), kb.cartKeyboard([]));
  }

  /**
   * Подтверждение оплаты.
   * В настоящем магазине сюда прилетал бы вебхук от банка,
   * а не нажатие кнопки самим покупателем.
   */
  private async confirmPayment(chatId: number, tgId: string, orderId: number): Promise<void> {
    const order = getOrder(this.db, orderId);
    if (!order || order.status !== 'pending') {
      await this.api.sendMessage(chatId, 'Этот заказ уже закрыт.', kb.backToMenu());
      return;
    }

    markPaid(this.db, orderId);

    const personaId = getPersonaId(this.db, tgId, this.config.defaultPersona);
    const persona = getPersona(personaId);
    const items = getOrderItems(this.db, orderId);

    await this.api.sendTyping(chatId);

    // Благодарность генерит модель — чтобы она звучала голосом продавца,
    // а не одинаковым шаблоном для всех троих.
    const task =
      `Покупатель только что оплатил заказ №${orderId} на ${order.total} руб: ` +
      `${items.map(i => `${i.name} ×${i.qty}`).join(', ')}. ` +
      'Поблагодари его одной-двумя фразами в своём стиле и скажи, что заказ передан на сборку. ' +
      'Без списков и без markdown.';

    let text: string;
    try {
      text = await this.ai.generateResponse(this.assembler.build(personaId), [{ role: 'user', text: task }]);
    } catch {
      text = 'Оплата прошла, заказ передан на сборку. Спасибо!';
    }

    await this.api.sendMessage(
      chatId,
      `✅ <b>Оплачено. Заказ №${orderId}</b>\n\n${escapeHtml(text)}`,
      kb.backToMenu(),
    );
  }

  private async sendStats(chatId: number, tgId: string): Promise<void> {
    if (!this.config.adminTgId || tgId !== this.config.adminTgId) {
      await this.api.sendMessage(chatId, 'Эта команда не для покупателей.');
      return;
    }

    const orders = this.db
      .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS sum FROM orders WHERE status = 'paid'")
      .get() as { n: number; sum: number };

    const keyStats = this.ai.getRotator().getStats();
    const keyLines = Object.entries(keyStats).map(([name, count]) => `  ${name}: ${count}`).join('\n');

    await this.api.sendMessage(
      chatId,
      `📊 <b>Статистика</b>\n\n` +
      `Пользователей: ${countUsers(this.db)}\n` +
      `Оплаченных заказов: ${orders.n}\n` +
      `Выручка: ${formatPrice(orders.sum)}\n\n` +
      `<b>Запросов на ключ:</b>\n${keyLines}\n\n` +
      `Свободных ключей сейчас: ${this.ai.getRotator().getAvailableCount()} из ${this.ai.getRotator().getKeyCount()}`,
      kb.backToMenu(),
    );
  }

  // ── Тексты экранов ──────────────────────────────────────────

  private menuText(tgId: string): string {
    const persona = getPersona(getPersonaId(this.db, tgId, this.config.defaultPersona));
    const items = cartCount(this.db, tgId);

    return (
      '🏪 <b>Лавка Гаджетов</b>\n\n' +
      `Сейчас в зале: ${persona.emoji} <b>${persona.name}</b> — ${persona.title}\n` +
      (items > 0 ? `В корзине: ${items} шт.\n` : '') +
      '\n<i>Жми кнопки или просто напиши, что ищешь.</i>'
    );
  }

  private personaScreenText(): string {
    return (
      '👥 <b>Кто вас обслужит</b>\n\n' +
      '💃 <b>Кира</b> — молодая, лёгкая, продаст что угодно\n' +
      '👵 <b>Ольга Ивановна</b> — опыт тридцать лет, скидок не даёт\n' +
      '🤝 <b>Степан</b> — свой человек, минус 10% по-братски\n\n' +
      '<i>Товары и цены одни и те же. Меняется только тот, кто с вами говорит — ' +
      'и то, дадут ли вам скидку.</i>'
    );
  }

  private aboutText(): string {
    return (
      'ℹ️ <b>О магазине</b>\n\n' +
      'Это демо-бот: каталог, корзина и оплата настоящие по логике, ' +
      'но товары и QR-код — учебные.\n\n' +
      'Продавец в чате — языковая модель Google Gemini. Она видит весь каталог ' +
      'с ценами и остатками, поэтому не выдумывает то, чего нет на складе.\n\n' +
      'Деньги и остатки считает код, а не модель. Это принципиально: ' +
      'разговаривать модель умеет отлично, а вот арифметику лучше ей не доверять.'
    );
  }
}
