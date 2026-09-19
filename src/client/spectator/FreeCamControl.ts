import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Свободная камера для отдельного окна (`/?spectator=КЛЮЧ&freecam=1`): летаем
 * по миру руками, а поза уходит на сервер и оттуда — рендерящим спектаторам
 * (они на время показывают вид этого окна).
 *
 * Компьютер: зажать кнопку мыши и двигать — обзор; W/A/S/D — полёт по взгляду;
 * Space/E вверх, Q/C вниз; Shift быстрее; колесо — скорость.
 * Телефон: один палец — обзор; два пальца: щипок — вперёд/назад по взгляду,
 * сдвиг обоими — вбок и вверх/вниз.
 * На экране только слайдер угла обзора (снизу слева) и кнопка «Закрыть» (справа сверху).
 */
/** Границы угла обзора, рад: самый широкий ~126°, самый узкий 10°. */
const FOV_MAX = 2.2;
const FOV_MIN = (10 * Math.PI) / 180;

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
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly panel: HTMLDivElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly fovInput: HTMLInputElement;
  private readonly cleanups: (() => void)[] = [];

  constructor(canvas: HTMLCanvasElement) {
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";
    const on = <T extends EventTarget>(t: T, ev: string, fn: (e: never) => void, opt?: AddEventListenerOptions): void => {
      t.addEventListener(ev, fn as EventListener, opt);
      this.cleanups.push(() => t.removeEventListener(ev, fn as EventListener));
    };

    on(canvas, "contextmenu", (e: Event) => e.preventDefault());
    on(canvas, "pointerdown", (e: PointerEvent) => {
      if (this.closed) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = "grabbing";
    });
    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    on(canvas, "pointerup", release);
    on(canvas, "pointercancel", release);
    on(canvas, "pointermove", (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || this.closed) return;
      if (this.pointers.size === 1) {
        // Один палец / мышь: поворот взгляда.
        const sens = e.pointerType === "touch" ? 0.005 : 0.0035;
        this.yaw += (e.clientX - prev.x) * sens;
        this.pitch = Math.max(-1.553, Math.min(1.553, this.pitch - (e.clientY - prev.y) * sens));
        prev.x = e.clientX;
        prev.y = e.clientY;
        return;
      }
      // Два пальца: считаем щипок и сдвиг центра относительно прошлого кадра.
      const other = [...this.pointers.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return;
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const c0x = (prev.x + other.x) / 2;
      const c0y = (prev.y + other.y) / 2;
      prev.x = e.clientX;
      prev.y = e.clientY;
      const d1 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const c1x = (prev.x + other.x) / 2;
      const c1y = (prev.y + other.y) / 2;
      const cp = Math.cos(this.pitch);
      const fwd = (d1 - d0) * this.speed * 0.003; // щипок наружу — вперёд
      const strafe = -(c1x - c0x) * this.speed * 0.0015; // «схватили» мир и потянули
      const lift = (c1y - c0y) * this.speed * 0.0015;
      this.pos.x += Math.sin(this.yaw) * cp * fwd + Math.cos(this.yaw) * strafe;
      this.pos.y = Math.max(1.5, this.pos.y + Math.sin(this.pitch) * fwd + lift);
      this.pos.z += Math.cos(this.yaw) * cp * fwd - Math.sin(this.yaw) * strafe;
    });
    on(
      canvas,
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        this.speed = Math.max(2, Math.min(400, this.speed * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      },
      { passive: false },
    );
    on(window, "keydown", (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.tagName === "INPUT") return;
      this.keys.add(e.code);
    });
    on(window, "keyup", (e: KeyboardEvent) => this.keys.delete(e.code));
    on(window, "blur", () => this.keys.clear());

    // Только слайдер угла обзора (снизу слева) и маленькая кнопка «Закрыть» (справа сверху).
    this.panel = document.createElement("div");
    this.panel.style.cssText =
      "position:fixed;left:14px;bottom:max(14px,env(safe-area-inset-bottom));z-index:20;" +
      "width:min(46vw,260px);padding:10px 12px;border-radius:10px;background:rgba(12,13,18,.55);";
    this.fovInput = document.createElement("input");
    this.fovInput.type = "range";
    // Инверсия: значение слайдера = −fov. Влево — шире угол, вправо — уже (до 10°).
    this.fovInput.min = String(-FOV_MAX);
    this.fovInput.max = String(-FOV_MIN);
    this.fovInput.step = "0.005";
    this.fovInput.value = String(-this.fov);
    this.fovInput.style.cssText = "width:100%;margin:0;display:block;touch-action:pan-x;";
    this.fovInput.addEventListener("input", () => {
      this.fov = -Number(this.fovInput.value);
    });
    this.panel.appendChild(this.fovInput);
    document.body.appendChild(this.panel);

    this.closeBtn = document.createElement("button");
    this.closeBtn.textContent = "Закрыть";
    this.closeBtn.style.cssText =
      "position:fixed;right:12px;top:max(12px,env(safe-area-inset-top));z-index:20;padding:5px 10px;" +
      "border:0;border-radius:6px;background:rgba(232,67,63,.85);color:#fff;font:600 12px system-ui,sans-serif;" +
      "cursor:pointer;";
    this.closeBtn.addEventListener("click", () => this.close());
    document.body.appendChild(this.closeBtn);
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
      this.fovInput.value = String(-Math.max(FOV_MIN, Math.min(FOV_MAX, fov)));
    }
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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.panel.remove();
    this.closeBtn.remove();
    this.onClose?.();
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.panel.remove();
    this.closeBtn.remove();
  }
}
