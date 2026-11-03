import type { ClassId } from "#shared/classes2";
import type { ModelName } from "../world/models";
import type { NewWeapon } from "../items/classWeapons";

/**
 * Одна раскладка класса для всех сцен лаборатории (баланс и полигон умений):
 * какая модель, что в руках, каким клипом бьёт и с какой доли клипа приходит удар.
 * Раньше это лежало только в sceneClasses — вторая сцена скопировала бы числа и разъехалась.
 */
export type Kind = "sword" | "shield" | "bow" | "staff" | NewWeapon;

export const HERO_MODEL: Record<ClassId, ModelName> = {
  warrior: "charKnight",
  archer: "charCowboy",
  support: "charWizard",
  assassin: "charNinja",
  spearman: "charSoldier",
  battlemage: "charViking",
};
export const HERO_H = 1.8;

/** Что в руках у класса. */
export function gearOf(c: ClassId, dual: boolean): { R?: Kind; L?: Kind } {
  switch (c) {
    case "warrior": return { R: "sword", L: "shield" };
    case "archer": return { L: "bow" };
    case "support": return { R: "staff" };
    case "assassin": return dual ? { R: "dagger", L: "dagger" } : { R: "dagger" };
    case "spearman": return { R: "spear" };
    case "battlemage": return { R: "hammer" };
  }
}

export const IDLE: Record<ClassId, string> = {
  warrior: "idle", archer: "bowidle", support: "idle", assassin: "daggeridle", spearman: "spearidle", battlemage: "hammeridle",
};

/** Клип атаки и доля клипа, на которой удар «доходит». */
export const ATTACK: Record<ClassId, [string, number]> = {
  warrior: ["swordslash", 0.45],
  archer: ["bowshoot", 0.6],
  support: ["onehanded", 0.5],
  assassin: ["daggerstabr", 0.3],
  spearman: ["spearthrust", 0.42],
  battlemage: ["hammerslam", 0.5],
};
