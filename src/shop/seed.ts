import 'dotenv/config';
import { openDb, type Db } from './db.js';

/**
 * Наполнение магазина демо-товарами.
 * Запуск: npm run seed
 *
 * Скрипт можно гонять сколько угодно раз — товары перезаписываются,
 * корзины и заказы не трогаются.
 */

interface SeedProduct {
  id: number;
  category: string;
  name: string;
  emoji: string;
  description: string;
  price: number;
  old_price: number;
  stock: number;
  is_hit: number;
  /** Слова, по которым модель поймёт, что человек спрашивает про этот товар */
  tags: string;
}

export const DEMO_PRODUCTS: SeedProduct[] = [
  // ── 🎧 Наушники ──────────────────────────────────────────
  {
    id: 1, category: 'headphones', emoji: '🎧',
    name: 'TWS Soundcore P40i',
    description: 'Затычки с шумодавом и автономностью до 60 часов с кейсом. Народный выбор: за свои деньги конкурентов почти нет.',
    price: 4990, old_price: 6490, stock: 12, is_hit: 1,
    tags: 'беспроводные наушники tws затычки вкладыши шумодав бюджет недорого',
  },
  {
    id: 2, category: 'headphones', emoji: '🎸',
    name: 'Marshall Major V',
    description: 'Накладные, легендарный дизайн, 100 часов работы. Звук тёплый, с характером — под рок и живые записи.',
    price: 12900, old_price: 0, stock: 4, is_hit: 0,
    tags: 'накладные наушники marshall стильные премиум рок',
  },
  {
    id: 3, category: 'headphones', emoji: '🎮',
    name: 'HyperX Cloud III',
    description: 'Игровая гарнитура с микрофоном. Мягкие амбушюры — можно сидеть в них весь вечер и не устать.',
    price: 8490, old_price: 0, stock: 7, is_hit: 0,
    tags: 'игровые наушники гарнитура микрофон гейминг компьютер',
  },
  {
    id: 4, category: 'headphones', emoji: '🔉',
    name: 'Sennheiser CX 80S',
    description: 'Проводные вкладыши. Простые, честные, звучат заметно лучше всего, что идёт в комплекте с телефоном.',
    price: 1890, old_price: 0, stock: 30, is_hit: 0,
    tags: 'проводные наушники дешёвые бюджетные вкладыши джек',
  },

  // ── 📱 Гаджеты ───────────────────────────────────────────
  {
    id: 5, category: 'gadgets', emoji: '⌚',
    name: 'Amazfit GTS 4 Mini',
    description: 'Часы с пульсом, сном и GPS. Держат две недели от одной зарядки — про кабель забываешь.',
    price: 7990, old_price: 9490, stock: 9, is_hit: 1,
    tags: 'смарт часы фитнес браслет шаги пульс сон gps подарок',
  },
  {
    id: 6, category: 'gadgets', emoji: '📖',
    name: 'Onyx Boox Poke 5',
    description: 'Электронная книга на E-Ink. Глаза не устают даже через три часа чтения, читает все форматы.',
    price: 18900, old_price: 0, stock: 2, is_hit: 0,
    tags: 'электронная книга читалка e-ink чтение',
  },
  {
    id: 7, category: 'gadgets', emoji: '🔊',
    name: 'JBL Flip 6',
    description: 'Портативная колонка, влагозащита IP67. Можно спокойно брать на пляж и в душ.',
    price: 9990, old_price: 0, stock: 0, is_hit: 0, // ← специально нет в наличии
    tags: 'колонка портативная блютуз влагозащита музыка',
  },
  {
    id: 8, category: 'gadgets', emoji: '🎥',
    name: 'Insta360 Go 3',
    description: 'Экшн-камера размером с монету, крепится магнитом хоть на кепку. Стабилизация — как будто снимали со штатива.',
    price: 24900, old_price: 0, stock: 3, is_hit: 0,
    tags: 'экшн камера съёмка видео блог влог стабилизация',
  },

  // ── 🔌 Аксессуары ────────────────────────────────────────
  {
    id: 9, category: 'accessories', emoji: '🔋',
    name: 'Anker PowerCore 20000',
    description: 'Пауэрбанк на 20000 мАч с быстрой зарядкой. Телефон заряжает четыре раза, ноутбук — один.',
    price: 3490, old_price: 0, stock: 25, is_hit: 1,
    tags: 'повербанк пауэрбанк внешний аккумулятор зарядка путешествия',
  },
  {
    id: 10, category: 'accessories', emoji: '🔌',
    name: 'Кабель USB-C 100W, 2 м',
    description: 'Плетёный, в нейлоне, держит 100 Вт. Тот случай, когда переплачивать смысла нет, а экономить — есть куда.',
    price: 690, old_price: 0, stock: 100, is_hit: 0,
    tags: 'кабель провод usb type-c зарядка дешёвый',
  },
  {
    id: 11, category: 'accessories', emoji: '⚡',
    name: 'Беспроводная зарядка 15W',
    description: 'Подставка Qi. Кладёшь телефон — он заряжается, и никаких воткнутых проводов на столе.',
    price: 1590, old_price: 0, stock: 18, is_hit: 0,
    tags: 'беспроводная зарядка qi подставка стол',
  },
  {
    id: 12, category: 'accessories', emoji: '🚗',
    name: 'Автодержатель магнитный',
    description: 'Магнит на дефлектор. Держит крепко, телефон не улетает на кочках.',
    price: 890, old_price: 0, stock: 40, is_hit: 0,
    tags: 'держатель авто машина магнит телефон навигатор',
  },

  // ── 💡 Умный дом ─────────────────────────────────────────
  {
    id: 13, category: 'smarthome', emoji: '💡',
    name: 'Умная лампа Yeelight E27',
    description: 'Обычный цоколь, 16 миллионов цветов, управление с телефона и голосом. Самый простой вход в умный дом.',
    price: 1290, old_price: 0, stock: 22, is_hit: 0,
    tags: 'умная лампа свет цветная подсветка алиса голос',
  },
  {
    id: 14, category: 'smarthome', emoji: '🤖',
    name: 'Робот-пылесос Xiaomi E10',
    description: 'Сухая и влажная уборка, строит карту квартиры. Запускается с телефона, пока вы на работе.',
    price: 14900, old_price: 17900, stock: 5, is_hit: 1,
    tags: 'робот пылесос уборка квартира влажная',
  },
  {
    id: 15, category: 'smarthome', emoji: '💧',
    name: 'Датчик протечки Aqara',
    description: 'Кладётся под мойку и стиралку. Стоит как ужин в кафе, а спасает от ремонта у соседей снизу.',
    price: 1690, old_price: 0, stock: 14, is_hit: 0,
    tags: 'датчик протечки вода затопление защита',
  },
];

export function seedProducts(db: Db): void {
  const insert = db.prepare(`
    INSERT INTO products (id, category, name, emoji, description, price, old_price, stock, is_hit, tags)
    VALUES (@id, @category, @name, @emoji, @description, @price, @old_price, @stock, @is_hit, @tags)
    ON CONFLICT(id) DO UPDATE SET
      category    = excluded.category,
      name        = excluded.name,
      emoji       = excluded.emoji,
      description = excluded.description,
      price       = excluded.price,
      old_price   = excluded.old_price,
      stock       = excluded.stock,
      is_hit      = excluded.is_hit,
      tags        = excluded.tags
  `);

  const insertAll = db.transaction((items: SeedProduct[]) => {
    for (const item of items) insert.run(item);
  });

  insertAll(DEMO_PRODUCTS);
}

// ── Запуск из командной строки ─────────────────────────────
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').endsWith('shop/seed.ts')
  || process.argv[1]?.replace(/\\/g, '/').endsWith('shop/seed.js');

if (isDirectRun) {
  // Наполнение базы — единственный шаг, которому не нужны ни ключи Gemini,
  // ни токен бота. Поэтому берём только путь к базе и не трогаем loadConfig():
  // человек должен уметь создать магазин ещё до того, как получит ключи.
  const dbPath = (process.env.DB_PATH || './shop.db').trim();
  const db = openDb(dbPath);

  seedProducts(db);

  const total = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
  const inStock = db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock > 0').get() as { n: number };

  console.log(`\n🏪 Магазин наполнен: ${total.n} товаров, из них в наличии ${inStock.n}`);
  console.log(`   База: ${dbPath}`);
  console.log('\n   Дальше: npm run dev\n');

  db.close();
}
