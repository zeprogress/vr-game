import type { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/**
 * Стрелы, торчащие из пригвождённого моба (град стрел). Один общий низкополигональный
 * прототип на сцену (один меш, один материал, цвета в вершинах); у моба — инстансы,
 * без покадровой работы: поза статична, включается/выключается по флагу состояния.
 */
const protos = new WeakMap<Scene, Mesh>();

function proto(scene: Scene): Mesh {
  let p = protos.get(scene);
  if (p && !p.isDisposed()) return p;
  // Стрела остриём вниз: древко, наконечник, оперение.
  const shaft = MeshBuilder.CreateBox("pinShaft", { width: 0.035, height: 0.9, depth: 0.035 }, scene);
  shaft.position.y = 0.45;
  const head = MeshBuilder.CreateCylinder(
    "pinHead",
    { height: 0.16, diameterTop: 0.09, diameterBottom: 0, tessellation: 4 },
    scene,
  );
  head.position.y = -0.06;
  const fletch = MeshBuilder.CreateBox("pinFletch", { width: 0.16, height: 0.14, depth: 0.012 }, scene);
  fletch.position.y = 0.86;
  const paint = (m: Mesh, c: Color4): void => {
    m.bakeCurrentTransformIntoVertices();
    const n = m.getTotalVertices();
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b, c.a], i * 4);
    m.setVerticesData(VertexBuffer.ColorKind, cols);
  };
  paint(shaft, new Color4(0.62, 0.42, 0.2, 1));
  paint(head, new Color4(0.8, 0.82, 0.86, 1));
  paint(fletch, new Color4(1, 0.78, 0.28, 1));
  const merged = Mesh.MergeMeshes([shaft, head, fletch], true, true, undefined, false, false);
  if (!merged) throw new Error("не удалось собрать стрелу");
  merged.name = "pinArrowProto";
  const mat = new StandardMaterial("pinArrowMat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(1, 1, 1); // цвет — из вершин, без освещения
  mat.specularColor = new Color3(0, 0, 0);
  mat.disableLighting = true;
  mat.freeze();
  merged.material = mat;
  merged.useVertexColors = true;
  merged.hasVertexAlpha = false;
  merged.isPickable = false;
  merged.setEnabled(false);
  protos.set(scene, merged);
  return merged;
}

/** Позы трёх стрел (x, z в долях радиуса тела, наклон по X/Z), нацелены остриём в тело. */
const POSES: readonly [number, number, number, number][] = [
  [0.0, 0.0, 0.0, 0.0],
  [0.45, 0.2, 0.0, -0.45],
  [-0.4, -0.3, 0.4, 0.3],
];

/** Создать набор стрел на узле моба; `radius` — радиус тела. Возвращает включатель. */
export function createPinArrows(
  scene: Scene,
  parent: TransformNode,
  radius: number,
): (on: boolean) => void {
  const src = proto(scene);
  const list: InstancedMesh[] = POSES.map(([x, z, rx, rz], i) => {
    const a = src.createInstance(`pin${i}`);
    a.parent = parent;
    a.isPickable = false;
    a.position.set(x * radius, radius * (1.55 - i * 0.12), z * radius);
    a.rotation.set(rx, 0, rz);
    a.scaling.setAll(Math.max(0.8, radius * 1.1));
    a.setEnabled(false);
    return a;
  });
  return (on) => {
    for (const a of list) a.setEnabled(on);
  };
}
