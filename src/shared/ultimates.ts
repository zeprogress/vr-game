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
  warrior: { name: "Гнев титана", desc: "Удар по земле: круг 22 м, ×8 урона, оглушение 5 с", cast: 5, radius: 22, dmgMult: 8 },
  archer: { name: "Стрелы хаоса", desc: "Три залпа по кругу 26 м, каждый ×3.5, враги пригвождены на 5 с", cast: 6, radius: 26, dmgMult: 3.5 },
  support: { name: "Священный ореол", desc: "Союзники в круге 24 м лечатся на 50% здоровья, враги получают ×2.5 магией и замедляются на 6 с", cast: 6, radius: 24, dmgMult: 2.5 },
  assassin: { name: "Тень смерти", desc: "Шестнадцать ударов кинжалами по врагам в круге 18 м, каждый с гарантированным критом", cast: 4, radius: 18, dmgMult: 0.7 },
  spearman: { name: "Землеразрыв", desc: "Копьё в землю: круг 34 м, ×7 урона, враги стягиваются к герою и оглушаются на 3 с", cast: 5, radius: 34, dmgMult: 7 },
  battlemage: { name: "Метеорит", desc: "Метеорит в круг 29 м: магия ×10 и горение 10 с", cast: 7, radius: 29, dmgMult: 10 },
};

/** Доля здоровья, которую ореол возвращает союзникам. */
export const ULT_HEAL_FRAC = 0.5;
/** Залпы «Стрел хаоса» и удары «Тени смерти». */
export const ULT_ARCHER_WAVES = 3;
export const ULT_ASSASSIN_HITS = 16;
export const ULT_ASSASSIN_STEP = 0.15;
/** Горение метеорита, с. */
export const ULT_BURN_SEC = 10;
