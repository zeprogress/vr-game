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

/** Вспышка на месте разрыва снаряда: раздувается и гаснет. */
interface Burst {
  flash: Mesh;
  ring: Mesh;
  pos: Vector3;
  age: number;
  life: number;
  peak: number;
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
  private readonly burstFlashProto: Mesh;
  private readonly burstRingProto: Mesh;
  private readonly bursts: Burst[] = [];
  private burstSeq = 0;
  /** Ночная подсветка от огнешара — позиция и сила. Обновляется в update(). */
  private readonly fireLightPos = new Vector3();
  private fireLightPower = 0;
  fireLight(): { pos: Vector3; power: number } | null {
    return this.fireLightPower > 0.01 ? { pos: this.fireLightPos, power: this.fireLightPower } : null;
  }

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
    coreMat.alpha = 0.9;
    coreMat.disableDepthWrite = true;
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

    // Вспышка попадания: плотное бело-жёлтое ядро + оранжевое расходящееся
    // кольцо. Обычное альфа-смешивание (не аддитивное) — иначе на светлом небе
    // огонь не виден.
    const flashMat = new StandardMaterial("burstFlashMat", scene);
    flashMat.emissiveColor = new Color3(1, 0.93, 0.78);
    flashMat.diffuseColor = new Color3(0, 0, 0);
    flashMat.specularColor = new Color3(0, 0, 0);
    flashMat.disableLighting = true;
    flashMat.alphaMode = Constants.ALPHA_COMBINE;
    flashMat.disableDepthWrite = true;
    this.burstFlashProto = MeshBuilder.CreateSphere("burstFlash", { diameter: 1, segments: 10 }, scene);
    this.burstFlashProto.material = flashMat;
    this.burstFlashProto.isPickable = false;
    this.burstFlashProto.setEnabled(false);

    const ringMat = new StandardMaterial("burstRingMat", scene);
    ringMat.emissiveColor = new Color3(1, 0.42, 0.1);
    ringMat.diffuseColor = new Color3(0, 0, 0);
    ringMat.specularColor = new Color3(0, 0, 0);
    ringMat.disableLighting = true;
    ringMat.alphaMode = Constants.ALPHA_COMBINE;
    ringMat.disableDepthWrite = true;
    ringMat.backFaceCulling = false;
    this.burstRingProto = MeshBuilder.CreatePlane("burstRing", { size: 1 }, scene);
    this.burstRingProto.material = ringMat;
    this.burstRingProto.isPickable = false;
    this.burstRingProto.setEnabled(false);
  }

  /** Разрыв снаряда: `hit` — попал по цели (ярче, со звуком), иначе — угас. */
  private spawnBurst(pos: Vector3, radius: number, hit: boolean): void {
    if (this.bursts.length >= 10) {
      const old = this.bursts.shift();
      old?.flash.dispose(false, true);
      old?.ring.dispose(false, true);
    }
    const n = this.burstSeq++;
    const flash = this.burstFlashProto.clone(`burstF_${n}`);
    const ring = this.burstRingProto.clone(`burstR_${n}`);
    // Свой материал на каждую вспышку — гасим alpha индивидуально.
    flash.material = this.burstFlashProto.material!.clone(`burstFm_${n}`);
    ring.material = this.burstRingProto.material!.clone(`burstRm_${n}`);
    flash.setEnabled(true);
    ring.setEnabled(true);
    flash.position.copyFrom(pos);
    ring.position.copyFrom(pos);
    this.bursts.push({
      flash,
      ring,
      pos: pos.clone(),
      age: 0,
      life: hit ? 0.5 : 0.28,
      // Даже мелкий быстрый снаряд бьёт заметно; крупный — огненный шар.
      peak: Math.max(radius, 0.28) * (hit ? 5 : 2.4),
    });
    if (hit) this.sfx.at({ x: pos.x, y: pos.y, z: pos.z }, () => this.sfx.fireBurst(undefined, radius / 0.62));
  }

  private updateBursts(dt: number): void {
    const cam = this.scene.activeCamera;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const f = b.age / b.life;
      if (f >= 1) {
        b.flash.dispose(false, true);
        b.ring.dispose(false, true);
        this.bursts.splice(i, 1);
        continue;
      }
      const fade = 1 - f;
      // Ядро: мгновенно раздувается, держится, затем гаснет.
      const flashScale = b.peak * (0.55 + 0.45 * Math.min(1, f * 4)) * (0.55 + 0.45 * fade);
      b.flash.scaling.setAll(flashScale);
      (b.flash.material as StandardMaterial).alpha = Math.min(1, fade * 1.7);
      // Кольцо: расходится наружу и истончается.
      const ringScale = b.peak * (0.4 + 1.9 * f);
      b.ring.scaling.setAll(ringScale);
      (b.ring.material as StandardMaterial).alpha = fade * 0.8;
      if (cam) b.ring.lookAt(cam.globalPosition);
    }
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
        // Снаряд исчез: попал по цели или угас/врезался в землю. Определяем
        // по близости живой цели к его последней позиции.
        let hit = false;
        for (const m of this.mobs.values()) {
          const c = m.center?.();
          if (c && Vector3.Distance(c, bo.pos) < bo.r + 1.7) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          for (const d of this.dummies.values()) {
            const p = d.root.position;
            if (Vector3.Distance(new Vector3(p.x, p.y + 0.9, p.z), bo.pos) < bo.r + 1.5) {
              hit = true;
              break;
            }
          }
        }
        this.spawnBurst(bo.pos, bo.r, hit);
        bo.core.dispose();
        bo.glow.dispose();
        this.bolts.delete(id);
      }
    }

    this.updateBursts(dt);

    // Ночная подсветка от огнешара: приоритет у свежего взрыва, иначе — снаряд.
    this.fireLightPower = 0;
    for (const b of this.bursts) {
      const f = b.age / b.life;
      const p = b.peak * (1 - f) * 0.9;
      if (p > this.fireLightPower) {
        this.fireLightPower = p;
        this.fireLightPos.copyFrom(b.pos);
      }
    }
    if (this.fireLightPower < 1.5) {
      for (const bo of this.bolts.values()) {
        if (2 > this.fireLightPower) {
          this.fireLightPower = 2;
          this.fireLightPos.copyFrom(bo.pos);
        }
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
    for (const b of this.bursts.values()) {
      b.flash.dispose(false, true);
      b.ring.dispose(false, true);
    }
    this.bursts.length = 0;
    this.mobs.clear();
    this.dummies.clear();
    this.balls.clear();
    this.bolts.clear();
    this.room = null;
  }
}
