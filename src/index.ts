import { loadConfig, requireTelegramToken } from './config.js';
import { openDb } from './shop/db.js';
import { seedProducts } from './shop/seed.js';
import { AiClient } from './ai/ai-client.js';
import { PromptAssembler } from './ai/prompt-assembler.js';
import { ConversationStore } from './storage/conversation-store.js';
import { TelegramApi } from './tg/api.js';
import { ShopBot } from './tg/bot.js';

/**
 * Точка входа. Запуск: npm run dev
 */
async function main(): Promise<void> {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   🏪  ЛАВКА ГАДЖЕТОВ — Telegram-бот        ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const config = loadConfig();
  const token = requireTelegramToken(config);

  const db = openDb(config.dbPath);

  // Если базу ещё не наполняли — сделаем это сами, чтобы бот
  // не запустился с пустым каталогом и не пришлось гадать, почему он молчит.
  const productCount = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
  if (productCount.n === 0) {
    console.log('   📦 Каталог пуст — наполняю демо-товарами...');
    seedProducts(db);
  }

  const inStock = db.prepare('SELECT COUNT(*) AS n FROM products WHERE stock > 0').get() as { n: number };
  console.log(`   🏪 Каталог: товаров в наличии — ${inStock.n}`);

  const ai = new AiClient(config.geminiKeys, config.modelCascade, config.temperature, config.keyCooldownSec);
  const assembler = new PromptAssembler(db);
  const conversations = new ConversationStore(db, config.historyLimit);
  const api = new TelegramApi(token);

  const bot = new ShopBot(api, db, ai, assembler, conversations, config);
  await bot.start();

  // Аккуратное завершение по Ctrl+C: докрутить текущий запрос,
  // закрыть базу и показать, как отработали ключи.
  const shutdown = () => {
    console.log('\n   ⏹  Останавливаюсь...');
    bot.stop();
    ai.getRotator().printStats();
    db.close();
    console.log('\n   Готово.\n');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error('\n❌ Запуск не удался:\n');
  console.error(`   ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
