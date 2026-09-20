import type { Scene } from "@babylonjs/core/scene";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

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
/** Прячем при угле от взгляда > 130° (90° + запас на snap-turn 30° и голову); гистерезис 10°. */
const COS_HIDE = Math.cos((130 * Math.PI) / 180);
const COS_SHOW = Math.cos((120 * Math.PI) / 180);

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
    const v = p.has("vrcull") ? Number(p.get("vrcull")) : this.vr ? 90 : 60;
    this.treeR = Number.isFinite(v) ? v : 60;
    this.rockR = Math.max(0, this.treeR - 10);
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
    this.apply(this.trees, cam, this.treeR, fx, fz);
    this.apply(this.rocks, cam, this.rockR, fx, fz);
    for (const s of this.small) {
      if (s.m.isDisposed()) continue;
      const p = s.m.getAbsolutePosition();
      const d2 = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
      // isVisible, а не setEnabled: enabled у светлячков ведёт их собственный день/ночь.
      s.m.isVisible = d2 <= s.r * s.r;
    }
  }

  private apply(list: AbstractMesh[], cam: Vector3, r: number, fx = 0, fz = 0): void {
    for (const m of list) {
      if (m.isDisposed()) continue;
      const p = m.getAbsolutePosition();
      const d2 = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
      const off = this.hidden.has(m);
      const lim = off ? r - 6 : r + 6;
      let far = d2 > lim * lim;
      if (!far && (fx !== 0 || fz !== 0) && d2 > BEHIND_NEAR * BEHIND_NEAR) {
        // cos угла между взглядом и направлением на объект; спрятан — за «широким задом»
        const cosA = ((p.x - cam.x) * fx + (p.z - cam.z) * fz) / Math.sqrt(d2);
        far = off ? cosA < COS_SHOW : cosA < COS_HIDE;
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
