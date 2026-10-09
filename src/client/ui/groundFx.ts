import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Constants } from "@babylonjs/core/Engines/constants";

/**
 * Круг эффекта у земли (зона ульты, метка умения, телеграф моба): виден сквозь землю.
 * Отдельная группа отрисовки поверх основной сцены и без теста глубины. Вызывать ПОСЛЕ
 * того, как у меша назначен материал.
 */
export function groundFxThrough(mesh: AbstractMesh): void {
  mesh.renderingGroupId = 1;
  const m = mesh.material;
  if (m) {
    m.depthFunction = Constants.ALWAYS;
    m.disableDepthWrite = true;
  }
}
