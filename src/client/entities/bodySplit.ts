import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { CLASS_ONE_SHOT } from "../world/classPoses";

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

/** Разовые клипы, которые на бегу играют только корпусом. Эмоции, кувырок и прыжок — всем телом. */
const UPPER_ACTION_CLIPS = new Set<string>([...CLASS_ONE_SHOT, "swordslash", "recievehit", "pickup"]);

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
  for (const a of g.animatables) a.weight = LEG_BONES.has((a.target as { name?: string } | null)?.name ?? "") ? legs : upper;
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
