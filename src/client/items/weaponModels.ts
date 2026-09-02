import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

import { containerFor, recolorFlat } from "../world/models";

/**
 * Модели оружия из пака (Ultimate RPG Items Pack, Quaternius): только плоские
 * цвета материалов, без текстур. Конверсия OBJ→glb — `obj2gltf`, файлы в
 * `public/models/weapons/`.
 *
 * Фабрики оружия синхронные (их зовёт конструктор CombatSystem), поэтому
 * `spawnWeaponModel` сразу отдаёт пустой корневой Mesh, а модель подвешивает
 * на него, когда догрузится контейнер. Попадания считаются по локальным
 * точкам-константам (кончик клинка и т.п.), не по геометрии, — оружие «бьёт»
 * даже за тот кадр, пока меш ещё летит по сети.
 */

export const WEAPON_MODELS = {
  sword: "/models/weapons/sword.glb",
  sword_gold: "/models/weapons/sword_gold.glb",
  bow: "/models/weapons/bow.glb",
  bow_gold: "/models/weapons/bow_gold.glb",
  crystal: "/models/weapons/crystal.glb",
} as const;

export type WeaponModel = keyof typeof WEAPON_MODELS;

export interface WeaponFit {
  /** Равномерный масштаб модели. */
  scale: number;
  /** Довороты модели перед подвесом (класс-специфичны). */
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Сдвиг после масштаба/поворота — чтобы точка хвата совпала с origin. */
  offset?: Vector3;
  /** Принудительный цвет всех материалов (иначе из пака). */
  tint?: Color3;
  /** Куда вешать (по умолчанию — на возвращаемый root). */
  parent?: TransformNode;
}

/** Прогреть контейнеры — вызвать один раз при старте, чтобы клоны были мгновенны. */
export function preloadWeaponModels(scene: Scene): void {
  for (const p of Object.values(WEAPON_MODELS)) void containerFor(scene, p);
}

/**
 * Синхронно вернуть корневой Mesh; асинхронно наполнить его плоскошейдерной
 * копией модели `key`, приведённой к локальному контракту оружия.
 * `onReady` — когда модель уже висит (для доводки конкретным классом).
 */
export function spawnWeaponModel(
  scene: Scene,
  key: WeaponModel,
  fit: WeaponFit,
  onReady?: (fitNode: TransformNode) => void,
): Mesh {
  const root = new Mesh(`w_${key}`, scene);
  void containerFor(scene, WEAPON_MODELS[key]).then((c) => {
    if (root.isDisposed()) return;
    const inst = c.instantiateModelsToScene((n) => n, false);
    const src = inst.rootNodes[0] as TransformNode | undefined;
    if (!src) return;

    // Обёртка: наш масштаб/поворот/сдвиг отдельно от конверсии координат glTF,
    // которая сидит в rotationQuaternion у src.
    const fitNode = new TransformNode(`${key}_fit`, scene);
    fitNode.parent = fit.parent ?? root;
    fitNode.rotationQuaternion = Quaternion.RotationYawPitchRoll(
      fit.yaw ?? 0,
      fit.pitch ?? 0,
      fit.roll ?? 0,
    );
    fitNode.scaling.setAll(fit.scale);
    if (fit.offset) fitNode.position.copyFrom(fit.offset);
    src.parent = fitNode;

    recolorFlat(src, fit.tint);
    // Палитра пака у оружия тёмная (тёмная сталь) — приподнимаем к свету.
    // Эмиссив маленький: пусть форму лепит солнце (иначе клинок плоский).
    // Немного блеска — сталь ловит блик от солнца.
    const done = new Set<StandardMaterial>();
    for (const m of src.getChildMeshes(false)) {
      m.isPickable = false;
      m.applyFog = true;
      const mat = m.material as StandardMaterial | null;
      if (mat && "emissiveColor" in mat && !done.has(mat)) {
        mat.diffuseColor = Color3.Lerp(mat.diffuseColor, new Color3(1, 1, 1), 0.3);
        mat.emissiveColor = mat.diffuseColor.scale(0.13);
        mat.specularColor = new Color3(0.35, 0.35, 0.35);
        mat.specularPower = 48;
        done.add(mat);
      }
    }
    onReady?.(fitNode);
  });
  return root;
}
