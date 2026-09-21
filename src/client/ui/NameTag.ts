import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

// Разрешение текстуры и кегль подняты в ~1.4 раза относительно физического
// размера плашки (BASE_W растёт вместе с ними, planeW считается от их
// отношения) — так плашку можно крупно масштабировать через setScale()
// и она не мылится. Физический размер при этом прежний.
const BASE_W = 448;
const H = 208;
const NAME_FONT = "bold 56px system-ui, sans-serif";
const LVL_FONT = "36px system-ui, sans-serif";
/** Метка бота зрителя перед ником — единственное отличие от живого игрока со стороны. */
const BOT_MARK = "🤖 ";

/**
 * Плашка с именем и уровнем над мобом. Всегда развёрнута к камере
 * и параллельна горизонту (BILLBOARDMODE_Y).
 */
export class NameTag {
  private readonly plane: Mesh;
  private readonly tex: DynamicTexture;
  private baseY: number;
  private readonly halfH: number;

  private readonly W: number;
  private readonly accent: Color3;
  private curName = "";
  private curLevel: number | null = null;
  private curUnspent = false;
  /** Платформа игрока: 0 — нет значка, 1 — ПК, 2 — смартфон, 3 — VR. */
  private platform = 0;

  /**
   * Полоски здоровья и опыта рисуются В ТУ ЖЕ текстуру плашки (раньше это были ещё 4 отдельных меша
   * со своими материалами — 5 отрисовок на героя вместо одной). Перерисовка — только при изменении значений.
   */
  private hpOn = false;
  private hpFrac = 1;
  private xpOn = false;
  private xpHidden = false;
  private xpFrac = 0;
  private curScale = 1;
  /** См. setAlwaysOnTop() — плашка видна сквозь модель, а не только когда та не мешает. */
  private alwaysOnTop = false;

  constructor(
    scene: Scene,
    parent: Node,
    offset: Vector3,
    name: string,
    /** Уровень (вторая строка). null — не рисуется. Меняется через setInfo(). */
    level: number | null,
    accent: Color3 = new Color3(1, 0.86, 0.4),
    /**
     * Бот зрителя, а не живой игрок — оба теперь ходят с одной и той же
     * моделью персонажа (Ф10), со стороны их иначе не отличить.
     */
    private readonly isBot: boolean = false,
  ) {
    this.accent = accent;

    // Ширину закладываем сразу под имя И вторую строку — чтобы смена уровня
    // не требовала пересоздавать текстуру.
    const measure = document.createElement("canvas").getContext("2d")!;
    measure.font = NAME_FONT;
    let textW = measure.measureText((isBot ? BOT_MARK : "") + name).width;
    measure.font = LVL_FONT;
    textW = Math.max(textW, measure.measureText("999 ур.").width);
    const padX = 30;
    this.W = Math.max(BASE_W, Math.ceil(textW + padX * 2 + 16 + (isBot ? 0 : 64))); // запас слева под значок платформы

    this.tex = new DynamicTexture("nameTagTex", { width: this.W, height: H }, scene, false);
    this.tex.hasAlpha = true;
    this.paint(name, level);

    const mat = new StandardMaterial("nameTagMat", scene);
    mat.diffuseTexture = this.tex;
    mat.emissiveTexture = this.tex;
    mat.opacityTexture = this.tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.backFaceCulling = false;

    // Физическую ширину тянем вслед за текстурой — так буквы в мире остаются
    // прежнего размера, плашка просто становится длиннее.
    const planeW = 0.9 * (this.W / BASE_W);
    const height = planeW * (H / this.W);
    this.plane = MeshBuilder.CreatePlane("nameTag", { width: planeW, height }, scene);
    this.plane.material = mat;
    this.plane.parent = parent;
    this.plane.position.copyFrom(offset);
    this.plane.isPickable = false;
    // Группа 0 + проверка глубины: плашку загораживают стены, деревья и пол.
    this.plane.renderingGroupId = 0;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y;

    this.baseY = offset.y;
    this.halfH = height / 2;
  }

  /**
   * Перерисовать содержимое плашки (имя / уровень меняются на лету).
   * `hasUnspent` — есть неизрасходованные очки атрибутов (PlayerState.unspent
   * > 0): красный "!" рядом с уровнем — сигнал зрителю/чату, что боту нужно
   * раздать статы (`!str`/`!dex`/`!int`).
   */
  setInfo(name: string, level: number | null, hasUnspent = false): void {
    if (name === this.curName && level === this.curLevel && hasUnspent === this.curUnspent) return;
    this.paint(name, level, hasUnspent);
  }

  /** Значок платформы слева от ника (у ботов не задаётся). */
  setPlatform(kind: number): void {
    if (kind === this.platform) return;
    this.platform = kind;
    this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  private paint(name: string, level: number | null, hasUnspent = false): void {
    this.curName = name;
    this.curLevel = level;
    this.curUnspent = hasUnspent;
    const W = this.W;
    const ctx = this.tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, W, H);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const nameY = level === null ? H / 2 : H / 2 - 20;
    ctx.fillStyle = "#f2f4fb";
    ctx.font = NAME_FONT;
    // Сам ник — строго по центру плашки. Значок бота цепляем слева от ника,
    // в центровке он не участвует (иначе надпись уезжала вправо).
    ctx.textAlign = "center";
    ctx.fillText(name, W / 2, nameY);
    if (this.isBot) {
      const nameW = ctx.measureText(name).width;
      ctx.textAlign = "right";
      ctx.fillText(BOT_MARK.trim(), W / 2 - nameW / 2 - 8, nameY);
      ctx.textAlign = "center";
    }

    if (this.platform > 0) {
      const nameW = ctx.measureText(name).width;
      drawPlatformIcon(ctx, this.platform, W / 2 - nameW / 2 - 40, nameY, 46);
    }

    if (level !== null) {
      const a = this.accent;
      ctx.fillStyle = `rgb(${a.r * 255},${a.g * 255},${a.b * 255})`;
      ctx.font = LVL_FONT;
      const lvlY = H / 2 + 42;
      const lvlText = `${level} ур.`;
      ctx.fillText(lvlText, W / 2, lvlY);
      if (hasUnspent) {
        // Красный "!" сразу после уровня — не по центру плашки (иначе сдвигал
        // бы текст уровня туда-сюда каждый раз, когда очки появляются/тратятся).
        const lvlW = ctx.measureText(lvlText).width;
        ctx.fillStyle = "#ff3b30";
        ctx.font = "bold 40px system-ui, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("!", W / 2 + lvlW / 2 + 10, lvlY + 1);
        ctx.textAlign = "center";
      }
    }
    this.paintBars(ctx);
    this.tex.update(true);
  }

  /** Полоски над ником — те же положения и пропорции, что были у отдельных мешей. */
  private paintBars(ctx: CanvasRenderingContext2D): void {
    const W = this.W;
    const barW = W * 0.66;
    const cx = W / 2;
    const bar = (yCenter: number, hFill: number, hBg: number, frac: number, fill: string): void => {
      ctx.fillStyle = "rgba(8,8,8,0.65)";
      ctx.fillRect(cx - (barW * 1.06) / 2, yCenter - hBg / 2, barW * 1.06, hBg);
      ctx.fillStyle = fill;
      ctx.fillRect(cx - barW / 2, yCenter - hFill / 2, barW * Math.max(0.004, frac), hFill);
    };
    if (this.xpOn && !this.xpHidden) {
      // центр на 0.92·halfH над серединой плашки
      bar(H * (0.5 - 0.46), W * 0.023, W * 0.023 * 1.6, this.xpFrac, "rgb(158,163,173)");
    }
    if (this.hpOn) {
      const f = this.hpFrac;
      const r = f > 0.5 ? 64 : 217;
      const g = f > 0.25 ? 191 : 51;
      const b = f > 0.5 ? 77 : 38;
      bar(H * (0.5 - 0.29), W * 0.05, W * 0.05 * 1.5, f, `rgb(${r},${g},${b})`);
    }
  }

  setEnabled(v: boolean): void {
    this.plane.setEnabled(v);
  }

  /** Включить полоску здоровья под ником (зелёная, желтеет/краснеет с уроном). */
  showHp(): void {
    if (this.hpOn) return;
    this.hpOn = true;
    this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Тонкая полоска опыта над полоской жизни — сколько до следующего уровня (боты; золото/серый). */
  showXp(): void {
    if (this.xpOn) return;
    this.xpOn = true;
    this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Доля опыта до следующего уровня 0..1. Отрицательное — максимальный уровень (полоска прячется). */
  setXp(frac: number): void {
    const hidden = frac < 0;
    const f = hidden ? 1 : Math.max(0, Math.min(1, frac));
    if (hidden === this.xpHidden && Math.abs(f - this.xpFrac) < 0.005) return;
    this.xpHidden = hidden;
    this.xpFrac = f;
    if (this.xpOn) this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Доля здоровья 0..1. Зовётся каждый кадр: текстура перерисовывается, только если значение заметно изменилось. */
  setHp(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    if (Math.abs(f - this.hpFrac) < 0.01 && !(f === 0 && this.hpFrac !== 0)) return;
    this.hpFrac = f;
    if (this.hpOn) this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Поднять плашку — когда высота модели становится известна позже (боты). */
  setAnchorY(y: number): void {
    this.baseY = y;
    this.plane.position.y = y + (this.plane.scaling.y - 1) * this.halfH;
  }

  /**
   * Множитель размера плашки. Растёт нижним краем на месте, чтобы увеличенная
   * плашка не налезала на моба.
   */
  setScale(k: number): void {
    if (Math.abs(k - this.curScale) < 0.002) return; // зовётся каждый кадр — без изменения не трогаем
    this.curScale = k;
    this.plane.scaling.setAll(k);
    this.plane.position.y = this.baseY + (k - 1) * this.halfH;
  }

  /**
   * Плашка видна СКВОЗЬ модель (не загораживается ею) — по умолчанию выключено
   * (обычные мобы на поляне честно прячутся за своим же телом/стеной/деревом).
   * Нужно, например, в тесной башне: высокий босс закрывает свою же плашку.
   */
  setAlwaysOnTop(on: boolean): void {
    this.alwaysOnTop = on;
    this.applyAlwaysOnTop();
  }

  private applyAlwaysOnTop(): void {
    const on = this.alwaysOnTop;
    for (const m of [this.plane]) {
      if (!m?.material) continue;
      // disableDepthTest — не просто "рисуй после", а буквально не сверяться
      // с буфером глубины: иначе своё же тело моба (уже в буфере) закрывало
      // бы плашку у высоких боссов независимо от порядка рендер-групп.
      (m.material as StandardMaterial).depthFunction = on ? Constants.ALWAYS : 0;
      (m.material as StandardMaterial).disableDepthWrite = on;
      m.renderingGroupId = on ? 1 : 0;
    }
  }

  dispose(): void {
    // (false, true) — вместе с материалом (и его текстурой): иначе на каждый
    // убранный моб/героя в сцене оставался nameTagMat и полоски (утечка).
    this.plane.dispose(false, true);
    this.tex.dispose();
  }
}


/**
 * Значок платформы в сером кружке (чтобы белый рисунок не сливался с белым ником):
 * 1 — монитор, 2 — смартфон, 3 — VR-шлем (очки с ремешком). (cx, cy) — центр кружка,
 * `h` — его диаметр в пикселях текстуры плашки.
 */
function drawPlatformIcon(ctx: CanvasRenderingContext2D, kind: number, cx: number, cy: number, h: number): void {
  ctx.save();
  const R = h * 0.6;
  const BG = "#4a4f5e";
  ctx.fillStyle = BG;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.stroke();

  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const rr = (x: number, y: number, w: number, hh: number, r: number): void => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hh, r);
    ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };
  if (kind === 1) {
    // Монитор: экран + ножка + основание.
    const w = R * 1.1;
    const sh = R * 0.75;
    rr(cx - w / 2, cy - R * 0.5, w, sh, 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - R * 0.5 + sh);
    ctx.lineTo(cx, cy + R * 0.42);
    ctx.moveTo(cx - w * 0.3, cy + R * 0.42);
    ctx.lineTo(cx + w * 0.3, cy + R * 0.42);
    ctx.stroke();
  } else if (kind === 2) {
    // Смартфон: вертикальный прямоугольник с точкой-кнопкой.
    const w = R * 0.68;
    const ph = R * 1.15;
    rr(cx - w / 2, cy - ph / 2, w, ph, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + ph / 2 - 6, 2.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 3) {
    // VR-шлем: сплошной визор с вырезом под нос и парой линз + ремешок по бокам.
    const w = R * 1.35;
    const vh = R * 0.75;
    const x0 = cx - w / 2;
    const y0 = cy - vh / 2;
    ctx.beginPath();
    ctx.moveTo(x0 + 6, y0);
    ctx.lineTo(x0 + w - 6, y0);
    ctx.arcTo(x0 + w, y0, x0 + w, y0 + 6, 6);
    ctx.lineTo(x0 + w, y0 + vh - 8);
    ctx.arcTo(x0 + w, y0 + vh, x0 + w - 8, y0 + vh, 8);
    ctx.lineTo(cx + w * 0.16, y0 + vh); // до выреза
    ctx.quadraticCurveTo(cx, y0 + vh - vh * 0.42, cx - w * 0.16, y0 + vh); // вырез под нос
    ctx.lineTo(x0 + 8, y0 + vh);
    ctx.arcTo(x0, y0 + vh, x0, y0 + vh - 8, 8);
    ctx.lineTo(x0, y0 + 6);
    ctx.arcTo(x0, y0, x0 + 6, y0, 6);
    ctx.closePath();
    ctx.fill();
    // Линзы — цвета подложки.
    ctx.fillStyle = BG;
    ctx.beginPath();
    ctx.arc(cx - w * 0.26, cy - vh * 0.06, vh * 0.2, 0, Math.PI * 2);
    ctx.arc(cx + w * 0.26, cy - vh * 0.06, vh * 0.2, 0, Math.PI * 2);
    ctx.fill();
    // Ремешок: короткие дужки по бокам.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, cy - vh * 0.18);
    ctx.lineTo(x0 - 6, cy - vh * 0.18);
    ctx.moveTo(x0 + w, cy - vh * 0.18);
    ctx.lineTo(x0 + w + 6, cy - vh * 0.18);
    ctx.stroke();
  }
  ctx.restore();
}
