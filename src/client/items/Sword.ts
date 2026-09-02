import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { type WeaponTier } from "#shared/items";
import { spawnWeaponModel } from "./weaponModels";

/**
 * Меч — модель из пака (Ultimate RPG Items Pack). Начало координат — в рукояти,
 * клинок направлен по локальной оси +Y, кончик у y ≈ 1.02 (см.
 * `COMBAT.swordTipLocal` — по этой точке считается попадание).
 *
 * `base` — обычный стальной меч (`sword.glb`), `gold` — золотой (`sword_gold.glb`).
 * Модель пака ~2.3 ед. в высоту, кончик на model-y ≈ 1.92 → масштаб 0.5 и
 * сдвиг +0.06 ставят кончик ровно на 1.02, а гарду — примерно в origin.
 */
export function createSword(scene: Scene, tier: WeaponTier = "base"): Mesh {
  return spawnWeaponModel(scene, tier === "gold" ? "sword_gold" : "sword", {
    scale: 0.5,
    offset: new Vector3(0, 0.06, 0),
  });
}
