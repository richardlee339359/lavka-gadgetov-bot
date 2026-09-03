/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TELEGRAM BOT API — без библиотек                            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Специально пишем на голом fetch, а не на готовой обёртке.
 * Причин две:
 *   1. Видно, что Telegram Bot API — это обычные HTTP-запросы и JSON.
 *      Никакой магии там нет, и когда что-то ломается, понятно где искать.
 *   2. Ноль зависимостей: нечему устаревать и нечему конфликтовать.
 *
 * Работаем через long polling: сами спрашиваем у Telegram «что нового»,
 * держа соединение открытым до 30 секунд. Для вебхуков нужен домен
 * и сертификат — на этапе разработки это лишняя морока.
 */

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type Keyboard = InlineButton[][];

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
  is_bot?: boolean;
}

export interface TgMessage {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: TgUser;
}

export interface TgCallbackQuery {
  id: string;
  data?: string;
  from: TgUser;
  message?: { message_id: number; chat: { id: number } };
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export class TelegramApi {
  private base: string;

  constructor(token: string) {
    this.base = `https://api.telegram.org/bot${token}`;
  }

  /** Проверка токена на старте: заодно узнаём @username бота */
  async getMe(): Promise<TgUser | null> {
    const data = await this.call<TgUser>('getMe', {});
    return data;
  }

  /**
   * Забрать новые события.
   * offset = id последнего обработанного + 1: так Telegram понимает,
   * что предыдущие можно удалить и не присылать снова.
   */
  async getUpdates(offset: number): Promise<TgUpdate[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);

    try {
      const params = new URLSearchParams({
        offset: String(offset),
        timeout: '30',
        allowed_updates: JSON.stringify(['message', 'callback_query']),
      });

      const res = await fetch(`${this.base}/getUpdates?${params}`, { signal: controller.signal });
      if (!res.ok) return [];

      const data = (await res.json()) as { ok: boolean; result: TgUpdate[] };
      return data.ok ? data.result : [];
    } catch {
      // Обрыв соединения при long polling — обычное дело, просто пробуем снова
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(chatId: number | string, text: string, keyboard?: Keyboard): Promise<number | null> {
    const message = await this.call<TgMessage>('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });

    return message?.message_id ?? null;
  }

  /**
   * Перерисовать существующее сообщение.
   *
   * Именно на этом держится ощущение «приложения внутри чата»:
   * пользователь жмёт кнопки, а сообщение одно и то же — меню
   * меняется на месте, история не засоряется десятком карточек.
   */
  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    keyboard?: Keyboard,
  ): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    });
  }

  /** Ответ на нажатие кнопки. Обязателен: без него у пользователя крутится часик. */
  async answerCallback(queryId: string, text?: string, showAlert = false): Promise<void> {
    await this.call('answerCallbackQuery', {
      callback_query_id: queryId,
      ...(text ? { text, show_alert: showAlert } : {}),
    });
  }

  /** «Бот печатает…» — пока модель думает, пользователь видит жизнь */
  async sendTyping(chatId: number | string): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  /** Отправка картинки из памяти (у нас это QR-код) — multipart, а не JSON */
  async sendPhoto(
    chatId: number | string,
    photo: Buffer,
    caption: string,
    keyboard?: Keyboard,
  ): Promise<number | null> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption);
    form.append('parse_mode', 'HTML');
    if (keyboard) {
      form.append('reply_markup', JSON.stringify({ inline_keyboard: keyboard }));
    }
    form.append('photo', new Blob([new Uint8Array(photo)], { type: 'image/png' }), 'payment.png');

    try {
      const res = await fetch(`${this.base}/sendPhoto`, { method: 'POST', body: form });
      const data = (await res.json()) as { ok: boolean; result?: TgMessage; description?: string };

      if (!data.ok) {
        console.error(`   ❌ sendPhoto: ${data.description}`);
        return null;
      }
      return data.result?.message_id ?? null;
    } catch (error) {
      console.error('   ❌ sendPhoto:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  async deleteMessage(chatId: number | string, messageId: number): Promise<void> {
    await this.call('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  /** Список команд в синем меню слева от поля ввода */
  async setMyCommands(commands: Array<{ command: string; description: string }>): Promise<void> {
    await this.call('setMyCommands', { commands });
  }

  /** Общий вызов метода API. Всё, что выше, — тонкие обёртки над ним. */
  private async call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await fetch(`${this.base}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as { ok: boolean; result?: T; description?: string };

      if (!data.ok) {
        // «message is not modified» — не ошибка: пользователь нажал ту же кнопку,
        // и перерисовывать реально нечего. Молчим.
        if (!data.description?.includes('message is not modified')) {
          console.error(`   ❌ ${method}: ${data.description}`);
        }
        return null;
      }

      return data.result ?? null;
    } catch (error) {
      console.error(`   ❌ ${method}:`, error instanceof Error ? error.message : error);
      return null;
    }
  }
}
