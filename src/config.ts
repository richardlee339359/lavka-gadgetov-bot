import 'dotenv/config';
import { isPersonaId, type PersonaId } from './ai/personas.js';

/**
 * Конфигурация приложения.
 * Всё читается из .env — в коде нет ни одного захардкоженного ключа.
 */
export interface AppConfig {
  /** Токен бота от @BotFather. Пустой — если запускаем только демо в консоли. */
  tgBotToken: string;
  /** Telegram ID администратора (для /stats). Необязательно. */
  adminTgId: string;
  /** Все ключи Gemini — по одному на проект Google. */
  geminiKeys: string[];
  /** Каскад моделей от старшей к младшей. */
  modelCascade: string[];
  temperature: number;
  historyLimit: number;
  keyCooldownSec: number;
  defaultPersona: PersonaId;
  dbPath: string;
  useCustomEmoji: boolean;
}

/**
 * Собирает все переменные вида GEMINI_KEY_<число> в массив.
 *
 * Так сделано специально: чтобы добавить четвёртый ключ, зрителю не нужно
 * лезть в код — достаточно дописать в .env строку GEMINI_KEY_4=...
 * Порядок сохраняем по номеру, а не по порядку в файле.
 */
function parseGeminiKeys(): string[] {
  const found: Array<{ num: number; key: string }> = [];

  for (const [name, rawValue] of Object.entries(process.env)) {
    const match = name.match(/^GEMINI_KEY_(\d+)$/);
    if (!match) continue;

    const value = (rawValue || '').trim();
    if (!value) continue; // пустую строку в .env просто пропускаем

    found.push({ num: Number(match[1]), key: value });
  }

  found.sort((a, b) => a.num - b.num);

  // Один и тот же ключ, случайно вставленный дважды, не даёт второго лимита —
  // а вот путаницы в логах добавляет. Убираем дубли.
  const unique = [...new Set(found.map(f => f.key))];

  if (unique.length === 0) {
    throw new Error(
      'В .env нет ни одного ключа Gemini.\n' +
      '   Возьми ключ на https://aistudio.google.com → Get API key\n' +
      '   и впиши в .env строку:  GEMINI_KEY_1=AQ.Ab8...\n' +
      '   (ключ вставляется целиком, без кавычек и пробелов)',
    );
  }

  if (unique.length < found.length) {
    console.warn(`   ⚠️  В .env найдены одинаковые ключи, оставил только уникальные (${unique.length} из ${found.length})`);
  }

  return unique;
}

function parseModelCascade(): string[] {
  const raw = (process.env.MODEL_CASCADE || '').trim();

  if (!raw) {
    throw new Error(
      'В .env не задан MODEL_CASCADE.\n' +
      '   Пример:  MODEL_CASCADE=gemini-2.5-pro,gemini-2.5-flash,gemini-2.5-flash-lite',
    );
  }

  const models = raw.split(',').map(m => m.trim()).filter(Boolean);
  if (models.length === 0) {
    throw new Error('MODEL_CASCADE задан, но пуст. Нужна хотя бы одна модель.');
  }

  return models;
}

function num(name: string, fallback: number): number {
  const raw = (process.env[name] || '').trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    console.warn(`   ⚠️  ${name}="${raw}" — это не число, беру значение по умолчанию ${fallback}`);
    return fallback;
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = (process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function loadConfig(): AppConfig {
  const rawPersona = (process.env.DEFAULT_PERSONA || 'kira').trim().toLowerCase();
  if (!isPersonaId(rawPersona)) {
    throw new Error(
      `DEFAULT_PERSONA="${rawPersona}" — такой личности нет.\n` +
      '   Доступные: kira, olga, stepan',
    );
  }

  return {
    tgBotToken: (process.env.TG_BOT_TOKEN || '').trim(),
    adminTgId: (process.env.ADMIN_TG_ID || '').trim(),
    geminiKeys: parseGeminiKeys(),
    modelCascade: parseModelCascade(),
    temperature: num('AI_TEMPERATURE', 0.9),
    historyLimit: num('HISTORY_LIMIT', 12),
    keyCooldownSec: num('KEY_COOLDOWN_SEC', 60),
    defaultPersona: rawPersona,
    dbPath: (process.env.DB_PATH || './shop.db').trim(),
    useCustomEmoji: bool('USE_CUSTOM_EMOJI', false),
  };
}

/**
 * Отдельная проверка токена бота: демо-скриптам (chat, rotation-demo)
 * Telegram не нужен, поэтому в loadConfig() токен не обязателен.
 */
export function requireTelegramToken(config: AppConfig): string {
  if (!config.tgBotToken) {
    throw new Error(
      'В .env не задан TG_BOT_TOKEN.\n' +
      '   Открой @BotFather → /newbot → скопируй токен → впиши в .env:\n' +
      '   TG_BOT_TOKEN=1234567890:AA...',
    );
  }
  return config.tgBotToken;
}
