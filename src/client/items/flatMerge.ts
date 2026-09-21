import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Material } from "@babylonjs/core/Materials/material";

import { LIGHT_BUDGET } from "../world/Fireflies";

/**
 * Оружие — это десятки отрисовок на кадр (у каждой модели по 4–8 подмешей), а на шлеме
 * стоимость кадра почти линейна от числа отрисовок и мешей. Два приёма, чтобы держать
 * оружие в ОДНОЙ отрисовке (или по числу разных материалов, не деталей):
 *  • `mergeByMaterial` — детали с одним материалом склеиваются в одну, затем группы — в
 *    мульти-материал (Babylon иначе делает подмеш на каждую деталь);
 *  • `flattenToVertexColors` — плоские цвета кладём в вершины и рисуем один меш одним общим
 *    материалом (для моделей из пака, где каждый цвет — отдельный меш).
 */

/** Склеить детали: одинаковый материал — в один подмеш. Исходные меши удаляются. */
export function mergeByMaterial(parts: Mesh[]): Mesh | null {
  const groups = new Map<Material | null, Mesh[]>();
  for (const p of parts) {
    const key = p.material ?? null;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const merged: Mesh[] = [];
  for (const [mat, list] of groups) {
    const m = list.length === 1 ? list[0] : Mesh.MergeMeshes(list, true, true, undefined, false, false);
    if (!m) return null;
    m.material = mat;
    merged.push(m);
  }
  if (merged.length === 1) return merged[0];
  return Mesh.MergeMeshes(merged, true, true, undefined, false, true);
}

const shared = new WeakMap<Scene, StandardMaterial>();

/** Общий материал «цвет из вершин» для всего оружия сцены. */
export function weaponFlatMaterial(scene: Scene): StandardMaterial {
  let m = shared.get(scene);
  if (m) return m;
  m = new StandardMaterial("weaponFlat", scene);
  m.diffuseColor = new Color3(1, 1, 1);
  m.emissiveColor = new Color3(0.05, 0.05, 0.05); // итог считается умноженным на цвет вершины
  m.specularColor = new Color3(0.35, 0.35, 0.35);
  m.specularPower = 48;
  m.maxSimultaneousLights = LIGHT_BUDGET;
  shared.set(scene, m);
  return m;
}

const _v = new Vector3();

/**
 * Собрать меши модели в ОДИН меш с цветами в вершинах (цвет берётся из diffuse их материала).
 * Геометрия переводится в систему `base` (в ней и живёт новый меш), исходники не трогаются.
 */
export function flattenToVertexColors(scene: Scene, base: TransformNode, meshes: Mesh[], name: string): Mesh | null {
  base.computeWorldMatrix(true);
  const inv = base.getWorldMatrix().clone().invert();
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const m of meshes) {
    const p = m.getVerticesData(VertexBuffer.PositionKind);
    const idxSrc = m.getIndices();
    if (!p || !idxSrc) continue;
    const n = m.getVerticesData(VertexBuffer.NormalKind);
    const mat = m.material as StandardMaterial | null;
    const c = mat && "diffuseColor" in mat ? mat.diffuseColor : new Color3(0.6, 0.6, 0.62);
    const rel = m.computeWorldMatrix(true).multiply(inv);
    const start = pos.length / 3;
    for (let i = 0; i < p.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(p[i], p[i + 1], p[i + 2], rel, _v);
      pos.push(_v.x, _v.y, _v.z);
      if (n) {
        Vector3.TransformNormalFromFloatsToRef(n[i], n[i + 1], n[i + 2], rel, _v);
        _v.normalize();
        nor.push(_v.x, _v.y, _v.z);
      } else {
        nor.push(0, 1, 0);
      }
      col.push(c.r, c.g, c.b, 1);
    }
    for (let i = 0; i < idxSrc.length; i++) idx.push(idxSrc[i] + start);
  }
  if (!pos.length) return null;
  const out = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nor;
  vd.colors = col;
  vd.indices = idx;
  vd.applyToMesh(out);
  out.material = weaponFlatMaterial(scene);
  out.useVertexColors = true;
  out.hasVertexAlpha = false;
  out.isPickable = false;
  out.parent = base;
  return out;
}


/**
 * Собрать детали (процедурные меши со своими материалами) в ОДИН меш с цветами в вершинах и общим
 * материалом `weaponFlat`: одна отрисовка на предмет вместо числа материалов. Цвет = diffuse + часть
 * emissive материала (свечение «запекается» в цвет). Исходные меши удаляются.
 */
export function mergeToVertexColors(scene: Scene, parts: Mesh[]): Mesh | null {
  const used = new Set<Material>();
  for (const p of parts) {
    if (p.material) used.add(p.material);
    const mat = p.material as StandardMaterial | null;
    const d = mat && "diffuseColor" in mat ? mat.diffuseColor : new Color3(0.6, 0.6, 0.62);
    const e = mat && "emissiveColor" in mat ? mat.emissiveColor : Color3.Black();
    const r = Math.min(1, d.r + e.r * 0.8);
    const g = Math.min(1, d.g + e.g * 0.8);
    const b = Math.min(1, d.b + e.b * 0.8);
    const n = p.getTotalVertices();
    const cols = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) cols.set([r, g, b, 1], i * 4);
    p.setVerticesData(VertexBuffer.ColorKind, cols);
    p.material = null;
  }
  const m = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  for (const mt of used) mt.dispose(); // прежние материалы деталей больше не нужны
  if (!m) return null;
  m.material = weaponFlatMaterial(scene);
  m.useVertexColors = true;
  m.hasVertexAlpha = false;
  m.isPickable = false;
  return m;
}
