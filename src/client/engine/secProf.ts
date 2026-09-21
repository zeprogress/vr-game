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
  times: {} as Record<string, number>,
};

/** Старт замера подсекции (0, если диагностика выключена). */
export function secNow(): number {
  return SEC.on ? performance.now() : 0;
}

/** Закончить замер подсекции `name`, начатый `secNow()`. */
export function secAdd(name: string, t0: number): void {
  if (!SEC.on) return;
  const dt = performance.now() - t0;
  const cur = SEC.times[name];
  SEC.times[name] = cur === undefined ? dt : cur * 0.9 + dt * 0.1;
}

/** Топ подсекций по времени: `имя:мс`. */
export function secReport(top = 24): string {
  return Object.entries(SEC.times)
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, v]) => `${k}:${v.toFixed(2)}`)
    .join(" ");
}
