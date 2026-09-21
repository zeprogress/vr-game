import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import "@babylonjs/core/Meshes/thinInstanceMesh";

/**
 * Деревья и камни в VR — тонкими инстансами.
 *
 * Обычные инстансы Babylon стоят CPU КАЖДЫЙ кадр на каждый видимый экземпляр (отсечение, выбор LOD,
 * пересборка буфера матриц) — ~100 записей в списке активных мешей. Здесь весь лес — по одному меши
 * на (вид, часть, уровень LOD) с готовым буфером матриц: кадр ничего не считает, буфер пересобирается
 * раз в 0.2 с вместе с решением VrCull «что рисовать» (расстояние/сектор/снимок-билборд).
 * Сами исходные экземпляры отключены; при выходе из VR их включают обратно.
 */
interface Level {
  from: number; // с какого расстояния (м) этот уровень
  mesh: Mesh; // тонкий клон геометрии
  buf: Float32Array;
  colBuf: Float32Array | null;
  n: number;
}
interface Group {
  members: AbstractMesh[];
  /** По возрастанию from; [0] — полная модель. Пара мешей на уровень: [прямой, зеркальный (det<0)]. */
  levels: [Level, Level | null][];
  /** Зеркальный меш уровня создаётся по требованию (обычно нужды нет). */
  makeMirror: (() => Level)[];
}

export class TreeThin {
  private readonly groups = new Map<Mesh, Group>();
  private readonly memberGroup = new Map<AbstractMesh, Group>();
  private readonly shown = new Map<AbstractMesh, boolean>();

  constructor(private readonly scene: Scene) {}

  has(m: AbstractMesh): boolean {
    return this.memberGroup.has(m);
  }

  /** Взять экземпляр под управление (его собственная отрисовка отключается). */
  add(m: AbstractMesh): boolean {
    if (this.memberGroup.has(m)) return true;
    const src = (m.isAnInstance ? (m as InstancedMesh).sourceMesh : m) as Mesh;
    if (!src?.geometry || !m.isAnInstance) return false;
    let g = this.groups.get(src);
    if (!g) {
      g = { members: [], levels: [], makeMirror: [] };
      const lods = src
        .getLODLevels()
        .filter((l) => l.mesh && l.distanceOrScreenCoverage > 0)
        .sort((a, b) => a.distanceOrScreenCoverage - b.distanceOrScreenCoverage);
      const hasColor = !!(m as InstancedMesh).instancedBuffers?.color;
      const mk1 = (from: number, geo: Mesh, tag: string, mirrored: boolean): Level => {
        const tm = new Mesh(`${src.name}_thin${tag}${mirrored ? "m" : ""}`, this.scene);
        // СВОЯ геометрия (копия): у общей буфер матриц тонких инстансов (world0..3) затирал бы чужой — у исходника и других тонких мешей.
        VertexData.ExtractFromGeometry(geo.geometry!).applyToMesh(tm);
        tm.material = src.material;
        tm.isPickable = false;
        tm.alwaysSelectAsActiveMesh = true;
        tm.doNotSyncBoundingInfo = true;
        // Порядок обхода граней — как у исходной модели: glTF-загрузчик ставит мешам свой (у нового меша он
        // другой — видна изнанка, лицо срезается). Зеркальные экземпляры (отрицательный определитель) Babylon
        // у обычных мешей разворачивает сам, у тонких инстансов — нет: им обход обратный.
        tm.sideOrientation = mirrored ? 1 - src.sideOrientation : src.sideOrientation;
        tm.setEnabled(false);
        const buf = new Float32Array(16 * 16);
        tm.thinInstanceSetBuffer("matrix", buf, 16, false);
        let colBuf: Float32Array | null = null;
        if (hasColor) {
          colBuf = new Float32Array(4 * 16);
          tm.thinInstanceSetBuffer("color", colBuf, 4, false);
        }
        return { from, mesh: tm, buf, colBuf, n: 0 };
      };
      const mk = (from: number, geo: Mesh, tag: string): void => {
        g!.levels.push([mk1(from, geo, tag, false), null]);
        g!.makeMirror.push(() => mk1(from, geo, tag, true));
      };
      mk(0, src, "0");
      lods.forEach((l, i) => mk(l.distanceOrScreenCoverage, l.mesh as Mesh, String(i + 1)));
      this.groups.set(src, g);
    }
    g.members.push(m);
    this.memberGroup.set(m, g);
    this.shown.set(m, m.isEnabled());
    m.setEnabled(false);
    return true;
  }

  setShown(m: AbstractMesh, on: boolean): void {
    this.shown.set(m, on);
  }

  private ensure(lv: Level, need: number): void {
    if (lv.buf.length >= need * 16) return;
    lv.buf = new Float32Array(need * 16 * 2);
    lv.mesh.thinInstanceSetBuffer("matrix", lv.buf, 16, false);
    if (lv.colBuf) {
      lv.colBuf = new Float32Array(need * 4 * 2);
      lv.mesh.thinInstanceSetBuffer("color", lv.colBuf, 4, false);
    }
  }

  /** Пересобрать буферы: кто виден и каким уровнем LOD. */
  rebuild(cam: Vector3): void {
    for (const g of this.groups.values()) {
      const need = g.members.length;
      for (const lv of g.levels.flat()) {
        if (!lv) continue;
        this.ensure(lv, need);
        lv.n = 0;
      }
      const top = g.levels.length - 1;
      for (const m of g.members) {
        if (m.isDisposed() || !this.shown.get(m)) continue;
        const p = m.getAbsolutePosition();
        const d = Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z);
        let li = 0;
        while (li < top && d >= g.levels[li + 1][0].from) li++;
        const wm = m.getWorldMatrix().m;
        const det = wm[0] * (wm[5] * wm[10] - wm[6] * wm[9]) - wm[1] * (wm[4] * wm[10] - wm[6] * wm[8]) + wm[2] * (wm[4] * wm[9] - wm[5] * wm[8]);
        let lv = g.levels[li][0];
        if (det < 0) {
          const fresh = g.levels[li][1] === null;
          lv = g.levels[li][1] ??= g.makeMirror[li]();
          if (fresh) lv.n = 0;
        }
        this.ensure(lv, need);
        const o = lv.n * 16;
        for (let k = 0; k < 16; k++) lv.buf[o + k] = wm[k];
        if (lv.colBuf) {
          const c = (m as InstancedMesh).instancedBuffers.color as { r: number; g: number; b: number; a: number };
          const co = lv.n * 4;
          lv.colBuf[co] = c.r;
          lv.colBuf[co + 1] = c.g;
          lv.colBuf[co + 2] = c.b;
          lv.colBuf[co + 3] = c.a;
        }
        lv.n++;
      }
      for (const lv of g.levels.flat()) {
        if (!lv) continue;
        lv.mesh.thinInstanceCount = lv.n;
        lv.mesh.setEnabled(lv.n > 0);
        if (lv.n > 0) {
          lv.mesh.thinInstanceBufferUpdated("matrix");
          if (lv.colBuf) lv.mesh.thinInstanceBufferUpdated("color");
        }
      }
    }
  }

  /** Вернуть исходные экземпляры в игру, убрать тонкие меши. */
  dispose(): void {
    for (const [m, on] of this.shown) if (!m.isDisposed()) m.setEnabled(on);
    for (const g of this.groups.values()) for (const lv of g.levels.flat()) lv?.mesh.dispose();
    this.groups.clear();
    this.memberGroup.clear();
    this.shown.clear();
  }
}
