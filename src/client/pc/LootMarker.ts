import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Rendering/outlineRenderer";

const OUTLINE = new Color3(1, 0.12, 0.1);

/**
 * Подсветка предмета на земле (ПК) — толстая красная обводка самого
 * предмета. Кликнул — на ~1.5 с; герой бежит к предмету — держится, пока не
 * добежит или предмет не пропадёт.
 *
 * Банки и кубики лута — инстансы (одна отрисовка на всех), обводку на
 * инстанс не повесить: для них поверх ставится копия-меш с обводкой.
 */
export class LootMarker {
  private id: string | null = null;
  private mesh: AbstractMesh | null = null;
  private copy: Mesh | null = null;
  private life = 0;
  private sticky = false;
  /** Выбран кликом — обводка держится, пока выбор не снимут (hide) или предмет не пропадёт. */
  private persist = false;

  /** Выбранный предмет (или null). */
  get selectedId(): string | null {
    return this.id;
  }

  /** Подсветить предмет `id` (его меш). sticky — держать, пока герой бежит; persist — пока выбран. */
  show(id: string, mesh: AbstractMesh, sticky: boolean, persist = false): void {
    if (this.id !== id || this.mesh !== mesh) {
      this.hide();
      this.id = id;
      this.mesh = mesh;
      if (mesh instanceof InstancedMesh) {
        const c = mesh.sourceMesh.clone(`lootHL_${id}`, null, false);
        if (c) {
          c.parent = mesh;
          c.position.setAll(0);
          c.rotationQuaternion = null;
          c.rotation.setAll(0);
          c.scaling.setAll(1);
          c.setEnabled(true);
          c.isPickable = false;
          this.copy = c;
        }
      }
    }
    this.sticky = sticky || this.sticky;
    this.persist = persist || this.persist;
    this.life = 1.5;
    this.apply(true);
  }

  hide(): void {
    this.apply(false);
    this.copy?.dispose();
    this.copy = null;
    this.mesh = null;
    this.id = null;
    this.sticky = false;
    this.persist = false;
  }

  private apply(on: boolean): void {
    const root = this.copy ?? this.mesh;
    if (!root || root.isDisposed()) return;
    // Модель оружия может догрузиться позже — проходим по детям каждый раз.
    const small = this.copy !== null;
    for (const m of [root, ...root.getChildMeshes(false)]) {
      if (m instanceof InstancedMesh) continue;
      m.renderOutline = on;
      if (on) {
        m.outlineColor = OUTLINE;
        m.outlineWidth = small ? 0.02 : 0.04;
      }
    }
  }

  /** `following` — герой ещё бежит к предмету; `exists(id)` — предмет ещё лежит. */
  update(dt: number, following: boolean, exists: (id: string) => boolean): void {
    if (!this.id) return;
    if (!exists(this.id) || !this.mesh || this.mesh.isDisposed()) {
      this.hide();
      return;
    }
    if (this.sticky && !following) this.sticky = false;
    if (!this.sticky && !this.persist) {
      this.life -= dt;
      if (this.life <= 0) {
        this.hide();
        return;
      }
    }
    this.apply(true);
  }

  dispose(): void {
    this.hide();
  }
}
