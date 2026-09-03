import { CATEGORIES, categoryLabel, type Db, type Product } from './db.js';

/** Сколько товаров показываем на одной странице каталога */
export const PAGE_SIZE = 4;

/** 14900 → "14 900 ₽" (пробел неразрывный, чтобы цена не переносилась) */
export function formatPrice(value: number): string {
  return `${value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;
}

export function getProduct(db: Db, id: number): Product | null {
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
  return row ?? null;
}

export function getByCategory(db: Db, category: string): Product[] {
  return db
    .prepare('SELECT * FROM products WHERE category = ? ORDER BY stock = 0, is_hit DESC, price ASC')
    .all(category) as Product[];
}

export function getHits(db: Db): Product[] {
  return db
    .prepare('SELECT * FROM products WHERE is_hit = 1 AND stock > 0 ORDER BY price ASC')
    .all() as Product[];
}

export function getAll(db: Db): Product[] {
  return db.prepare('SELECT * FROM products ORDER BY category, price').all() as Product[];
}

/** Сколько товаров в каждой категории — для подписей на кнопках */
export function getCategoryCounts(db: Db): Map<string, number> {
  const rows = db
    .prepare('SELECT category, COUNT(*) AS n FROM products WHERE stock > 0 GROUP BY category')
    .all() as Array<{ category: string; n: number }>;

  return new Map(rows.map(r => [r.category, r.n]));
}

/** Страница каталога: сами товары + сколько всего страниц */
export function paginate(products: Product[], page: number): { items: Product[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const start = safePage * PAGE_SIZE;

  return {
    items: products.slice(start, start + PAGE_SIZE),
    page: safePage,
    totalPages,
  };
}

/** Карточка товара в чате (HTML для Telegram) */
export function renderProductCard(product: Product): string {
  const lines: string[] = [];

  lines.push(`${product.emoji} <b>${escapeHtml(product.name)}</b>`);
  lines.push('');
  lines.push(escapeHtml(product.description));
  lines.push('');

  if (product.old_price > 0) {
    const save = product.old_price - product.price;
    lines.push(`💰 <b>${formatPrice(product.price)}</b>  <s>${formatPrice(product.old_price)}</s>`);
    lines.push(`🔥 Выгода ${formatPrice(save)}`);
  } else {
    lines.push(`💰 <b>${formatPrice(product.price)}</b>`);
  }

  lines.push('');

  if (product.stock === 0) {
    lines.push('⛔️ Сейчас нет в наличии');
  } else if (product.stock <= 3) {
    lines.push(`⚡️ Осталось всего ${product.stock} шт.`);
  } else {
    lines.push(`✅ В наличии: ${product.stock} шт.`);
  }

  lines.push(`📂 ${categoryLabel(product.category)}`);

  return lines.join('\n');
}

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  КАТАЛОГ → ПРОМПТ                                            ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Вот это — главный трюк всего бота.
 *
 * Мы не учим модель товарам и не дообучаем её. Мы просто кладём весь
 * каталог прямо в системный промпт, при каждом запросе, в свежем виде.
 * Поменяли цену в базе — через секунду продавец называет новую цену.
 * Товар закончился — продавец честно говорит «закончился», а не выдумывает.
 *
 * Формат — XML-подобный: модели такое читают заметно точнее, чем
 * сплошной текст, и почти не путают поля между собой.
 */
export function formatCatalogForPrompt(db: Db): string {
  const products = getAll(db);
  const blocks: string[] = [];

  for (const category of CATEGORIES) {
    const items = products.filter(p => p.category === category.id);
    if (items.length === 0) continue;

    const rows = items.map(p => {
      const parts = [
        `    <item id="${p.id}">`,
        `      <name>${p.name}</name>`,
        `      <price>${p.price} руб</price>`,
      ];

      if (p.old_price > 0) {
        parts.push(`      <old_price>${p.old_price} руб (действует скидка)</old_price>`);
      }

      parts.push(`      <about>${p.description}</about>`);
      parts.push(
        p.stock > 0
          ? `      <stock>в наличии, ${p.stock} шт</stock>`
          : `      <stock>НЕТ В НАЛИЧИИ — не предлагай этот товар, если спросят прямо, честно скажи что закончился</stock>`,
      );

      if (p.is_hit) parts.push('      <note>хит продаж, можно смело советовать</note>');
      if (p.tags) parts.push(`      <keywords>${p.tags}</keywords>`);

      parts.push('    </item>');
      return parts.join('\n');
    });

    blocks.push(`  <category name="${category.label}">\n${rows.join('\n')}\n  </category>`);
  }

  return `<catalog>\n${blocks.join('\n')}\n</catalog>`;
}

/** Экранирование под parse_mode=HTML в Telegram */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
