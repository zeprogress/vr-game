import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { ClassId, SkillId } from "../../shared/classes2";
import { classAnimSet, type ClassAnimSet } from "./classPoses";

/**
 * Клипы боя, сделанные под конкретную модель (сейчас — Человек, tools/blender/human/moves.py): стойка с оружием,
 * несколько вариантов атаки на каждое оружие (игра берёт случайный, без повтора подряд) и клипы умений.
 * У моделей без этих клипов всё как раньше — процедурные клипы классов (classPoses).
 */

type MoveKind = "sword" | "dagger" | "spear" | "hammer" | "bow" | "staff";

const VARIANTS: Record<MoveKind, number> = { sword: 4, dagger: 3, spear: 3, hammer: 3, bow: 2, staff: 3 };

/** Все имена (для списков весов в аватарах). */
export const HERO_MOVE_CLIPS: readonly string[] = (() => {
  const out: string[] = [];
  for (const [k, n] of Object.entries(VARIANTS) as [MoveKind, number][]) {
    out.push(`stance${k}`);
    for (let i = 1; i <= n; i++) {
      if (k === "dagger") out.push(`atkdaggerr${i}`, `atkdaggerl${i}`);
      else out.push(`atk${k}${i}`);
    }
  }
  out.push(...new Set(Object.values(skillClipTable())));
  return out;
})();

/** Разовые (атаки и умения) — всё, кроме стоек. */
export const HERO_MOVE_ONE_SHOT: ReadonlySet<string> = new Set(HERO_MOVE_CLIPS.filter((n) => !n.startsWith("stance")));

/** Умения всем телом (на бегу ноги тоже их): вращения, прыжок, присед к земле. Остальные на бегу — корпусом. */
export const HERO_MOVE_FULL_BODY: ReadonlySet<string> = new Set(["skwhirlwind", "skcrush", "sksweep", "skseal"]);

function kindOf(left: string, right: string): MoveKind | null {
  const h = [left, right];
  if (h.includes("spear")) return "spear";
  if (h.includes("hammer")) return "hammer";
  if (h.includes("staff")) return "staff";
  if (h.includes("bow")) return "bow";
  if (h.includes("dagger") && !h.includes("sword")) return "dagger";
  if (h.includes("sword")) return "sword";
  return null;
}

/**
 * Стойка и удары для того, что в руках. Есть свои клипы у модели — они (attacks — варианты), иначе classAnimSet.
 * У двух кинжалов вторая рука — alts.
 */
export function heroAnimSet(anims: Map<string, AnimationGroup> | undefined, left: string, right: string): ClassAnimSet | null {
  const kind = kindOf(left, right);
  if (anims && kind && anims.has(`stance${kind}`)) {
    const list = (pre: string): string[] => {
      const out: string[] = [];
      for (let i = 1; i <= VARIANTS[kind]; i++) if (anims.has(`${pre}${i}`)) out.push(`${pre}${i}`);
      return out;
    };
    const attacks = list(kind === "dagger" ? "atkdaggerr" : `atk${kind}`);
    if (attacks.length) {
      const two = kind === "dagger" && left === "dagger" && right === "dagger";
      const alts = two ? list("atkdaggerl") : undefined;
      return { idle: `stance${kind}`, attack: attacks[0], attacks, alt: alts?.[0], alts };
    }
  }
  return classAnimSet(left, right);
}

/** Случайный вариант удара (не тот же, что прошлый). */
export function pickVariant(list: readonly string[] | undefined, fallback: string, last: string): string {
  if (!list || list.length === 0) return fallback;
  if (list.length === 1) return list[0];
  let n = list[Math.floor(Math.random() * list.length)];
  if (n === last) n = list[(list.indexOf(n) + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length];
  return n;
}

/** Клип умения: сначала свой у класса, потом общий. Ключ класса — `${skill}:${cls}`. */
function skillClipTable(): Record<string, string> {
  return {
    cleave: "skcleave",
    whirlwind: "skwhirlwind",
    "whirlwind:spearman": "skflurry",
    "whirlwind:battlemage": "skwhirlwind",
    "stunBash:warrior": "skstunbash",
    "stunBash:spearman": "sksweep",
    warcry: "skwarcry",
    "warcry:support": "skmassheal",
    seal: "skseal",
    "seal:support": "skcaststaff",
    steelAura: "skwarcry",
    drawIn: "skseal",
    crush: "skcrush",
    chain: "skchain",
    massHeal: "skmassheal",
    "arrowRain:archer": "skarrowrain",
    "arrowRain:support": "skcaststaff",
    "arrowRain:assassin": "skthrow",
    "arrowRain:spearman": "skspearcall",
    arrowStorm: "skarrowrain",
    mark: "skaim",
    lifeArrow: "skaim",
    blastArrow: "skaim",
    ghostArrow: "skaim",
    swarmArrow: "skaim",
    barrierArrow: "skaim",
    webArrow: "skaim",
    plague: "skcrosscut",
    smoke: "skthrow",
    soulSteal: "skcrosscut",
    abyss: "skcrosscut",
  };
}
const SKILL_CLIP = skillClipTable();

/** Имя клипа умения у этой модели или null (нет клипа — играем как раньше: замах, прыжок, кувырок). */
export function heroSkillClip(anims: Map<string, AnimationGroup> | undefined, skill: SkillId | string, cls: ClassId | null): string | null {
  const name = (cls && SKILL_CLIP[`${skill}:${cls}`]) || SKILL_CLIP[skill];
  return name && anims?.has(name) ? name : null;
}
