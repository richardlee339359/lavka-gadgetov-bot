import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Виртуальная база магазина.
 *
 * SQLite выбран сознательно: это один файл на диске, никаких серверов,
 * никакой установки. Зритель запускает `npm run seed` — и у него готовый
 * магазин с товарами. Всё, что здесь есть, один в один переносится
 * на PostgreSQL, когда магазин станет настоящим.
 */

export interface Product {
  id: number;
  category: string;
  name: string;
  emoji: string;
  description: string;
  /** Цена в рублях, целым числом — с копейками в деньгах лучше не играть */
  price: number;
  /** Старая цена для зачёркивания. 0 — скидки нет */
  old_price: number;
  stock: number;
  is_hit: number;
  tags: string;
}

export interface CartRow {
  product_id: number;
  qty: number;
  name: string;
  emoji: string;
  price: number;
  stock: number;
}

export interface Order {
  id: number;
  tg_id: string;
  total: number;
  discount_percent: number;
  persona: string;
  status: 'pending' | 'paid' | 'cancelled';
  payload: string;
  created_at: number;
}

/** Категории магазина: id → как показываем в меню */
export const CATEGORIES: Array<{ id: string; label: string; emoji: string }> = [
  { id: 'headphones', label: 'Наушники', emoji: '🎧' },
  { id: 'gadgets', label: 'Гаджеты', emoji: '📱' },
  { id: 'accessories', label: 'Аксессуары', emoji: '🔌' },
  { id: 'smarthome', label: 'Умный дом', emoji: '💡' },
];

export function categoryLabel(id: string): string {
  const found = CATEGORIES.find(c => c.id === id);
  return found ? `${found.emoji} ${found.label}` : id;
}

export function openDb(path: string): Db {
  const db = new Database(path);

  // WAL — чтобы чтение не блокировалось записью.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

export function initSchema(db: Db): void {
  db.exec(`
    -- ── Товары ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY,
      category    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      emoji       TEXT    NOT NULL DEFAULT '📦',
      description TEXT    NOT NULL DEFAULT '',
      price       INTEGER NOT NULL,
      old_price   INTEGER NOT NULL DEFAULT 0,
      stock       INTEGER NOT NULL DEFAULT 0,
      is_hit      INTEGER NOT NULL DEFAULT 0,
      tags        TEXT    NOT NULL DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

    -- ── Пользователи: у каждого свой выбранный продавец ────
    CREATE TABLE IF NOT EXISTS users (
      tg_id      TEXT PRIMARY KEY,
      username   TEXT NOT NULL DEFAULT '',
      persona    TEXT NOT NULL DEFAULT 'kira',
      created_at INTEGER NOT NULL
    );

    -- ── Корзина ───────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS carts (
      tg_id      TEXT    NOT NULL,
      product_id INTEGER NOT NULL,
      qty        INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (tg_id, product_id)
    );

    -- ── Заказы ────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id            TEXT    NOT NULL,
      total            INTEGER NOT NULL,
      discount_percent INTEGER NOT NULL DEFAULT 0,
      persona          TEXT    NOT NULL,
      status           TEXT    NOT NULL DEFAULT 'pending',
      payload          TEXT    NOT NULL DEFAULT '',
      created_at       INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      order_id   INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      price      INTEGER NOT NULL,
      qty        INTEGER NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    -- ── История диалога ───────────────────────────────────
    CREATE TABLE IF NOT EXISTS messages (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id      TEXT    NOT NULL,
      role       TEXT    NOT NULL,
      text       TEXT    NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(tg_id, id);
  `);
}
