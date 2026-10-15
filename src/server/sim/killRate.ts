/**
 * Счётчик «убийств в минуту» героя (PlayerState.kpm, карточка «смотрим» у спектатора).
 * Без истории: две корзины по 60 с — текущая минута и прошлая. Окно «последние 60 с»
 * = текущая + прошлая × доля прошлой минуты, что ещё в окне. Три числа на героя;
 * герой без убийств за минуту выпадает. На диск не пишется.
 */
const WINDOW_SEC = 60;

interface Bucket {
  /** Номер минуты (секунды / 60), к которой относится cur. */
  win: number;
  cur: number;
  prev: number;
}

function roll(b: Bucket, nowSec: number): void {
  const w = Math.floor(nowSec / WINDOW_SEC);
  if (w === b.win) return;
  b.prev = w === b.win + 1 ? b.cur : 0;
  b.cur = 0;
  b.win = w;
}

export class KillRates {
  private readonly byHero = new Map<string, Bucket>();

  /** Засчитать убийство герою (nowSec — Date.now() / 1000). */
  add(hero: string, nowSec: number): void {
    let b = this.byHero.get(hero);
    if (!b) this.byHero.set(hero, (b = { win: Math.floor(nowSec / WINDOW_SEC), cur: 0, prev: 0 }));
    roll(b, nowSec);
    b.cur++;
  }

  /** Убийств за последние 60 с по каждому герою; опустевшие записи отдают 0 и удаляются. */
  each(nowSec: number, fn: (hero: string, perMin: number) => void): void {
    for (const [hero, b] of this.byHero) {
      roll(b, nowSec);
      const f = nowSec / WINDOW_SEC - b.win;
      if (b.cur === 0 && b.prev === 0) this.byHero.delete(hero);
      fn(hero, Math.round(b.cur + b.prev * (1 - f)));
    }
  }
}
