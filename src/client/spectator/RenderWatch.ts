import type { Engine } from "@babylonjs/core/Engines/engine";
import type { Scene } from "@babylonjs/core/scene";

/** Сторож зависаний: как часто щупаем кадр и когда считаем его застывшим. */
const PROBE_EVERY = 8000; // мс между пробами картинки
const PROBE_PX = 8; // сторона квадрата пикселей в центре кадра
const PROBE_CAM_MOVE = 0.5; // м: камера должна была уехать, иначе проба не в счёт
const PROBE_STALE_LIMIT = 3; // столько проб подряд без изменений — зависли
const RENDER_STALL_MS = 10000; // мс без единого scene.render() — цикл умер
/** Как часто пишем строку в историю и сколько строк храним (≈10 минут). */
const SAMPLE_EVERY = 30_000;
const SAMPLE_KEEP = 20;
/** Сколько ждём восстановления контекста, прежде чем сдаться и перезагрузиться. */
const CTX_RESTORE_WAIT = 6000;

/** Как часто повторяем в журнал одну и ту же ошибку кадра и когда сдаёмся. */
const ERR_REPORT_EVERY = 60_000;
const ERR_FATAL = 600;

const LS_KEY = "specFreezeReport";

interface Sample {
  /** Секунд от старта страницы. */
  t: number;
  fps: number;
  /** МБ JS-кучи (только Chromium/CEF, иначе -1). */
  heap: number;
  meshes: number;
  mats: number;
  tex: number;
  anims: number;
}

/**
 * Диагностика зависаний картинки спектатора (в первую очередь — в OBS).
 *
 * Сторож ловит СИМПТОМ (оверлей жив, кадр застыл) и лечит перезагрузкой, но
 * этого мало: нужно понять причину. Поэтому здесь же копится история
 * состояния (fps, куча, число мешей/материалов/анимаций) за последние ~10
 * минут, и в момент срабатывания всё это складывается в отчёт:
 *
 *  - отчёт кладётся в localStorage и после перезагрузки уходит на сервер
 *    (`SpecCmd {t:"diag"}` → в журнал systemd), потому что консоль браузер-
 *    источника OBS никто не видит;
 *  - в отчёте есть, какой именно детектор сработал, жив ли WebGL-контекст,
 *    сколько страница прожила и на каком рендерере крутится OBS
 *    (аппаратный GPU или программный SwiftShader — это меняет диагноз).
 *
 * Разные причины дают разные подписи:
 *  - «утечка»: в истории видно рост meshes/mats/heap и падение fps;
 *  - «GPU-процесс CEF умер»: история ровная, `ctxLost=true`, обрыв мгновенный;
 *  - «цикл rAF встал»: сработал детектор `цикл рендера встал` при живом контексте.
 */
export class RenderWatch {
  private readonly bootAt = performance.now();
  private readonly samples: Sample[] = [];
  private lastRenderAt = 0;
  private probeAt = 0;
  private probeSig = -1;
  private probeCamX = 0;
  private probeCamZ = 0;
  private probeStale = 0;
  private reloading = false;
  /** Сколько раз ловили webglcontextlost и сколько раз он восстанавливался. */
  private ctxLostCount = 0;
  private ctxRestoredCount = 0;
  private ctxLostAt = 0;
  /** Исключения внутри кадра: сколько всего, последнее и когда докладывали. */
  private errCount = 0;
  private lastErr = "";
  private errSentAt = 0;

  constructor(
    private readonly engine: Engine,
    private readonly scene: Scene,
    /** Где сейчас камера — проба кадра засчитывается, только если она уехала. */
    private readonly camPos: () => { x: number; z: number },
    /** Текущая реальная частота scene.render() (getFps() врёт при кап-скипе). */
    private readonly renderRate: () => number,
    /** Отправка строки диагностики на сервер (в журнал). Может быть null. */
    private readonly report: (text: string) => void,
    /** Показать текст на странице (в OBS-режиме это no-op). */
    private readonly setStatus: (text: string) => void,
  ) {}

  /** Поднять сторожа: слушатели контекста, опрос, история. */
  start(): void {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return;
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;

    // Контекст: НЕ перезагружаемся сразу. Babylon умеет пересобрать ресурсы
    // сам (webglcontextrestored) — даём ему шанс, и только если восстановления
    // не случилось за CTX_RESTORE_WAIT, признаём потерю фатальной.
    canvas.addEventListener("webglcontextlost", () => {
      this.ctxLostCount++;
      this.ctxLostAt = performance.now();
      console.warn("[spectator] webglcontextlost — жду восстановления");
      setTimeout(() => {
        if (gl?.isContextLost()) this.freeze("контекст не восстановился");
      }, CTX_RESTORE_WAIT);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.ctxRestoredCount++;
      this.ctxLostAt = 0;
      console.warn(
        "[spectator] webglcontextrestored — картинка должна вернуться",
      );
    });

    setInterval(() => {
      if (gl?.isContextLost() && this.ctxLostAt === 0) {
        // Событие не пришло (бывает на части драйверов), а контекст мёртв.
        this.ctxLostCount++;
        this.ctxLostAt = performance.now();
        setTimeout(() => {
          if (gl.isContextLost()) this.freeze("контекст потерян (опрос)");
        }, CTX_RESTORE_WAIT);
        return;
      }
      if (
        this.lastRenderAt > 0 &&
        performance.now() - this.lastRenderAt > RENDER_STALL_MS
      ) {
        this.freeze("цикл рендера встал");
      }
    }, 5000);

    setInterval(() => this.sample(), SAMPLE_EVERY);
    this.sample();

    // Отчёт с прошлой жизни страницы (перед перезагрузкой) — отдать на сервер.
    this.flushPending();
  }

  /**
   * Зовётся из рендер-цикла сразу после scene.render(). Отмечает живой кадр
   * и изредка снимает пробу пикселей — из setInterval бэкбуфер читать нельзя.
   */
  afterRender(now: number): void {
    this.lastRenderAt = now;
    if (now < this.probeAt) return;
    this.probeAt = now + PROBE_EVERY;
    this.probeFrame();
  }

  /**
   * Исключение внутри кадра. Это САМАЯ вероятная причина «оверлей жив, картинка
   * застыла»: Babylon ставит следующий кадр в очередь в КОНЦЕ `_renderLoop`,
   * поэтому любой бросок из рендер-колбэка (или из onBeforeRender) навсегда
   * обрывает цепочку rAF, а сеть и DOM продолжают работать. Ловим, называем
   * виновника в журнале сервера и продолжаем крутиться.
   */
  onError(where: string, e: unknown): void {
    this.errCount++;
    const msg =
      e instanceof Error
        ? `${e.message} | ${(e.stack ?? "").slice(0, 400)}`
        : String(e);
    if (msg !== this.lastErr) {
      this.lastErr = msg;
      this.errSentAt = 0; // новая ошибка — сообщаем сразу
    }
    const now = performance.now();
    if (now - this.errSentAt > ERR_REPORT_EVERY) {
      this.errSentAt = now;
      const text = `исключение в кадре (${where}) №${this.errCount}: ${msg}`;
      console.error(`[spectator] ${text}`);
      this.report(text);
    }
    // Сыплется каждый кадр — сцена сломана насовсем, проще перезагрузиться.
    if (this.errCount > ERR_FATAL)
      this.freeze(`исключение в кадре (${where}): ${msg}`);
  }

  /** Короткая сводка для отладочной строки (`?debug=1`). */
  debugLine(): string {
    const ago =
      this.lastRenderAt > 0
        ? (performance.now() - this.lastRenderAt) / 1000
        : 0;
    return (
      `кадр ${ago.toFixed(1)}с назад · застой ${this.probeStale}` +
      ` · потерь ${this.ctxLostCount} · ошибок ${this.errCount}`
    );
  }

  // ---- история состояния ----

  private sample(): void {
    const mem = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory;
    this.samples.push({
      t: Math.round((performance.now() - this.bootAt) / 1000),
      fps: Math.round(this.renderRate()),
      heap: mem ? Math.round(mem.usedJSHeapSize / 1048576) : -1,
      meshes: this.scene.meshes.length,
      mats: this.scene.materials.length,
      tex: this.scene.textures.length,
      anims: this.scene.animatables.length,
    });
    if (this.samples.length > SAMPLE_KEEP) this.samples.shift();
  }

  // ---- проба кадра ----

  private probeFrame(): void {
    const gl = (this.engine as unknown as { _gl?: WebGL2RenderingContext })._gl;
    if (!gl) return;
    const w = this.engine.getRenderWidth();
    const h = this.engine.getRenderHeight();
    if (w < 16 || h < 16) return;
    const buf = new Uint8Array(PROBE_PX * PROBE_PX * 4);
    try {
      gl.readPixels(
        Math.floor(w / 2) - PROBE_PX / 2,
        Math.floor(h / 2) - PROBE_PX / 2,
        PROBE_PX,
        PROBE_PX,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        buf,
      );
    } catch {
      return; // читать бэкбуфер не дали — сторож просто молчит
    }
    let sig = 0;
    for (let i = 0; i < buf.length; i += 4)
      sig = (sig * 31 + buf[i] + buf[i + 1] * 3) | 0;

    const cam = this.camPos();
    const moved = Math.hypot(cam.x - this.probeCamX, cam.z - this.probeCamZ);
    this.probeCamX = cam.x;
    this.probeCamZ = cam.z;

    if (this.probeSig === sig && moved > PROBE_CAM_MOVE) {
      this.probeStale++;
      if (this.probeStale >= PROBE_STALE_LIMIT) this.freeze("кадр не меняется");
    } else {
      this.probeStale = 0;
    }
    this.probeSig = sig;
  }

  // ---- отчёт и восстановление ----

  /** Кто рисует страницу на самом деле: реальный GPU или программный растр. */
  private renderer(): string {
    try {
      const gl = (this.engine as unknown as { _gl?: WebGL2RenderingContext })
        ._gl;
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      if (!gl || !ext) return "неизвестен";
      return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch {
      return "неизвестен";
    }
  }

  private buildReport(why: string): string {
    const gl = (this.engine as unknown as { _gl?: WebGL2RenderingContext })._gl;
    const uptime = Math.round((performance.now() - this.bootAt) / 1000);
    const head = [
      `причина=${why}`,
      `аптайм=${uptime}с`,
      `контекст=${gl?.isContextLost() ? "потерян" : "жив"}`,
      `потерь=${this.ctxLostCount}`,
      `восстановлений=${this.ctxRestoredCount}`,
      `видимость=${document.visibilityState}`,
      `fps=${Math.round(this.renderRate())}`,
      `ошибок=${this.errCount}`,
      `рендерер=${this.renderer()}`,
      `экран=${this.engine.getRenderWidth()}x${this.engine.getRenderHeight()}`,
    ].join(" ");
    const hist = this.samples
      .map(
        (s) =>
          `${s.t}s fps${s.fps} heap${s.heap} m${s.meshes} mt${s.mats} tx${s.tex} an${s.anims}`,
      )
      .join(" | ");
    return `${head} :: ${hist}`;
  }

  /** Единая точка: собрать отчёт, сохранить его на после перезагрузки, перезагрузиться. */
  private freeze(why: string): void {
    if (this.reloading) return;
    this.reloading = true;
    const text = this.buildReport(why);
    console.warn(`[spectator] рендер завис — ${text}`);
    // Пишем в оба места: на сервер прямо сейчас (если связь жива) и в
    // localStorage — вдруг сообщение не успеет уйти до перезагрузки.
    try {
      localStorage.setItem(LS_KEY, text);
    } catch {
      /* приватный режим — переживём */
    }
    this.report(text);
    this.setStatus("ZEP GAME — восстанавливаю рендер…");
    setTimeout(() => location.reload(), 1500);
  }

  /** Отчёт, оставшийся с прошлой жизни страницы, — дослать и стереть. */
  private flushPending(): void {
    let text: string | null = null;
    try {
      text = localStorage.getItem(LS_KEY);
      if (text) localStorage.removeItem(LS_KEY);
    } catch {
      return;
    }
    if (!text) return;
    console.warn(`[spectator] отчёт о прошлом зависании: ${text}`);
    // Связь поднимается не мгновенно — даём ей время.
    setTimeout(() => this.report(`(после перезагрузки) ${text}`), 8000);
  }
}
