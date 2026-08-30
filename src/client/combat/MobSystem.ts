import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Ray } from "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

import { PLAYER, SPITTER } from "#shared/constants";
import { segmentDistance } from "#shared/geometry";
import type { PlayerController } from "../player/PlayerController";
import type { Progression } from "../player/Progression";
import type { Sfx } from "../audio/Sfx";
import type { CombatSystem } from "./CombatSystem";
import type { Mob, MobContext } from "./Mob";

interface Ball {
  mesh: Mesh;
  vel: Vector3;
  prev: Vector3;
  life: number;
}

/** Крутит AI мобов и полёт их снарядов каждый кадр. */
export class MobSystem {
  private readonly ctx: MobContext;
  private readonly balls: Ball[] = [];
  private readonly ballProto: Mesh;
  private readonly scene: Scene;
  private readonly player: PlayerController;
  private readonly groundHeight: (x: number, z: number) => number;
  private readonly combat: () => CombatSystem;
  private readonly sfx: Sfx;

  /** Препятствие для плевка: видимая непроходимая геометрия (деревья, рельеф). */
  private readonly isSolid = (m: AbstractMesh): boolean => m.isPickable && m.checkCollisions;

  constructor(
    scene: Scene,
    private readonly mobs: Mob[],
    player: PlayerController,
    sfx: Sfx,
    prog: Progression,
    combat: () => CombatSystem,
    groundHeight: (x: number, z: number) => number,
  ) {
    this.scene = scene;
    this.player = player;
    this.groundHeight = groundHeight;
    this.combat = combat;
    this.sfx = sfx;

    const mat = new StandardMaterial("spitBallMat", scene);
    mat.diffuseColor = new Color3(0.7, 0.95, 0.4);
    mat.emissiveColor = new Color3(0.45, 0.75, 0.2);
    mat.specularColor = new Color3(0, 0, 0);
    this.ballProto = MeshBuilder.CreateSphere(
      "spitBall",
      { diameter: SPITTER.ballRadius * 2, segments: 6 },
      scene,
    );
    this.ballProto.material = mat;
    this.ballProto.isPickable = false;
    this.ballProto.setEnabled(false);

    this.ctx = {
      playerPos: player.position,
      groundHeight,
      hurtPlayer: (amount: number, dir: Vector3, from: Vector3) => {
        const mult = combat().absorbAttack(from);
        if (mult <= 0) return;
        player.damage(amount * mult, dir);
      },
      playerAim: new Vector3(0, 0, 1),
      fireBall: (from: Vector3) => this.fireBall(from),
      onHop: () => sfx.mobHop(),
      onHurt: () => sfx.mobHurt(),
      onDie: (_pos, xp) => {
        sfx.mobDie();
        prog.addXp(xp);
      },
    };
  }

  /** Грудь игрока — цель для плевка (стабильная, не «замороженная» плоская камера). */
  private chestTarget(): Vector3 {
    return this.player.position.subtract(new Vector3(0, 0.4, 0));
  }

  private fireBall(from: Vector3): void {
    if (this.balls.length >= SPITTER.maxBalls) {
      this.balls.shift()?.mesh.dispose();
    }
    const aim = this.chestTarget();
    // Баллистическая поправка: поднять прицел на величину падения за время полёта.
    const flat = aim.subtract(from);
    flat.y = 0;
    const L = flat.length();
    const t = L / SPITTER.ballSpeed;
    aim.y += 0.5 * SPITTER.ballGravity * t * t;
    const dir = aim.subtract(from);
    if (dir.lengthSquared() < 1e-6) return;
    dir.normalize();

    const mesh = this.ballProto.clone("spitBall");
    mesh.setEnabled(true);
    mesh.position.copyFrom(from);
    this.balls.push({
      mesh,
      vel: dir.scale(SPITTER.ballSpeed),
      prev: from.clone(),
      life: 0,
    });
    this.sfx.bowRelease(0.3);
  }

  update(dt: number): void {
    this.player.eyeForward.normalizeToRef(this.ctx.playerAim);
    for (const m of this.mobs) m.update(dt, this.ctx);
    this.updateBalls(dt);
  }

  private updateBalls(dt: number): void {
    // Капсула игрока: от ног до макушки (номинальная высота глаз).
    const head = this.player.position;
    const feet = new Vector3(head.x, head.y - PLAYER.eyeHeight, head.z);
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      b.prev.copyFrom(b.mesh.position);
      b.vel.y -= SPITTER.ballGravity * dt;
      b.mesh.position.addInPlace(b.vel.scale(dt));
      b.life += dt;

      let done = b.life > SPITTER.ballMaxLife;

      const step = b.mesh.position.subtract(b.prev);
      const len = step.length();

      // Попал в игрока? Путь шарика против капсулы тела.
      if (
        !done &&
        segmentDistance(b.prev, b.mesh.position, feet, head) < SPITTER.ballRadius + PLAYER.radius
      ) {
        const dir = b.vel.clone();
        dir.y = 0;
        if (dir.lengthSquared() > 1e-6) dir.normalize();
        const mult = this.combat().absorbAttack(b.mesh.position.clone(), true);
        if (mult > 0) {
          this.player.damage(SPITTER.ballDamage * mult, dir);
          this.sfx.playerHurt();
        }
        done = true;
      }

      // Врезался в дерево / другое препятствие на пути?
      if (!done && len > 1e-4) {
        const hit = this.scene.pickWithRay(
          new Ray(b.prev, step.scale(1 / len), len),
          this.isSolid,
        );
        if (hit?.hit) {
          this.sfx.arrowHit("wood", 0.5);
          done = true;
        }
      }

      // Земля (дешёвая подстраховка к raycast).
      if (!done && b.mesh.position.y <= this.groundHeight(b.mesh.position.x, b.mesh.position.z)) {
        this.sfx.arrowHit("wood", 0.4);
        done = true;
      }

      if (done) {
        b.mesh.dispose();
        this.balls.splice(i, 1);
      }
    }
  }
}
