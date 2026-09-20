import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { terrainHeight } from "#shared/terrain";
import { TOWER_PROP_POS } from "#shared/tower";
import type { Obstacle } from "../props";

export interface TowerProp {
  obstacles: Obstacle[];
  dispose(): void;
}

/**
 * Радиус/высота — прямой ствол без сужения. Высота была уже удвоена раньше;
 * теперь по просьбе вдвое шире (RADIUS 5→10), затем ещё чуть шире (12) — тоньше на фоне поляны
 * смотрелась несоразмерно высоте.
 */
const RADIUS = 12;
const BODY_H = 64;
const ROOF_H = 10;

/** Кладка из серого камня — та же процедурная крапинка+сетка, что и в TowerArenaFx. */
function buildStoneTexture(scene: Scene, uRepeat: number, vRepeat: number): DynamicTexture {
  const S = 256;
  // Мипмапы обязательны: без них мелкая кладка издали даёт муар.
  const tex = new DynamicTexture("towerPropStoneTex", { width: S, height: S }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.fillStyle = "rgb(128,128,130)"; // нейтрально-серый
  ctx.fillRect(0, 0, S, S);
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 900; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 1 + rnd() * 2.6;
    const shade = 0.6 + rnd() * 0.55;
    ctx.fillStyle = `rgba(${Math.round(140 * shade)},${Math.round(140 * shade)},${Math.round(142 * shade)},0.6)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Ряды каменной кладки — горизонтальные швы + смещённые вертикальные (кирпичная перевязка).
  const rowH = S / 10;
  ctx.strokeStyle = "rgba(30,28,26,0.5)";
  ctx.lineWidth = 4; // толще шов — читается и не пропадает на расстоянии
  for (let row = 0; row <= 10; row++) {
    const y = row * rowH;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(S, y);
    ctx.stroke();
    const offset = (row % 2) * (S / 8);
    for (let col = -1; col <= 4; col++) {
      const x = col * (S / 4) + offset;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + rowH);
      ctx.stroke();
    }
  }
  tex.update(true);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = uRepeat;
  tex.vScale = vRepeat;
  return tex;
}

/**
 * Декоративная башня-веха на основной карте — по паттерну `HubBlockout.ts`:
 * только примитивы, склеенные в один меш (`Mesh.MergeMeshes`) ради кадрового
 * бюджета шлема. Прямой ствол без сужения (не конус), вдвое выше прежнего,
 * с кладкой из серого камня и рядом маленьких окон на стороне, обращённой
 * к поляне (центру карты) — по просьбе.
 */
export function buildTowerProp(scene: Scene): TowerProp {
  const root = new TransformNode("towerProp", scene);
  const x = TOWER_PROP_POS.x;
  const z = TOWER_PROP_POS.z;
  const groundY = terrainHeight(x, z);
  root.position.set(x, groundY, z);

  const mat = new StandardMaterial("towerPropMat", scene);
  // uRepeat вдвое больше прежнего — окружность ствола удвоилась вместе с
  // RADIUS, без этого кладка растянулась бы вдвое шире по кирпичу.
  // Крупная кладка: блок ~3 м × 2 м (тайл — 4 блока по кругу и 10 рядов по высоте).
  const circumference = 2 * Math.PI * RADIUS;
  // Юбка ствола под землю: рельеф вокруг неравный, иначе между землёй и башней видны просветы.
  let minGround = groundY;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    for (const rr of [RADIUS, RADIUS + 2]) {
      minGround = Math.min(minGround, terrainHeight(x + Math.cos(a) * rr, z + Math.sin(a) * rr));
    }
  }
  const skirt = groundY - minGround + 1.5;
  mat.diffuseTexture = buildStoneTexture(scene, Math.round(circumference / 12.5), (BODY_H + skirt) / 20);
  mat.specularColor = new Color3(0, 0, 0);

  const roofMat = new StandardMaterial("towerPropRoofMat", scene);
  roofMat.diffuseColor = new Color3(0.35, 0.14, 0.16);
  roofMat.specularColor = new Color3(0, 0, 0);

  const winMat = new StandardMaterial("towerPropWinMat", scene);
  winMat.diffuseColor = new Color3(0.05, 0.04, 0.03);
  winMat.emissiveColor = new Color3(0.9, 0.65, 0.25);
  winMat.specularColor = new Color3(0, 0, 0);

  // Ствол — один прямой цилиндр (не сужается кверху), вдвое выше прежнего силуэта.
  const body = MeshBuilder.CreateCylinder(
    "towerPropBody",
    { height: BODY_H + skirt, diameter: RADIUS * 2, tessellation: 24 },
    scene,
  );
  body.position.y = (BODY_H - skirt) / 2;
  body.material = mat;
  body.parent = root;
  body.isPickable = false;
  body.freezeWorldMatrix();
  body.doNotSyncBoundingInfo = true;

  // Крыша-конус, пропорционально приподнята на новую высоту ствола.
  const roof = MeshBuilder.CreateCylinder(
    "towerPropRoof",
    { height: ROOF_H, diameterTop: 0, diameterBottom: RADIUS * 2 + 1, tessellation: 24 },
    scene,
  );
  roof.position.y = BODY_H + ROOF_H / 2;
  roof.material = roofMat;
  roof.parent = root;
  roof.isPickable = false;
  roof.freezeWorldMatrix();
  roof.doNotSyncBoundingInfo = true;

  // Окошки — на стороне, обращённой к центру карты/поляне (не к боссу и не
  // в стену леса за спиной). Плоские тёмные панели с тёплым свечением,
  // утоплены чуть внутрь радиуса, чтобы не торчать сквозь кладку.
  const toCenter = { x: -x, z: -z };
  const toCenterLen = Math.hypot(toCenter.x, toCenter.z) || 1;
  const faceAngle = Math.atan2(toCenter.x / toCenterLen, toCenter.z / toCenterLen);
  const winParts: Mesh[] = [];
  const heights = [10, 20, 30, 40, 50];
  for (const wy of heights) {
    const win = MeshBuilder.CreateBox("towerPropWin", { width: 1.1, height: 1.6, depth: 0.3 }, scene);
    const wx = Math.sin(faceAngle) * (RADIUS - 0.2);
    const wz = Math.cos(faceAngle) * (RADIUS - 0.2);
    win.position.set(wx, wy, wz);
    win.rotation.y = faceAngle;
    winParts.push(win);
  }
  const mergedWin = Mesh.MergeMeshes(winParts, true, true, undefined, false, false) ?? winParts[0];
  mergedWin.name = "towerPropWindows";
  mergedWin.material = winMat;
  mergedWin.parent = root;
  mergedWin.isPickable = false;
  mergedWin.freezeWorldMatrix();
  mergedWin.doNotSyncBoundingInfo = true;

  return {
    obstacles: [{ x, z, r: RADIUS + 1.5 }],
    dispose(): void {
      body.material?.dispose();
      body.dispose();
      roof.material?.dispose();
      roof.dispose();
      mergedWin.material?.dispose();
      mergedWin.dispose();
      root.dispose();
    },
  };
}
