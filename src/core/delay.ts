/** Пауза на указанное число секунд. */
export function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, seconds) * 1000));
}

/** Случайная пауза в диапазоне — чтобы бот не отвечал с точностью робота. */
export function sleepRandom(minSec: number, maxSec: number): Promise<void> {
  return sleep(minSec + Math.random() * (maxSec - minSec));
}
