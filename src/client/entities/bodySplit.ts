import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Animation } from "@babylonjs/core/Animations/animation";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CLASS_ONE_SHOT } from "../world/classPoses";
import { HERO_MOVE_FULL_BODY, HERO_MOVE_ONE_SHOT } from "../world/heroMoves";

/**
 * Разделение тела героя на ноги и корпус — один код для своего героя (LocalAvatar) и чужих (RemoteAvatar).
 *
 * На бегу корпус играет действие (удар, выстрел, урон, подбор), а ноги — бег или шаг: иначе клип действия
 * на всё тело подменял шаги, и герой «скользил» по земле. Стоит — действие всем телом, как раньше.
 * Веса задаются по костям: у группы клипа Babylon по animatable на кость, вес у каждого свой.
 */

/**
 * Кости ног и корня скелета героя (CharacterArmature): Bone → Body → ноги; стопы и PoleTarget — IK-цели от корня.
 * Остальное (Hips → Abdomen → Torso → руки, голова, оружие) — корпус.
 */
const LEG_BONES = new Set(["Bone", "Body", "UpperLeg.L", "UpperLeg.R", "LowerLeg.L", "LowerLeg.R", "Foot.L", "Foot.R", "PoleTarget.L", "PoleTarget.R"]);

/**
 * Кость ног? У Человека ноги растут из Hips (у пака — из Body рядом с Hips): там и таз — ноги, иначе действие
 * корпусом поворачивало таз, а с ним и бегущие ноги.
 */
function isLeg(target: unknown): boolean {
  const t = target as { name?: string; getChildren?: () => { name: string }[] } | null;
  const name = t?.name ?? "";
  if (LEG_BONES.has(name)) return true;
  return name === "Hips" && !!t?.getChildren?.().some((c) => c.name === "UpperLeg.L");
}

/** Разовые клипы, которые на бегу играют только корпусом. Эмоции, кувырок и прыжок — всем телом. */
const UPPER_ACTION_CLIPS = new Set<string>([
  ...CLASS_ONE_SHOT,
  ...[...HERO_MOVE_ONE_SHOT].filter((n) => !HERO_MOVE_FULL_BODY.has(n)),
  "swordslash",
  "recievehit",
  "pickup",
]);

/** Клип для ног: на бегу при действии корпусом — бег или шаг, иначе тот же, что у корпуса. */
export function legClip(want: string, move: boolean, run: boolean): string {
  return move && UPPER_ACTION_CLIPS.has(want) ? (run ? "run" : "walk") : want;
}

/** Применить веса клипа: ногам — `legs`, корпусу — `upper` (равны — одним вызовом на всё тело). */
export function applySplitWeight(g: AnimationGroup, legs: number, upper: number): void {
  if (legs === upper) {
    g.setWeightForAllAnimatables(legs);
    return;
  }
  for (const a of g.animatables) a.weight = isLeg(a.target) ? legs : upper;
}

/**
 * Веса только что запущенного разового клипа: на бегу действие сразу берёт корпус, ноги не трогает
 * (иначе на долю секунды ноги замирали бы в позе удара); стоя — всё тело на полный вес.
 */
export function startSplitWeight(
  g: AnimationGroup, name: string, moving: boolean, legsW: Map<string, number>, upperW: Map<string, number>,
): void {
  upperW.set(name, 1);
  if (!moving || !UPPER_ACTION_CLIPS.has(name)) legsW.set(name, 1);
  applySplitWeight(g, legsW.get(name) ?? 0, 1);
}

/**
 * Шаг смешивания одного клипа к целям «ноги — wantLegs, корпус — wantUpper». Возвращает новые веса;
 * старт и остановку группы решает вызывающий (у аватаров свои правила перезапуска разовых клипов).
 */
export function blendSplit(
  name: string, wantLegs: string, wantUpper: string, k: number, legsW: Map<string, number>, upperW: Map<string, number>,
): { legs: number; upper: number } {
  let w = legsW.get(name) ?? 0;
  let wu = upperW.get(name) ?? w;
  w += ((name === wantLegs ? 1 : 0) - w) * k;
  wu += ((name === wantUpper ? 1 : 0) - wu) * k;
  if (w <= 0.003) w = 0;
  if (wu <= 0.003) wu = 0;
  legsW.set(name, w);
  upperW.set(name, wu);
  return { legs: w, upper: wu };
}

/**
 * Родная скорость клипов шага и бега героя (м/с) при масштабе модели 0.52: с какой скоростью стопа уезжает назад,
 * пока стоит на земле. Измерено по Foot.L в Knight_Male.glb (клипы общие у всех скинов CharacterArmature):
 * шаг 2.19 ед/с, бег 4.36 ед/с × 0.52. Unity (HeroRig.cs) держит те же числа.
 */
export const HERO_STRIDE = { walk: 1.14, run: 2.27 } as const;

/** Темп клипа шага/бега, чтобы ноги перебирали со скоростью движения (без скольжения). */
export function legRate(clip: "walk" | "run", speed: number): number {
  return Math.max(0.5, Math.min(2.5, speed / HERO_STRIDE[clip]));
}

/** Скелет, где ноги растут из Hips (Человек): там шаг и бег — одним клипом всего тела в темпе ног. */
const legsOnHips = new WeakMap<AnimationGroup, boolean>();
function wholeBodyGait(g: AnimationGroup): boolean {
  let v = legsOnHips.get(g);
  if (v === undefined) {
    v = g.targetedAnimations.some((ta) => {
      const t = ta.target as { name?: string } | null;
      return t?.name === "Hips" && isLeg(t);
    });
    legsOnHips.set(g, v);
  }
  return v;
}

/**
 * Темп шага/бега только ногам (кости LEG_BONES); корпус (руки, голова) — в родном темпе клипа,
 * чтобы на быстром беге руки не мельтешили. Группу держим на 1: её speedRatio перетирал бы кости.
 * У Человека (ноги из Hips) — всё тело в темпе ног: руки и ноги клипа Mixamo идут в такт друг другу.
 */
export function applyLegRate(g: AnimationGroup, rate: number): void {
  if (g.speedRatio !== 1) g.speedRatio = 1;
  const all = wholeBodyGait(g);
  for (const a of g.animatables) a.speedRatio = all || isLeg(a.target) ? rate : 1;
}

/**
 * Высота кости Body (ед. модели) на шаге и беге: одна и та же, близко к стойке (Idle 0.965–1.002). В клипах
 * корпус ходил вверх-вниз (бег 0.681–1.007, шаг 0.851–1.000), а бег стоял на 14 см ниже стойки — на каждой смене
 * стойка/шаг/бег (боты меняют их постоянно) герой проседал и поднимался. Unity (HeroRig.cs) держит то же число.
 */
export const LOCO_BODY_Y = 0.93;

/** Доля исходного подпрыгивания на шаге и беге (вокруг LOCO_BODY_Y): 0 — ровно, 1 — как в клипе. Unity — то же. */
export const LOCO_BOUNCE = 0.25;

/** Середина высоты Body в Idle у скелета Quaternius (0.965–1.002) — к ней отнесено LOCO_BODY_Y. */
const QUAT_IDLE_BODY_Y = 0.9835;

/** Середина высоты Body в клипе (null — у клипа нет сдвига Body). */
function bodyMidY(g: AnimationGroup | undefined): number | null {
  for (const ta of g?.targetedAnimations ?? []) {
    if ((ta.target as { name?: string } | null)?.name !== "Body" || ta.animation.targetProperty !== "position") continue;
    const ys = ta.animation.getKeys().map((k) => (k.value as Vector3).y);
    return (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  return null;
}

/**
 * Подпрыгивание в клипах шага и бега: высота Body — LOCO_BODY_Y плюс LOCO_BOUNCE исходного размаха. LOCO_BODY_Y —
 * в долях стойки Quaternius: у скелета другого размера (Человек — таз на 0.56) берём ту же долю от его Idle.
 * Ключи у клонов модели бывают общими — помечаем анимацию и правим один раз.
 */
export function dampRunBounce(anims: Map<string, AnimationGroup>): void {
  const idleY = bodyMidY(anims.get("idle"));
  const bodyY = idleY === null ? LOCO_BODY_Y : (idleY * LOCO_BODY_Y) / QUAT_IDLE_BODY_Y;
  for (const name of ["run", "walk"]) {
    const g = anims.get(name);
    if (!g) continue;
    for (const ta of g.targetedAnimations) {
      if ((ta.target as { name?: string } | null)?.name !== "Body" || ta.animation.targetProperty !== "position") continue;
      const anim = ta.animation as Animation & { zepBounce?: boolean };
      if (anim.zepBounce) continue;
      anim.zepBounce = true;
      const keys = anim.getKeys();
      const ys = keys.map((k) => (k.value as Vector3).y);
      const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
      for (const k of keys) {
        const v = k.value as Vector3;
        k.value = new Vector3(v.x, bodyY + (v.y - mid) * LOCO_BOUNCE, v.z);
      }
    }
  }
}
