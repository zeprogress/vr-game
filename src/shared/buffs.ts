import { CAMPFIRE, EVENT } from "./constants";
import type { IconKey } from "./icons";
import { FX_RGB, rgbHex, type FxColor } from "./look";
import { SCROLL } from "./shop";

/**
 * Баффы героя — ОДНА таблица на всё: значок и строка в списке баффов (рамка
 * героя ПК/телефона, «смотрим» у спектатора, строка в VR) и светящиеся
 * фигурки, кружащие вокруг героя (BuffOrbitFx). Цвет — из палитры shared/look.ts.
 */
export type BuffId = "victory" | "camp" | "scrollXp" | "scrollWind";
/** Форма фигурки вокруг героя. */
export type BuffShape = "shield" | "sword" | "boot" | "arrow";

export interface BuffDef {
  name: string;
  desc: string;
  icon: IconKey;
  color: FxColor;
  /** Фигурка: форма, размер (м) и сдвиг по кругу (доля 1/12 оборота). */
  shape: BuffShape;
  size: number;
  slot: number;
}

export const BUFFS: Record<BuffId, BuffDef> = {
  victory: {
    name: "Благословение победы",
    desc: `×${EVENT.invasion.buffXpMult} опыта и ×${EVENT.invasion.buffDmgMult} урона`,
    icon: "b.victory",
    color: "buffVictory",
    shape: "sword",
    size: 0.5,
    slot: 0,
  },
  scrollWind: {
    name: "Свиток ветра",
    desc: `+${Math.round((SCROLL.windMul - 1) * 100)}% скорости бега`,
    icon: "b.scrollWind",
    color: "buffScrollWind",
    shape: "boot",
    size: 0.4,
    slot: 1,
  },
  camp: {
    name: "Тепло костра",
    desc: `−${Math.round(CAMPFIRE.buffDef * 100)}% входящего урона`,
    icon: "b.camp",
    color: "buffCamp",
    shape: "shield",
    size: 0.42,
    slot: 2,
  },
  scrollXp: {
    name: "Свиток мудрости",
    desc: `×${SCROLL.xpMul} опыта`,
    icon: "b.scrollXp",
    color: "buffScrollXp",
    shape: "arrow",
    size: 0.42,
    slot: 3,
  },
};

/** Порядок в списке баффов. */
export const BUFF_ORDER: readonly BuffId[] = ["victory", "camp", "scrollXp", "scrollWind"];

/** Цвет баффа для HTML/CSS. */
export function buffHex(id: BuffId): string {
  return rgbHex(FX_RGB[BUFFS[id].color]);
}
