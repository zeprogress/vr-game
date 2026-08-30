import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Room } from "colyseus.js";

import { isItemId, ITEMS, type ItemId } from "#shared/items";
import { createSword } from "../items/Sword";
import type { ZoneState } from "#shared/net/schema";

interface DropView {
  mesh: Mesh;
  base: number;
  phase: number;
  /** Меч втыкается в землю клинком вниз, а не качается кубиком. */
  sword: boolean;
}

/**
 * Лут, лежащий в мире — вид поверх состояния сервера (этап 8).
 * Светящиеся кубики покачиваются и крутятся; подбор считает сервер.
 */
export class LootDrops {
  private room: Room<ZoneState> | null = null;
  private readonly views = new Map<string, DropView>();
  private readonly protos = new Map<ItemId, Mesh>();
  private clock = 0;

  constructor(scene: Scene) {
    for (const id of Object.keys(ITEMS) as ItemId[]) {
      const def = ITEMS[id];
      let proto: Mesh;

      if (def.sword) {
        // Настоящий меч, воткнутый в землю — его берут рукой.
        proto = createSword(scene, def.tint);
        proto.name = `dropProto_${id}`;
      } else {
        const mat = new StandardMaterial(`drop_${id}`, scene);
        mat.diffuseColor = new Color3(...def.tint);
        mat.emissiveColor = new Color3(def.tint[0] * 0.6, def.tint[1] * 0.6, def.tint[2] * 0.6);
        mat.specularColor = new Color3(0.2, 0.2, 0.2);
        proto = MeshBuilder.CreateBox(`dropProto_${id}`, { size: 0.28 }, scene);
        proto.material = mat;
      }
      proto.isPickable = false;
      proto.setEnabled(false);
      this.protos.set(id, proto);
    }
  }

  attach(room: Room<ZoneState>): void {
    this.detach();
    this.room = room;
  }

  update(dt: number): void {
    const room = this.room;
    if (!room) return;
    this.clock += dt;

    room.state.drops.forEach((s, id) => {
      let v = this.views.get(id);
      if (!v) {
        if (!isItemId(s.item)) return;
        const proto = this.protos.get(s.item);
        if (!proto) return;
        const mesh = proto.clone(`drop_${id}`);
        mesh.setEnabled(true);
        // Разводим фазу по id, чтобы кучка лута не качалась синхронно.
        v = { mesh, base: s.y, phase: hash01(id) * Math.PI * 2, sword: !!ITEMS[s.item].sword };
        this.views.set(id, v);
      }
      v.base = s.y;

      if (v.sword) {
        // Клинком вниз: остриё у земли, рукоять торчит вверх.
        v.mesh.position.set(s.x, s.y + 0.85, s.z);
        v.mesh.rotation.set(Math.PI, this.clock * 0.6 + v.phase, 0.22);
      } else {
        v.mesh.position.set(s.x, s.y + 0.06 + Math.sin(this.clock * 2 + v.phase) * 0.05, s.z);
        v.mesh.rotation.y = this.clock * 1.2 + v.phase;
      }
    });

    for (const [id, v] of this.views) {
      if (!room.state.drops.has(id)) {
        v.mesh.dispose();
        this.views.delete(id);
      }
    }
  }

  /** Ближайший лежащий меч — его берут рукой, а не подбирают автоматически. */
  nearestSword(from: Vector3): { id: string; pos: Vector3 } | null {
    let best: { id: string; pos: Vector3 } | null = null;
    let bestD = Infinity;
    for (const [id, v] of this.views) {
      if (!v.sword) continue;
      const d = Vector3.DistanceSquared(from, v.mesh.position);
      if (d < bestD) {
        bestD = d;
        best = { id, pos: v.mesh.position };
      }
    }
    return best;
  }

  detach(): void {
    for (const v of this.views.values()) v.mesh.dispose();
    this.views.clear();
    this.room = null;
  }
}

/** Стабильное 0..1 из строки — чтобы фаза качания не менялась между кадрами. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
