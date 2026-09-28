import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";
import { PointLight } from "@babylonjs/core/Lights/pointLight";

/**
 * Отчёт о свете для спектатора — ищем, почему в OBS на Mac пропадает свет
 * факелов (на Windows в той же версии OBS — есть). Консоль браузер-источника
 * OBS не видна, поэтому отчёт уходит в журнал сервера ([spec-diag] light …):
 * GPU/драйвер и его лимиты, сколько точечных огней включено, со сколькими
 * огнями реально СОБРАН шейдер ключевых материалов (земля/трава/листва) и
 * ошибки компиляции/откаты шейдеров. Шлёт: через 20 с после старта, потом
 * ночью раз в 2 мин (до 6 отчётов за сессию).
 */
export function startLightDiag(
  engine: Engine,
  scene: Scene,
  daylight: () => number,
  send: (text: string) => void,
): void {
  const errors: string[] = [];
  const grab = (kind: string, args: unknown[]): void => {
    const t = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    if (/shader|compile|fallback|effect/i.test(t) && errors.length < 12) errors.push(`${kind}: ${t.slice(0, 300)}`);
  };
  const ow = console.warn.bind(console);
  const oe = console.error.bind(console);
  console.warn = (...a: unknown[]) => {
    grab("warn", a);
    ow(...a);
  };
  console.error = (...a: unknown[]) => {
    grab("error", a);
    oe(...a);
  };

  const gl = (engine as unknown as { _gl?: WebGL2RenderingContext })._gl;
  const gpu = (): string => {
    if (!gl) return "gl=нет";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const ren = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const ven = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    return (
      `gpu=${ven} / ${ren} · ${gl.getParameter(gl.VERSION)} · ` +
      `fragUniforms=${gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS)} ` +
      `vertUniforms=${gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS)} ` +
      `varyings=${gl.getParameter(gl.MAX_VARYING_VECTORS)} ` +
      `texUnits=${gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)}`
    );
  };

  /** Со сколькими огнями собран шейдер материала (по #define LIGHTn в его defines). */
  const matLights = (name: string): string => {
    const m = scene.materials.find((x) => x.name === name);
    if (!m) return `${name}:—`;
    const fx = m.getEffect();
    const defs = (fx as unknown as { defines?: string } | null)?.defines ?? "";
    const n = new Set(defs.match(/#define LIGHT\d+/g) ?? []).size;
    const max = (m as unknown as { maxSimultaneousLights?: number }).maxSimultaneousLights ?? "?";
    return `${name}:${n}/${max}${fx && !fx.isReady() ? "(не готов)" : ""}`;
  };

  let sent = 0;
  const report = (why: string): void => {
    if (sent >= 6) return;
    sent++;
    const pts = scene.lights.filter((l) => l instanceof PointLight);
    const on = pts.filter((l) => l.isEnabled() && l.intensity > 0);
    const torches = on.filter((l) => /torch|bot/i.test(l.name)).length;
    send(
      `light ${why} · day=${daylight().toFixed(2)} · ${gpu()} · ` +
        `pointLights on=${on.length}/${pts.length} (факелы ~${torches}) · ` +
        `mats ${["terrainMat", "grassMat", "treeLeaf", "treeBark", "hubGroundMat"].map(matLights).join(" ")} · ` +
        `errors: ${errors.length ? errors.join(" | ") : "нет"}`,
    );
  };

  setTimeout(() => report("старт"), 20_000);
  setInterval(() => {
    if (daylight() < 0.3) report("ночь");
  }, 120_000);
}
