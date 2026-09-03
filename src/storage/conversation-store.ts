import type { Db } from '../shop/db.js';
import type { ChatMessage } from '../ai/ai-client.js';

/**
 * История переписки.
 *
 * Модель сама по себе ничего не помнит: каждый запрос для неё — первый.
 * Ощущение памяти создаём мы, подкладывая ей последние N сообщений диалога.
 *
 * N держим небольшим (по умолчанию 12) по двум причинам:
 *   — длинная история = больше токенов = быстрее упираемся в лимиты;
 *   — на длинном контексте модель начинает цепляться за старые реплики
 *     сильнее, чем за текущий вопрос.
 */
export class ConversationStore {
  constructor(
    private db: Db,
    private limit: number,
  ) {}

  /** Последние сообщения в хронологическом порядке — как раз то, что ждёт модель */
  getHistory(tgId: string): ChatMessage[] {
    const rows = this.db
      .prepare('SELECT role, text FROM messages WHERE tg_id = ? ORDER BY id DESC LIMIT ?')
      .all(tgId, this.limit) as Array<{ role: string; text: string }>;

    return rows
      .reverse()
      .map(r => ({ role: r.role === 'model' ? ('model' as const) : ('user' as const), text: r.text }));
  }

  addUserMessage(tgId: string, text: string): void {
    this.add(tgId, 'user', text);
  }

  addBotMessage(tgId: string, text: string): void {
    this.add(tgId, 'model', text);
  }

  private add(tgId: string, role: 'user' | 'model', text: string): void {
    this.db
      .prepare('INSERT INTO messages (tg_id, role, text, created_at) VALUES (?, ?, ?, ?)')
      .run(tgId, role, text, Date.now());

    // Чистим хвост: держим в базе вдвое больше лимита, остальное не нужно
    this.db
      .prepare(`
        DELETE FROM messages
        WHERE tg_id = ?
          AND id NOT IN (SELECT id FROM messages WHERE tg_id = ? ORDER BY id DESC LIMIT ?)
      `)
      .run(tgId, tgId, this.limit * 2);
  }

  /** Полный сброс истории — команда /reset и /start */
  clear(tgId: string): void {
    this.db.prepare('DELETE FROM messages WHERE tg_id = ?').run(tgId);
  }

  /**
   * Передача смены: убираем реплики продавца, оставляем вопросы покупателя.
   *
   * Вызывается при смене персонажа, и это тонкий момент.
   *
   * Стереть всё — плохо: человек только что рассказал, что ищет наушники
   * для метро, и после переключения должен объяснять всё заново.
   *
   * Оставить всё — тоже плохо: чужие реплики лежат в истории с ролью «model»,
   * то есть новый продавец считает их СВОИМИ словами. Ольга Ивановна увидит
   * «здарова, братан» за своей подписью и продолжит в том же духе.
   *
   * Правильно — оставить только то, что говорил покупатель. Контекст задачи
   * сохраняется, чужой голос не протекает. Ровно как в жизни: сменщик
   * помнит, зачем человек пришёл, но говорит своими словами.
   */
  handover(tgId: string): void {
    this.db.prepare("DELETE FROM messages WHERE tg_id = ? AND role = 'model'").run(tgId);
  }
}
