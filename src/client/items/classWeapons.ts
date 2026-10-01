import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import { attachLegendaryGlow, spawnWeaponModel } from "./weaponModels";

/**
 * Оружие новых классов: кинжал (ассасин), копьё (копейщик), молот (боевой
 * маг). Как у меча — начало координат в рукояти, клинок/боёк по +Y.
 * tier: 0 обычное, 1 золото, 2 уникальное (фиолетовое со свечением).
 */
export type NewWeapon = "dagger" | "spear" | "hammer";

/** Масштаб модели пака → метры в руке (меч 0.5 ≈ 1.15 м). */
export const NEW_WEAPON_SCALE: Record<NewWeapon, number> = {
  dagger: 0.3, // ~0.5 м
  spear: 0.3, // ~2.1 м
  hammer: 0.5, // ~1.5 м
};

const LEGEND_TINT = new Color3(0.62, 0.3, 1);

export function createClassWeapon(scene: Scene, w: NewWeapon, tier: 0 | 1 | 2 = 0): Mesh {
  const m = spawnWeaponModel(scene, tier === 1 ? `${w}_gold` : w, {
    scale: NEW_WEAPON_SCALE[w],
    tint: tier === 2 ? LEGEND_TINT : undefined,
  });
  if (tier === 2) attachLegendaryGlow(scene, m, w === "dagger" ? 0.2 : 0.35, 0.5);
  return m;
}
