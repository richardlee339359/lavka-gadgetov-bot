import type { Keyboard, InlineButton } from './api.js';
import { CATEGORIES, type Product, type CartRow } from '../shop/db.js';
import { formatPrice } from '../shop/catalog.js';
import { PERSONAS, PERSONA_IDS, type PersonaId } from '../ai/personas.js';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ИНЛАЙН-КЛАВИАТУРЫ                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Несколько правил, по которым кнопки выглядят дорого, а не «на отвяжись»:
 *
 *  1. Кнопки в ряд — только одинаковые по смыслу. Не мешаем в одну строку
 *     «Купить» и «Назад»: рука промахивается, а глаз спотыкается.
 *  2. Эмодзи в начале, текст короткий. Кнопка обязана читаться за полсекунды.
 *  3. Навигация всегда внизу и всегда на одном месте.
 *  4. Есть кнопка-индикатор (например «— 2/4 —»), которая ничего не делает.
 *     Она не для нажатия, а чтобы человек понимал, где находится.
 *
 * callback_data ограничена 64 байтами — поэтому коды короткие: p:12, cat:gadgets:0.
 */

/** Кнопка-заглушка: показывает состояние, но ничего не делает */
const noop = (text: string): InlineButton => ({ text, callback_data: 'noop' });

export function mainMenu(cartItems: number, persona: PersonaId): Keyboard {
  const cartLabel = cartItems > 0 ? `🧺 Корзина · ${cartItems}` : '🧺 Корзина';
  const who = PERSONAS[persona];

  return [
    [
      { text: '🛍 Каталог', callback_data: 'cat' },
      { text: '🔥 Хиты', callback_data: 'hits' },
    ],
    [
      { text: cartLabel, callback_data: 'cart' },
    ],
    [
      { text: `${who.emoji} Сейчас с вами ${who.name}`, callback_data: 'who' },
    ],
    [
      { text: 'ℹ️ О магазине', callback_data: 'about' },
    ],
  ];
}

export function categoriesKeyboard(counts: Map<string, number>): Keyboard {
  const rows: Keyboard = [];

  // По две категории в ряд — сетка 2×2 смотрится аккуратнее столбика
  for (let i = 0; i < CATEGORIES.length; i += 2) {
    const pair = CATEGORIES.slice(i, i + 2).map(category => ({
      text: `${category.emoji} ${category.label}`,
      callback_data: `cat:${category.id}:0`,
    }));
    rows.push(pair);
  }

  rows.push([{ text: '⬅️ В меню', callback_data: 'menu' }]);
  return rows;
}

export function productListKeyboard(
  items: Product[],
  category: string,
  page: number,
  totalPages: number,
): Keyboard {
  const rows: Keyboard = items.map(product => [{
    text: `${product.emoji} ${product.name} · ${formatPrice(product.price)}${product.stock === 0 ? ' ⛔️' : ''}`,
    callback_data: `p:${product.id}:1`,
  }]);

  // Пагинация появляется только если страниц реально больше одной
  if (totalPages > 1) {
    const nav: InlineButton[] = [];

    nav.push(page > 0
      ? { text: '◀️', callback_data: `cat:${category}:${page - 1}` }
      : noop(' '));

    nav.push(noop(`— ${page + 1}/${totalPages} —`));

    nav.push(page < totalPages - 1
      ? { text: '▶️', callback_data: `cat:${category}:${page + 1}` }
      : noop(' '));

    rows.push(nav);
  }

  rows.push([
    { text: '⬅️ Категории', callback_data: 'cat' },
    { text: '🏠 В меню', callback_data: 'menu' },
  ]);

  return rows;
}

/**
 * Карточка товара со счётчиком.
 * Количество не храним в базе — оно едет прямо в callback_data кнопок.
 * Меньше состояния, меньше багов.
 */
export function productCardKeyboard(product: Product, qty: number, backTo: string): Keyboard {
  const rows: Keyboard = [];

  if (product.stock > 0) {
    const canMinus = qty > 1;
    const canPlus = qty < product.stock;

    rows.push([
      canMinus ? { text: '➖', callback_data: `p:${product.id}:${qty - 1}` } : noop(' '),
      noop(`${qty} шт · ${formatPrice(product.price * qty)}`),
      canPlus ? { text: '➕', callback_data: `p:${product.id}:${qty + 1}` } : noop(' '),
    ]);

    rows.push([{ text: '🧺 В корзину', callback_data: `add:${product.id}:${qty}` }]);
  } else {
    rows.push([noop('⛔️ Нет в наличии')]);
  }

  rows.push([
    { text: '⬅️ Назад', callback_data: backTo },
    { text: '🧺 Корзина', callback_data: 'cart' },
  ]);

  return rows;
}

export function cartKeyboard(rows: CartRow[]): Keyboard {
  const keyboard: Keyboard = rows.map(row => [{
    text: `❌ ${row.emoji} ${row.name}`,
    callback_data: `del:${row.product_id}`,
  }]);

  if (rows.length > 0) {
    keyboard.push([{ text: '✅ Оформить заказ', callback_data: 'checkout' }]);
    keyboard.push([
      { text: '🗑 Очистить', callback_data: 'clear' },
      { text: '🛍 Дальше смотреть', callback_data: 'cat' },
    ]);
  } else {
    keyboard.push([{ text: '🛍 В каталог', callback_data: 'cat' }]);
  }

  keyboard.push([{ text: '🏠 В меню', callback_data: 'menu' }]);
  return keyboard;
}

export function paymentKeyboard(orderId: number): Keyboard {
  return [
    [{ text: '💳 Я оплатил', callback_data: `paid:${orderId}` }],
    [{ text: '❌ Отменить заказ', callback_data: `cancel:${orderId}` }],
  ];
}

/** Экран выбора продавца */
export function personaKeyboard(current: PersonaId): Keyboard {
  const rows: Keyboard = PERSONA_IDS.map(id => {
    const persona = PERSONAS[id];
    const mark = id === current ? ' ✓' : '';
    return [{ text: `${persona.button}${mark}`, callback_data: `set:${id}` }];
  });

  rows.push([{ text: '⬅️ В меню', callback_data: 'menu' }]);
  return rows;
}

/**
 * Кнопки под ответом продавца.
 * Если в тексте прозвучал товар из каталога — сразу даём кнопку на карточку.
 * Человеку не нужно искать его руками в меню.
 */
export function afterAnswerKeyboard(mentioned: Product[]): Keyboard {
  const rows: Keyboard = mentioned.slice(0, 3).map(product => [{
    text: `${product.emoji} ${product.name} · ${formatPrice(product.price)}`,
    callback_data: `p:${product.id}:1`,
  }]);

  rows.push([
    { text: '🛍 Каталог', callback_data: 'cat' },
    { text: '🧺 Корзина', callback_data: 'cart' },
  ]);

  return rows;
}

export function backToMenu(): Keyboard {
  return [[{ text: '🏠 В меню', callback_data: 'menu' }]];
}
