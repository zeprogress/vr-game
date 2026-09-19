import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Свободная камера для отдельного окна (`/?spectator=КЛЮЧ&freecam=1`): летаем
 * по миру руками, а поза уходит на сервер и оттуда — рендерящим спектаторам
 * (они на время показывают вид этого окна). Управление:
 *   ЛКМ/ПКМ + движение мыши — обзор · W/A/S/D — полёт по взгляду · Space/E — вверх ·
 *   Q/C — вниз · Shift — быстрее · колесо — скорость · слайдер — угол обзора.
 */
export class FreeCamControl {
  readonly pos = new Vector3();
  yaw = 0;
  /** Вниз — отрицательный. Почти вертикаль (±89°) разрешена. */
  pitch = -0.6;
  fov = 0.9;
  speed = 25;
  closed = false;
  /** Нажали «Закрыть» — Spectator сообщает серверу. */
  onClose: (() => void) | null = null;

  private readonly keys = new Set<string>();
  private dragging = false;
  private readonly panel: HTMLDivElement;
  private readonly speedLabel: HTMLSpanElement;
  private readonly fovLabel: HTMLSpanElement;
  private readonly fovInput: HTMLInputElement;
  private readonly cleanups: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    canvas.style.cursor = "grab";
    const on = <T extends EventTarget>(t: T, ev: string, fn: (e: never) => void, opt?: AddEventListenerOptions): void => {
      t.addEventListener(ev, fn as EventListener, opt);
      this.cleanups.push(() => t.removeEventListener(ev, fn as EventListener));
    };

    on(canvas, "contextmenu", (e: Event) => e.preventDefault());
    on(canvas, "pointerdown", (e: PointerEvent) => {
      if (this.closed) return;
      this.dragging = true;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });
    on(canvas, "pointerup", (e: PointerEvent) => {
      this.dragging = false;
      canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    });
    on(canvas, "pointermove", (e: PointerEvent) => {
      if (!this.dragging || this.closed) return;
      this.yaw += e.movementX * 0.0035;
      this.pitch = Math.max(-1.553, Math.min(1.553, this.pitch - e.movementY * 0.0035));
    });
    on(
      canvas,
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.speed = Math.max(2, Math.min(400, this.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        this.refreshLabels();
      },
      { passive: false },
    );
    on(window, "keydown", (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      this.keys.add(e.code);
    });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, "blur", () => this.keys.clear());

    this.panel = document.createElement("div");
    this.panel.style.cssText =
      "position:fixed;left:12px;top:12px;z-index:20;padding:10px 12px;border-radius:8px;" +
      "background:rgba(12,13,18,.78);color:#fff;font:13px/1.45 system-ui,sans-serif;" +
      "min-width:240px;user-select:none;";
    this.panel.innerHTML =
      "<b>Свободная камера</b><div style='opacity:.7;font-size:11.5px;margin:2px 0 8px'>" +
      "мышь — обзор · WASD — полёт · Space/Q — вверх/вниз<br>Shift — быстрее · колесо — скорость</div>" +
      "<div>Угол обзора: <span data-fov></span></div>" +
      "<input data-fovin type='range' min='0.3' max='2.2' step='0.01' style='width:100%'>" +
      "<div style='margin:6px 0'>Скорость: <span data-spd></span></div>" +
      "<button style='width:100%;padding:6px;border:0;border-radius:6px;background:#e8433f;color:#fff;" +
      "font-weight:700;cursor:pointer'>Закрыть камеру</button>";
    this.fovLabel = this.panel.querySelector("[data-fov]") as HTMLSpanElement;
    this.speedLabel = this.panel.querySelector("[data-spd]") as HTMLSpanElement;
    this.fovInput = this.panel.querySelector("[data-fovin]") as HTMLInputElement;
    this.fovInput.value = String(this.fov);
    this.fovInput.addEventListener("input", () => {
      this.fov = Number(this.fovInput.value);
      this.refreshLabels();
    });
    this.panel.querySelector("button")!.addEventListener("click", () => this.close());
    document.body.appendChild(this.panel);
    this.refreshLabels();
  }

  /** Встать в позу (x,y,z) и смотреть на (tx,ty,tz) — стартовое положение. */
  setFromPose(x: number, y: number, z: number, tx: number, ty: number, tz: number, fov?: number): void {
    this.pos.set(x, y, z);
    const dx = tx - x;
    const dy = ty - y;
    const dz = tz - z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.yaw = Math.atan2(dx, dz);
    this.pitch = Math.max(-1.553, Math.min(1.553, Math.asin(dy / len)));
    if (fov && Number.isFinite(fov)) {
      this.fov = fov;
      this.fovInput.value = String(fov);
    }
    this.refreshLabels();
  }

  /** Куда смотрим — точка впереди по взгляду. */
  target(out: Vector3): Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(
      this.pos.x + Math.sin(this.yaw) * cp * 20,
      this.pos.y + Math.sin(this.pitch) * 20,
      this.pos.z + Math.cos(this.yaw) * cp * 20,
    );
  }

  update(dt: number): void {
    if (this.closed) return;
    const k = this.keys;
    const cp = Math.cos(this.pitch);
    const fx = Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let mx = 0;
    let my = 0;
    let mz = 0;
    if (k.has("KeyW")) { mx += fx; my += fy; mz += fz; }
    if (k.has("KeyS")) { mx -= fx; my -= fy; mz -= fz; }
    if (k.has("KeyD")) { mx += rx; mz += rz; }
    if (k.has("KeyA")) { mx -= rx; mz -= rz; }
    if (k.has("Space") || k.has("KeyE")) my += 1;
    if (k.has("KeyQ") || k.has("KeyC")) my -= 1;
    const len = Math.hypot(mx, my, mz);
    if (len > 0) {
      const v = (this.speed * (k.has("ShiftLeft") || k.has("ShiftRight") ? 3 : 1) * dt) / len;
      this.pos.x += mx * v;
      this.pos.y = Math.max(1.5, this.pos.y + my * v);
      this.pos.z += mz * v;
    }
  }

  private refreshLabels(): void {
    this.fovLabel.textContent = `${Math.round((this.fov * 180) / Math.PI)}°`;
    this.speedLabel.textContent = `${Math.round(this.speed)} м/с`;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.panel.innerHTML =
      "<b>Свободная камера закрыта</b><div style='opacity:.75;margin-top:4px'>Спектатор вернулся в авто-режим. " +
      "Это окно можно закрыть.</div>";
    this.onClose?.();
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.panel.remove();
  }
}
