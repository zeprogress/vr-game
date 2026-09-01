import type { Scene } from "@babylonjs/core/scene";
import type { AssetContainer } from "@babylonjs/core/assetContainer";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { PBRBaseMaterial } from "@babylonjs/core/Materials/PBR/pbrBaseMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/loaders/glTF/2.0";

/**
 * Пайплайн внешних ассетов (этап 12).
 *
 * `.glb` лежат в `public/models/` и грузятся по пути в рантайме (как музыка).
 * Каждый файл парсится один раз в `AssetContainer` (кэш на сцену), дальше —
 * дешёвые инстансы. Материалы из пака перекрашиваем в нашу плоскоцветную
 * палитру (эмиссив вместо бликов), иначе на фоне процедурного мира это
 * смотрится «ассет-флипом».
 */

export const MODELS = {
  pedestal: "/models/pedestal.glb",
} as const;

export type ModelName = keyof typeof MODELS;

const cache = new WeakMap<Scene, Map<string, Promise<AssetContainer>>>();

function containerFor(scene: Scene, path: string): Promise<AssetContainer> {
  let byPath = cache.get(scene);
  if (!byPath) {
    byPath = new Map();
    cache.set(scene, byPath);
  }
  let pending = byPath.get(path);
  if (!pending) {
    // Контейнер не добавляется в сцену — меши-исходники и так не рисуются,
    // instantiateModelsToScene() делает с них копии.
    pending = LoadAssetContainerAsync(path, scene);
    byPath.set(path, pending);
  }
  return pending;
}

export interface PlaceOpts {
  position?: Vector3;
  rotationY?: number;
  /** Явный масштаб. Игнорируется, если задан `fitHeight`. */
  scale?: number;
  /**
   * Подогнать модель под эту высоту (в метрах) равномерным масштабом.
   * CC0-паки приходят в произвольных единицах — так нормализуем не глядя.
   */
  fitHeight?: number;
  /**
   * Куда попадёт `position`: `"bottom"` (по умолчанию) — низ модели встаёт на
   * точку; `"center"` — центр габаритов; `"pivot"` — как в файле, без сдвига.
   */
  anchor?: "bottom" | "center" | "pivot";
  /** Принудительный цвет (иначе берём из материала пака и квантуем). */
  tint?: Color3;
  /** Заморозить трансформы и материалы (статичный проп). По умолчанию да. */
  frozen?: boolean;
}

/** Поставить экземпляр модели в сцену. Вернёт корневой узел. */
export async function placeModel(
  scene: Scene,
  name: ModelName,
  opts: PlaceOpts = {},
): Promise<TransformNode | null> {
  const c = await containerFor(scene, MODELS[name]);
  const inst = c.instantiateModelsToScene((n) => n, false);
  const root = inst.rootNodes[0] as TransformNode | undefined;
  if (!root) return null;

  if (opts.rotationY !== undefined) root.rotation.y = opts.rotationY;

  // Масштаб: либо явный, либо подгонка под высоту по габаритам иерархии.
  // Габариты меряем при scale=1; матрицы всех узлов должны быть свежими.
  root.scaling.setAll(1);
  root.position.setAll(0);
  for (const n of root.getDescendants(false)) n.computeWorldMatrix(true);
  root.computeWorldMatrix(true);
  const bb = root.getHierarchyBoundingVectors(true);
  const rawH = Math.max(1e-4, bb.max.y - bb.min.y);
  const s = opts.fitHeight ? opts.fitHeight / rawH : (opts.scale ?? 1);
  root.scaling.setAll(s);

  // Якорь: по умолчанию низ модели встаёт на точку position.
  const pos = opts.position ? opts.position.clone() : new Vector3(0, 0, 0);
  if (opts.anchor === "center") pos.y -= ((bb.min.y + bb.max.y) / 2) * s;
  else if (opts.anchor !== "pivot") pos.y -= bb.min.y * s;
  root.position.copyFrom(pos);

  recolorFlat(root, opts.tint);

  const frozen = opts.frozen ?? true;
  root.getChildMeshes(false).forEach((m) => {
    m.isPickable = false;
    m.applyFog = true;
    if (frozen) {
      m.freezeWorldMatrix();
      m.material?.freeze();
    }
  });
  if (frozen) root.freezeWorldMatrix();
  return root;
}

const q = (v: number): number => Math.round(v * 10) / 10;

/** PBR-материалы пака → наш плоский StandardMaterial. */
function recolorFlat(root: TransformNode, tint?: Color3): void {
  const seen = new Map<string, StandardMaterial>();
  for (const mesh of root.getChildMeshes(false)) {
    const src = mesh.material;
    if (!src) continue;
    const key = tint ? "tint" : src.id;
    let flat = seen.get(key);
    if (!flat) {
      const base =
        tint ??
        (src instanceof PBRBaseMaterial && "albedoColor" in src
          ? new Color3(
              q((src as unknown as { albedoColor: Color3 }).albedoColor.r),
              q((src as unknown as { albedoColor: Color3 }).albedoColor.g),
              q((src as unknown as { albedoColor: Color3 }).albedoColor.b),
            )
          : new Color3(0.6, 0.6, 0.62));
      flat = new StandardMaterial(`${src.name || "asset"}_flat`, root.getScene());
      flat.diffuseColor = base;
      flat.emissiveColor = base.scale(0.12);
      flat.specularColor = new Color3(0, 0, 0);
      // В зоне всего два источника (hemi + directional); не тянем лишнее на Mali.
      flat.maxSimultaneousLights = 2;
      seen.set(key, flat);
    }
    mesh.material = flat;
  }
}
