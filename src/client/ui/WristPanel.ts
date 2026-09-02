import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { STAT_LABELS, type Progression, type StatName } from "../player/Progression";
import { BAG, ITEMS, type Inventory } from "../player/Inventory";

const STATS: StatName[] = ["str", "agi", "int"];
const TEX_W = 512;
const TEX_H = 664;
/**
 * Выбираемых строк: характеристики + ячейки сумки + «PvP» + «выйти из мира».
 * X идёт по ним подряд.
 */
const ROWS = STATS.length + BAG.slots + 2;
const PVP_ROW = STATS.length + BAG.slots;
const EXIT_ROW = ROWS - 1;
const GRID_COLS = 4;

/**
 * Информационная панель персонажа на левой руке (VR): характеристики
 * и сумка. Кнопка Y открывает/закрывает, X идёт по строкам (сначала
 * характеристики, потом ячейки сумки), B действует по контексту —
 * вкладывает очко или выпивает зелье.
 */
export class WristPanel {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private selected = 0;
  private open = false;
  /** Секунды, пока строка выхода «взведена» и ждёт второго нажатия B. */
  private exitArmed = 0;
  /** Выйти из мира (вернуться на экран входа). Ставит Game. */
  onExit: (() => void) | null = null;
  /** Переключить свой флаг PvP. Ставит Game. */
  onTogglePvp: (() => void) | null = null;
  /** Текущее состояние флага PvP (из состояния сервера). */
  private pvpOn = false;

  setPvp(on: boolean): void {
    if (on === this.pvpOn) return;
    this.pvpOn = on;
    if (this.open) this.redraw();
  }

  constructor(
    scene: Scene,
    parent: Node,
    private readonly prog: Progression,
    private readonly inv: Inventory,
  ) {
    this.tex = new DynamicTexture("wristTex", { width: TEX_W, height: TEX_H }, scene, false);

    const mat = new StandardMaterial("wristMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex; // читается и в тени
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;

    this.plane = MeshBuilder.CreatePlane(
      "wristPanel",
      { width: 0.26, height: 0.26 * (TEX_H / TEX_W) },
      scene,
    );
    this.plane.material = mat;
    this.plane.parent = parent;
    // Висит над кистью и всегда развёрнута к лицу — текст не зеркалится.
    this.plane.position.set(0, 0.16, 0);
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.renderingGroupId = 2;
    this.plane.setEnabled(false);

    this.redraw();
    const offProg = prog.onChange(() => this.redraw());
    const offInv = inv.onChange(() => this.redraw());
    this.unsub = () => {
      offProg();
      offInv();
    };
  }

  private readonly unsub: () => void;

  get visible(): boolean {
    return this.open;
  }

  /** Узел, к которому сейчас прикреплена панель. */
  get anchor(): Node | null {
    return this.plane.parent;
  }

  /** Перевесить панель (контроллер мог появиться уже после входа в VR). */
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
   * next — следующая строка, confirm — вложить очко / выпить зелье / выйти.
   * dt нужен, чтобы «взведённый» выход сам снимался через пару секунд.
   */
  update(next: boolean, confirm: boolean, dt = 0): void {
    if (!this.open) return;

    if (this.exitArmed > 0) {
      this.exitArmed -= dt;
      if (this.exitArmed <= 0) this.redraw();
    }

    if (next) {
      this.selected = (this.selected + 1) % ROWS;
      this.exitArmed = 0;
      this.redraw();
    }
    if (!confirm) return;

    if (this.selected === PVP_ROW) {
      this.onTogglePvp?.();
      return;
    }
    if (this.selected === EXIT_ROW) {
      // Двойное нажатие: случайно из мира не выкинет.
      if (this.exitArmed > 0) {
        this.exitArmed = 0;
        this.onExit?.();
      } else {
        this.exitArmed = 2.5;
        this.redraw();
      }
      return;
    }
    if (this.selected < STATS.length) {
      if (this.prog.spend(STATS[this.selected])) this.redraw();
    } else if (this.inv.use(this.selected - STATS.length)) {
      this.redraw();
    }
  }

  dispose(): void {
    this.unsub();
    this.plane.dispose();
    this.tex.dispose();
  }

  private redraw(): void {
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    const p = this.prog;

    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 5;
    ctx.strokeRect(3, 3, TEX_W - 6, TEX_H - 6);

    ctx.textBaseline = "top";

    // Заголовок
    ctx.fillStyle = "#e8ecf8";
    ctx.font = "bold 34px system-ui, sans-serif";
    ctx.fillText("ПЕРСОНАЖ", 26, 20);

    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillStyle = "#ffd166";
    ctx.fillText(`Ур. ${p.level}`, TEX_W - 150, 22);

    // Опыт
    const need = p.xpToNext();
    const frac = p.atMaxLevel ? 1 : Math.min(1, p.xp / need);
    const barX = 26;
    const barY = 72;
    const barW = TEX_W - 52;
    ctx.fillStyle = "#242a38";
    ctx.fillRect(barX, barY, barW, 22);
    ctx.fillStyle = "#4a9be8";
    ctx.fillRect(barX, barY, barW * frac, 22);
    ctx.strokeStyle = "#5a6480";
    ctx.lineWidth = 2;
    ctx.strokeRect(barX, barY, barW, 22);

    ctx.font = "22px system-ui, sans-serif";
    ctx.fillStyle = "#c9d2e6";
    ctx.fillText(
      p.atMaxLevel ? "Максимальный уровень" : `Опыт ${p.xp} / ${need}`,
      barX,
      barY + 28,
    );

    // Характеристики
    const rowY = 146;
    const rowH = 46;
    for (let i = 0; i < STATS.length; i++) {
      const s = STATS[i];
      const y = rowY + i * rowH;
      const active = i === this.selected;

      if (active) {
        ctx.fillStyle = "#263048";
        ctx.fillRect(20, y - 6, TEX_W - 40, rowH - 4);
      }
      ctx.fillStyle = active ? "#9fd0ff" : "#c9d2e6";
      ctx.font = `${active ? "bold " : ""}28px system-ui, sans-serif`;
      ctx.fillText(`${active ? "▸ " : "   "}${STAT_LABELS[s]}`, 26, y);
      ctx.fillText(String(p.stats[s]), 262, y);

      ctx.font = "20px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText(this.statHint(s), 310, y + 4);
    }

    // Свободные очки
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillStyle = p.unspent > 0 ? "#7ee081" : "#6b7488";
    ctx.fillText(`Свободных очков: ${p.unspent}`, 26, 296);

    this.drawBag(ctx);

    // PvP
    const pvpActive = this.selected === PVP_ROW;
    const pvpY = 548;
    if (pvpActive) {
      ctx.fillStyle = "#263048";
      ctx.fillRect(20, pvpY - 6, TEX_W - 40, 40);
    }
    ctx.font = `${pvpActive ? "bold " : ""}26px system-ui, sans-serif`;
    ctx.fillStyle = pvpActive ? "#9fd0ff" : "#c9d2e6";
    ctx.fillText(`${pvpActive ? "▸ " : "   "}PvP`, 26, pvpY);
    ctx.fillStyle = this.pvpOn ? "#ff8a8a" : "#7ee081";
    ctx.fillText(this.pvpOn ? "включён" : "выключен", 150, pvpY);
    if (this.pvpOn) {
      ctx.font = "18px system-ui, sans-serif";
      ctx.fillStyle = "#8c96ad";
      ctx.fillText("тебя могут атаковать игроки с PvP", 300, pvpY + 4);
    }

    // Выход из мира
    const exitActive = this.selected === EXIT_ROW;
    const exitY = 598;
    if (exitActive) {
      ctx.fillStyle = this.exitArmed > 0 ? "#4a2230" : "#2a2036";
      ctx.fillRect(20, exitY - 6, TEX_W - 40, 40);
    }
    ctx.font = `${exitActive ? "bold " : ""}26px system-ui, sans-serif`;
    ctx.fillStyle = this.exitArmed > 0 ? "#ff8a8a" : exitActive ? "#ffb0b0" : "#c98a95";
    ctx.fillText(
      this.exitArmed > 0
        ? `${exitActive ? "▸ " : "   "}Нажми B ещё раз — выйти`
        : `${exitActive ? "▸ " : "   "}Выйти из мира`,
      26,
      exitY,
    );

    ctx.font = "19px system-ui, sans-serif";
    ctx.fillStyle = "#79839a";
    ctx.fillText("X — выбрать · B — действие · Y — закрыть", 26, 636);

    // invertY=true — иначе в этой сборке Babylon текстура рисуется вверх ногами.
    this.tex.update(true);
  }

  /** Сетка сумки: 4x2 ячейки, выбранная подсвечена. */
  private drawBag(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = "#3a4258";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(26, 338);
    ctx.lineTo(TEX_W - 26, 338);
    ctx.stroke();

    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillStyle = "#e8ecf8";
    ctx.fillText("СУМКА", 26, 350);

    const cellW = 112;
    const cellH = 68;
    const gapX = 8;
    const gapY = 8;
    const top = 392;

    for (let i = 0; i < BAG.slots; i++) {
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = 26 + col * (cellW + gapX);
      const y = top + row * (cellH + gapY);
      const slot = this.inv.slots[i];
      const active = this.selected === STATS.length + i;

      ctx.fillStyle = active ? "#263048" : "#1a1f2b";
      ctx.fillRect(x, y, cellW, cellH);
      ctx.strokeStyle = active ? "#9fd0ff" : "#333c50";
      ctx.lineWidth = active ? 3 : 2;
      ctx.strokeRect(x, y, cellW, cellH);

      if (!slot.item) continue;
      const def = ITEMS[slot.item];

      ctx.fillStyle = `rgb(${def.tint.map((c) => Math.round(c * 255)).join(",")})`;
      ctx.fillRect(x + 10, y + 12, 18, 18);

      ctx.fillStyle = "#dbe2f2";
      ctx.font = "20px system-ui, sans-serif";
      ctx.fillText(def.short, x + 36, y + 12);

      ctx.fillStyle = "#ffd166";
      ctx.font = "bold 22px system-ui, sans-serif";
      ctx.fillText(`x${slot.count}`, x + 10, y + 38);

      if (def.heal > 0) {
        ctx.fillStyle = "#7ee081";
        ctx.font = "17px system-ui, sans-serif";
        ctx.fillText("выпить", x + 52, y + 40);
      }
    }
  }

  private statHint(s: StatName): string {
    const p = this.prog;
    if (s === "str") return `HP ${Math.round(p.maxHp)} · урон ${p.swordDamage.toFixed(2)}`;
    if (s === "agi") return `бег ${p.moveSpeed.toFixed(2)} м/с · стрела ${p.arrowDamage.toFixed(2)}`;
    return `мана ${Math.round(p.maxMana)} · огнешар ${p.fireboltMax.toFixed(1)} · хил ${Math.round(p.healMax)}`;
  }
}
