import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import type { Room } from "colyseus.js";

import { isItemId, ITEMS, type ItemId, type WeaponClass, type WeaponTier } from "#shared/items";
import { createSword } from "../items/Sword";
import { createShield } from "../items/Shield";
import { createBow } from "../items/Bow";
import type { ZoneState } from "#shared/net/schema";

interface DropView {
  mesh: Mesh;
  base: number;
  phase: number;
  /** Оружие стоит воткнутым в землю, а не качается кубиком. */
  weapon: { cls: WeaponClass; tier: WeaponTier } | null;
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

      if (def.weapon) {
        // Настоящее оружие, воткнутое в землю — его берут рукой.
        proto = makeWeaponMesh(scene, def.weapon.cls, def.weapon.tier);
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
        v = {
          mesh,
          base: s.y,
          phase: hash01(id) * Math.PI * 2,
          weapon: ITEMS[s.item].weapon ?? null,
        };
        this.views.set(id, v);
      }
      v.base = s.y;

      if (v.weapon) {
        // Воткнуто в землю: низ у земли, верх торчит.
        const lift = v.weapon.cls === "shield" ? 0.5 : 0.85;
        v.mesh.position.set(s.x, s.y + lift, s.z);
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

  /** Ближайшее лежащее оружие — его берут рукой, а не подбирают автоматически. */
  nearestWeapon(
    from: Vector3,
  ): { id: string; cls: WeaponClass; tier: WeaponTier; pos: Vector3 } | null {
    let best: { id: string; cls: WeaponClass; tier: WeaponTier; pos: Vector3 } | null = null;
    let bestD = Infinity;
    for (const [id, v] of this.views) {
      if (!v.weapon) continue;
      const d = Vector3.DistanceSquared(from, v.mesh.position);
      if (d < bestD) {
        bestD = d;
        best = { id, cls: v.weapon.cls, tier: v.weapon.tier, pos: v.mesh.position };
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

/** Меш под класс и уровень оружия — общий для лута и для рук. */
export function makeWeaponMesh(scene: Scene, cls: WeaponClass, tier: WeaponTier): Mesh {
  if (cls === "sword") return createSword(scene, ITEMS[weaponItemId(cls, tier)]?.tint);
  if (cls === "shield") return createShield(scene, tier);
  return createBow(scene, tier).mesh;
}

/** Предмет-лут, которым это оружие лежит в мире (для цвета). */
function weaponItemId(cls: WeaponClass, tier: WeaponTier): ItemId {
  const key = `${tier}_${cls}` as ItemId;
  return key in ITEMS ? key : "slime";
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
