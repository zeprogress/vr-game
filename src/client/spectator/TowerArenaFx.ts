import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Light } from "@babylonjs/core/Lights/light";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";

import { PLAYER } from "#shared/constants";
import { TOWER, TOWER_HIDE, floorMonster } from "#shared/tower";
import { loadRig, recolorMonster, type ModelName, type RigInstance } from "../world/models";
import { protoFor as shadowProtoFor } from "../world/blobShadow";
import { NameTag } from "../ui/NameTag";
import { TOWER_LIGHT_TUNE } from "./towerLightTune";
import type { Sfx } from "../audio/Sfx";

/** Плоский пол арены — своя тень без наклона по рельефу (см. blobShadow.ts). */
const SHADOW_PROTO_SIZE = 2;

/** Мобов на арене одновременно — с запасом (см. floorMobCount, максимум 10). */
const MAX_MOBS = 10;

interface Palette {
  floor: readonly [number, number, number];
  wall: readonly [number, number, number];
  ceiling: readonly [number, number, number];
  light: readonly [number, number, number];
  intensity: number;
}

/** Тянет цвет к своей серой середине — менее «кислотная» палитра (по просьбе). */
function desat(c: readonly [number, number, number], amt: number): readonly [number, number, number] {
  const avg = (c[0] + c[1] + c[2]) / 3;
  return [c[0] + (avg - c[0]) * amt, c[1] + (avg - c[1]) * amt, c[2] + (avg - c[2]) * amt];
}
const DESAT = 0.4;

/** Своя палитра+свет на каждый этаж (по кругу) — чтобы этажи ощущались разными. */
const PALETTES: readonly Palette[] = (
  [
    { floor: [0.42, 0.42, 0.46], wall: [0.3, 0.3, 0.34], ceiling: [0.22, 0.22, 0.25], light: [0.85, 0.85, 0.95], intensity: 1.1 }, // камень
    { floor: [0.5, 0.16, 0.1], wall: [0.32, 0.11, 0.08], ceiling: [0.18, 0.06, 0.05], light: [1, 0.45, 0.15], intensity: 1.4 }, // лава
    { floor: [0.22, 0.4, 0.55], wall: [0.16, 0.28, 0.4], ceiling: [0.1, 0.18, 0.28], light: [0.4, 0.75, 1], intensity: 1.2 }, // лёд
    { floor: [0.2, 0.38, 0.18], wall: [0.14, 0.26, 0.13], ceiling: [0.08, 0.16, 0.08], light: [0.55, 1, 0.45], intensity: 1.0 }, // заросли
    { floor: [0.58, 0.54, 0.46], wall: [0.4, 0.37, 0.3], ceiling: [0.26, 0.24, 0.2], light: [1, 0.95, 0.8], intensity: 1.2 }, // кость
    { floor: [0.28, 0.14, 0.38], wall: [0.18, 0.08, 0.26], ceiling: [0.1, 0.04, 0.16], light: [0.75, 0.35, 1], intensity: 1.3 }, // пустота
  ] as const
).map((p) => ({
  floor: desat(p.floor, DESAT),
  wall: desat(p.wall, DESAT),
  ceiling: desat(p.ceiling, DESAT),
  light: desat(p.light, DESAT * 0.6), // свет чуть меньше — не терять цвет прожектора/сцены совсем
  intensity: p.intensity,
}));

interface ModelPlacement {
  inst: RigInstance;
  holder: TransformNode;
  /** НЕ масштабированный узел для таблички — holder.scaling разный у разных
   *  моделей (нативная высота модели отличается), и табличка на holder
   *  "плавала" по высоте/размеру от этажа к этажу. Якорь всегда scale=1. */
  anchor: TransformNode;
  tag: NameTag;
  attackAnim: AnimationGroupLike | null;
  lastAtkPulse: boolean;
  /** holder.scaling базовый множитель (targetHeight/nativeHeight) — поверх него
   *  накладывается процедурный «замах» (см. applyAttackSquash), не заменяя его. */
  baseScale: number;
  /** Секунд осталось у текущего замаха — 0 значит «стоит спокойно». */
  atkT: number;
  /** Плавно 0..1 — насколько сильно горит (Пламенный меч), как в Mob.ts. */
  burnGlow: number;
  burnFx: TransformNode | null;
  burnMat: StandardMaterial | null;
  burnFlames: Mesh[];
  burnT: number;
  /** Тёмное пятно под ногами — как у мобов на поляне (BlobShadow), но без наклона: пол плоский. */
  shadow: InstancedMesh;
}

/** Достаточно play()/stop() — тащить весь тип AnimationGroup незачем. */
interface AnimationGroupLike {
  play(loop?: boolean): void;
  stop(): void;
}

/** Летящий «снаряд» дальнего моба к герою — просто светящийся шарик, без хитрегистрации. */
interface Projectile {
  /** Родитель core+glow — двигаем один узел, а не два меша по отдельности. */
  holder: TransformNode;
  core: Mesh;
  glow: Mesh;
  from: Vector3;
  to: Vector3;
  t: number;
  dur: number;
}

/** Вспышка попадания снаряда — расширяется и гаснет, как огнешар в основном мире. */
interface ImpactBurst {
  mesh: Mesh;
  age: number;
  life: number;
}

/** Длительность процедурного замаха — то же значение, что и в Mob.ts. */
const ATTACK_DUR = 0.36;

export interface TowerLiveMob {
  x: number;
  z: number;
  yaw: number;
  hpFrac: number;
  boss: boolean;
  atkPulse: boolean;
  ranged: boolean;
  burning: boolean;
}

/**
 * Визуал «Охотничьей башни» — ОДНА постоянная арена в фиксированной точке
 * карты (TOWER_HIDE): герой и мобы реально бегают внутри нею (позиции
 * приходят с сервера тик в тик), сам зал — просторный (см. TOWER.arena) с
 * полом/стенами/потолком и своим освещением на этаж. Одновременно активен
 * максимум один забег — отдельный «риг на игрока» тут не нужен.
 */
export class TowerArenaFx {
  private built = false;
  private root!: TransformNode;
  private floorMesh!: Mesh;
  private wallMesh!: Mesh;
  private ceilMesh!: Mesh;
  private floorMat!: StandardMaterial;
  private wallMat!: StandardMaterial;
  private ceilMat!: StandardMaterial;
  private light!: PointLight;
  /** Прожектор с потолка — статичная точка подвеса, лучом жёстко следит за героем. */
  private spot!: SpotLight;
  private heroShadow!: InstancedMesh;
  private label!: Mesh;
  private labelTex!: DynamicTexture;

  private lastFloor = -1;
  private wasActive = false;
  private lastHeroId = "";
  private modelName = "";
  private loadSeq = 0;
  private mobModels: (ModelPlacement | null)[] = new Array(MAX_MOBS).fill(null);
  private bossModel: ModelPlacement | null = null;
  private projectiles: Projectile[] = [];
  private coreMat: StandardMaterial | null = null;
  private glowMat: StandardMaterial | null = null;
  private bursts: ImpactBurst[] = [];
  private burstMat: StandardMaterial | null = null;
  /** Высота стен текущей арены — нужна прожектору, чтобы пересчитать позицию live (тюнер). */
  private arenaH = 0;
  /** "Родные" emissiveColor мобов (recolorMonster) — чтобы тюнер мог их живо гасить/включать. */
  private mobEmissiveMats: { mat: StandardMaterial; base: Color3 }[] = [];

  constructor(
    private readonly scene: Scene,
    /** Для звука выстрела/попадания дальних мобов — тот же Sfx, что и у остальной сцены. */
    private readonly sfx: Sfx,
  ) {}

  /**
   * Мировые огни (солнце/заполняющий/ночной — DayTime, Sky и т.п.) не знают
   * про арену и без этого заливали бы её поверх нашего "почти ночь" — у них
   * нет includedOnlyMeshes (это огни НА ВСЮ сцену). Единственный встречный
   * рычаг — excludedMeshes самого света. Не трогаем НАШИ огни (this.light/
   * this.spot) — их и так ограничивает includedOnlyMeshes.
   */
  private excludeFromWorldLight(l: Light, mesh: AbstractMesh): void {
    if (l === this.light || l === (this.spot as Light | undefined)) return;
    if (l.excludedMeshes.indexOf(mesh) === -1) l.excludedMeshes.push(mesh);
  }

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    const R = TOWER.arena.radius;
    const H = TOWER.arena.wallHeight;
    this.arenaH = H;
    // Локальный y=0 — пол ПОД НОГАМИ героя (его голова синхронна TOWER_HIDE.y).
    this.root = new TransformNode("towerArena", this.scene);
    this.root.position.set(TOWER_HIDE.x, TOWER_HIDE.y - PLAYER.eyeHeight, TOWER_HIDE.z);

    this.floorMat = new StandardMaterial("towerFloorMat", this.scene);
    this.floorMat.specularColor = new Color3(0, 0, 0);
    this.floorMesh = MeshBuilder.CreateDisc("towerFloor", { radius: R, tessellation: 48 }, this.scene);
    this.floorMesh.rotation.x = Math.PI / 2; // нормаль вверх
    this.floorMesh.parent = this.root;
    this.floorMesh.isPickable = false;
    this.floorMesh.material = this.floorMat;

    this.wallMat = new StandardMaterial("towerWallMat", this.scene);
    this.wallMat.specularColor = new Color3(0, 0, 0);
    this.wallMat.backFaceCulling = false; // смотрим изнутри цилиндра
    // Высота чуть больше H: торцы цилиндра (его собственные "крышки") уходят
    // за пределы пола/потолка вместо совпадения с ними в одной плоскости —
    // иначе это z-fighting и пол/потолок заметно мерцают.
    this.wallMesh = MeshBuilder.CreateCylinder(
      "towerWall",
      { diameter: R * 2, height: H + 0.4, tessellation: 32, sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    this.wallMesh.position.y = H / 2;
    this.wallMesh.parent = this.root;
    this.wallMesh.isPickable = false;
    this.wallMesh.material = this.wallMat;

    this.ceilMat = new StandardMaterial("towerCeilMat", this.scene);
    this.ceilMat.specularColor = new Color3(0, 0, 0);
    this.ceilMat.backFaceCulling = false; // смотрим снизу
    this.ceilMesh = MeshBuilder.CreateDisc("towerCeil", { radius: R, tessellation: 48 }, this.scene);
    this.ceilMesh.rotation.x = -Math.PI / 2;
    this.ceilMesh.position.y = H;
    this.ceilMesh.parent = this.root;
    this.ceilMesh.isPickable = false;
    this.ceilMesh.material = this.ceilMat;

    // includedOnlyMeshes на НАШИХ огнях защищает основной мир от них — но не
    // наоборот: солнце/дневной свет сцены глобальны (без includedOnlyMeshes)
    // и всё равно заливали бы пол/стены/потолок поверх "почти ночи" ниже.
    // Исключаем нашу геометрию из ВСЕХ уже существующих огней сцены разом.
    for (const l of this.scene.lights) {
      this.excludeFromWorldLight(l, this.floorMesh);
      this.excludeFromWorldLight(l, this.wallMesh);
      this.excludeFromWorldLight(l, this.ceilMesh);
    }

    // Один источник света на всю арену — не задевает основной мир и его
    // материалы (includedOnlyMeshes), пересоздавать на каждый этаж не
    // надо — просто перекрашиваем/двигаем (см. applyPalette). Приглушённый
    // ("почти ночь") — по просьбе; applyPalette домножает на NIGHT_MUL.
    this.light = new PointLight("towerLight", new Vector3(0, H * 0.55, 0), this.scene);
    this.light.parent = this.root;
    this.light.includedOnlyMeshes = [this.floorMesh, this.wallMesh, this.ceilMesh];
    this.light.range = R * 2.2;

    // Прожектор с потолка: висит СТАТИЧНО (позиция не меняется), только
    // разворачивает луч на героя — жёсткий яркий конус (узкий угол, без
    // мягкого спада exponent), единственный по-настоящему яркий источник
    // в комнате. Не задевает основной мир — та же includedOnlyMeshes-защита.
    this.spot = new SpotLight(
      "towerSpot",
      new Vector3(0, H - TOWER_LIGHT_TUNE.spotHeightOffset, 0),
      new Vector3(0, -1, 0),
      (TOWER_LIGHT_TUNE.spotAngleDeg * Math.PI) / 180,
      TOWER_LIGHT_TUNE.spotExponent,
      this.scene,
    );
    this.spot.parent = this.root;
    this.spot.includedOnlyMeshes = [this.floorMesh, this.wallMesh];
    this.spot.diffuse = new Color3(1, 0.98, 0.92);
    this.spot.specular = new Color3(1, 0.98, 0.92);
    this.spot.intensity = TOWER_LIGHT_TUNE.spotIntensity;
    this.spot.range = H * 1.3;

    this.heroShadow = shadowProtoFor(this.scene).createInstance("towerHeroShadow");
    this.heroShadow.parent = this.root;
    this.heroShadow.rotation.x = Math.PI / 2; // пол плоский — наклон по рельефу не нужен
    this.heroShadow.isPickable = false;
    const heroShadowD = (PLAYER.eyeHeight * 0.9 * 2) / SHADOW_PROTO_SIZE;
    this.heroShadow.scaling.setAll(heroShadowD);

    const labelTex = new DynamicTexture("towerArenaLabelTex", { width: 256, height: 64 }, this.scene, false);
    labelTex.hasAlpha = true;
    this.labelTex = labelTex;
    const labelMat = new StandardMaterial("towerArenaLabelMat", this.scene);
    labelMat.diffuseTexture = labelTex;
    labelMat.emissiveTexture = labelTex;
    labelMat.opacityTexture = labelTex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.disableLighting = true;
    labelMat.specularColor = new Color3(0, 0, 0);
    labelMat.backFaceCulling = false;
    this.label = MeshBuilder.CreatePlane("towerArenaLabel", { width: 4, height: 1 }, this.scene);
    this.label.parent = this.root;
    this.label.position.set(0, H * 0.4, -(R - 0.3));
    this.label.billboardMode = Mesh.BILLBOARDMODE_Y;
    this.label.isPickable = false;
    this.label.material = labelMat;
  }

  /** Простая процедурная «крапинка» на тон палитры — не плоская заливка. */
  private buildTileTexture(name: string, base: readonly [number, number, number], variant: number): DynamicTexture {
    const S = 128;
    const tex = new DynamicTexture(name, { width: S, height: S }, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const [r, g, b] = base.map((c) => Math.round(c * 255));
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, S, S);
    // Псевдослучайные крапинки/трещины — детерминировано по variant, чтобы
    // одна и та же палитра всегда давала одну и ту же текстуру (кэш ниже).
    let seed = variant * 9301 + 49297;
    const rnd = (): number => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const rad = 1 + rnd() * 2.4;
      const shade = 0.65 + rnd() * 0.5;
      ctx.fillStyle = `rgba(${Math.min(255, r * shade)},${Math.min(255, g * shade)},${Math.min(255, b * shade)},0.55)`;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }
    // Лёгкая сетка стыков — читается как кладка/панели, не голая заливка.
    ctx.strokeStyle = `rgba(0,0,0,0.18)`;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const p = (i / 4) * S;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
    }
    tex.update(false);
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    return tex;
  }

  private readonly texCache = new Map<string, DynamicTexture>();
  private cachedTex(key: string, base: readonly [number, number, number], variant: number): DynamicTexture {
    let t = this.texCache.get(key);
    if (!t) {
      t = this.buildTileTexture(key, base, variant);
      this.texCache.set(key, t);
    }
    return t;
  }

  private applyPalette(floor: number): void {
    const idx = (floor - 1) % PALETTES.length;
    const pal = PALETTES[idx];
    const R = TOWER.arena.radius;
    const H = TOWER.arena.wallHeight;

    const floorTex = this.cachedTex(`towerFloorTex_${idx}`, pal.floor, idx * 3);
    floorTex.uScale = R / 3;
    floorTex.vScale = R / 3;
    this.floorMat.diffuseTexture = floorTex;
    // Эмиссив — весь через тюнер (TOWER_LIGHT_TUNE), по умолчанию 0 (убрали
    // собственное свечение по просьбе): видимость держат только light+spot.
    const t = TOWER_LIGHT_TUNE;
    this.floorMat.emissiveColor.copyFromFloats(pal.floor[0] * t.floorEmissive, pal.floor[1] * t.floorEmissive, pal.floor[2] * t.floorEmissive);

    const wallTex = this.cachedTex(`towerWallTex_${idx}`, pal.wall, idx * 3 + 1);
    wallTex.uScale = (2 * Math.PI * R) / 6;
    wallTex.vScale = H / 4;
    this.wallMat.diffuseTexture = wallTex;
    this.wallMat.emissiveColor.copyFromFloats(pal.wall[0] * t.wallEmissive, pal.wall[1] * t.wallEmissive, pal.wall[2] * t.wallEmissive);

    const ceilTex = this.cachedTex(`towerCeilTex_${idx}`, pal.ceiling, idx * 3 + 2);
    ceilTex.uScale = R / 3;
    ceilTex.vScale = R / 3;
    this.ceilMat.diffuseTexture = ceilTex;
    this.ceilMat.emissiveColor.copyFromFloats(pal.ceiling[0] * t.ceilEmissive, pal.ceiling[1] * t.ceilEmissive, pal.ceiling[2] * t.ceilEmissive);

    this.light.diffuse.copyFromFloats(pal.light[0], pal.light[1], pal.light[2]);
    this.light.specular.copyFromFloats(pal.light[0], pal.light[1], pal.light[2]);
    // Почти ночь — общий свет сильно приглушён (см. TOWER_LIGHT_TUNE.nightMul),
    // видимость держит эмиссив материалов (по умолчанию 0) плюс прожектор.
    this.light.intensity = pal.intensity * t.nightMul;
  }

  /** Прожектор — угол/резкость/яркость/высота подвеса, всё из тюнера. */
  private applySpotTune(): void {
    if (!this.built) return;
    const t = TOWER_LIGHT_TUNE;
    this.spot.angle = (t.spotAngleDeg * Math.PI) / 180;
    this.spot.exponent = t.spotExponent;
    this.spot.intensity = t.spotIntensity;
    this.spot.position.y = this.arenaH - t.spotHeightOffset;
  }

  /** Возвращает "родное" (recolorMonster) свечение мобов, домноженное на тюнер. */
  private refreshMobEmissive(): void {
    const mul = TOWER_LIGHT_TUNE.mobEmissiveMul;
    for (const { mat, base } of this.mobEmissiveMats) {
      mat.emissiveColor.copyFrom(base).scaleInPlace(mul);
    }
  }

  /**
   * Публичный хук для панели `?towerlight=1` (см. towerLightTune.ts) — переприменить
   * ВСЁ освещение без пересоздания арены/перезагрузки моделей: свет+прожектор
   * сразу, эмиссив пола/стен/потолка через принудительный re-apply палитры.
   */
  refreshLighting(): void {
    if (!this.built) return;
    this.applySpotTune();
    this.refreshMobEmissive();
    if (this.lastFloor > 0) this.applyPalette(this.lastFloor);
  }

  private paintLabel(floor: number): void {
    const ctx = this.labelTex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = "700 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(240,240,245,0.95)";
    ctx.fillText(`Этаж ${floor}`, 128, 34);
    this.labelTex.update();
  }

  /**
   * Догрузить модель этажа (см. FLOOR_MONSTERS) и подменить ею предыдущую —
   * асинхронно, с защитой от гонки (этаж мог смениться ещё раз, пока модель
   * грузилась). Пока не готово (или если не удалось) — слот просто скрыт,
   * не заглушка-кубик: пространство важнее, чем всегда что-то показывать.
   */
  private async loadFloorModel(floor: number): Promise<void> {
    const fm = floorMonster(floor);
    const mySeq = ++this.loadSeq;
    let make: (() => RigInstance) | null = null;
    try {
      make = await loadRig(this.scene, fm.model as ModelName);
    } catch {
      return;
    }
    if (this.loadSeq !== mySeq) return; // этаж успел смениться ещё раз

    this.disposeModels();
    this.modelName = fm.model;
    // Мобы/боссы растут от этажа к этажу — ×1 на первом, ×3 на последнем (по просьбе).
    const growth = 1 + ((floor - 1) / Math.max(1, TOWER.floors - 1)) * 2;
    const mobHeight = 1.1 * growth;
    for (let i = 0; i < MAX_MOBS; i++) {
      const p = this.placeModel(make(), mobHeight, fm.name, floor);
      p.holder.setEnabled(false);
      p.anchor.setEnabled(false);
      this.mobModels[i] = p;
    }
    this.bossModel = this.placeModel(make(), mobHeight * TOWER.bossScaleMul, `${fm.name} (босс этажа)`, floor);
    this.bossModel.holder.setEnabled(false);
    this.bossModel.anchor.setEnabled(false);
  }

  private placeModel(inst: RigInstance, targetHeight: number, name: string, level: number): ModelPlacement {
    const holder = new TransformNode("towerModelHolder", this.scene);
    holder.parent = this.root;
    inst.root.parent = holder;
    inst.root.position.set(0, 0, 0);
    const base = targetHeight / (inst.nativeHeight || 1);
    holder.scaling.setAll(base);
    recolorMonster(inst.root);
    // recolorMonster сам красит модели свечением (emissiveColor) — в башне
    // это читалось как "свои" мобы светятся сами по себе, независимо от
    // комнатного освещения. Гасим/включаем через тюнер (0 по умолчанию —
    // самосвет убран по просьбе), не трогая сам recolorMonster (общий код).
    const seenMat = new Set<StandardMaterial>();
    for (const mesh of inst.root.getChildMeshes(false)) {
      // Мировые огни (солнце и т.п.) без этого заливали бы моба поверх
      // "почти ночь" — та же причина, что и у пола/стен (см. ensureBuilt).
      for (const l of this.scene.lights) this.excludeFromWorldLight(l, mesh);
      // Прожектор должен реально подсвечивать моба, когда луч на нём —
      // раньше includedOnlyMeshes был только пол/стены, мобы стрелка не
      // задевала вообще (они читались тёмным силуэтом всегда).
      this.spot.includedOnlyMeshes?.push(mesh);
      // Мобы вне луча прожектора должны получать хотя бы тусклый общий
      // свет комнаты (this.light) — иначе на них не остаётся НИ ОДНОГО
      // действующего огня, и Babylon в этом случае рендерит StandardMaterial
      // как будто без освещения вовсе: ПОЛНЫЙ diffuseColor без затемнения
      // (тот самый "самосвет" — на деле баг движка на нулевом наборе огней,
      // а не наше emissive, оно и так было 0). Добавляем — даже совсем
      // тусклый (nightMul=0) реальный источник не даёт сработать фолбэку.
      this.light.includedOnlyMeshes?.push(mesh);
      const mat = mesh.material as StandardMaterial | null;
      if (!mat || seenMat.has(mat)) continue;
      seenMat.add(mat);
      this.mobEmissiveMats.push({ mat, base: mat.emissiveColor.clone() });
      mat.emissiveColor.scaleInPlace(TOWER_LIGHT_TUNE.mobEmissiveMul);
    }
    const moveAnim = inst.anims.get("walk") ?? inst.anims.get("idle") ?? inst.anims.get("hop") ?? null;
    moveAnim?.play(true);
    const attackAnim =
      inst.anims.get("attack") ?? inst.anims.get("bite") ?? inst.anims.get("hit") ?? null;

    // Табличка — на СВОЁМ узле (scale=1), не на holder: holder масштабирован
    // по nativeHeight конкретной модели (разная у разных мобов), и табличка
    // на нём "плавала" по высоте/размеру от этажа к этажу.
    const anchor = new TransformNode("towerTagAnchor", this.scene);
    anchor.parent = this.root;
    // У высоких боссов (растут до x3 к этажу x3 масштаба самого босса) плашка
    // на уровне "рост+0.6" улетала выше камеры и была не видна спектатору —
    // ограничиваем потолком, дальше она просто ниже макушки, не выше её.
    const tagY = Math.min(targetHeight + 0.6, 3.2);
    const tag = new NameTag(this.scene, anchor, new Vector3(0, tagY, 0), name, level);
    tag.showHp();

    // Тень под ногами — на анкоре (scale=1), не на holder, по той же причине,
    // что и табличка: иначе пятно "плавало" бы по размеру вместе с моделью.
    const shadow = shadowProtoFor(this.scene).createInstance("towerMobShadow");
    shadow.parent = anchor;
    shadow.rotation.x = Math.PI / 2;
    shadow.isPickable = false;
    shadow.position.y = 0.02;
    shadow.scaling.setAll((targetHeight * 0.7 * 2) / SHADOW_PROTO_SIZE);

    return {
      inst, holder, anchor, tag, attackAnim, lastAtkPulse: false,
      baseScale: base, atkT: 0, burnGlow: 0, burnFx: null, burnMat: null, burnFlames: [], burnT: 0,
      shadow,
    };
  }

  /**
   * НЕ вызываем inst.dispose() (models.ts): тот делает root.dispose(false, true)
   * — сносит материалы/текстуры меша. loadRig грузит через instantiateModelsToScene
   * с cloneMaterials=false (см. models.ts), т.е. материал у ВСЕХ инстансов одной
   * модели — ОДИН и тот же объект на весь контейнер (общий на всю сцену,
   * закэширован в containerFor). Снос "своих" материалов при обычном dispose()
   * ломал материал для всех будущих мобов этой модели — ровно то самое
   * "модельки не прогружаются после первого прохождения" (второй забег
   * повторно упирается в тот же вид на этаже 1 — монстр уже без материала).
   * Анимации/скелет per-инстансные — их гасим отдельно, геометрию сносим
   * БЕЗ материалов (root.dispose(false, false)).
   */
  private disposeRigInstance(inst: RigInstance): void {
    inst.anims.forEach((g) => g.dispose());
    inst.root.dispose(false, false);
  }

  private disposeModels(): void {
    // Прожектор и общий свет копили ссылки на мешей моба в includedOnlyMeshes
    // (см. placeModel) — сбрасываем перед сносом старых моделей, иначе
    // список рос бы бесконечно мёртвыми ссылками с каждым этажом.
    if (this.spot) this.spot.includedOnlyMeshes = [this.floorMesh, this.wallMesh];
    if (this.light) this.light.includedOnlyMeshes = [this.floorMesh, this.wallMesh, this.ceilMesh];
    for (const p of this.mobModels) {
      p?.tag.dispose();
      if (p) this.disposeRigInstance(p.inst);
      p?.holder.dispose();
      p?.anchor.dispose();
      p?.burnMat?.dispose();
    }
    this.mobModels.fill(null);
    if (this.bossModel) {
      this.bossModel.tag.dispose();
      this.disposeRigInstance(this.bossModel.inst);
      this.bossModel.holder.dispose();
      this.bossModel.anchor.dispose();
      this.bossModel.burnMat?.dispose();
      this.bossModel = null;
    }
    this.modelName = "";
    this.mobEmissiveMats.length = 0;
  }

  /**
   * Замах: проиграть боевую анимацию раз, если у модели она реально есть
   * (у большинства паковских мобов — нет, см. mob-visuals.md), и ВСЕГДА —
   * процедурный squash поверх holder.scaling (как в основном мире, Mob.ts),
   * иначе на моделях без клипа атака вообще незаметна.
   */
  private pulseAttack(p: ModelPlacement, pulse: boolean, ranged: boolean): void {
    if (pulse && !p.lastAtkPulse) {
      p.attackAnim?.play(false);
      p.atkT = ATTACK_DUR;
    }
    p.lastAtkPulse = pulse;
    if (p.atkT > 0) {
      const t = 1 - p.atkT / ATTACK_DUR; // 0 → 1 за время замаха
      let x = 1, y = 1, z = 1;
      if (ranged) {
        const jab = Math.sin(Math.min(1, t * 1.5) * Math.PI);
        x = 1 - jab * 0.16; y = 1 - jab * 0.22; z = 1 + jab * 0.36;
      } else {
        const wind = t < 0.28 ? Math.sin((t / 0.28) * Math.PI) : 0;
        const lunge = t >= 0.2 ? Math.sin(Math.min(1, (t - 0.2) / 0.8) * Math.PI) : 0;
        z = 1 - wind * 0.16 + lunge * 0.62;
        x = 1 + wind * 0.1 - lunge * 0.4;
        y = x;
      }
      p.holder.scaling.set(x * p.baseScale, y * p.baseScale, z * p.baseScale);
    } else {
      p.holder.scaling.setAll(p.baseScale);
    }
  }

  /** Тик замаха/горения — общий для мобов и босса, зовётся каждый кадр. */
  private tickModelFx(p: ModelPlacement, dt: number, burning: boolean): void {
    if (p.atkT > 0) p.atkT = Math.max(0, p.atkT - dt);
    p.burnGlow = burning
      ? Math.min(1, p.burnGlow + dt * 5)
      : Math.max(0, p.burnGlow - dt * 3);
    this.updateBurnFx(p, dt);
  }

  /** Языки пламени над горящим мобом — тот же приём, что и в основном мире (Mob.ts). */
  private updateBurnFx(p: ModelPlacement, dt: number): void {
    if (p.burnGlow <= 0.001) {
      p.burnFx?.setEnabled(false);
      return;
    }
    if (!p.burnFx) {
      const scene = this.scene;
      p.burnFx = new TransformNode("towerMobBurn", scene);
      p.burnFx.parent = p.holder;
      p.burnMat = new StandardMaterial("towerMobBurnMat", scene);
      p.burnMat.disableLighting = true;
      p.burnMat.diffuseColor = new Color3(0, 0, 0);
      p.burnMat.specularColor = new Color3(0, 0, 0);
      p.burnMat.emissiveColor = new Color3(1, 0.5, 0.12);
      p.burnMat.alphaMode = Constants.ALPHA_ADD;
      p.burnMat.disableDepthWrite = true;
      for (let i = 0; i < 5; i++) {
        const f = MeshBuilder.CreatePlane(`towerMobFlame${i}`, { size: 1 }, scene);
        f.material = p.burnMat;
        f.isPickable = false;
        f.billboardMode = Mesh.BILLBOARDMODE_Y;
        f.renderingGroupId = 1;
        const a = (i / 5) * Math.PI * 2;
        f.position.set(Math.cos(a) * 0.4, 0.3, Math.sin(a) * 0.4);
        f.parent = p.burnFx;
        p.burnFlames.push(f);
      }
    }
    p.burnFx.setEnabled(true);
    p.burnT += dt;
    for (let i = 0; i < p.burnFlames.length; i++) {
      const f = p.burnFlames[i];
      const ph = p.burnT * 7 + i * 1.7;
      const rise = (p.burnT * 1.8 + i * 0.37) % 1;
      f.position.y = 0.1 + rise * 1.1;
      const s = (1 - rise) * (0.7 + 0.5 * Math.sin(ph)) * p.burnGlow;
      f.scaling.setAll(Math.max(0.05, s));
    }
    if (p.burnMat) p.burnMat.alpha = 0.55 * p.burnGlow;
  }

  /** Снаряд дальнего моба — светящийся шарик, летит к герою и исчезает. */
  /**
   * Снаряд дальнего моба — ядро+свечение, как настоящий firebolt/стрела в
   * основном мире (см. MobSystem.ts, тот же приём: core sphere + billboard
   * glow plane). Раньше был один плоский шарик без свечения — "не видно
   * как обычно". По прилёту — вспышка+звук (spawnImpact), тоже как обычно.
   */
  private spawnProjectile(from: Vector3, to: Vector3): void {
    if (!this.coreMat) {
      this.coreMat = new StandardMaterial("towerProjCoreMat", this.scene);
      this.coreMat.disableLighting = true;
      this.coreMat.diffuseColor = new Color3(0, 0, 0);
      this.coreMat.specularColor = new Color3(0, 0, 0);
      this.coreMat.emissiveColor = new Color3(1, 0.85, 0.5);
      this.coreMat.alphaMode = Constants.ALPHA_ADD;
      this.coreMat.disableDepthWrite = true;

      this.glowMat = new StandardMaterial("towerProjGlowMat", this.scene);
      this.glowMat.disableLighting = true;
      this.glowMat.diffuseColor = new Color3(0, 0, 0);
      this.glowMat.specularColor = new Color3(0, 0, 0);
      this.glowMat.emissiveColor = new Color3(1, 0.55, 0.2);
      this.glowMat.alphaMode = Constants.ALPHA_ADD;
      this.glowMat.disableDepthWrite = true;
      this.glowMat.backFaceCulling = false;
      this.glowMat.alpha = 0.55;
    }
    const holder = new TransformNode("towerProjHolder", this.scene);
    holder.parent = this.root;
    holder.position.copyFrom(from);
    const core = MeshBuilder.CreateSphere("towerProjCore", { diameter: 0.26, segments: 8 }, this.scene);
    core.material = this.coreMat;
    core.isPickable = false;
    core.parent = holder;
    const glow = MeshBuilder.CreatePlane("towerProjGlow", { size: 0.9 }, this.scene);
    glow.material = this.glowMat;
    glow.isPickable = false;
    glow.billboardMode = Mesh.BILLBOARDMODE_ALL;
    glow.parent = holder;
    const dist = Vector3.Distance(from, to);
    this.projectiles.push({ holder, core, glow, from: from.clone(), to: to.clone(), t: 0, dur: Math.max(0.12, dist / 16) });
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const k = Math.min(1, pr.t / pr.dur);
      Vector3.LerpToRef(pr.from, pr.to, k, pr.holder.position);
      // Живое мерцание свечения — не статичная точка.
      const flick = 0.85 + 0.15 * Math.sin(pr.t * 26);
      pr.glow.scaling.setAll(flick);
      if (k >= 1) {
        this.spawnImpact(pr.holder.position.clone());
        pr.core.dispose();
        pr.glow.dispose();
        pr.holder.dispose();
        this.projectiles.splice(i, 1);
      }
    }
    this.updateBursts(dt);
  }

  /** Вспышка+звук попадания снаряда — та же озвучка, что и у огнешара в основном мире. */
  private spawnImpact(pos: Vector3): void {
    if (!this.burstMat) {
      this.burstMat = new StandardMaterial("towerBurstMat", this.scene);
      this.burstMat.disableLighting = true;
      this.burstMat.diffuseColor = new Color3(0, 0, 0);
      this.burstMat.specularColor = new Color3(0, 0, 0);
      this.burstMat.emissiveColor = new Color3(1, 0.6, 0.25);
      this.burstMat.alphaMode = Constants.ALPHA_ADD;
      this.burstMat.disableDepthWrite = true;
      this.burstMat.backFaceCulling = false;
    }
    const mesh = MeshBuilder.CreatePlane("towerBurst", { size: 1 }, this.scene);
    mesh.material = this.burstMat;
    mesh.isPickable = false;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.parent = this.root;
    mesh.position.copyFrom(pos);
    mesh.scaling.setAll(0.2);
    this.bursts.push({ mesh, age: 0, life: 0.32 });
    const world = pos.add(this.root.position);
    this.sfx.at({ x: world.x, y: world.y, z: world.z }, () => this.sfx.fireBurst(undefined, 0.7));
  }

  private updateBursts(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const f = b.age / b.life;
      if (f >= 1) {
        b.mesh.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      b.mesh.scaling.setAll(0.2 + f * 1.6);
      (b.mesh.material as StandardMaterial).alpha = 1 - f;
    }
  }

  /**
   * Раз в кадр. `active` — идёт ли сейчас хоть один забег (по факту — не
   * больше одного одновременно, см. очередь башни). `heroId` — кто именно
   * (для обнаружения смены героя — см. lastHeroId ниже: очередь может
   * передать эстафету СРАЗУ, в одном и том же сетевом тике, без промежутка
   * "никого нет" — простого active:false->true для сброса недостаточно).
   * `mobs` — живые позиции (МИРОВЫЕ координаты, как их шлёт ZoneRoom)
   * обычных мобов и, если есть, босса последней записью с `boss: true`.
   */
  update(
    dt: number,
    active: boolean,
    heroId: string,
    floor: number,
    bossActive: boolean,
    mobs: readonly TowerLiveMob[],
    heroX: number,
    heroY: number,
    heroZ: number,
  ): void {
    if (!active) {
      if (this.built) this.root.setEnabled(false);
      this.wasActive = false;
      this.lastHeroId = "";
      for (const pr of this.projectiles) {
        pr.core.dispose();
        pr.glow.dispose();
        pr.holder.dispose();
      }
      this.projectiles.length = 0;
      for (const b of this.bursts) b.mesh.dispose();
      this.bursts.length = 0;
      return;
    }
    this.ensureBuilt();
    this.root.setEnabled(true);
    if (!this.wasActive || heroId !== this.lastHeroId) {
      // Новый забег (в т.ч. другой герой СРАЗУ следом за предыдущим, без
      // видимого "никого нет" между ними) — форсируем свежую загрузку
      // модели, даже если номер этажа случайно совпал с тем, на котором
      // закончился предыдущий: иначе на арене могли остаться (или не
      // появиться) чужие модели предыдущего забега.
      this.lastFloor = -1;
      // Чистим СРАЗУ, синхронно — не ждём асинхронной loadFloorModel(): та
      // подменяет модели только когда новая уже готова, а до этого момента
      // на арене оставались модельки прошлого героя (то самое "невидимые
      // мобы у следующего" — на деле не невидимые, а чужие/устаревшие).
      this.disposeModels();
    }
    this.lastHeroId = heroId;
    this.wasActive = true;

    if (floor !== this.lastFloor) {
      this.lastFloor = floor;
      this.applyPalette(floor);
      this.paintLabel(floor);
      void this.loadFloorModel(floor);
    }

    // Локальная цель для снарядов дальних мобов — примерно торс героя.
    const heroLocal = new Vector3(
      heroX - this.root.position.x,
      Math.max(1, heroY - this.root.position.y),
      heroZ - this.root.position.z,
    );

    // Прожектор висит статично (позиция не меняется), только доворачивает
    // луч на героя — от фиксированной точки подвеса к его нынешним ногам.
    const spotTarget = new Vector3(heroLocal.x, 0, heroLocal.z);
    spotTarget.subtractToRef(this.spot.position, this.spot.direction);
    this.spot.direction.normalize();

    // Тень героя — тот же плоский приём, что и у мобов, только пол под ногами
    // ровно y=0 (обычный BlobShadow тут не подходит: он мерит рельеф ПОЛЯНЫ
    // по её terrainHeight, а герой висит на TOWER_HIDE.y высоко над картой).
    this.heroShadow.position.set(heroLocal.x, 0.02, heroLocal.z);

    const hasModels = this.modelName !== "";
    let regularIdx = 0;
    for (const m of mobs) {
      if (m.boss) continue;
      if (regularIdx >= MAX_MOBS) break;
      const slot = hasModels ? this.mobModels[regularIdx] : null;
      if (slot) {
        slot.holder.setEnabled(true);
        slot.anchor.setEnabled(true);
        const lx = m.x - this.root.position.x;
        const lz = m.z - this.root.position.z;
        slot.holder.position.set(lx, 0, lz);
        slot.anchor.position.set(lx, 0, lz);
        slot.holder.rotation.y = m.yaw;
        slot.tag.setHp(m.hpFrac);
        const wasPulsing = slot.lastAtkPulse;
        this.pulseAttack(slot, m.atkPulse, m.ranged);
        this.tickModelFx(slot, dt, m.burning);
        if (m.ranged && m.atkPulse && !wasPulsing) {
          this.spawnProjectile(new Vector3(lx, 1.1, lz), heroLocal);
        }
      }
      regularIdx++;
    }
    if (hasModels) {
      for (let i = regularIdx; i < MAX_MOBS; i++) {
        this.mobModels[i]?.holder.setEnabled(false);
        this.mobModels[i]?.anchor.setEnabled(false);
      }
      if (bossActive && this.bossModel) {
        const boss = mobs.find((m) => m.boss);
        this.bossModel.holder.setEnabled(!!boss);
        this.bossModel.anchor.setEnabled(!!boss);
        if (boss) {
          const lx = boss.x - this.root.position.x;
          const lz = boss.z - this.root.position.z;
          this.bossModel.holder.position.set(lx, 0, lz);
          this.bossModel.anchor.position.set(lx, 0, lz);
          this.bossModel.holder.rotation.y = boss.yaw;
          this.bossModel.tag.setHp(boss.hpFrac);
          const wasPulsing = this.bossModel.lastAtkPulse;
          this.pulseAttack(this.bossModel, boss.atkPulse, boss.ranged);
          this.tickModelFx(this.bossModel, dt, boss.burning);
          if (boss.ranged && boss.atkPulse && !wasPulsing) {
            this.spawnProjectile(new Vector3(lx, 1.1 * TOWER.bossScaleMul, lz), heroLocal);
          }
        }
      } else {
        this.bossModel?.holder.setEnabled(false);
        this.bossModel?.anchor.setEnabled(false);
      }
    }
    this.updateProjectiles(dt);
  }

  dispose(): void {
    if (!this.built) return;
    this.disposeModels();
    for (const pr of this.projectiles) {
      pr.core.dispose();
      pr.glow.dispose();
      pr.holder.dispose();
    }
    this.projectiles.length = 0;
    for (const b of this.bursts) b.mesh.dispose();
    this.bursts.length = 0;
    this.coreMat?.dispose();
    this.glowMat?.dispose();
    this.burstMat?.dispose();
    for (const t of this.texCache.values()) t.dispose();
    this.texCache.clear();
    this.labelTex.dispose();
    this.light.dispose();
    this.root.dispose(false, true);
    this.built = false;
  }
}
