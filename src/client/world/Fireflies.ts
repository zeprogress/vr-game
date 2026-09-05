import type { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { WORLD } from "#shared/constants";
import type { Terrain } from "./Terrain";
import { GROUND_GLOW_TUNE, onGroundGlowTuneChanged } from "./groundGlowTune";

/**
 * Пятно на земле — минимальный шейдер вместо StandardMaterial: у того без
 * diffuseTexture в подложку неожиданно подмешивалась белая база независимо
 * от emissiveColor/diffuseColor (перепроверено вживую — смена emissiveColor
 * на чистый красный, alpha=1, maxSimultaneousLights=0 не меняли итоговый
 * цвет вообще). Тут неоднозначности нет: gl_FragColor = сама текстура.
 */
const GROUND_GLOW_SHADER = "fireflyGroundGlow";
Effect.ShadersStore[`${GROUND_GLOW_SHADER}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main(void) {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vUV = uv;
}`;
Effect.ShadersStore[`${GROUND_GLOW_SHADER}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
uniform sampler2D glowSampler;
uniform float glowAlpha;
void main(void) {
  vec4 tex = texture2D(glowSampler, vUV);
  gl_FragColor = vec4(tex.rgb, tex.a * glowAlpha);
}`;

export const FIREFLY = {
  /** Сколько стаек по округе. */
  groups: 14,
  /** Огоньков в стайке. */
  perGroup: 14,
  /** Радиус, в котором огоньки вьются вокруг центра стайки, м. */
  spread: 1.5,
  /** На какой высоте над землёй висит стайка, м. */
  height: 1.1,
  /**
   * Сколько стаек реально светят настоящим PointLight (не считая
   * запечённого пятна на земле — см. groundGlowRadius, оно есть у всех).
   *
   * Материал по умолчанию берёт не больше четырёх источников разом, а солнце
   * и небо уже занимают два — поэтому тем материалам, которым важен этот свет
   * (земля, трава, деревья), потолок поднят до LIGHT_BUDGET. Каждый лишний
   * источник утяжеляет их шейдер, так что число тут — компромисс. С тех пор
   * как землю под дальними стайками красит статичное пятно, живой свет нужен
   * только вблизи игрока — было 5, теперь 3 (LIGHT_BUDGET меньше для ВСЕХ
   * материалов игры, не только спектатора).
   */
  lamps: 3,
  /** Докуда добивает свет одной стайки, м. */
  lightRange: 11,
  lightIntensity: 1.7,
  /** Радиус светящегося ореола вокруг стайки, м. */
  poolRadius: 3.3,
  /**
   * Насколько ярко ореол (0..1). Складывается с настоящей лампой, поэтому
   * при больших значениях центр выбивается в белый.
   */
  poolAlpha: 0.08,
  /**
   * Базовый радиус «запечённого» пятна на земле под стайкой, м — во сколько
   * раз растянута геометрия при живой правке (см. GROUND_GLOW_TUNE.radius в
   * groundGlowTune.ts, панель `?groundglow=1`), сам радиус/цвет/альфа/высота
   * пятна оттуда, не отсюда. Центры стаек постоянны (FIREFLY_SEED), так что
   * вместо настоящего PointLight у КАЖДОЙ стайки землю можно просто
   * подкрасить статичным пятном — дешевле на порядок (ни одного лишнего
   * источника в шейдере земли/травы). Настоящая лампа остаётся только у
   * ближайших к игроку/камере стаек — для честного объёма при проходе
   * сквозь стайку.
   */
  groundGlowRadius: 7.157,
  /** Цвет самой лампы (падающего света) — жёлтый, но ближе к белому. */
  lightColor: [1, 0.87, 0.55] as [number, number, number],
  /** Цвет светящегося ореола — насыщеннее жёлтый (в аддитиве центр всё
   * равно тянет к белому, поэтому база теплее). */
  poolColor: [1, 0.74, 0.16] as [number, number, number],
  /** С этого расстояния свет начинает разгораться, м. */
  lightFadeFrom: 18,
  /** Ближе этого светит в полную силу, м. */
  lightFadeFull: 5,
} as const;

/**
 * Сколько источников ночью раздаём ботам (BotLights). Их создают СРАЗУ за
 * солнцем и небом: материалы берут первые maxSimultaneousLights источников из
 * scene.lights по порядку создания, и в хвосте (за светлячками) факелы не
 * доезжали до мобов, персонажей и деревьев — у тех потолок маленький.
 */
export const BOT_TORCHES = 2;

/**
 * Стайки — постоянным зерном, а не Math.random: раньше при каждой
 * перезагрузке светлячки высыпались в новых местах и потом ещё расплывались
 * по карте (см. driftSpeed — убран); теперь стоят там же, где деревья/трава,
 * все клиенты видят одно и то же. Огоньки внутри стайки по-прежнему вьются
 * на своих локальных орбитах (это и делает их «светлячками», не лампами) —
 * фиксирован только центр.
 */
const FIREFLY_SEED = 20260904;

/** Тот же генератор, что у деревьев/камней/травы. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Сообщить материалам, что набор источников света изменился.
 *
 * Одного `markAllMaterialsAsDirty` мало: материалы зоны приходят
 * замороженными (`checkReadyOnlyOnce`), а замороженный материал шейдер не
 * пересобирает. Замер на проде: у земли ночью в `_lightSources` числились все
 * девять источников, а в скомпилированном шейдере оставалось два и ни одного
 * точечного — сборка была дневная. Поэтому сначала снимаем заморозку.
 *
 * Обратно морозить не надо: Babylon делает это сам, сразу после пересбора.
 * Зовётся дважды за сутки, на рассвете и на закате.
 */
export function relightMaterials(scene: Scene): void {
  for (const m of scene.materials) m.unfreeze();
  scene.markAllMaterialsAsDirty(Constants.MATERIAL_LightDirtyFlag);
}

/**
 * Сколько источников света разом должен тянуть материал:
 * солнце + небо + лампы светлячков + 2 магических (кристалл посоха, огнешар)
 * + факелы ботов ночью.
 */
export const LIGHT_BUDGET = FIREFLY.lamps + 2 + 2 + BOT_TORCHES;

interface Group {
  /** Центр стайки — постоянный (см. GRASS_SEED-подобный FIREFLY_SEED ниже). */
  center: Vector3;
  dots: InstancedMesh[];
  /** Своя фаза у каждого огонька — чтобы вились вразнобой. */
  phase: number[];
  /** Ореол в воздухе — обозначает саму стайку, повёрнут к камере. */
  pool: InstancedMesh;
  /**
   * Запечённое пятно на земле — плоское, статичное, без настоящего света.
   * Обычный клон, не InstancedMesh: его ShaderMaterial не поддерживает
   * инстансинг-атрибуты Babylon (world0..world3), с createInstance()
   * материал молча не готов и пятно вообще не рисуется. Стаек мало
   * (~14), инстансинг тут и не нужен.
   */
  groundGlow: Mesh;
  /** Высота земли под пятном (без учёта height-подстройки) — для GroundGlowTuner. */
  groundBaseY: number;
}

/**
 * Светлячки: ночью по округе висят стайки огоньков и подсвечивают всё
 * вокруг себя, днём исчезают.
 *
 * Огоньки — аппаратные инстансы одного меша (один драв-колл на всех).
 *
 * Светятся ВСЕ стайки, но по-разному. Настоящих источников света всего пара
 * (материалы берут не больше четырёх разом, а солнце и небо уже заняли два),
 * поэтому они достаются ближайшим к игроку. Остальным светимость даёт мягкое
 * пятно на земле под стайкой — со стороны это читается как свет.
 */
/** Лампа, приписанная к стайке. Уровень тянется плавно — без вспышек. */
interface Lamp {
  light: PointLight;
  group: Group | null;
  /** 0..1, тянется к цели; смена стайки разрешена только у самого нуля. */
  level: number;
}

export class Fireflies {
  private readonly groups: Group[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly proto: Mesh;
  private readonly mat: StandardMaterial;
  private readonly poolProto: Mesh;
  private readonly poolMat: StandardMaterial;
  private readonly groundProto: Mesh;
  private readonly groundMat: ShaderMaterial;
  private readonly groundGlowTex: DynamicTexture;
  private readonly unsubGroundGlowTune: () => void;
  private readonly scene: Scene;
  private clock = 0;
  /** Плавная доля ночи: 0 — день, 1 — глубокая ночь. */
  private night = 0;
  /**
   * Ночь ли сейчас показана (стайки/лампы включены) — своё поле, а не
   * `this.proto.isEnabled()`: тот принудительно гасится КАЖДЫЙ кадр строкой
   * ниже (сам прототип не рисуем), поэтому как флаг «было ли уже включено»
   * он всегда врал false, и setVisible(true) — с пересборкой ВСЕХ материалов
   * зоны внутри — звался каждый кадр всю ночь. Была причина тормоза сильнее,
   * чем всё остальное в этом файле: цена не в лишнем источнике, а в
   * ежекадровой перекомпиляции шейдеров земли/травы/деревьев.
   */
  private visible = false;
  /**
   * Сколько ламп (настоящих PointLight) реально включать — лишние гасим.
   * По умолчанию все; урезается на лету (см. setLampBudget), а не при
   * создании, потому что VR/флэт решается уже после того, как зона
   * построена (экран входа идёт после buildZone).
   */
  private lampBudget = Infinity;

  constructor(scene: Scene, terrain: Terrain, density = 1) {
    this.scene = scene;
    const groups = Math.max(0, Math.round(FIREFLY.groups * density));
    this.mat = new StandardMaterial("fireflyMat", scene);
    this.mat.emissiveColor = new Color3(1, 0.97, 0.8); // сам огонёк почти белый
    this.mat.diffuseColor = new Color3(0, 0, 0);
    this.mat.specularColor = new Color3(0, 0, 0);
    this.mat.disableLighting = true;
    this.mat.alpha = 0;

    this.proto = MeshBuilder.CreateSphere("fireflyProto", { diameter: 0.055, segments: 4 }, scene);
    this.proto.material = this.mat;
    this.proto.isPickable = false;
    this.proto.isVisible = false;

    // Светящийся ореол стайки: спрайт в воздухе с мягким радиальным пятном.
    // К камере поворачиваем сами (в update), а не billboardMode — тот в
    // спектраторе с его риг-камерами не всегда срабатывал и спрайт читался
    // белой полосой (виден с ребра).
    this.poolMat = new StandardMaterial("fireflyPoolMat", scene);
    const glow = radialGlow(scene);
    this.poolMat.emissiveTexture = glow;
    this.poolMat.opacityTexture = glow;
    this.poolMat.diffuseColor = new Color3(0, 0, 0);
    this.poolMat.specularColor = new Color3(0, 0, 0);
    this.poolMat.emissiveColor = new Color3(...FIREFLY.poolColor);
    this.poolMat.disableLighting = true;
    this.poolMat.alphaMode = Constants.ALPHA_ADD;
    this.poolMat.disableDepthWrite = true;
    this.poolMat.backFaceCulling = false; // повернётся любой стороной — рисуем обе
    this.poolMat.alpha = 0;

    this.poolProto = MeshBuilder.CreatePlane(
      "fireflyPoolProto",
      { size: FIREFLY.poolRadius * 2 },
      scene,
    );
    this.poolProto.material = this.poolMat;
    this.poolProto.isPickable = false;
    this.poolProto.isVisible = false;
    this.poolProto.renderingGroupId = 0;

    // Запечённое пятно на земле: лежит плашмя и не поворачивается к камере
    // (в отличие от pool) — статичная «подсветка» вместо настоящего
    // PointLight у каждой стайки, кроме ближайших.
    //
    // На StandardMaterial цвет упорно выходил белёсым независимо от
    // emissiveColor/diffuseColor/alpha/освещения (см. комментарий у
    // GROUND_GLOW_SHADER) — минимальный ShaderMaterial: gl_FragColor прямо
    // из текстуры, без скрытых базовых цветов.
    const groundGlowTex = radialGlow(scene, "fireflyGroundGlowTex", GROUND_GLOW_TUNE.color);
    this.groundGlowTex = groundGlowTex;
    this.groundMat = new ShaderMaterial(
      "fireflyGroundMat",
      scene,
      { vertex: GROUND_GLOW_SHADER, fragment: GROUND_GLOW_SHADER },
      {
        attributes: ["position", "uv"],
        uniforms: ["worldViewProjection", "glowAlpha"],
        samplers: ["glowSampler"],
        needAlphaBlending: true,
      },
    );
    this.groundMat.setTexture("glowSampler", groundGlowTex);
    this.groundMat.setFloat("glowAlpha", 0);
    this.groundMat.alphaMode = Constants.ALPHA_COMBINE;
    this.groundMat.disableDepthWrite = true;
    this.groundMat.backFaceCulling = false;

    this.groundProto = MeshBuilder.CreatePlane(
      "fireflyGroundProto",
      { size: FIREFLY.groundGlowRadius * 2 },
      scene,
    );
    this.groundProto.material = this.groundMat;
    this.groundProto.isPickable = false;
    this.groundProto.isVisible = false;
    this.groundProto.renderingGroupId = 0;

    const rnd = rng(FIREFLY_SEED);
    const R = WORLD.grassRadius * 1.6;
    for (let g = 0; g < groups; g++) {
      const a = (g / Math.max(1, groups)) * Math.PI * 2 + rnd();
      const r = 6 + rnd() * R;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const center = new Vector3(x, terrain.heightAt(x, z) + FIREFLY.height, z);

      const dots: InstancedMesh[] = [];
      const phase: number[] = [];
      for (let i = 0; i < FIREFLY.perGroup; i++) {
        const dot = this.proto.createInstance(`firefly${g}_${i}`);
        dot.isPickable = false;
        dots.push(dot);
        phase.push(rnd() * Math.PI * 2);
      }
      const pool = this.poolProto.createInstance(`fireflyPool${g}`);
      pool.isPickable = false;
      pool.position.copyFrom(center);

      // Лежит плашмя, с лёгким наклоном под уклон рельефа против полукруглого
      // среза на склоне — но полный наклон превращает круг в вытянутый эллипс
      // (тоже не круг), поэтому берём максимум ±0.15 рад: смягчает срез на
      // умеренном уклоне, не растягивая пятно на крутом. Приподнимаем заметно
      // выше земли (не 0.03 — было мерцание, но и всё равно резало краем об
      // склон): земля не идеально линейна на радиусе 5.5 м, а с запасом по
      // высоте край плоскости не проваливается под неё.
      //
      // Наклон — не два Euler-угла (rotation.x/z): они друг от друга зависят,
      // и на асимметричном уклоне (X и Z разной величины) простая пара знаков
      // ломалась — проверил вживую (TransformCoordinates по краям плоскости
      // на реальных стайках). Кватернион по нормали земли работает корректно
      // при любом соотношении slopeX/slopeZ.
      const D = 1.2;
      const MAX_TILT = 0.15;
      const slopeX = (terrain.heightAt(x + D, z) - terrain.heightAt(x - D, z)) / (2 * D);
      const slopeZ = (terrain.heightAt(x, z + D) - terrain.heightAt(x, z - D)) / (2 * D);
      const groundBaseY = terrain.heightAt(x, z);
      const groundGlow = this.groundProto.clone(`fireflyGround${g}`);
      groundGlow.isVisible = true;
      groundGlow.isPickable = false;
      groundGlow.rotationQuaternion = groundTiltQuaternion(slopeX, slopeZ, MAX_TILT);
      groundGlow.position.set(x, groundBaseY + GROUND_GLOW_TUNE.height, z);
      const k0 = GROUND_GLOW_TUNE.radius / FIREFLY.groundGlowRadius;
      groundGlow.scaling.set(k0, k0, k0);
      groundGlow.freezeWorldMatrix(); // не двигается — пересчитывать незачем

      this.groups.push({ center, dots, phase, pool, groundGlow, groundBaseY });
    }

    // Раньше лампы не зависели от density вообще: у med (0.7, меньше стаек)
    // всё равно горели все FIREFLY.lamps штук — самая дорогая часть системы
    // (настоящий PointLight на шейдер земли/травы/деревьев) не облегчалась
    // между "средне" и "максимум". Теперь считаем от той же density.
    const lampCount = groups === 0 ? 0 : Math.max(1, Math.round(FIREFLY.lamps * density));
    for (let i = 0; i < lampCount; i++) {
      const lamp = new PointLight(`fireflyLamp${i}`, Vector3.Zero(), scene);
      lamp.diffuse = new Color3(...FIREFLY.lightColor);
      lamp.specular = new Color3(
        FIREFLY.lightColor[0] * 0.3,
        FIREFLY.lightColor[1] * 0.3,
        FIREFLY.lightColor[2] * 0.3,
      );
      lamp.range = FIREFLY.lightRange;
      lamp.intensity = 0;
      lamp.setEnabled(false);
      this.lamps.push({ light: lamp, group: null, level: 0 });
    }

    this.setVisible(false);
    this.unsubGroundGlowTune = onGroundGlowTuneChanged(() => this.applyGroundGlowTune());
  }

  /**
   * Панель `?groundglow=1` (GroundGlowTuner) тронула цвет/радиус/высоту —
   * перекрашиваем общую текстуру на месте и пересчитываем геометрию клонов.
   * Альфа сюда не входит — она и так читается из GROUND_GLOW_TUNE каждый
   * кадр в update().
   */
  private applyGroundGlowTune(): void {
    paintRadialGlow(this.groundGlowTex, GROUND_GLOW_TUNE.color);
    const k = GROUND_GLOW_TUNE.radius / FIREFLY.groundGlowRadius;
    for (const g of this.groups) {
      g.groundGlow.unfreezeWorldMatrix();
      g.groundGlow.scaling.set(k, k, k);
      g.groundGlow.position.y = g.groundBaseY + GROUND_GLOW_TUNE.height;
      g.groundGlow.freezeWorldMatrix();
    }
  }

  private setVisible(on: boolean): void {
    this.visible = on;
    for (const g of this.groups) {
      for (const d of g.dots) d.setEnabled(on);
      g.pool.setEnabled(on);
      g.groundGlow.setEnabled(on);
    }
    // Урезанные setLampBudget'ом лампы остаются погашенными даже с
    // наступлением ночи — иначе этот вызов включил бы их обратно.
    const budget = Math.min(this.lamps.length, this.lampBudget);
    for (let i = 0; i < this.lamps.length; i++) this.lamps[i].light.setEnabled(on && i < budget);
    // Материалы зоны (земля, трава) приходят замороженными и сами шейдер не
    // пересобирают, а набор источников только что изменился. Без этого земля
    // и трава остаются «дневными» — особенно заметно при ручном переводе
    // времени с пульта, когда переход происходит за один кадр. Бюджет 0 —
    // источников не прибавилось, пересборка ничего не даст.
    if (budget > 0) relightMaterials(this.scene);
  }

  /** `daylight` 0..1 из DayState: 1 — день (светлячков нет), 0 — ночь. */
  update(dt: number, playerPos: Vector3, daylight: number): void {
    // Появляются и гаснут плавно, а не щелчком на восходе.
    const wantNight = 1 - daylight;
    this.night += (wantNight - this.night) * Math.min(1, dt * 0.7);

    const on = this.night > 0.02;
    if (on !== this.visible) this.setVisible(on);
    this.proto.setEnabled(false); // сам прототип не рисуем, только инстансы
    if (!on) return;

    this.clock += dt;
    this.mat.alpha = this.night;
    this.poolMat.alpha = this.night * FIREFLY.poolAlpha;
    this.groundMat.setFloat("glowAlpha", this.night * GROUND_GLOW_TUNE.alpha);

    // Центр стайки больше не движется (FIREFLY_SEED, зафиксировано) — его
    // позицию у ореола уже выставили при создании, второй раз копировать
    // незачем.
    const cam = this.scene.activeCamera;
    for (const g of this.groups) {
      // Ореол сам поворачивается лицом к активной камере — надёжнее billboardMode.
      if (cam) g.pool.lookAt(cam.globalPosition);

      // Огоньки вьются вокруг центра по своим орбитам.
      for (let i = 0; i < g.dots.length; i++) {
        const ph = g.phase[i];
        const t = this.clock * (0.6 + (i % 3) * 0.22) + ph;
        g.dots[i].position.set(
          g.center.x + Math.sin(t) * FIREFLY.spread * (0.4 + 0.6 * Math.sin(ph)),
          g.center.y + Math.sin(t * 1.7 + ph) * 0.35,
          g.center.z + Math.cos(t * 0.9 + ph) * FIREFLY.spread,
        );
      }
    }

    this.updateLamps(dt, playerPos);
  }

  /**
   * Урезать бюджет реальных ламп на лету — например, вошли в VR: экран
   * входа идёт уже ПОСЛЕ buildZone, так что VR/флэт не выбрать при
   * создании. Лишние сразу гасим — они же PointLight, каждая лишняя
   * утяжеляет шейдер земли/травы/деревьев/персонажей, а в VR это бьёт
   * вдвое (два глаза) на заметно более слабом GPU шлема.
   */
  setLampBudget(n: number): void {
    this.lampBudget = n;
    for (let i = 0; i < this.lamps.length; i++) {
      if (i >= n) {
        this.lamps[i].light.setEnabled(false);
        this.lamps[i].light.intensity = 0;
      } else if (this.night > 0.02) {
        this.lamps[i].light.setEnabled(true);
      }
    }
  }

  /**
   * Настоящий свет достаётся ближайшим к игроку стайкам.
   *
   * Лампа не перескакивает на новую стайку сразу: сперва гаснет на старой и
   * только у самого нуля меняет хозяина. Иначе при ходьбе свет вспыхивал
   * разом, когда набор ближайших менялся.
   */
  private updateLamps(dt: number, playerPos: Vector3): void {
    const budget = Math.min(this.lamps.length, this.lampBudget);
    const nearest = [...this.groups]
      .sort(
        (a, b) =>
          Vector3.DistanceSquared(a.center, playerPos) -
          Vector3.DistanceSquared(b.center, playerPos),
      )
      .slice(0, budget);

    const k = 1 - Math.exp(-dt * 2.5); // скорость плавного перехода
    const taken = new Set(this.lamps.map((l) => l.group).filter(Boolean));

    for (let li = 0; li < this.lamps.length; li++) {
      const lamp = this.lamps[li];
      if (li >= budget) continue; // урезано — уже погашена в setLampBudget
      const keeps = lamp.group !== null && nearest.includes(lamp.group);

      // Своя стайка уехала из ближайших — гасим, а не переключаемся рывком.
      if (!keeps && lamp.level < 0.02) {
        const free = nearest.find((g) => !taken.has(g));
        if (free) {
          taken.delete(lamp.group);
          lamp.group = free;
          taken.add(free);
        }
      }

      const g = lamp.group;
      const stillNear = g !== null && nearest.includes(g);
      let target = 0;
      if (g && stillNear) {
        const dist = Vector3.Distance(g.center, playerPos);
        const span = FIREFLY.lightFadeFrom - FIREFLY.lightFadeFull;
        const t = clamp01((FIREFLY.lightFadeFrom - dist) / span);
        target = t * t * (3 - 2 * t); // сглаживаем концы, чтобы не было ступеньки
      }
      lamp.level += (target - lamp.level) * k;

      if (g) lamp.light.position.copyFrom(g.center);
      const flicker = 0.85 + 0.15 * Math.sin(this.clock * 3 + li);
      lamp.light.intensity = FIREFLY.lightIntensity * this.night * flicker * lamp.level;
    }
  }

  dispose(): void {
    this.unsubGroundGlowTune();
    for (const g of this.groups) {
      for (const d of g.dots) d.dispose();
      g.pool.dispose();
      g.groundGlow.dispose();
    }
    for (const l of this.lamps) l.light.dispose();
    this.proto.dispose();
    this.poolProto.dispose();
    this.groundProto.dispose();
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Поворот пятна на земле под уклон рельефа — прямым выравниванием нормали
 * плоскости (дефолт CreatePlane — локальная +Z) по нормали земли, а не
 * парой Euler-углов (rotation.x/z): те друг от друга зависят, и на
 * асимметричном уклоне (X и Z разной величины) пара фиксированных знаков
 * давала наклон в другую сторону. Проверено вживую (TransformCoordinates по
 * краям плоскости на реальных стайках, все комбинации знаков) — этот
 * способ даёт верный знак при любом соотношении slopeX/slopeZ.
 */
function groundTiltQuaternion(slopeX: number, slopeZ: number, maxTilt: number): Quaternion {
  const tiltX = Math.max(-maxTilt, Math.min(maxTilt, Math.atan(slopeX)));
  const tiltZ = Math.max(-maxTilt, Math.min(maxTilt, Math.atan(slopeZ)));
  const tangentX = new Vector3(Math.cos(tiltX), Math.sin(tiltX), 0);
  const tangentZ = new Vector3(0, Math.sin(tiltZ), Math.cos(tiltZ));
  const normal = Vector3.Cross(tangentX, tangentZ);
  if (normal.lengthSquared() < 1e-9) return Quaternion.Identity();
  normal.normalize();
  const from = new Vector3(0, 0, 1); // дефолтная локальная нормаль CreatePlane
  const axis = Vector3.Cross(from, normal);
  if (axis.lengthSquared() < 1e-9) return Quaternion.Identity();
  axis.normalize();
  const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(from, normal))));
  return Quaternion.RotationAxis(axis, angle);
}

/**
 * Круглое пятно, плавно тающее к краям. Прозрачность падает по степени
 * расстояния и набирается многими остановками — иначе у края видно кольцо
 * или резкий обрыв.
 */
export function radialGlow(
  scene: Scene,
  name = "fireflyGlow",
  rgb: readonly [number, number, number] = [1, 1, 1],
): DynamicTexture {
  const S = 256;
  const tex = new DynamicTexture(name, { width: S, height: S }, scene, false);
  tex.hasAlpha = true;
  paintRadialGlow(tex, rgb);
  return tex;
}

/** Перекрашивает уже существующую текстуру — для живой правки (GroundGlowTuner). */
export function paintRadialGlow(tex: DynamicTexture, rgb: readonly [number, number, number]): void {
  const { width: S, height: S2 } = tex.getSize();
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, S, S2);
  const grad = ctx.createRadialGradient(S / 2, S2 / 2, 0, S / 2, S2 / 2, Math.min(S, S2) / 2);
  const [cr, cg, cb] = [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)];
  const STOPS = 24;
  for (let i = 0; i <= STOPS; i++) {
    const r = i / STOPS;
    const a = Math.pow(1 - r, 2.4); // мягкий, чуть более наполненный к центру спад
    grad.addColorStop(r, `rgba(${cr},${cg},${cb},${a.toFixed(4)})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S2);
  tex.update(true);
}
