import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  ЛИЧНОСТИ БОТА                                               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Один и тот же код, один и тот же каталог — но три совершенно разных
 * продавца. Разница только в текстовом файле промпта.
 *
 * Причём личность влияет не только на тон, но и на поведение магазина:
 * Степан реально даёт скидку, Ольга Ивановна реально её не даёт.
 * Это важно показать: промпт — не украшение, он часть бизнес-логики.
 */

export type PersonaId = 'kira' | 'olga' | 'stepan';

export const PERSONA_IDS: PersonaId[] = ['kira', 'olga', 'stepan'];

export function isPersonaId(value: string): value is PersonaId {
  return (PERSONA_IDS as string[]).includes(value);
}

export interface Persona {
  id: PersonaId;
  /** Имя, как бот представляется */
  name: string;
  emoji: string;
  /** Подпись под именем в меню выбора */
  title: string;
  /** Текст кнопки выбора */
  button: string;
  /** Файл промпта в папке prompts/ */
  promptFile: string;
  /** Приветствие при старте и при переключении */
  greeting: string;
  /** Скидка, которую персонаж даёт в корзине (в процентах) */
  discountPercent: number;
  /** Как персонаж называет свою скидку в чеке */
  discountLabel: string;
  /** Подпись под QR-кодом оплаты */
  qrCaption: string;
  /** Что говорит при пустой корзине */
  emptyCart: string;
  /** Реплика, если ни одна модель не ответила (ошибку прячем за характером) */
  aiFallback: string;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  kira: {
    id: 'kira',
    name: 'Кира',
    emoji: '💃',
    title: 'менеджер зала, 22 года',
    button: '💃 Кира',
    promptFile: 'kira.txt',
    greeting:
      '💃 <b>Привет-привет!</b>\n\n' +
      'Я Кира, менеджер зала. Скажи, что ищешь — подберу так, что сам удивишься)\n\n' +
      'Или тыкай кнопки, там всё разложено.',
    discountPercent: 0,
    discountLabel: '',
    qrCaption: 'Держи QR 👇 Оплатишь — сразу пиши, я прослежу, чтобы всё улетело быстро)',
    emptyCart: 'Корзина пустая, ну как так) Пошли выберем что-нибудь.',
    aiFallback: 'Ой, у меня тут связь подвисла на секунду) Повтори, пожалуйста?',
  },

  olga: {
    id: 'olga',
    name: 'Ольга Ивановна',
    emoji: '👵',
    title: 'на замене, 58 лет',
    button: '👵 Ольга Ивановна',
    promptFile: 'olga.txt',
    greeting:
      '👵 <b>Слушаю вас.</b>\n\n' +
      'Ольга Ивановна. Кира отошла, я за неё.\n\n' +
      'Что вам нужно? Только конкретно, пожалуйста. В меню всё написано.',
    discountPercent: 0,
    discountLabel: '',
    qrCaption: 'Вот код. Оплачивайте и не задерживайте, у меня очередь.',
    emptyCart: 'У вас пусто. А что вы хотели, вы же ничего не выбрали.',
    aiFallback: 'Не поняла вас. Повторите нормально.',
  },

  stepan: {
    id: 'stepan',
    name: 'Степан',
    emoji: '🤝',
    title: 'свой человек, 35 лет',
    button: '🤝 Степан',
    promptFile: 'stepan.txt',
    greeting:
      '🤝 <b>О, здарова!</b>\n\n' +
      'Степан. Слушай, ты по адресу зашёл — ща всё сделаем.\n\n' +
      'Говори, что нужно. И это, тебе как своему -10% пробью, пока начальник не видит 🤫',
    discountPercent: 10,
    discountLabel: 'по-братски, пока начальник не видит',
    qrCaption: 'Лови код 👇 Оплатил — свистни, я прослежу чтоб не затерялось.',
    emptyCart: 'Пусто у тебя, братан. Пошли глянем, чё есть — подберём.',
    aiFallback: 'Слышь, связь дурит. Повтори, чё говорил?',
  },
};

export function getPersona(id: PersonaId): Persona {
  return PERSONAS[id];
}

/** Кэш прочитанных с диска промптов — файл читаем один раз */
const promptCache = new Map<PersonaId, string>();

/**
 * Читает файл личности из папки prompts/.
 * Файлы лежат текстом специально: чтобы менять характер бота
 * можно было без единой строчки кода.
 */
export function loadPersonaPrompt(id: PersonaId): string {
  const cached = promptCache.get(id);
  if (cached) return cached;

  const persona = PERSONAS[id];
  const path = join(process.cwd(), 'prompts', persona.promptFile);

  if (!existsSync(path)) {
    throw new Error(
      `Не найден файл личности: ${path}\n` +
      '   Запускать нужно из корня проекта (там, где лежит package.json).',
    );
  }

  const text = readFileSync(path, 'utf-8').trim();
  if (!text) {
    throw new Error(`Файл личности пустой: ${path}`);
  }

  promptCache.set(id, text);
  return text;
}

/** Сбросить кэш — удобно, когда правишь промпт на лету во время записи */
export function clearPromptCache(): void {
  promptCache.clear();
}
