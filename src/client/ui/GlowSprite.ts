import type { Scene } from "@babylonjs/core/scene";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

/**
 * Мягкий белый круг с радиальным затуханием к краю (альфа-канал) — общая
 * текстура для плоских billboard-спрайтов свечения (аура баффа, свечение
 * уникального оружия). В отличие от 3D-сферы, у плоского спрайта нет
 * геометрической "огранки" — край круга всегда гладкий, потому что это
 * готовый градиент, а не многогранник.
 */
export function radialGlowTexture(scene: Scene, size = 64): DynamicTexture {
  const tex = new DynamicTexture(`glowSprite${size}`, { width: size, height: size }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.update(false);
  return tex;
}
