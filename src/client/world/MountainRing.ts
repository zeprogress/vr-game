import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import { WORLD } from "#shared/constants";

/** Азимут восхода/заката солнца (XZ-плоскость) — см. DayTime.ts dayState():
 *  sunPos = (cos(a), sin(a), -0.35).normalize(), a=0 — восход, a=PI — закат.
 *  Y тут — высота (elev), X/Z — та самая плоскость, в которой стоит кольцо
 *  гор. Держим тем же числом здесь, а не импортируем — незачем тянуть
 *  клиентский DayTime.ts в геометрию, значение просто зафиксировано форматом
 *  функции dayState и не гуляет само по себе. */
const SUNRISE_AZ = Math.atan2(-0.35, 1);
const SUNSET_AZ = Math.atan2(-0.35, -1);

function angDist(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * Дешёвый горный задник по всему горизонту — прячет край карты, но НЕ
 * закрывает восход/закат: в направлениях, где встаёт/садится солнце
 * (см. SUNRISE_AZ/SUNSET_AZ), высота гряды сильно занижена — солнце видно,
 * как оно выходит из-за горизонта и садится за него, а не выныривает из-за
 * гор. Сама гряда — далеко и невысоко (задник, не стена); гора у водопада
 * (MountainRing тут ни при чём) стоит отдельно и близко только у озера.
 *
 * Техника — как небо/звёзды в Sky.ts: один смёрженный низкополигональный
 * меш, `disableLighting` + `freezeWorldMatrix`, без коллизий и без участия в
 * клампе `playRadius` — чистая декорация. Один draw call.
 */
export function createMountainRing(scene: Scene): Mesh {
  const R = WORLD.playRadius * 2.1; // далеко на горизонте, не «стена» у края
  const COUNT = 48;
  const GAP = 0.5; // рад (~29°) — полураствор просвета под восход/закат

  const mat = new StandardMaterial("mountainRingMat", scene);
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.specularColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(0.4, 0.44, 0.5); // холодный сизый — сливается с туманом/небом
  mat.disableLighting = true;
  mat.backFaceCulling = true;

  const peaks: Mesh[] = [];
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;
    const gap = Math.min(angDist(a, SUNRISE_AZ), angDist(a, SUNSET_AZ));
    if (gap < GAP) continue; // просвет — солнцу есть где встать/сесть
    const dist = R + (Math.random() - 0.5) * 40;
    // Ниже и дальше, чем было: задник на горизонте, не вал перед носом.
    const h = 18 + Math.random() * 26;
    const w = 40 + Math.random() * 50;
    const cone = MeshBuilder.CreateCylinder(
      `mountainPeak${i}`,
      { diameterTop: 0, diameterBottom: w, height: h, tessellation: 6 },
      scene,
    );
    cone.position.set(Math.cos(a) * dist, h * 0.5 - 6, Math.sin(a) * dist);
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
