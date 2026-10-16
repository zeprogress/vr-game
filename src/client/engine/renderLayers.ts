import { RenderingManager } from "@babylonjs/core/Rendering/renderingManager";
import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";

/**
 * Слои отрисовки (renderingGroupId), по порядку:
 *  - ground   — земля и пол (рельеф, полы катакомб/подземелья/лагеря, трава);
 *  - groundFx — круги эффектов у земли: поверх земли, даже если частично ушли в неё (без теста глубины);
 *  - world    — всё остальное (герои, мобы, деревья, камни, постройки): глубина земли не стирается,
 *               поэтому мир прячется за холмами и перекрывает круги эффектов;
 *  - overlay  — поверх мира (глубина стирается): плашки сквозь стены, подписи;
 *  - ui       — VR-интерфейс (панели, компас, лазер);
 *  - top      — самое верхнее (виньетки, затемнение).
 * Новый меш попадает в world сам (setupRenderLayers); землю помечать groundLayer().
 */
export const LAYER = { ground: 0, groundFx: 1, world: 2, overlay: 3, ui: 4, top: 5 } as const;

// Babylon по умолчанию держит 4 группы — нам нужно 6. Ставится до создания сцены (импорт модуля).
RenderingManager.MAX_RENDERINGGROUPS = Math.max(RenderingManager.MAX_RENDERINGGROUPS, 6);

/** Меши, помеченные землёй: их группа 0 — не «не назначено». */
const groundMeshes = new WeakSet<AbstractMesh>();

/** Сразу после new Scene: общая глубина у земли, эффектов и мира; новые меши — в world. */
export function setupRenderLayers(scene: Scene): void {
  scene.setRenderingAutoClearDepthStencil(LAYER.groundFx, false, false, false);
  scene.setRenderingAutoClearDepthStencil(LAYER.world, false, false, false);
  // Babylon шлёт это событие ОТЛОЖЕННО (Tools.SetImmediate в scene.addMesh) — уже после того, как код
  // назначил группу. Поэтому группа 0 тут — «не назначено», кроме мешей, помеченных groundLayer().
  scene.onNewMeshAddedObservable.add((m) => {
    // Инстансы рисуются вместе с исходным мешем — его группой.
    if ("sourceMesh" in m) return;
    if (m.renderingGroupId === 0 && !groundMeshes.has(m)) m.renderingGroupId = LAYER.world;
  });
}

/** Меш земли/пола: рисуется первым, круги эффектов ложатся поверх него. */
export function groundLayer(mesh: AbstractMesh): void {
  groundMeshes.add(mesh);
  mesh.renderingGroupId = LAYER.ground;
}

/** Помечен ли меш землёй (groundLayer) — группу сразу после создания читать нельзя, см. setupRenderLayers. */
export function isGroundLayer(mesh: AbstractMesh): boolean {
  return groundMeshes.has(mesh);
}
