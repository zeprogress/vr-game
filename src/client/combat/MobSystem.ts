import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Room } from "colyseus.js";

import { SPITTER, SPITTER_CFG, BOSS_CFG } from "#shared/constants";
import type { ZoneState } from "#shared/net/schema";
import { Mob } from "./Mob";
import { Dummy } from "./Dummy";
import type { Hittable, HitReporter } from "./Hittable";
import type { Sfx } from "../audio/Sfx";

/**
 * Плевок летит на клиенте по собственной баллистике и мягко подтягивается
 * к серверной позиции. Иначе он двигался бы рывками — патчи приходят 20 раз
 * в секунду, а кадров в 3-4 раза больше.
 */
interface BallView {
  mesh: Mesh;
  pos: Vector3;
  vel: Vector3;
  /** Последняя скорость, пришедшая с сервера — чтобы не сбрасывать свою гравитацию каждый кадр. */
  srvVy: number;
}

/** Огненный снаряд игрока: раскалённое ядро + аддитивный ореол-пламя. */
interface BoltView {
  core: Mesh;
  glow: Mesh;
  pos: Vector3;
  vel: Vector3;
  r: number;
  age: number;
}

/**
 * Мобы, куклы и плевки — ВИД поверх состояния сервера (этап 6).
 * Держит `targets` (общий массив для CombatSystem) в актуальном виде.
 */
export class NetMobs {
  private room: Room<ZoneState> | null = null;
  private readonly mobs = new Map<string, Mob>();
  private readonly dummies = new Map<string, Dummy>();
  private readonly balls = new Map<string, BallView>();
  private readonly ballProto: Mesh; // плевок плевуна
  private readonly ballProtoBoss: Mesh; // плевок босса
  private readonly bolts = new Map<string, BoltView>();
  private readonly boltCoreProto: Mesh;
  private readonly boltGlowProto: Mesh;

  constructor(
    private readonly scene: Scene,
    private readonly sfx: Sfx,
    /** Общий массив целей — тот же, что получил CombatSystem. */
    private readonly targets: Hittable[],
    private readonly report: HitReporter,
    /** true — облегчённый вид мобов: без плашки, HP-полоски, ран; глаза остаются (слабый GPU). */
    private readonly leanMobs = false,
  ) {
    // Плевок в цвет своего моба, полупрозрачный.
    const spitBall = (name: string, tint: readonly [number, number, number]): Mesh => {
      const mat = new StandardMaterial(`${name}Mat`, scene);
      mat.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
      mat.emissiveColor = new Color3(tint[0] * 0.35, tint[1] * 0.35, tint[2] * 0.35);
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = 0.62;
      mat.backFaceCulling = true;
      const m = MeshBuilder.CreateSphere(name, { diameter: SPITTER.ballRadius * 2, segments: 6 }, scene);
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      return m;
    };
    this.ballProto = spitBall("spitBall", SPITTER_CFG.tint);
    this.ballProtoBoss = spitBall("spitBallBoss", BOSS_CFG.tint);

    // Огненный снаряд: раскалённое ядро (диаметр 1 — масштабируем под радиус).
    const coreMat = new StandardMaterial("boltCoreMat", scene);
    coreMat.diffuseColor = new Color3(0.05, 0.02, 0);
    coreMat.emissiveColor = new Color3(1, 0.62, 0.18);
    coreMat.specularColor = new Color3(0, 0, 0);
    coreMat.disableLighting = true;
    this.boltCoreProto = MeshBuilder.CreateSphere("boltCore", { diameter: 1, segments: 8 }, scene);
    this.boltCoreProto.material = coreMat;
    this.boltCoreProto.isPickable = false;
    this.boltCoreProto.setEnabled(false);

    // Ореол пламени — аддитивный билборд.
    const glowMat = new StandardMaterial("boltGlowMat", scene);
    glowMat.emissiveColor = new Color3(1, 0.4, 0.08);
    glowMat.diffuseColor = new Color3(0, 0, 0);
    glowMat.specularColor = new Color3(0, 0, 0);
    glowMat.disableLighting = true;
    glowMat.alphaMode = Constants.ALPHA_ADD;
    glowMat.disableDepthWrite = true;
    glowMat.alpha = 0.5;
    this.boltGlowProto = MeshBuilder.CreatePlane("boltGlow", { size: 1 }, scene);
    this.boltGlowProto.material = glowMat;
    this.boltGlowProto.isPickable = false;
    this.boltGlowProto.setEnabled(false);
  }

  attach(room: Room<ZoneState>): void {
    this.detach();
    this.room = room;

    room.state.mobs.onAdd((s, id) => {
      const m = new Mob(this.scene, s.kind, id, this.sfx, this.report, this.leanMobs);
      this.mobs.set(id, m);
      this.targets.push(m);
    }, true);
    room.state.mobs.onRemove((_s, id) => {
      const m = this.mobs.get(id);
      if (!m) return;
      this.mobs.delete(id);
      this.removeTarget(m);
      m.dispose();
    });

    room.state.dummies.onAdd((s, id) => {
      const d = new Dummy(this.scene, id, new Vector3(s.x, s.y, s.z), this.report);
      this.dummies.set(id, d);
      this.targets.push(d);
    }, true);
    room.state.dummies.onRemove((_s, id) => {
      const d = this.dummies.get(id);
      if (!d) return;
      this.dummies.delete(id);
      this.removeTarget(d);
      d.dispose();
    });
  }

  private removeTarget(t: Hittable): void {
    const i = this.targets.indexOf(t);
    if (i >= 0) this.targets.splice(i, 1);
  }

  update(dt: number, playerPos: Vector3, playerAim: Vector3): void {
    const room = this.room;
    if (!room) return;

    room.state.mobs.forEach((s, id) => {
      this.mobs.get(id)?.applyState(s, dt, playerPos, playerAim);
    });
    room.state.dummies.forEach((s, id) => {
      this.dummies.get(id)?.applyState(s, dt);
    });

    // Плевки: множество появляется/исчезает — синхронизируем меши.
    room.state.balls.forEach((s, id) => {
      let b = this.balls.get(id);
      if (!b) {
        const mesh = (s.boss ? this.ballProtoBoss : this.ballProto).clone(`spitBall_${id}`);
        mesh.setEnabled(true);
        b = {
          mesh,
          pos: new Vector3(s.x, s.y, s.z),
          vel: new Vector3(s.vx, s.vy, s.vz),
          srvVy: s.vy,
        };
        this.balls.set(id, b);
        // Новый плевок = плевун только что выстрелил — звук с той стороны.
        this.sfx.spitterFire({ x: s.x, y: s.y, z: s.z });
      }

      // Пришёл новый патч — берём скорость сервера как есть.
      if (s.vy !== b.srvVy) {
        b.vel.set(s.vx, s.vy, s.vz);
        b.srvVy = s.vy;
      }
      // Между патчами летим сами с той же гравитацией, что на сервере.
      b.vel.y -= SPITTER.ballGravity * dt;
      b.pos.addInPlaceFromFloats(b.vel.x * dt, b.vel.y * dt, b.vel.z * dt);

      // И мягко сходимся с серверной позицией, чтобы не расходиться.
      const k = 1 - Math.exp(-dt * 8);
      b.pos.x += (s.x - b.pos.x) * k;
      b.pos.y += (s.y - b.pos.y) * k;
      b.pos.z += (s.z - b.pos.z) * k;

      b.mesh.position.copyFrom(b.pos);
    });
    for (const [id, b] of this.balls) {
      if (!room.state.balls.has(id)) {
        b.mesh.dispose();
        this.balls.delete(id);
      }
    }

    // Огненные снаряды игроков.
    const cam = this.scene.activeCamera;
    room.state.bolts.forEach((s, id) => {
      let bo = this.bolts.get(id);
      if (!bo) {
        const core = this.boltCoreProto.clone(`bolt_${id}`);
        const glow = this.boltGlowProto.clone(`boltGlow_${id}`);
        core.setEnabled(true);
        glow.setEnabled(true);
        bo = {
          core,
          glow,
          pos: new Vector3(s.x, s.y, s.z),
          vel: new Vector3(s.vx, s.vy, s.vz),
          r: s.r || 0.15,
          age: 0,
        };
        this.bolts.set(id, bo);
        this.sfx.at({ x: s.x, y: s.y, z: s.z }, () => this.sfx.bowRelease(0.6));
      }
      bo.age += dt;
      bo.vel.set(s.vx, s.vy, s.vz);
      bo.pos.addInPlaceFromFloats(s.vx * dt, s.vy * dt, s.vz * dt);
      const k = 1 - Math.exp(-dt * 10);
      bo.pos.x += (s.x - bo.pos.x) * k;
      bo.pos.y += (s.y - bo.pos.y) * k;
      bo.pos.z += (s.z - bo.pos.z) * k;

      const flick = 0.85 + 0.15 * Math.sin(bo.age * 40 + bo.pos.x);
      bo.core.position.copyFrom(bo.pos);
      bo.core.scaling.setAll(bo.r * 2 * flick);
      bo.glow.position.copyFrom(bo.pos);
      bo.glow.scaling.setAll(bo.r * 6 * flick);
      if (cam) bo.glow.lookAt(cam.globalPosition);
    });
    for (const [id, bo] of this.bolts) {
      if (!room.state.bolts.has(id)) {
        bo.core.dispose();
        bo.glow.dispose();
        this.bolts.delete(id);
      }
    }
  }

  detach(): void {
    for (const m of this.mobs.values()) {
      this.removeTarget(m);
      m.dispose();
    }
    for (const d of this.dummies.values()) {
      this.removeTarget(d);
      d.dispose();
    }
    for (const b of this.balls.values()) b.mesh.dispose();
    for (const bo of this.bolts.values()) {
      bo.core.dispose();
      bo.glow.dispose();
    }
    this.mobs.clear();
    this.dummies.clear();
    this.balls.clear();
    this.bolts.clear();
    this.room = null;
  }
}
