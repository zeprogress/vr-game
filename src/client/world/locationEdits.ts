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
interface LocEdit {
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

function apply(e: LocEdit, hit: { mesh: AbstractMesh; thin: number }): void {
  const m = hit.mesh;
  if (hit.thin < 0) {
    const world = m.computeWorldMatrix(true).clone();
    for (const [k, t] of (e.copies ?? []).entries()) {
      // Исходник спрятан — экземпляр без него не рисуется, тогда полная копия.
      const copy = (!e.hide && (m as Mesh).createInstance?.(`${m.name}_edit${k}`)) || m.clone(`${m.name}_edit${k}`, m.parent);
      if (!copy) continue;
      copy.parent = m.parent;
      setWorld(copy, world.multiply(trsMatrix(t)));
    }
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
