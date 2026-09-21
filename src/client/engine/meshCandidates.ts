import type { Scene } from "@babylonjs/core/scene";
import { Node } from "@babylonjs/core/node";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/**
 * Кандидаты в активные меши — только включённые и видимые.
 *
 * Babylon каждый кадр обходит ВСЕ меши сцены (~900: пулы эффектов, скрытые мобы, отключённые экземпляры деревьев, светлячки),
 * для каждого заводит запись LOD в Map, считает вершины и проверяет `isEnabled` по цепочке родителей — по профилю шлема это
 * ~1.7 мс на кадр только на обход. Свой список пересобирается лишь когда что-то могло стать активным: включили узел
 * (`setEnabled(true)`), сделали меш видимым, сменили родителя, добавили меш — и в любом случае раз в ~20 кадров (страховка).
 * Пока список — надмножество реально активных (выключение узла его не сужает — лишние отсеются обычной проверкой),
 * картинка не меняется. `?nocand=1` — вернуть штатный обход.
 */
let dirty = true;
let installed = false;

function installHooks(): void {
  if (installed) return;
  installed = true;
  const setEnabled = Node.prototype.setEnabled;
  Node.prototype.setEnabled = function (this: Node, value: boolean): void {
    const was = this.isEnabled(false);
    setEnabled.call(this, value);
    if (value && !was) dirty = true;
  };
  const vis = Object.getOwnPropertyDescriptor(AbstractMesh.prototype, "isVisible");
  if (vis?.get && vis.set) {
    Object.defineProperty(AbstractMesh.prototype, "isVisible", {
      configurable: true,
      get: vis.get,
      set(this: AbstractMesh, v: boolean) {
        const was = vis.get!.call(this) as boolean;
        vis.set!.call(this, v);
        if (v && !was) dirty = true;
      },
    });
  }
  const par = Object.getOwnPropertyDescriptor(Node.prototype, "parent");
  if (par?.get && par.set) {
    Object.defineProperty(Node.prototype, "parent", {
      configurable: true,
      get: par.get,
      set(this: Node, v: Node | null) {
        par.set!.call(this, v);
        dirty = true;
      },
    });
  }
}

export function installActiveMeshCandidates(scene: Scene): void {
  if (new URLSearchParams(location.search).has("nocand")) return;
  installHooks();
  const cand = { data: [] as AbstractMesh[], length: 0 };
  let age = 0;
  scene.onNewMeshAddedObservable.add(() => {
    dirty = true;
  });
  scene.onMeshRemovedObservable.add(() => {
    dirty = true;
  });
  scene.getActiveMeshCandidates = () => {
    if (dirty || ++age > 20) {
      dirty = false;
      age = 0;
      const ms = scene.meshes;
      let n = 0;
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        if (m.isBlocked || !m.isVisible || !m.isEnabled()) continue;
        cand.data[n++] = m;
      }
      cand.length = n;
      cand.data.length = n;
    }
    return cand as unknown as ReturnType<Scene["getActiveMeshCandidates"]>;
  };
}
