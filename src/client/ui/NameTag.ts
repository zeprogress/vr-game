import type { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { MOB_ARMOR_LOOK } from "#shared/look";
import { drawIcon } from "./icons";

/**
 * Плашки имён над мобами и героями — ОДНА общая текстура-атлас на много плашек (страница 2048×1024,
 * 31 ячейка 512×128) и один материал на страницу. Раньше у каждой плашки была своя текстура и свой
 * материал, а полоски HP/опыта рисовались в ту же текстуру: каждый удар по мобу перерисовывал холст
 * с текстом и заново грузил текстуру в видеокарту. Теперь полоски — четырёхугольники в геометрии
 * плашки (цвет — в вершинах, текстура — белая ячейка атласа): удар двигает 4 вершины, текст не трогает.
 * Текст — с тёмной обводкой и мип-уровнями атласа: вдали не рябит и читается на «Низком» качестве.
 */
const SLOT_W = 512;
const SLOT_H = 128;
const PAGE_W = 2048;
const PAGE_H = 1024;
const COLS = PAGE_W / SLOT_W;
const ROWS = PAGE_H / SLOT_H;
/** Метров на пиксель ячейки — тот же физический размер букв, что у прежней плашки (0.9 м на 448 px). */
const M_PER_PX = 0.9 / 448;
const NAME_PX = 56;
const LVL_PX = 36;
/** Значок защиты моба справа от уровня (кружок с рисунком), px ячейки. */
const ICON_PX = 40;
const FONT_FAMILY = "system-ui, sans-serif";
/** Метка бота зрителя перед ником — единственное отличие от живого игрока со стороны. */
const BOT_MARK = "🤖 ";
/** Не чаще этого (мс) грузим изменённую страницу атласа в видеокарту. */
const FLUSH_MS = 100;

// Геометрия полосок (м, от центра плашки) — те же места и пропорции, что у прежней плашки.
const BAR_W = 0.595;
const HP_Y = 0.121;
const HP_H = 0.045;
const HP_BG_H = 0.0675;
const XP_Y = 0.192;
const XP_H = 0.0207;
const XP_BG_H = 0.0331;
const BG_RGBA: [number, number, number, number] = [0.03, 0.03, 0.03, 0.65];
const XP_RGBA: [number, number, number, number] = [0.62, 0.64, 0.68, 1];
/** Половина прежней высоты плашки — от неё растёт setScale (нижним краем на месте). */
const HALF_H = (0.9 * (208 / 448)) / 2;

/** Четырёхугольники меша плашки (по 4 вершины): текст, фон и заливка опыта, фон и заливка HP. */
const Q_TEXT = 0;
const Q_XP_BG = 1;
const Q_XP = 2;
const Q_HP_BG = 3;
const Q_HP = 4;
const QUADS = 5;

interface AtlasPage {
  tex: DynamicTexture;
  ctx: CanvasRenderingContext2D;
  mat: StandardMaterial;
  /** Тот же атлас поверх всего (setAlwaysOnTop) — отдельный материал, текстура общая. */
  matTop: StandardMaterial | null;
  free: number[];
  dirty: boolean;
}

class TagAtlas {
  private readonly pages: AtlasPage[] = [];
  private lastFlush = 0;

  constructor(private readonly scene: Scene) {
    scene.onBeforeRenderObservable.add(() => this.flush());
  }

  alloc(): { page: AtlasPage; slot: number } {
    let page = this.pages.find((p) => p.free.length > 0);
    if (!page) page = this.addPage();
    return { page, slot: page.free.pop()! };
  }

  release(page: AtlasPage, slot: number): void {
    page.ctx.clearRect(...slotRect(slot));
    page.free.push(slot);
  }

  topMaterial(page: AtlasPage): StandardMaterial {
    if (!page.matTop) {
      // Не clone(): он клонирует и DynamicTexture, а меш с клоном динамической текстуры не рисуется.
      const m = tagMaterial(this.scene, `${page.mat.name}Top`, page.tex);
      // disableDepthTest — не просто «рисуй после», а не сверяться с глубиной: иначе своё же
      // тело моба (уже в буфере) закрывало бы плашку у высоких боссов.
      m.depthFunction = Constants.ALWAYS;
      m.disableDepthWrite = true;
      page.matTop = m;
    }
    return page.matTop;
  }

  private addPage(): AtlasPage {
    const n = this.pages.length;
    // Мип-уровни + трилинейная выборка: мелкая далёкая плашка сглажена, а не «рябит» пикселями.
    const tex = new DynamicTexture(`nameTagAtlas${n}`, { width: PAGE_W, height: PAGE_H }, this.scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    tex.hasAlpha = true;
    tex.anisotropicFilteringLevel = 4;
    tex.wrapU = Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, PAGE_W, PAGE_H);
    // Белый квадрат в середине ячейки 0: из него берут цвет полоски (цвет — в вершинах). Только середина —
    // иначе сглаживание подмешивало белое к краю соседней ячейки (тонкая линия у плашки).
    ctx.fillStyle = "#fff";
    ctx.fillRect(SLOT_W / 2 - 16, SLOT_H / 2 - 16, 32, 32);
    const mat = tagMaterial(this.scene, `nameTagMat${n}`, tex);
    const free: number[] = [];
    for (let i = COLS * ROWS - 1; i >= 1; i--) free.push(i);
    const page: AtlasPage = { tex, ctx, mat, matTop: null, free, dirty: true };
    this.pages.push(page);
    return page;
  }

  private flush(): void {
    const now = performance.now();
    if (now - this.lastFlush < FLUSH_MS) return;
    for (const p of this.pages) {
      if (!p.dirty) continue;
      p.dirty = false;
      p.tex.update(true);
      this.lastFlush = now;
    }
  }
}

/** Материал страницы: цвет = атлас × цвет вершин (текст — белые вершины, полоски — белая ячейка × цвет). */
function tagMaterial(scene: Scene, name: string, tex: DynamicTexture): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = tex;
  mat.useAlphaFromDiffuseTexture = true;
  mat.disableLighting = true;
  // Без освещения diffuse даёт ноль: цвет = emissive (белый) × атлас × цвет вершин.
  mat.diffuseColor = new Color3(0, 0, 0);
  mat.emissiveColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  return mat;
}

const atlases = new WeakMap<Scene, TagAtlas>();
function atlasOf(scene: Scene): TagAtlas {
  let a = atlases.get(scene);
  if (!a) {
    a = new TagAtlas(scene);
    atlases.set(scene, a);
  }
  return a;
}

function slotRect(slot: number): [number, number, number, number] {
  return [(slot % COLS) * SLOT_W, Math.floor(slot / COLS) * SLOT_H, SLOT_W, SLOT_H];
}

/**
 * Плашка с именем и уровнем над мобом. Всегда развёрнута к камере
 * и параллельна горизонту (BILLBOARDMODE_Y).
 */
export class NameTag {
  private readonly plane: Mesh;
  private readonly atlas: TagAtlas;
  private readonly page: AtlasPage;
  private readonly slot: number;
  private baseY: number;
  private readonly halfH = HALF_H;

  private accent: Color3;
  /** Цвет самого имени (NPC лагеря — фиолетовый). */
  private nameColor = "#f2f4fb";
  private title = "";
  private curName = "";
  private curLevel: number | null = null;
  private curUnspent = false;
  /** Защиты моба битами (MobState.armor) — значки справа от уровня. */
  private armor = 0;
  private disposed = false;
  /** Платформа игрока: 0 — нет значка, 1 — ПК, 2 — смартфон, 3 — VR. */
  private platform = 0;

  private hpOn = false;
  private hpFrac = 1;
  private xpOn = false;
  private xpHidden = false;
  private xpFrac = 0;
  private curScale = 1;
  private readonly pos = new Float32Array(QUADS * 4 * 3);
  private readonly col = new Float32Array(QUADS * 4 * 4);

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
    this.atlas = atlasOf(scene);
    const a = this.atlas.alloc();
    this.page = a.page;
    this.slot = a.slot;

    // Геометрия: текст на всю ячейку + 4 полоски (пока схлопнуты в ноль — showHp/showXp раскроют).
    const uv = new Float32Array(QUADS * 4 * 2);
    const [sx, sy] = slotRect(this.slot);
    // Края ячейки чуть внутрь (2 px): соседние ячейки не подмешиваются при выборке.
    const u0 = (sx + 2) / PAGE_W;
    const u1 = (sx + SLOT_W - 2) / PAGE_W;
    const vTop = 1 - (sy + 2) / PAGE_H;
    const vBot = 1 - (sy + SLOT_H - 2) / PAGE_H;
    const setUv = (q: number, ua: number, ub: number, va: number, vb: number): void => {
      uv.set([ua, vb, ub, vb, ub, va, ua, va], q * 8);
    };
    setUv(Q_TEXT, u0, u1, vTop, vBot);
    // Белая ячейка 0 — середина, чтобы мип-уровни не подмешивали соседей.
    const [wx, wy] = slotRect(0);
    const wu = (wx + SLOT_W / 2) / PAGE_W;
    const wv = 1 - (wy + SLOT_H / 2) / PAGE_H;
    for (const q of [Q_XP_BG, Q_XP, Q_HP_BG, Q_HP]) setUv(q, wu, wu, wv, wv);
    const idx: number[] = [];
    for (let q = 0; q < QUADS; q++) {
      const b = q * 4;
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const tw = SLOT_W * M_PER_PX;
    const th = SLOT_H * M_PER_PX;
    this.setQuad(Q_TEXT, -tw / 2, tw / 2, -th / 2, th / 2, [1, 1, 1, 1]);
    for (const q of [Q_XP_BG, Q_XP, Q_HP_BG, Q_HP]) this.setQuad(q, 0, 0, 0, 0, [0, 0, 0, 0]);

    this.plane = new Mesh("nameTag", scene);
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.indices = idx;
    vd.uvs = uv;
    vd.colors = this.col;
    vd.applyToMesh(this.plane, true);
    this.plane.hasVertexAlpha = true;
    this.plane.material = this.page.mat;
    this.plane.parent = parent;
    this.plane.position.copyFrom(offset);
    this.plane.isPickable = false;
    // Туман плашку не глушит — вдали имя должно читаться.
    this.plane.applyFog = false;
    // Группа 0 + проверка глубины: плашку загораживают стены, деревья и пол.
    this.plane.renderingGroupId = 0;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.baseY = offset.y;

    this.paint(name, level);
  }

  private setQuad(q: number, x0: number, x1: number, y0: number, y1: number, rgba: readonly number[]): void {
    this.pos.set([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], q * 12);
    for (let i = 0; i < 4; i++) this.col.set(rgba, q * 16 + i * 4);
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

  setNameColor(css: string): void {
    if (css === this.nameColor) return;
    this.nameColor = css;
    this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Текст ячейки: ник (значок бота/платформы слева), строка «титул · уровень». С обводкой — читается на любом фоне и вдали. */
  private paint(name: string, level: number | null, hasUnspent = false): void {
    this.curName = name;
    this.curLevel = level;
    this.curUnspent = hasUnspent;
    const ctx = this.page.ctx;
    const [x0, y0, W, H] = slotRect(this.slot);
    ctx.save();
    ctx.clearRect(x0, y0, W, H);
    ctx.beginPath();
    ctx.rect(x0, y0, W, H);
    ctx.clip();
    ctx.translate(x0, y0);
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(6,8,12,0.88)";
    const outlined = (text: string, x: number, y: number, fill: string, lw: number): void => {
      ctx.lineWidth = lw;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    };

    const nameY = level === null ? H / 2 : 44;
    // Слева место под значок бота/платформы; длинный ник — ужимаем кегль, чтобы влез в ячейку.
    const lead = this.isBot || this.platform > 0 ? 52 : 0;
    let px = NAME_PX;
    ctx.font = `bold ${px}px ${FONT_FAMILY}`;
    let nameW = ctx.measureText(name).width;
    const room = W - 24 - lead * 2;
    if (nameW > room) {
      px = Math.max(24, Math.floor((px * room) / nameW));
      ctx.font = `bold ${px}px ${FONT_FAMILY}`;
      nameW = ctx.measureText(name).width;
    }
    ctx.textAlign = "center";
    outlined(name, W / 2, nameY, this.nameColor, Math.max(6, px * 0.17));
    if (this.isBot) {
      ctx.textAlign = "right";
      ctx.fillStyle = this.nameColor;
      ctx.fillText(BOT_MARK.trim(), W / 2 - nameW / 2 - 8, nameY);
      ctx.textAlign = "center";
    }
    if (this.platform > 0) drawPlatformIcon(ctx, this.platform, W / 2 - nameW / 2 - 40, nameY, 46);

    if (level !== null) {
      const a = this.accent;
      const acc = `rgb(${Math.round(a.r * 255)},${Math.round(a.g * 255)},${Math.round(a.b * 255)})`;
      const lvlY = 100;
      const lvlText = `${level} ур.`;
      const head = this.title ? `${this.title} · ` : "";
      // Защиты моба — значки справа от уровня; строка «уровень + значки» стоит по центру.
      const defs = MOB_ARMOR_LOOK.filter((d) => (this.armor & d.bit) !== 0);
      const iconsW = defs.length > 0 ? 8 + defs.length * (ICON_PX + 4) - 4 : 0;
      let lp = LVL_PX;
      ctx.font = `600 ${lp}px ${FONT_FAMILY}`;
      let tw = ctx.measureText(head + lvlText).width;
      if (tw + iconsW > W - 40) {
        lp = Math.max(18, Math.floor((lp * (W - 40 - iconsW)) / tw));
        ctx.font = `600 ${lp}px ${FONT_FAMILY}`;
        tw = ctx.measureText(head + lvlText).width;
      }
      const lx = W / 2 - (tw + iconsW) / 2;
      ctx.textAlign = "left";
      // Титул фиолетовым перед уровнем: «Царь башни · 34 ур.».
      if (head) outlined(head, lx, lvlY, "#c79bff", 6);
      outlined(lvlText, lx + ctx.measureText(head).width, lvlY, acc, 6);
      if (hasUnspent) {
        // Красный "!" сразу после уровня — не по центру плашки (иначе сдвигал бы текст уровня).
        ctx.font = `bold 40px ${FONT_FAMILY}`;
        outlined("!", lx + tw + 10, lvlY + 1, "#ff3b30", 6);
      }
      // Тёмный кружок под значком — рисунок читается на любом фоне (как значок платформы у ника).
      let ix = lx + tw + 8;
      for (const d of defs) {
        ctx.fillStyle = "rgba(6,8,12,0.72)";
        ctx.beginPath();
        ctx.arc(ix + ICON_PX / 2, lvlY, ICON_PX / 2, 0, Math.PI * 2);
        ctx.fill();
        const pad = ICON_PX * 0.17;
        drawIcon(ctx, d.icon, ix + pad, lvlY - ICON_PX / 2 + pad, ICON_PX - 2 * pad, d.color, () => this.repaint());
        ix += ICON_PX + 4;
      }
    }
    ctx.restore();
    this.page.dirty = true;
  }

  /** Титул героя — в строке уровня, перед ним ("" — нет). */
  setTitle(title: string): void {
    if (title === this.title) return;
    this.title = title;
    this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Защиты моба битами (MobState.armor, MOB_ARMOR) — значки справа от уровня. */
  setArmor(bits: number): void {
    if (bits === this.armor) return;
    this.armor = bits;
    this.repaint();
  }

  /** Перерисовать с текущими данными (значок догрузился). Освобождённую ячейку не трогаем — её уже взяла другая плашка. */
  private repaint(): void {
    if (!this.disposed) this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Полоски над ником: геометрия и цвет в вершинах (без перерисовки текста). */
  private syncBars(): void {
    const half = BAR_W / 2;
    const bgHalf = (BAR_W * 1.06) / 2;
    const zero = [0, 0, 0, 0] as const;
    if (this.xpOn && !this.xpHidden) {
      this.setQuad(Q_XP_BG, -bgHalf, bgHalf, XP_Y - XP_BG_H / 2, XP_Y + XP_BG_H / 2, BG_RGBA);
      this.setQuad(Q_XP, -half, -half + BAR_W * Math.max(0.004, this.xpFrac), XP_Y - XP_H / 2, XP_Y + XP_H / 2, XP_RGBA);
    } else {
      this.setQuad(Q_XP_BG, 0, 0, 0, 0, zero);
      this.setQuad(Q_XP, 0, 0, 0, 0, zero);
    }
    if (this.hpOn) {
      const f = this.hpFrac;
      const rgba = [f > 0.5 ? 0.25 : 0.85, f > 0.25 ? 0.75 : 0.2, f > 0.5 ? 0.3 : 0.15, 1];
      this.setQuad(Q_HP_BG, -bgHalf, bgHalf, HP_Y - HP_BG_H / 2, HP_Y + HP_BG_H / 2, BG_RGBA);
      this.setQuad(Q_HP, -half, -half + BAR_W * Math.max(0.004, f), HP_Y - HP_H / 2, HP_Y + HP_H / 2, rgba);
    } else {
      this.setQuad(Q_HP_BG, 0, 0, 0, 0, zero);
      this.setQuad(Q_HP, 0, 0, 0, 0, zero);
    }
    this.plane.updateVerticesData(VertexBuffer.PositionKind, this.pos);
    this.plane.updateVerticesData(VertexBuffer.ColorKind, this.col);
  }

  setEnabled(v: boolean): void {
    if (this.plane.isEnabled(false) !== v) this.plane.setEnabled(v);
  }

  /** Сменить цвет строки уровня (ПК: цвет опасности моба относительно героя). */
  setAccent(r: number, g: number, b: number): void {
    const a = this.accent;
    if (Math.abs(a.r - r) + Math.abs(a.g - g) + Math.abs(a.b - b) < 0.01) return;
    this.accent = new Color3(r, g, b);
    this.paint(this.curName, this.curLevel, this.curUnspent);
  }

  /** Включить полоску здоровья над ником (зелёная, желтеет/краснеет с уроном). */
  showHp(): void {
    if (this.hpOn) return;
    this.hpOn = true;
    this.syncBars();
  }

  /** Тонкая полоска опыта над полоской жизни — сколько до следующего уровня (боты). */
  showXp(): void {
    if (this.xpOn) return;
    this.xpOn = true;
    this.syncBars();
  }

  /** Доля опыта до следующего уровня 0..1. Отрицательное — максимальный уровень (полоска прячется). */
  setXp(frac: number): void {
    const hidden = frac < 0;
    const f = hidden ? 1 : Math.max(0, Math.min(1, frac));
    if (hidden === this.xpHidden && Math.abs(f - this.xpFrac) < 0.005) return;
    this.xpHidden = hidden;
    this.xpFrac = f;
    if (this.xpOn) this.syncBars();
  }

  /** Доля здоровья 0..1. Зовётся каждый кадр: вершины двигаются, только если значение заметно изменилось. */
  setHp(frac: number): void {
    const f = Math.max(0, Math.min(1, frac));
    if (Math.abs(f - this.hpFrac) < 0.005 && !(f === 0 && this.hpFrac !== 0)) return;
    this.hpFrac = f;
    if (this.hpOn) this.syncBars();
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
    this.plane.material = on ? this.atlas.topMaterial(this.page) : this.page.mat;
    this.plane.renderingGroupId = on ? 1 : 0;
  }

  dispose(): void {
    this.disposed = true;
    // Материал и текстура общие — уходит только меш, ячейка атласа освобождается.
    this.plane.dispose(false, false);
    this.atlas.release(this.page, this.slot);
    this.page.dirty = true;
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
