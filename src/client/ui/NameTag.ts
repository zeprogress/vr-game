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
  private readonly planeW: number;
  private readonly accent: Color3;
  private curName = "";
  private curLevel: number | null = null;
  private curUnspent = false;
  /** Платформа игрока: 0 — нет значка, 1 — ПК, 2 — смартфон, 3 — VR. */
  private platform = 0;

  /** Полоска здоровья под ником (создаётся по требованию через showHp). */
  private hpBg: Mesh | null = null;
  private hpFill: Mesh | null = null;
  private hpFillMat: StandardMaterial | null = null;
  private hpW = 0;
  private hpFrac = 1;

  /** Полоска опыта (тонкая, золотая) — только у ботов, через showXp. */
  private xpBg: Mesh | null = null;
  private xpFill: Mesh | null = null;
  private xpW = 0;
  private xpFrac = 0;
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
    this.planeW = planeW;
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
      drawPlatformIcon(ctx, this.platform, W / 2 - nameW / 2 - 34, nameY, 46);
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
    this.tex.update(true);
  }

  setEnabled(v: boolean): void {
    this.plane.setEnabled(v);
  }

  /**
   * Включить полоску здоровья под ником (зелёная, желтеет/краснеет с уроном).
   * Планки — дети плашки: сами едут за billboard, масштабом и якорем.
   */
  showHp(): void {
    if (this.hpBg) return;
    const scene = this.plane.getScene();
    const w = this.planeW * 0.66;
    const barH = this.planeW * 0.05;
    // Над ником, но ближе к нему — не у самого верхнего края.
    const y = this.halfH * 0.58;
    this.hpW = w;

    const bgMat = new StandardMaterial("nameHpBgMat", scene);
    bgMat.disableLighting = true;
    bgMat.emissiveColor = new Color3(0.03, 0.03, 0.03);
    bgMat.specularColor = new Color3(0, 0, 0);
    bgMat.alpha = 0.65;
    this.hpBg = MeshBuilder.CreatePlane("nameHpBg", { width: w + w * 0.06, height: barH * 1.5 }, scene);
    this.hpBg.material = bgMat;
    this.hpBg.parent = this.plane;
    this.hpBg.position.set(0, y, 0.01);
    this.hpBg.isPickable = false;
    this.hpBg.renderingGroupId = 0;

    this.hpFillMat = new StandardMaterial("nameHpFillMat", scene);
    this.hpFillMat.disableLighting = true;
    this.hpFillMat.specularColor = new Color3(0, 0, 0);
    this.hpFillMat.emissiveColor = new Color3(0.25, 0.8, 0.3);
    this.hpFill = MeshBuilder.CreatePlane("nameHpFill", { width: w, height: barH }, scene);
    this.hpFill.material = this.hpFillMat;
    this.hpFill.parent = this.hpBg;
    this.hpFill.position.z = -0.01;
    this.hpFill.isPickable = false;
    this.hpFill.renderingGroupId = 0;
    if (this.alwaysOnTop) this.applyAlwaysOnTop();
    this.setHp(this.hpFrac);
  }

  /**
   * Тонкая полоска опыта над полоской жизни — сколько до следующего уровня.
   * Ставится ботам; цвет не меняется (золото).
   */
  showXp(): void {
    if (this.xpBg) return;
    const scene = this.plane.getScene();
    const w = this.planeW * 0.66;
    const barH = this.planeW * 0.023;
    // Над полоской жизни (та — на halfH*0.58), с зазором.
    const y = this.halfH * 0.92;
    this.xpW = w;

    const bgMat = new StandardMaterial("nameXpBgMat", scene);
    bgMat.disableLighting = true;
    bgMat.emissiveColor = new Color3(0.03, 0.03, 0.03);
    bgMat.specularColor = new Color3(0, 0, 0);
    bgMat.alpha = 0.65;
    this.xpBg = MeshBuilder.CreatePlane(
      "nameXpBg",
      { width: w + w * 0.06, height: barH * 1.6 },
      scene,
    );
    this.xpBg.material = bgMat;
    this.xpBg.parent = this.plane;
    this.xpBg.position.set(0, y, 0.01);
    this.xpBg.isPickable = false;
    this.xpBg.renderingGroupId = 0;

    const fillMat = new StandardMaterial("nameXpFillMat", scene);
    fillMat.disableLighting = true;
    fillMat.specularColor = new Color3(0, 0, 0);
    fillMat.emissiveColor = new Color3(0.62, 0.64, 0.68);
    this.xpFill = MeshBuilder.CreatePlane("nameXpFill", { width: w, height: barH }, scene);
    this.xpFill.material = fillMat;
    this.xpFill.parent = this.xpBg;
    this.xpFill.position.z = -0.01;
    this.xpFill.isPickable = false;
    this.xpFill.renderingGroupId = 0;
    this.setXp(this.xpFrac);
  }

  /** Доля опыта до следующего уровня 0..1. Отрицательное — максимальный уровень (полоска прячется). */
  setXp(frac: number): void {
    if (frac < 0) {
      this.xpFrac = 1;
      this.xpBg?.setEnabled(false);
      return;
    }
    const f = Math.max(0, Math.min(1, frac));
    this.xpFrac = f;
    if (!this.xpFill) return;
    this.xpBg?.setEnabled(true);
    this.xpFill.scaling.x = Math.max(0.001, f);
    this.xpFill.position.x = -(this.xpW * (1 - f)) / 2;
  }

  /** Доля здоровья 0..1. */
  setHp(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    this.hpFrac = f;
    if (!this.hpFill || !this.hpFillMat) return;
    this.hpFill.scaling.x = Math.max(0.001, f);
    this.hpFill.position.x = -(this.hpW * (1 - f)) / 2;
    this.hpFillMat.emissiveColor.set(
      f > 0.5 ? 0.25 : 0.85,
      f > 0.25 ? 0.75 : 0.2,
      f > 0.5 ? 0.3 : 0.15,
    );
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
    for (const m of [this.plane, this.hpBg, this.hpFill, this.xpBg, this.xpFill]) {
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
    this.xpFill?.dispose(false, true);
    this.xpBg?.dispose(false, true);
    this.hpFill?.dispose(false, true);
    this.hpBg?.dispose(false, true);
    this.plane.dispose(false, true);
    this.tex.dispose();
  }
}


/**
 * Значок платформы, нарисованный контуром: 1 — монитор, 2 — смартфон, 3 — VR-шлем.
 * (cx, cy) — центр, `h` — высота значка в пикселях текстуры плашки.
 */
function drawPlatformIcon(ctx: CanvasRenderingContext2D, kind: number, cx: number, cy: number, h: number): void {
  ctx.save();
  ctx.strokeStyle = "#e9ecf6";
  ctx.fillStyle = "#e9ecf6";
  ctx.lineWidth = 5;
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
    const w = h * 1.15;
    const sh = h * 0.72;
    rr(cx - w / 2, cy - h / 2, w, sh, 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2 + sh);
    ctx.lineTo(cx, cy + h / 2 - 4);
    ctx.moveTo(cx - w * 0.28, cy + h / 2 - 2);
    ctx.lineTo(cx + w * 0.28, cy + h / 2 - 2);
    ctx.stroke();
  } else if (kind === 2) {
    // Смартфон: вертикальный прямоугольник с точкой-кнопкой.
    const w = h * 0.58;
    rr(cx - w / 2, cy - h / 2, w, h, 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + h / 2 - 8, 2.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 3) {
    // VR-шлем: широкий визор с двумя линзами и ремешком.
    const w = h * 1.5;
    const vh = h * 0.72;
    rr(cx - w / 2, cy - vh / 2, w, vh, 9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - w * 0.2, cy, vh * 0.2, 0, Math.PI * 2);
    ctx.arc(cx + w * 0.2, cy, vh * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - vh * 0.15);
    ctx.lineTo(cx - w / 2 - 6, cy - vh * 0.15);
    ctx.moveTo(cx + w / 2, cy - vh * 0.15);
    ctx.lineTo(cx + w / 2 + 6, cy - vh * 0.15);
    ctx.stroke();
  }
  ctx.restore();
}
