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
 * (см. SUNRISE_AZ/SUNSET_AZ), гряды в этом секторе просто нет. Далеко (но
 * внутри купола неба, Sky.ts — тот радиусом 450), заметно крупнее первой
 * версии, чтобы читаться силуэтом издалека.
 *
 * Один тон (не два — «снежная шапка» смотрелась неестественно поверх
 * низкополигональных конусов), но НЕ однородный: у каждого пика своя
 * случайная яркость/оттенок в узком диапазоне холодной сизой гаммы — как
 * настоящая гряда, где соседние вершины чуть отличаются от освещения и
 * дымки, без выраженного рисунка «шапками». Раз цвет у каждого свой —
 * меш не мержится в один (тогда был бы один сплошной оттенок), а несколько
 * (по группам близких оттенков) — всё равно считаные draw call'ы, не 44.
 */
export function createMountainRing(scene: Scene): Mesh {
  const R = WORLD.playRadius * 1.8; // далеко на горизонте, но внутри купола неба (450 м)
  const COUNT = 44;
  const GAP = 0.5; // рад (~29°) — полураствор просвета под восход/закат
  const TONES = 5;

  const mats: StandardMaterial[] = [];
  for (let t = 0; t < TONES; t++) {
    const k = 0.78 + (t / (TONES - 1)) * 0.4; // 0.78..1.18 — от темнее к светлее
    const mat = new StandardMaterial(`mountainRingMat${t}`, scene);
    mat.diffuseColor = new Color3(0, 0, 0);
    mat.specularColor = new Color3(0, 0, 0);
    mat.emissiveColor = new Color3(0.34 * k, 0.38 * k, 0.46 * k);
    mat.disableLighting = true;
    mat.backFaceCulling = true;
    mats.push(mat);
  }

  const groups: Mesh[][] = Array.from({ length: TONES }, () => []);
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;
    const gap = Math.min(angDist(a, SUNRISE_AZ), angDist(a, SUNSET_AZ));
    if (gap < GAP) continue; // просвет — солнцу есть где встать/сесть
    const dist = R + (Math.random() - 0.5) * 60;
    const h = 42 + Math.random() * 46; // крупнее первой версии — читается издалека
    const w = 60 + Math.random() * 70;
    const cone = MeshBuilder.CreateCylinder(
      `mountainPeak${i}`,
      { diameterTop: w * 0.06, diameterBottom: w, height: h, tessellation: 7 },
      scene,
    );
    cone.position.set(Math.cos(a) * dist, h * 0.5 - 8, Math.sin(a) * dist);
    cone.rotation.y = Math.random() * Math.PI;
    // Неровный верх — не идеальный острый конус: чуть сдвигаем макушку в сторону.
    cone.rotation.x = (Math.random() - 0.5) * 0.12;
    cone.rotation.z = (Math.random() - 0.5) * 0.12;
    groups[Math.floor(Math.random() * TONES)].push(cone);
  }

  const merges: Mesh[] = [];
  for (let t = 0; t < TONES; t++) {
    if (groups[t].length === 0) continue;
    const m = Mesh.MergeMeshes(groups[t], true, true) as Mesh;
    m.material = mats[t];
    merges.push(m);
  }
  const merged = Mesh.MergeMeshes(merges, true, true, undefined, false, true) as Mesh;
  merged.name = "mountainRing";
  merged.isPickable = false;
  merged.checkCollisions = false;
  merged.applyFog = true; // тонет в тумане на закате/рассвете вместе со всем миром
  merged.doNotSyncBoundingInfo = true;
  merged.freezeWorldMatrix();
  return merged;
}
