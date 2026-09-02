import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import {
  LOADOUT,
  handTarget,
  isOverridden,
  itemTarget,
  printLoadout,
  pushLoadoutToFile,
  resetTarget,
  saveTarget,
  type HandSide,
  type ItemKind,
  type TargetKey,
} from "../config/loadout";

const TEX_W = 512;
const TEX_H = 512;

/** Шаги правки: грубо / средне / точно переключаются кнопкой A. */
const POS_STEPS = [0.1, 0.02, 0.005];
const ROT_STEPS = [Math.PI / 2, 0.1, 0.02];
/** Час суток крутится своими шагами: час / четверть / три минуты. */
const HOUR_STEPS = [1, 0.25, 0.05];
const STEP_LABELS = ["крупный", "средний", "точный"];

interface Target {
  key: TargetKey;
  label: string;
  /** Кисть — только поворот; предмет — позиция, поворот и масштаб; мир — час. */
  kind: "hand" | "item" | "world" | "light" | "vec3" | "voice" | "gfx" | "comfort" | "action";
}

const TARGETS: Target[] = [
  { key: handTarget("left"), label: "Кисть · левая", kind: "hand" },
  { key: handTarget("right"), label: "Кисть · правая", kind: "hand" },
  { key: itemTarget("sword", "vrLeft"), label: "Меч · левая", kind: "item" },
  { key: itemTarget("sword", "vrRight"), label: "Меч · правая", kind: "item" },
  { key: itemTarget("bow", "vrLeft"), label: "Лук · левая", kind: "item" },
  { key: itemTarget("bow", "vrRight"), label: "Лук · правая", kind: "item" },
  { key: itemTarget("shield", "vrLeft"), label: "Щит · левая", kind: "item" },
  { key: itemTarget("shield", "vrRight"), label: "Щит · правая", kind: "item" },
  { key: itemTarget("potion", "vrLeft"), label: "Зелье · левая", kind: "item" },
  { key: itemTarget("potion", "vrRight"), label: "Зелье · правая", kind: "item" },
  { key: "belt:potion", label: "Зелье · на поясе", kind: "vec3" },
  { key: "hud:hp", label: "Полоска жизней", kind: "vec3" },
  { key: "world:time", label: "Время суток", kind: "world" },
  { key: "light:day", label: "Освещение", kind: "light" },
  { key: "voice:chat", label: "Голос", kind: "voice" },
  { key: "gfx:smooth", label: "Сглаживание", kind: "gfx" },
  { key: "comfort:vignette", label: "Виньетка движения (всем)", kind: "comfort" },
  { key: "comfort:move", label: "Перемещение · телепорт (всем)", kind: "comfort" },
  { key: "world:clear", label: "Очистить мир от лута (всем)", kind: "action" },
];

type Field =
  | {
      label: string;
      get(): number;
      set(v: number): void;
      rot: boolean;
      /** Свои шаги вместо позиционных/поворотных. */
      steps?: number[];
      /** Как показать значение (по умолчанию — просто число). */
      format?(v: number): string;
    }
  | null;

/**
 * Панель настройки экипировки на правой руке (кнопка B).
 *
 * Строка 0 — выбор цели, дальше её параметры, затем «Сохранить настройки»
 * и «Сброс к файлу». Всё правится прямо в игре и переживает перезагрузку.
 */
export class LoadoutPanel {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private open = false;
  private targetIdx = 0;
  private row = 0;
  private stepIdx = 1;
  private navArmed = true;
  /** Секунды, пока в строке «сохранить» горит подтверждение. */
  private savedFlash = 0;
  private fileState = "";
  /** Онлайн: перевод времени/автосмены уходит на сервер (часы общие). */
  onWorldTime: ((hour: number, auto: number) => void) | null = null;
  /** Онлайн: тумблеры комфорта VR уходят на сервер (общие для мира). */
  onComfort: ((patch: { vignette?: number; teleport?: number }) => void) | null = null;
  /** Онлайн: админ нажал «очистить мир» (после подтверждения). */
  onClearWorld: (() => void) | null = null;
  /** Секунды: «очистить мир» ждёт повторного нажатия для подтверждения. */
  private clearArm = 0;
  /** Онлайн: «Сохранить» шлёт настройки на сервер (по токену игрока). */
  onSaveServer: (() => void) | null = null;

  constructor(scene: Scene, parent: Node) {
    this.tex = new DynamicTexture("loadoutTex", { width: TEX_W, height: TEX_H }, scene, false);

    const mat = new StandardMaterial("loadoutMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;

    this.plane = MeshBuilder.CreatePlane(
      "loadoutPanel",
      { width: 0.3, height: 0.3 * (TEX_H / TEX_W) },
      scene,
    );
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.set(0, 0.18, 0);
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 2;
    this.plane.setEnabled(false);

    this.redraw();
  }

  get visible(): boolean {
    return this.open;
  }

  get anchor(): Node | null {
    return this.plane.parent;
  }

  reparent(parent: Node): void {
    this.plane.parent = parent;
  }

  toggle(): void {
    this.open = !this.open;
    this.plane.setEnabled(this.open);
    if (this.open) this.redraw();
  }

  hide(): void {
    this.open = false;
    this.plane.setEnabled(false);
  }

  /**
   * navY — правый стик по вертикали (выбор строки), dec/inc — уменьшить/увеличить,
   * stepCycle — сменить шаг. dt нужен, чтобы погасить надпись «сохранено».
   */
  update(navY: number, dec: boolean, inc: boolean, stepCycle: boolean, dt = 0): void {
    if (!this.open) return;

    if (this.savedFlash > 0) {
      this.savedFlash -= dt;
      if (this.savedFlash <= 0) this.redraw();
    }
    if (this.clearArm > 0) {
      this.clearArm -= dt;
      if (this.clearArm <= 0) this.redraw();
    }

    if (this.navArmed && Math.abs(navY) > 0.6) {
      const rows = this.rowCount();
      this.row = (this.row + (navY > 0 ? -1 : 1) + rows) % rows;
      this.navArmed = false;
      this.redraw();
    } else if (Math.abs(navY) < 0.3) {
      this.navArmed = true;
    }

    if (stepCycle) {
      this.stepIdx = (this.stepIdx + 1) % POS_STEPS.length;
      this.redraw();
    }

    if (dec || inc) this.applyChange(inc ? 1 : -1);
  }

  dispose(): void {
    this.plane.dispose();
    this.tex.dispose();
  }

  // ---- модель строк ----

  private get target(): Target {
    return TARGETS[this.targetIdx];
  }

  /** Строки: 0 — цель, затем параметры, потом «сохранить» и «сброс». */
  private rowCount(): number {
    return 1 + this.fieldCount() + 2;
  }

  private get saveRow(): number {
    return 1 + this.fieldCount();
  }
  private get resetRow(): number {
    return this.rowCount() - 1;
  }

  private fieldCount(): number {
    if (this.target.kind === "hand") return 5; // пов XYZ + масштаб + сгиб
    if (this.target.kind === "vec3") return 3;
    if (this.target.kind === "world") return 2; // час + тумблер автосмены
    if (this.target.kind === "light") return 6; // солнце, заливка, тепло, тень, ночь, туман
    if (this.target.kind === "voice") return 2; // микрофон + звук по месту
    if (this.target.kind === "gfx") return 1;
    if (this.target.kind === "comfort") return 1;
    if (this.target.kind === "action") return 1;
    return 7;
  }

  private field(i: number): Field {
    const t = this.target;
    if (t.kind === "world") {
      if (i === 1) {
        return {
          label: "смена сама",
          rot: false,
          steps: [1],
          get: () => (LOADOUT.world.auto === 0 ? 0 : 1),
          set: (v) => {
            // Любое непонятное значение считаем «вкл»: остановленное время
            // выглядит как поломка, а лишний ход часов — нет.
            LOADOUT.world.auto = Number.isFinite(v) ? (((Math.round(v) % 2) + 2) % 2) : 1;
            this.onWorldTime?.(LOADOUT.world.hour, LOADOUT.world.auto);
          },
          format: (v) => (v ? "вкл" : "выкл"),
        };
      }
      return {
        label: "час",
        rot: false,
        steps: HOUR_STEPS,
        get: () => LOADOUT.world.hour,
        set: (v) => {
          LOADOUT.world.hour = ((v % 24) + 24) % 24; // 23.5 -> 0.5, без «минус часа»
          this.onWorldTime?.(LOADOUT.world.hour, LOADOUT.world.auto);
        },
        format: (v) => {
          const hh = Math.floor(v);
          const mm = Math.round((v - hh) * 60);
          return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        },
      };
    }
    if (t.kind === "light") {
      const L = LOADOUT.light;
      const specs: {
        label: string;
        key: keyof typeof L;
        lo: number;
        hi: number;
        steps: number[];
      }[] = [
        { label: "солнце", key: "sun", lo: 0.2, hi: 3, steps: [0.05, 0.15, 0.4] },
        { label: "заливка неба", key: "fill", lo: 0, hi: 1.5, steps: [0.03, 0.1, 0.25] },
        { label: "тепло солнца", key: "warm", lo: 0, hi: 1, steps: [0.05, 0.15, 0.35] },
        { label: "прохлада тени", key: "coolShade", lo: 0, hi: 1, steps: [0.05, 0.15, 0.35] },
        { label: "ночь", key: "night", lo: 0.2, hi: 2.5, steps: [0.05, 0.15, 0.4] },
        { label: "туман", key: "fog", lo: 0, hi: 4, steps: [0.1, 0.3, 0.8] },
      ];
      const sp = specs[i];
      return {
        label: sp.label,
        rot: false,
        steps: sp.steps,
        get: () => L[sp.key],
        set: (v) => {
          L[sp.key] = Number.isFinite(v) ? Math.min(sp.hi, Math.max(sp.lo, v)) : 1;
        },
        format: (v) => v.toFixed(2),
      };
    }
    if (t.kind === "gfx") {
      return {
        label: "края",
        rot: false,
        steps: [1, 1, 1],
        get: () => (LOADOUT.gfx.smooth === 0 ? 0 : 1),
        set: (v) => {
          LOADOUT.gfx.smooth = Number.isFinite(v) ? (((Math.round(v) % 2) + 2) % 2) : 1;
        },
        format: (v) => (v ? "вкл" : "выкл"),
      };
    }
    if (t.kind === "action") {
      // Единственное «поле» — сама кнопка: первое нажатие взводит, второе шлёт.
      return {
        label: this.clearArm > 0 ? "нажми ещё раз" : "выполнить",
        rot: false,
        steps: [1, 1, 1],
        get: () => (this.clearArm > 0 ? 1 : 0),
        set: () => {
          if (this.clearArm > 0) {
            this.clearArm = 0;
            this.onClearWorld?.();
            this.savedFlash = 2;
          } else {
            this.clearArm = 4;
          }
          this.redraw();
        },
        format: (v) => (v ? "◂ подтвердить" : "◂ ▸"),
      };
    }
    if (t.kind === "comfort") {
      const tele = t.key === "comfort:move";
      return {
        label: tele ? "телепорт" : "виньетка",
        rot: false,
        steps: [1, 1, 1],
        get: () =>
          (tele ? LOADOUT.comfort.teleport : LOADOUT.comfort.vignette) === 0 ? 0 : 1,
        set: (v) => {
          const on = Number.isFinite(v) ? (((Math.round(v) % 2) + 2) % 2) : tele ? 0 : 1;
          if (tele) {
            LOADOUT.comfort.teleport = on;
            this.onComfort?.({ teleport: on });
          } else {
            LOADOUT.comfort.vignette = on;
            this.onComfort?.({ vignette: on });
          }
        },
        format: (v) => (v ? "вкл" : "выкл"),
      };
    }
    if (t.kind === "voice") {
      const key = i === 0 ? "mic" : "spatial";
      return {
        label: i === 0 ? "микрофон" : "звук по месту",
        rot: false,
        steps: [1, 1, 1],
        get: () => (LOADOUT.voice[key] === 0 ? 0 : 1),
        set: (v) => {
          LOADOUT.voice[key] = Number.isFinite(v) ? (((Math.round(v) % 2) + 2) % 2) : 1;
        },
        format: (v) => (v ? "вкл" : "выкл"),
      };
    }
    if (t.kind === "vec3") {
      const arr = t.key === "belt:potion" ? LOADOUT.belt.pos : LOADOUT.hud.hpPos;
      return {
        label: `поз ${"XYZ"[i]}`,
        rot: false,
        get: () => arr[i],
        set: (v) => {
          arr[i] = v;
        },
      };
    }
    if (t.kind === "hand") {
      const side = t.key.split(":")[1] as HandSide;
      const h = LOADOUT.hands[side];
      if (i < 3) {
        return {
          label: `пов ${"XYZ"[i]}`,
          rot: true,
          get: () => h.rot[i],
          set: (v) => {
            h.rot[i] = v;
          },
        };
      }
      if (i === 3) {
        return {
          label: "масштаб",
          rot: false,
          steps: [0.005, 0.02, 0.05],
          get: () => h.scale,
          set: (v) => {
            h.scale = Math.max(0.02, v);
          },
        };
      }
      return {
        label: "сгиб кулака",
        rot: false,
        steps: [0.05, 0.1, 0.25],
        get: () => h.curl,
        set: (v) => {
          h.curl = Math.max(0, v);
        },
      };
    }
    const [, kind, slot] = t.key.split(":") as [string, ItemKind, "vrLeft" | "vrRight"];
    const p = LOADOUT.items[kind][slot];
    if (i < 3) {
      return {
        label: `поз ${"XYZ"[i]}`,
        rot: false,
        get: () => p.pos[i],
        set: (v) => {
          p.pos[i] = v;
        },
      };
    }
    if (i < 6) {
      const a = i - 3;
      return {
        label: `пов ${"XYZ"[a]}`,
        rot: true,
        get: () => p.rot[a],
        set: (v) => {
          p.rot[a] = v;
        },
      };
    }
    return {
      label: "масштаб",
      rot: false,
      get: () => p.scale,
      set: (v) => {
        p.scale = Math.max(0.05, v);
      },
    };
  }

  private applyChange(dir: 1 | -1): void {
    // Строка выбора цели.
    if (this.row === 0) {
      this.targetIdx = (this.targetIdx + dir + TARGETS.length) % TARGETS.length;
      this.row = 0;
      this.clearArm = 0; // ушли с «очистить мир» — снять подтверждение
      this.redraw();
      return;
    }
    // Явное сохранение всех настроек.
    if (this.row === this.saveRow) {
      this.saveAll();
      return;
    }
    // Сброс текущей цели к значениям из файла.
    if (this.row === this.resetRow) {
      resetTarget(this.target.key);
      this.redraw();
      return;
    }
    const f = this.field(this.row - 1);
    if (!f) return;
    // Кнопка A переключает шаг между тремя позициями, а у некоторых полей
    // список шагов короче — берём последний, иначе получили бы undefined,
    // а из него NaN, который потом уже ничем не вылечить.
    const steps = f.steps ?? (f.rot ? ROT_STEPS : POS_STEPS);
    const step = steps[this.stepIdx] ?? steps[steps.length - 1];
    f.set(f.get() + dir * step);
    if (this.target.kind !== "action") saveTarget(this.target.key);
    this.redraw();
  }

  /**
   * Фиксирует все настройки.
   * Онлайн — на сервер по токену игрока (переживает смену адреса/устройства).
   * Иначе — в src/config/loadout.ts через дев-сервер, а без него в localStorage.
   */
  saveAll(): void {
    for (const t of TARGETS) saveTarget(t.key);
    this.savedFlash = 2;

    if (this.onSaveServer) {
      this.onSaveServer();
      this.fileState = "на сервере ✓";
      this.redraw();
      return;
    }

    this.fileState = "…";
    this.redraw();
    void pushLoadoutToFile().then((r) => {
      this.fileState =
        r === "ok"
          ? "в файл ✓"
          : r === "no-server"
            ? "сохранено в этом браузере ✓"
            : "ошибка записи";
      this.savedFlash = Math.max(this.savedFlash, 2);
      this.redraw();
    });
  }

  /** Выводит текущие значения в консоль в виде для вставки в loadout.ts. */
  print(): void {
    printLoadout();
  }

  // ---- отрисовка ----

  private redraw(): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    const t = this.target;

    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, TEX_W - 6, TEX_H - 6);
    ctx.textBaseline = "top";

    ctx.fillStyle = "#e8ecf8";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillText("НАСТРОЙКА ЭКИПИРОВКИ", 24, 18);

    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#8c96ad";
    ctx.fillText(`шаг: ${STEP_LABELS[this.stepIdx]}`, 24, 52);
    if (isOverridden(t.key)) {
      ctx.fillStyle = "#7ee081";
      ctx.fillText("сохранено", TEX_W - 130, 52);
    }

    const top = 84;
    const rowH = 36;
    const drawRow = (i: number, name: string, value: string, accent?: string) => {
      const y = top + i * rowH;
      const active = i === this.row;
      if (active) {
        ctx.fillStyle = "#263048";
        ctx.fillRect(18, y - 5, TEX_W - 36, rowH - 3);
      }
      ctx.font = `${active ? "bold " : ""}23px system-ui, sans-serif`;
      ctx.fillStyle = accent ?? (active ? "#9fd0ff" : "#c9d2e6");
      ctx.fillText(`${active ? "▸ " : "   "}${name}`, 24, y);
      ctx.fillStyle = accent ?? (active ? "#ffffff" : "#9aa3b8");
      ctx.fillText(value, 300, y);
    };

    drawRow(0, "Цель", t.label, this.row === 0 ? "#ffd166" : undefined);
    for (let i = 0; i < this.fieldCount(); i++) {
      const f = this.field(i);
      if (!f) continue;
      const v = f.get();
      const shown = f.format
        ? f.format(v)
        : f.rot
          ? `${v.toFixed(2)}  (${Math.round((v * 180) / Math.PI)}°)`
          : v.toFixed(3);
      drawRow(i + 1, f.label, shown);
    }
    const saveVal =
      this.fileState !== "" && this.savedFlash > 0
        ? this.fileState
        : this.savedFlash > 0
          ? "сохранено ✓"
          : "◂ ▸";
    drawRow(
      this.saveRow,
      "Сохранить настройки",
      saveVal,
      this.savedFlash > 0
        ? this.fileState === "ошибка записи"
          ? "#ff8a8a"
          : this.fileState.includes("✓")
            ? "#7ee081"
            : "#ffd166"
        : undefined,
    );
    drawRow(this.resetRow, "Сброс к файлу", "◂ ▸");

    ctx.font = "17px system-ui, sans-serif";
    ctx.fillStyle = "#79839a";
    ctx.fillText("стик ↕ — строка · X / Y — меньше / больше", 24, TEX_H - 52);
    ctx.fillText("A — шаг · B — закрыть", 24, TEX_H - 28);

    this.tex.update(true);
  }
}
