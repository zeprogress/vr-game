import { LOOK } from "#shared/constants";
import { emptyInput, type InputSource, type InputState } from "./InputSource";

/** Клик мышью без перетаскивания (выбор цели) — координаты в пикселях канваса. */
export interface MouseClick {
  button: 0 | 2;
  x: number;
  y: number;
}

/** Множитель поворота камеры свайпом двух пальцев по трекпаду (к чувствительности мыши). */
const TRACKPAD_LOOK = 1.6;
/** Поворот камеры стрелками ← →, рад/с. */
const KEY_TURN = 2.2;

/** Сдвиг мыши (px), после которого нажатие — уже перетаскивание камеры, а не клик. */
const DRAG_PX = 7;

/**
 * Клавиатура + мышь.
 *
 * `wow = false` — старый вид из глаз: осмотр только при захвате указателя
 * (его запрашивает main.ts по клику), ЛКМ — атака, Пробел — умение.
 *
 * `wow = true` — третье лицо «как в WoW»: курсор свободен; зажатая ПКМ крутит
 * камеру и разворачивает героя, зажатая ЛКМ — только облёт камеры; обе сразу —
 * бег вперёд; колесо — зум. Короткий клик без перетаскивания — выбор цели
 * (читает PcTargeting через takeClick). Пробел — прыжок, 1 — автоатака,
 * 2 — умение, Tab — следующая цель.
 */
export class DesktopInput implements InputSource {
  private readonly keys = new Set<string>();
  private accYaw = 0;
  private accPitch = 0;
  private accZoom = 0;
  private mouseDown = false;
  private dropQueued = false;
  private abilityQueued = false;
  private jumpQueued = false;

  // --- режим WoW ---
  private lmb = false;
  private rmb = false;
  private downX = 0;
  private downY = 0;
  private dragged = false;
  /** Сколько пикселей мышь прошла с нажатия (под захватом координаты стоят — считаем по movement). */
  private dragAcc = 0;
  private click: MouseClick | null = null;
  /** Курсор над канвасом, px от его левого верхнего угла. */
  mouseX = 0;
  mouseY = 0;
  /** Курсор над самой игрой (не над окном/кнопкой интерфейса). */
  overCanvas = false;
  /** Кнопка мыши зажата (крутим камеру) — подсказки не показываем. */
  get busy(): boolean {
    return this.lmb || this.rmb;
  }
  private downButton: 0 | 2 = 0;
  private attackQueued = false;
  private tabQueued = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly wow = false,
  ) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    if (wow) {
      // Именно pointer-события: Babylon гасит pointerdown (preventDefault), и
      // браузер после этого НЕ шлёт «совместимые» mousedown/mousemove/mouseup —
      // на mouse-событиях камера мышью не крутилась вовсе (работало лишь колесо).
      canvas.addEventListener("pointerdown", this.onPointerDown);
      document.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
      canvas.addEventListener("wheel", this.onWheel, { passive: false });
      canvas.addEventListener("contextmenu", this.onContextMenu);
      document.addEventListener("pointerlockchange", this.onLockChange);
    } else {
      document.addEventListener("mousemove", this.onMouseMove);
      canvas.addEventListener("mousedown", this.onMouseDown);
      window.addEventListener("mouseup", this.onMouseUp);
    }
  }

  /** Фокус в поле ввода (чат и т.п.) — клавиши игре не отдаём. */
  private static typing(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (DesktopInput.typing(e)) return;
    this.keys.add(e.code);
    if (e.code === "KeyQ") this.dropQueued = true;
    if (this.wow) {
      if (e.repeat) return;
      if (e.code === "Space") this.jumpQueued = true;
      else if (e.code === "Digit1") this.attackQueued = true;
      else if (e.code === "Digit2") this.abilityQueued = true;
      else if (e.code === "Tab") {
        e.preventDefault(); // иначе фокус уходит из игры
        this.tabQueued = true;
      }
      return;
    }
    // Space — активное умение оружия. Не повторять от авто-repeat зажатой клавиши.
    if (e.code === "Space" && !e.repeat) this.abilityQueued = true;
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private onMouseMove = (e: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas) return;
    this.accYaw += e.movementX * LOOK.mouseSensitivity;
    this.accPitch += e.movementY * LOOK.mouseSensitivity;
  };
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = true;
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };

  // --- режим WoW: ЛКМ/ПКМ по битам e.buttons (нажатие второй кнопки при уже
  // зажатой первой приходит pointermove'ом, а не pointerdown) ---
  private syncButtons(e: PointerEvent): void {
    this.lmb = (e.buttons & 1) !== 0;
    this.rmb = (e.buttons & 2) !== 0;
  }
  private onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    const was = this.lmb || this.rmb;
    this.syncButtons(e);
    if (!was && (this.lmb || this.rmb)) {
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.dragged = false;
      this.dragAcc = 0;
      this.downButton = e.button === 2 ? 2 : 0;
      // Захват курсора — ТОЛЬКО прямо в обработчике нажатия: браузер разрешает
      // его лишь по жесту пользователя. Курсор прячется, пока кнопка зажата;
      // отпустил — возвращается на то же место.
      void Promise.resolve(this.canvas.requestPointerLock() as unknown).catch(() => {});
    }
  };
  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    // Где курсор (пока он виден) — для прицела умений по земле.
    if (document.pointerLockElement !== this.canvas) {
      const r = this.canvas.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      this.overCanvas = e.target === this.canvas;
    }
    if (this.lmb || this.rmb) {
      this.syncButtons(e);
      // pointerup потерялся (отпустили за окном и т.п.) — считаем отпусканием.
      if (!this.lmb && !this.rmb) {
        this.dragged = false;
        this.releaseLock();
        return;
      }
    }
    if (!this.lmb && !this.rmb) return;
    if (performance.now() < this.ignoreMoveUntil) return;
    if (!this.dragged) {
      this.dragAcc += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (this.dragAcc < DRAG_PX) return;
      this.dragged = true;
    }
    this.accYaw += e.movementX * LOOK.mouseSensitivity;
    this.accPitch += e.movementY * LOOK.mouseSensitivity;
  };
  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    const was = this.lmb || this.rmb;
    this.syncButtons(e);
    if (!was || this.lmb || this.rmb) return;
    if (!this.dragged) {
      // Координаты — точки нажатия: под захватом clientX/Y не меняются.
      const r = this.canvas.getBoundingClientRect();
      this.click = { button: this.downButton, x: this.downX - r.left, y: this.downY - r.top };
    }
    this.dragged = false;
    this.releaseLock();
  };

  private releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /**
   * Захват приходит асинхронно: при быстром клике браузер мог выдать его уже
   * ПОСЛЕ отпускания кнопки — курсор так и оставался спрятанным. Захвачен, а
   * кнопки не зажаты — сразу отпускаем.
   */
  private onLockChange = (): void => {
    // Сразу после захвата/отпускания Chrome иногда шлёт одно движение с
    // огромным movementX — оно превращало клик в «поворот камеры». Глушим.
    this.ignoreMoveUntil = performance.now() + 80;
    if (document.pointerLockElement === this.canvas && !this.lmb && !this.rmb) this.releaseLock();
  };
  private ignoreMoveUntil = 0;

  /**
   * Колесо и трекпад. На Mac трекпад шлёт свайп двумя пальцами как wheel с
   * плавными дробными deltaX/deltaY, а щипок — как wheel с ctrlKey. Обычное
   * колесо мыши — крупные целые шаги по deltaY без deltaX.
   *  - щипок → зум;
   *  - колесо мыши → зум;
   *  - свайп двумя пальцами → поворот камеры (как перетаскивание мышью).
   */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (e.ctrlKey) {
      // Щипок: разводим пальцы — deltaY<0 — приближаем.
      this.accZoom += px * 0.06;
      return;
    }
    // Трекпад Mac (Chrome/Safari) помечает свои пиксельные дельты так:
    // wheelDeltaY === -3·deltaY; у колеса мыши — нет (кратно 120 и т.п.).
    // Без wheelDeltaY (Firefox) — колесо мыши идёт строками (deltaMode 1).
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    const trackpad =
      e.deltaX !== 0 ||
      (legacy !== undefined && legacy !== 0 ? Math.abs(legacy + 3 * e.deltaY) < 0.5 : e.deltaMode === 0 && !Number.isInteger(e.deltaY));
    if (!trackpad) {
      // Колесо вниз (deltaY>0) — отдалить.
      this.accZoom += px * 0.012;
      return;
    }
    this.accYaw += e.deltaX * LOOK.mouseSensitivity * TRACKPAD_LOOK;
    this.accPitch += e.deltaY * LOOK.mouseSensitivity * TRACKPAD_LOOK;
  };
  private onContextMenu = (e: Event): void => e.preventDefault();
  private onBlur = (): void => {
    this.keys.clear();
    this.mouseDown = false;
    this.lmb = false;
    this.rmb = false;
    this.dragged = false;
    if (this.wow) this.releaseLock();
  };

  /** Клик без перетаскивания, если был с прошлого вызова (выбор цели). */
  takeClick(): MouseClick | null {
    const c = this.click;
    this.click = null;
    return c;
  }
  /** Нажата 1 — автоатака (фронт). */
  takeAttack(): boolean {
    const v = this.attackQueued;
    this.attackQueued = false;
    return v;
  }
  /** Нажат Tab — следующая цель (фронт). */
  takeTab(): boolean {
    const v = this.tabQueued;
    this.tabQueued = false;
    return v;
  }
  /** Зажата ПКМ — герой поворачивается вслед за камерой. */
  get steering(): boolean {
    return this.rmb;
  }

  private lastSample = 0;

  sample(): InputState {
    const s = emptyInput();
    const k = this.keys;
    const now = performance.now();
    const dt = this.lastSample ? Math.min(0.1, (now - this.lastSample) / 1000) : 0;
    this.lastSample = now;
    if (this.wow) {
      // Страховка: курсор спрятан, а кнопки не зажаты — вернуть курсор.
      if (!this.lmb && !this.rmb && document.pointerLockElement === this.canvas) this.releaseLock();
      // Стрелки ← → — поворот камеры с клавиатуры (трекпад без мыши).
      const turn = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
      if (turn) this.accYaw += turn * KEY_TURN * dt;
    }
    s.moveY = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    s.moveX = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    s.lookYaw = this.accYaw;
    s.lookPitch = this.accPitch;
    s.interact = k.has("KeyE");
    s.dropItem = this.dropQueued;
    s.ability = this.abilityQueued;
    if (this.wow) {
      // Обе кнопки мыши — бег вперёд, как в WoW.
      if (this.lmb && this.rmb && s.moveY === 0) s.moveY = 1;
      s.zoom = this.accZoom;
      s.jump = this.jumpQueued;
      s.steer = this.rmb;
    } else {
      s.primaryAction = this.mouseDown;
    }

    this.accYaw = 0;
    this.accPitch = 0;
    this.accZoom = 0;
    this.dropQueued = false;
    this.abilityQueued = false;
    this.jumpQueued = false;
    return s;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    document.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
  }
}
