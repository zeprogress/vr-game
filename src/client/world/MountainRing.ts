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
 * (см. SUNRISE_AZ/SUNSET_AZ), гряды в этом секторе просто нет — солнце видно,
 * как оно выходит из-за горизонта и садится за него. Сама гряда — далеко
 * (но внутри купола неба, Sky.ts — тот радиусом 450) и заметно крупнее
 * первой версии, чтобы читаться силуэтом издалека; ближняя гора у водопада
 * (MOUNTAIN, отдельная реальная геометрия в terrain.ts) тут ни при чём.
 *
 * Реалистичности ради — два тона одним мержем (не два разных мира): тёмная
 * скальная основа + светлее-сизая «дымка» ближе к вершине (атмосферная
 * перспектива на глаз). По-прежнему один drow-call на тон, `disableLighting`
 * + `freezeWorldMatrix`, без коллизий и без участия в клампе `playRadius`.
 */
export function createMountainRing(scene: Scene): Mesh {
  const R = WORLD.playRadius * 1.8; // далеко на горизонте, но внутри купола неба (450 м)
  const COUNT = 44;
  const GAP = 0.5; // рад (~29°) — полураствор просвета под восход/закат

  const rockMat = new StandardMaterial("mountainRingRockMat", scene);
  rockMat.diffuseColor = new Color3(0, 0, 0);
  rockMat.specularColor = new Color3(0, 0, 0);
  rockMat.emissiveColor = new Color3(0.3, 0.34, 0.42); // тёмная скальная основа
  rockMat.disableLighting = true;
  rockMat.backFaceCulling = true;

  const hazeMat = new StandardMaterial("mountainRingHazeMat", scene);
  hazeMat.diffuseColor = new Color3(0, 0, 0);
  hazeMat.specularColor = new Color3(0, 0, 0);
  hazeMat.emissiveColor = new Color3(0.56, 0.6, 0.68); // светлее, сизее — дымка на вершинах
  hazeMat.disableLighting = true;
  hazeMat.backFaceCulling = true;

  const rockPeaks: Mesh[] = [];
  const hazeCaps: Mesh[] = [];
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;
    const gap = Math.min(angDist(a, SUNRISE_AZ), angDist(a, SUNSET_AZ));
    if (gap < GAP) continue; // просвет — солнцу есть где встать/сесть
    const dist = R + (Math.random() - 0.5) * 60;
    const h = 42 + Math.random() * 46; // крупнее первой версии — читается издалека
    const w = 60 + Math.random() * 70;
    const yaw = Math.random() * Math.PI;
    const cone = MeshBuilder.CreateCylinder(
      `mountainPeak${i}`,
      { diameterTop: 0, diameterBottom: w, height: h, tessellation: 6 },
      scene,
    );
    cone.position.set(Math.cos(a) * dist, h * 0.5 - 8, Math.sin(a) * dist);
    cone.rotation.y = yaw;
    rockPeaks.push(cone);

    // Светлая «шапка» — верхняя четверть того же конуса, отдельным мешем
    // чуть меньшего радиуса у основания (садится поверх скалы, не протыкает).
    const capH = h * 0.32;
    const cap = MeshBuilder.CreateCylinder(
      `mountainCap${i}`,
      { diameterTop: 0, diameterBottom: w * 0.42, height: capH, tessellation: 6 },
      scene,
    );
    cap.position.set(
      Math.cos(a) * dist,
      h - 8 - capH * 0.5 + capH * 0.15,
      Math.sin(a) * dist,
    );
    cap.rotation.y = yaw;
    hazeCaps.push(cap);
  }

  const mergedRock = Mesh.MergeMeshes(rockPeaks, true, true) as Mesh;
  const mergedCaps = Mesh.MergeMeshes(hazeCaps, true, true) as Mesh;
  mergedRock.material = rockMat;
  mergedCaps.material = hazeMat;

  const merged = Mesh.MergeMeshes([mergedRock, mergedCaps], true, true, undefined, false, true) as Mesh;
  merged.name = "mountainRing";
  merged.isPickable = false;
  merged.checkCollisions = false;
  merged.applyFog = true; // тонет в тумане на закате/рассвете вместе со всем миром
  merged.doNotSyncBoundingInfo = true;
  merged.freezeWorldMatrix();
  return merged;
}
