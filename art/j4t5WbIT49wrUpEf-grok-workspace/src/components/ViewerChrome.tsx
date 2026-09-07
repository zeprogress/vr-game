import {
  Flame,
  Moon,
  RotateCcw,
  RotateCw,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useViewer } from "@/campfire/store";

export function ViewerChrome() {
  const mode = useViewer((s) => s.mode);
  const autoRotate = useViewer((s) => s.autoRotate);
  const muted = useViewer((s) => s.muted);
  const setMode = useViewer((s) => s.setMode);
  const toggleAutoRotate = useViewer((s) => s.toggleAutoRotate);
  const toggleMuted = useViewer((s) => s.toggleMuted);
  const resetCamera = useViewer((s) => s.resetCamera);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-4 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-[18rem]">
          <p className="font-sans text-xs font-medium tracking-[0.18em] text-muted uppercase">
            Боевой лагерь
          </p>
          <h1 className="font-display text-4xl leading-none text-fg sm:text-5xl">
            Костёр
          </h1>
          <p className="mt-2 max-w-[16rem] text-sm leading-snug text-muted">
            Центр площади. Радиус 2 м. Камни, поленья и живой огонь.
          </p>
        </div>
        <div className="pointer-events-auto hidden items-center gap-2 rounded-lg border border-border bg-surface/80 px-3 py-2 text-xs text-muted sm:flex">
          <Flame className="size-3.5 text-accent" strokeWidth={1.75} />
          <span>HUB · (0, 0, 0)</span>
        </div>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="hidden text-xs text-muted sm:block">
          Тяни, чтобы осмотреть · колесо — масштаб
        </p>
        <div className="pointer-events-auto flex flex-wrap gap-2">
          <Button
            variant={mode === "day" ? "solid" : "ghost"}
            pressed={mode === "day"}
            onClick={() => setMode("day")}
            aria-pressed={mode === "day"}
          >
            <Sun className="size-4" strokeWidth={1.75} />
            День
          </Button>
          <Button
            variant={mode === "night" ? "solid" : "ghost"}
            pressed={mode === "night"}
            onClick={() => setMode("night")}
            aria-pressed={mode === "night"}
          >
            <Moon className="size-4" strokeWidth={1.75} />
            Ночь
          </Button>
          <Button
            pressed={autoRotate}
            variant={autoRotate ? "solid" : "ghost"}
            onClick={toggleAutoRotate}
            aria-pressed={autoRotate}
          >
            <RotateCw className="size-4" strokeWidth={1.75} />
            Вращение
          </Button>
          <Button
            variant={muted ? "ghost" : "solid"}
            pressed={!muted}
            onClick={toggleMuted}
            aria-pressed={!muted}
            aria-label={muted ? "Включить звук" : "Выключить звук"}
          >
            {muted ? (
              <VolumeX className="size-4" strokeWidth={1.75} />
            ) : (
              <Volume2 className="size-4" strokeWidth={1.75} />
            )}
            <span className="sm:inline">Звук</span>
          </Button>
          <Button variant="ghost" onClick={resetCamera} aria-label="Сбросить камеру">
            <RotateCcw className="size-4" strokeWidth={1.75} />
            Сброс
          </Button>
        </div>
      </div>
    </div>
  );
}
