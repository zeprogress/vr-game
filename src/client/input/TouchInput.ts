import { LOOK } from "#shared/constants";
import { emptyInput, type InputSource, type InputState } from "./InputSource";

/** Метры зума на пиксель изменения расстояния между пальцами. */
const ZOOM_PER_PX = 0.012;

/**
 * Тач-управление для телефона: левый джойстик — движение, перетаскивание
 * по правой половине экрана — осмотр, кнопки справа снизу — действия.
 * Строит собственный DOM-оверлей поверх canvas.
 */
export class TouchInput implements InputSource {
  private readonly root: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  private moveX = 0;
  private moveY = 0;
  private accYaw = 0;
  private accPitch = 0;
  private accZoom = 0;
  private attack = false;
  private interactBtn = false;

  /** id активного пальца на джойстике. */
  private movePointer: number | null = null;
  /** Пальцы на зоне осмотра: 1 — крутим обзор, 2 — щипок-зум. */
  private readonly lookPts = new Map<number, { x: number; y: number }>();
  private pinchLen: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private readonly stickRadius = 55;

  constructor() {
    this.root = document.createElement("div");
    this.root.innerHTML = STYLE;
    this.root.className = "touch-ui";

    const lookZone = el("div", "touch-look");
    const stick = el("div", "touch-stick");
    this.knob = el("div", "touch-knob");
    stick.appendChild(this.knob);

    const btnAttack = el("div", "touch-btn touch-attack", "⚔");
    const btnInteract = el("div", "touch-btn touch-interact", "✋");

    this.root.append(lookZone, stick, btnAttack, btnInteract);
    document.body.appendChild(this.root);

    // --- Осмотр / зум: перетаскивание и щипок по правой зоне ---
    const pinchDist = (): number => {
      const [a, b] = [...this.lookPts.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    lookZone.addEventListener("pointerdown", (e) => {
      if (this.lookPts.size >= 2) return;
      this.lookPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lookZone.setPointerCapture(e.pointerId);
      if (this.lookPts.size === 2) this.pinchLen = pinchDist();
    });
    lookZone.addEventListener("pointermove", (e) => {
      const pt = this.lookPts.get(e.pointerId);
      if (!pt) return;
      const dx = e.clientX - pt.x;
      const dy = e.clientY - pt.y;
      pt.x = e.clientX;
      pt.y = e.clientY;
      if (this.lookPts.size >= 2) {
        // Щипок: пальцы врозь — приближаем (dist меньше), вместе — отдаляем.
        const len = pinchDist();
        if (this.pinchLen !== null) this.accZoom += (this.pinchLen - len) * ZOOM_PER_PX;
        this.pinchLen = len;
      } else {
        this.accYaw += dx * LOOK.touchSensitivity;
        this.accPitch += dy * LOOK.touchSensitivity;
      }
    });
    const endLook = (e: PointerEvent): void => {
      if (!this.lookPts.delete(e.pointerId)) return;
      if (this.lookPts.size < 2) this.pinchLen = null;
    };
    lookZone.addEventListener("pointerup", endLook);
    lookZone.addEventListener("pointercancel", endLook);

    // --- Джойстик движения ---
    stick.addEventListener("pointerdown", (e) => {
      this.movePointer = e.pointerId;
      const r = stick.getBoundingClientRect();
      this.moveOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stick.setPointerCapture(e.pointerId);
      this.updateStick(e.clientX, e.clientY);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId === this.movePointer) this.updateStick(e.clientX, e.clientY);
    });
    const endMove = (e: PointerEvent): void => {
      if (e.pointerId !== this.movePointer) return;
      this.movePointer = null;
      this.moveX = 0;
      this.moveY = 0;
      this.knob.style.transform = "translate(0px, 0px)";
    };
    stick.addEventListener("pointerup", endMove);
    stick.addEventListener("pointercancel", endMove);

    // --- Кнопки ---
    hold(btnAttack, (v) => (this.attack = v));
    hold(btnInteract, (v) => (this.interactBtn = v));
  }

  private updateStick(px: number, py: number): void {
    let dx = px - this.moveOrigin.x;
    let dy = py - this.moveOrigin.y;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, this.stickRadius);
    dx = (dx / len) * clamped;
    dy = (dy / len) * clamped;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.moveX = dx / this.stickRadius;
    this.moveY = -dy / this.stickRadius; // экран вниз = назад
  }

  sample(): InputState {
    const s = emptyInput();
    s.moveX = this.moveX;
    s.moveY = this.moveY;
    s.lookYaw = this.accYaw;
    s.lookPitch = this.accPitch;
    s.zoom = this.accZoom;
    s.primaryAction = this.attack;
    s.interact = this.interactBtn;

    this.accYaw = 0;
    this.accPitch = 0;
    this.accZoom = 0;
    return s;
  }

  dispose(): void {
    this.root.remove();
  }
}

function el(tag: string, className: string, text = ""): HTMLDivElement {
  const d = document.createElement(tag) as HTMLDivElement;
  d.className = className;
  if (text) d.textContent = text;
  return d;
}

function hold(node: HTMLElement, set: (v: boolean) => void): void {
  node.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    node.setPointerCapture(e.pointerId);
    set(true);
  });
  const off = (): void => set(false);
  node.addEventListener("pointerup", off);
  node.addEventListener("pointercancel", off);
}

const STYLE = `<style>
.touch-ui { position: fixed; inset: 0; z-index: 10; touch-action: none;
  font: 22px system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
.touch-ui > * { position: absolute; }
.touch-look { right: 0; top: 0; width: 55%; height: 100%; }
.touch-stick { left: 26px; bottom: 26px; width: 130px; height: 130px;
  border-radius: 50%; background: rgba(255,255,255,0.12);
  border: 2px solid rgba(255,255,255,0.25); }
.touch-knob { position: absolute; left: 40px; top: 40px; width: 50px; height: 50px;
  border-radius: 50%; background: rgba(255,255,255,0.5); }
.touch-btn { right: 30px; width: 76px; height: 76px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.18); border: 2px solid rgba(255,255,255,0.3);
  color: #fff; }
.touch-attack   { bottom: 40px; }
.touch-interact { bottom: 132px; }
</style>`;
