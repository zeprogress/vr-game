import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/torusBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import {
  CLASSES2,
  CLASS_IDS,
  SKILLS2,
  WEAPONS2,
  autoBuild,
  plagueAtk,
  skillCooldownFor,
  skillDesc,
  skillName,
  type Attrs,
  type ClassId,
  type SkillId,
} from "#shared/classes2";
import { skillDamageText } from "#shared/skillDamage";
import { hammerPhysStrike, skillStrike } from "#shared/strike";
import { skillShow, skillShowCoverage, type ShowAct, type ShowMob } from "#shared/skillShow";
import { ClassFx, playClassAct, type ClassActCtx } from "../ui/ClassFx";
import { SkillVfx } from "../ui/SkillVfx";
import { SkillFx } from "../ui/SkillFx";
import { playSteelAct } from "../ui/SteelAct";
import { playDrawAct } from "../ui/DrawAct";
import type { IceGiantCtx } from "../ui/IceGiantAct";
import type { Sfx } from "../audio/Sfx";
import { HandGrip, handsBusy } from "../entities/handGrip";
import { BOT_GEAR, seatFor, type GearKind } from "../entities/botGear";
import { createClassWeapon } from "../items/classWeapons";
import { makeWeaponMesh } from "../world/LootDrops";
import { buildClassClips } from "../world/classPoses";
import { loadRig, recolorCharacter, KEEP_MATERIALS, type RigInstance } from "../world/models";
import { ATTACK, gearOf, HERO_H, HERO_MODEL, IDLE, type Kind } from "./classSetup";
import type { LabCtx } from "./main";

/**
 * 🎬 Полигон умений — проверка ВСЕХ умений класса и их визуала на настоящем коде игры.
 *
 * Числа (откат, радиус, урон, описание) считают функции shared/*: те же, что у
 * сервера и окон умений. Список умений берётся из CLASSES2 — в лаборатории нет
 * своей копии. Сценарий эффектов — shared/skillShow.ts, а проигрывают его
 * настоящие обработчики: playClassAct / playSteelAct / playDrawAct / SkillFx.
 * Поэтому правка SKILLS2 или ClassFx сразу видна здесь.
 *
 * Манекены — элитные мобы с настоящими моделями и Idle. Урон по ним не считается:
 * полигон проверяет показ, а не баланс (для баланса — lab.html?s=classes).
 */

const HERO_ID = "lab-hero";
const TIER_NAMES = ["base", "gold", "legendary"] as const;
const MODE_NAMES = ["щит", "один меч", "два клинка"] as const;

interface Dummy {
  id: string;
  node: TransformNode;
  radius: number;
}

export async function build(ctx: LabCtx): Promise<void> {
  const { scene, ui } = ctx;
  const side = document.getElementById("side")!;
  side.style.width = "390px";

  // ---------------------------------------------------------------- состояние
  let cls: ClassId = "battlemage";
  let level = 33;
  let tier: 0 | 1 | 2 = 1;
  let dual = true;
  let mode: 0 | 1 | 2 = 0;
  let attrs: Attrs = autoBuild(cls, level);
  let targetId = "";
  let heroBusy = 0;
  let now = 0;

  // Прямые ссылки для проверки: ?cls=archer&skill=barrierArrow&level=60&mode=2.
  const q = new URLSearchParams(location.search);
  const qCls = q.get("cls") as ClassId | null;
  if (qCls && CLASS_IDS.includes(qCls)) cls = qCls;
  const qLevel = Number(q.get("level"));
  if (Number.isFinite(qLevel) && qLevel >= 1 && qLevel <= 100) level = Math.floor(qLevel);
  const qMode = Number(q.get("mode"));
  if (qMode === 0 || qMode === 1 || qMode === 2) mode = qMode;
  attrs = autoBuild(cls, level);

  // ---------------------------------------------------------------- сцена
  const hero = new TransformNode("labHero", scene);
  const holder = new TransformNode("labHeroHolder", scene);
  holder.parent = hero;

  let heroRig: RigInstance | null = null;
  let extraAnims: AnimationGroup[] = [];
  let fistR: TransformNode | null = null;
  let fistL: TransformNode | null = null;
  let grip: HandGrip | null = null;
  const gear: { R: Mesh | null; L: Mesh | null } = { R: null, L: null };
  const gearK: { R?: Kind; L?: Kind } = {};
  const seats = new Map<string, { pos: [number, number, number]; rot: [number, number, number]; scale: number; auto: boolean }>();
  let heroLoad = 0;

  let dummies: Dummy[] = [];
  let marker: Mesh | null = null;

  function seatOf(k: Kind, side2: "R" | "L") {
    const key = `${k}:${side2}`;
    let s = seats.get(key);
    if (!s) {
      const src = BOT_GEAR[k as GearKind];
      s = { pos: [...src.pos], rot: [...src.rot], scale: src.scale, auto: false };
      seats.set(key, s);
    }
    return s;
  }

  function clip(name: string): AnimationGroup | undefined {
    return heroRig?.anims.get(name);
  }

  function playHero(name: string, loop = false, speed = 1): number {
    const g = clip(name) ?? clip(IDLE[cls]) ?? clip("idle");
    if (!g || !heroRig) return 0;
    for (const a of heroRig.anims.values()) if (a !== g) a.stop();
    g.start(loop, speed, g.from, g.to, false);
    return (g.to - g.from) / 60 / speed;
  }

  function heroIdle(): void {
    playHero(clip(IDLE[cls]) ? IDLE[cls] : "idle", true);
  }

  /** Клип каста: не выдумываем движения, а берём классовые/родные клипы игры. */
  function castClip(id: SkillId): string {
    if (id === "shadowStep" || id === "abyss") return "roll";
    if (id === "crush") return cls === "battlemage" ? "hammerslam" : "jump";
    if (id === "whirlwind") return clip("skwhirlwind") ? "skwhirlwind" : ATTACK[cls][0];
    if (id === "stunBash" && cls === "assassin") return "daggerstabr";
    if (cls === "archer") return "bowshoot";
    if (cls === "support") return "onehanded";
    if (cls === "battlemage") return id === "chain" ? "onehanded" : "hammerslam";
    return ATTACK[cls][0];
  }

  async function loadHero(): Promise<void> {
    const my = ++heroLoad;
    for (const g of extraAnims) g.dispose();
    extraAnims = [];
    gear.R?.dispose();
    gear.L?.dispose();
    gear.R = gear.L = null;
    grip?.dispose();
    grip = null;
    heroRig?.dispose();
    heroRig = null;
    const names = Object.keys(gearK) as ("R" | "L")[];
    for (const s of names) delete gearK[s];
    const make = await loadRig(scene, HERO_MODEL[cls], { smoothNormals: true });
    if (my !== heroLoad) return;
    const rig = make();
    if (!KEEP_MATERIALS.has(HERO_MODEL[cls])) recolorCharacter(rig.root);
    rig.root.parent = holder;
    holder.scaling.setAll(HERO_H / rig.nativeHeight);
    const bone = (n: string): TransformNode | null =>
      (rig.root.getDescendants(false).find((d) => d.name === n && d.getClassName() === "TransformNode") as TransformNode) ?? null;
    fistR = bone("Fist.R");
    fistL = bone("Fist.L");
    heroRig = rig;
    grip = new HandGrip(scene, rig);
    equip();
    rebuildClips();
    heroIdle();
    heroBusy = 0;
  }

  function rebuildClips(): void {
    if (!heroRig) return;
    for (const g of extraAnims) g.dispose();
    extraAnims = buildClassClips(scene, heroRig, (s) => {
      const k = gearK[s];
      return k ? { ...seatOf(k, s), kind: k } : null;
    });
  }

  function equip(): void {
    const g = gearOf(cls, dual);
    for (const s of ["R", "L"] as const) {
      const k = g[s];
      delete gearK[s];
      const fist = s === "R" ? fistR : fistL;
      if (!k || !fist) continue;
      const mesh =
        k === "dagger" || k === "spear" || k === "hammer"
          ? createClassWeapon(scene, k, tier)
          : makeWeaponMesh(scene, k, k === "shield" ? "base" : TIER_NAMES[tier]);
      mesh.rotationQuaternion = null;
      mesh.parent = fist;
      gear[s] = mesh;
      gearK[s] = k;
      const t = seatFor(k as GearKind, fist, s, seatOf(k, s));
      mesh.position.set(t.pos[0], t.pos[1], t.pos[2]);
      mesh.rotation.set(t.rot[0], t.rot[1], t.rot[2]);
      mesh.scaling.setAll(t.scale);
    }
    grip?.setHolding(...handsBusy(gearK.L ?? "", gearK.R ?? ""));
  }

  // ---------------------------------------------------------------- манекены
  /** Деревянный манекен — тот же силуэт, что combat/Dummy.ts в игре, но без сети и HP. */
  function makeDummy(i: number, x: number, z: number): Dummy {
    const node = new TransformNode(`labDummy${i}`, scene);
    node.position.set(x, 0, z);
    const wood = new StandardMaterial(`labDummyWood${i}`, scene);
    wood.diffuseColor = new Color3(0.3, 0.2, 0.12);
    wood.specularColor = Color3.Black();
    const burlap = new StandardMaterial(`labDummyBody${i}`, scene);
    burlap.diffuseColor = new Color3(0.75, 0.68, 0.5);
    burlap.specularColor = Color3.Black();
    const post = MeshBuilder.CreateCylinder(`labPost${i}`, { height: 1, diameter: 0.16 }, scene);
    post.position.y = 0.5;
    post.material = wood;
    const torso = MeshBuilder.CreateCapsule(`labTorso${i}`, { height: 1, radius: 0.28 }, scene);
    torso.position.y = 0.5;
    torso.material = burlap;
    const head = MeshBuilder.CreateSphere(`labHead${i}`, { diameter: 0.34, segments: 6 }, scene);
    head.position.y = 1.15;
    head.material = burlap;
    const arms = MeshBuilder.CreateBox(`labArms${i}`, { width: 1.2, height: 0.16, depth: 0.16 }, scene);
    arms.position.y = 0.75;
    arms.material = burlap;
    for (const m of [post, torso, head, arms]) {
      m.parent = node;
      m.isPickable = false;
    }
    return { id: `dummy${i}`, node, radius: 0.55 };
  }

  function loadDummies(): void {
    for (const d of dummies) d.node.dispose();
    dummies = [];
    marker?.dispose();
    marker = null;
    const spots: [number, number][] = [[0, 5], [-3.2, 3.8], [3.2, 3.8], [0, 8.8]];
    spots.forEach(([x, z], i) => dummies.push(makeDummy(i, x, z)));
    fillTargets();
    marker = MeshBuilder.CreateTorus("labTarget", { diameter: 2.2, thickness: 0.06, tessellation: 40 }, scene);
    const mm = new StandardMaterial("labTargetMat", scene);
    mm.emissiveColor = new Color3(0.35, 0.85, 1);
    mm.diffuseColor = Color3.Black();
    mm.disableLighting = true;
    marker.material = mm;
    marker.isPickable = false;
    marker.setEnabled(false);
    ctx.frame(-3.2, 1.2, 4.2, 18);
  }

  function targetDummy(): Dummy | null {
    if (targetId) return dummies.find((d) => d.id === targetId) ?? null;
    let best: Dummy | null = null;
    let bd = Infinity;
    for (const d of dummies) {
      const dist = Math.hypot(d.node.position.x - hero.position.x, d.node.position.z - hero.position.z);
      if (dist < bd) {
        bd = dist;
        best = d;
      }
    }
    return best;
  }

  function showMobs(): ShowMob[] {
    return dummies.map((d) => ({
      id: d.id,
      x: d.node.position.x,
      y: d.node.position.y,
      z: d.node.position.z,
      r: d.radius,
      h: 1.6,
    }));
  }

  // ---------------------------------------------------------------- эффекты
  const classFx = new ClassFx(scene);
  const skillVfx = new SkillVfx(scene);
  const skillFx = new SkillFx(scene);
  classFx.vfx = skillVfx;
  const missingActs = new Set<string>();

  const follow = (kind: "hero" | "mob", id: string): { x: number; y: number; z: number } | null => {
    if (kind === "hero") return { x: hero.position.x, y: hero.position.y, z: hero.position.z };
    const d = dummies.find((o) => o.id === id);
    return d ? { x: d.node.position.x, y: d.node.position.y, z: d.node.position.z } : null;
  };
  skillVfx.follow = follow;

  const fakeSfx = {
    at: (_p: unknown, fn: () => void) => fn(),
    draw: () => {},
  } as unknown as Sfx;

  const iceCtx: IceGiantCtx = {
    scene,
    sfx: fakeSfx,
    follow,
    bone: () => null,
    ground: () => 0,
  };

  const actCtx: ClassActCtx = {
    fx: classFx,
    vfx: skillVfx,
    sound: () => {},
    sample: () => {},
    emote: (id, e) => {
      if (id === HERO_ID) playHero(e === "roll" ? "roll" : e === "jump" ? "jump" : "cheer", false, 1);
    },
    shoot: () => {
      playHero("bowshoot", false, 1.2);
    },
    shieldPos: () => ({ x: hero.position.x, y: hero.position.y + 1.1, z: hero.position.z }),
  };

  function dispatch(a: ShowAct): void {
    if (playClassAct(actCtx, a.k, a.x, a.y, a.z, HERO_ID, a.d, a.x2, a.z2, a.v, a.r, a.mobId)) return;
    if (playSteelAct(iceCtx, a.k, a.x, a.y, a.z, HERO_ID, a.d, a.x2, a.z2, a.r, a.mobId, a.v)) return;
    if (playDrawAct(iceCtx, a.k, a.x, a.y, a.z, HERO_ID, a.d, a.x2, a.z2, a.r, a.mobId, a.v)) return;
    // Старые эффекты (SkillFx): град рисует древки, которые playClassAct оставляет ему.
    if (a.k === "arrowRain") {
      skillFx.arrowRain(a.x, a.y, a.z, a.r ?? SKILLS2.arrowRain.radius, a.d ?? SKILLS2.arrowRain.castTime, 3);
      return;
    }
    if (a.k === "rainTick" || a.k === "healHit" || a.k === "crit") return;
    missingActs.add(a.k);
  }

  // ---------------------------------------------------------------- цифры и UI
  function liveAttrs(): Attrs {
    return { ...attrs };
  }

  function strikeOf(): { strike: number; phys?: number } {
    const hand = {
      mult: WEAPONS2[CLASSES2[cls].main].tiers[tier],
      tier: TIER_NAMES[tier],
      roll: 1,
    };
    const strike = skillStrike(cls, level, attrs, hand).dmg;
    if (cls === "battlemage") return { strike, phys: hammerPhysStrike(level, attrs, hand) };
    if (cls === "assassin") return { strike, phys: plagueAtk({ mult: hand.mult, roll: 1 }, 1) };
    return { strike };
  }

  const css = document.createElement("style");
  css.textContent = `
    .skl { border:1px solid #34394d; border-radius:8px; padding:7px 8px; background:#191c27; }
    .skl.on { border-color:#5b8fd6; box-shadow:0 0 0 1px #5b8fd655 inset; }
    .skl .top { display:flex; align-items:center; gap:6px; }
    .skl .nm { flex:1; font-weight:700; font-size:12px; }
    .skl .cd { font:11px ui-monospace,monospace; opacity:.85; }
    .skl .ds { font-size:11px; opacity:.72; margin-top:3px; }
    .skl .dm { font-size:11px; color:#9fd0ff; margin-top:3px; }
    .skl .go { border:1px solid #3f7a45; background:#243a26; color:#e6e0d0; border-radius:6px; padding:3px 7px; cursor:pointer; }
    .skl .go:hover { border-color:#7ee081; }
    .skl .bad { color:#ff7b6b; font-size:11px; }
    .skl .ok { color:#7ee081; font-size:11px; }
    .sklstatus { font:12px ui-monospace,monospace; color:#cfd6e6; white-space:pre-wrap; margin-top:8px; }
    .sklerr { color:#ff8a7a; }
  `;
  document.head.appendChild(css);

  ui.note("Один клик — умение целиком: клип героя, телеграф, удар, след. Числа — из shared/*, эффекты — из ClassFx/SkillFx, как в бою.");

  ui.select("Класс", CLASS_IDS.map((c) => `${CLASSES2[c].icon} ${CLASSES2[c].name}`), `${CLASSES2[cls].icon} ${CLASSES2[cls].name}`, (v) => {
    cls = CLASS_IDS.find((c) => v.endsWith(CLASSES2[c].name)) ?? cls;
    attrs = autoBuild(cls, level);
    readyAt.clear();
    reportCoverage();
    void loadHero().then(() => renderSkills());
  });

  ui.slider("Уровень", 1, 100, 1, level, (v) => {
    level = v;
    attrs = autoBuild(cls, level);
    renderSkills();
  });
  ui.select("Тир оружия", ["обычное", "золото", "уникальное"], "золото", (v) => {
    tier = v === "обычное" ? 0 : v === "золото" ? 1 : 2;
    void loadHero().then(() => renderSkills());
  });
  ui.toggle("Ассасин: два кинжала", dual, (v) => {
    dual = v;
    void loadHero().then(() => renderSkills());
  });
  ui.select("Режим оружия (аура/стягивание)", [...MODE_NAMES], MODE_NAMES[mode], (v) => {
    mode = MODE_NAMES.indexOf(v as (typeof MODE_NAMES)[number]) as 0 | 1 | 2;
  });

  // Цель: свой select, чтобы обновлять список после загрузки манекенов.
  const targetRow = document.createElement("label");
  targetRow.className = "row";
  const targetLabel = document.createElement("span");
  targetLabel.textContent = "Цель";
  const targetSel = document.createElement("select");
  targetRow.append(targetLabel, targetSel);
  document.getElementById("body")!.appendChild(targetRow);
  targetSel.onchange = () => {
    targetId = targetSel.value;
    updateMarker();
  };
  function fillTargets(): void {
    const cur = targetSel.value;
    targetSel.innerHTML = "";
    targetSel.add(new Option("авто (ближайший)", "", false, cur === ""));
    for (const d of dummies) targetSel.add(new Option(`манекен ${d.id.slice(-1)}`, d.id, false, cur === d.id));
    if (![...targetSel.options].some((o) => o.value === targetId)) targetId = "";
    targetSel.value = targetId;
  }

  ui.section("Умения класса");
  const list = document.createElement("div");
  list.style.cssText = "display:flex;flex-direction:column;gap:6px";
  document.getElementById("body")!.appendChild(list);

  const report = document.createElement("div");
  report.className = "sklstatus";
  document.getElementById("body")!.appendChild(report);

  const status = document.createElement("div");
  status.className = "sklstatus";
  document.getElementById("body")!.appendChild(status);

  const readyAt = new Map<SkillId, number>();
  const cdEls = new Map<SkillId, HTMLElement>();

  function reportCoverage(): void {
    const cov = skillShowCoverage();
    const lines = [
      `Сценарии: ${cov.covered}/${cov.total}${cov.missing.length ? ` · нет: ${cov.missing.join(", ")}` : " ✓"}`,
      `Класс: ${CLASSES2[cls].icon} ${CLASSES2[cls].name} · умений ${CLASSES2[cls].skills.length}`,
    ];
    report.textContent = lines.join("\n");
    report.className = cov.missing.length ? "sklstatus sklerr" : "sklstatus";
  }

  function renderSkills(): void {
    list.innerHTML = "";
    cdEls.clear();
    const live = liveAttrs();
    const { strike, phys } = strikeOf();
    for (const id of CLASSES2[cls].skills) {
      const sk = SKILLS2[id];
      const card = document.createElement("div");
      card.className = "skl";
      const top = document.createElement("div");
      top.className = "top";
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = `${sk.icon} ${skillName(id, cls)}`;
      const cd = document.createElement("span");
      cd.className = "cd";
      cd.textContent = `${skillCooldownFor(id, cls, live)} с`;
      cdEls.set(id, cd);
      const go = document.createElement("button");
      go.className = "go";
      go.textContent = "▶";
      go.title = "Показать умение";
      go.onclick = () => cast(id, true);
      top.append(nm, cd, go);
      const ds = document.createElement("div");
      ds.className = "ds";
      ds.textContent = skillDesc(id, cls, live);
      const dm = document.createElement("div");
      dm.className = "dm";
      dm.textContent = skillDamageText(id, cls, strike, live, phys) ?? "урон не наносит";
      const badge = document.createElement("div");
      const ok = skillShow(id, cls, { x: 0, y: 0, z: 0, mobs: [{ id: "t", x: 0, y: 0, z: 4 }] }) !== null;
      badge.className = ok ? "ok" : "bad";
      badge.textContent = ok ? "визуал: сценарий есть" : "визуал: НЕТ СЦЕНАРИЯ";
      card.append(top, ds, dm, badge);
      list.appendChild(card);
    }
    reportCoverage();
  }

  function cast(id: SkillId, force = false): void {
    const live = liveAttrs();
    const ready = readyAt.get(id) ?? 0;
    if (!force && now < ready) {
      status.textContent = `${skillName(id, cls)}: ещё ${(ready - now).toFixed(1)} с`;
      return;
    }
    readyAt.set(id, now + skillCooldownFor(id, cls, live));
    const dur = playHero(castClip(id), false, 1.15);
    heroBusy = Math.max(0.35, dur);
    const stage = {
      x: hero.position.x,
      y: hero.position.y,
      z: hero.position.z,
      tx: targetDummy()?.node.position.x,
      tz: targetDummy()?.node.position.z,
      targetId: targetDummy()?.id,
      mobs: showMobs(),
      attrs: live,
      mode,
      rad: 1,
      dur: 1,
    };
    const acts = skillShow(id, cls, stage);
    if (!acts) {
      status.textContent = `⚠ ${skillName(id, cls)}: нет визуального сценария`;
      return;
    }
    status.textContent = `▶ ${skillName(id, cls)} · ${CLASSES2[cls].name}`;
    const sorted = [...acts].sort((a, b) => a.at - b.at);
    for (const a of sorted) {
      if (a.at <= 0.001) dispatch(a);
      else timers.push({ at: now + a.at, fn: () => dispatch(a) });
    }
  }

  const timers: { at: number; fn: () => void }[] = [];
  let allRunning = false;

  function playAll(): void {
    if (allRunning) {
      timers.length = 0;
      allRunning = false;
      status.textContent = "Показ остановлен.";
      return;
    }
    allRunning = true;
    const ids = [...CLASSES2[cls].skills];
    ids.forEach((id, i) => timers.push({ at: now + 0.1 + i * 2.4, fn: () => cast(id, true) }));
    timers.push({ at: now + 0.1 + ids.length * 2.4, fn: () => (allRunning = false) });
    status.textContent = `Показ всех умений: ${ids.length} · ${Math.round(ids.length * 2.4)} с`;
  }

  ui.button("🎬 Показать все умения класса", playAll);
  ui.button("🧪 Проверить сценарии", () => {
    const cov = skillShowCoverage();
    reportCoverage();
    status.textContent = cov.missing.length
      ? `Нет сценария: ${cov.missing.join(", ")}`
      : `Все ${cov.total} пар «класс × умение» имеют сценарий. Не найдено эффектов: ${missingActs.size ? [...missingActs].join(", ") : "нет"}`;
  });

  function updateMarker(): void {
    const d = targetDummy();
    if (!marker) return;
    marker.setEnabled(!!d);
    if (d) marker.position.set(d.node.position.x, 0.08, d.node.position.z);
  }

  // ---------------------------------------------------------------- кадр
  ctx.onFrame((dt) => {
    now += dt;
    heroBusy = Math.max(0, heroBusy - dt);
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].at <= now) {
        const fn = timers[i].fn;
        timers.splice(i, 1);
        fn();
      }
    }
    classFx.update(dt);
    skillVfx.update(dt);
    skillFx.update(dt);
    updateMarker();
    if (heroRig && heroBusy <= 0 && ![...heroRig.anims.values()].some((a) => a.isPlaying)) heroIdle();
    for (const [id, el] of cdEls) {
      const left = (readyAt.get(id) ?? 0) - now;
      el.textContent = left > 0 ? `${left.toFixed(1)} с` : `${skillCooldownFor(id, cls, liveAttrs())} с`;
      const card = el.closest(".skl");
      card?.classList.toggle("on", left <= 0);
    }
  });

  // ---------------------------------------------------------------- старт
  renderSkills();
  await loadHero();
  loadDummies();
  updateMarker();
  reportCoverage();
  const qSkill = q.get("skill") as SkillId | null;
  const auto = qSkill && (CLASSES2[cls].skills as readonly string[]).includes(qSkill) ? qSkill : null;
  if (auto) {
    cast(auto, true);
    // ?repeat=1 — повторять для живой проверки анимации/частиц.
    if (q.get("repeat") === "1") timers.push({ at: now + 2.2, fn: () => cast(auto, true) });
  }
  if (q.get("all") === "1") playAll();
  (window as unknown as { __skillsLab: unknown }).__skillsLab = { hero, dummies: () => dummies, classFx, skillVfx, missingActs };
}
