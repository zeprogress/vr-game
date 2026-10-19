import { ELITE_MOBS, ICE_GIANT, MOB } from "#shared/mobs";
import type { ActKind } from "#shared/net/messages";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { Sfx } from "../audio/Sfx";
import { IceFx, type IceAura } from "../ui/IceFx";
import { playIceGiantAct, type IceGiantCtx } from "../ui/IceGiantAct";
import { loadRig, recolorMonster } from "../world/models";
import type { LabCtx } from "./main";

/**
 * Ледяной гигант в лаборатории (lab.html?s=fx): модель в игровом размере, напротив — герой-мишень, кнопки —
 * умения целиком (клип модели + лёд + звук) через тот же обработчик, что в игре (ui/IceGiantAct.ts).
 */
export async function iceGiantLab(ctx: LabCtx): Promise<void> {
  const { scene, ui } = ctx;
  ui.section("❄️ Ледяной гигант");
  ui.note("Гигант в центре, герой-мишень в 16 м перед ним. Кнопки — умения целиком, как в игре: клип модели, лёд и звук.");
  const sfx = new Sfx();
  const G = ICE_GIANT;
  const H = MOB.bodyRadius * 1.75 * ELITE_MOBS.iceGiant.scaleMul;
  const giant = { x: 0, y: 0, z: -6 };
  const hero = { x: 0, y: 0, z: 10 };

  const make = await loadRig(scene, "monIceGiant");
  const rig = make();
  const holder = new TransformNode("labGiant", scene);
  rig.root.parent = holder;
  rig.root.position.set(0, 0, 0);
  holder.scaling.setAll(H / rig.nativeHeight);
  holder.position.set(giant.x, giant.y, giant.z);
  recolorMonster(rig.root, undefined, false, "monIceGiant");
  for (const g of rig.anims.values()) {
    g.enableBlending = true;
    g.blendingSpeed = 0.07;
  }
  const dummy = MeshBuilder.CreateCapsule("labHero", { height: 1.8, radius: 0.35 }, scene);
  dummy.position.set(hero.x, 0.9, hero.z);
  ctx.frame(0, 3, 2, 30);

  let cur: AnimationGroup | undefined = rig.anims.get("idle");
  cur?.start(true);
  let loopName = "idle";
  const ice = IceFx.of(scene);
  /** Клип разово, потом — обратно в петлю (стойка / шаг / бег). */
  const play = (name: string, sec: number): void => {
    const g = rig.anims.get(name);
    if (!g) return;
    cur?.stop();
    g.start(false);
    cur = g;
    ice.after(sec, () => {
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

  const hand = rig.root.getDescendants(false).find((n) => n.name.endsWith("Hand.R")) as TransformNode | undefined;
  const actx: IceGiantCtx = {
    scene,
    sfx,
    follow: (kind) => (kind === "mob" ? { x: giant.x, y: H, z: giant.z } : { ...hero }),
    bone: () => {
      if (!hand) return null;
      const p = hand.getAbsolutePosition();
      return { x: p.x, y: p.y, z: p.z };
    },
    ground: () => 0,
  };
  const act = (k: ActKind, at: { x: number; z: number }, o: { d?: number; r?: number; to?: { x: number; z: number }; id?: string } = {}): void => {
    playIceGiantAct(actx, k, at.x, 0, at.z, o.id ?? "giant", o.d, o.to?.x, o.to?.z, o.r);
  };
  const btn = (label: string, fn: () => void): void =>
    ui.button(label, () => {
      sfx.resume();
      sfx.preloadIceGiant();
      fn();
    });

  // Аура «Стужа»: кольцо и снег; ярость — метель.
  let fury = false;
  let auraOn = true;
  const aura: IceAura | null = ice.aura();
  ctx.onFrame(() => {
    if (aura) aura.place(giant.x, 0, giant.z, G.aura.radius * (fury ? G.fury.auraMul : 1), fury, auraOn);
  });

  btn("Размах правой", () => {
    play("attack", G.clipSec.attack);
    sfx.at({ x: giant.x, y: 3, z: giant.z }, () => sfx.ice("swipe"));
  });
  btn("Размах левой", () => {
    play("attack2", G.clipSec.attack);
    sfx.at({ x: giant.x, y: 3, z: giant.z }, () => sfx.ice("swipe"));
  });
  btn("Ледяной раскол", () => {
    play("slam", G.clipSec.slam);
    act("giantSlam", giant, { d: G.slam.windup, r: G.slam.radius });
    ice.after(G.slam.windup, () => act("giantSlamHit", giant, { r: G.slam.radius }));
  });
  btn("Ледяная глыба (бросок в героя)", () => {
    play("throw", G.clipSec.throw);
    act("giantThrowMark", hero, { d: G.throw.windup + G.throw.flight, r: G.throw.radius });
    ice.after(G.throw.windup, () => act("giantThrowFly", hero, { d: G.throw.flight, to: giant }));
    ice.after(G.throw.windup + G.throw.flight, () => act("giantThrowHit", hero, { r: G.throw.patchR, d: G.throw.patchSec }));
  });
  btn("Ледяной разлом (к герою)", () => {
    play("fissure", G.clipSec.fissure);
    const dz = Math.sign(hero.z - giant.z) || 1;
    const a = { x: giant.x, z: giant.z + dz * 2 };
    const b = { x: giant.x, z: a.z + dz * G.fissure.len };
    act("giantFissure", a, { d: G.fissure.windup, r: G.fissure.halfWidth, to: b });
    ice.after(G.fissure.windup, () => act("giantFissureGo", a, { d: G.fissure.len / G.fissure.speed, r: G.fissure.halfWidth, to: b }));
  });
  btn("Ледяная ярость (рёв, метель)", () => {
    play("roar", G.clipSec.roar);
    act("giantFury", giant, { d: G.fury.roarSec });
    fury = true;
  });
  let stacks = 0;
  btn("Стак «Обморожения» на герое", () => {
    stacks = (stacks % (G.frost.maxStacks - 1)) + 1;
    act("frostStack", hero, { id: "hero", d: stacks });
  });
  btn("«Ледяная глыба» — герой вмёрз", () => {
    stacks = 0;
    act("iceEncase", hero, { id: "hero", d: G.frost.freezeSec });
  });
  btn("Стойка", () => loop("idle"));
  btn("Шаг", () => loop("walk"));
  btn("Бег", () => loop("run"));
  btn("Вздрогнул", () => play("hitreact", 0.6));
  btn("Смерть", () => {
    play("death", 3.6);
    sfx.at({ x: giant.x, y: 2, z: giant.z }, () => sfx.ice("death"));
  });
  ui.toggle("Аура: в бою", auraOn, (v) => (auraOn = v));
  ui.toggle("Ярость (метель)", fury, (v) => (fury = v));
}
