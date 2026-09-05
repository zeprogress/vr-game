import { LOOK } from "#shared/constants";
import { emptyInput, type InputSource, type InputState } from "./InputSource";

/**
 * Клавиатура + мышь. Осмотр работает только при захвате указателя
 * (pointer lock) — его запрашивает main.ts по клику.
 */
export class DesktopInput implements InputSource {
  private readonly keys = new Set<string>();
  private accYaw = 0;
  private accPitch = 0;
  private mouseDown = false;
  private dropQueued = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    window.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.code === "KeyQ") this.dropQueued = true;
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
  private onBlur = (): void => {
    this.keys.clear();
    this.mouseDown = false;
  };

  sample(): InputState {
    const s = emptyInput();
    const k = this.keys;
    s.moveY = (k.has("KeyW") ? 1 : 0) - (k.has("KeyS") ? 1 : 0);
    s.moveX = (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    s.lookYaw = this.accYaw;
    s.lookPitch = this.accPitch;
    s.primaryAction = this.mouseDown;
    s.interact = k.has("KeyE");
    s.dropItem = this.dropQueued;

    this.accYaw = 0;
    this.accPitch = 0;
    this.dropQueued = false;
    return s;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    window.removeEventListener("blur", this.onBlur);
  }
}
