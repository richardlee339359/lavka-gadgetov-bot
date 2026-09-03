import type { Db } from '../shop/db.js';
import { isPersonaId, type PersonaId } from '../ai/personas.js';

export interface User {
  tg_id: string;
  username: string;
  persona: PersonaId;
  created_at: number;
}

/**
 * Пользователи бота. Хранится минимум: кто и с каким продавцом общается.
 * Никаких персональных данных — они нам просто не нужны.
 */
export function ensureUser(db: Db, tgId: string, username: string, defaultPersona: PersonaId): User {
  const existing = db.prepare('SELECT * FROM users WHERE tg_id = ?').get(tgId) as User | undefined;

  if (existing) {
    // Username мог измениться — подтянем
    if (username && username !== existing.username) {
      db.prepare('UPDATE users SET username = ? WHERE tg_id = ?').run(username, tgId);
      existing.username = username;
    }
    // На случай, если в базе оказалась личность, которой больше нет в коде
    if (!isPersonaId(existing.persona)) {
      setPersona(db, tgId, defaultPersona);
      existing.persona = defaultPersona;
    }
    return existing;
  }

  db.prepare('INSERT INTO users (tg_id, username, persona, created_at) VALUES (?, ?, ?, ?)')
    .run(tgId, username, defaultPersona, Date.now());

  return { tg_id: tgId, username, persona: defaultPersona, created_at: Date.now() };
}

export function getPersonaId(db: Db, tgId: string, fallback: PersonaId): PersonaId {
  const row = db.prepare('SELECT persona FROM users WHERE tg_id = ?').get(tgId) as { persona: string } | undefined;
  if (row && isPersonaId(row.persona)) return row.persona;
  return fallback;
}

export function setPersona(db: Db, tgId: string, persona: PersonaId): void {
  db.prepare('UPDATE users SET persona = ? WHERE tg_id = ?').run(persona, tgId);
}

export function countUsers(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n;
}
