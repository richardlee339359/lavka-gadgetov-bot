import { createInterface } from 'node:readline/promises';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/shop/db.js';
import { seedProducts } from '../src/shop/seed.js';
import { AiClient, type ChatMessage } from '../src/ai/ai-client.js';
import { PromptAssembler } from '../src/ai/prompt-assembler.js';
import { getPersona, isPersonaId, PERSONA_IDS, type PersonaId } from '../src/ai/personas.js';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ПРОСТОЙ ЧАТ В КОНСОЛИ                                       ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Тот же продавец, тот же каталог, та же ротация ключей — но без Telegram.
 * Нужен для двух вещей:
 *   1. Проверить, что ключи из .env вообще работают, до всякого бота.
 *   2. Показать логи ротации крупно: в консоли видно каждый шаг.
 *
 * Запуск:
 *     npm run chat            — по умолчанию Кира
 *     npm run chat -- olga    — Ольга Ивановна
 *     npm run chat -- stepan  — Степан
 *
 * Внутри чата:
 *     /кто     — сменить продавца
 *     /сброс   — забыть разговор
 *     /выход   — закончить
 */

function pickPersona(): PersonaId {
  const arg = (process.argv[2] || '').trim().toLowerCase();
  if (arg && isPersonaId(arg)) return arg;
  if (arg) console.warn(`   ⚠️  Личности «${arg}» нет. Доступные: ${PERSONA_IDS.join(', ')}\n`);
  return 'kira';
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);

  const count = db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
  if (count.n === 0) seedProducts(db);

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   💬  ЧАТ С ПРОДАВЦОМ (без Telegram)       ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const ai = new AiClient(config.geminiKeys, config.modelCascade, config.temperature, config.keyCooldownSec);
  const assembler = new PromptAssembler(db);

  let personaId = pickPersona();
  let history: ChatMessage[] = [];

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(`\n   ${getPersona(personaId).emoji} С тобой говорит: ${getPersona(personaId).name}`);
  console.log('   Команды: /кто · /сброс · /выход\n');

  while (true) {
    const input = (await rl.question('\n\x1b[36mТы:\x1b[0m ')).trim();
    if (!input) continue;

    if (input === '/выход' || input === '/exit') break;

    if (input === '/сброс' || input === '/reset') {
      history = [];
      console.log('   🧹 История очищена');
      continue;
    }

    if (input === '/кто' || input === '/who') {
      const answer = (await rl.question(`   Кто нужен (${PERSONA_IDS.join(' / ')})? `)).trim().toLowerCase();
      if (isPersonaId(answer)) {
        personaId = answer;
        history = []; // обязательно: иначе новый продавец подхватит чужие реплики
        console.log(`   ${getPersona(personaId).emoji} Теперь с тобой ${getPersona(personaId).name}`);
      } else {
        console.log('   Такой личности нет');
      }
      continue;
    }

    history.push({ role: 'user', text: input });

    try {
      const result = await ai.generate(assembler.build(personaId), history);
      history.push({ role: 'model', text: result.text });

      const persona = getPersona(personaId);
      console.log(`\n\x1b[33m${persona.name}:\x1b[0m ${result.text}`);
      console.log(`\x1b[90m   [${result.model} · ключ #${result.keyNumber}]\x1b[0m`);
    } catch (error) {
      console.error(`\n   ❌ ${error instanceof Error ? error.message : error}`);
    }
  }

  rl.close();
  ai.getRotator().printStats();
  db.close();
  console.log('\n   Пока!\n');
}

main().catch((error: unknown) => {
  console.error('\n❌ ', error instanceof Error ? error.message : String(error), '\n');
  process.exit(1);
});
