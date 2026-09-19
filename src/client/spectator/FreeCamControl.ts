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
  /** Сглаживать ли движение камеры у спектаторов (переключатель справа снизу). */
  smooth = true;
  /** Короткое касание/клик в точке экрана (CSS-пиксели) — выбор героя для слежения. */
  onTap: ((x: number, y: number) => void) | null = null;
  /** Нажали «Отцепиться» в режиме слежения. */
  onUnfollow: (() => void) | null = null;
  /** Режим слежения за объектом: поворот и наклон ведёт цель, движение — руками. */
  following = false;

  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private readonly panel: HTMLDivElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly unfollowBtn: HTMLButtonElement;
  /** Для распознавания «тапа»: где и когда нажали, был ли сдвиг/второй палец. */
  private tap: { id: number; x: number; y: number; t: number; moved: boolean } | null = null;
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
      // Первый палец — кандидат в «тап»; второй палец отменяет.
      this.tap =
        this.pointers.size === 1
          ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false }
          : null;
    });
    const release = (e: PointerEvent): void => {
      const tp = this.tap;
      if (tp && tp.id === e.pointerId && !tp.moved && performance.now() - tp.t < 350 && e.type === "pointerup") {
        this.onTap?.(e.clientX, e.clientY);
      }
      if (tp && tp.id === e.pointerId) this.tap = null;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) canvas.style.cursor = "grab";
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    on(canvas, "pointerup", release);
    on(canvas, "pointercancel", release);
    on(canvas, "pointermove", (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev || this.closed) return;
      if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 8) this.tap.moved = true;
      if (this.pointers.size > 1) this.tap = null;
      if (this.pointers.size === 1) {
        if (this.following) {
          // Слежение: поворот ведёт цель, палец двигает саму камеру (вбок и вверх/вниз).
          const dx = e.clientX - prev.x;
          const dy = e.clientY - prev.y;
          const strafe = -dx * this.speed * 0.004;
          const lift = dy * this.speed * 0.004;
          this.pos.x += Math.cos(this.yaw) * strafe;
          this.pos.y = Math.max(1.5, this.pos.y + lift);
          this.pos.z += -Math.sin(this.yaw) * strafe;
          prev.x = e.clientX;
          prev.y = e.clientY;
          return;
        }
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

    // Переключатель сглаживания — справа снизу.
    const sm = document.createElement("label");
    sm.style.cssText =
      "position:fixed;right:14px;bottom:max(14px,env(safe-area-inset-bottom));z-index:20;display:flex;" +
      "align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:rgba(12,13,18,.55);" +
      "color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer;user-select:none;";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.smooth;
    box.style.cssText = "width:18px;height:18px;margin:0;";
    box.addEventListener("change", () => {
      this.smooth = box.checked;
    });
    sm.append(box, document.createTextNode("Сглаживание"));
    document.body.appendChild(sm);
    this.smoothBox = sm;

    // «Отцепиться» — слева сверху, только пока идёт слежение.
    this.unfollowBtn = document.createElement("button");
    this.unfollowBtn.textContent = "Отцепиться";
    this.unfollowBtn.style.cssText =
      "position:fixed;left:12px;top:max(12px,env(safe-area-inset-top));z-index:20;padding:6px 12px;" +
      "border:0;border-radius:6px;background:rgba(32,110,230,.9);color:#fff;font:600 13px system-ui,sans-serif;" +
      "cursor:pointer;display:none;";
    this.unfollowBtn.addEventListener("click", () => this.onUnfollow?.());
    document.body.appendChild(this.unfollowBtn);
  }

  private smoothBox: HTMLLabelElement | null = null;

  /** Включить/выключить режим слежения (и показать/скрыть кнопку «Отцепиться»). */
  setFollowing(on: boolean): void {
    this.following = on;
    this.unfollowBtn.style.display = on ? "block" : "none";
  }

  /**
   * Слежение: плавно довернуть взгляд на точку (x,y,z). Вызывается каждый кадр,
   * пока идёт слежение; позицию камеры не трогает.
   */
  trackTarget(x: number, y: number, z: number, dt: number): void {
    const dx = x - this.pos.x;
    const dy = y - this.pos.y;
    const dz = z - this.pos.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5) return;
    const wantYaw = Math.atan2(dx, dz);
    const wantPitch = Math.max(-1.553, Math.min(1.553, Math.asin(dy / len)));
    let dyaw = wantYaw - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const k = 1 - Math.exp(-dt * 8);
    this.yaw += dyaw * k;
    this.pitch += (wantPitch - this.pitch) * k;
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
    this.unfollowBtn.remove();
    this.smoothBox?.remove();
    this.onClose?.();
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.panel.remove();
    this.closeBtn.remove();
    this.unfollowBtn.remove();
    this.smoothBox?.remove();
  }
}
