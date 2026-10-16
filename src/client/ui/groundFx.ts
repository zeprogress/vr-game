import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Constants } from "@babylonjs/core/Engines/constants";
import { LAYER } from "../engine/renderLayers";

/**
 * Круг эффекта у земли (зона ульты, метка умения, телеграф моба): виден сквозь землю.
 * Отдельная группа отрисовки поверх основной сцены и без теста глубины. Вызывать ПОСЛЕ
 * того, как у меша назначен материал.
 */
export function groundFxThrough(mesh: AbstractMesh): void {
  mesh.renderingGroupId = LAYER.groundFx;
  const m = mesh.material;
  if (m) {
    m.depthFunction = Constants.ALWAYS;
    m.disableDepthWrite = true;
  }
}
