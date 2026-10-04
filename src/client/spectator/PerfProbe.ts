/**
 * Замер кадра спектатора по этапам (`?perf=1`). Накладные расходы — несколько
 * performance.now() за кадр. Раз в секунду отдаёт строку со средним по этапам,
 * а на «плохом» кадре (долгая работа или пауза между кадрами) присылает разбор:
 * какой этап съел время, была ли пауза вне нашего кода (сборка мусора, браузер,
 * OBS) и размер кучи JS — по её падению виден GC.
 */
export class PerfProbe {
  private last = 0;
  private frameStartAt = 0;
  private prevFrameStart = 0;
  private cur = new Map<string, number>();
  private readonly sums = new Map<string, number>();
  private frames = 0;
  private windowAt = 0;
  private maxWork = 0;
  private maxGap = 0;
  private lastSpikeAt = 0;
  private prevHeap = 0;
  /** Длинное окно (для сводки раз в 10 минут, takeReport): суммы этапов, кадры, тяжёлые кадры. */
  private readonly longSums = new Map<string, number>();
  private longFrames = 0;
  private longWork = 0;
  private longMaxWork = 0;
  private longMaxGap = 0;
  private longOver33 = 0;
  private longOver50 = 0;
  private longGap100 = 0;
  private longAt = 0;
  /** Последняя сводка (для плашки ?debug=1). */
  line = "";

  constructor(
    private readonly onSpike: (text: string) => void,
    /** Что дописать к сводке (кадр камеры, число мобов…). */
    private readonly context: () => string,
  ) {}

  frameStart(now: number): void {
    this.prevFrameStart = this.frameStartAt;
    this.frameStartAt = now;
    this.last = now;
    this.cur.clear();
  }

  /** Время с прошлой метки записываем на этап `name`. */
  mark(name: string): void {
    const t = performance.now();
    this.cur.set(name, (this.cur.get(name) ?? 0) + (t - this.last));
    this.last = t;
  }

  frameEnd(): void {
    const now = performance.now();
    const work = now - this.frameStartAt;
    const gap = this.prevFrameStart > 0 ? this.frameStartAt - this.prevFrameStart : 0;
    this.frames++;
    for (const [k, v] of this.cur) {
      this.sums.set(k, (this.sums.get(k) ?? 0) + v);
      this.longSums.set(k, (this.longSums.get(k) ?? 0) + v);
    }
    if (this.longAt === 0) this.longAt = now;
    this.longFrames++;
    this.longWork += work;
    this.longMaxWork = Math.max(this.longMaxWork, work);
    this.longMaxGap = Math.max(this.longMaxGap, gap);
    if (work > 33) this.longOver33++;
    if (work > 50) this.longOver50++;
    if (gap > 100) this.longGap100++;
    this.maxWork = Math.max(this.maxWork, work);
    this.maxGap = Math.max(this.maxGap, gap);

    // Плохой кадр: наша работа >40 мс, либо между кадрами >90 мс (при кэпе 30 fps
    // норма ~33). Не чаще раза в 4 с, чтобы не завалить журнал сервера.
    if ((work > 40 || gap > 90) && now - this.lastSpikeAt > 4000) {
      this.lastSpikeAt = now;
      const stages = [...this.cur.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v.toFixed(1)}`)
        .join(", ");
      const heap = this.heapMb();
      const dropped = this.prevHeap > 0 && heap > 0 && this.prevHeap - heap > 5 ? " (куча упала — GC)" : "";
      this.onSpike(
        `[perf] кадр: работа ${work.toFixed(0)} мс, пауза между кадрами ${gap.toFixed(0)} мс; ` +
          `этапы мс: ${stages}; куча ${heap.toFixed(0)} МБ${dropped}; ${this.context()}`,
      );
    }
    if (this.heapMb() > 0) this.prevHeap = this.heapMb();

    if (this.windowAt === 0) this.windowAt = now;
    if (now - this.windowAt >= 1000) {
      const n = Math.max(1, this.frames);
      const parts = [...this.sums.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${(v / n).toFixed(1)}`)
        .join(" · ");
      this.line = `мс/кадр: ${parts} · макс ${this.maxWork.toFixed(0)} · пауза макс ${this.maxGap.toFixed(0)}`;
      this.sums.clear();
      this.frames = 0;
      this.maxWork = 0;
      this.maxGap = 0;
      this.windowAt = now;
    }
  }

  /**
   * Сводка за длинное окно (с прошлого вызова) и сброс: fps, средняя работа кадра и по этапам,
   * сколько кадров тяжелее 33/50 мс и пауз между кадрами >100 мс (рывки на стриме).
   */
  takeReport(): string {
    const now = performance.now();
    const secs = Math.max(0.001, (now - this.longAt) / 1000);
    const n = Math.max(1, this.longFrames);
    const parts = [...this.longSums.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${(v / n).toFixed(1)}`)
      .join(" · ");
    const out =
      `fps ${(this.longFrames / secs).toFixed(1)} · работа кадра ${(this.longWork / n).toFixed(1)} мс (макс ${this.longMaxWork.toFixed(0)}) · ` +
      `этапы мс: ${parts} · кадров >33 мс ${this.longOver33}, >50 мс ${this.longOver50} · пауз >100 мс ${this.longGap100} (макс ${this.longMaxGap.toFixed(0)}) · ` +
      `за ${Math.round(secs)} с`;
    this.longSums.clear();
    this.longFrames = 0;
    this.longWork = 0;
    this.longMaxWork = 0;
    this.longMaxGap = 0;
    this.longOver33 = 0;
    this.longOver50 = 0;
    this.longGap100 = 0;
    this.longAt = now;
    return out;
  }

  heapMb(): number {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize / 1048576 : 0;
  }
}
