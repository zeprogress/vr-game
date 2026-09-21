/**
 * Лёгкая покадровая диагностика «куда уходят миллисекунды» по подсекциям кода.
 * Выключена по умолчанию: тогда `secNow()` возвращает 0, а `secAdd()` сразу выходит (одна проверка флага —
 * стоимость неизмерима). Включается `?sec=1` (или `?perf=1`); отчёт — `game.secReport()` в консоли или
 * строка `subSections` в `game.vrDiag()`. Значения — сглаженные миллисекунды на кадр.
 */
export const SEC = {
  on:
    typeof location !== "undefined" &&
    (new URLSearchParams(location.search).has("sec") || new URLSearchParams(location.search).has("perf")),
  /** Сглаженные мс НА КАДР (редкие подсекции усредняются по всем кадрам, а не по своим вызовам). */
  times: {} as Record<string, number>,
  /** Накоплено за текущий кадр. */
  acc: {} as Record<string, number>,
};

/** Старт замера подсекции (0, если диагностика выключена). */
export function secNow(): number {
  return SEC.on ? performance.now() : 0;
}

/** Закончить замер подсекции `name`, начатый `secNow()`. */
export function secAdd(name: string, t0: number): void {
  if (!SEC.on) return;
  SEC.acc[name] = (SEC.acc[name] ?? 0) + (performance.now() - t0);
}

/** Конец кадра: свернуть накопленное в скользящее среднее по кадрам (вызывает Game). */
export function secEndFrame(): void {
  if (!SEC.on) return;
  for (const k of Object.keys(SEC.acc)) {
    const cur = SEC.times[k] ?? 0;
    SEC.times[k] = cur * 0.97 + SEC.acc[k] * 0.03;
    SEC.acc[k] = 0;
  }
}

/** Топ подсекций по времени: `имя:мс`. */
export function secReport(top = 24): string {
  return Object.entries(SEC.times)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(" ");
}
