import type { Scene } from "@babylonjs/core/scene";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

import { ELITE_MOBS, MOB, SHIELD, type EliteMobDef } from "#shared/constants";
import { MAGIC } from "#shared/magic";
import {
  ATTR2,
  ATTRS,
  ATTR_INFO,
  CLASSES2,
  CLASS_IDS,
  HAMMER,
  SEAL,
  SKILLS2,
  STAFF_SPLASH,
  autoBuild,
  magicPower2,
  pointsAt,
  spentOn,
  stepCost,
  summarize2,
  skillName,
  type Attrs,
  type ClassId,
  type SkillId,
  type Summary2,
} from "#shared/classes2";
import type { WeaponTier } from "#shared/items";
import { BOT_GEAR, type GearTune } from "../entities/botGear";
import { createClassWeapon, type NewWeapon } from "../items/classWeapons";
import { makeWeaponMesh } from "../world/LootDrops";
import { buildClassClips } from "../world/classPoses";
import { loadRig, recolorCharacter, recolorMonster, type ModelName, type RigInstance } from "../world/models";
import type { LabCtx } from "./main";

/**
 * ⚔️ Классы 2.0 — полигон новых механик (см. shared/classes2.ts):
 * герой выбранного класса с оружием и новыми клипами бьёт манекены-мобов с
 * их настоящими защитами (физ. броня, броня от дальнего боя, уязвимость к
 * магии, уворот). Числа урона, живой DPS, время убийства/смерти, умения.
 * Раскладка атрибутов — с ценой очков, как будет в игре.
 *
 * Бой здесь «стоячий»: герой не бегает, мобы не подходят — сравниваем
 * классы и числа, а не ИИ. Ползунки «Посадка оружия» — подогнать модель в
 * кулаке; кнопка печатает готовый код.
 */

type Kind = "sword" | "shield" | "bow" | "staff" | NewWeapon;

const HERO_MODEL: Record<ClassId, ModelName> = {
  warrior: "charKnight",
  archer: "charCowboy",
  support: "charWizard",
  assassin: "charNinja",
  spearman: "charSoldier",
  battlemage: "charViking",
};
const HERO_H = 1.8;

/** Что в руках у класса. */
function gearOf(c: ClassId, dual: boolean): { R?: Kind; L?: Kind } {
  switch (c) {
    case "warrior": return { R: "sword", L: "shield" };
    case "archer": return { L: "bow" };
    case "support": return { R: "staff" };
    case "assassin": return dual ? { R: "dagger", L: "dagger" } : { R: "dagger" };
    case "spearman": return { R: "spear" };
    case "battlemage": return { R: "hammer" };
  }
}

const IDLE: Record<ClassId, string> = {
  warrior: "idle", archer: "bowidle", support: "idle", assassin: "daggeridle", spearman: "spearidle", battlemage: "hammeridle",
};
/** Клип атаки и доля клипа, на которой удар «доходит». */
const ATTACK: Record<ClassId, [string, number]> = {
  warrior: ["swordslash", 0.45],
  archer: ["bowshoot", 0.6],
  support: ["onehanded", 0.5],
  assassin: ["daggerstabr", 0.3],
  spearman: ["spearthrust", 0.42],
  battlemage: ["hammerslam", 0.5],
};

/** Посадка в кулаке: стартуем с подобранных у ботов, новое — с меча. Ключ — `вид:рука`. */
const SEATS = new Map<string, GearTune>();
function seatOf(k: Kind, side: "R" | "L"): GearTune {
  const key = `${k}:${side}`;
  let s = SEATS.get(key);
  if (!s) {
    const src = k === "shield" || k === "bow" || k === "staff" ? BOT_GEAR[k] : BOT_GEAR.sword;
    s = { pos: [...src.pos], rot: [...src.rot], scale: src.scale, auto: false };
    SEATS.set(key, s);
  }
  return s;
}

interface Dummy {
  def: EliteMobDef;
  node: TransformNode;
  rig: RigInstance | null;
  hp: number;
  maxHp: number;
  radius: number;
  dead: boolean;
  bornAt: number;
  atkT: number;
  stunT: number;
  slowT: number;
  bar: HTMLDivElement;
  bounceT: number;
}

interface Float {
  el: HTMLDivElement;
  pos: Vector3;
  t: number;
}

export async function build(ctx: LabCtx): Promise<void> {
  const { scene, ui } = ctx;
  const canvas = scene.getEngine().getRenderingCanvas()!;

  // ---------------------------------------------------------------- состояние
  let cls: ClassId = "battlemage";
  let level = 33;
  let tier: 0 | 1 | 2 = 1;
  let dual = true;
  let attrs: Attrs = autoBuild(cls, level);
  let skills: SkillId[] = [...CLASSES2[cls].defaultSkills];
  let mobKey = "boneWraith";
  let mobCount = 1;
  let mobsHit = true;
  let autoSkills = true;
  let s: Summary2 = summary();

  function summary(): Summary2 {
    return summarize2({ cls, level, attrs, tier, dual });
  }

  // ---------------------------------------------------------------- HTML-слой
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;overflow:hidden;font:700 15px system-ui";
  document.body.appendChild(overlay);
  const meterEl = document.createElement("div");
  meterEl.style.cssText =
    "position:fixed;left:8px;top:34px;background:#0009;color:#e6e0d0;font:12px/1.5 ui-monospace,monospace;padding:6px 9px;border-radius:6px;white-space:pre";
  document.body.appendChild(meterEl);
  const skillBar = document.createElement("div");
  skillBar.style.cssText = "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:8px";
  document.body.appendChild(skillBar);

  const floats: Float[] = [];
  function float(pos: Vector3, text: string, color: string, big = false): void {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `position:absolute;color:${color};text-shadow:0 1px 2px #000,0 0 4px #000;white-space:nowrap;font-size:${big ? 22 : 15}px;transform:translate(-50%,-50%)`;
    overlay.appendChild(el);
    floats.push({ el, pos: pos.add(new Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.3)), t: 0 });
  }
  function makeBar(color: string): HTMLDivElement {
    const b = document.createElement("div");
    b.style.cssText = "position:absolute;width:70px;height:7px;background:#000a;border-radius:4px;transform:translate(-50%,-50%);overflow:hidden";
    const f = document.createElement("div");
    f.style.cssText = `height:100%;width:100%;background:${color}`;
    b.appendChild(f);
    overlay.appendChild(b);
    return b;
  }
  const proj = new Vector3();
  function toScreen(p: Vector3): { x: number; y: number; ok: boolean } {
    const eng = scene.getEngine();
    const w = eng.getRenderWidth();
    const h = eng.getRenderHeight();
    const cam = scene.activeCamera!;
    Vector3.ProjectToRef(p, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h), proj);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (proj.x / w) * r.width, y: r.top + (proj.y / h) * r.height, ok: proj.z > 0 && proj.z < 1 };
  }
  function place(el: HTMLElement, p: Vector3): void {
    const q = toScreen(p);
    el.style.display = q.ok ? "" : "none";
    el.style.left = `${q.x}px`;
    el.style.top = `${q.y}px`;
  }

  // ---------------------------------------------------------------- эффекты
  const fxMats = new Map<string, StandardMaterial>();
  function fxMat(hex: string): StandardMaterial {
    let m = fxMats.get(hex);
    if (!m) {
      m = new StandardMaterial(`fx${hex}`, scene);
      m.emissiveColor = Color3.FromHexString(hex);
      m.diffuseColor = Color3.Black();
      m.disableLighting = true;
      m.alpha = 0.55;
      m.backFaceCulling = false;
      fxMats.set(hex, m);
    }
    return m;
  }
  interface Fx { mesh: Mesh; t: number; life: number; grow: number; base: number }
  const fxs: Fx[] = [];
  function ring(at: Vector3, radius: number, hex: string, life = 0.6, filled = false): Mesh {
    const mesh = filled
      ? MeshBuilder.CreateDisc("fxDisc", { radius, tessellation: 48 }, scene)
      : MeshBuilder.CreateTorus("fxRing", { diameter: radius * 2, thickness: 0.12, tessellation: 48 }, scene);
    if (filled) mesh.rotation.x = Math.PI / 2;
    mesh.position.set(at.x, 0.06, at.z);
    mesh.material = fxMat(hex);
    mesh.isPickable = false;
    fxs.push({ mesh, t: 0, life, grow: filled ? 0 : 0.25, base: filled ? 0.4 : 1 });
    return mesh;
  }
  interface Shot { mesh: Mesh; from: Vector3; to: () => Vector3; t: number; dur: number; done: () => void }
  const shots: Shot[] = [];
  function shoot(from: Vector3, to: () => Vector3, hex: string, size: number, done: () => void): void {
    const mesh = MeshBuilder.CreateSphere("shot", { diameter: size, segments: 6 }, scene);
    mesh.material = fxMat(hex);
    mesh.isPickable = false;
    const dur = Vector3.Distance(from, to()) / 26;
    shots.push({ mesh, from: from.clone(), to, t: 0, dur, done });
  }

  // ---------------------------------------------------------------- герой
  const HOME = new Vector3(0, 0, 0);
  const hero = new TransformNode("labHero", scene);
  const heroHolder = new TransformNode("labHeroHolder", scene);
  heroHolder.parent = hero;
  let heroRig: RigInstance | null = null;
  let extraAnims: AnimationGroup[] = [];
  let fistR: TransformNode | null = null;
  let fistL: TransformNode | null = null;
  const gear: { R: Mesh | null; L: Mesh | null; RK?: Kind; LK?: Kind } = { R: null, L: null };
  let heroHp = 1;
  let heroBornAt = 0;
  const heroBar = makeBar("#6fbf6f");
  let heroBusy = 0; // с — играет клип атаки/умения
  let heroLoad = 0;
  /** Куда герой «скользит» после рывка (возврат на место). */
  let returnT = 0;

  function clip(name: string): AnimationGroup | undefined {
    return heroRig?.anims.get(name);
  }
  function playHero(name: string, loop: boolean, speed = 1): number {
    const g = clip(name) ?? clip("swordslash");
    if (!g || !heroRig) return 0;
    for (const a of heroRig.anims.values()) if (a !== g) a.stop();
    g.start(loop, speed, g.from, g.to, false);
    return (g.to - g.from) / 60 / speed;
  }
  function heroIdle(): void {
    playHero(clip(IDLE[cls]) ? IDLE[cls] : "idle", true);
  }

  async function loadHero(): Promise<void> {
    const my = ++heroLoad;
    for (const g of extraAnims) g.dispose();
    extraAnims = [];
    gear.R?.dispose();
    gear.L?.dispose();
    gear.R = gear.L = null;
    heroRig?.dispose();
    heroRig = null;
    const make = await loadRig(scene, HERO_MODEL[cls], { smoothNormals: true });
    if (my !== heroLoad) return;
    const rig = make();
    recolorCharacter(rig.root);
    rig.root.parent = heroHolder;
    heroHolder.scaling.setAll(HERO_H / rig.nativeHeight);
    const bone = (n: string): TransformNode | null =>
      (rig.root.getDescendants(false).find((d) => d.name === n && d.getClassName() === "TransformNode") as TransformNode) ?? null;
    fistR = bone("Fist.R");
    fistL = bone("Fist.L");
    heroRig = rig;
    equip();
    rebuildClips();
    heroIdle();
  }

  /** Собрать клипы классов на скелете героя (зависят от посадки оружия в кулаке). */
  function rebuildClips(): void {
    if (!heroRig) return;
    for (const g of extraAnims) g.dispose();
    const t0 = performance.now();
    extraAnims = buildClassClips(scene, heroRig, (side) => {
      const k = gear[`${side}K`];
      return k ? seatOf(k, side) : null;
    });
    console.log(`[lab] клипы классов собраны за ${(performance.now() - t0).toFixed(0)} мс`);
  }

  function equip(): void {
    gear.R?.dispose();
    gear.L?.dispose();
    gear.R = gear.L = null;
    const g = gearOf(cls, dual);
    const tierName: WeaponTier = tier === 0 ? "base" : tier === 1 ? "gold" : "legendary";
    for (const side of ["R", "L"] as const) {
      const k = g[side];
      gear[`${side}K`] = k;
      const fist = side === "R" ? fistR : fistL;
      if (!k || !fist) continue;
      const mesh =
        k === "dagger" || k === "spear" || k === "hammer"
          ? createClassWeapon(scene, k, tier)
          : makeWeaponMesh(scene, k, k === "shield" ? "base" : tierName);
      mesh.rotationQuaternion = null;
      mesh.parent = fist;
      gear[side] = mesh;
      seat(side);
    }
  }
  function seat(side: "R" | "L"): void {
    const m = gear[side];
    const k = gear[`${side}K`];
    if (!m || !k) return;
    const t = seatOf(k, side);
    m.position.set(t.pos[0], t.pos[1], t.pos[2]);
    m.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
    m.scaling.setAll(t.scale);
  }

  // ---------------------------------------------------------------- мобы
  let mobs: Dummy[] = [];
  let mobLoad = 0;
  function mobDist(): number {
    const r = MOB.bodyRadius * ELITE_MOBS[mobKey].scaleMul;
    if (cls === "archer" || cls === "support") return 10 + r;
    if (cls === "spearman") return 3.2 + r;
    return 1.5 + r;
  }
  const OFFS: [number, number][] = [[0, 0], [-1.9, 0.9], [1.9, 0.9], [-1, 2.5], [1, 2.5]];
  async function loadMobs(): Promise<void> {
    const my = ++mobLoad;
    for (const m of mobs) {
      m.rig?.dispose();
      m.node.dispose();
      m.bar.remove();
    }
    mobs = [];
    const def = ELITE_MOBS[mobKey];
    const make = await loadRig(scene, def.model as ModelName).catch(() => null);
    if (my !== mobLoad) return;
    const D = mobDist();
    const spread = Math.max(1, def.scaleMul * 0.7);
    for (let i = 0; i < mobCount; i++) {
      const node = new TransformNode(`dummy${i}`, scene);
      node.position.set(OFFS[i][0] * spread, def.flying ? 0.6 : 0, D + OFFS[i][1] * spread);
      const holder = new TransformNode(`dummyH${i}`, scene);
      holder.parent = node;
      let rig: RigInstance | null = null;
      if (make) {
        rig = make();
        rig.root.parent = holder;
        holder.scaling.setAll(((MOB.bodyRadius * 1.75) / rig.nativeHeight) * def.scaleMul);
        recolorMonster(rig.root, def.tint ? new Color3(def.tint[0], def.tint[1], def.tint[2]) : undefined);
        rig.anims.get("idle")?.start(true);
      }
      mobs.push({
        def, node, rig, hp: def.hp, maxHp: def.hp, radius: MOB.bodyRadius * def.scaleMul, dead: false,
        bornAt: now, atkT: Math.random(), stunT: 0, slowT: 0, bar: makeBar("#d05050"), bounceT: 0,
      });
    }
    ctx.frame(0, 1.2, D * 0.5, Math.max(9, D * 1.6 + def.scaleMul * 2));
  }
  function mobClip(m: Dummy, names: string[]): AnimationGroup | undefined {
    for (const n of names) {
      const g = m.rig?.anims.get(n);
      if (g) return g;
    }
    return undefined;
  }
  function mobPlay(m: Dummy, names: string[], then = true): void {
    const g = mobClip(m, names);
    if (!g || !m.rig) return;
    for (const a of m.rig.anims.values()) if (a !== g) a.stop();
    g.start(false, 1.3, g.from, g.to, false);
    if (then) g.onAnimationGroupEndObservable.addOnce(() => !m.dead && m.rig?.anims.get("idle")?.start(true));
  }
  function target(): Dummy | null {
    let best: Dummy | null = null;
    for (const m of mobs) if (!m.dead && (!best || Vector3.DistanceSquared(m.node.position, hero.position) < Vector3.DistanceSquared(best.node.position, hero.position))) best = m;
    return best;
  }

  // ---------------------------------------------------------------- учёт
  let now = 0;
  const log: [number, number][] = [];
  let dmgTotal = 0;
  let meterFrom = 0;
  let kills = 0;
  let lastTtk = 0;
  let lastTtd = 0;
  let deaths = 0;
  let healTotal = 0;
  function resetMeters(): void {
    log.length = 0;
    dmgTotal = 0;
    meterFrom = now;
    kills = deaths = 0;
    lastTtk = lastTtd = 0;
    healTotal = 0;
  }

  const ranged = (): boolean => cls === "archer" || cls === "support";
  const casterSkills = (): boolean => cls === "support" || cls === "battlemage";

  function deal(m: Dummy, raw: number, type: "phys" | "magic", isRanged: boolean, crit: boolean, tint?: string): void {
    if (m.dead) return;
    const top = m.node.position.add(new Vector3(0, m.radius * 2 + 0.6, 0));
    if (Math.random() < (m.def.dodge ?? 0)) {
      float(top, "MISS", "#aaa");
      return;
    }
    let mul = type === "magic" ? (m.def.magicVulnMul ?? 1) : 1 - (m.def.physArmor ?? 0);
    if (isRanged) mul *= 1 - (m.def.rangedArmor ?? 0);
    if (crit) mul *= m.def.critVulnMul ?? 1;
    const d = raw * mul * (sealT > 0 ? 1 : 1);
    m.hp -= d;
    dmgTotal += d;
    log.push([now, d]);
    float(top, `${Math.round(d)}${crit ? "!" : ""}`, tint ?? (crit ? "#ffd84a" : type === "magic" ? "#c79bff" : "#fff"), crit);
    if (m.hp <= 0) {
      m.dead = true;
      m.hp = 0;
      kills++;
      lastTtk = now - m.bornAt;
      mobPlay(m, ["death"], false);
      setTimeout(() => {
        m.dead = false;
        m.hp = m.maxHp;
        m.bornAt = now;
        m.stunT = m.slowT = 0;
        m.rig?.anims.get("death")?.stop();
        m.rig?.anims.get("idle")?.start(true);
      }, 1500);
    } else if (Math.random() < 0.25) mobPlay(m, ["hitreact", "hitrecieve"]);
  }

  function rawHit(crit: boolean): number {
    const perHit = s.hit / (1 + s.critChance * (s.critMult - 1));
    return perHit * (crit ? s.critMult : 1);
  }
  let forceCrit = false;
  let stabLeft = false;

  /** Автоатака: клип, на нужной доле — урон (у дальнего — снаряд). */
  function attack(): void {
    const t = target();
    if (!t) return;
    let [name, frac] = ATTACK[cls];
    if (cls === "assassin" && dual) {
      stabLeft = !stabLeft;
      name = stabLeft ? "daggerstabl" : "daggerstabr";
    }
    const g = clip(name);
    const natural = g ? (g.to - g.from) / 60 : 0.6;
    const speed = Math.max(1, (natural * s.rate) / 0.95);
    const dur = playHero(name, false, speed);
    heroBusy = dur;
    const crit = forceCrit || Math.random() < s.critChance;
    forceCrit = false;
    setTimeout(() => {
      const raw = rawHit(crit);
      if (ranged()) {
        const from = hero.position.add(new Vector3(0, 1.3, 0));
        shoot(from, () => t.node.position.add(new Vector3(0, t.radius + 0.3, 0)), cls === "archer" ? "#e8e0c8" : "#ff8a2a", cls === "archer" ? 0.12 : 0.35, () => {
          deal(t, raw, s.dmgType, true, crit);
          if (cls === "support") {
            for (const o of mobs) if (o !== t && Vector3.Distance(o.node.position, t.node.position) < STAFF_SPLASH.radius) deal(o, s.splash, "magic", true, false);
            ring(t.node.position, STAFF_SPLASH.radius, "#ff8a2a", 0.4);
          }
        });
        return;
      }
      deal(t, raw, "phys", false, crit);
      if (cls === "spearman") {
        // Пробивает насквозь по линии — ещё до 2 мобов за целью.
        const dir = t.node.position.subtract(hero.position).normalize();
        let n = 1;
        for (const o of mobs) {
          if (o === t || n >= 3) continue;
          const v = o.node.position.subtract(hero.position);
          const along = Vector3.Dot(v, dir);
          const side = v.subtract(dir.scale(along)).length();
          if (along > 0 && side < 1 + o.radius) {
            deal(o, raw, "phys", false, crit);
            n++;
          }
        }
      }
      if (cls === "battlemage") {
        ring(t.node.position, HAMMER.waveRadius, "#b57bff", 0.45);
        for (const o of mobs) if (Vector3.Distance(o.node.position, t.node.position) < HAMMER.waveRadius + o.radius) deal(o, s.splash, "magic", false, false);
      }
    }, dur * frac * 1000);
  }

  // ---------------------------------------------------------------- умения
  const cds = new Map<SkillId, number>();
  let sealT = 0;
  let rainT = 0;
  let rainTick = 0;
  let rainAt = new Vector3();
  function power(): number {
    return s.power;
  }
  function skillType(): "phys" | "magic" {
    return casterSkills() ? "magic" : "phys";
  }
  function cast(id: SkillId): void {
    if ((cds.get(id) ?? 0) > 0 || heroBusy > 0.05) return;
    const t = target();
    const sk = SKILLS2[id];
    cds.set(id, sk.cooldown * s.cdMul);
    const hpos = hero.position;
    switch (id) {
      case "stunBash": {
        const anim = cls === "spearman" ? "spearthrust" : cls === "battlemage" ? "hammerslam" : cls === "assassin" ? "daggerstabr" : "swordslash";
        heroBusy = playHero(anim, false, 1.3);
        setTimeout(() => {
          if (cls === "assassin") {
            if (t) {
              deal(t, 2 * sk.dmgMult * power(), "phys", false, false, "#ffcf6a");
              t.stunT = 3;
              ring(t.node.position, 1.2, "#ffd84a");
            }
            return;
          }
          ring(hpos, sk.radius, "#ffd84a", 0.7);
          for (const m of mobs) {
            if (Vector3.Distance(m.node.position, hpos) > sk.radius + m.radius) continue;
            deal(m, sk.dmgMult * power(), skillType(), false, false, "#ffcf6a");
            m.stunT = 3;
          }
        }, 380);
        break;
      }
      case "arrowRain": {
        if (!t) return;
        heroBusy = playHero(cls === "archer" ? "bowshoot" : cls === "support" ? "onehanded" : ATTACK[cls][0], false, 1.2);
        rainAt = t.node.position.clone();
        rainT = 3;
        rainTick = 0;
        ring(rainAt, sk.radius, cls === "support" ? "#ff7a2a" : "#9fd0ff", 3, true);
        break;
      }
      case "massHeal": {
        heroBusy = playHero("onehanded", false, 1);
        const heal = magicPower2(level, attrs) * (MAGIC.heal.baseHeal + 0.7 * MAGIC.heal.healPerCharge) * 1.5;
        heroHeal(heal);
        ring(hpos, sk.radius, "#6fe08a", 0.9);
        break;
      }
      case "shadowStep": {
        heroBusy = playHero("roll", false, 1.6);
        forceCrit = true;
        if (cls === "archer") {
          hero.position.z -= 7;
          returnT = 1.2;
        } else if (t) {
          const dir = t.node.position.subtract(hpos).normalize();
          if (cls === "spearman") {
            for (const m of mobs) {
              const v = m.node.position.subtract(hpos);
              const along = Vector3.Dot(v, dir);
              if (along > 0 && along < 8 && v.subtract(dir.scale(along)).length() < 1.2 + m.radius) deal(m, 1.5 * s.hit, "phys", false, false, "#9fd0ff");
            }
          }
          hero.position.copyFrom(t.node.position.add(dir.scale(t.radius + 1.2)));
          hero.position.y = 0;
          returnT = 1.5;
        }
        ring(hpos, 1, "#6050a0", 0.5);
        break;
      }
      case "crush": {
        heroBusy = playHero(cls === "battlemage" ? "hammerslam" : "jump", false, 1.1);
        const at = t ? t.node.position.clone() : hpos.clone();
        setTimeout(() => {
          ring(at, sk.radius, "#ff9a3a", 0.8);
          ring(at, sk.radius * 0.6, "#ffcf6a", 0.5);
          for (const m of mobs) {
            if (Vector3.Distance(m.node.position, at) > sk.radius + m.radius) continue;
            deal(m, sk.dmgMult * power(), skillType(), false, false, "#ffae5a");
            m.stunT = Math.max(m.stunT, 1);
            m.bounceT = 0.6;
          }
        }, 520);
        break;
      }
      case "seal": {
        heroBusy = playHero("onehanded", false, 1.2);
        sealT = SEAL.duration;
        ring(hpos, sk.radius, cls === "battlemage" ? "#ff5a3a" : "#c79bff", SEAL.duration, true);
        break;
      }
    }
  }
  function heroHeal(v: number): void {
    const add = Math.min(v, s.hp - heroHp);
    if (add <= 0) return;
    heroHp += add;
    healTotal += add;
    float(hero.position.add(new Vector3(0, HERO_H + 0.5, 0)), `+${Math.round(add)}`, "#6fe08a");
  }

  function renderSkillBar(): void {
    skillBar.innerHTML = "";
    skills.forEach((id, i) => {
      const b = document.createElement("button");
      const cd = cds.get(id) ?? 0;
      b.style.cssText = `min-width:150px;padding:8px 12px;background:${cd > 0 ? "#22222c" : "#243a26"};color:#e6e0d0;border:1px solid #3f7a45;border-radius:8px;font:600 13px system-ui;opacity:${cd > 0 ? 0.6 : 1}`;
      b.textContent = `${i + 1} · ${SKILLS2[id].icon} ${skillName(id, cls)}${cd > 0 ? ` (${cd.toFixed(1)})` : ""}`;
      b.onclick = () => cast(id);
      skillBar.appendChild(b);
    });
  }
  addEventListener("keydown", (e) => {
    if (e.key === "1" && skills[0]) cast(skills[0]);
    if (e.key === "2" && skills[1]) cast(skills[1]);
  });

  // ---------------------------------------------------------------- панель
  ui.section("Герой");
  ui.select("Класс", CLASS_IDS.map((c) => `${CLASSES2[c].icon} ${CLASSES2[c].name}`), `${CLASSES2[cls].icon} ${CLASSES2[cls].name}`, (v) => {
    cls = CLASS_IDS.find((c) => v.endsWith(CLASSES2[c].name)) ?? cls;
    attrs = autoBuild(cls, level);
    skills = [...CLASSES2[cls].defaultSkills];
    refresh(true);
  });
  ui.slider("Уровень", 1, 100, 1, level, (v) => {
    level = v;
    attrs = autoBuild(cls, level);
    refresh(false);
  });
  ui.select("Оружие", ["обычное", "золото", "уникальное"], "золото", (v) => {
    tier = v === "обычное" ? 0 : v === "золото" ? 1 : 2;
    refresh(false);
    equip();
  });
  ui.toggle("Ассасин: два кинжала", dual, (v) => {
    dual = v;
    refresh(false);
    equip();
    rebuildClips();
  });

  ui.section("Атрибуты");
  const attrBox = ui.group();
  attrBox.style.display = "block";

  ui.section("Умения (любые 2)");
  const skillBox = ui.group();
  skillBox.style.display = "block";
  ui.toggle("Применять сами", autoSkills, (v) => (autoSkills = v));
  ui.note("Клавиши 1 и 2 — применить. Кнопки внизу экрана.");

  // Просмотр клипа: бой на паузе, клип крутится медленно или стоит на кадре.
  ui.section("Просмотр клипа");
  const viewBox = ui.group();
  viewBox.style.display = "block";
  let viewClip = "";
  let viewSpeed = 0.25;
  let viewFrame = -1;
  function renderView(): void {
    viewBox.innerHTML = "";
    const sel = document.createElement("select");
    sel.add(new Option("— бой —", ""));
    for (const k of heroRig?.anims.keys() ?? []) sel.add(new Option(k, k, false, k === viewClip));
    sel.onchange = () => {
      viewClip = sel.value;
      viewFrame = -1;
      applyView();
    };
    const sp = document.createElement("input");
    Object.assign(sp, { type: "range", min: "0", max: "1", step: "0.05", value: String(viewSpeed) });
    sp.oninput = () => {
      viewSpeed = Number(sp.value);
      viewFrame = -1;
      applyView();
    };
    const fr = document.createElement("input");
    Object.assign(fr, { type: "range", min: "0", max: "1", step: "0.01", value: "0" });
    fr.oninput = () => {
      viewFrame = Number(fr.value);
      applyView();
    };
    const row = (l: string, el: HTMLElement): void => {
      const r = document.createElement("div");
      r.style.cssText = "display:flex;align-items:center;gap:6px;margin:3px 0";
      const t = document.createElement("span");
      t.style.width = "70px";
      t.textContent = l;
      r.append(t, el);
      viewBox.appendChild(r);
    };
    row("Клип", sel);
    row("Скорость", sp);
    row("Кадр", fr);
  }
  function applyView(): void {
    if (!heroRig) return;
    if (!viewClip) {
      heroIdle();
      return;
    }
    const g = heroRig.anims.get(viewClip);
    if (!g) return;
    for (const a of heroRig.anims.values()) if (a !== g) a.stop();
    hero.position.copyFrom(HOME);
    if (viewFrame >= 0) {
      g.start(false, 1, g.from, g.to, false);
      g.goToFrame(g.from + (g.to - g.from) * viewFrame);
      g.pause();
    } else g.start(true, Math.max(0.01, viewSpeed), g.from, g.to, false);
  }

  ui.section("Манекены");
  const mobKeys = Object.keys(ELITE_MOBS).filter((k) => ELITE_MOBS[k].hp >= 30 && ELITE_MOBS[k].hp < 20000);
  const mobLabel = (k: string): string => `${ELITE_MOBS[k].name} (${ELITE_MOBS[k].level})`;
  ui.select("Моб", mobKeys.map(mobLabel), mobLabel(mobKey), (v) => {
    mobKey = mobKeys.find((k) => mobLabel(k) === v) ?? mobKey;
    resetMeters();
    void loadMobs();
    renderStats();
  });
  ui.select("Сколько", ["1", "3", "5"], "1", (v) => {
    mobCount = Number(v);
    resetMeters();
    void loadMobs();
  });
  ui.toggle("Мобы бьют героя", mobsHit, (v) => (mobsHit = v));
  ui.button("Сбросить счётчики", resetMeters);

  ui.section("Характеристики");
  const statBox = ui.group();
  statBox.style.display = "block";

  ui.section("Посадка оружия в руке");
  const seatBox = ui.group();
  seatBox.style.display = "block";

  const css = "display:flex;align-items:center;gap:6px;margin:3px 0";
  function renderAttrs(): void {
    const total = pointsAt(level);
    const free = total - spentOn(attrs);
    attrBox.innerHTML = `<div class="note">Свободно <b style="color:#e8c26a">${free}</b> из ${total} · цена растёт каждые ${ATTR2.costStep}</div>`;
    for (const k of ATTRS) {
      const r = document.createElement("div");
      r.style.cssText = css;
      r.title = ATTR_INFO[k].desc;
      const cost = stepCost(attrs[k]);
      r.innerHTML = `<span style="width:92px">${ATTR_INFO[k].icon} ${ATTR_INFO[k].short}</span>`;
      const minus = document.createElement("button");
      minus.textContent = "−";
      minus.onclick = () => {
        if (attrs[k] <= ATTR2.start) return;
        attrs[k]--;
        refresh(false);
      };
      const val = document.createElement("b");
      val.style.cssText = "width:28px;text-align:center";
      val.textContent = String(attrs[k]);
      const plus = document.createElement("button");
      plus.textContent = "+";
      plus.disabled = cost > free;
      plus.onclick = () => {
        if (stepCost(attrs[k]) > total - spentOn(attrs)) return;
        attrs[k]++;
        refresh(false);
      };
      const c = document.createElement("span");
      c.style.cssText = "opacity:.6;font-size:11px";
      c.textContent = `за ${cost}`;
      r.append(minus, val, plus, c);
      attrBox.appendChild(r);
    }
    const row = document.createElement("div");
    const auto = document.createElement("button");
    auto.textContent = "Авто-раскладка";
    auto.onclick = () => {
      attrs = autoBuild(cls, level);
      refresh(false);
    };
    const zero = document.createElement("button");
    zero.textContent = "Сброс";
    zero.onclick = () => {
      for (const k of ATTRS) attrs[k] = ATTR2.start;
      refresh(false);
    };
    row.append(auto, zero);
    attrBox.appendChild(row);
  }

  function renderSkills(): void {
    skillBox.innerHTML = "";
    for (const id of CLASSES2[cls].skills) {
      const sk = SKILLS2[id];
      const v = sk.variants?.[cls];
      const r = document.createElement("label");
      r.style.cssText = "display:flex;gap:6px;align-items:flex-start;margin:4px 0;cursor:pointer";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = skills.includes(id);
      cb.onchange = () => {
        if (cb.checked) {
          skills = [...skills, id];
          if (skills.length > 2) skills = skills.slice(-2);
        } else skills = skills.filter((x) => x !== id);
        renderSkills();
        renderSkillBar();
      };
      const t = document.createElement("span");
      t.innerHTML = `${sk.icon} <b>${v?.name ?? sk.name}</b> · ${(sk.cooldown * s.cdMul).toFixed(1)} с<br><span style="opacity:.65;font-size:11.5px">${v?.desc ?? sk.desc}</span>`;
      r.append(cb, t);
      skillBox.appendChild(r);
    }
  }

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  function renderStats(): void {
    const m = ELITE_MOBS[mobKey];
    const perHit = s.hit / (1 + s.critChance * (s.critMult - 1));
    const mobRaw = (MOB.attackDamage * m.dmgMul) / (m.attackCooldown ?? MOB.attackCooldown);
    const avoid = cls === "warrior" ? 1 - (1 - s.dodge) * (1 - SHIELD.blockChance) : s.dodge;
    const mobDps = mobRaw * (1 - (m.magicMelee ? s.resist : s.armor)) * (1 - avoid);
    const lines: [string, string][] = [
      ["Здоровье", Math.round(s.hp).toLocaleString("ru")],
      ["Физ. броня", pct(s.armor)],
      ["Маг. защита", pct(s.resist)],
      [cls === "warrior" ? "Уворот / блок щитом" : "Уворот", cls === "warrior" ? `${pct(s.dodge)} / ${pct(SHIELD.blockChance)}` : pct(s.dodge)],
      ["Бег", `${s.move.toFixed(1)} м/с`],
      ["Атак в секунду", s.rate.toFixed(2)],
      ["Удар (крит)", `${Math.round(perHit)} (${Math.round(perHit * s.critMult)})`],
      ["Крит: шанс / сила", `${pct(s.critChance)} / ×${s.critMult.toFixed(2)}`],
      [s.splashType === "magic" && s.splash > 0 ? (cls === "battlemage" ? "Волна молота" : "Сплэш огнешара") : "Пробивает целей", s.splash > 0 ? String(Math.round(s.splash)) : String(s.pierce)],
      ["Удар умений (сила)", `${Math.round(s.power)} · откат ×${s.cdMul.toFixed(2)}`],
      [`Урон ${m.name} по тебе`, `${mobDps.toFixed(1)}/с${m.magicMelee ? " (магия)" : ""}`],
    ];
    statBox.innerHTML = lines.map(([a, b]) => `<div style="display:flex;justify-content:space-between;margin:2px 0"><span style="opacity:.75">${a}</span><b>${b}</b></div>`).join("");
  }

  // Посадка: ползунки для оружия в правой (и левой) руке.
  function renderSeat(): void {
    seatBox.innerHTML = "";
    for (const side of ["R", "L"] as const) {
      const k = gear[`${side}K`];
      if (!k) continue;
      const t = seatOf(k, side);
      const h = document.createElement("div");
      h.className = "note";
      h.textContent = `${side === "R" ? "Правая" : "Левая"} рука — ${k}`;
      seatBox.appendChild(h);
      const fields: [string, () => number, (v: number) => void, number, number][] = [
        ["pos x", () => t.pos[0], (v) => (t.pos[0] = v), -0.5, 0.5],
        ["pos y", () => t.pos[1], (v) => (t.pos[1] = v), -0.5, 0.8],
        ["pos z", () => t.pos[2], (v) => (t.pos[2] = v), -0.5, 0.5],
        ["rot x", () => t.rot[0], (v) => (t.rot[0] = v), -Math.PI, Math.PI],
        ["rot y", () => t.rot[1], (v) => (t.rot[1] = v), -Math.PI, Math.PI],
        ["rot z", () => t.rot[2], (v) => (t.rot[2] = v), -Math.PI, Math.PI],
        ["размер", () => t.scale, (v) => (t.scale = v), 0.3, 4],
      ];
      for (const [label, get, set, min, max] of fields) {
        const r = document.createElement("div");
        r.style.cssText = css;
        const inp = document.createElement("input");
        Object.assign(inp, { type: "range", min: String(min), max: String(max), step: "0.005", value: String(get()) });
        inp.style.width = "130px";
        const out = document.createElement("b");
        out.textContent = get().toFixed(3);
        inp.oninput = () => {
          set(Number(inp.value));
          out.textContent = Number(inp.value).toFixed(3);
          seat(side);
        };
        // Клипы зависят от посадки — пересобираем, когда ползунок отпущен.
        inp.onchange = () => {
          rebuildClips();
          if (viewClip) applyView();
          else heroIdle();
        };
        const l = document.createElement("span");
        l.style.width = "50px";
        l.textContent = label;
        r.append(l, inp, out);
        seatBox.appendChild(r);
      }
    }
    const b = document.createElement("button");
    b.textContent = "Код посадки → консоль и буфер";
    b.onclick = () => {
      const f = (n: number): string => String(Number(n.toFixed(3)));
      const txt = [...SEATS.entries()]
        .map(([key, t]) => `  "${key}": { pos: [${t.pos.map(f).join(", ")}], rot: [${t.rot.map(f).join(", ")}], scale: ${f(t.scale)} },`)
        .join("\n");
      console.log(txt);
      void navigator.clipboard?.writeText(txt).catch(() => {});
      b.textContent = "Скопировано ✓";
    };
    seatBox.appendChild(b);
  }

  /** Пересчитать всё после правки; heroToo — перезагрузить модель героя (сменился класс). */
  function refresh(heroToo: boolean): void {
    s = summary();
    heroHp = Math.min(heroHp, s.hp);
    renderAttrs();
    renderSkills();
    renderStats();
    renderSkillBar();
    if (heroToo) {
      // Действующие умения прошлого класса — снять.
      sealT = rainT = 0;
      cds.clear();
      heroHp = s.hp;
      void loadHero().then(() => {
        renderSeat();
        renderView();
      });
      void loadMobs();
      resetMeters();
    }
  }

  // ---------------------------------------------------------------- кадр
  let heroCd = 0;
  let uiT = 0;
  ctx.onFrame((dt) => {
    now += dt;

    // Откаты умений.
    for (const [k, v] of cds) cds.set(k, Math.max(0, v - dt));
    heroBusy = Math.max(0, heroBusy - dt);
    if (viewClip) return;
    if (heroBusy === 0 && heroRig && !clip(IDLE[cls])?.isPlaying && !clip("idle")?.isPlaying) {
      const anyPlaying = [...heroRig.anims.values()].some((a) => a.isPlaying);
      if (!anyPlaying) heroIdle();
    }

    // Возврат на место после рывка.
    if (returnT > 0) {
      returnT -= dt;
      if (returnT <= 0) hero.position.copyFrom(HOME);
    }

    // Герой: лицом к цели, автоатака и умения.
    const t = target();
    if (t) {
      const dx = t.node.position.x - hero.position.x;
      const dz = t.node.position.z - hero.position.z;
      hero.rotation.y = Math.atan2(dx, dz);
    }
    heroCd -= dt;
    if (heroRig && t && heroCd <= 0 && heroBusy <= 0.05) {
      heroCd = 1 / s.rate;
      attack();
    }
    if (autoSkills && heroRig && t) for (const id of skills) if ((cds.get(id) ?? 0) <= 0 && heroBusy <= 0.05) cast(id);

    // Град/дождь: 5 волн за 3 с.
    if (rainT > 0) {
      rainT -= dt;
      rainTick -= dt;
      if (rainTick <= 0) {
        rainTick = 3 / SKILLS2.arrowRain.hits;
        ring(rainAt, SKILLS2.arrowRain.radius * (0.4 + Math.random() * 0.5), cls === "support" ? "#ff7a2a" : "#e8e0c8", 0.35);
        for (const m of mobs) {
          if (Vector3.Distance(m.node.position, rainAt) > SKILLS2.arrowRain.radius + m.radius) continue;
          deal(m, SKILLS2.arrowRain.dmgMult * power(), skillType(), true, false, cls === "support" ? "#ff9a5a" : "#cfe6ff");
          m.stunT = Math.max(m.stunT, 0.7);
        }
      }
    }
    // Печать: лечение/щит герою, замедление (и огонь) мобам.
    if (sealT > 0) {
      sealT -= dt;
      heroHealAcc += s.hp * SEAL.healFracPerSec * dt;
      if (heroHealAcc > s.hp * 0.03) {
        heroHeal(heroHealAcc);
        heroHealAcc = 0;
      }
      sealBurnAcc += dt;
      for (const m of mobs) if (Vector3.Distance(m.node.position, hero.position) < SKILLS2.seal.radius + m.radius + 6) m.slowT = 0.3;
      if (sealBurnAcc >= 1 && cls === "battlemage") {
        sealBurnAcc = 0;
        for (const m of mobs) if (Vector3.Distance(m.node.position, hero.position) < SKILLS2.seal.radius + m.radius + 6) deal(m, SEAL.burnPerSec * power(), "magic", false, false, "#ff7a5a");
      }
    }

    // Мобы: лицом к герою, удары.
    for (const m of mobs) {
      m.stunT = Math.max(0, m.stunT - dt);
      m.slowT = Math.max(0, m.slowT - dt);
      const dx = hero.position.x - m.node.position.x;
      const dz = hero.position.z - m.node.position.z;
      m.node.rotation.y = Math.atan2(dx, dz);
      if (m.bounceT > 0) {
        m.bounceT = Math.max(0, m.bounceT - dt);
        const k = m.bounceT / 0.6;
        m.node.position.y = (m.def.flying ? 0.6 : 0) + Math.sin(k * Math.PI) * 1.1;
      }
      place(m.bar, m.node.position.add(new Vector3(0, m.radius * 2 + 0.35 + (m.def.flying ? 0.6 : 0), 0)));
      (m.bar.firstChild as HTMLDivElement).style.width = `${(m.hp / m.maxHp) * 100}%`;
      m.bar.style.opacity = m.dead ? "0.2" : "1";
      if (m.dead || !mobsHit || m.stunT > 0) continue;
      m.atkT += dt * (m.slowT > 0 ? 1 - SEAL.slow : 1);
      const cd = m.def.attackCooldown ?? MOB.attackCooldown;
      if (m.atkT >= cd) {
        m.atkT = 0;
        mobPlay(m, ["punch", "front", "headbutt", "weapon"]);
        setTimeout(() => mobStrike(m), 330);
      }
    }

    // Снаряды.
    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i];
      sh.t += dt;
      const k = Math.min(1, sh.t / sh.dur);
      Vector3.LerpToRef(sh.from, sh.to(), k, sh.mesh.position);
      sh.mesh.position.y += Math.sin(k * Math.PI) * 0.6;
      if (k >= 1) {
        sh.mesh.dispose();
        shots.splice(i, 1);
        sh.done();
      }
    }
    // Кольца эффектов.
    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i];
      f.t += dt;
      const k = f.t / f.life;
      f.mesh.scaling.setAll(1 + k * f.grow);
      f.mesh.visibility = f.base * (f.life > 1.5 ? Math.min(1, (1 - k) * 4) : 1 - k);
      if (k >= 1) {
        f.mesh.dispose();
        fxs.splice(i, 1);
      }
    }
    // Всплывающие числа.
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.t += dt;
      f.pos.y += dt * 0.9;
      place(f.el, f.pos);
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 1.1));
      if (f.t > 1.1) {
        f.el.remove();
        floats.splice(i, 1);
      }
    }
    place(heroBar, hero.position.add(new Vector3(0, HERO_H + 0.25, 0)));
    (heroBar.firstChild as HTMLDivElement).style.width = `${(heroHp / s.hp) * 100}%`;

    uiT += dt;
    if (uiT > 0.25) {
      uiT = 0;
      while (log.length && log[0][0] < now - 10) log.shift();
      const win = Math.min(10, now - meterFrom) || 1;
      const dps10 = log.reduce((n, e) => n + e[1], 0) / win;
      const all = dmgTotal / Math.max(1, now - meterFrom);
      meterEl.textContent =
        `${CLASSES2[cls].icon} ${CLASSES2[cls].name} · ур. ${level}\n` +
        `DPS 10 с:   ${dps10.toFixed(1)}\n` +
        `DPS всего:  ${all.toFixed(1)}  (${Math.round(now - meterFrom)} с)\n` +
        `Убито: ${kills}  последний за ${lastTtk.toFixed(1)} с\n` +
        `Смертей: ${deaths}${deaths ? `  прожил ${lastTtd.toFixed(1)} с` : ""}\n` +
        (healTotal > 0 ? `Вылечено: ${Math.round(healTotal)}\n` : "") +
        `HP: ${Math.round(heroHp)} / ${Math.round(s.hp)}`;
      renderSkillBar();
    }
  });
  let heroHealAcc = 0;
  let sealBurnAcc = 0;

  function mobStrike(m: Dummy): void {
    if (m.dead) return;
    const head = hero.position.add(new Vector3(0, HERO_H + 0.4, 0));
    if (Math.random() < s.dodge) {
      float(head, "уворот", "#9fd0ff");
      return;
    }
    if (cls === "warrior" && Math.random() < SHIELD.blockChance) {
      float(head, "блок", "#9fd0ff");
      return;
    }
    const raw = MOB.attackDamage * m.def.dmgMul;
    const prot = m.def.magicMelee ? s.resist : s.armor;
    const d = raw * (1 - prot) * (sealT > 0 ? 1 - SEAL.shield : 1);
    heroHp -= d;
    float(head, `-${Math.round(d)}`, m.def.magicMelee ? "#c79bff" : "#ff6a6a");
    if (heroHp <= 0) {
      deaths++;
      lastTtd = now - heroBornAt;
      heroBornAt = now;
      heroHp = s.hp;
      float(head, "💀", "#fff", true);
    }
  }

  // Старт.
  heroHp = s.hp;
  heroBornAt = 0;
  refresh(false);
  await loadHero();
  renderSeat();
  renderView();
  await loadMobs();
  (window as unknown as { __classes: unknown }).__classes = { hero, mobs: () => mobs, SEATS, scene: scene as Scene };
}
