import type { Observer } from "@babylonjs/core/Misc/observable";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";

import { LOADOUT } from "../config/loadout";
import { emptyInput, type InputSource, type InputState } from "./InputSource";

const DEADZONE = 0.2;
const SNAP_ANGLE = Math.PI / 6; // 30° за один щелчок
const SNAP_ON = 0.7; // порог отклонения стика для поворота
const SNAP_OFF = 0.3; // стик должен вернуться сюда перед следующим поворотом

/**
 * VR-контроллеры как источник ввода. Раскладка xr-standard:
 * - левый стик — движение (относительно взгляда, это делает PlayerController)
 * - правый стик влево/вправо — snap-turn (щелчками, чтобы не укачивало)
 * - trigger — основное действие, grip — взять/бросить предмет
 * - кнопки панели персонажа берутся из LOADOUT.buttons
 *
 * Панель НЕ блокирует движение: она висит на отдельных кнопках, а стики,
 * курок и grip продолжают работать как обычно.
 *
 * Читаем сырой Gamepad API, без загрузки профилей контроллеров (работает офлайн).
 */
export class XRInput implements InputSource {
  private left: WebXRInputSource | null = null;
  private right: WebXRInputSource | null = null;
  private snapArmed = true;
  private readonly armed = new Map<string, boolean>();

  /**
   * Ставится извне: пока открыта панель настройки экипировки, X/Y/A работают
   * как «меньше / больше / шаг». Стики, курок и grip не трогаем — ходить,
   * поворачиваться и брать предметы можно как обычно.
   */
  tuneOpen = false;

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

  /** Диагностика: какие кнопки сейчас нажаты. Вызывать из консоли. */
  dumpButtons(): Record<string, unknown> {
    const read = (c: WebXRInputSource | null) => {
      const pad = c?.inputSource.gamepad;
      if (!pad) return "нет контроллера";
      return pad.buttons.map((b, i) => `${i}:${b.pressed ? "НАЖАТА" : "-"}`).join(" ");
    };
    return { left: read(this.left), right: read(this.right), bindings: LOADOUT.buttons };
  }

  /** Фронт нажатия: true только в кадр, когда кнопку нажали. */
  private edge(key: string, down: boolean): boolean {
    const wasArmed = this.armed.get(key) ?? true;
    if (down && wasArmed) {
      this.armed.set(key, false);
      return true;
    }
    if (!down) this.armed.set(key, true);
    return false;
  }

  sample(): InputState {
    const s = emptyInput();
    const lp = this.left?.inputSource.gamepad;
    const rp = this.right?.inputSource.gamepad;
    const b = LOADOUT.buttons;

    // B на правом: сигнал для панели настройки (Game ждёт 5 нажатий за 3 с).
    s.tuneToggle = this.edge("tune", pressed(rp, b.panelSpend));

    if (this.tuneOpen) {
      // Режим настройки: X/Y/A меняют значения. Стики свободны — ходить и
      // поворачиваться можно; вертикаль правого стика ничем не занята.
      s.tuneNavY = -dz(rp?.axes[3] ?? 0);
      s.tuneDec = this.edge("tuneDec", pressed(lp, b.panelNext));
      s.tuneInc = this.edge("tuneInc", pressed(lp, b.panelToggle));
      s.tuneStep = this.edge("tuneStep", pressed(rp, b.jump));
    } else {
      // Обычный режим: панель персонажа.
      s.panelToggle = this.edge("panel", pressed(lp, b.panelToggle));
      s.uiNext = this.edge("uiNext", pressed(lp, b.panelNext));
      s.uiConfirm = this.edge("uiSpend", pressed(rp, b.panelSpend));
    }

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
