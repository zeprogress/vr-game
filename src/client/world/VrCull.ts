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
export class VrCull {
  private trees: AbstractMesh[] = [];
  private rocks: AbstractMesh[] = [];
  private readonly hidden = new Set<AbstractMesh>();
  private readonly roots = new Set<AbstractMesh>();
  private scanT = 0;
  private cullT = 0;
  private readonly treeR: number;
  private readonly rockR: number;

  constructor(private readonly scene: Scene) {
    const p = new URLSearchParams(location.search);
    const v = p.has("vrcull") ? Number(p.get("vrcull")) : 60;
    this.treeR = Number.isFinite(v) ? v : 60;
    this.rockR = Math.max(0, this.treeR - 10);
  }

  private scan(): void {
    const trees: AbstractMesh[] = [];
    const rocks: AbstractMesh[] = [];
    for (const m of this.scene.meshes) {
      if (m.name.startsWith("CommonTree")) trees.push(m);
      else if (m.name.startsWith("Rock_Medium")) {
        rocks.push(m);
        m.alwaysSelectAsActiveMesh = false; // пусть работает отсечение по кадру
      } else if (m.getTotalVertices() === 0 && !m.isAnInstance && m.isVisible && m.getChildren().length > 0) {
        // Корень без геометрии (glTF __root__) — только у него есть дети-меши.
        m.isVisible = false;
        this.roots.add(m);
      }
    }
    this.trees = trees;
    this.rocks = rocks;
  }

  update(dt: number, cam: Vector3): void {
    if (this.treeR <= 0) return;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 3; // новые мобы/оружие появляются — обновляем набор
      this.scan();
    }
    this.cullT -= dt;
    if (this.cullT > 0) return;
    this.cullT = 0.4;
    this.apply(this.trees, cam, this.treeR);
    this.apply(this.rocks, cam, this.rockR);
  }

  private apply(list: AbstractMesh[], cam: Vector3, r: number): void {
    for (const m of list) {
      if (m.isDisposed()) continue;
      const p = m.getAbsolutePosition();
      const d2 = (p.x - cam.x) ** 2 + (p.z - cam.z) ** 2;
      const off = this.hidden.has(m);
      const lim = off ? r - 6 : r + 6;
      const far = d2 > lim * lim;
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
    this.roots.clear();
  }
}
