/**
 * Ультимейты классов: `!ульта` в чате — раз в ULT_COOLDOWN на героя. Долгий замах
 * (кольцо на земле видно всем в зоне), потом массовый удар по большому кругу.
 * Каст не прерывается уроном. Числа условные — подгоняются в лаборатории баланса.
 */
import type { ClassId } from "./classes2";

/** Откат ульты на героя, с. */
export const ULT_COOLDOWN = 15 * 60;

export interface UltDef {
  name: string;
  desc: string;
  /** Замах, с — кольцо на земле видно всем. */
  cast: number;
  /** Радиус круга вокруг героя, м. */
  radius: number;
  /** Множитель урона (от силы умения героя): за удар/залп/тик — см. ZoneRoom.applyUlt. */
  dmgMult: number;
}

export const ULTS: Record<ClassId, UltDef> = {
  warrior: { name: "Гнев титана", desc: "Удар по земле: круг 18 м, ×6 урона, оглушение 3 с", cast: 5, radius: 18, dmgMult: 6 },
  archer: { name: "Стрелы хаоса", desc: "Три залпа по кругу 22 м, каждый ×2.5, враги пригвождены", cast: 6, radius: 22, dmgMult: 2.5 },
  support: { name: "Священный ореол", desc: "Союзники в круге 20 м лечатся на 50% здоровья, враги получают ×2 магией и замедляются", cast: 6, radius: 20, dmgMult: 2 },
  assassin: { name: "Тень смерти", desc: "Двенадцать ударов кинжалами по врагам в круге 15 м, каждый с гарантированным критом", cast: 4, radius: 15, dmgMult: 0.5 },
  spearman: { name: "Землеразрыв", desc: "Копьё в землю: круг 30 м, ×5 урона, враги стягиваются к герою и оглушаются на 2 с", cast: 5, radius: 30, dmgMult: 5 },
  battlemage: { name: "Метеорит", desc: "Метеорит в круг 25 м: магия ×8 и горение 6 с", cast: 7, radius: 25, dmgMult: 8 },
};

/** Доля здоровья, которую ореол возвращает союзникам. */
export const ULT_HEAL_FRAC = 0.5;
/** Залпы «Стрел хаоса» и удары «Тени смерти». */
export const ULT_ARCHER_WAVES = 3;
export const ULT_ASSASSIN_HITS = 12;
export const ULT_ASSASSIN_STEP = 0.15;
/** Горение метеорита, с. */
export const ULT_BURN_SEC = 6;
