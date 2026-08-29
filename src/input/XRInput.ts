import type { Observer } from "@babylonjs/core/Misc/observable";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";

import { emptyInput, type InputSource, type InputState } from "./InputSource";

const DEADZONE = 0.2;
const SNAP_ANGLE = Math.PI / 6; // 30° за один щелчок
const SNAP_ON = 0.7; // порог отклонения стика для поворота
const SNAP_OFF = 0.3; // стик должен вернуться сюда перед следующим поворотом

/**
 * VR-контроллеры как источник ввода. Раскладка xr-standard:
 * - левый стик — движение (относительно взгляда, это делает PlayerController)
 * - правый стик влево/вправо — snap-turn (щелчками, чтобы не укачивало)
 * - trigger (любой) — основное действие
 * - grip (любой) — взаимодействие
 * - кнопка A на правом — прыжок
 *
 * Читаем сырой Gamepad API, без загрузки профилей контроллеров (работает офлайн).
 */
export class XRInput implements InputSource {
  private left: WebXRInputSource | null = null;
  private right: WebXRInputSource | null = null;
  private snapArmed = true;
  private jumpArmed = true;

  private readonly addObs: Observer<WebXRInputSource> | null;
  private readonly removeObs: Observer<WebXRInputSource> | null;

  constructor(private readonly xr: WebXRDefaultExperience) {
    for (const c of xr.input.controllers) this.assign(c);
    this.addObs = xr.input.onControllerAddedObservable.add((c) => this.assign(c));
    this.removeObs = xr.input.onControllerRemovedObservable.add((c) => {
      if (c === this.left) this.left = null;
      if (c === this.right) this.right = null;
    });
  }

  private assign(c: WebXRInputSource): void {
    const h = c.inputSource.handedness;
    if (h === "left") this.left = c;
    else if (h === "right") this.right = c;
    else if (!this.left) this.left = c;
    else this.right = c;
  }

  sample(): InputState {
    const s = emptyInput();
    const lp = this.left?.inputSource.gamepad;
    const rp = this.right?.inputSource.gamepad;

    // Настройка положения оружия на кнопку X временно отключена.

    if (lp) {
      s.moveX = dz(lp.axes[2] ?? 0);
      s.moveY = -dz(lp.axes[3] ?? 0);
    }

    // --- Snap-turn с правого стика ---
    const turn = rp?.axes[2] ?? 0;
    if (this.snapArmed && Math.abs(turn) > SNAP_ON) {
      s.lookYaw = Math.sign(turn) * SNAP_ANGLE;
      this.snapArmed = false;
    } else if (Math.abs(turn) < SNAP_OFF) {
      this.snapArmed = true;
    }

    s.primaryAction = pressed(lp, 0) || pressed(rp, 0); // trigger
    s.interact = pressed(lp, 1) || pressed(rp, 1); // grip

    const jump = pressed(rp, 4); // кнопка A
    if (jump && this.jumpArmed) {
      s.jump = true;
      this.jumpArmed = false;
    } else if (!jump) {
      this.jumpArmed = true;
    }

    return s;
  }

  dispose(): void {
    this.xr.input.onControllerAddedObservable.remove(this.addObs);
    this.xr.input.onControllerRemovedObservable.remove(this.removeObs);
  }
}

function dz(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : v;
}

function pressed(pad: Gamepad | undefined, index: number): boolean {
  return !!pad?.buttons[index]?.pressed;
}
