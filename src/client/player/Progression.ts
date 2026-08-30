import { PROGRESSION } from "#shared/constants";
import {
  arrowSpeedBonusFor,
  atMaxLevel,
  grantXp,
  maxHpFor,
  moveSpeedFor,
  spendPoint,
  swordDamageFor,
  xpToNext as xpToNextFor,
  type Progress,
  type StatName,
} from "#shared/progression";

export type { StatName };

export const STAT_LABELS: Record<StatName, string> = {
  str: "Сила",
  agi: "Ловкость",
  int: "Интеллект",
};

const SAVE_KEY = "progression";

/**
 * Уровни, опыт и характеристики игрока.
 *
 * Опыт до следующего уровня удваивается: 1 -> 2 нужно 1 очко, 2 -> 3 нужно 2,
 * 3 -> 4 нужно 4 и так далее до 100 уровня.
 */
export class Progression {
  level = 1;
  /** Накоплено опыта внутри текущего уровня. */
  xp = 0;
  unspent = 0;
  readonly stats: Record<StatName, number> = {
    str: PROGRESSION.startStat,
    agi: PROGRESSION.startStat,
    int: PROGRESSION.startStat,
  };

  /** Дёргается при повышении уровня. */
  onLevelUp: ((level: number) => void) | null = null;
  /**
   * Онлайн: прокачку считает сервер. spend() только шлёт заявку, а результат
   * прилетает обратно в applyRemote(). Офлайн — null, всё считается локально.
   */
  onSpendRequest: ((stat: StatName) => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.load();
  }

  /** Подписка на изменения (уровень / опыт / характеристики). Возвращает отписку. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** Сколько опыта нужно для перехода с `level` на следующий. */
  xpToNext(level = this.level): number {
    return xpToNextFor(level);
  }

  get atMaxLevel(): boolean {
    return atMaxLevel(this.level);
  }

  /** Офлайн-начисление опыта. Онлайн опыт приходит из состояния сервера. */
  addXp(amount: number): void {
    const p = this.toProgress();
    const levels = grantXp(p, amount);
    this.fromProgress(p);
    for (let i = 0; i < levels; i++) this.onLevelUp?.(this.level - levels + 1 + i);
    this.save();
    this.emit();
  }

  /** Потратить очко на характеристику. true — заявка принята. */
  spend(stat: StatName): boolean {
    if (this.unspent <= 0) return false;
    if (this.onSpendRequest) {
      // Онлайн: решает сервер, ответ придёт в applyRemote().
      this.onSpendRequest(stat);
      return true;
    }
    const p = this.toProgress();
    if (!spendPoint(p, stat)) return false;
    this.fromProgress(p);
    this.save();
    this.emit();
    return true;
  }

  private toProgress(): Progress {
    return {
      level: this.level,
      xp: this.xp,
      unspent: this.unspent,
      str: this.stats.str,
      agi: this.stats.agi,
      int: this.stats.int,
    };
  }

  private fromProgress(p: Progress): void {
    this.level = p.level;
    this.xp = p.xp;
    this.unspent = p.unspent;
    this.stats.str = p.str;
    this.stats.agi = p.agi;
    this.stats.int = p.int;
  }

  // ---- производные величины ----

  get maxHp(): number {
    return maxHpFor(this.stats.str);
  }

  /** Множитель/добавка урона мечом (базовый удар = 1). */
  get swordDamage(): number {
    return swordDamageFor(this.stats.str);
  }

  get moveSpeed(): number {
    return moveSpeedFor(this.stats.agi);
  }

  /** Добавка к скорости стрелы, м/с. */
  get arrowSpeedBonus(): number {
    return arrowSpeedBonusFor(this.stats.agi);
  }

  // ---- сохранение ----

  private save(): void {
    try {
      localStorage.setItem(
        SAVE_KEY,
        JSON.stringify({ level: this.level, xp: this.xp, unspent: this.unspent, stats: this.stats }),
      );
    } catch {
      /* приватный режим */
    }
  }

  private load(): void {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null");
      if (!d) return;
      this.level = clampInt(d.level, 1, PROGRESSION.maxLevel);
      this.xp = Math.max(0, Number(d.xp) || 0);
      this.unspent = Math.max(0, Number(d.unspent) || 0);
      for (const k of ["str", "agi", "int"] as StatName[]) {
        this.stats[k] = clampInt(d.stats?.[k], PROGRESSION.startStat, 999);
      }
    } catch {
      /* битые данные — играем с нуля */
    }
  }

  reset(): void {
    this.level = 1;
    this.xp = 0;
    this.unspent = 0;
    this.stats.str = this.stats.agi = this.stats.int = PROGRESSION.startStat;
    this.save();
    this.emit();
  }

  // ---- сеть (этап 5) ----

  /** Снимок для отправки серверу. */
  snapshot(): { level: number; xp: number; unspent: number; str: number; agi: number; int: number } {
    return {
      level: this.level,
      xp: this.xp,
      unspent: this.unspent,
      str: this.stats.str,
      agi: this.stats.agi,
      int: this.stats.int,
    };
  }

  /** Применить прогресс, пришедший с сервера. Онлайн это единственный источник. */
  applyRemote(d: {
    level: number;
    xp: number;
    unspent: number;
    str: number;
    agi: number;
    int: number;
  }): void {
    this.level = clampInt(d.level, 1, PROGRESSION.maxLevel);
    this.xp = Math.max(0, Number(d.xp) || 0);
    this.unspent = Math.max(0, Math.floor(Number(d.unspent) || 0));
    this.stats.str = clampInt(d.str, PROGRESSION.startStat, 999);
    this.stats.agi = clampInt(d.agi, PROGRESSION.startStat, 999);
    this.stats.int = clampInt(d.int, PROGRESSION.startStat, 999);
    this.save(); // зеркалим в localStorage для офлайна
    this.emit();
  }
}

function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}
