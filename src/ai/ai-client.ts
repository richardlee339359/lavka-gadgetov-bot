import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai';
import { KeyRotator } from './key-rotator.js';
import { sleep } from '../core/delay.js';

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

/** Что вернула модель + чем именно её получили (для логов и debug-режима) */
export interface AiResult {
  text: string;
  model: string;
  keyNumber: number;
}

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  КАСКАД МОДЕЛЕЙ × РОТАЦИЯ КЛЮЧЕЙ                             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Два уровня защиты от отказа, вложенные друг в друга:
 *
 *   для каждой МОДЕЛИ (от старшей к младшей):
 *       для каждого КЛЮЧА:
 *           пробуем сгенерировать ответ
 *           429 → ключ отдыхает, берём следующий
 *           503 → это не лимит, а перегрузка сервера: ждём и повторяем
 *       ключи кончились → сбрасываем отдых, спускаемся на модель попроще
 *
 * Смысл: пока у нас есть хоть один живой ключ и хоть одна модель,
 * пользователь получит ответ. Он может быть от модели попроще —
 * но он будет, а не «извините, сервис недоступен».
 *
 * Если упало вообще всё — бросаем исключение. Ловить его обязан
 * вызывающий код и показать пользователю человеческую фразу,
 * а НЕ текст ошибки.
 */
export class AiClient {
  private rotator: KeyRotator;
  private models: string[];
  private temperature: number;

  /** Сколько раз подряд терпим 503 на одной модели, прежде чем идти дальше */
  private maxServerRetries = 3;

  /**
   * Пауза перед повтором после 503, с удвоением: 2 → 4 → 8 сек.
   *
   * Раньше здесь стояло глухих 10 секунд на попытку. Для фоновой рассылки
   * это нормально, а для чата — нет: человек успевает решить, что бот умер.
   * Живой диалог требует отвечать быстро либо честно сдаваться и уходить
   * на следующую модель.
   */
  private serverRetryBaseSec = 2;

  /**
   * Модель → до какого времени её не трогаем.
   *
   * Второй уровень отдыха, кроме ключей. Если модель уже выбила 429 на всех
   * ключах, глупо ломиться в неё на каждом следующем сообщении: результат
   * будет тот же, а пользователь ждёт лишнюю секунду каждый раз.
   * Откладываем модель на минуту и начинаем каскад сразу с рабочей.
   */
  private modelCooldownUntil = new Map<string, number>();
  private modelCooldownMs: number;

  constructor(
    geminiKeys: string[],
    modelCascade: string[],
    temperature = 0.9,
    keyCooldownSec = 60,
  ) {
    if (modelCascade.length === 0) {
      throw new Error('AiClient: каскад моделей пуст');
    }

    this.rotator = new KeyRotator(geminiKeys, keyCooldownSec);
    this.models = modelCascade;
    this.temperature = temperature;
    this.modelCooldownMs = keyCooldownSec * 1000;

    console.log(`   🤖 Каскад моделей: ${modelCascade.join(' → ')}`);
    console.log(`   🌡️  Температура: ${temperature}`);
  }

  /** Доступ к ротатору — нужен демо-скриптам для статистики */
  getRotator(): KeyRotator {
    return this.rotator;
  }

  /** Короткий вариант: нужен только текст ответа */
  async generateResponse(systemPrompt: string, history: ChatMessage[]): Promise<string> {
    const result = await this.generate(systemPrompt, history);
    return result.text;
  }

  /**
   * Основной метод. Идёт по каскаду моделей сверху вниз.
   */
  async generate(systemPrompt: string, history: ChatMessage[]): Promise<AiResult> {
    const now = Date.now();

    // Модели, которые сейчас на отдыхе, пропускаем — но если отдыхают все,
    // работаем по полному списку: лучше попробовать и получить отказ,
    // чем не попробовать вовсе.
    const ready = this.models.filter(m => now >= (this.modelCooldownUntil.get(m) || 0));
    const queue = ready.length > 0 ? ready : this.models;

    if (ready.length > 0 && ready.length < this.models.length) {
      const skipped = this.models.filter(m => !ready.includes(m));
      console.log(`   ⏭  Пропускаю (лимит ещё не отпустил): ${skipped.join(', ')}`);
    }

    for (let i = 0; i < queue.length; i++) {
      const model = queue[i]!;
      const result = await this.tryModel(model, systemPrompt, history);

      if (result) return result;

      // Модель не отдала ответ ни с одним ключом.
      // Все ключи битые — спускаться по каскаду бессмысленно, ни одна модель не примет
      if (this.rotator.allDead()) break;

      // Эта модель не отдала ответ ни одним ключом — откладываем её,
      // чтобы следующее сообщение не ждало впустую того же отказа
      this.modelCooldownUntil.set(model, Date.now() + this.modelCooldownMs);

      const nextModel = queue[i + 1];
      if (nextModel) {
        // Лимит привязан к паре «проект + модель». На следующей модели
        // все наши ключи снова свежие — снимаем с них отдых.
        this.rotator.resetCooldowns();
        console.warn(`   ⬇️  Спускаюсь на следующую модель: ${nextModel}`);
      }
    }

    if (this.rotator.allDead()) {
      throw new Error(
        'Ни один ключ из .env не работает. Проверь GEMINI_KEY_* — ' +
        'ключ должен быть скопирован целиком, без пробелов и кавычек.',
      );
    }

    throw new Error(
      `Ни одна модель не ответила. Перепробовано моделей: ${this.models.length}, ` +
      `ключей: ${this.rotator.getKeyCount()}.`,
    );
  }

  /**
   * Пробует одну модель, перебирая все ключи по очереди.
   * Возвращает null, если модель не смогла ответить ни одним ключом.
   */
  private async tryModel(
    model: string,
    systemPrompt: string,
    history: ChatMessage[],
  ): Promise<AiResult | null> {
    const totalKeys = this.rotator.getKeyCount();
    let keysExhausted = 0;  // сколько ключей уже выбыло на этой модели
    let serverErrors = 0;   // сколько раз подряд прилетел 503

    while (keysExhausted < totalKeys) {
      // Живых ключей не осталось вообще — ждать нечего, надо чинить .env
      if (this.rotator.allDead()) return null;

      try {
        // Все ключи отдыхают — придётся подождать.
        // Это нормальная ситуация: значит трафика больше, чем бесплатных квот.
        const waitMs = this.rotator.getWaitTime();
        if (waitMs > 0) {
          console.log(`   ⏳ [${model}] Все ключи отдыхают, жду ${Math.ceil(waitMs / 1000)} сек...`);
          await sleep(waitMs / 1000);
        }

        const keyNumber = this.rotator.getCurrentKeyNumber();
        const ai = new GoogleGenAI({ apiKey: this.rotator.getCurrentKey() });

        const contents = history.map(msg => ({
          role: msg.role === 'user' ? ('user' as const) : ('model' as const),
          parts: [{ text: msg.text }],
        }));

        const response = await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: systemPrompt,
            temperature: this.temperature,
            // Магазинный бот — не место для лишней цензуры,
            // но и не место для вседозволенности. Блокируем только явное.
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
            ],
          },
        });

        const text = response.text?.trim();

        if (text) {
          this.rotator.markUsed();
          console.log(`   ✨ Ответ получен: ${model}, ключ #${keyNumber}`);
          return { text, model, keyNumber };
        }

        // Пустой ответ — обычно сработал фильтр безопасности.
        // Другой ключ тут не поможет, но и ронять всё из-за этого не стоит:
        // пробуем следующий, а если и там пусто — уйдём на другую модель.
        console.warn(`   ⚠️  [${model}] Пустой ответ (вероятно, сработал фильтр). Пробую следующий ключ.`);
        this.rotator.markRateLimited();
        keysExhausted++;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        // ── 429: лимит исчерпан ────────────────────────────────
        if (message.includes('429') || message.includes('RESOURCE_EXHAUSTED')) {
          this.rotator.markRateLimited();
          keysExhausted++;
          continue;
        }

        // ── 503: сервер Google перегружен ──────────────────────
        // Это НЕ про наш лимит. Менять ключ бессмысленно — надо просто подождать.
        if (message.includes('503') || message.includes('UNAVAILABLE') || message.includes('overloaded')) {
          serverErrors++;

          if (serverErrors < this.maxServerRetries) {
            // Удваиваем паузу с каждой попыткой: 2 → 4 сек.
            // Если Google не оклемался за это время, ждать дальше смысла нет —
            // быстрее получить ответ от следующей модели.
            const waitSec = this.serverRetryBaseSec * 2 ** (serverErrors - 1);
            console.warn(`   🔁 [${model}] Сервер перегружен (503), жду ${waitSec} сек и повторяю (${serverErrors}/${this.maxServerRetries})`);
            await sleep(waitSec);
            continue;
          }

          console.warn(`   ⚠️  [${model}] Google не отвечает ${this.maxServerRetries} раза подряд — меняю модель`);
          return null;
        }

        // ── Неверное имя модели ────────────────────────────────
        // Список моделей у Google меняется, опечатка в MODEL_CASCADE —
        // штука частая. Перебирать ключи тут бессмысленно: не примет ни один.
        if (message.includes('404') || message.includes('NOT_FOUND') || message.includes('is not found for API version')) {
          console.error(
            `   ❌ Модели «${model}» не существует или она недоступна твоему ключу.\n` +
            '      Проверь MODEL_CASCADE в .env — актуальные имена смотри в https://aistudio.google.com',
          );
          return null;
        }

        // ── Битый ключ ─────────────────────────────────────────
        // Самая частая ошибка при настройке: скопировали не целиком,
        // ключ уже удалён, или в проекте не включён нужный API.
        // Ждать бессмысленно — убираем ключ из ротации совсем.
        if (
          message.includes('API key not valid') ||
          message.includes('API_KEY_INVALID') ||
          message.includes('PERMISSION_DENIED') ||
          message.includes('403')
        ) {
          this.rotator.markDead('Google не принял этот ключ. Проверь его в .env: скопирован целиком, без пробелов и кавычек');
          keysExhausted++;
          continue;
        }

        // ── Всё остальное ──────────────────────────────────────
        console.error(`   ❌ [${model}] Ошибка: ${message.slice(0, 160)}`);
        this.rotator.markRateLimited();
        keysExhausted++;
      }
    }

    // Если все ключи оказались битыми, про это уже сказано подробнее — не дублируем
    if (!this.rotator.allDead()) {
      console.warn(`   ⚠️  [${model}] Ключи исчерпаны (${totalKeys} шт.)`);
    }
    return null;
  }
}
