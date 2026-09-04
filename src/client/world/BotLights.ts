import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { BOT_TORCHES, relightMaterials } from "./Fireflies";

/**
 * Докуда добивает свет, м. Держим близко к лампе светлячка (FIREFLY.lightRange
 * = 11): та землю освещает исправно, и отходить от проверенной конфигурации
 * без нужды не стоит. falloffType намеренно НЕ трогаем — у StandardMaterial
 * тип затухания задают дефайны материала, а не источника.
 */
const RANGE = 14;
/**
 * Дальше этого — свет физически не достаёт (RANGE), гасим совсем. Раньше
 * факел оставался light.setEnabled(true) сколько угодно далеко от камеры —
 * шейдер земли/травы всё равно считал его на КАЖДОМ пикселе экрана, даже
 * если камера смотрит в другую сторону карты. Небольшой запас сверх RANGE —
 * чтобы не мигал ровно на границе, пока бот идёт по кругу.
 */
const DARK_BEYOND = RANGE + 6;
/** На сколько источник вынесен ВПЕРЁД от бота — светит в основном на морду. */
const FORWARD = 1.1;
/**
 * Смещение по высоте от точки корпуса (она на уровне глаз, ~1.7 м над землёй).
 * Отрицательное: светлячки висят в 1.1 м над землёй и оттуда её достают, а с
 * высоты 2.2 м земля освещалась заметно хуже.
 */
const UP = -0.5;
/**
 * Яркость источника. Подобрана вживую на стриме — 1. Прежние значения (3, 8)
 * подбирались, пока шейдер земли оставался с дневным набором источников и
 * приходилось «пробивать» темноту; после починки пересборки хватает единицы.
 * Ручка `?botlight=<n>` оставлена для подгонки.
 */
const INTENSITY = (() => {
  // Сначала has(): без параметра get() даёт null, а Number(null) === 0 — ноль
  // проходит проверку `>= 0`, и значение по умолчанию не бралось никогда.
  const p = new URLSearchParams(location.search);
  if (!p.has("botlight")) return 1;
  const v = Number(p.get("botlight"));
  return Number.isFinite(v) && v >= 0 && v <= 40 ? v : 1;
})();

/**
 * Ночная подсветка от ботов зрителей (Ф10) — настоящий свет, без спрайтов.
 *
 * Аддитивный ореол (как у светлячков) отсюда убран: он рисуется ПОВЕРХ того,
 * что за ним, поэтому «подсвечивал» вертикальное — стволы и траву, — почти
 * не задевал землю и не мог осветить самого бота (тот непрозрачный и рисуется
 * раньше). Выглядело это белым пятном, а не освещением.
 *
 * PointLight'ов раздаём BOT_TORCHES штук, ближайшим к камере: каждый лишний
 * источник попадает в шейдер земли, травы и деревьев. Днём гаснут.
 */
export class BotLights {
  private readonly lights: PointLight[] = [];
  private night = 0;
  private enabled = false;
  /**
   * Сколько факелов из BOT_TORCHES реально зажигать. VR (два глаза, вдвое
   * дороже) гасит все через setForceOff; слабый спектатор (?q=med на
   * телефоне) может срезать половину через setBudget, не теряя эффект целиком.
   */
  private budget = BOT_TORCHES;
  private readonly _order: number[] = [];

  constructor(private readonly scene: Scene) {
    for (let i = 0; i < BOT_TORCHES; i++) {
      const l = new PointLight(`botTorch${i}`, new Vector3(0, -100, 0), scene);
      l.range = RANGE;
      l.intensity = 0;
      l.diffuse = new Color3(1, 0.86, 0.62);
      l.specular = new Color3(0.12, 0.1, 0.06);
      l.setEnabled(false);
      this.lights.push(l);
    }

  }

  /**
   * Погасить факелы совсем, независимо от времени суток — например, вошли
   * в VR: экран входа идёт уже ПОСЛЕ постройки зоны, так что VR/флэт не
   * выбрать заранее. Сразу гасит текущие источники, если они горели.
   */
  setForceOff(v: boolean): void {
    this.setBudget(v ? 0 : BOT_TORCHES);
  }

  /** Сколько факелов из BOT_TORCHES разрешено зажигать (0..BOT_TORCHES). */
  setBudget(n: number): void {
    this.budget = n;
    if (this.enabled) {
      for (let i = 0; i < this.lights.length; i++) {
        if (i >= n) this.lights[i].setEnabled(false);
      }
    }
  }

  /**
   * @param daylight 0..1 (1 — день)
   * @param ref      откуда мерить «ближайших» (камера спектатора / голова игрока)
   * @param bots     мировые позиции корпусов ботов
   */
  update(
    dt: number,
    daylight: number,
    ref: Vector3,
    bots: readonly Vector3[],
    /** Куда смотрит каждый бот (единичное, горизонтальное). */
    fwd: readonly Vector3[],
  ): void {
    const want = Math.max(0, Math.min(1, 1 - daylight * 1.6));
    this.night += (want - this.night) * Math.min(1, dt * 0.8);

    const on = this.night > 0.02 && bots.length > 0 && this.budget > 0;
    if (on !== this.enabled) {
      this.enabled = on;
      for (let i = 0; i < this.lights.length; i++) this.lights[i].setEnabled(on && i < this.budget);
      // Материалы зоны (земля, трава) приходят замороженными и сами шейдер не
      // пересобирают. Факелы включаются только ночью — то есть уже ПОСЛЕ того,
      // как шейдер собран по дневному набору источников, и в него не попадают.
      // Набор изменился — говорим об этом явно. Бывает дважды за сутки.
      relightMaterials(this.scene);
    }
    if (!this.enabled) return;


    // Настоящие источники — ближайшим к камере.
    this._order.length = 0;
    for (let i = 0; i < bots.length; i++) this._order.push(i);
    if (bots.length > this.lights.length) {
      this._order.sort(
        (a, b) => Vector3.DistanceSquared(bots[a], ref) - Vector3.DistanceSquared(bots[b], ref),
      );
    }
    const budget = Math.min(this.lights.length, this.budget);
    let toggled = false;
    for (let i = 0; i < this.lights.length; i++) {
      const bi = i < budget ? this._order[i] : undefined;
      const l = this.lights[i];
      if (bi === undefined) {
        l.intensity = 0;
        if (l.isEnabled()) {
          l.setEnabled(false);
          toggled = true;
        }
        continue;
      }
      const b = bots[bi];
      const f = fwd[bi];
      const fl = f ? Math.hypot(f.x, f.z) || 1 : 1;
      const ox = f ? (f.x / fl) * FORWARD : 0;
      const oz = f ? (f.z / fl) * FORWARD : 0;
      l.position.set(b.x + ox, b.y + UP, b.z + oz);
      const shouldBeOn = Vector3.Distance(l.position, ref) < DARK_BEYOND;
      l.intensity = shouldBeOn ? this.night * INTENSITY : 0;
      if (shouldBeOn !== l.isEnabled()) {
        l.setEnabled(shouldBeOn);
        toggled = true;
      }
    }
    // Замороженные материалы зоны сами не пересоберутся (см. relightMaterials
    // выше) — бот заходит/выходит из радиуса не каждый кадр.
    if (toggled) relightMaterials(this.scene);
  }

  dispose(): void {
    for (const l of this.lights) l.dispose();
  }
}
