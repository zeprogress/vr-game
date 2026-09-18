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

/**
 * Язык пламени: вытянутый вверх силуэт (уже книзу — шире, к вершине — острее,
 * с волнистым краем), а не прямоугольник — раньше "языки пламени" горящего
 * моба были плоскими квадратными карточками сплошного цвета. Цвет градиентом
 * запечён прямо в текстуру (жёлто-белое у основания → оранжево-красное к
 * вершине), поэтому материал читает и RGB, и альфу из одной картинки (тот же
 * приём, что и у "MISS"/чисел урона в WorldCrossFx.ts — diffuse/emissive/
 * opacity все указывают на один DynamicTexture, useAlphaFromDiffuseTexture).
 */
export function flameTexture(scene: Scene, w = 48, h = 80): DynamicTexture {
  const tex = new DynamicTexture(`flameSprite${w}x${h}`, { width: w, height: h }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  // Силуэт языка пламени: острая вершина сверху, волнистые "плечи", широкое
  // основание снизу — кривыми Безье, не прямыми линиями прямоугольника.
  ctx.beginPath();
  ctx.moveTo(cx, h * 0.02);
  ctx.bezierCurveTo(cx + w * 0.32, h * 0.16, cx + w * 0.08, h * 0.32, cx + w * 0.34, h * 0.52);
  ctx.bezierCurveTo(cx + w * 0.48, h * 0.68, cx + w * 0.34, h * 0.84, cx, h * 0.99);
  ctx.bezierCurveTo(cx - w * 0.34, h * 0.84, cx - w * 0.48, h * 0.68, cx - w * 0.34, h * 0.52);
  ctx.bezierCurveTo(cx - w * 0.08, h * 0.32, cx - w * 0.32, h * 0.16, cx, h * 0.02);
  ctx.closePath();

  // Цвет: тёплый градиент вдоль высоты — ярко-жёлтое основание, оранжево-
  // красная вершина (как настоящее пламя, а не один сплошной оттенок).
  const colorGrad = ctx.createLinearGradient(0, h, 0, 0);
  colorGrad.addColorStop(0, "rgb(255,235,150)");
  colorGrad.addColorStop(0.45, "rgb(255,150,40)");
  colorGrad.addColorStop(1, "rgb(230,50,20)");
  ctx.fillStyle = colorGrad;
  ctx.fill();

  // Мягкий край: обрезаем полученный силуэт радиальным градиентом альфы —
  // без этого шага граница осталась бы жёсткой линией самой кривой Безье.
  const grad = ctx.createRadialGradient(cx, h * 0.58, 0, cx, h * 0.58, h * 0.56);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.75, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  tex.update(false);
  return tex;
}
