import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * Лёгкая диагностика сервера: раз в минуту одна строка `[perf]` в журнал
 * (`journalctl -u vrgame | grep '\[perf\]'`). Что меряем:
 *  • тик симуляции (среднее / p95 / максимум) — бюджет 50 мс при 20 Гц, и его части;
 *  • сериализацию патчей состояния (broadcastPatch);
 *  • лаг цикла событий node (любая блокировка, не только тик);
 *  • исходящий/входящий трафик по сокетам клиентов;
 *  • сколько игроков/мобов/лута, память, загрузку CPU и запись сейвов.
 * Стоимость — несколько performance.now() за тик. Выключается `SERVER_PERF=0`.
 */

const REPORT_MS = 60_000;
const SAMPLES = 1400; // ~70 с тиков по 20 Гц

export interface PerfSnapshot {
  clients: number;
  players: number;
  mobs: number;
  drops: number;
  bolts: number;
  /** Суммарные байты, записанные/прочитанные сокетами клиентов за всё время (монотонные). */
  bytesOut: number;
  bytesIn: number;
}

interface Sect {
  n: number;
  sum: number;
  max: number;
}

const newSect = (): Sect => ({ n: 0, sum: 0, max: 0 });
const add = (s: Sect, ms: number): void => {
  s.n++;
  s.sum += ms;
  if (ms > s.max) s.max = ms;
};
const avg = (s: Sect): number => (s.n ? s.sum / s.n : 0);
const f1 = (v: number): string => v.toFixed(1);

class ServerPerf {
  private readonly on = process.env.SERVER_PERF !== "0";
  private timer: NodeJS.Timeout | null = null;
  private readonly loop = monitorEventLoopDelay({ resolution: 10 });
  private snap: (() => PerfSnapshot) | null = null;
  /** Кто сообщит про запись сейвов (PlayerStore): длительность и размер последней. */
  storeInfo: (() => { flushMs: number; bytes: number; flushes: number }) | null = null;

  private ticks = new Float64Array(SAMPLES);
  private tickN = 0;
  private tickTotal = newSect();
  private bots = newSect();
  private sim = newSect();
  private persist = newSect();
  private patch = newSect();
  private over25 = 0;
  private over50 = 0;
  private cpuPrev = process.cpuUsage();
  private tPrev = performance.now();
  private outPrev = 0;
  private inPrev = 0;

  now(): number {
    return performance.now();
  }

  tick(ms: number): void {
    if (!this.on) return;
    add(this.tickTotal, ms);
    this.ticks[this.tickN++ % SAMPLES] = ms;
    if (ms > 25) this.over25++;
    if (ms > 50) this.over50++;
  }
  section(name: "bots" | "sim" | "persist" | "patch", ms: number): void {
    if (!this.on) return;
    add(this[name], ms);
  }

  start(snap: () => PerfSnapshot): void {
    if (!this.on || this.timer) return;
    this.snap = snap;
    this.loop.enable();
    this.timer = setInterval(() => this.report(), REPORT_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.loop.disable();
  }

  private report(): void {
    const now = performance.now();
    const secs = (now - this.tPrev) / 1000;
    this.tPrev = now;

    const n = Math.min(this.tickN, SAMPLES);
    let p95 = 0;
    if (n > 0) {
      const sorted = Array.from(this.ticks.subarray(0, n)).sort((a, b) => a - b);
      p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))];
    }
    const cpu = process.cpuUsage(this.cpuPrev);
    this.cpuPrev = process.cpuUsage();
    const cpuPct = ((cpu.user + cpu.system) / 1000 / (secs * 1000)) * 100;

    const s = this.snap?.();
    let net = "";
    if (s) {
      net = ` | сеть out ${f1(Math.max(0, s.bytesOut - this.outPrev) / 1024 / secs)} KB/s in ${f1(Math.max(0, s.bytesIn - this.inPrev) / 1024 / secs)} KB/s`;
      this.outPrev = s.bytesOut;
      this.inPrev = s.bytesIn;
    }
    const mem = process.memoryUsage();
    const st = this.storeInfo?.();

    console.log(
      `[perf] ${Math.round(secs)}с | тик avg ${f1(avg(this.tickTotal))} p95 ${f1(p95)} max ${f1(this.tickTotal.max)} мс ` +
        `(>25: ${this.over25}, >50: ${this.over50}; из ${this.tickTotal.n}) ` +
        `| боты ${f1(avg(this.bots))}/${f1(this.bots.max)} сим ${f1(avg(this.sim))}/${f1(this.sim.max)} ` +
        `сейв-блок max ${f1(this.persist.max)} | патч avg ${f1(avg(this.patch))} max ${f1(this.patch.max)} мс ` +
        `| цикл p99 ${f1(this.loop.percentile(99) / 1e6)} max ${f1(this.loop.max / 1e6)} мс ` +
        `| CPU ${cpuPct.toFixed(0)}%` +
        net +
        (s ? ` | клиентов ${s.clients} (игроков ${s.players}) мобов ${s.mobs} лута ${s.drops} снарядов ${s.bolts}` : "") +
        ` | rss ${Math.round(mem.rss / 1048576)} heap ${Math.round(mem.heapUsed / 1048576)} МБ` +
        (st ? ` | сейв ${f1(st.flushMs)} мс, ${Math.round(st.bytes / 1024)} КБ (${st.flushes} зап.)` : ""),
    );

    this.tickN = 0;
    this.tickTotal = newSect();
    this.bots = newSect();
    this.sim = newSect();
    this.persist = newSect();
    this.patch = newSect();
    this.over25 = 0;
    this.over50 = 0;
    this.loop.reset();
  }
}

export const serverPerf = new ServerPerf();
