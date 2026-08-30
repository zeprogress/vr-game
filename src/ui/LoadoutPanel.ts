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
const STEP_LABELS = ["крупный", "средний", "точный"];

interface Target {
  key: TargetKey;
  label: string;
  /** Кисть — только поворот; предмет — позиция, поворот и масштаб. */
  kind: "hand" | "item";
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
];

type Field =
  | { label: string; get(): number; set(v: number): void; rot: boolean }
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
    return this.target.kind === "hand" ? 3 : 7;
  }

  private field(i: number): Field {
    const t = this.target;
    if (t.kind === "hand") {
      const side = t.key.split(":")[1] as HandSide;
      const axis = i;
      return {
        label: `пов ${"XYZ"[axis]}`,
        rot: true,
        get: () => LOADOUT.hands[side][axis],
        set: (v) => {
          LOADOUT.hands[side][axis] = v;
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
    const step = (f.rot ? ROT_STEPS : POS_STEPS)[this.stepIdx];
    f.set(f.get() + dir * step);
    saveTarget(this.target.key);
    this.redraw();
  }

  /**
   * Запоминает все настройки (кисти и предметы для обеих рук), чтобы они
   * пережили перезагрузку. Правка отдельного значения сохраняется и сама,
   * но этот пункт фиксирует разом всё и подтверждает, что записалось.
   */
  saveAll(): void {
    for (const t of TARGETS) saveTarget(t.key);
    this.savedFlash = 2;
    this.redraw();
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
      const shown = f.rot ? `${v.toFixed(2)}  (${Math.round((v * 180) / Math.PI)}°)` : v.toFixed(3);
      drawRow(i + 1, f.label, shown);
    }
    drawRow(
      this.saveRow,
      "Сохранить настройки",
      this.savedFlash > 0 ? "сохранено ✓" : "◂ ▸",
      this.savedFlash > 0 ? "#7ee081" : undefined,
    );
    drawRow(this.resetRow, "Сброс к файлу", "◂ ▸");

    ctx.font = "17px system-ui, sans-serif";
    ctx.fillStyle = "#79839a";
    ctx.fillText("стик ↕ — строка · X / Y — меньше / больше", 24, TEX_H - 52);
    ctx.fillText("A — шаг · B — закрыть", 24, TEX_H - 28);

    this.tex.update(true);
  }
}
