import { loadConfig } from '../src/config.js';
import { AiClient } from '../src/ai/ai-client.js';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ДЕМОНСТРАЦИЯ РОТАЦИИ                                        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Скрипт специально долбит модель пачкой одновременных запросов,
 * чтобы выбить ошибку 429 и показать, что происходит дальше.
 *
 * Смотри в логи. Ты увидишь примерно такую картину:
 *
 *     ✨ Ответ получен: gemini-3.8-flash, ключ #1
 *     ⚠️  Ключ #1 исчерпан (429) → отдыхает 60 сек   🔄 Переключаюсь на ключ #2
 *     ✨ Ответ получен: gemini-3.8-flash, ключ #2
 *     ⚠️  Ключ #2 исчерпан (429) → отдыхает 60 сек   🔄 Переключаюсь на ключ #3
 *     ⚠️  [gemini-3.8-flash] Все 3 ключей исчерпаны
 *     ⬇️  Спускаюсь на следующую модель: gemini-3.6-flash
 *     ✨ Ответ получен: gemini-3.6-flash, ключ #1
 *
 * Вот ради этих строк всё и затевалось: сервис продолжает отвечать,
 * даже когда часть ключей уже упёрлась в лимит.
 *
 * Запуск:
 *     npm run rotation-demo          — 20 запросов
 *     npm run rotation-demo -- 50    — 50 запросов
 */

const SYSTEM_PROMPT =
  'Ты — продавец в магазине электроники. Отвечай одним коротким предложением, без списков.';

const QUESTIONS = [
  'посоветуй наушники для метро',
  'что взять в подарок на 5 тысяч',
  'нужен повербанк, какой?',
  'умная лампа — это вообще нужно?',
  'что лучше: часы или браслет',
  'нужна колонка на дачу',
  'какой кабель не сломается через месяц',
  'робот-пылесос реально помогает?',
];

async function main(): Promise<void> {
  const total = Math.max(1, Number(process.argv[2] || 20));
  const config = loadConfig();

  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║   🔥  ДЕМО: РОТАЦИЯ КЛЮЧЕЙ И МОДЕЛЕЙ       ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const ai = new AiClient(config.geminiKeys, config.modelCascade, config.temperature, config.keyCooldownSec);

  console.log(`\n   Отправляю ${total} запросов одновременно.`);
  console.log('   Чем меньше у тебя ключей — тем быстрее увидишь переключение.\n');
  console.log('   ─────────────────────────────────────────────\n');

  const startedAt = Date.now();

  const results = await Promise.allSettled(
    Array.from({ length: total }, (_, i) => {
      const question = QUESTIONS[i % QUESTIONS.length]!;
      return ai.generate(SYSTEM_PROMPT, [{ role: 'user', text: question }]);
    }),
  );

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  // ── Итоги ──────────────────────────────────────────────────
  const byModel = new Map<string, number>();
  let ok = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      ok++;
      byModel.set(result.value.model, (byModel.get(result.value.model) || 0) + 1);
    } else {
      failed++;
    }
  }

  console.log('\n   ─────────────────────────────────────────────');
  console.log(`\n   ⏱  Заняло: ${elapsed} сек`);
  console.log(`   ✅ Успешно: ${ok} из ${total}`);
  if (failed > 0) console.log(`   ❌ Не удалось: ${failed}`);

  console.log('\n   📈 Какая модель сколько вытянула:');
  for (const model of config.modelCascade) {
    const count = byModel.get(model) || 0;
    const bar = '█'.repeat(count).padEnd(Math.max(1, total / 2), '·');
    console.log(`      ${model.padEnd(28)} ${bar} ${count}`);
  }

  ai.getRotator().printStats();

  if (ok === 0) {
    console.log('\n   ⚠️  Ни один запрос не прошёл. Разбирайся с .env — смотри сообщения выше.\n');
  } else {
    console.log('\n   💡 Вывод: пока есть хоть один свободный ключ или модель попроще,');
    console.log('      пользователь получает ответ и не видит никаких ошибок.\n');
  }
}

main().catch((error: unknown) => {
  console.error('\n❌ ', error instanceof Error ? error.message : String(error), '\n');
  process.exit(1);
});
