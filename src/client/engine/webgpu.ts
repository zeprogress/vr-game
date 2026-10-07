import type { Engine } from "@babylonjs/core/Engines/engine";

/**
 * Пробный WebGPU-режим (`?gpu=webgpu`): без флага, без поддержки в браузере или при ошибке — null,
 * и игра/эфир создают обычный WebGL-движок. В шлеме (WebXR) WebGPU не работает — там всегда WebGL.
 * Свои GLSL-шейдеры Babylon переводит сам (glslang/twgsl грузятся с его CDN при первом запуске).
 */
export function webGpuWanted(): boolean {
  return new URLSearchParams(location.search).get("gpu") === "webgpu" && "gpu" in navigator;
}

export async function createWebGpuEngine(
  canvas: HTMLCanvasElement,
  o: { antialias: boolean; stencil: boolean; premultipliedAlpha?: boolean },
): Promise<Engine | null> {
  if (!webGpuWanted()) return null;
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
    console.info("[gpu] WebGPU-движок");
    // Типы Game/Spectator — Engine (WebGL); общий API у WebGPUEngine тот же, GL-ветки (_gl) проверяют сами.
    return e as unknown as Engine;
  } catch (err) {
    console.warn("[gpu] WebGPU не поднялся — WebGL", err);
    return null;
  }
}
