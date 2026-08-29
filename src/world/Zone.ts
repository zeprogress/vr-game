import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/groundBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

/**
 * Простая тестовая зона: земля, свет и несколько препятствий-коробок.
 * Всё с checkCollisions, чтобы игрок не проходил сквозь.
 */
export function buildZone(scene: Scene): void {
  new HemisphericLight("ambient", new Vector3(0, 1, 0), scene).intensity = 0.7;

  const sun = new DirectionalLight("sun", new Vector3(-0.5, -1, -0.3), scene);
  sun.position = new Vector3(20, 40, 20);
  sun.intensity = 0.8;

  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = new Color3(0.32, 0.5, 0.28);
  groundMat.specularColor = new Color3(0, 0, 0);

  const ground = MeshBuilder.CreateGround("ground", { width: 120, height: 120 }, scene);
  ground.material = groundMat;
  ground.checkCollisions = true;

  const wallMat = new StandardMaterial("wallMat", scene);
  wallMat.diffuseColor = new Color3(0.55, 0.4, 0.35);
  wallMat.specularColor = new Color3(0, 0, 0);

  // Несколько препятствий вразброс.
  const blocks: Array<[number, number, number, number, number]> = [
    // x, z, width, depth, height
    [8, 6, 4, 4, 3],
    [-10, 12, 6, 2, 2.5],
    [3, -14, 2, 8, 4],
    [-6, -6, 3, 3, 2],
    [14, -4, 2, 2, 5],
  ];
  for (const [x, z, w, d, h] of blocks) {
    const box = MeshBuilder.CreateBox("block", { width: w, depth: d, height: h }, scene);
    box.position = new Vector3(x, h / 2, z);
    box.material = wallMat;
    box.checkCollisions = true;
  }

  // Ограждение по периметру, чтобы не убежать с карты.
  const border = 60;
  const fences: Array<[number, number, number, number]> = [
    [0, border, 120, 1],
    [0, -border, 120, 1],
    [border, 0, 1, 120],
    [-border, 0, 1, 120],
  ];
  for (const [x, z, w, d] of fences) {
    const f = MeshBuilder.CreateBox("fence", { width: w, depth: d, height: 4 }, scene);
    f.position = new Vector3(x, 2, z);
    f.material = wallMat;
    f.checkCollisions = true;
    f.isVisible = true;
  }
}
