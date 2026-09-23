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
/** Сколько факелов зажигать по умолчанию (игра); спектатор поднимает до BOT_TORCHES через setBudget. */
const DEFAULT_TORCHES = 2;
/** На сколько источник вынесен ВПЕРЁД от бота — светит в основном на морду. */
const FORWARD = 1.1;
/**
 * Смещение по высоте от точки корпуса (она на уровне глаз, ~1.7 м над землёй).
 * Отрицательное: светлячки висят в 1.1 м над землёй и оттуда её достают, а с
 * высоты 2.2 м земля освещалась заметно хуже.
 */
const UP = -0.5;
/**
 * Яркость источника. Было 1 (подобрано вживую на стриме, пока шейдер земли
 * оставался с дневным набором источников и приходилось «пробивать» темноту);
 * после починки пересборки чуть приподняли до 1.4 — попросили факелы ботов
 * ярче. Прежние значения (3, 8) — совсем старые, до той починки.
 * Ручка `?botlight=<n>` оставлена для подгонки.
 */
const INTENSITY = (() => {
  // Сначала has(): без параметра get() даёт null, а Number(null) === 0 — ноль
  // проходит проверку `>= 0`, и значение по умолчанию не бралось никогда.
  const p = new URLSearchParams(location.search);
  if (!p.has("botlight")) return 1.4;
  const v = Number(p.get("botlight"));
  return Number.isFinite(v) && v >= 0 && v <= 40 ? v : 1.4;
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
  /** Секунд с последней «страховочной» пересборки материалов зоны (см. update). */
  private relightAccum = 0;
  /**
   * Сколько факелов из BOT_TORCHES реально зажигать. VR (два глаза, вдвое
   * дороже) гасит все через setForceOff; слабый спектатор (?q=med на
   * телефоне) может срезать половину через setBudget, не теряя эффект целиком.
   */
  private budget = DEFAULT_TORCHES;
  /** Чей свет: индекс бота в массиве `bots` (-1 — источник свободен). */
  private readonly owner: number[] = [];
  private readonly retiring: boolean[] = [];
  private readonly level: number[] = [];
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
      this.owner.push(-1);
      this.retiring.push(false);
      this.level.push(0);
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
      // Набор включённых источников изменился — замороженным материалам зоны
      // (земля, трава) надо об этом сказать, иначе прибавка не попадёт в шейдер.
      let changed = false;
      for (let i = 0; i < this.lights.length; i++) {
        const want = i < n;
        if (this.lights[i].isEnabled() !== want) {
          this.lights[i].setEnabled(want);
          changed = true;
        }
      }
      if (changed) relightMaterials(this.scene, "BotLights.budget");
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
    // Было 0.8 — с наступлением ночи факелы разгорались за ~1-2 с, слишком
    // резко на глаз. 0.25 — то же плавное схождение, но за ~4-5 с.
    this.night += (want - this.night) * Math.min(1, dt * 0.25);

    const on = this.night > 0.02 && bots.length > 0 && this.budget > 0;
    if (on !== this.enabled) {
      this.enabled = on;
      if (!on) this.relightAccum = 0;
      for (let i = 0; i < this.lights.length; i++) this.lights[i].setEnabled(on && i < this.budget);
      // Материалы зоны (земля, трава) приходят замороженными и сами шейдер не
      // пересобирают. Факелы включаются только ночью — то есть уже ПОСЛЕ того,
      // как шейдер собран по дневному набору источников, и в него не попадают.
      // Набор изменился — говорим об этом явно. Бывает дважды за сутки.
      relightMaterials(this.scene, "BotLights");
    }
    if (!this.enabled) return;


    // Настоящие источники — ближайшим к камере. Назначение «липкое»: свет
    // остаётся у своего бота, пока тот в числе ближайших; уходит — плавно
    // гаснет на месте, и только потом освободившийся источник переезжает к
    // новому боту и плавно разгорается. Раньше при каждом изменении порядка
    // «ближайших» свет мгновенно перескакивал с одного бота на другого — на
    // стриме и свободной камере это читалось как мигание/пропадание факелов.
    this._order.length = 0;
    for (let i = 0; i < bots.length; i++) this._order.push(i);
    this._order.sort(
      (a, b) => Vector3.DistanceSquared(bots[a], ref) - Vector3.DistanceSquared(bots[b], ref),
    );
    // Страховка: пока факелы горят, периодически пересобираем материалы зоны —
    // на случай, если очередной новый бот/материал зоны не подхватил текущий
    // набор источников (например, первая пересборка при включении отработала
    // до того, как замороженные материалы земли/травы её подхватили — живёт
    // спектатор часами без перезагрузки, а не разово одну ночь). Раз в ~90 с,
    // не чаще — полная пересборка шейдеров всех материалов недёшева.
    this.relightAccum += dt;
    if (this.night > 0.3 && this.relightAccum >= 90) {
      this.relightAccum = 0;
      relightMaterials(this.scene, "BotLights.strong");
    }
    const budget = Math.min(this.lights.length, this.budget);
    const near = this._order.slice(0, budget);

    for (let i = 0; i < this.lights.length; i++) {
      const o = this.owner[i];
      if (o < 0) continue;
      if (o >= bots.length) {
        this.owner[i] = -1; // бот исчез
        this.level[i] = 0;
      } else {
        this.retiring[i] = !near.includes(o);
      }
    }
    for (const b of near) {
      if (this.owner.includes(b)) continue;
      // Нужен свободный (погасший) источник; занятые уходящие ждут своего затухания.
      for (let i = 0; i < budget; i++) {
        if (this.owner[i] < 0) {
          this.owner[i] = b;
          this.retiring[i] = false;
          this.level[i] = 0;
          break;
        }
      }
    }

    const kf = Math.min(1, dt * 4);
    for (let i = 0; i < this.lights.length; i++) {
      const l = this.lights[i];
      const o = this.owner[i];
      if (o < 0 || i >= budget) {
        l.intensity = 0;
        continue;
      }
      const target = this.retiring[i] ? 0 : 1;
      this.level[i] += (target - this.level[i]) * kf;
      if (this.retiring[i] && this.level[i] < 0.03) {
        this.owner[i] = -1;
        this.level[i] = 0;
        l.intensity = 0;
        continue;
      }
      const b = bots[o];
      const f = fwd[o];
      const fl = f ? Math.hypot(f.x, f.z) || 1 : 1;
      const ox = f ? (f.x / fl) * FORWARD : 0;
      const oz = f ? (f.z / fl) * FORWARD : 0;
      l.position.set(b.x + ox, b.y + UP, b.z + oz);
      l.intensity = this.night * INTENSITY * this.level[i];
    }
  }

  /** Диагностика для отчёта ?perf=1 / плашки ?debug=1. */
  debugInfo(): string {
    const on = this.lights.filter((l) => l.isEnabled()).length;
    const lit = this.lights.filter((l) => l.intensity > 0.01).length;
    return `факелы: ночь ${this.night.toFixed(2)}, включено ${on}, светят ${lit}, бюджет ${this.budget}`;
  }

  dispose(): void {
    for (const l of this.lights) l.dispose();
  }
}
