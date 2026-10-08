import type { Engine } from "@babylonjs/core/Engines/engine";

/**
 * WebGPU по умолчанию (`?gpu=webgl` — старый движок): без поддержки, на VR-устройствах или при ошибке — null,
 * и игра/эфир создают обычный WebGL-движок. В шлеме (WebXR) WebGPU не работает — там всегда WebGL.
 * Свои GLSL-шейдеры Babylon переводит сам (glslang/twgsl грузятся с его CDN при первом запуске).
 */
export function webGpuWanted(): boolean {
  // С 2026-10-08 — по умолчанию (?gpu=webgl — старый движок); нет WebGPU в браузере — WebGL.
  const q = new URLSearchParams(location.search).get("gpu");
  if (q === "webgl" || !("gpu" in navigator)) return false;
  if (q === "webgpu") return true;
  // Шлем (Quest) — WebXR работает только с WebGL. Телефоны/планшеты — тоже WebGL (2026-10-08:
  // с WebGPU телефон сильно грелся — свет там не выключается, а гаснет до нуля и считается всегда).
  if (/OculusBrowser|Quest|Pico|Vision Pro|Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) return false;
  return !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); // iPad «как Mac»
}

/** Есть ли VR-гарнитура (WebXR immersive-vr) — тогда WebGL: из WebGPU в VR не войти. */
async function vrCapable(): Promise<boolean> {
  try {
    const xr = (navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }).xr;
    return xr ? await xr.isSessionSupported("immersive-vr") : false;
  } catch {
    return false;
  }
}

export async function createWebGpuEngine(
  canvas: HTMLCanvasElement,
  o: { antialias: boolean; stencil: boolean; premultipliedAlpha?: boolean },
): Promise<Engine | null> {
  if (!webGpuWanted()) return null;
  if (new URLSearchParams(location.search).get("gpu") !== "webgpu" && (await vrCapable())) return null;
  try {
    const { WebGPUEngine } = await import("@babylonjs/core/Engines/webgpuEngine");
    // Расширения движка (динамические текстуры, RTT, чтение пикселей…) — в WebGL-сборке подключены
    // побочными импортами, у WebGPU — свои.
    await import("@babylonjs/core/Engines/WebGPU/Extensions/index");
    if (!(await WebGPUEngine.IsSupportedAsync)) return null;
    const e = new WebGPUEngine(canvas, {
      antialias: o.antialias,
      stencil: o.stencil,
      powerPreference: "high-performance",
      premultipliedAlpha: o.premultipliedAlpha ?? true,
    });
    await e.initAsync();
    await keepLightsEnabled();
    console.info("[gpu] WebGPU-движок");
    // Типы Game/Spectator — Engine (WebGL); общий API у WebGPUEngine тот же, GL-ветки (_gl) проверяют сами.
    return e as unknown as Engine;
  } catch (err) {
    console.warn("[gpu] WebGPU не поднялся — WebGL", err);
    return null;
  }
}

/**
 * WebGPU: источник света, выключенный setEnabled(false), ломает отрисовку материалов, у которых он
 * был в наборе («Can't find buffer "Light3"» — земля пропадала на кадр). Огни у нас включаются и
 * гаснут постоянно (факелы ботов, светлячки, костёр), поэтому в WebGPU свет НЕ выключаем: он остаётся
 * в сцене с нулевой яркостью (isEnabled() — всегда true: по нему Babylon собирает набор света).
 */
/**
 * Горит ли источник — с учётом WebGPU, где свет не выключается, а гаснет до нуля (keepLightsEnabled):
 * там `isEnabled()` у погашенного всегда true. Использовать вместо `l.isEnabled()` в своём коде
 * (иначе `if (l.isEnabled() !== on) l.setEnabled(on)` погашенный свет больше не зажигал).
 */
export function lightOn(l: { isEnabled(): boolean }): boolean {
  const w = (l as { _wOn?: boolean })._wOn;
  return w === undefined ? l.isEnabled() : w;
}

async function keepLightsEnabled(): Promise<void> {
  const { Light } = await import("@babylonjs/core/Lights/light");
  type L = { _wOn?: boolean; _wI?: number; intensity: number };
  const proto = Light.prototype as unknown as {
    setEnabled(v: boolean): void;
  };
  const origSet = proto.setEnabled;
  proto.setEnabled = function (this: L & typeof proto, v: boolean): void {
    if (this._wOn === undefined) {
      // Первый вызов: яркость — через «выключатель» (выключен — 0), сам свет — всегда в сцене.
      this._wI = this.intensity;
      Object.defineProperty(this, "intensity", {
        get: () => (this._wOn === false ? 0 : (this._wI ?? 0)),
        set: (x: number) => (this._wI = x),
        configurable: true,
      });
      origSet.call(this, true);
    }
    this._wOn = v;
  };
}
