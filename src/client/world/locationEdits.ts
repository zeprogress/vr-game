import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import edits from "./locationEdits.json";

/**
 * Ручные правки локаций, сделанные в Unity (меню «Zep → Локации → Сохранить правки», unity/Assets/Editor/
 * LocationEditsTool.cs): спрятать, сдвинуть/повернуть/масштабировать, скопировать объект. Тот же файл читает
 * пересборка Unity, так что вид в вебе и в Unity один.
 *
 * Объект задан именем меша из выгрузки (src/client/dev/unityExport.ts) и центром его геометрии в мире в
 * момент выгрузки: в вебе берём меш с тем же именем, ближайший к этому центру. У thin-instance-копий имя
 * «<меш>_<номер>» — это копия номер i. Сдвиг применяется поверх исходного положения («после» него, в мире).
 * Локации строятся не сразу (катакомбы, подземелье — по мере надобности), поэтому неприменённые правки
 * пробуем раз в 2 с; меш пересоздан — применяем снова.
 */

interface Trs {
  p: [number, number, number];
  r: [number, number, number, number];
  s: [number, number, number];
}
interface LocPart {
  c: [number, number, number];
  hide?: boolean;
  move?: Trs;
}
interface LocEdit {
  parts?: LocPart[];
  loc: string;
  name: string;
  c: [number, number, number];
  hide?: boolean;
  move?: Trs;
  copies?: Trs[];
}

const LIST = (edits as { edits?: LocEdit[] }).edits ?? [];
/** Дальше этого от центра из выгрузки — не тот объект (центр рамки в Babylon и Unity чуть расходится у повёрнутых мешей). */
const MATCH_M = 3;

function trsMatrix(t: Trs): Matrix {
  return Matrix.Compose(new Vector3(...t.s), new Quaternion(...t.r), new Vector3(...t.p));
}

/** Поставить меш так, чтобы его мир стал world (с учётом родителя). */
function setWorld(m: AbstractMesh, world: Matrix): void {
  const local = m.parent ? world.multiply(Matrix.Invert(m.parent.getWorldMatrix())) : world;
  const s = new Vector3();
  const r = new Quaternion();
  const p = new Vector3();
  local.decompose(s, r, p);
  const frozen = m.isWorldMatrixFrozen;
  if (frozen) m.unfreezeWorldMatrix();
  m.scaling.copyFrom(s);
  m.rotationQuaternion = r;
  m.position.copyFrom(p);
  m.computeWorldMatrix(true);
  if (frozen) m.freezeWorldMatrix();
}

/** Ближайший к центру c меш с этим именем (обычный или копия thin instance). */
function find(scene: Scene, e: LocEdit): { mesh: AbstractMesh; thin: number } | null {
  const c = new Vector3(...e.c);
  let best: { mesh: AbstractMesh; thin: number } | null = null;
  let bd = MATCH_M;
  for (const m of scene.meshes) {
    if (m.name !== e.name) continue;
    const d = Vector3.Distance(m.getBoundingInfo().boundingBox.centerWorld, c);
    if (d < bd) {
      bd = d;
      best = { mesh: m, thin: -1 };
    }
  }
  if (best) return best;
  const tm = /^(.*)_(\d+)$/.exec(e.name);
  if (!tm) return null;
  const host = scene.getMeshByName(tm[1]) as Mesh | null;
  const i = Number(tm[2]);
  const mats = host?.thinInstanceGetWorldMatrices?.() ?? [];
  if (!host || i >= mats.length) return null;
  const center = Vector3.TransformCoordinates(host.getBoundingInfo().boundingBox.center, mats[i].multiply(host.getWorldMatrix()));
  return Vector3.Distance(center, c) < MATCH_M * 2 ? { mesh: host, thin: i } : null;
}

/**
 * Части меша — как нарезка Unity (LocationEditsTool.Split): связные куски по совпадающим позициям вершин
 * (1 мм), в порядке первого треугольника. Каждая — треугольники и центр вершин в мире.
 */
function meshParts(m: Mesh): { tris: number[]; c: Vector3 }[] {
  const pos = m.getVerticesData("position");
  const idx = m.getIndices();
  if (!pos || !idx) return [];
  const nv = pos.length / 3;
  const weld = new Map<string, number>();
  const vid = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(pos[i * 3] * 1000)},${Math.round(pos[i * 3 + 1] * 1000)},${Math.round(pos[i * 3 + 2] * 1000)}`;
    let w = weld.get(k);
    if (w === undefined) weld.set(k, (w = weld.size));
    vid[i] = w;
  }
  const parent = Int32Array.from({ length: weld.size }, (_, i) => i);
  const root = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = root(vid[idx[t]]);
    parent[root(vid[idx[t + 1]])] = a;
    parent[root(vid[idx[t + 2]])] = a;
  }
  const compOf = new Map<number, number>();
  const parts: { tris: number[]; c: Vector3 }[] = [];
  const W = m.computeWorldMatrix(true);
  for (let t = 0; t < idx.length; t += 3) {
    const r = root(vid[idx[t]]);
    let ci = compOf.get(r);
    if (ci === undefined) {
      compOf.set(r, (ci = parts.length));
      parts.push({ tris: [], c: new Vector3() });
    }
    parts[ci].tris.push(t);
  }
  for (const p of parts) {
    const seen = new Set<number>();
    const sum = new Vector3();
    for (const t of p.tris)
      for (let j = 0; j < 3; j++) {
        const v = idx[t + j];
        if (seen.has(v)) continue;
        seen.add(v);
        sum.addInPlaceFromFloats(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
    p.c = Vector3.TransformCoordinates(sum.scale(1 / seen.size), W);
  }
  return parts;
}

/** Спрятать и сдвинуть отдельные части меша: их треугольники убираются из него, сдвинутые — отдельным мешем. */
function applyParts(m: Mesh, list: LocPart[]): void {
  const parts = meshParts(m);
  if (parts.length < 2) return;
  const idx = m.getIndices();
  if (!idx) return;
  const drop = new Set<number>();
  const world = m.computeWorldMatrix(true).clone();
  for (const pe of list) {
    const c = new Vector3(...pe.c);
    let best = -1;
    let bd = 0.6;
    parts.forEach((p, i) => {
      const d = Vector3.Distance(p.c, c);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best < 0) continue;
    for (const t of parts[best].tris) drop.add(t);
    if (pe.hide || !pe.move) continue;
    // Сдвинутая часть — свой меш с её треугольниками, мир = исходный · сдвиг (как в Unity).
    const piece = m.clone(`${m.name}_part${best}`, m.parent) as Mesh;
    piece.makeGeometryUnique();
    const own: number[] = [];
    for (const t of parts[best].tris) own.push(idx[t], idx[t + 1], idx[t + 2]);
    piece.setIndices(own);
    setWorld(piece, world.multiply(trsMatrix(pe.move)));
  }
  if (!drop.size) return;
  const keep: number[] = [];
  for (let t = 0; t < idx.length; t += 3) if (!drop.has(t)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  m.makeGeometryUnique();
  m.setIndices(keep);
}

function apply(e: LocEdit, hit: { mesh: AbstractMesh; thin: number }): void {
  const m = hit.mesh;
  if (hit.thin < 0) {
    const world = m.computeWorldMatrix(true).clone();
    // Копии — до правки частей и как в Unity, целиком. Экземпляр делит геометрию с исходником (правка частей
    // задела бы и его) и не рисуется без исходника — в этих случаях полная копия.
    const own = e.hide || !!e.parts?.length;
    for (const [k, t] of (e.copies ?? []).entries()) {
      const copy = (!own && (m as Mesh).createInstance?.(`${m.name}_edit${k}`)) || m.clone(`${m.name}_edit${k}`, m.parent);
      if (!copy) continue;
      if (own) (copy as Mesh).makeGeometryUnique?.();
      copy.parent = m.parent;
      setWorld(copy, world.multiply(trsMatrix(t)));
    }
    if (e.parts?.length && typeof (m as Mesh).makeGeometryUnique === "function") applyParts(m as Mesh, e.parts);
    if (e.move) setWorld(m, world.multiply(trsMatrix(e.move)));
    if (e.hide) m.setEnabled(false);
    return;
  }
  // Копия thin instance: её матрица t относительно мира хоста W; новое t' = t·W·E·W⁻¹.
  const host = m as Mesh;
  const W = host.getWorldMatrix();
  const Winv = Matrix.Invert(W);
  const t = host.thinInstanceGetWorldMatrices()[hit.thin];
  const edit = (x: Trs): Matrix => t.multiply(W).multiply(trsMatrix(x)).multiply(Winv);
  for (const x of e.copies ?? []) host.thinInstanceAdd(edit(x), false);
  if (e.hide) host.thinInstanceSetMatrixAt(hit.thin, Matrix.Scaling(0, 0, 0), false);
  else if (e.move) host.thinInstanceSetMatrixAt(hit.thin, edit(e.move), false);
  host.thinInstanceBufferUpdated("matrix");
  host.thinInstanceRefreshBoundingInfo(true);
}

/** Запустить правки на сцене: применяет, что уже построено, и дожидается остального. */
export function startLocationEdits(scene: Scene): void {
  if (!LIST.length) return;
  const done = new Map<LocEdit, AbstractMesh>();
  const tick = (): void => {
    for (const e of LIST) {
      const m = done.get(e);
      if (m && !m.isDisposed()) continue;
      const hit = find(scene, e);
      if (!hit) continue;
      try {
        apply(e, hit);
        done.set(e, hit.mesh);
      } catch (err) {
        console.warn("[locationEdits]", e.name, err);
        done.set(e, hit.mesh);
      }
    }
  };
  tick();
  const id = setInterval(tick, 2000);
  scene.onDisposeObservable.addOnce(() => clearInterval(id));
}
