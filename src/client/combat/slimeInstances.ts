import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { trackMobMaterial } from "./mobLightTune";

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Слизни и плевуны — аппаратными инстансами (одна отрисовка на часть модели для ВСЕХ слизней сцены).
 *
 * Раньше у каждого слизня были свои клоны трёх частей модели (тело, светлые пятна, глаза) — три
 * отрисовки на моба, и прозрачные части сортировались по одной. Теперь на каждую часть есть один
 * скрытый меш-источник в сцене, а у слизня — инстансы, привязанные к его (скрытым) клонам: анимация
 * прыжка, сжатие, масштаб и позиция идут через клонов, как раньше. Цвет вида — в материале источника
 * (источник на вид и часть), прозрачность — в альфе цвета инстанса (смерть — тает). Прозрачные инстансы
 * Babylon сортирует от дальних к ближним (INSTANCEDMESH_SORT_TRANSPARENT) — наложения смешиваются верно.
 * Клоны остаются (isVisible=false): из них строится дальняя упрощённая копия (lodBuild).
 */
Mesh.INSTANCEDMESH_SORT_TRANSPARENT = true;

interface Src {
  mesh: Mesh;
  /** Тело и пятна — с прозрачностью в цвете инстанса; глаза — непрозрачные, без цвета инстанса. */
  colored: boolean;
}

const sources = new WeakMap<Scene, Map<string, Src>>();

/** Источник части `part` для вида `kind`: свой материал вида (как в recolorRig), общая геометрия модели. */
function sourceFor(scene: Scene, kind: string, part: string, tint: readonly [number, number, number], from: Mesh): Src {
  let byKey = sources.get(scene);
  if (!byKey) {
    byKey = new Map();
    sources.set(scene, byKey);
  }
  const key = `${kind}|${part}`;
  const have = byKey.get(key);
  if (have && !have.mesh.isDisposed()) return have;
  // Общая геометрия с клоном (clone без детей), свой материал; сам источник не рисуется.
  const mesh = from.clone(`slimeSrc_${key}`, null, true);
  mesh.parent = null;
  mesh.position.setAll(0);
  mesh.rotationQuaternion = null;
  mesh.rotation.setAll(0);
  mesh.scaling.setAll(1);
  // Модель приходит с отражённым масштабом: мировая матрица клона (и инстанса) «вывернута». Какую сторону
  // треугольников отсекать, Babylon решает по ИСТОЧНИКУ — даём ему тот же знак, иначе видна изнанка (чёрная).
  from.computeWorldMatrix(true);
  if (from.getWorldMatrix().determinant() < 0) mesh.scaling.y = -1;
  mesh.isPickable = false;
  mesh.isVisible = false; // инстансы остаются видимыми
  mesh.setEnabled(true);
  const eye = /eye/i.test(part);
  const mat = new StandardMaterial(`slimeMat_${key}`, scene);
  mat.maxSimultaneousLights = 1;
  if (eye) {
    mat.diffuseColor = new Color3(0.02, 0.02, 0.02);
    mat.specularColor = new Color3(0.12, 0.12, 0.12);
  } else {
    // Те же цвета, что recolorRig в Mob.ts: пятна (secondary) светлее тела.
    const k = /secondary/i.test(part) ? 1.4 : 1;
    mat.diffuseColor = new Color3(clamp01(tint[0] * k), clamp01(tint[1] * k), clamp01(tint[2] * k));
    mat.emissiveColor = new Color3(tint[0] * 0.2, tint[1] * 0.15, tint[2] * 0.23);
    mat.specularColor = new Color3(0.06, 0.06, 0.06);
    // < 1 — включает смешивание; прозрачность вида — в альфе цвета инстанса.
    mat.alpha = 0.999;
    mat.backFaceCulling = true; // одним слоем, без изнанки
    trackMobMaterial(mat); // ?moblight=1
  }
  mesh.material = mat;
  if (!eye) {
    // Цвет инстанса (белый × альфа) идёт атрибутом «color» — цветов вершин у модели нет.
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;
    mesh.registerInstancedBuffer("color", 4);
    mesh.instancedBuffers.color = new Color4(1, 1, 1, 1);
  }
  const src: Src = { mesh, colored: !eye };
  byKey.set(key, src);
  return src;
}

export interface SlimeInstances {
  /** Прозрачность тела 0..1 (смерть — тает). */
  setVisibility(v: number): void;
}

/**
 * Перевести клоны модели слизня на инстансы. `parts` — имена исходных материалов частей (до перекраски),
 * в том же порядке, что `meshes`. Клоны остаются в иерархии скрытыми (анимация, дальняя копия).
 */
export function instanceSlime(
  scene: Scene,
  kind: string,
  meshes: AbstractMesh[],
  parts: string[],
  tint: readonly [number, number, number],
  alpha: number,
): SlimeInstances {
  const colored: { inst: InstancedMesh; c: Color4 }[] = [];
  const eyes: InstancedMesh[] = [];
  meshes.forEach((m, i) => {
    if (m.isAnInstance || m.getTotalVertices() === 0 || !(m instanceof Mesh)) return;
    const src = sourceFor(scene, kind, parts[i] || `part${i}`, tint, m);
    const inst = src.mesh.createInstance("slimePart");
    // createInstance копирует преобразование источника (в т.ч. его −1 по Y) — у инстанса своё единичное:
    // мировая матрица = ровно матрица клона.
    inst.position.setAll(0);
    inst.rotationQuaternion = null;
    inst.rotation.setAll(0);
    inst.scaling.setAll(1);
    inst.parent = m;
    inst.isPickable = false;
    if (src.colored) {
      const c = new Color4(1, 1, 1, alpha);
      inst.instancedBuffers.color = c;
      colored.push({ inst, c });
    } else {
      eyes.push(inst);
    }
    m.isVisible = false;
  });
  return {
    setVisibility(v: number): void {
      for (const x of colored) x.c.a = alpha * v;
      // Глаза непрозрачные: прячем, когда тело почти растаяло.
      for (const e of eyes) e.isVisible = v > 0.35;
    },
  };
}
