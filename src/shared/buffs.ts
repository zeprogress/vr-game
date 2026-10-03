import { CAMPFIRE, EVENT } from "./constants";
import type { IconKey } from "./icons";
import { FX_RGB, rgbHex, type FxColor } from "./look";
import { SCROLL } from "./shop";
import { ABYSS, PLAGUE, SMOKE } from "./classes2";

/**
 * Баффы героя — ОДНА таблица на всё: значок и строка в списке баффов (рамка
 * героя ПК/телефона, «смотрим» у спектатора, строка в VR) и светящиеся
 * фигурки, кружащие вокруг героя (BuffOrbitFx). Цвет — из палитры shared/look.ts.
 */
export type BuffId = "victory" | "camp" | "scrollXp" | "scrollWind" | "plague" | "abyss" | "smoke";
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
  // ---- 🧪 умения ассасина: видно, что умение работает ----
  plague: {
    name: "Чумной клинок",
    desc: `удары отравляют (до ${PLAGUE.maxStacks} стаков, на ${PLAGUE.maxStacks} — взрыв яда)`,
    icon: "s.plague",
    color: "poison",
    shape: "sword",
    size: 0.42,
    slot: 4,
  },
  abyss: {
    name: "Призрак бездны",
    desc: `мобы тебя не видят; первый удар ×2 и крит, затем +${Math.round(ABYSS.haste * 100)}% темпа`,
    icon: "s.abyss",
    color: "shadowDark",
    shape: "boot",
    size: 0.42,
    slot: 5,
  },
  smoke: {
    name: "Пелена смерти",
    desc: `в дыму: +${Math.round(SMOKE.dodge * 100)}% уворота, мобы мажут, стрелки не видят`,
    icon: "s.smoke",
    color: "shadow",
    shape: "shield",
    size: 0.42,
    slot: 6,
  },
};

/** Порядок в списке баффов. */
export const BUFF_ORDER: readonly BuffId[] = ["abyss", "plague", "smoke", "victory", "camp", "scrollXp", "scrollWind"];

/** Цвет баффа для HTML/CSS. */
export function buffHex(id: BuffId): string {
  return rgbHex(FX_RGB[BUFFS[id].color]);
}
