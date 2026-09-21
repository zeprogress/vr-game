import type { Engine } from "@babylonjs/core/Engines/engine";

/**
 * Промежуточный `gl.flush()` посреди кадра — главное найденное узкое место VR в браузере Quest.
 *
 * Как выглядел кадр (трассировка Chrome на шлеме): JS отдавал все GL-команды в буфер команд и
 * только в самом конце кадра сбрасывал их (`flush`) процессу GPU. Затем `XRFrameProvider` ждал
 * (`CommandBuffer::GetGpuFenceHandle`, ~5–6 мс на кадр), пока процесс GPU разберёт и исполнит ВСЕ
 * команды кадра — то есть работа JS (~10 мс) и работа GPU-процесса (~5 мс) шли ПОСЛЕДОВАТЕЛЬНО.
 * Если сбросить буфер на середине кадра, GPU-процесс начинает исполнять первую половину команд,
 * пока JS ещё формирует вторую, и в конце ждать остаётся только хвост. Замер (чередование A/B на
 * Quest 3, одна сцена): 37–40 fps → 49–56 fps.
 *
 * Точка сброса — доля от числа отрисовок ПРОШЛОГО кадра (число отрисовок от кадра к кадру близко).
 */
export interface FlushPacing {
  dispose(): void;
}

export function installFlushPacing(engine: Engine, frac = 0.5): FlushPacing | null {
  if (frac <= 0) return null;
  const gl = engine._gl as WebGL2RenderingContext | undefined;
  if (!gl) return null;

  let count = 0;
  let last = 200;
  const obs = engine.onBeginFrameObservable.add(() => {
    if (count > 0) last = count;
    count = 0;
  });

  const names = ["drawElements", "drawElementsInstanced", "drawArrays", "drawArraysInstanced"] as const;
  for (const name of names) {
    const orig = gl[name].bind(gl) as (...a: unknown[]) => void;
    (gl as unknown as Record<string, unknown>)[name] = function (...a: unknown[]): void {
      orig(...a);
      if (++count === Math.max(8, Math.floor(last * frac))) gl.flush();
    };
  }

  return {
    dispose(): void {
      engine.onBeginFrameObservable.remove(obs);
      for (const name of names) delete (gl as unknown as Record<string, unknown>)[name];
    },
  };
}
