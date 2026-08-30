import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { SHIELD } from "#shared/constants";
import { weaponDef, type WeaponTier } from "#shared/items";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";

/**
 * Щит. Плоскость щита — XZ, «наружу» смотрит локальная ось +Y
 * (та же схема, что у меча: клинок вдоль +Y).
 *
 * base — круглый деревянный, gold — вытянутый треугольник («капля»),
 * какими бывают кавалерийские щиты. Держатся одинаково: положение в руке
 * настраивается один раз на класс.
 */
export function createShield(scene: Scene, tier: WeaponTier = "base"): Mesh {
  if (tier !== "base") return createTriangleShield(scene, tier);
  const wood = new StandardMaterial("shieldWood", scene);
  wood.diffuseColor = new Color3(0.42, 0.26, 0.15);
  wood.emissiveColor = new Color3(0.1, 0.06, 0.04);
  wood.specularColor = new Color3(0.1, 0.1, 0.1);

  const iron = new StandardMaterial("shieldIron", scene);
  iron.diffuseColor = new Color3(0.62, 0.65, 0.7);
  iron.emissiveColor = new Color3(0.16, 0.17, 0.2);
  iron.specularColor = new Color3(0.7, 0.7, 0.7);
  iron.specularPower = 48;

  const r = SHIELD.radius;

  const body = MeshBuilder.CreateCylinder(
    "sh_body",
    { height: 0.035, diameter: r * 2, tessellation: 16 },
    scene,
  );
  body.material = wood;

  const rim = MeshBuilder.CreateCylinder(
    "sh_rim",
    { height: 0.05, diameter: r * 2.06, tessellation: 16 },
    scene,
  );
  rim.material = iron;
  rim.scaling.y = 0.6;

  const boss = MeshBuilder.CreateSphere("sh_boss", { diameter: r * 0.55, segments: 8 }, scene);
  boss.position.y = 0.03;
  boss.scaling.y = 0.55;
  boss.material = iron;

  const grip = MeshBuilder.CreateBox("sh_grip", { width: 0.12, height: 0.03, depth: 0.03 }, scene);
  grip.position.y = -0.05;
  grip.material = wood;

  const shield = Mesh.MergeMeshes([body, rim, boss, grip], true, true, undefined, false, true);
  if (!shield) throw new Error("не удалось собрать щит");
  shield.name = "shield";
  return shield;
}

/**
 * Вытянутый треугольный щит: широкий верх, острый низ.
 *
 * Собран из явной геометрии, а не из полос — иначе край получается лесенкой.
 * Плоскость щита XZ, толщина по Y — как у круглого, чтобы положение в руке
 * было общим для всего класса.
 */
function createTriangleShield(scene: Scene, tier: WeaponTier): Mesh {
  const tint = weaponDef("shield", tier).tint;

  const face = new StandardMaterial("shieldFace", scene);
  face.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
  face.emissiveColor = new Color3(tint[0] * 0.22, tint[1] * 0.2, tint[2] * 0.1);
  face.specularColor = new Color3(0.85, 0.8, 0.5);
  face.specularPower = 64;

  const w = SHIELD.radius * 2; // ширина широкого края
  const zTop = SHIELD.radius * 1.05; // широкий край
  const zTip = -SHIELD.radius * 2.05; // остриё
  const t = 0.035; // толщина

  const hw = w / 2;
  const hy = t / 2;
  // 0..2 — верхняя грань, 3..5 — нижняя.
  const positions = [
    -hw, hy, zTop, hw, hy, zTop, 0, hy, zTip,
    -hw, -hy, zTop, hw, -hy, zTop, 0, -hy, zTip,
  ];
  const indices = [
    0, 2, 1, // верх
    3, 4, 5, // низ
    0, 1, 4, 0, 4, 3, // широкий торец
    1, 2, 5, 1, 5, 4, // правый скос
    2, 0, 3, 2, 3, 5, // левый скос
  ];
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  // UV обязательны: без них MergeMeshes отказывается сливать нашу геометрию
  // с рукоятью из MeshBuilder — «разный набор атрибутов».
  const uvs = [0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1];

  const body = new Mesh("sh_tri", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.applyToMesh(body);
  body.material = face;

  const grip = MeshBuilder.CreateBox("sh_grip", { width: 0.12, height: 0.03, depth: 0.03 }, scene);
  grip.position.y = -0.05;
  grip.material = face;

  const shield = Mesh.MergeMeshes([body, grip], true, true, undefined, false, true);
  if (!shield) throw new Error("не удалось собрать треугольный щит");
  // Разворот на 180° по X вживляем в вершины: положение в руке настраивается
  // отдельно и не должно зависеть от того, как собрана модель.
  shield.rotation.x = Math.PI;
  shield.bakeCurrentTransformIntoVertices();
  shield.name = "shield";
  return shield;
}
