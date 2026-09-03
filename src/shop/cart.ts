import type { Db, CartRow, Order } from './db.js';
import { formatPrice, escapeHtml } from './catalog.js';
import type { Persona } from '../ai/personas.js';

/**
 * Корзина и заказы.
 *
 * Обрати внимание на скидку: её размер приходит из личности продавца.
 * Степан даёт 10% «пока начальник не видит», Ольга Ивановна не даёт
 * ничего принципиально. Это тот самый момент, где характер бота
 * перестаёт быть просто тоном и становится бизнес-логикой.
 */

export function getCart(db: Db, tgId: string): CartRow[] {
  return db
    .prepare(`
      SELECT c.product_id, c.qty, p.name, p.emoji, p.price, p.stock
      FROM carts c
      JOIN products p ON p.id = c.product_id
      WHERE c.tg_id = ?
      ORDER BY p.name
    `)
    .all(tgId) as CartRow[];
}

/** Добавить товар. Больше, чем есть на складе, положить не даём. */
export function addToCart(db: Db, tgId: string, productId: number, qty = 1): { ok: boolean; reason?: string } {
  const product = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(productId) as
    | { stock: number; name: string }
    | undefined;

  if (!product) return { ok: false, reason: 'Товар не найден' };
  if (product.stock === 0) return { ok: false, reason: 'Этого сейчас нет в наличии' };

  const current = db.prepare('SELECT qty FROM carts WHERE tg_id = ? AND product_id = ?').get(tgId, productId) as
    | { qty: number }
    | undefined;

  const wanted = (current?.qty || 0) + qty;

  if (wanted > product.stock) {
    return { ok: false, reason: `На складе всего ${product.stock} шт.` };
  }

  if (wanted <= 0) {
    db.prepare('DELETE FROM carts WHERE tg_id = ? AND product_id = ?').run(tgId, productId);
    return { ok: true };
  }

  db.prepare(`
    INSERT INTO carts (tg_id, product_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(tg_id, product_id) DO UPDATE SET qty = excluded.qty
  `).run(tgId, productId, wanted);

  return { ok: true };
}

export function removeFromCart(db: Db, tgId: string, productId: number): void {
  db.prepare('DELETE FROM carts WHERE tg_id = ? AND product_id = ?').run(tgId, productId);
}

export function clearCart(db: Db, tgId: string): void {
  db.prepare('DELETE FROM carts WHERE tg_id = ?').run(tgId);
}

export function cartCount(db: Db, tgId: string): number {
  const row = db.prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM carts WHERE tg_id = ?').get(tgId) as { n: number };
  return row.n;
}

export function subtotal(rows: CartRow[]): number {
  return rows.reduce((sum, r) => sum + r.price * r.qty, 0);
}

export interface CartTotals {
  subtotal: number;
  discount: number;
  total: number;
}

export function calcTotals(rows: CartRow[], persona: Persona): CartTotals {
  const sub = subtotal(rows);
  const discount = Math.round((sub * persona.discountPercent) / 100);
  return { subtotal: sub, discount, total: sub - discount };
}

/** Корзина текстом (HTML для Telegram) */
export function renderCart(rows: CartRow[], persona: Persona): string {
  if (rows.length === 0) {
    return `🧺 <b>Корзина</b>\n\n${escapeHtml(persona.emptyCart)}`;
  }

  const totals = calcTotals(rows, persona);
  const lines: string[] = ['🧺 <b>Корзина</b>', ''];

  for (const row of rows) {
    lines.push(`${row.emoji} ${escapeHtml(row.name)}`);
    lines.push(`      ${row.qty} × ${formatPrice(row.price)} = <b>${formatPrice(row.price * row.qty)}</b>`);
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━');

  if (totals.discount > 0) {
    lines.push(`Сумма: ${formatPrice(totals.subtotal)}`);
    lines.push(`Скидка ${persona.discountPercent}% <i>(${escapeHtml(persona.discountLabel)})</i>: −${formatPrice(totals.discount)}`);
    lines.push(`💰 <b>К оплате: ${formatPrice(totals.total)}</b>`);
  } else {
    lines.push(`💰 <b>Итого: ${formatPrice(totals.total)}</b>`);
  }

  return lines.join('\n');
}

/**
 * Оформление заказа: переносим корзину в orders + order_items и чистим её.
 * Цены фиксируем в момент заказа — если завтра цена изменится,
 * в старом заказе останется та, по которой человек покупал.
 */
export function createOrder(db: Db, tgId: string, persona: Persona): Order | null {
  const rows = getCart(db, tgId);
  if (rows.length === 0) return null;

  const totals = calcTotals(rows, persona);
  const now = Date.now();

  const tx = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO orders (tg_id, total, discount_percent, persona, status, payload, created_at)
        VALUES (?, ?, ?, ?, 'pending', '', ?)
      `)
      .run(tgId, totals.total, persona.discountPercent, persona.id, now);

    const orderId = Number(result.lastInsertRowid);

    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, product_id, name, price, qty) VALUES (?, ?, ?, ?, ?)',
    );
    for (const row of rows) {
      insertItem.run(orderId, row.product_id, row.name, row.price, row.qty);
    }

    // Платёжная строка, которую зашиваем в QR.
    // В реальном магазине здесь была бы ссылка от банка или платёжного шлюза.
    const payload = `shop://order/${orderId}?amount=${totals.total}&cur=RUB`;
    db.prepare('UPDATE orders SET payload = ? WHERE id = ?').run(payload, orderId);

    db.prepare('DELETE FROM carts WHERE tg_id = ?').run(tgId);

    return orderId;
  });

  const orderId = tx();
  return getOrder(db, orderId);
}

export function getOrder(db: Db, orderId: number): Order | null {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Order | undefined;
  return row ?? null;
}

export function getOrderItems(db: Db, orderId: number): Array<{ name: string; price: number; qty: number }> {
  return db
    .prepare('SELECT name, price, qty FROM order_items WHERE order_id = ?')
    .all(orderId) as Array<{ name: string; price: number; qty: number }>;
}

/**
 * Отметить заказ оплаченным и списать товар со склада.
 * Здесь в настоящем магазине стоял бы вебхук от банка,
 * а не кнопка «я оплатил».
 */
export function markPaid(db: Db, orderId: number): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'").run(orderId);

    const items = getOrderItems(db, orderId);
    const updateStock = db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE name = ?');
    for (const item of items) {
      updateStock.run(item.qty, item.name);
    }
  });

  tx();
}

export function cancelOrder(db: Db, orderId: number): void {
  db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(orderId);
}
