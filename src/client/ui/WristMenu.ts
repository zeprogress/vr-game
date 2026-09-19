import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/linesBuilder";

import { weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import type { WarehouseWeapon } from "#shared/net/messages";

import { STAT_LABELS, type Progression, type StatName } from "../player/Progression";
import { BAG, ITEMS, type Inventory } from "../player/Inventory";
import { VR_SETTINGS, setVrSettings } from "../config/vrSettings";
import { weaponStats, type HeroStats, type WornWeapon } from "./itemStats";

const STATS: StatName[] = ["str", "agi", "int"];
const TEX_W = 1200;
const TEX_H = 900;
const PLANE_W = 0.5;

/** Раскладка: вкладки сверху, содержимое, строка описания, «Выйти» (всегда внизу). Без прокруток. */
const TAB_Y = 8;
const TAB_H = 48;
const VIEW_Y = 66;
const INFO_Y = 786;
const EXIT_Y = 846;
const EXIT_H = 46;
/** Склад: ячейки сеткой по страницам. */
const WH_COLS = 4;
const WH_ROWS = 6;
const WH_PER_PAGE = WH_COLS * WH_ROWS;

const TIER_COLOR: Record<WeaponTier, string> = {
  base: "#c9d2e6",
  gold: "#ffd166",
  legendary: "#c77dff",
};
const TIER_BG: Record<WeaponTier, string> = {
  base: "#1c212e",
  gold: "#2a2416",
  legendary: "#251a33",
};

type Tab = "char" | "set";
type Kind = "tab" | "button" | "cell" | "card" | "toggle" | "slider";
type Side = "left" | "right";

/** Кликабельная область (экранные координаты текстуры). */
interface Widget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: Kind;
  /** Слайдер: текущее значение 0..1. */
  val?: number;
  act?: () => void;
  set?: (t: number) => void;
  /** Строки для полосы описания. */
  info?: [string, string];
}

/** Луч правой руки (мировые координаты) — для лазерного указателя. */
export interface PointerRay {
  origin: Vector3;
  dir: Vector3;
}

/** Ввод меню за кадр. */
export interface MenuInput {
  /** Навигация левым стиком: -1/0/1 «щелчками» (повтор при удержании делает XRInput). */
  navX: number;
  navY: number;
  /** Нажать выбранное (кнопка подтверждения). */
  confirm: boolean;
  /** Следующая вкладка. */
  tabNext: boolean;
  /** Луч правой руки, если она поднесена к меню; иначе null. */
  ray: PointerRay | null;
  /** Курок правой руки сейчас нажат. */
  trigger: boolean;
  dt: number;
}

/** Что игрок выбрал в меню сделать с оружием (обрабатывает Game). */
export type MenuAction =
  | { act: "toWarehouse"; src: "hand" | "back"; side: Side }
  /** Из руки за плечо / со спины в руку — та же сторона (левая рука ↔ левое плечо), занято — меняются. */
  | { act: "handToBack" | "backToHand"; side: Side }
  /** Со склада в руку / за плечо этой стороны (что там было — на склад). */
  | { act: "whToHand" | "whToBack"; side: Side; id: string; cls: WeaponClass; tier: WeaponTier }
  | { act: "drop" | "scrap"; id: string; cls: WeaponClass; tier: WeaponTier };

/** Всплывающее меню действий над выбранным оружием. */
interface Popup {
  title: string;
  sub: string;
  color: string;
  buttons: { id: string; label: string; hint?: string; color: string; act: () => void }[];
}

/**
 * Меню на левой руке (VR): вкладки «Персонаж» и «Настройки», внизу всегда
 * видна кнопка «Выйти из игры» (спрашивает, оставить ли героя ботом). Без
 * прокруток. Управление: левый стик (выбор), кнопка подтверждения, либо лазер
 * правой руки, когда её поднесли к меню, и курок.
 */
export class WristMenu {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private readonly laser: LinesMesh;
  private laserPts: Vector3[] = [new Vector3(), new Vector3(0, 0, 1)];
  private open = false;
  private tab: Tab = "char";
  private focusId = "tab:char";
  private hoverId = "";
  private dialog = false;
  private popup: Popup | null = null;
  private whPage = 0;
  private dirty = true;
  private lastDraw = 0;
  private prevTrigger = false;
  private dragSlider: string | null = null;
  private widgets: Widget[] = [];

  /** Игрок подтвердил выход: keepBot — оставить героя ботом. Ставит Game. */
  onExit: ((keepBot: boolean) => void) | null = null;
  onTogglePvp: (() => void) | null = null;
  /** Действие с оружием (в руку / за спину / на землю / разобрать / убрать на склад). Ставит Game. */
  onAction: ((a: MenuAction) => void) | null = null;

  private pvpOn = false;
  private leaveBotOn = false;
  private rightHand: WornWeapon | null = null;
  private leftHand: WornWeapon | null = null;
  private stowed: (WornWeapon & { side: Side })[] = [];
  private warehouse: WarehouseWeapon[] = [];
  private equippedIds: { left: string | null; right: string | null } = { left: null, right: null };
  private skillCd = -1;
  private readonly imgs = new Map<string, HTMLImageElement | null>();
  private readonly unsub: () => void;

  constructor(
    scene: Scene,
    parent: Node,
    private readonly prog: Progression,
    private readonly inv: Inventory,
  ) {
    this.tex = new DynamicTexture("wristMenuTex", { width: TEX_W, height: TEX_H }, scene, false);
    const mat = new StandardMaterial("wristMenuMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;

    this.plane = MeshBuilder.CreatePlane(
      "wristMenu",
      { width: PLANE_W, height: PLANE_W * (TEX_H / TEX_W) },
      scene,
    );
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.set(0, 0.24, 0);
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 2;
    this.plane.setEnabled(false);

    // Лазерный указатель: тонкая линия от руки до точки на меню.
    this.laser = MeshBuilder.CreateLines("wristLaser", { points: this.laserPts, updatable: true }, scene);
    this.laser.color = new Color3(0.4, 0.85, 1);
    this.laser.isPickable = false;
    this.laser.renderingGroupId = 2;
    this.laser.alwaysSelectAsActiveMesh = true;
    this.laser.setEnabled(false);

    const offProg = this.prog.onChange(() => (this.dirty = true));
    const offInv = this.inv.onChange(() => (this.dirty = true));
    this.unsub = () => {
      offProg();
      offInv();
    };
  }

  // ---- данные от Game ----

  setHands(right: WornWeapon | null, left: WornWeapon | null): void {
    const same = (a: WornWeapon | null, b: WornWeapon | null): boolean =>
      a === b || (!!a && !!b && a.cls === b.cls && a.tier === b.tier && a.affix === b.affix);
    if (same(right, this.rightHand) && same(left, this.leftHand)) return;
    this.rightHand = right;
    this.leftHand = left;
    this.dirty = true;
  }

  setStowed(list: (WornWeapon & { side: Side })[]): void {
    const sig = (l: typeof list): string => l.map((s) => `${s.side}${s.cls}${s.tier}`).join("|");
    if (sig(list) === sig(this.stowed)) return;
    this.stowed = list;
    this.dirty = true;
  }

  setWarehouse(list: WarehouseWeapon[], equipped: { left: string | null; right: string | null }): void {
    const sig = (l: WarehouseWeapon[]): string => l.map((w) => w.id).join(",");
    if (
      sig(list) === sig(this.warehouse) &&
      equipped.left === this.equippedIds.left &&
      equipped.right === this.equippedIds.right
    ) {
      return;
    }
    this.warehouse = list;
    this.equippedIds = equipped;
    this.dirty = true;
  }

  setSkillCd(frac: number): void {
    const q = frac < 0 ? -1 : Math.round(Math.max(0, Math.min(1, frac)) * 20) / 20;
    if (q === this.skillCd) return;
    this.skillCd = q;
    this.dirty = true;
  }

  setPvp(on: boolean): void {
    if (on === this.pvpOn) return;
    this.pvpOn = on;
    this.dirty = true;
  }

  /** Текущее значение «оставить бота» — подсказка в вопросе при выходе. */
  setLeaveBot(on: boolean): void {
    this.leaveBotOn = on;
  }

  // ---- управление окном ----

  get visible(): boolean {
    return this.open;
  }

  get anchor(): Node | null {
    return this.plane.parent;
  }

  reparent(parent: Node): void {
    this.plane.parent = parent;
  }

  /** Меш панели — Game считает от него, близко ли правая рука. */
  get mesh(): Mesh {
    return this.plane;
  }

  toggle(): void {
    this.open = !this.open;
    this.plane.setEnabled(this.open);
    if (!this.open) {
      this.laser.setEnabled(false);
      this.dialog = false;
      this.popup = null;
    } else {
      this.dirty = true;
    }
  }

  hide(): void {
    if (!this.open) return;
    this.toggle();
  }

  dispose(): void {
    this.unsub();
    this.laser.dispose();
    this.plane.dispose();
    this.tex.dispose();
  }

  // ---- кадр ----

  update(o: MenuInput): void {
    if (!this.open) return;

    if (o.tabNext && !this.dialog && !this.popup) this.switchTab(this.tab === "char" ? "set" : "char");

    // Лазер: луч правой руки → точка на плоскости меню.
    let hit: { u: number; v: number } | null = null;
    if (o.ray) hit = this.rayToUv(o.ray);
    this.updateLaser(o.ray, hit);
    const hover = hit ? this.widgetAt(hit.u, hit.v)?.id ?? "" : "";
    if (hover !== this.hoverId) {
      this.hoverId = hover;
      this.dirty = true;
    }
    const trigDown = o.trigger && !this.prevTrigger;
    if (hit && trigDown) {
      const w = this.widgetAt(hit.u, hit.v);
      if (w) {
        this.focus(w.id);
        if (w.kind === "slider") {
          this.dragSlider = w.id;
          this.setSliderFromU(w, hit.u);
        } else {
          this.activate(w);
        }
      }
    }
    if (this.dragSlider && o.trigger && hit) {
      const w = this.widgets.find((x) => x.id === this.dragSlider);
      if (w) this.setSliderFromU(w, hit.u);
    }
    if (!o.trigger) this.dragSlider = null;
    this.prevTrigger = o.trigger;

    // Левый стик: выбор.
    if (o.navX !== 0 || o.navY !== 0) this.navigate(o.navX, o.navY);
    if (o.confirm) {
      const f = this.widgets.find((w) => w.id === this.focusId);
      if (f) this.activate(f);
    }

    // Перерисовка не чаще ~25 раз/с: большая текстура заметно дороже обычной.
    const now = performance.now();
    if (this.dirty && now - this.lastDraw > 40) {
      this.lastDraw = now;
      this.dirty = false;
      this.redraw();
    }
  }

  /** Нажатие на виджет: действие + сразу перерисовка (тумблеры меняют вид, не дожидаясь ухода лазера). */
  private activate(w: Widget): void {
    w.act?.();
    this.dirty = true;
    this.lastDraw = 0; // не ждать паузу перед перерисовкой после нажатия
  }

  // ---- лазер ----

  private readonly _inv = new Matrix();
  private readonly _ol = new Vector3();
  private readonly _dl = new Vector3();

  /** Точка попадания луча в плоскость меню в пикселях текстуры, либо null. */
  private rayToUv(ray: PointerRay): { u: number; v: number } | null {
    const w = this.plane.computeWorldMatrix(true);
    w.invertToRef(this._inv);
    Vector3.TransformCoordinatesToRef(ray.origin, this._inv, this._ol);
    Vector3.TransformNormalToRef(ray.dir, this._inv, this._dl);
    if (Math.abs(this._dl.z) < 1e-5) return null;
    const t = -this._ol.z / this._dl.z;
    if (t < 0 || t > 2) return null;
    const x = this._ol.x + this._dl.x * t;
    const y = this._ol.y + this._dl.y * t;
    const hh = PLANE_W * (TEX_H / TEX_W);
    const u = (x / PLANE_W + 0.5) * TEX_W;
    const v = (0.5 - y / hh) * TEX_H;
    if (u < 0 || u > TEX_W || v < 0 || v > TEX_H) return null;
    return { u, v };
  }

  private updateLaser(ray: PointerRay | null, hit: { u: number; v: number } | null): void {
    if (!ray) {
      this.laser.setEnabled(false);
      return;
    }
    const len = hit ? this.hitDistance(ray) : 0.6;
    this.laserPts[0].copyFrom(ray.origin);
    this.laserPts[1].set(
      ray.origin.x + ray.dir.x * len,
      ray.origin.y + ray.dir.y * len,
      ray.origin.z + ray.dir.z * len,
    );
    MeshBuilder.CreateLines("wristLaser", { points: this.laserPts, instance: this.laser as never });
    this.laser.setEnabled(true);
  }

  private hitDistance(ray: PointerRay): number {
    const w = this.plane.getWorldMatrix();
    const n = Vector3.TransformNormal(new Vector3(0, 0, 1), w);
    const c = this.plane.getAbsolutePosition();
    const denom = Vector3.Dot(n, ray.dir);
    if (Math.abs(denom) < 1e-5) return 0.6;
    const t = Vector3.Dot(c.subtract(ray.origin), n) / denom;
    return t > 0 && t < 2 ? t : 0.6;
  }

  // ---- виджеты, фокус ----

  /** Модальный слой (вопрос при выходе / меню действий): активны только его виджеты. */
  private modalPrefix(): string {
    return this.dialog ? "dlg:" : this.popup ? "pop:" : "";
  }

  private activeWidgets(): Widget[] {
    const pre = this.modalPrefix();
    if (pre) return this.widgets.filter((w) => w.id.startsWith(pre));
    return this.widgets.filter((w) => !w.id.startsWith("dlg:") && !w.id.startsWith("pop:"));
  }

  private widgetAt(u: number, v: number): Widget | null {
    const list = this.activeWidgets();
    for (let i = list.length - 1; i >= 0; i--) {
      const w = list[i];
      if (u >= w.x && u <= w.x + w.w && v >= w.y && v <= w.y + w.h) return w;
    }
    return null;
  }

  private focus(id: string): void {
    if (this.focusId === id) return;
    this.focusId = id;
    this.dirty = true;
  }

  private switchTab(t: Tab): void {
    if (this.tab === t) return;
    this.tab = t;
    this.focusId = `tab:${t}`;
    this.dirty = true;
    this.lastDraw = 0;
  }

  /** Перемещение фокуса стиком: по геометрии; на слайдере ←/→ меняют значение; на вкладках — переключают. */
  private navigate(dx: number, dy: number): void {
    const list = this.activeWidgets();
    const cur = list.find((w) => w.id === this.focusId);
    if (!cur) {
      this.focusId = list[0]?.id ?? "";
      this.dirty = true;
      return;
    }
    if (dx !== 0 && cur.kind === "slider" && cur.set) {
      cur.set(Math.max(0, Math.min(1, (cur.val ?? 0) + dx * 0.1)));
      this.dirty = true;
      this.lastDraw = 0;
      return;
    }
    if (dx !== 0 && cur.kind === "tab" && !this.modalPrefix()) {
      this.switchTab(dx > 0 ? "set" : "char");
      return;
    }
    const cx = cur.x + cur.w / 2;
    const cy = cur.y + cur.h / 2;
    let best: Widget | null = null;
    let bestScore = Infinity;
    for (const w of list) {
      if (w === cur) continue;
      const ddx = w.x + w.w / 2 - cx;
      const ddy = w.y + w.h / 2 - cy;
      let score: number;
      if (dy !== 0) {
        if (Math.sign(ddy) !== dy || Math.abs(ddy) < 6) continue;
        score = Math.abs(ddy) + Math.abs(ddx) * 0.6;
      } else {
        if (Math.sign(ddx) !== dx || Math.abs(ddx) < 6 || Math.abs(ddy) > 60) continue;
        score = Math.abs(ddx) + Math.abs(ddy) * 2;
      }
      if (score < bestScore) {
        bestScore = score;
        best = w;
      }
    }
    if (best) this.focus(best.id);
    this.lastDraw = 0;
  }

  private setSliderFromU(w: Widget, u: number): void {
    // Дорожка нарисована с отступом 14 px по краям виджета.
    w.set?.(Math.max(0, Math.min(1, (u - (w.x + 14)) / (w.w - 28))));
    this.dirty = true;
    this.lastDraw = 0;
  }

  // ---- рисование ----

  private hero(): HeroStats {
    return {
      level: this.prog.level,
      str: this.prog.stats.str,
      agi: this.prog.stats.agi,
      int: this.prog.stats.int,
    };
  }

  private add(w: Widget): Widget {
    this.widgets.push(w);
    return w;
  }

  private redraw(): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    this.widgets = [];

    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, TEX_W - 6, TEX_H - 6);
    ctx.textBaseline = "top";

    if (this.tab === "char") this.drawCharacter(ctx);
    else this.drawSettings(ctx);
    this.drawTabs(ctx);
    this.drawExit(ctx);
    this.drawInfo(ctx);
    if (this.dialog) this.drawExitDialog(ctx);
    else if (this.popup) this.drawPopup(ctx);

    // Фокус должен указывать на существующий виджет активного слоя.
    if (!this.activeWidgets().some((w) => w.id === this.focusId)) {
      this.focusId = this.activeWidgets()[0]?.id ?? "";
    }

    this.tex.update(true);
  }

  private styleFor(w: Widget): { fill: string; stroke: string; lw: number } {
    const focus = this.focusId === w.id;
    const hover = this.hoverId === w.id;
    return {
      fill: focus ? "#263048" : hover ? "#212a3e" : "",
      stroke: focus ? "#9fd0ff" : hover ? "#6f8fc7" : "",
      lw: focus ? 3 : 2,
    };
  }

  private drawTabs(ctx: CanvasRenderingContext2D): void {
    const tabs: [Tab, string][] = [
      ["char", "Персонаж"],
      ["set", "Настройки"],
    ];
    const w = 300;
    tabs.forEach(([id, label], i) => {
      const wd = this.add({
        id: `tab:${id}`, x: 12 + i * (w + 8), y: TAB_Y, w, h: TAB_H, kind: "tab",
        act: () => this.switchTab(id),
      });
      const active = this.tab === id;
      const st = this.styleFor(wd);
      ctx.fillStyle = active ? "#2b3a5c" : st.fill || "#1a1f2b";
      ctx.fillRect(wd.x, wd.y, wd.w, wd.h);
      ctx.strokeStyle = st.stroke || (active ? "#5f86c9" : "#333c50");
      ctx.lineWidth = st.stroke ? st.lw : 2;
      ctx.strokeRect(wd.x, wd.y, wd.w, wd.h);
      ctx.fillStyle = active ? "#ffffff" : "#aab4cc";
      ctx.font = `${active ? "bold " : ""}28px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(label, wd.x + wd.w / 2, wd.y + 9);
      ctx.textAlign = "left";
    });
  }

  private drawInfo(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#171b26";
    ctx.fillRect(12, INFO_Y, TEX_W - 24, 54);
    const f = this.widgets.find((w) => w.id === this.focusId);
    const [a, b] = f?.info ?? ["", ""];
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillStyle = "#dbe2f2";
    ctx.fillText(a || "Стик — выбор · B — нажать · X — вкладка · Y — закрыть", 22, INFO_Y + 5);
    ctx.font = "19px system-ui, sans-serif";
    ctx.fillStyle = "#8c96ad";
    ctx.fillText(b, 22, INFO_Y + 30);
  }

  private drawExit(ctx: CanvasRenderingContext2D): void {
    const wd = this.add({
      id: "exit", x: 12, y: EXIT_Y, w: TEX_W - 24, h: EXIT_H, kind: "button",
      act: () => {
        this.dialog = true;
        this.focusId = "dlg:cancel";
      },
    });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || "#2a2036";
    ctx.fillRect(wd.x, wd.y, wd.w, wd.h);
    ctx.strokeStyle = st.stroke || "#7a4a5a";
    ctx.lineWidth = st.lw;
    ctx.strokeRect(wd.x, wd.y, wd.w, wd.h);
    ctx.fillStyle = "#ffb0b0";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Выйти из игры", wd.x + wd.w / 2, wd.y + 9);
    ctx.textAlign = "left";
  }

  private drawExitDialog(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(6,8,12,.84)";
    ctx.fillRect(4, 4, TEX_W - 8, TEX_H - 8);
    const w = 520;
    const x = (TEX_W - w) / 2;
    ctx.fillStyle = "#171b26";
    ctx.fillRect(x, 200, w, 470);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, 200, w, 470);
    ctx.fillStyle = "#e8ecf8";
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Выйти из игры?", TEX_W / 2, 226);
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillStyle = "#aab4cc";
    ctx.fillText("Оставить героя ботом в мире?", TEX_W / 2, 280);
    ctx.textAlign = "left";

    const btn = (id: string, y: number, label: string, sub: string, color: string, act: () => void): void => {
      const wd = this.add({ id, x: x + 24, y, w: w - 48, h: 92, kind: "button", act });
      const st = this.styleFor(wd);
      ctx.fillStyle = st.fill || "#1f2533";
      ctx.fillRect(wd.x, wd.y, wd.w, wd.h);
      ctx.strokeStyle = st.stroke || color;
      ctx.lineWidth = st.lw;
      ctx.strokeRect(wd.x, wd.y, wd.w, wd.h);
      ctx.fillStyle = color;
      ctx.font = "bold 30px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(label, wd.x + wd.w / 2, wd.y + 14);
      ctx.font = "19px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(sub, wd.x + wd.w / 2, wd.y + 56);
      ctx.textAlign = "left";
    };
    btn("dlg:keep", 322, "Оставить бота", this.leaveBotOn ? "герой продолжит играть сам · как раньше" : "герой продолжит играть сам", "#7ee081", () => {
      this.dialog = false;
      this.onExit?.(true);
    });
    btn("dlg:drop", 428, "Не оставлять", this.leaveBotOn ? "герой исчезнет из мира" : "герой исчезнет из мира · как раньше", "#ffd166", () => {
      this.dialog = false;
      this.onExit?.(false);
    });
    btn("dlg:cancel", 534, "Отмена", "вернуться в игру", "#9fb2d8", () => {
      this.dialog = false;
      this.focusId = "exit";
    });
  }

  private drawPopup(ctx: CanvasRenderingContext2D): void {
    const pp = this.popup!;
    ctx.fillStyle = "rgba(6,8,12,.84)";
    ctx.fillRect(4, 4, TEX_W - 8, TEX_H - 8);
    const w = 560;
    const bh = 66;
    const h = 130 + pp.buttons.length * (bh + 10) + 14;
    const x = (TEX_W - w) / 2;
    const y = Math.max(60, (TEX_H - h) / 2);
    ctx.fillStyle = "#171b26";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = pp.color;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    ctx.textAlign = "center";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillStyle = pp.color;
    ctx.fillText(pp.title, TEX_W / 2, y + 16);
    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#7db8ff";
    this.wrapCentered(ctx, pp.sub, TEX_W / 2, y + 58, w - 40, 22, 2);
    ctx.textAlign = "left";
    pp.buttons.forEach((b, i) => {
      const wd = this.add({
        id: b.id, x: x + 24, y: y + 110 + i * (bh + 10), w: w - 48, h: bh, kind: "button",
        act: b.act,
      });
      const st = this.styleFor(wd);
      ctx.fillStyle = st.fill || "#1f2533";
      ctx.fillRect(wd.x, wd.y, wd.w, wd.h);
      ctx.strokeStyle = st.stroke || b.color;
      ctx.lineWidth = st.lw;
      ctx.strokeRect(wd.x, wd.y, wd.w, wd.h);
      ctx.fillStyle = b.color;
      ctx.font = "bold 27px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(b.label, wd.x + wd.w / 2, wd.y + (b.hint ? 8 : 18));
      if (b.hint) {
        ctx.font = "17px system-ui, sans-serif";
        ctx.fillStyle = "#8c96ad";
        ctx.fillText(b.hint, wd.x + wd.w / 2, wd.y + 40);
      }
      ctx.textAlign = "left";
    });
  }

  private wrapCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lh: number, maxLines: number): void {
    const words = text.split(" ");
    const lines: string[] = [];
    let line = "";
    for (const wd of words) {
      const t = line ? `${line} ${wd}` : wd;
      if (ctx.measureText(t).width > maxW && line) {
        lines.push(line);
        line = wd;
      } else {
        line = t;
      }
    }
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((l, i) => ctx.fillText(l, cx, y + i * lh));
  }

  // ---- вкладка «Персонаж» ----

  private drawCharacter(ctx: CanvasRenderingContext2D): void {
    const p = this.prog;
    const hero = this.hero();
    const LX = 12;
    const LW = 560; // левая колонка
    let y = VIEW_Y;

    // Уровень и опыт.
    ctx.font = "bold 32px system-ui, sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(`Ур. ${p.level}`, LX + 8, y);
    const need = p.xpToNext();
    const frac = p.atMaxLevel ? 1 : Math.min(1, p.xp / need);
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillStyle = "#c9d2e6";
    ctx.textAlign = "right";
    ctx.fillText(p.atMaxLevel ? "максимальный уровень" : `опыт ${Math.floor(p.xp)} / ${Math.round(need)}`, LX + LW - 6, y + 6);
    ctx.textAlign = "left";
    y += 42;
    ctx.fillStyle = "#242a38";
    ctx.fillRect(LX + 8, y, LW - 16, 16);
    ctx.fillStyle = "#4a9be8";
    ctx.fillRect(LX + 8, y, (LW - 16) * frac, 16);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 2;
    ctx.strokeRect(LX + 8, y, LW - 16, 16);
    y += 28;

    // Характеристики.
    for (const s of STATS) {
      const canSpend = p.unspent > 0;
      const wd = this.add({
        id: `stat:${s}`, x: LX, y, w: LW, h: 42, kind: "button",
        act: () => {
          p.spend(s);
        },
        info: [`${STAT_LABELS[s]}: ${p.stats[s]}`, canSpend ? "нажми — вложить свободное очко" : this.statHint(s)],
      });
      const st = this.styleFor(wd);
      if (st.fill) {
        ctx.fillStyle = st.fill;
        ctx.fillRect(wd.x, y, wd.w, wd.h);
      }
      if (st.stroke) {
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = st.lw;
        ctx.strokeRect(wd.x, y, wd.w, wd.h);
      }
      ctx.fillStyle = "#c9d2e6";
      ctx.font = "26px system-ui, sans-serif";
      ctx.fillText(STAT_LABELS[s], LX + 12, y + 7);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 26px system-ui, sans-serif";
      ctx.fillText(String(p.stats[s]), LX + 200, y + 7);
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(this.statHint(s), LX + 250, y + 12);
      if (canSpend) {
        ctx.fillStyle = "#2f7a3a";
        ctx.fillRect(LX + LW - 60, y + 4, 50, 34);
        ctx.fillStyle = "#e9ffe9";
        ctx.font = "bold 28px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("+", LX + LW - 35, y + 5);
        ctx.textAlign = "left";
      }
      y += 46;
    }
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillStyle = p.unspent > 0 ? "#7ee081" : "#6b7488";
    ctx.fillText(`Свободных очков: ${p.unspent}`, LX + 8, y);
    y += 34;

    // В руках — отдельная панель.
    y = this.section(ctx, LX, LW, "В РУКАХ", y);
    // Лук занимает обе руки: он показывается в левой, а в правой — стрела.
    const bow =
      this.leftHand?.cls === "bow" ? this.leftHand : this.rightHand?.cls === "bow" ? this.rightHand : null;
    const hands: [string, WornWeapon | null, Side][] = [
      ["Левая рука", bow ? bow : this.leftHand, "left"],
      ["Правая рука", bow ? null : this.rightHand, "right"],
    ];
    hands.forEach(([label, w, side], i) => {
      if (bow && side === "right") {
        this.arrowCard(ctx, LX + i * 282, y, 274, 112);
        return;
      }
      this.weaponCard(ctx, `hand:${side}`, LX + i * 282, y, 274, 112, label, w, hero, this.handQuality(w, side), () => {
        if (w) this.openHeldPopup("hand", side, w, hero);
      });
    });
    y += 122;

    // За спиной: левое плечо слева, правое — справа.
    y = this.section(ctx, LX, LW, "ЗА СПИНОЙ", y);
    (["left", "right"] as const).forEach((side, i) => {
      const st = this.stowed.find((x) => x.side === side) ?? null;
      const label = side === "left" ? "Левое плечо" : "Правое плечо";
      this.weaponCard(ctx, `back:${side}`, LX + i * 282, y, 274, 92, label, st, hero, undefined, () => {
        if (st) this.openHeldPopup("back", side, st, hero);
      });
    });
    y += 102;

    // Сумка.
    y = this.section(ctx, LX, LW, "СУМКА", y);
    const cw = 134;
    const ch = 58;
    for (let i = 0; i < BAG.slots; i++) {
      this.bagCell(ctx, i, LX + (i % 4) * (cw + 8), y + Math.floor(i / 4) * (ch + 8), cw, ch);
    }
    y += Math.ceil(BAG.slots / 4) * (ch + 8) + 2;

    ctx.font = "19px system-ui, sans-serif";
    ctx.fillStyle = "#8c96ad";
    ctx.fillText("Умение оружия", LX + 8, y + 4);
    ctx.fillStyle = this.skillCd < 0 ? "#6b7488" : this.skillCd <= 0.001 ? "#7ee081" : "#ffd166";
    ctx.fillText(
      this.skillCd < 0 ? "нет (нужен меч или лук)" : this.skillCd <= 0.001 ? "готово — нажми стик" : "перезарядка…",
      LX + 200,
      y + 4,
    );

    // Правая колонка: склад оружия (сетка, страницы).
    this.drawWarehouse(ctx, 590, VIEW_Y, TEX_W - 590 - 12);
  }

  private section(ctx: CanvasRenderingContext2D, x: number, w: number, title: string, y: number): number {
    ctx.strokeStyle = "#3a4258";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 2);
    ctx.lineTo(x + w - 8, y + 2);
    ctx.stroke();
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillStyle = "#e8ecf8";
    ctx.fillText(title, x + 8, y + 8);
    return y + 38;
  }

  private statHint(s: StatName): string {
    const p = this.prog;
    if (s === "str") return `HP ${Math.round(p.maxHp)} · урон ×${p.swordDamage.toFixed(2)}`;
    if (s === "agi") return `бег ${p.moveSpeed.toFixed(2)} м/с`;
    return `огнешар ${p.fireboltMax.toFixed(1)} · хил ${Math.round(p.healMax)}`;
  }

  /** Очки роллов оружия в руке: по закреплённому инстансу, иначе лучший этого класса/тира. */
  private handQuality(w: WornWeapon | null, side: Side): number | undefined {
    if (!w || w.tier === "base") return undefined;
    // Лук в интерфейсе стоит в левой руке, а закреплён мог быть за любой.
    const id = w.cls === "bow" ? this.equippedIds.left ?? this.equippedIds.right : this.equippedIds[side];
    const byId = id ? this.warehouse.find((x) => x.id === id) : undefined;
    if (byId) return byId.quality;
    let best: WarehouseWeapon | undefined;
    for (const x of this.warehouse) {
      if (x.cls !== w.cls || x.tier !== w.tier) continue;
      if (!best || x.quality > best.quality) best = x;
    }
    return best?.quality;
  }

  private weaponCard(
    ctx: CanvasRenderingContext2D,
    id: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    item: WornWeapon | null,
    hero: HeroStats,
    quality: number | undefined,
    onPick: () => void,
  ): void {
    let info: [string, string] = [label, "пусто"];
    if (item) {
      const d = weaponDef(item.cls, item.tier);
      const stats = weaponStats(item, hero);
      info = [
        `${d.name}${quality ? ` (${quality})` : ""} — нажми: убрать на склад`,
        stats.slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ") || (item.affix ?? ""),
      ];
    }
    const wd = this.add({ id, x, y, w, h, kind: "card", info, act: onPick });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || (item ? TIER_BG[item.tier] : "#161a24");
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = st.stroke || (item ? TIER_COLOR[item.tier] : "#2c3446");
    ctx.lineWidth = st.stroke ? st.lw : 2;
    ctx.strokeRect(x, y, w, h);

    ctx.font = "17px system-ui, sans-serif";
    ctx.fillStyle = "#7c88a4";
    ctx.fillText(label, x + 10, y + 6);
    if (!item) {
      ctx.font = "22px system-ui, sans-serif";
      ctx.fillStyle = "#4d566c";
      ctx.fillText("пусто", x + 10, y + h / 2 - 4);
      return;
    }
    const iconS = h > 100 ? 72 : 56;
    this.drawWeaponIcon(ctx, item.cls, item.tier, x + 10, y + 28, iconS);
    const d = weaponDef(item.cls, item.tier);
    ctx.font = "bold 21px system-ui, sans-serif";
    ctx.fillStyle = TIER_COLOR[item.tier];
    ctx.fillText(d.name, x + iconS + 20, y + 28);
    let ty = y + 54;
    if (quality) {
      ctx.fillStyle = "#f2c74b";
      ctx.fillText(`(${quality})`, x + iconS + 20, ty);
      ty += 26;
    }
    if (item.affix && h > 100) {
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillStyle = "#7db8ff";
      this.wrapText(ctx, item.affix, x + iconS + 20, ty, w - iconS - 28, 19, 2);
    }
  }

  /** Правая «рука» при луке: значок стрелы — лук занимает обе руки. */
  private arrowCard(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const wd = this.add({
      id: "hand:right", x, y, w, h, kind: "card",
      info: ["Стрела", "лук занимает обе руки — правая рука тянет тетиву"],
    });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || "#161a24";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = st.stroke || "#3a4258";
    ctx.lineWidth = st.stroke ? st.lw : 2;
    ctx.strokeRect(x, y, w, h);
    ctx.font = "17px system-ui, sans-serif";
    ctx.fillStyle = "#7c88a4";
    ctx.fillText("Правая рука", x + 10, y + 6);
    // Стрела: древко, наконечник, оперение.
    ctx.save();
    ctx.translate(x + 16, y + 34);
    ctx.strokeStyle = "#c9d2e6";
    ctx.fillStyle = "#c9d2e6";
    ctx.lineCap = "round";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(6, 60);
    ctx.lineTo(70, 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(70, 0);
    ctx.lineTo(82, 4);
    ctx.lineTo(74, 14);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(6, 60);
    ctx.lineTo(0, 48);
    ctx.moveTo(16, 52);
    ctx.lineTo(8, 40);
    ctx.stroke();
    ctx.restore();
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillStyle = "#c9d2e6";
    ctx.fillText("Стрела", x + 112, y + 34);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#7c88a4";
    this.wrapText(ctx, "лук занимает обе руки", x + 112, y + 64, w - 122, 19, 2);
  }

  private bagCell(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, w: number, h: number): void {
    const slot = this.inv.slots[i];
    const def = slot?.item ? ITEMS[slot.item] : null;
    const info: [string, string] = def
      ? [def.name, def.heal > 0 ? `лечит +${def.heal} HP · нажми, чтобы выпить` : `в сумке ×${slot.count}`]
      : ["Пустая ячейка", ""];
    const wd = this.add({
      id: `bag:${i}`, x, y, w, h, kind: "cell", info,
      act: () => {
        this.inv.use(i);
      },
    });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || "#1a1f2b";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = st.stroke || (def ? "#5a6480" : "#333c50");
    ctx.lineWidth = st.stroke ? st.lw : 2;
    ctx.strokeRect(x, y, w, h);
    if (!def) return;
    this.drawItemIcon(ctx, def.icon, def.tint, x + 6, y + 6, 46);
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(`×${slot.count}`, x + 58, y + 8);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = "#9fb2d8";
    ctx.fillText(def.short, x + 58, y + 34);
  }

  // ---- склад ----

  private drawWarehouse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
    const pages = Math.max(1, Math.ceil(this.warehouse.length / WH_PER_PAGE));
    if (this.whPage >= pages) this.whPage = pages - 1;
    ctx.strokeStyle = "#3a4258";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x + w, y + 2);
    ctx.stroke();
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillStyle = "#e8ecf8";
    ctx.fillText(`СКЛАД ОРУЖИЯ (${this.warehouse.length})`, x, y + 8);

    // Страницы: ‹ 1/2 ›
    if (pages > 1) {
      const bx = x + w - 200;
      const nav = (id: string, bxx: number, label: string, delta: number): void => {
        const wd = this.add({
          id, x: bxx, y: y + 2, w: 46, h: 36, kind: "button",
          act: () => {
            this.whPage = Math.max(0, Math.min(pages - 1, this.whPage + delta));
          },
          info: ["Страница склада", `${this.whPage + 1} из ${pages}`],
        });
        const st = this.styleFor(wd);
        ctx.fillStyle = st.fill || "#1f2533";
        ctx.fillRect(wd.x, wd.y, wd.w, wd.h);
        ctx.strokeStyle = st.stroke || "#4a5470";
        ctx.lineWidth = st.lw;
        ctx.strokeRect(wd.x, wd.y, wd.w, wd.h);
        ctx.fillStyle = "#cfe0ff";
        ctx.font = "bold 26px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(label, wd.x + wd.w / 2, wd.y + 4);
        ctx.textAlign = "left";
      };
      nav("wh:prev", bx, "‹", -1);
      ctx.font = "22px system-ui, sans-serif";
      ctx.fillStyle = "#aab4cc";
      ctx.textAlign = "center";
      ctx.fillText(`${this.whPage + 1}/${pages}`, bx + 100, y + 8);
      ctx.textAlign = "left";
      nav("wh:next", bx + 154, "›", 1);
    }

    const top = y + 48;
    const cw = Math.floor((w - (WH_COLS - 1) * 8) / WH_COLS);
    const ch = 98;
    if (this.warehouse.length === 0) {
      ctx.font = "21px system-ui, sans-serif";
      ctx.fillStyle = "#6b7488";
      ctx.fillText("пусто — золотое и уникальное", x + 4, top + 6);
      ctx.fillText("оружие падает с боёв", x + 4, top + 34);
      return;
    }
    const slice = this.warehouse.slice(this.whPage * WH_PER_PAGE, (this.whPage + 1) * WH_PER_PAGE);
    slice.forEach((wp, i) => {
      const cx = x + (i % WH_COLS) * (cw + 8);
      const cy = top + Math.floor(i / WH_COLS) * (ch + 8);
      this.warehouseCell(ctx, wp, cx, cy, cw, ch);
    });
  }

  private warehouseCell(ctx: CanvasRenderingContext2D, wp: WarehouseWeapon, x: number, y: number, w: number, h: number): void {
    const d = weaponDef(wp.cls, wp.tier);
    const eq = this.equippedIds.left === wp.id ? "в левой" : this.equippedIds.right === wp.id ? "в правой" : "";
    const wd = this.add({
      id: `wh:${wp.id}`, x, y, w, h, kind: "cell",
      info: [`${d.name}${wp.affixes.length ? ` (${wp.quality})` : ""} — нажми: действия`, wp.affixes.join(", ") || "без роллов"],
      act: () => this.openWarehousePopup(wp),
    });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || TIER_BG[wp.tier];
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = st.stroke || TIER_COLOR[wp.tier];
    ctx.lineWidth = st.stroke ? st.lw : 1.5;
    ctx.strokeRect(x, y, w, h);
    this.drawWeaponIcon(ctx, wp.cls, wp.tier, x + 6, y + 8, 52);
    ctx.font = "bold 17px system-ui, sans-serif";
    ctx.fillStyle = TIER_COLOR[wp.tier];
    ctx.fillText(this.shortName(d.name), x + 62, y + 8);
    if (wp.affixes.length) {
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.fillStyle = "#f2c74b";
      ctx.fillText(`(${wp.quality})`, x + 62, y + 36);
    }
    if (eq) {
      ctx.font = "16px system-ui, sans-serif";
      ctx.fillStyle = "#7ee081";
      ctx.fillText(eq, x + 8, y + h - 24);
    }
  }

  private shortName(n: string): string {
    return n.length > 12 ? `${n.slice(0, 11)}…` : n;
  }

  // ---- всплывающие меню действий ----

  private scrapGain(wp: WarehouseWeapon): number {
    return (wp.tier === "legendary" ? 10 : wp.tier === "gold" ? 1 : 0) + wp.affixes.length;
  }

  private sideName(side: Side, gen: "hand" | "shoulder", acc: boolean): string {
    // «левую руку / левое плечо», «правую руку / правое плечо»
    const l = side === "left";
    if (gen === "hand") return acc ? (l ? "левую руку" : "правую руку") : l ? "левая рука" : "правая рука";
    return l ? "левое плечо" : "правое плечо";
  }

  private openWarehousePopup(wp: WarehouseWeapon): void {
    const d = weaponDef(wp.cls, wp.tier);
    const isBow = wp.cls === "bow";
    const send = (a: MenuAction): void => {
      this.popup = null;
      this.focusId = `wh:${wp.id}`;
      this.onAction?.(a);
    };
    const base = { id: wp.id, cls: wp.cls, tier: wp.tier };
    const buttons: Popup["buttons"] = [];
    if (isBow) {
      buttons.push({ id: "pop:handL", label: "Взять в руки", hint: "лук занимает обе руки, остальное — на склад", color: "#7ee081", act: () => send({ act: "whToHand", side: "left", ...base }) });
    } else {
      buttons.push({ id: "pop:handL", label: "В левую руку", hint: "что в ней — на склад", color: "#7ee081", act: () => send({ act: "whToHand", side: "left", ...base }) });
      buttons.push({ id: "pop:handR", label: "В правую руку", hint: "что в ней — на склад", color: "#7ee081", act: () => send({ act: "whToHand", side: "right", ...base }) });
    }
    buttons.push({ id: "pop:backL", label: "За левое плечо", hint: "что там было — на склад", color: "#9fd0ff", act: () => send({ act: "whToBack", side: "left", ...base }) });
    buttons.push({ id: "pop:backR", label: "За правое плечо", hint: "что там было — на склад", color: "#9fd0ff", act: () => send({ act: "whToBack", side: "right", ...base }) });
    buttons.push({ id: "pop:drop", label: "Скинуть на землю", color: "#ffd166", act: () => send({ act: "drop", ...base }) });
    buttons.push({ id: "pop:scrap", label: "Разобрать", hint: `+${this.scrapGain(wp)} лома, предмет исчезнет`, color: "#ff9a9a", act: () => send({ act: "scrap", ...base }) });
    buttons.push({ id: "pop:cancel", label: "Отмена", color: "#8c96ad", act: () => this.closePopup() });
    this.popup = {
      title: `${d.name}${wp.affixes.length ? ` (${wp.quality})` : ""}`,
      sub: wp.affixes.join(", ") || "без роллов",
      color: TIER_COLOR[wp.tier],
      buttons,
    };
    this.focusId = "pop:handL";
  }

  /** Меню над оружием в руке / за спиной: склад, либо перенос на ту же сторону (рука ↔ плечо), с обменом. */
  private openHeldPopup(src: "hand" | "back", side: Side, w: WornWeapon, hero: HeroStats): void {
    const d = weaponDef(w.cls, w.tier);
    const q = src === "hand" ? this.handQuality(w, side) : undefined;
    const stats = weaponStats(w, hero).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ");
    const done = (a: MenuAction): void => {
      this.popup = null;
      this.focusId = `${src}:${side}`;
      this.onAction?.(a);
    };
    const buttons: Popup["buttons"] = [
      {
        id: "pop:store",
        label: "Убрать на склад",
        hint: "оружие останется у персонажа",
        color: "#7ee081",
        act: () => done({ act: "toWarehouse", src, side }),
      },
    ];
    if (src === "hand") {
      const occupied = this.stowed.some((x) => x.side === side);
      buttons.push({
        id: "pop:move",
        label: `За ${this.sideName(side, "shoulder", true)}`,
        hint: occupied ? "там уже лежит — поменяются местами" : "на то же плечо, что и рука",
        color: "#9fd0ff",
        act: () => done({ act: "handToBack", side }),
      });
    } else {
      const occupied = side === "left" ? !!this.leftHand || this.rightHand?.cls === "bow" : !!this.rightHand || this.leftHand?.cls === "bow";
      buttons.push({
        id: "pop:move",
        label: `В ${this.sideName(side, "hand", true)}`,
        hint: occupied ? "там уже оружие — поменяются местами" : "в ту же сторону, что и плечо",
        color: "#9fd0ff",
        act: () => done({ act: "backToHand", side }),
      });
    }
    buttons.push({ id: "pop:cancel", label: "Отмена", color: "#8c96ad", act: () => this.closePopup() });
    this.popup = {
      title: `${d.name}${q ? ` (${q})` : ""}`,
      sub: w.affix || stats || (src === "hand" ? "в руке" : "за спиной"),
      color: TIER_COLOR[w.tier],
      buttons,
    };
    this.focusId = "pop:store";
  }

  private closePopup(): void {
    this.popup = null;
  }

  private wrapText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxW: number,
    lh: number,
    maxLines: number,
  ): void {
    const words = text.split(" ");
    let line = "";
    let ln = 0;
    for (let i = 0; i < words.length; i++) {
      const test = line ? `${line} ${words[i]}` : words[i];
      if (ctx.measureText(test).width > maxW && line) {
        ctx.fillText(line, x, y + ln * lh);
        ln++;
        if (ln >= maxLines) return;
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y + ln * lh);
  }

  // ---- иконки ----

  private drawItemIcon(ctx: CanvasRenderingContext2D, file: string, tint: readonly number[], x: number, y: number, s: number): void {
    if (!file) {
      ctx.fillStyle = `rgb(${tint.map((c) => Math.round(c * 255)).join(",")})`;
      ctx.fillRect(x + s * 0.2, y + s * 0.2, s * 0.6, s * 0.6);
      return;
    }
    const cached = this.imgs.get(file);
    if (cached) {
      ctx.drawImage(cached, x, y, s, s);
      return;
    }
    if (cached === undefined) {
      this.imgs.set(file, null);
      const img = new Image();
      img.onload = () => {
        this.imgs.set(file, img);
        this.dirty = true;
      };
      img.src = `/icons/${file}`;
    }
    ctx.fillStyle = `rgb(${tint.map((c) => Math.round(c * 255)).join(",")})`;
    ctx.fillRect(x + s * 0.25, y + s * 0.25, s * 0.5, s * 0.5);
  }

  /** Значок оружия по классу: рисуем сами — у уникального и базового картинок нет. */
  private drawWeaponIcon(ctx: CanvasRenderingContext2D, cls: WeaponClass, tier: WeaponTier, x: number, y: number, s: number): void {
    const col = TIER_COLOR[tier];
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const u = s / 100;
    ctx.lineWidth = 7 * u;
    if (cls === "sword") {
      ctx.beginPath();
      ctx.moveTo(78 * u, 12 * u);
      ctx.lineTo(30 * u, 60 * u);
      ctx.stroke();
      ctx.lineWidth = 8 * u;
      ctx.beginPath();
      ctx.moveTo(22 * u, 46 * u);
      ctx.lineTo(48 * u, 72 * u);
      ctx.stroke();
      ctx.lineWidth = 9 * u;
      ctx.beginPath();
      ctx.moveTo(30 * u, 60 * u);
      ctx.lineTo(16 * u, 84 * u);
      ctx.stroke();
    } else if (cls === "bow") {
      ctx.beginPath();
      ctx.arc(34 * u, 50 * u, 36 * u, -Math.PI / 2.3, Math.PI / 2.3);
      ctx.stroke();
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(50 * u, 16 * u);
      ctx.lineTo(50 * u, 84 * u);
      ctx.stroke();
      ctx.lineWidth = 5 * u;
      ctx.beginPath();
      ctx.moveTo(18 * u, 50 * u);
      ctx.lineTo(86 * u, 50 * u);
      ctx.stroke();
    } else if (cls === "staff") {
      ctx.beginPath();
      ctx.moveTo(30 * u, 90 * u);
      ctx.lineTo(62 * u, 34 * u);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(68 * u, 24 * u, 13 * u, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(50 * u, 10 * u);
      ctx.lineTo(84 * u, 22 * u);
      ctx.lineTo(80 * u, 58 * u);
      ctx.quadraticCurveTo(70 * u, 82 * u, 50 * u, 92 * u);
      ctx.quadraticCurveTo(30 * u, 82 * u, 20 * u, 58 * u);
      ctx.lineTo(16 * u, 22 * u);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- вкладка «Настройки» ----

  private drawSettings(ctx: CanvasRenderingContext2D): void {
    let y = VIEW_Y;
    const W = TEX_W - 24;
    const toggle = (id: string, label: string, hint: string, on: boolean, act: () => void): void => {
      const wd = this.add({ id, x: 12, y, w: W, h: 72, kind: "toggle", act, info: [label, hint] });
      const st = this.styleFor(wd);
      ctx.fillStyle = st.fill || "#171b26";
      ctx.fillRect(wd.x, y, wd.w, wd.h);
      ctx.strokeStyle = st.stroke || "#2c3446";
      ctx.lineWidth = st.lw;
      ctx.strokeRect(wd.x, y, wd.w, wd.h);
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.fillStyle = "#e8ecf8";
      ctx.fillText(label, 28, y + 8);
      ctx.font = "19px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(hint, 28, y + 42);
      // Переключатель.
      const tx = TEX_W - 150;
      ctx.fillStyle = on ? "#2f7a3a" : "#3a4258";
      ctx.fillRect(tx, y + 14, 92, 44);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(on ? tx + 50 : tx + 4, y + 18, 38, 36);
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.fillStyle = on ? "#9fffb0" : "#aab4cc";
      ctx.textAlign = "right";
      ctx.fillText(on ? "ВКЛ" : "ВЫКЛ", tx - 12, y + 24);
      ctx.textAlign = "left";
      y += 82;
    };
    toggle("set:vignette", "Виньетка при движении", "затемняет края, меньше укачивает", VR_SETTINGS.vignette, () =>
      setVrSettings({ vignette: !VR_SETTINGS.vignette }),
    );
    toggle("set:teleport", "Перемещение телепортом", "вместо плавного хода стиком", VR_SETTINGS.teleport, () =>
      setVrSettings({ teleport: !VR_SETTINGS.teleport }),
    );

    const slider = (id: string, label: string, val: number, set: (v: number) => void): void => {
      const wd = this.add({
        id, x: 12, y, w: W, h: 92, kind: "slider", val, set: (v) => set(v),
        info: [label, `${Math.round(val * 100)}%`],
      });
      const st = this.styleFor(wd);
      ctx.fillStyle = st.fill || "#171b26";
      ctx.fillRect(wd.x, y, wd.w, wd.h);
      ctx.strokeStyle = st.stroke || "#2c3446";
      ctx.lineWidth = st.lw;
      ctx.strokeRect(wd.x, y, wd.w, wd.h);
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.fillStyle = "#e8ecf8";
      ctx.fillText(label, 28, y + 8);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffd166";
      ctx.fillText(`${Math.round(val * 100)}%`, TEX_W - 40, y + 8);
      ctx.textAlign = "left";
      // Дорожка на всю ширину виджета (значение считается по нажатию на неё).
      const ty = y + 62;
      ctx.fillStyle = "#2a3040";
      ctx.fillRect(wd.x + 14, ty, wd.w - 28, 12);
      ctx.fillStyle = "#4a9be8";
      ctx.fillRect(wd.x + 14, ty, (wd.w - 28) * val, 12);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(wd.x + 14 + (wd.w - 28) * val, ty + 6, 15, 0, Math.PI * 2);
      ctx.fill();
      y += 102;
    };
    slider("set:music", "Громкость музыки", VR_SETTINGS.music, (v) => setVrSettings({ music: v }));
    slider("set:sfx", "Громкость эффектов", VR_SETTINGS.sfx, (v) => setVrSettings({ sfx: v }));

    toggle("set:mic", "Микрофон", "твой голос слышат другие игроки", VR_SETTINGS.mic, () =>
      setVrSettings({ mic: !VR_SETTINGS.mic }),
    );
    toggle("set:spatial", "Звук голоса по месту", "голоса игроков слышны от их положения; выкл — ровно", VR_SETTINGS.spatial, () =>
      setVrSettings({ spatial: !VR_SETTINGS.spatial }),
    );
    toggle("set:pvp", "PvP с игроками", "тебя смогут атаковать другие игроки с PvP", this.pvpOn, () => this.onTogglePvp?.());
  }
}
