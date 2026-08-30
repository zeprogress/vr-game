import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import type { Room } from "colyseus.js";

import { SPITTER } from "#shared/constants";
import type { ZoneState } from "#shared/net/schema";
import { Mob } from "./Mob";
import { Dummy } from "./Dummy";
import type { Hittable, HitReporter } from "./Hittable";
import type { Sfx } from "../audio/Sfx";

/**
 * Мобы, куклы и плевки — ВИД поверх состояния сервера (этап 6).
 * Держит `targets` (общий массив для CombatSystem) в актуальном виде.
 */
export class NetMobs {
  private room: Room<ZoneState> | null = null;
  private readonly mobs = new Map<string, Mob>();
  private readonly dummies = new Map<string, Dummy>();
  private readonly balls = new Map<string, Mesh>();
  private readonly ballProto: Mesh;

  constructor(
    private readonly scene: Scene,
    private readonly sfx: Sfx,
    /** Общий массив целей — тот же, что получил CombatSystem. */
    private readonly targets: Hittable[],
    private readonly report: HitReporter,
  ) {
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
  }

  attach(room: Room<ZoneState>): void {
    this.detach();
    this.room = room;

    room.state.mobs.onAdd((s, id) => {
      const m = new Mob(this.scene, s.kind, id, this.sfx, this.report);
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
      let m = this.balls.get(id);
      if (!m) {
        m = this.ballProto.clone(`spitBall_${id}`);
        m.setEnabled(true);
        this.balls.set(id, m);
      }
      m.position.set(s.x, s.y, s.z);
    });
    for (const [id, m] of this.balls) {
      if (!room.state.balls.has(id)) {
        m.dispose();
        this.balls.delete(id);
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
    for (const b of this.balls.values()) b.dispose();
    this.mobs.clear();
    this.dummies.clear();
    this.balls.clear();
    this.room = null;
  }
}
