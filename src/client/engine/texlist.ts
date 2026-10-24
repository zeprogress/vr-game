import type { Scene } from "@babylonjs/core/scene";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";

/**
 * Диагностика старта (?texlist=1): какие текстуры сцены уходят на GPU и сколько места они занимают.
 * Список — через задержку, когда загрузка картинок уже прошла. Только в консоль, без влияния на игру.
 */
export function logSceneTextures(scene: Scene, delayMs = 2500): void {
  if (new URLSearchParams(location.search).get("texlist") !== "1") return;
  window.setTimeout(() => {
    const rows = scene.textures.map((t: BaseTexture) => {
      const s = t.getSize();
      const mb = (s.width * s.height * 4 * 1.33) / 1048576; // RGBA + мипы
      const name = (t as { url?: string | null }).url ?? t.name ?? "?";
      return { name: name.split("/").slice(-2).join("/").slice(0, 70), size: `${s.width}x${s.height}`, mb: Math.round(mb * 10) / 10 };
    });
    rows.sort((a, b) => b.mb - a.mb);
    const total = rows.reduce((s, r) => s + r.mb, 0);
    console.log(`[texlist] текстур: ${rows.length}, примерно ${Math.round(total)} МБ в GPU`);
    console.log(`[texlist] ${JSON.stringify(rows.slice(0, 30))}`);
  }, delayMs);
}
