import { PLAYER, PLAYER_HP, PROGRESSION } from "#shared/constants";

export type StatName = "str" | "agi" | "int";

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
    if (level >= PROGRESSION.maxLevel) return Infinity;
    return PROGRESSION.baseXp * Math.pow(2, level - 1);
  }

  get atMaxLevel(): boolean {
    return this.level >= PROGRESSION.maxLevel;
  }

  addXp(amount: number): void {
    if (this.atMaxLevel) return;
    this.xp += amount;
    while (!this.atMaxLevel && this.xp >= this.xpToNext()) {
      this.xp -= this.xpToNext();
      this.level++;
      this.unspent += PROGRESSION.statPointsPerLevel;
      this.onLevelUp?.(this.level);
    }
    if (this.atMaxLevel) this.xp = 0;
    this.save();
    this.emit();
  }

  /** Потратить очко на характеристику. true — получилось. */
  spend(stat: StatName): boolean {
    if (this.unspent <= 0) return false;
    this.unspent--;
    this.stats[stat]++;
    this.save();
    this.emit();
    return true;
  }

  // ---- производные величины ----

  get maxHp(): number {
    return PLAYER_HP.max + (this.stats.str - PROGRESSION.startStat) * PROGRESSION.hpPerStr;
  }

  /** Множитель/добавка урона мечом (базовый удар = 1). */
  get swordDamage(): number {
    return 1 + (this.stats.str - PROGRESSION.startStat) * PROGRESSION.swordDamagePerStr;
  }

  get moveSpeed(): number {
    return PLAYER.runSpeed + (this.stats.agi - PROGRESSION.startStat) * PROGRESSION.moveSpeedPerAgi;
  }

  /** Добавка к скорости стрелы, м/с. */
  get arrowSpeedBonus(): number {
    return (this.stats.agi - PROGRESSION.startStat) * PROGRESSION.arrowSpeedPerAgi;
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

  /** Применить прогресс, пришедший с сервера (серверный сейв главнее). */
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
