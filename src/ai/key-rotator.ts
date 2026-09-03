/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  РОТАЦИЯ КЛЮЧЕЙ — сердце отказоустойчивости                  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Задача простая: у нас на руках N ключей от разных проектов Google.
 * Квота у Google считается НА ПРОЕКТ, значит каждый ключ — это отдельный
 * независимый лимит запросов.
 *
 * Когда Google отвечает ошибкой 429 (Too Many Requests / RESOURCE_EXHAUSTED),
 * это не «всё сломалось» — это «конкретно этот ключ на сейчас исчерпан».
 * Значит ключ надо отложить в сторону на минуту и продолжить работу
 * со следующим. Пользователь при этом ничего не замечает.
 *
 * Класс НИЧЕГО не знает про Gemini и HTTP. Он умеет ровно три вещи:
 *   1. отдать текущий рабочий ключ           → getCurrentKey()
 *   2. пометить ключ как исчерпанный         → markRateLimited()
 *   3. сказать, сколько ждать, если все спят → getWaitTime()
 *
 * Именно поэтому его легко переиспользовать в любом проекте.
 */
export class KeyRotator {
  /** Все ключи в том порядке, в каком они пришли из .env */
  private keys: string[];

  /** Индекс ключа, с которого начинаем поиск в следующий раз */
  private currentIndex = 0;

  /** Сколько раз каждый ключ реально отработал — для статистики */
  private usageCounts = new Map<string, number>();

  /** Ключ → timestamp (мс), до которого его трогать нельзя */
  private cooldownUntil = new Map<string, number>();

  /** Ключи, которые Google не принял вообще: битые, удалённые, чужого проекта */
  private dead = new Set<string>();

  /** Длительность «отдыха» ключа после 429 */
  private cooldownMs: number;

  constructor(keys: string[], cooldownSec = 60) {
    if (keys.length === 0) {
      throw new Error('KeyRotator: не передано ни одного ключа');
    }

    this.keys = keys;
    this.cooldownMs = cooldownSec * 1000;

    for (const key of keys) {
      this.usageCounts.set(key, 0);
    }

    console.log(`   🔑 KeyRotator: загружено ключей — ${keys.length}, отдых после 429 — ${cooldownSec} сек`);
  }

  /**
   * Отдаёт ключ, которым можно работать прямо сейчас.
   *
   * Идём по кругу, начиная с текущего индекса, и берём первый ключ,
   * у которого закончился cooldown. Если свободных нет вообще —
   * возвращаем тот, который освободится раньше остальных
   * (вызывающий код сам решит, ждать его или нет).
   */
  getCurrentKey(): string {
    const now = Date.now();

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx]!;
      if (this.dead.has(key)) continue;

      const restingUntil = this.cooldownUntil.get(key) || 0;
      if (now >= restingUntil) {
        this.currentIndex = idx;
        return key;
      }
    }

    // Все живые ключи отдыхают — берём того, кто проснётся первым
    let earliestIdx = 0;
    let earliestTime = Infinity;

    for (let i = 0; i < this.keys.length; i++) {
      if (this.dead.has(this.keys[i]!)) continue;

      const restingUntil = this.cooldownUntil.get(this.keys[i]!) || 0;
      if (restingUntil < earliestTime) {
        earliestTime = restingUntil;
        earliestIdx = i;
      }
    }

    this.currentIndex = earliestIdx;
    return this.keys[earliestIdx]!;
  }

  /** Номер текущего ключа (1-based) — только для красивых логов */
  getCurrentKeyNumber(): number {
    return this.currentIndex + 1;
  }

  /** Запрос прошёл успешно — засчитываем ключу использование */
  markUsed(): void {
    const key = this.keys[this.currentIndex]!;
    this.usageCounts.set(key, (this.usageCounts.get(key) || 0) + 1);
  }

  /**
   * Ключ упёрся в лимит: отправляем его отдыхать и сразу переключаемся
   * на следующий по кругу.
   */
  markRateLimited(): void {
    const key = this.keys[this.currentIndex]!;
    this.cooldownUntil.set(key, Date.now() + this.cooldownMs);

    const wasNumber = this.currentIndex + 1;
    this.currentIndex = (this.currentIndex + 1) % this.keys.length;

    // Когда ключ всего один, переключаться некуда — и врать про это не надо
    const next = this.keys.length > 1
      ? `   🔄 Переключаюсь на ключ #${this.currentIndex + 1}`
      : '   ↳ Других ключей нет — заведи ещё проект в AI Studio';

    console.log(
      `   ⚠️  Ключ #${wasNumber} исчерпан (429) → отдыхает ${this.cooldownMs / 1000} сек` + next,
    );
  }

  /**
   * Ключ оказался нерабочим: Google его не принял.
   *
   * Это НЕ лимит — ждать бессмысленно, через минуту он не оживёт.
   * Причины обычно скучные: скопировали не целиком, ключ удалили,
   * или в проекте не включён Generative Language API.
   * Убираем такой ключ из ротации до перезапуска.
   */
  markDead(reason: string): void {
    const key = this.keys[this.currentIndex]!;
    const wasNumber = this.currentIndex + 1;

    // Про этот ключ уже всё сказано — второй раз не шумим
    // (параллельные запросы легко налетают на один и тот же битый ключ)
    if (this.dead.has(key)) {
      if (!this.allDead()) this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      return;
    }

    this.dead.add(key);
    console.error(`   💀 Ключ #${wasNumber} выбывает из ротации: ${reason}`);

    if (this.allDead()) {
      console.error('   💀 Рабочих ключей не осталось. Проверь .env и перезапусти.');
      return;
    }

    this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    console.log(`   🔄 Переключаюсь на ключ #${this.currentIndex + 1}`);
  }

  /** Все ключи оказались нерабочими — ждать нечего, надо чинить .env */
  allDead(): boolean {
    return this.dead.size >= this.keys.length;
  }

  /**
   * Сколько миллисекунд ждать, пока освободится хоть один ключ.
   * 0 — значит свободный ключ есть прямо сейчас.
   */
  getWaitTime(): number {
    const now = Date.now();
    let minWait = Infinity;

    for (const key of this.keys) {
      if (this.dead.has(key)) continue;

      const restingUntil = this.cooldownUntil.get(key) || 0;
      if (now >= restingUntil) return 0;
      minWait = Math.min(minWait, restingUntil - now);
    }

    return minWait === Infinity ? 0 : minWait;
  }

  /** Сколько ключей готово к работе прямо сейчас */
  getAvailableCount(): number {
    const now = Date.now();
    return this.keys.filter(k => !this.dead.has(k) && now >= (this.cooldownUntil.get(k) || 0)).length;
  }

  /** Сколько ключей выбыло насовсем */
  getDeadCount(): number {
    return this.dead.size;
  }

  getKeyCount(): number {
    return this.keys.length;
  }

  /**
   * Сброс всех cooldown.
   *
   * Вызывается при переходе на СЛЕДУЮЩУЮ модель каскада.
   * Причина: лимит у Google привязан к паре «проект + модель», а не к ключу
   * вообще. Ключ, выжатый на gemini-3.8-flash, на gemini-3.6-flash
   * абсолютно свеж — глупо держать его в отдыхе.
   */
  resetCooldowns(): void {
    // Битые ключи при этом НЕ воскресают: они битые для любой модели.
    this.cooldownUntil.clear();
  }

  /** Статистика: сколько запросов вытянул каждый ключ */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (let i = 0; i < this.keys.length; i++) {
      stats[`Ключ #${i + 1}`] = this.usageCounts.get(this.keys[i]!) || 0;
    }
    return stats;
  }

  /** Красивая таблица статистики для консоли */
  printStats(): void {
    console.log('\n   📊 Использование ключей:');
    const stats = this.getStats();
    const max = Math.max(1, ...Object.values(stats));

    let i = 0;
    for (const [name, count] of Object.entries(stats)) {
      const barLength = Math.round((count / max) * 24);
      const bar = '█'.repeat(barLength).padEnd(24, '·');
      const mark = this.dead.has(this.keys[i]!) ? ' 💀 битый' : '';
      console.log(`      ${name.padEnd(10)} ${bar} ${count}${mark}`);
      i++;
    }
  }
}
