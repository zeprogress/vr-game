import type { Scene } from "@babylonjs/core/scene";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

/**
 * Общие материалы мобов: один на (вид, часть, цвет, прозрачность) на сцену — вместо своего комплекта на
 * каждого моба. Меньше смен состояния на отрисовку, меньше материалов в сцене (раньше копились на каждый спавн).
 * Живут до конца сцены. Всё, что нужно менять на одном мобе (горение), — через личную копию (см. Mob.updateRigBurnTint).
 */
const cache = new WeakMap<Scene, Map<string, StandardMaterial>>();

export function sharedMobMaterial(scene: Scene, key: string, build: () => StandardMaterial): StandardMaterial {
  let m = cache.get(scene);
  if (!m) {
    m = new Map();
    cache.set(scene, m);
  }
  let mat = m.get(key);
  if (!mat || mat.getScene() !== scene) {
    mat = build();
    m.set(key, mat);
  }
  return mat;
}
