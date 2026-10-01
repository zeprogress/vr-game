import type { Scene } from "@babylonjs/core/scene";
import { Animation } from "@babylonjs/core/Animations/animation";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { SineEase, EasingFunction } from "@babylonjs/core/Animations/easing";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import type { RigInstance } from "./models";
import { BOT_GEAR } from "../entities/botGear";

/**
 * Клипы новых классов, собранные ПРЯМО НА СКЕЛЕТЕ персонажа: позу задаём не
 * углами костей, а тем, где должны быть кисти и куда смотрит оружие, — руки
 * ставит двухзвенный IK, кулак доворачивается так, чтобы клинок/древко в нём
 * смотрели в нужную сторону (с учётом посадки оружия в кулаке). Ноги и
 * дыхание — из родного клипа Idle (поза кладётся поверх его кадров).
 *
 * Координаты позы — «пространство героя» в метрах для героя ростом 1.8 м:
 * x — вправо, y — вверх, z — вперёд; кисти — от середины плеч. На другом
 * росте всё масштабируется по длине руки.
 */

export type V3 = [number, number, number];

export interface HandPose {
  /** Кисть (запястье) относительно середины плеч, м. */
  at?: V3;
  /** Куда смотрит оружие в этой руке (клинок / боёк / верх лука). */
  dir?: V3;
  /** Вторая рука на древке оружия ПРАВОЙ руки: на сколько метров вдоль `dir` от хвата. */
  shaft?: number;
}

export interface PoseKey {
  /** Кадр (60 в секунду). */
  f: number;
  /** Кадр родного Idle, поверх которого кладётся поза (по умолчанию 0). */
  idle?: number;
  /** Разворот корпуса, град: + — грудью вправо. */
  twist?: number;
  /** Наклон, град: + — вперёд. */
  lean?: number;
  /** Голова: доворот обратно к цели (доля от twist, 0..1). */
  headBack?: number;
  /** Сдвиг таза, м (x вправо, y вверх, z вперёд). */
  body?: V3;
  R?: HandPose;
  L?: HandPose;
}

export interface ClipDef {
  name: string;
  loop: boolean;
  keys: PoseKey[];
}

/** Посадка оружия в кулаке (как у меша на кости): нужна, чтобы знать, куда смотрит клинок. */
export interface Seat {
  pos: readonly number[];
  rot: readonly number[];
}

// ---------------------------------------------------------------- клипы

/** Idle-вариант: поза поверх нескольких кадров родного Idle (дыхание). */
function idleOf(name: string, p: Omit<PoseKey, "f" | "idle">): ClipDef {
  const frames = [0, 25, 50, 75, 100];
  return { name, loop: true, keys: frames.map((f) => ({ ...p, f: f * 2.5, idle: f })) };
}

const SPEAR_IDLE: Omit<PoseKey, "f"> = { twist: 25, headBack: 0.8, R: { at: [0.17, -0.3, 0.02], dir: [-0.2, 0.55, 1] }, L: { shaft: 0.3 } };
const HAMMER_IDLE: Omit<PoseKey, "f"> = { twist: 10, headBack: 0.6, R: { at: [0.16, -0.3, 0.12], dir: [0.15, 1, 0.15] }, L: { shaft: -0.22 } };
const DAGGER_IDLE: Omit<PoseKey, "f"> = { lean: 6, R: { at: [0.2, -0.2, 0.18], dir: [0, 0.4, 1] }, L: { at: [-0.2, -0.18, 0.16], dir: [0, 0.4, 1] } };
const BOW_IDLE: Omit<PoseKey, "f"> = { twist: 10, headBack: 0.5, L: { at: [-0.2, -0.3, 0.12], dir: [0.1, 1, 0.4] }, R: { at: [0.2, -0.32, 0.02] } };

export const CLASS_CLIPS: ClipDef[] = [
  idleOf("spearidle", SPEAR_IDLE),
  {
    name: "spearthrust",
    loop: false,
    keys: [
      { f: 0, ...SPEAR_IDLE },
      { f: 10, twist: 40, headBack: 0.85, body: [0, 0, -0.04], R: { at: [0.18, -0.24, -0.12], dir: [-0.15, 0.2, 1] }, L: { shaft: 0.3 } },
      { f: 17, twist: -5, lean: 12, headBack: 0, body: [0, -0.03, 0.16], R: { at: [0.1, -0.12, 0.3], dir: [-0.05, 0.08, 1] }, L: { shaft: 0.3 } },
      { f: 24, twist: -5, lean: 12, headBack: 0, body: [0, -0.03, 0.16], R: { at: [0.1, -0.12, 0.3], dir: [-0.05, 0.08, 1] }, L: { shaft: 0.3 } },
      { f: 40, ...SPEAR_IDLE },
    ],
  },
  idleOf("hammeridle", HAMMER_IDLE),
  {
    name: "hammerslam",
    loop: false,
    keys: [
      { f: 0, ...HAMMER_IDLE },
      { f: 14, twist: 15, lean: -12, headBack: 0.6, body: [0, 0.02, -0.03], R: { at: [0.1, 0.22, -0.02], dir: [0, 0.35, -1] }, L: { shaft: -0.2 } },
      { f: 20, twist: 15, lean: -14, headBack: 0.6, body: [0, 0.02, -0.03], R: { at: [0.08, 0.26, -0.04], dir: [0, 0.2, -1] }, L: { shaft: -0.2 } },
      { f: 27, twist: 0, lean: 28, body: [0, -0.1, 0.1], R: { at: [0.04, -0.12, 0.3], dir: [0, -0.7, 1] }, L: { shaft: -0.2 } },
      { f: 36, twist: 0, lean: 28, body: [0, -0.1, 0.1], R: { at: [0.04, -0.12, 0.3], dir: [0, -0.7, 1] }, L: { shaft: -0.2 } },
      { f: 54, ...HAMMER_IDLE },
    ],
  },
  idleOf("daggeridle", DAGGER_IDLE),
  {
    name: "daggerstabr",
    loop: false,
    keys: [
      { f: 0, ...DAGGER_IDLE },
      { f: 6, twist: -25, lean: 10, headBack: 0.8, body: [0, 0, 0.08], R: { at: [0.05, -0.05, 0.36], dir: [-0.1, 0.1, 1] }, L: { at: [-0.22, -0.22, 0.05], dir: [0, 0.5, 1] } },
      { f: 10, twist: -25, lean: 10, headBack: 0.8, body: [0, 0, 0.08], R: { at: [0.05, -0.05, 0.36], dir: [-0.1, 0.1, 1] }, L: { at: [-0.22, -0.22, 0.05], dir: [0, 0.5, 1] } },
      { f: 20, ...DAGGER_IDLE },
    ],
  },
  {
    name: "daggerstabl",
    loop: false,
    keys: [
      { f: 0, ...DAGGER_IDLE },
      { f: 6, twist: 25, lean: 10, headBack: 0.8, body: [0, 0, 0.08], L: { at: [-0.05, -0.05, 0.36], dir: [0.1, 0.1, 1] }, R: { at: [0.22, -0.22, 0.05], dir: [0, 0.5, 1] } },
      { f: 10, twist: 25, lean: 10, headBack: 0.8, body: [0, 0, 0.08], L: { at: [-0.05, -0.05, 0.36], dir: [0.1, 0.1, 1] }, R: { at: [0.22, -0.22, 0.05], dir: [0, 0.5, 1] } },
      { f: 20, ...DAGGER_IDLE },
    ],
  },
  idleOf("bowidle", BOW_IDLE),
  {
    name: "bowshoot",
    loop: false,
    keys: [
      { f: 0, ...BOW_IDLE },
      { f: 10, twist: 55, headBack: 0.9, L: { at: [-0.08, 0.02, 0.36], dir: [0, 1, 0.05] }, R: { at: [-0.02, 0.0, 0.25] } },
      { f: 22, twist: 60, headBack: 0.95, L: { at: [-0.1, 0.03, 0.36], dir: [0, 1, 0.05] }, R: { at: [0.12, 0.06, -0.02] } },
      { f: 27, twist: 60, headBack: 0.95, L: { at: [-0.1, 0.03, 0.36], dir: [0, 1, 0.05] }, R: { at: [0.12, 0.06, -0.02] } },
      { f: 29, twist: 60, headBack: 0.95, L: { at: [-0.1, 0.03, 0.37], dir: [0, 1, 0.05] }, R: { at: [0.22, 0.1, -0.12] } },
      { f: 46, ...BOW_IDLE },
    ],
  },
];

// ---------------------------------------------------------------- построение

/** Длина руки героя 1.8 м — к ней приводятся координаты поз. */
const ARM_REF = 0.37;

const tmpM = new Matrix();

/**
 * Собрать клипы на риг. `seat(side)` — посадка оружия в кулаке этой руки
 * (null — пустая рука). Вернёт группы, уже добавленные в `rig.anims`.
 */
export function buildClassClips(
  scene: Scene,
  rig: RigInstance,
  seat: (side: "R" | "L", clip: string) => Seat | null,
  defs = CLASS_CLIPS,
): AnimationGroup[] {
  let clipName = "";
  const idle = rig.anims.get("idle");
  if (!idle) return [];
  // Кости — ровно те узлы, которые анимирует родной Idle. По имени искать
  // нельзя: у части персонажей есть и кость «Body», и узел-контейнер меша
  // с тем же именем — ключи кости на контейнере заваливали всю модель.
  const bones = new Map<string, TransformNode>();
  for (const ta of idle.targetedAnimations) {
    const t = ta.target as TransformNode;
    if (!bones.has(t.name)) bones.set(t.name, t);
  }
  const B = (n: string): TransformNode => {
    const b = bones.get(n);
    if (!b) throw new Error(`classPoses: нет кости ${n}`);
    return b;
  };
  // Родные значения Idle по кости: анимация → значение на кадре.
  const idleAnims = new Map<string, Map<string, Animation>>();
  for (const ta of idle.targetedAnimations) {
    const n = (ta.target as TransformNode).name;
    if (!idleAnims.has(n)) idleAnims.set(n, new Map());
    idleAnims.get(n)!.set(ta.animation.targetProperty, ta.animation);
  }
  const keyed = [...bones.values()].filter((b) => idleAnims.has(b.name));
  // Запомнить, что было (вернём после построения).
  const saved = keyed.map((b) => ({ b, q: b.rotationQuaternion?.clone() ?? null, p: b.position.clone(), s: b.scaling.clone() }));
  const ordered = rig.root.getDescendants(false) as TransformNode[];
  const refresh = (): void => {
    rig.root.computeWorldMatrix(true);
    for (const n of ordered) n.computeWorldMatrix(true);
  };
  const setIdle = (frame: number): void => {
    for (const b of keyed) {
      const a = idleAnims.get(b.name)!;
      const f = idle.from + frame * ((idle.to - idle.from) / 100);
      const r = a.get("rotationQuaternion");
      const p = a.get("position");
      const s = a.get("scaling");
      if (r) b.rotationQuaternion = (r.evaluate(f) as Quaternion).clone();
      if (p) b.position.copyFrom(p.evaluate(f) as Vector3);
      if (s) b.scaling.copyFrom(s.evaluate(f) as Vector3);
    }
    refresh();
  };
  const pos = (n: string): Vector3 => B(n).getAbsolutePosition().clone();

  /** Повернуть узел вокруг мировой оси через его центр. */
  const rotWorld = (n: TransformNode, axis: Vector3, angle: number): void => {
    if (Math.abs(angle) < 1e-6 || axis.lengthSquared() < 1e-12) return;
    const p = n.getAbsolutePosition();
    const w = n.getWorldMatrix();
    const M = w
      .multiply(Matrix.Translation(-p.x, -p.y, -p.z))
      .multiply(Matrix.RotationAxis(axis.normalizeToNew(), angle))
      .multiply(Matrix.Translation(p.x, p.y, p.z));
    const parent = (n.parent as TransformNode).getWorldMatrix();
    parent.invertToRef(tmpM);
    const local = M.multiply(tmpM);
    const sc = new Vector3();
    const q = new Quaternion();
    const t = new Vector3();
    local.decompose(sc, q, t);
    n.rotationQuaternion = q;
    n.position.copyFrom(t);
    refresh();
  };
  /** Довернуть узел так, чтобы вектор cur() смотрел в want. */
  const aim = (n: TransformNode, cur: () => Vector3, want: Vector3): void => {
    const a = cur().normalize();
    const b = want.normalizeToNew();
    const dot = Math.max(-1, Math.min(1, Vector3.Dot(a, b)));
    const angle = Math.acos(dot);
    if (angle < 1e-4) return;
    let axis = Vector3.Cross(a, b);
    if (axis.lengthSquared() < 1e-10) axis = Math.abs(a.x) < 0.9 ? Vector3.Cross(a, Vector3.Right()) : Vector3.Cross(a, Vector3.Up());
    rotWorld(n, axis, angle);
    if (Vector3.Dot(cur().normalize(), b) < dot) rotWorld(n, axis, -2 * angle); // знак оси — проверкой
  };

  // Оси героя (по базовой позе): вправо — от левого плеча к правому, вверх — мировой Y.
  setIdle(0);
  const right = pos("UpperArm.R").subtract(pos("UpperArm.L"));
  right.y = 0;
  right.normalize();
  const up = Vector3.Up();
  const fwd = Vector3.Cross(right, up).normalize();
  if (Vector3.Dot(fwd, pos("PoleTarget.L").subtract(pos("UpperLeg.L"))) < 0) fwd.scaleInPlace(-1);
  const toWorld = (v: V3): Vector3 => right.scale(v[0]).add(up.scale(v[1])).add(fwd.scale(v[2]));
  const lenUp = Vector3.Distance(pos("UpperArm.R"), pos("LowerArm.R"));
  const lenLo = Vector3.Distance(pos("LowerArm.R"), pos("Fist.R"));
  const k = (lenUp + lenLo) / ARM_REF;

  // Знаки разворота/наклона корпуса — проверкой на скелете.
  const torsoBones = [B("Abdomen"), B("Torso")];
  let twistSign = 1;
  {
    const before = Vector3.Dot(pos("UpperArm.R"), fwd);
    rotWorld(B("Abdomen"), up, 0.2);
    if (Vector3.Dot(pos("UpperArm.R"), fwd) > before) twistSign = -1; // «грудью вправо» — правое плечо уходит назад
  }
  setIdle(0);
  let leanSign = 1;
  {
    const before = Vector3.Dot(pos("Head"), fwd);
    rotWorld(B("Abdomen"), right, 0.2);
    if (Vector3.Dot(pos("Head"), fwd) < before) leanSign = -1;
  }

  /** Куда смотрит оружие в кулаке (мир) при текущей позе. */
  const bladeLocal = (side: "R" | "L"): Vector3 | null => {
    const s = seat(side, clipName);
    if (!s) return null;
    const r = Matrix.RotationYawPitchRoll(s.rot[1], s.rot[0], s.rot[2]);
    return Vector3.TransformNormal(Vector3.Up(), r);
  };
  const fistAxis = (side: "R" | "L"): Vector3 => Vector3.TransformNormal(Vector3.Up(), B(`Fist.${side}`).getWorldMatrix()).normalize();
  const bladeWorld = (side: "R" | "L", local: Vector3): Vector3 =>
    Vector3.TransformNormal(local, B(`Fist.${side}`).getWorldMatrix()).normalize();
  const gripWorld = (side: "R" | "L"): Vector3 => {
    const s = seat(side, clipName);
    const p = s ? new Vector3(s.pos[0], s.pos[1], s.pos[2]) : Vector3.Zero();
    return Vector3.TransformCoordinates(p, B(`Fist.${side}`).getWorldMatrix());
  };

  const armIk = (side: "R" | "L", target: Vector3): void => {
    const ua = B(`UpperArm.${side}`);
    const la = B(`LowerArm.${side}`);
    const fi = B(`Fist.${side}`);
    const S = ua.getAbsolutePosition().clone();
    const d = target.subtract(S);
    const L = Math.max(0.02, Math.min(d.length(), (lenUp + lenLo) * 0.995));
    const u = d.normalize();
    const ca = Math.max(-1, Math.min(1, (lenUp * lenUp + L * L - lenLo * lenLo) / (2 * lenUp * L)));
    const sa = Math.sqrt(1 - ca * ca);
    // Локоть — вниз, наружу и чуть назад.
    const side01 = side === "R" ? 1 : -1;
    const pole = toWorld([0.6 * side01, -1, -0.35]);
    const v = pole.subtract(u.scale(Vector3.Dot(pole, u)));
    if (v.lengthSquared() < 1e-8) v.copyFrom(up.subtract(u.scale(Vector3.Dot(up, u))));
    v.normalize();
    const E = S.add(u.scale(lenUp * ca)).add(v.scale(lenUp * sa));
    const T = S.add(u.scale(L));
    aim(ua, () => la.getAbsolutePosition().subtract(ua.getAbsolutePosition()), E.subtract(S));
    aim(la, () => fi.getAbsolutePosition().subtract(la.getAbsolutePosition()), T.subtract(E));
    // Кисть — прямо продолжением предплечья.
    aim(fi, () => fistAxis(side), T.subtract(E));
  };

  /** Развернуть кулак так, чтобы оружие смотрело в want: сначала крутим вокруг оси кулака, потом сгибаем запястье. */
  const orientWeapon = (side: "R" | "L", want: Vector3): void => {
    const loc = bladeLocal(side);
    if (!loc) return;
    const fi = B(`Fist.${side}`);
    const w = want.normalizeToNew();
    const axis = fistAxis(side);
    let best = 0;
    let bestDot = -2;
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      rotWorld(fi, axis, a);
      const dt = Vector3.Dot(bladeWorld(side, loc), w);
      rotWorld(fi, axis, -a);
      if (dt > bestDot) {
        bestDot = dt;
        best = a;
      }
    }
    rotWorld(fi, axis, best);
    aim(fi, () => bladeWorld(side, loc), w);
  };

  const C = (): Vector3 => pos("UpperArm.R").add(pos("UpperArm.L")).scale(0.5);

  const applyPose = (p: PoseKey): void => {
    setIdle(p.idle ?? 0);
    if (p.body) {
      const body = B("Body");
      const target = body.getAbsolutePosition().add(toWorld([p.body[0] * k, p.body[1] * k, p.body[2] * k]));
      const parent = (body.parent as TransformNode).getWorldMatrix();
      parent.invertToRef(tmpM);
      body.position.copyFrom(Vector3.TransformCoordinates(target, tmpM));
      refresh();
    }
    const tw = ((p.twist ?? 0) * Math.PI) / 180;
    const ln = ((p.lean ?? 0) * Math.PI) / 180;
    for (const b of torsoBones) {
      if (ln) rotWorld(b, right, (ln / 2) * leanSign);
      if (tw) rotWorld(b, up, (tw / 2) * twistSign);
    }
    if (tw && p.headBack) rotWorld(B("Head"), up, -tw * p.headBack * twistSign);
    const c = C();
    const hand = (side: "R" | "L", h: HandPose | undefined): void => {
      if (!h) return;
      if (h.shaft !== undefined && side === "L") {
        const locR = bladeLocal("R");
        if (!locR) return;
        const dirR = bladeWorld("R", locR);
        const tgt = gripWorld("R").add(dirR.scale(h.shaft * k));
        armIk("L", tgt);
        return;
      }
      if (h.at) armIk(side, c.add(toWorld([h.at[0] * k, h.at[1] * k, h.at[2] * k])));
      if (h.dir) orientWeapon(side, toWorld(h.dir));
    };
    // Сначала рука с оружием, потом вторая (может держаться за его древко).
    hand("R", p.R);
    hand("L", p.L);
  };

  const out: AnimationGroup[] = [];
  const ease = new SineEase();
  ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
  for (const def of defs) {
    clipName = def.name;
    const g = new AnimationGroup(`${def.name}_${rig.root.uniqueId}`, scene);
    const rotKeys = new Map<TransformNode, { frame: number; value: Quaternion }[]>();
    const posKeys = new Map<TransformNode, { frame: number; value: Vector3 }[]>();
    for (const key of def.keys) {
      applyPose(key);
      for (const b of keyed) {
        if (!rotKeys.has(b)) rotKeys.set(b, []);
        if (!posKeys.has(b)) posKeys.set(b, []);
        rotKeys.get(b)!.push({ frame: key.f, value: (b.rotationQuaternion ?? Quaternion.Identity()).clone() });
        posKeys.get(b)!.push({ frame: key.f, value: b.position.clone() });
      }
    }
    for (const b of keyed) {
      const ra = new Animation(`${def.name}_${b.name}_r`, "rotationQuaternion", 60, Animation.ANIMATIONTYPE_QUATERNION);
      ra.setKeys(rotKeys.get(b)!);
      ra.setEasingFunction(ease);
      g.addTargetedAnimation(ra, b);
      const pa = new Animation(`${def.name}_${b.name}_p`, "position", 60, Animation.ANIMATIONTYPE_VECTOR3);
      pa.setKeys(posKeys.get(b)!);
      pa.setEasingFunction(ease);
      g.addTargetedAnimation(pa, b);
    }
    g.normalize(0, def.keys[def.keys.length - 1].f);
    rig.anims.get(def.name)?.dispose();
    rig.anims.set(def.name, g);
    out.push(g);
  }
  // Вернуть скелет как был.
  for (const s of saved) {
    if (s.q) s.b.rotationQuaternion = s.q;
    s.b.position.copyFrom(s.p);
    s.b.scaling.copyFrom(s.s);
  }
  refresh();
  return out;
}

// ---------------------------------------------------------------- игра

/** Посадка оружия в кулаке по клипу (как у моделей в игре — BOT_GEAR). */
export function gearSeat(clip: string, side: "R" | "L"): Seat | null {
  if (clip.startsWith("bow")) return side === "L" ? BOT_GEAR.bow : null;
  if (clip.startsWith("spear")) return side === "R" ? BOT_GEAR.spear : null;
  if (clip.startsWith("hammer")) return side === "R" ? BOT_GEAR.hammer : null;
  if (clip.startsWith("dagger")) return BOT_GEAR.dagger;
  return null;
}

interface CachedClip {
  name: string;
  from: number;
  to: number;
  tracks: { bone: string; anim: Animation }[];
}
/** Посчитанные клипы по модели (скелет у всех персонажей один, но размеры чуть разные). */
const clipCache = new Map<string, CachedClip[]>();

/**
 * Клипы классов на риг персонажа в игре: первый риг модели считает позы
 * (buildClassClips), остальные получают те же Animation (общие ключи) —
 * без повторного IK. Вернёт добавленные в rig.anims группы (их надо
 * dispose вместе с ригом).
 */
export function classClipsFor(scene: Scene, rig: RigInstance, cacheKey: string): AnimationGroup[] {
  const cached = clipCache.get(cacheKey);
  if (!cached) {
    const groups = buildClassClips(scene, rig, (side, clip) => gearSeat(clip, side));
    clipCache.set(
      cacheKey,
      groups.map((g, i) => ({
        name: CLASS_CLIPS[i].name,
        from: g.from,
        to: g.to,
        tracks: g.targetedAnimations.map((ta) => ({ bone: (ta.target as TransformNode).name, anim: ta.animation })),
      })),
    );
    return groups;
  }
  const idle = rig.anims.get("idle");
  const bones = new Map<string, TransformNode>();
  for (const ta of idle?.targetedAnimations ?? []) {
    const t = ta.target as TransformNode;
    if (!bones.has(t.name)) bones.set(t.name, t);
  }
  const out: AnimationGroup[] = [];
  for (const c of cached) {
    const g = new AnimationGroup(`${c.name}_${rig.root.uniqueId}`, scene);
    for (const tr of c.tracks) {
      const b = bones.get(tr.bone);
      if (b) g.addTargetedAnimation(tr.anim, b);
    }
    g.normalize(c.from, c.to);
    rig.anims.get(c.name)?.dispose();
    rig.anims.set(c.name, g);
    out.push(g);
  }
  return out;
}

/** Какие клипы играть с этим оружием в руках: стойка и удар (у двух кинжалов — второй рукой alt). */
export interface ClassAnimSet {
  idle: string;
  attack: string;
  alt?: string;
}
export function classAnimSet(left: string, right: string): ClassAnimSet | null {
  const h = [left, right];
  if (h.includes("spear")) return { idle: "spearidle", attack: "spearthrust" };
  if (h.includes("hammer")) return { idle: "hammeridle", attack: "hammerslam" };
  if (h.includes("dagger")) {
    const two = left === "dagger" && right === "dagger";
    return { idle: "daggeridle", attack: "daggerstabr", alt: two ? "daggerstabl" : undefined };
  }
  if (h.includes("bow")) return { idle: "bowidle", attack: "bowshoot" };
  return null;
}

/** Имена всех клипов классов (для списков весов в аватарах). */
export const CLASS_CLIP_NAMES: readonly string[] = CLASS_CLIPS.map((c) => c.name);
/** Разовые (не зацикленные) клипы классов. */
export const CLASS_ONE_SHOT: ReadonlySet<string> = new Set(CLASS_CLIPS.filter((c) => !c.loop).map((c) => c.name));
