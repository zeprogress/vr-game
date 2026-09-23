import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import { WORLD } from "#shared/constants";

/**
 * Дешёвый горный задник по всему горизонту — прячет край карты (см. план
 * «озеро+горы»). Техника один в один как небо/звёзды в Sky.ts: один
 * смёрженный низкополигональный меш, `disableLighting` + `freezeWorldMatrix`,
 * без коллизий и без участия в клампе `playRadius` — чистая декорация, не
 * игровая геометрия. Один draw call, не пересчитывается по кадрам.
 */
export function createMountainRing(scene: Scene): Mesh {
  const R = WORLD.playRadius + 18; // сразу за границей, с запасом от травы/деревьев у края
  const COUNT = 40;

  const mat = new StandardMaterial("mountainRingMat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0.35, 0.39, 0.46); // холодный сизый — сливается с туманом/небом
  mat.disableLighting = true;
  mat.backFaceCulling = true;

  const peaks: Mesh[] = [];
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
    const dist = R + (Math.random() - 0.5) * 10;
    const h = 55 + Math.random() * 70;
    const w = 26 + Math.random() * 30;
    const cone = MeshBuilder.CreateCylinder(
      `mountainPeak${i}`,
      { diameterTop: 0, diameterBottom: w, height: h, tessellation: 6 },
      scene,
    );
    cone.position.set(Math.cos(a) * dist, h * 0.5 - 4, Math.sin(a) * dist);
    // Небольшой случайный поворот/наклон — иначе гряда выглядит слишком регулярной.
    cone.rotation.y = Math.random() * Math.PI;
    peaks.push(cone);
  }

  const merged = Mesh.MergeMeshes(peaks, true, true) as Mesh;
  merged.name = "mountainRing";
  merged.material = mat;
  merged.isPickable = false;
  merged.checkCollisions = false;
  merged.applyFog = true; // тонет в тумане на закате/рассвете вместе со всем миром
  merged.doNotSyncBoundingInfo = true;
  merged.freezeWorldMatrix();
  return merged;
}
