import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { type WeaponTier } from "#shared/items";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { spawnWeaponModel } from "./weaponModels";

export interface BowParts {
  mesh: Mesh;
  /** Локальные точки: концы плеч и точка покоя тетивы (центр). */
  topTip: Vector3;
  bottomTip: Vector3;
  nockRest: Vector3;
}

/** Масштаб/поворот модели лука из пака к контракту: плечи по Y, живот к −Z. */
const BOW_FIT = { scale: 0.69, yaw: Math.PI / 2 } as const;

/**
 * Лук — модель из пака. Начало координат в рукояти, плечи по оси Y,
 * прогиб (живот) к −Z, стрела летит в −Z.
 *
 * Лук в игре один (двумя руками не удержать, тетива/стрела привязаны к его
 * мешу), поэтому обе модели — обычная и золотая — висят на одном корне, а
 * `tintBow` просто переключает, какая включена.
 */
export function createBow(scene: Scene, tier: WeaponTier = "base"): BowParts {
  const root = new Mesh("bow", scene);
  root.isPickable = false;

  const wood = spawnWeaponModel(scene, "bow", BOW_FIT);
  wood.name = "bow_wood";
  wood.parent = root;

  const gold = spawnWeaponModel(scene, "bow_gold", BOW_FIT);
  gold.name = "bow_gold";
  gold.parent = root;

  applyBowTier(root, tier);

  return {
    mesh: root,
    topTip: new Vector3(0, 0.68, -0.02),
    bottomTip: new Vector3(0, -0.68, -0.02),
    nockRest: new Vector3(0, 0, 0.02),
  };
}

function applyBowTier(root: Mesh, tier: WeaponTier): void {
  for (const n of root.getChildren()) {
    if (n.name === "bow_wood") n.setEnabled(tier !== "gold");
    else if (n.name === "bow_gold") n.setEnabled(tier === "gold");
  }
}

/**
 * Переключить лук на нужный уровень (обычный ↔ золотой). Меняется только
 * видимость двух вложенных моделей — сам меш-корень тот же.
 */
export function tintBow(mesh: Mesh, tier: WeaponTier): void {
  applyBowTier(mesh, tier);
}
