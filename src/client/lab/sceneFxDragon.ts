import { CAT_SUPERBOSSES, DRAGON, ELITE_MOBS, MOB } from "#shared/mobs";
import type { ActKind } from "#shared/net/messages";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Sfx } from "../audio/Sfx";
import { FireFx, FLAME, type FireAura } from "../ui/FireFx";
import { FXC } from "../ui/fxColors";
import { LordFeet, lordMouth, lordScale, lordStep, playDragonAct, type DragonCtx } from "../ui/DragonAct";
import { loadRig, recolorMonster } from "../world/models";
import type { LabCtx } from "./main";

/**
 * Владыка Бездны в лаборатории (lab.html?s=fx): модель в размере супербосса катакомб, герой-мишень перед ним,
 * кнопки — приёмы целиком (клип модели + огонь + звук) через тот же обработчик, что в игре (ui/DragonAct.ts).
 * Шаги (звук и пыль на касание стоп) — тот же разбор, что у моба в игре (LordFeet).
 */
export async function dragonLab(ctx: LabCtx): Promise<void> {
  const { scene, ui } = ctx;
  ui.section("🐉 Владыка Бездны");
  ui.note("Дракон справа от гиганта (x = 30) смотрит на героя-мишень (18 м). Кнопки — приёмы целиком, как в игре: клип, огонь, звук.");
  const sfx = new Sfx();
  const fire = FireFx.of(scene);
  const scale = ELITE_MOBS.catDragon.scaleMul * (CAT_SUPERBOSSES.find((b) => b.key === "catDragon")?.scale ?? 3);
  const lord = { x: 30, y: 0, z: -4 };
  const hero = { x: 30, y: 0, z: 14 };

  const make = await loadRig(scene, "monDragonBest");
  const rig = make();
  const holder = new TransformNode("labLord", scene);
  rig.root.parent = holder;
  rig.root.position.set(0, 0, 0);
  holder.scaling.setAll(((MOB.bodyRadius * 1.75) / rig.nativeHeight) * scale);
  holder.position.set(lord.x, lord.y, lord.z);
  recolorMonster(rig.root, undefined, false, "monDragonBest");
  for (const g of rig.anims.values()) {
    g.enableBlending = true;
    g.blendingSpeed = 0.07;
  }
  const dummy = MeshBuilder.CreateCapsule("labLordHero", { height: 1.8, radius: 0.35 }, scene);
  dummy.position.set(hero.x, 0.9, hero.z);

  let cur: AnimationGroup | undefined = rig.anims.get("idle");
  cur?.start(true);
  let loopName = "idle";
  /** Клип разово, потом — обратно в петлю. */
  const play = (name: string, sec: number): void => {
    const g = rig.anims.get(name);
    if (!g) return;
    cur?.stop();
    g.start(false);
    cur = g;
    fire.after(sec, () => {
      if (cur !== g) return;
      g.stop();
      cur = rig.anims.get(loopName);
      cur?.start(true);
    });
  };
  const loop = (name: string): void => {
    loopName = name;
    cur?.stop();
    cur = rig.anims.get(name);
    cur?.start(true);
  };

  const nodes = new Map<string, TransformNode | undefined>();
  const bone = (name: string): { x: number; y: number; z: number } | null => {
    if (!nodes.has(name)) nodes.set(name, rig.root.getDescendants(false).find((n) => n.name.endsWith(name)) as TransformNode | undefined);
    const n = nodes.get(name);
    if (!n) return null;
    const p = n.getAbsolutePosition();
    return { x: p.x, y: p.y, z: p.z };
  };
  const actx: DragonCtx = {
    scene,
    sfx,
    follow: (kind) => (kind === "mob" ? { x: lord.x, y: 6, z: lord.z } : { ...hero }),
    bone: (_id, name) => bone(name),
    ground: () => 0,
  };
  const act = (k: ActKind, at: { x: number; z: number }, o: { d?: number; r?: number; to?: { x: number; z: number } } = {}): void => {
    playDragonAct(actx, k, at.x, 0, at.z, "lord", o.d, o.to?.x, o.to?.z, o.r);
  };
  const btn = (label: string, fn: () => void): void =>
    ui.button(label, () => {
      sfx.resume();
      sfx.preloadLord();
      fn();
    });

  // Каждый кадр: шаги по касанию стоп, огонь ярости у лап.
  const feet = new LordFeet();
  let rage = false;
  let aura: FireAura | null = null;
  let k = 0;
  ctx.onFrame((dt) => {
    k ||= lordScale(bone);
    if (!k) return;
    feet.update(bone, lord.y, k, dt, (p) => lordStep(fire, sfx, p, lord.y, k, loopName === "run" ? 0.8 : 0.6));
    aura ??= fire.aura();
    aura?.place(lord.x, lord.y, lord.z, 1.3 * k, rage);
  });
  ui.button("📷 Камера на дракона", () => ctx.frame(lord.x, 5, lord.z + 6, 46));

  const H = DRAGON.hitSec;
  const C = DRAGON.clipSec;
  /** Пасть у земли — как на сервере (DRAGON.headFwd × масштаб впереди корня), курс — на героя (+Z). */
  const mouthGround = { x: lord.x, z: lord.z + DRAGON.headFwd * scale };

  btn("Укус", () => {
    play("attackbite", C.bite);
    const m = lordMouth(bone);
    if (m) sfx.at(m, () => sfx.lord("bite", 0.9));
    fire.after(H.bite, () => {
      const p = lordMouth(bone);
      if (p) fire.burst(p.x, p.y, p.z, FXC.fire, { count: 10, speed: 3, life: 0.45, grav: 3, size: 0.24 });
    });
  });
  btn("Огненное дыхание (в героя)", () => {
    play("attackbreath", C.breath);
    const B = DRAGON.breath;
    const to = { x: mouthGround.x, z: mouthGround.z + B.len };
    act("dragonBreath", mouthGround, { d: H.breathStart, r: B.half, to });
    fire.after(H.breathStart, () => act("dragonBreathGo", mouthGround, { d: H.breathEnd - H.breathStart, r: B.half, to }));
    fire.after(H.breathEnd, () => act("dragonBurn", mouthGround, { d: B.burnSec, r: B.half, to }));
  });
  btn("Удар хвостом (сектор справа-спереди)", () => {
    play("attacktail", C.tail);
    const to = { x: lord.x, z: lord.z + 1 };
    act("dragonTail", lord, { d: H.tail, r: DRAGON.tail.rMax, to });
    fire.after(H.tail, () => act("dragonTailHit", lord, { r: DRAGON.tail.rMax, to }));
  });
  btn("Метеоры (печать)", () => {
    play("magiccharge", C.charge);
    const M = DRAGON.meteor;
    const pts = [hero, { x: hero.x - 7, z: hero.z - 3 }, { x: hero.x + 6, z: hero.z - 5 }, { x: hero.x + 2, z: hero.z + 6 }];
    for (const p of pts) act("dragonMeteorMark", p, { r: M.r, d: H.charge + M.fall });
    fire.after(H.charge, () => {
      for (const p of pts) act("dragonMeteorFall", p, { d: M.fall });
    });
    fire.after(H.charge + M.fall, () => {
      for (const p of pts) act("dragonMeteorHit", p, { r: M.r });
    });
  });
  btn("Кольцо пламени (ярость)", () => {
    const R = DRAGON.ring;
    act("dragonRingMark", lord, { r: R.r, d: R.telegraph });
    fire.after(R.telegraph - H.wings, () => {
      play("attackwings", C.wings);
      sfx.at({ x: lord.x, y: 6, z: lord.z }, () => sfx.lord("wings"));
    });
    fire.after(R.telegraph, () => act("dragonRing", lord, { r: R.r }));
  });
  btn("Печать разбита", () => {
    play("hitreact", 0.6);
    act("dragonShieldBreak", lord, { r: DRAGON.headFwd * scale });
  });
  btn("Ярость (рёв)", () => {
    play("magiccharge", C.charge);
    act("dragonRage", lord, { d: C.charge });
    rage = true;
  });
  btn("Фырканье", () => {
    const m = lordMouth(bone);
    if (!m) return;
    fire.flame(FLAME.puff, m, { b: { x: m.x, y: m.y - 0.4 * k, z: m.z + k }, r: 0.5 * k, half: 0.5, life: 1.3, size: 0.2 * k, rise: 0.3 * k, count: 12, heat: rage ? 0.75 : 0.22 });
    sfx.at(m, () => sfx.lord("snort", 0.7));
  });
  btn("Стойка", () => loop("idle"));
  btn("Шаг", () => loop("walk"));
  btn("Бег", () => loop("run"));
  btn("Разворот влево", () => loop("turnl"));
  btn("Разворот вправо", () => loop("turnr"));
  btn("Смерть", () => {
    play("death", 4);
    sfx.at({ x: lord.x, y: 4, z: lord.z }, () => sfx.lord("death"));
  });
  ui.toggle("Ярость (огонь у лап)", rage, (v) => (rage = v));
}
