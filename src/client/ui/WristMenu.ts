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
const TEX_W = 640;
const TEX_H = 960;
const PLANE_W = 0.3;

/** Вертикальная раскладка: вкладки, окно прокручиваемого содержимого, строка описания, «Выйти». */
const TAB_Y = 8;
const TAB_H = 56;
const VIEW_Y = 76;
const VIEW_H = 736;
const INFO_Y = 818;
const EXIT_Y = 886;
const EXIT_H = 58;

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

/** Кликабельная область. Координаты — внутри прокручиваемого окна (fixed=false) или экрана (fixed=true). */
interface Widget {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: Kind;
  fixed: boolean;
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

/**
 * Меню на левой руке (VR): вкладки «Персонаж» и «Настройки», внизу всегда
 * видна кнопка «Выйти из игры» (спрашивает, оставить ли героя ботом).
 * Управление: левый стик (выбор), кнопка подтверждения, либо лазер правой
 * руки, когда её поднесли к меню, и курок.
 */
export class WristMenu {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private readonly laser: LinesMesh;
  private laserPts: Vector3[] = [new Vector3(), new Vector3(0, 0, 1)];
  private open = false;
  private tab: Tab = "char";
  private scroll = 0;
  private contentH = VIEW_H;
  private focusId = "tab:char";
  private hoverId = "";
  private dialog = false;
  private dirty = true;
  private lastDraw = 0;
  private prevTrigger = false;
  private dragSlider: string | null = null;
  private widgets: Widget[] = [];

  /** Игрок подтвердил выход: keepBot — оставить героя ботом. Ставит Game. */
  onExit: ((keepBot: boolean) => void) | null = null;
  onTogglePvp: (() => void) | null = null;

  private pvpOn = false;
  private leaveBotOn = false;
  private rightHand: WornWeapon | null = null;
  private leftHand: WornWeapon | null = null;
  private stowed: (WornWeapon & { side: "left" | "right" })[] = [];
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
    this.plane.position.set(0, 0.2, 0);
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

  setStowed(list: (WornWeapon & { side: "left" | "right" })[]): void {
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

  /** Текущее значение «оставить бота» — подсвечивается по умолчанию в вопросе при выходе. */
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

    if (o.tabNext && !this.dialog) this.switchTab(this.tab === "char" ? "set" : "char");

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
          w.act?.();
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
    if (o.confirm) this.widgets.find((w) => w.id === this.focusId)?.act?.();

    // Перерисовка не чаще ~25 раз/с: 640×960 текстура заметно дороже обычной.
    const now = performance.now();
    if (this.dirty && now - this.lastDraw > 40) {
      this.lastDraw = now;
      this.dirty = false;
      this.redraw();
    }
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

  private screenY(w: Widget): number {
    return w.fixed ? w.y : w.y + VIEW_Y - this.scroll;
  }

  private widgetAt(u: number, v: number): Widget | null {
    // Верхние (фиксированные) — первыми: они рисуются поверх содержимого.
    for (let i = this.widgets.length - 1; i >= 0; i--) {
      const w = this.widgets[i];
      if (this.dialog && !w.id.startsWith("dlg:")) continue;
      const y = this.screenY(w);
      if (u < w.x || u > w.x + w.w || v < y || v > y + w.h) continue;
      // Содержимое видно только в окне прокрутки.
      if (!w.fixed && (v < VIEW_Y || v > VIEW_Y + VIEW_H)) continue;
      return w;
    }
    return null;
  }

  private focus(id: string): void {
    if (this.focusId === id) return;
    this.focusId = id;
    this.ensureVisible();
    this.dirty = true;
  }

  private ensureVisible(): void {
    const w = this.widgets.find((x) => x.id === this.focusId);
    if (!w || w.fixed) return;
    if (w.y < this.scroll) this.scroll = Math.max(0, w.y - 12);
    else if (w.y + w.h > this.scroll + VIEW_H) this.scroll = Math.min(this.maxScroll(), w.y + w.h - VIEW_H + 12);
  }

  private maxScroll(): number {
    return Math.max(0, this.contentH - VIEW_H);
  }

  private switchTab(t: Tab): void {
    if (this.tab === t) return;
    this.tab = t;
    this.scroll = 0;
    this.focusId = `tab:${t}`;
    this.dirty = true;
    this.redraw(); // виджеты новой вкладки нужны сразу
  }

  /** Перемещение фокуса стиком: по геометрии; на слайдере ←/→ меняют значение; на вкладках — переключают. */
  private navigate(dx: number, dy: number): void {
    const cur = this.widgets.find((w) => w.id === this.focusId);
    const list = this.widgets.filter((w) => (this.dialog ? w.id.startsWith("dlg:") : !w.id.startsWith("dlg:")));
    if (!cur) {
      this.focusId = list[0]?.id ?? "";
      this.dirty = true;
      return;
    }
    if (dx !== 0 && cur.kind === "slider" && cur.set) {
      cur.set(Math.max(0, Math.min(1, (cur.val ?? 0) + dx * 0.1)));
      this.dirty = true;
      return;
    }
    if (dx !== 0 && cur.kind === "tab") {
      this.switchTab(dx > 0 ? "set" : "char");
      return;
    }
    const cx = cur.x + cur.w / 2;
    const cy = this.screenY(cur) + cur.h / 2;
    let best: Widget | null = null;
    let bestScore = Infinity;
    for (const w of list) {
      if (w === cur) continue;
      const wx = w.x + w.w / 2;
      const wy = this.screenY(w) + w.h / 2;
      const ddx = wx - cx;
      const ddy = wy - cy;
      let score: number;
      if (dy !== 0) {
        if (Math.sign(ddy) !== dy || Math.abs(ddy) < 6) continue;
        score = Math.abs(ddy) + Math.abs(ddx) * 0.6;
      } else {
        if (Math.sign(ddx) !== dx || Math.abs(ddx) < 6 || Math.abs(ddy) > 46) continue;
        score = Math.abs(ddx) + Math.abs(ddy) * 2;
      }
      if (score < bestScore) {
        bestScore = score;
        best = w;
      }
    }
    if (best) this.focus(best.id);
  }

  private setSliderFromU(w: Widget, u: number): void {
    // Дорожка нарисована с отступом 14 px по краям виджета.
    w.set?.(Math.max(0, Math.min(1, (u - (w.x + 14)) / (w.w - 28))));
    this.dirty = true;
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

    // Содержимое (прокручиваемое) строим первым — его высота нужна для прокрутки.
    ctx.save();
    ctx.beginPath();
    ctx.rect(4, VIEW_Y, TEX_W - 8, VIEW_H);
    ctx.clip();
    ctx.translate(0, VIEW_Y - this.scroll);
    this.contentH = this.tab === "char" ? this.drawCharacter(ctx) : this.drawSettings(ctx);
    ctx.restore();
    if (this.scroll > this.maxScroll()) this.scroll = this.maxScroll();
    this.drawScrollBar(ctx);

    this.drawTabs(ctx);
    this.drawInfo(ctx);
    this.drawExit(ctx);
    if (this.dialog) this.drawExitDialog(ctx);

    // Первый запуск / после смены вкладки — фокус на существующем виджете.
    if (!this.widgets.some((w) => w.id === this.focusId)) {
      this.focusId = this.dialog ? "dlg:cancel" : `tab:${this.tab}`;
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
    const w = (TEX_W - 24) / 2;
    tabs.forEach(([id, label], i) => {
      const wd = this.add({
        id: `tab:${id}`, x: 12 + i * w, y: TAB_Y, w: w - 6, h: TAB_H, kind: "tab", fixed: true,
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
      ctx.font = `${active ? "bold " : ""}30px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(label, wd.x + wd.w / 2, wd.y + 12);
      ctx.textAlign = "left";
    });
  }

  private drawScrollBar(ctx: CanvasRenderingContext2D): void {
    if (this.contentH <= VIEW_H) return;
    const trackH = VIEW_H - 8;
    const barH = Math.max(40, (VIEW_H / this.contentH) * trackH);
    const y = VIEW_Y + 4 + (this.scroll / this.maxScroll()) * (trackH - barH);
    ctx.fillStyle = "#3a4258";
    ctx.fillRect(TEX_W - 12, y, 6, barH);
  }

  private drawInfo(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "#171b26";
    ctx.fillRect(12, INFO_Y, TEX_W - 24, 62);
    const f = this.widgets.find((w) => w.id === this.focusId);
    const [a, b] = f?.info ?? ["", ""];
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillStyle = "#dbe2f2";
    ctx.fillText(a || "Стик — выбор · B — нажать · X — вкладка", 22, INFO_Y + 6);
    ctx.font = "19px system-ui, sans-serif";
    ctx.fillStyle = "#8c96ad";
    ctx.fillText(b, 22, INFO_Y + 34);
  }

  private drawExit(ctx: CanvasRenderingContext2D): void {
    const wd = this.add({
      id: "exit", x: 12, y: EXIT_Y, w: TEX_W - 24, h: EXIT_H, kind: "button", fixed: true,
      act: () => {
        this.dialog = true;
        this.focusId = "dlg:cancel";
        this.dirty = true;
      },
    });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || "#2a2036";
    ctx.fillRect(wd.x, wd.y, wd.w, wd.h);
    ctx.strokeStyle = st.stroke || "#7a4a5a";
    ctx.lineWidth = st.lw;
    ctx.strokeRect(wd.x, wd.y, wd.w, wd.h);
    ctx.fillStyle = "#ffb0b0";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Выйти из игры", wd.x + wd.w / 2, wd.y + 13);
    ctx.textAlign = "left";
  }

  private drawExitDialog(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = "rgba(6,8,12,.82)";
    ctx.fillRect(4, 4, TEX_W - 8, TEX_H - 8);
    const x = 40;
    const w = TEX_W - 80;
    ctx.fillStyle = "#171b26";
    ctx.fillRect(x, 250, w, 460);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 3;
    ctx.strokeRect(x, 250, w, 460);
    ctx.fillStyle = "#e8ecf8";
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Выйти из игры?", TEX_W / 2, 276);
    ctx.font = "24px system-ui, sans-serif";
    ctx.fillStyle = "#aab4cc";
    ctx.fillText("Оставить героя ботом в мире?", TEX_W / 2, 330);
    ctx.textAlign = "left";

    const btn = (id: string, y: number, label: string, sub: string, color: string, act: () => void): void => {
      const wd = this.add({ id, x: x + 24, y, w: w - 48, h: 92, kind: "button", fixed: true, act });
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
    btn("dlg:keep", 372, "Оставить бота", this.leaveBotOn ? "герой продолжит играть сам · как раньше" : "герой продолжит играть сам", "#7ee081", () => {
      this.dialog = false;
      this.onExit?.(true);
    });
    btn("dlg:drop", 480, "Не оставлять", this.leaveBotOn ? "герой исчезнет из мира" : "герой исчезнет из мира · как раньше", "#ffd166", () => {
      this.dialog = false;
      this.onExit?.(false);
    });
    btn("dlg:cancel", 588, "Отмена", "вернуться в игру", "#9fb2d8", () => {
      this.dialog = false;
      this.focusId = "exit";
      this.dirty = true;
    });
  }

  // ---- вкладка «Персонаж» ----

  private drawCharacter(ctx: CanvasRenderingContext2D): number {
    const p = this.prog;
    const hero = this.hero();
    let y = 4;

    // Уровень и опыт.
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(`Ур. ${p.level}`, 20, y);
    const need = p.xpToNext();
    const frac = p.atMaxLevel ? 1 : Math.min(1, p.xp / need);
    ctx.font = "22px system-ui, sans-serif";
    ctx.fillStyle = "#c9d2e6";
    ctx.textAlign = "right";
    ctx.fillText(p.atMaxLevel ? "максимальный уровень" : `опыт ${Math.floor(p.xp)} / ${Math.round(need)}`, TEX_W - 24, y + 8);
    ctx.textAlign = "left";
    y += 46;
    ctx.fillStyle = "#242a38";
    ctx.fillRect(20, y, TEX_W - 44, 18);
    ctx.fillStyle = "#4a9be8";
    ctx.fillRect(20, y, (TEX_W - 44) * frac, 18);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 2;
    ctx.strokeRect(20, y, TEX_W - 44, 18);
    y += 34;

    // Характеристики.
    for (const s of STATS) {
      const canSpend = p.unspent > 0;
      const wd = this.add({
        id: `stat:${s}`, x: 12, y, w: TEX_W - 36, h: 48, kind: "button", fixed: false,
        act: () => {
          if (p.spend(s)) this.dirty = true;
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
      ctx.font = "28px system-ui, sans-serif";
      ctx.fillText(STAT_LABELS[s], 24, y + 9);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.fillText(String(p.stats[s]), 250, y + 9);
      ctx.font = "19px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(this.statHint(s), 310, y + 14);
      if (canSpend) {
        ctx.fillStyle = "#2f7a3a";
        ctx.fillRect(TEX_W - 92, y + 6, 56, 36);
        ctx.fillStyle = "#e9ffe9";
        ctx.font = "bold 30px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("+", TEX_W - 64, y + 8);
        ctx.textAlign = "left";
      }
      y += 52;
    }
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillStyle = p.unspent > 0 ? "#7ee081" : "#6b7488";
    ctx.fillText(`Свободных очков: ${p.unspent}`, 20, y + 2);
    y += 40;

    // В руках — отдельная панель.
    y = this.section(ctx, "В РУКАХ", y);
    const hands: [string, WornWeapon | null, "left" | "right"][] = [
      ["Правая рука", this.rightHand, "right"],
      ["Левая рука", this.leftHand, "left"],
    ];
    hands.forEach(([label, w, side], i) => {
      this.weaponCard(ctx, `hand:${side}`, 12 + i * 312, y, 306, 128, label, w, hero, this.handQuality(w, side));
    });
    y += 138;

    // За спиной.
    y = this.section(ctx, "ЗА СПИНОЙ", y);
    (["right", "left"] as const).forEach((side, i) => {
      const s = this.stowed.find((x) => x.side === side) ?? null;
      const label = side === "right" ? "Правое плечо" : "Левое плечо";
      this.weaponCard(ctx, `back:${side}`, 12 + i * 312, y, 306, 100, label, s, hero, undefined);
    });
    y += 110;

    // Сумка.
    y = this.section(ctx, "СУМКА", y);
    const cw = 146;
    const ch = 78;
    for (let i = 0; i < BAG.slots; i++) {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 12 + col * (cw + 8);
      const cy = y + row * (ch + 8);
      this.bagCell(ctx, i, x, cy, cw, ch);
    }
    y += Math.ceil(BAG.slots / 4) * (ch + 8) + 8;

    // Склад оружия.
    y = this.section(ctx, `СКЛАД ОРУЖИЯ (${this.warehouse.length})`, y);
    if (this.warehouse.length === 0) {
      ctx.font = "22px system-ui, sans-serif";
      ctx.fillStyle = "#6b7488";
      ctx.fillText("пусто — золотое и уникальное оружие падает с боёв", 20, y + 4);
      y += 40;
    }
    for (const w of this.warehouse) {
      this.warehouseRow(ctx, w, y);
      y += 74;
    }

    // Кулдаун умения — в конце.
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillStyle = "#8c96ad";
    ctx.fillText("Умение оружия", 20, y + 6);
    ctx.fillStyle = this.skillCd < 0 ? "#6b7488" : this.skillCd <= 0.001 ? "#7ee081" : "#ffd166";
    ctx.fillText(
      this.skillCd < 0 ? "нет (нужен меч или лук)" : this.skillCd <= 0.001 ? "готово — нажми стик" : "перезарядка…",
      260,
      y + 6,
    );
    return y + 44;
  }

  private section(ctx: CanvasRenderingContext2D, title: string, y: number): number {
    ctx.strokeStyle = "#3a4258";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(20, y + 2);
    ctx.lineTo(TEX_W - 20, y + 2);
    ctx.stroke();
    ctx.font = "bold 24px system-ui, sans-serif";
    ctx.fillStyle = "#e8ecf8";
    ctx.fillText(title, 20, y + 10);
    return y + 44;
  }

  private statHint(s: StatName): string {
    const p = this.prog;
    if (s === "str") return `HP ${Math.round(p.maxHp)} · урон ×${p.swordDamage.toFixed(2)}`;
    if (s === "agi") return `бег ${p.moveSpeed.toFixed(2)} м/с`;
    return `огнешар ${p.fireboltMax.toFixed(1)} · хил ${Math.round(p.healMax)}`;
  }

  /** Очки роллов оружия в руке: по закреплённому инстансу, иначе лучший этого класса/тира. */
  private handQuality(w: WornWeapon | null, side: "left" | "right"): number | undefined {
    if (!w || w.tier === "base") return undefined;
    const id = this.equippedIds[side];
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
  ): void {
    let info: [string, string] = [label, "пусто"];
    if (item) {
      const d = weaponDef(item.cls, item.tier);
      const stats = weaponStats(item, hero);
      info = [
        `${d.name}${quality ? ` (${quality})` : ""}`,
        stats.slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ") || (item.affix ?? ""),
      ];
    }
    const wd = this.add({ id, x, y, w, h, kind: "card", fixed: false, info });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || (item ? TIER_BG[item.tier] : "#161a24");
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = st.stroke || (item ? TIER_COLOR[item.tier] : "#2c3446");
    ctx.lineWidth = st.stroke ? st.lw : 2;
    ctx.strokeRect(x, y, w, h);

    ctx.font = "18px system-ui, sans-serif";
    ctx.fillStyle = "#7c88a4";
    ctx.fillText(label, x + 10, y + 6);
    if (!item) {
      ctx.font = "24px system-ui, sans-serif";
      ctx.fillStyle = "#4d566c";
      ctx.fillText("пусто", x + 10, y + h / 2 - 6);
      return;
    }
    const iconS = h > 110 ? 76 : 60;
    this.drawWeaponIcon(ctx, item.cls, item.tier, x + 10, y + 30, iconS);
    const d = weaponDef(item.cls, item.tier);
    ctx.font = "bold 23px system-ui, sans-serif";
    ctx.fillStyle = TIER_COLOR[item.tier];
    ctx.fillText(d.name, x + iconS + 20, y + 30);
    if (quality) {
      ctx.fillStyle = "#f2c74b";
      ctx.fillText(`(${quality})`, x + iconS + 20, y + 56);
    }
    if (item.affix) {
      ctx.font = "17px system-ui, sans-serif";
      ctx.fillStyle = "#7db8ff";
      this.wrapText(ctx, item.affix, x + iconS + 20, y + (quality ? 82 : 60), w - iconS - 30, 20, h > 110 ? 2 : 1);
    }
  }

  private bagCell(ctx: CanvasRenderingContext2D, i: number, x: number, y: number, w: number, h: number): void {
    const slot = this.inv.slots[i];
    const def = slot?.item ? ITEMS[slot.item] : null;
    const info: [string, string] = def
      ? [def.name, def.heal > 0 ? `лечит +${def.heal} HP · нажми, чтобы выпить` : `в сумке ×${slot.count}`]
      : ["Пустая ячейка", ""];
    const wd = this.add({
      id: `bag:${i}`, x, y, w, h, kind: "cell", fixed: false, info,
      act: () => {
        if (this.inv.use(i)) this.dirty = true;
      },
    });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || "#1a1f2b";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = st.stroke || (def ? "#5a6480" : "#333c50");
    ctx.lineWidth = st.stroke ? st.lw : 2;
    ctx.strokeRect(x, y, w, h);
    if (!def) return;
    this.drawItemIcon(ctx, def.icon, def.tint, x + 8, y + 10, 56);
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(`×${slot.count}`, x + 72, y + 14);
    ctx.font = "17px system-ui, sans-serif";
    ctx.fillStyle = "#9fb2d8";
    ctx.fillText(def.short, x + 72, y + 46);
  }

  private warehouseRow(ctx: CanvasRenderingContext2D, w: WarehouseWeapon, y: number): void {
    const d = weaponDef(w.cls, w.tier);
    const eq =
      this.equippedIds.left === w.id ? "в левой" : this.equippedIds.right === w.id ? "в правой" : "";
    const wd = this.add({
      id: `wh:${w.id}`, x: 12, y, w: TEX_W - 36, h: 68, kind: "card", fixed: false,
      info: [`${d.name}${w.affixes.length ? ` (${w.quality})` : ""}`, w.affixes.join(", ") || "без роллов"],
    });
    const st = this.styleFor(wd);
    ctx.fillStyle = st.fill || TIER_BG[w.tier];
    ctx.fillRect(wd.x, y, wd.w, wd.h);
    ctx.strokeStyle = st.stroke || TIER_COLOR[w.tier];
    ctx.lineWidth = st.stroke ? st.lw : 1;
    ctx.strokeRect(wd.x, y, wd.w, wd.h);
    this.drawWeaponIcon(ctx, w.cls, w.tier, 20, y + 6, 56);
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.fillStyle = TIER_COLOR[w.tier];
    ctx.fillText(d.name, 88, y + 6);
    if (w.affixes.length) {
      ctx.fillStyle = "#f2c74b";
      ctx.fillText(`(${w.quality})`, 88 + ctx.measureText(d.name).width + 10, y + 6);
    }
    if (eq) {
      ctx.font = "17px system-ui, sans-serif";
      ctx.fillStyle = "#7ee081";
      ctx.textAlign = "right";
      ctx.fillText(eq, TEX_W - 34, y + 8);
      ctx.textAlign = "left";
    }
    ctx.font = "17px system-ui, sans-serif";
    ctx.fillStyle = "#7db8ff";
    this.wrapText(ctx, w.affixes.join(", ") || "без роллов", 88, y + 36, TEX_W - 130, 20, 1);
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

  private drawSettings(ctx: CanvasRenderingContext2D): number {
    let y = 8;
    const toggle = (id: string, label: string, hint: string, on: boolean, act: () => void): void => {
      const wd = this.add({ id, x: 12, y, w: TEX_W - 36, h: 78, kind: "toggle", fixed: false, act, info: [label, hint] });
      const st = this.styleFor(wd);
      ctx.fillStyle = st.fill || "#171b26";
      ctx.fillRect(wd.x, y, wd.w, wd.h);
      ctx.strokeStyle = st.stroke || "#2c3446";
      ctx.lineWidth = st.lw;
      ctx.strokeRect(wd.x, y, wd.w, wd.h);
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.fillStyle = "#e8ecf8";
      ctx.fillText(label, 26, y + 10);
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(hint, 26, y + 46);
      // Переключатель.
      const tx = TEX_W - 130;
      ctx.fillStyle = on ? "#2f7a3a" : "#3a4258";
      ctx.fillRect(tx, y + 18, 84, 42);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(on ? tx + 46 : tx + 4, y + 22, 34, 34);
      y += 90;
    };
    toggle("set:vignette", "Виньетка при движении", "затемняет края, меньше укачивает", VR_SETTINGS.vignette, () =>
      setVrSettings({ vignette: !VR_SETTINGS.vignette }),
    );
    toggle("set:teleport", "Перемещение телепортом", "вместо плавного хода стиком", VR_SETTINGS.teleport, () =>
      setVrSettings({ teleport: !VR_SETTINGS.teleport }),
    );

    const slider = (id: string, label: string, val: number, set: (v: number) => void): void => {
      const wd = this.add({
        id, x: 12, y, w: TEX_W - 36, h: 92, kind: "slider", fixed: false, val, set: (v) => set(v),
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
      ctx.fillText(label, 26, y + 8);
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
      y += 104;
    };
    slider("set:music", "Громкость музыки", VR_SETTINGS.music, (v) => setVrSettings({ music: v }));
    slider("set:sfx", "Громкость эффектов", VR_SETTINGS.sfx, (v) => setVrSettings({ sfx: v }));

    toggle("set:pvp", "PvP с игроками", "тебя смогут атаковать другие игроки с PvP", this.pvpOn, () => this.onTogglePvp?.());
    return y + 8;
  }
}
