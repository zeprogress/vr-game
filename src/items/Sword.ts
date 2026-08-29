import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/**
 * Низкополигональный меч. Начало координат — в рукояти;
 * клинок направлен по локальной оси +Y, кончик примерно на y = 1.0.
 */
export function createSword(scene: Scene): Mesh {
  const steel = new StandardMaterial("swordSteel", scene);
  steel.diffuseColor = new Color3(0.78, 0.81, 0.86);
  steel.emissiveColor = new Color3(0.22, 0.24, 0.28); // не проваливается в чёрный
  steel.specularColor = new Color3(0.9, 0.9, 0.9);
  steel.specularPower = 64;

  const gold = new StandardMaterial("swordGold", scene);
  gold.diffuseColor = new Color3(0.7, 0.55, 0.24);
  gold.emissiveColor = new Color3(0.2, 0.15, 0.05);
  gold.specularColor = new Color3(0.4, 0.35, 0.15);

  const grip = new StandardMaterial("swordGrip", scene);
  grip.diffuseColor = new Color3(0.25, 0.15, 0.1);
  grip.specularColor = new Color3(0, 0, 0);

  const handle = MeshBuilder.CreateCylinder("s_handle", { height: 0.24, diameter: 0.05 }, scene);
  handle.position.y = -0.12;
  handle.material = grip;

  const pommel = MeshBuilder.CreateSphere("s_pommel", { diameter: 0.08, segments: 4 }, scene);
  pommel.position.y = -0.26;
  pommel.material = gold;

  const guard = MeshBuilder.CreateBox("s_guard", { width: 0.28, height: 0.05, depth: 0.06 }, scene);
  guard.material = gold;

  const blade = MeshBuilder.CreateBox("s_blade", { width: 0.07, height: 0.95, depth: 0.02 }, scene);
  blade.position.y = 0.5;
  blade.material = steel;

  const tip = MeshBuilder.CreateCylinder("s_tip", { height: 0.12, diameterBottom: 0.07, diameterTop: 0, tessellation: 4 }, scene);
  tip.position.y = 1.03;
  tip.material = steel;

  const sword = Mesh.MergeMeshes([handle, pommel, guard, blade, tip], true, true, undefined, false, true);
  if (!sword) throw new Error("не удалось собрать меч");
  sword.name = "sword";
  return sword;
}
