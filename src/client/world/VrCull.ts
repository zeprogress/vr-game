import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { impostorsReady, impostorsUpdate } from "./TreeImpostors";

/**
 * Отсечение сцены для VR (Quest считает всё дважды — на два глаза).
 *
 * Замер с шлема показал: ~1700 мешей в сцене, ~600 «активных» за кадр,
 * ~1000 draw call'ов, `_evaluateActiveMeshes` ≈ 5 мс, деревья — ~430 тыс.
 * вершин на кадр. Что делаем:
 *  • «пустые» меши-корни (у glTF `__root__`, вершин 0; их полтораста) прячем
 *    через isVisible=false — Babylon пропускает их ещё до отсечения, детей это
 *    не трогает (видимость не наследуется);
 *  • деревья и камни дальше порога отключаем целиком (гистерезис ±6 м), а у
 *    камней снимаем «всегда активен» (они обходили отсечение по кадру).
 * `?vrcull=<м>` — порог для деревьев (камни — на 10 м ближе); 0 — выключить.
 */
/** Ближе этого объекты не прячем по направлению (крутанулся — они рядом). */
const BEHIND_NEAR = 14;
/** Центральный конус ±30° — полная дальность; боковые секторы до ±60° — SIDE_K от неё. */
const COS_CENTER = Math.cos((30 * Math.PI) / 180);
const COS_SIDE = Math.cos((60 * Math.PI) / 180);
const SIDE_K = 0.75;
/** Полная 3D-модель дерева — только до этого расстояния, дальше снимок. */
const NEAR_3D = 60;

export class VrCull {
  /** Светлячки и мелочь лагеря: скрываем через isVisible (их enabled ведёт свой код — день/ночь). */
  private small: { m: AbstractMesh; r: number }[] = [];
  private trees: AbstractMesh[] = [];
  private rocks: AbstractMesh[] = [];
  private readonly hidden = new Set<AbstractMesh>();
  private readonly roots = new Set<AbstractMesh>();
  private scanT = 0;
  private cullT = 0;
  private readonly treeR: number;
  private readonly rockR: number;

  constructor(
    private readonly scene: Scene,
    /** VR: деревья/камни всегда «активны» (bbox по двум глазам ненадёжен), режем по расстоянию. Плоский экран: ещё и отсечение по кадру. */
    readonly vr = true,
  ) {
    const p = new URLSearchParams(location.search);
    const v = p.has("vrcull") ? Number(p.get("vrcull")) : this.vr ? 200 : 150;
    this.treeR = Number.isFinite(v) ? v : 60;
    this.rockR = this.vr ? 180 : 50;
  }

  private scan(): void {
    const trees: AbstractMesh[] = [];
    const rocks: AbstractMesh[] = [];
    const small: { m: AbstractMesh; r: number }[] = [];
    for (const m of this.scene.meshes) {
      const n = m.name;
      if (n.startsWith("firefly")) small.push({ m, r: 30 });
      else if (n.startsWith("hubSpark") || n.startsWith("hubCoal")) small.push({ m, r: 35 });
      else if (n.startsWith("hubFire") || n.startsWith("hubGlow")) small.push({ m, r: 70 }); else if (m.name.startsWith("CommonTree")) {
        trees.push(m);
        m.alwaysSelectAsActiveMesh = this.vr; // в VR — только отсечение по расстоянию
      }
      else if (n.startsWith("Rock_Medium")) {
        rocks.push(m);
        m.alwaysSelectAsActiveMesh = this.vr; // в VR — только отсечение по расстоянию
      } else if (m.getTotalVertices() === 0 && !m.isAnInstance && m.isVisible && m.getChildren().length > 0) {
        // Корень без геометрии (glTF __root__) — только у него есть дети-меши.
        m.isVisible = false;
        this.roots.add(m);
      }
    }
    this.trees = trees;
    this.rocks = rocks;
    this.small = small;
  }

  update(dt: number, cam: Vector3, fwd?: Vector3): void {
    if (this.treeR <= 0) return;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 3; // новые мобы/оружие появляются — обновляем набор
      this.scan();
    }
    this.cullT -= dt;
    if (this.cullT > 0) return;
    this.cullT = 0.2;
    // VR: то, что строго позади (с запасом на щелчок snap-turn 30° и поворот головы),
    // не рисуем — дальность зато больше. fwd — взгляд в плоскости XZ.
    let fx = 0;
    let fz = 0;
    if (this.vr && fwd) {
      const l = Math.hypot(fwd.x, fwd.z);
      if (l > 1e-3) {
        fx = fwd.x / l;
        fz = fwd.z / l;
      }
    }
    // Дальше NEAR_3D настоящая модель дерева не нужна — там снимок-билборд (TreeImpostors).
    const imp = impostorsReady();
    this.apply(this.trees, cam, imp ? NEAR_3D : this.treeR, fx, fz);
    this.apply(this.rocks, cam, this.rockR, fx, fz);
    if (imp) impostorsUpdate(cam, fx, fz, this.treeR, NEAR_3D);
    for (const s of this.small) {
      if (s.m.isDisposed()) continue;
      const p = s.m.getAbsolutePosition();
      const d2 = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
      // isVisible, а не setEnabled: enabled у светлячков ведёт их собственный день/ночь.
      s.m.isVisible = d2 <= s.r * s.r;
    }
  }

  /**
   * VR: дальность зависит от направления. Строго вперёд (±30° от взгляда) — на
   * полную `r`, в боковых секторах 30–60° — на 2/3 `r`, остальное вокруг не
   * рисуется (кроме ближних BEHIND_NEAR м). Поворот щелчками, поэтому границы
   * держим с гистерезисом; на плоском экране (fx=fz=0) — просто круг радиуса r.
   */
  private apply(list: AbstractMesh[], cam: Vector3, r: number, fx = 0, fz = 0): void {
    const sector = fx !== 0 || fz !== 0;
    for (const m of list) {
      if (m.isDisposed()) continue;
      const md = m.metadata as { cullX?: number; cullZ?: number; cullR?: number } | null;
      const chunk = md && md.cullX !== undefined && md.cullZ !== undefined;
      const p = chunk ? { x: md.cullX as number, z: md.cullZ as number } : m.getAbsolutePosition();
      const rad = chunk ? (md.cullR ?? 0) : 0;
      const d2raw = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
      // Кусок травы большой: считаем по его ближнему краю.
      const dNear = Math.max(0, Math.sqrt(d2raw) - rad);
      const d2 = dNear * dNear;
      const off = this.hidden.has(m);
      // Видимому объекту границы чуть шире (гистерезис), спрятанному — чуть уже.
      const pad = off ? -6 : 6;
      let far: boolean;
      if (!sector) {
        const lim = r + pad;
        far = d2 > lim * lim;
      } else if (d2 <= BEHIND_NEAR * BEHIND_NEAR) {
        far = false;
      } else {
        let cosA = ((p.x - cam.x) * fx + (p.z - cam.z) * fz) / Math.max(1e-3, Math.sqrt(d2raw));
        if (rad > 0 && d2raw > rad * rad) {
          // Большой кусок: берём угол к его ближайшему к оси краю.
          const ang = Math.max(0, Math.acos(Math.max(-1, Math.min(1, cosA))) - Math.asin(rad / Math.sqrt(d2raw)));
          cosA = Math.cos(ang);
        } else if (rad > 0) {
          cosA = 1; // камера внутри куска
        }
        const da = off ? -0.03 : 0.03; // ≈ ±3–5° по косинусу
        let lim: number;
        if (cosA > COS_CENTER - da) lim = r + pad;
        else if (cosA > COS_SIDE - da) lim = r * SIDE_K + pad;
        else lim = 0;
        far = lim <= 0 || d2 > lim * lim;
      }
      if (far && !off) {
        m.setEnabled(false);
        this.hidden.add(m);
      } else if (!far && off) {
        m.setEnabled(true);
        this.hidden.delete(m);
      }
    }
  }

  /** Выход из VR: всё вернуть как было. */
  dispose(): void {
    for (const m of this.hidden) if (!m.isDisposed()) m.setEnabled(true);
    this.hidden.clear();
    for (const m of this.roots) if (!m.isDisposed()) m.isVisible = true;
    for (const s of this.small) if (!s.m.isDisposed()) s.m.isVisible = true;
    for (const m of this.trees) if (!m.isDisposed()) m.alwaysSelectAsActiveMesh = false;
    for (const m of this.rocks) if (!m.isDisposed()) m.alwaysSelectAsActiveMesh = false;
    this.roots.clear();
  }
}
