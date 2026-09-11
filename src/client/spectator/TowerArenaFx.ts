import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { PLAYER } from "#shared/constants";
import { TOWER, TOWER_HIDE, floorMonster } from "#shared/tower";
import { loadRig, recolorMonster, type ModelName, type RigInstance } from "../world/models";
import { NameTag } from "../ui/NameTag";

/** Мобов на арене одновременно — с запасом (см. floorMobCount, максимум 10). */
const MAX_MOBS = 10;

interface Palette {
  floor: readonly [number, number, number];
  wall: readonly [number, number, number];
  ceiling: readonly [number, number, number];
  light: readonly [number, number, number];
  intensity: number;
}

/** Своя палитра+свет на каждый этаж (по кругу) — чтобы этажи ощущались разными. */
const PALETTES: readonly Palette[] = [
  { floor: [0.42, 0.42, 0.46], wall: [0.3, 0.3, 0.34], ceiling: [0.22, 0.22, 0.25], light: [0.85, 0.85, 0.95], intensity: 1.1 }, // камень
  { floor: [0.5, 0.16, 0.1], wall: [0.32, 0.11, 0.08], ceiling: [0.18, 0.06, 0.05], light: [1, 0.45, 0.15], intensity: 1.4 }, // лава
  { floor: [0.22, 0.4, 0.55], wall: [0.16, 0.28, 0.4], ceiling: [0.1, 0.18, 0.28], light: [0.4, 0.75, 1], intensity: 1.2 }, // лёд
  { floor: [0.2, 0.38, 0.18], wall: [0.14, 0.26, 0.13], ceiling: [0.08, 0.16, 0.08], light: [0.55, 1, 0.45], intensity: 1.0 }, // заросли
  { floor: [0.58, 0.54, 0.46], wall: [0.4, 0.37, 0.3], ceiling: [0.26, 0.24, 0.2], light: [1, 0.95, 0.8], intensity: 1.2 }, // кость
  { floor: [0.28, 0.14, 0.38], wall: [0.18, 0.08, 0.26], ceiling: [0.1, 0.04, 0.16], light: [0.75, 0.35, 1], intensity: 1.3 }, // пустота
];

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
}

/** Достаточно play()/stop() — тащить весь тип AnimationGroup незачем. */
interface AnimationGroupLike {
  play(loop?: boolean): void;
  stop(): void;
}

export interface TowerLiveMob {
  x: number;
  z: number;
  yaw: number;
  hpFrac: number;
  boss: boolean;
  atkPulse: boolean;
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
  private label!: Mesh;
  private labelTex!: DynamicTexture;

  private lastFloor = -1;
  private wasActive = false;
  private lastHeroId = "";
  private modelName = "";
  private loadSeq = 0;
  private mobModels: (ModelPlacement | null)[] = new Array(MAX_MOBS).fill(null);
  private bossModel: ModelPlacement | null = null;

  constructor(private readonly scene: Scene) {}

  private ensureBuilt(): void {
    if (this.built) return;
    this.built = true;
    const R = TOWER.arena.radius;
    const H = TOWER.arena.wallHeight;
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

    // Один источник света на всю арену — не задевает основной мир и его
    // материалы (includedOnlyMeshes), пересоздавать на каждый этаж не
    // надо — просто перекрашиваем/двигаем (см. applyPalette).
    this.light = new PointLight("towerLight", new Vector3(0, H * 0.55, 0), this.scene);
    this.light.parent = this.root;
    this.light.includedOnlyMeshes = [this.floorMesh, this.wallMesh, this.ceilMesh];
    this.light.range = R * 2.2;

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
    this.floorMat.emissiveColor.copyFromFloats(pal.floor[0] * 0.12, pal.floor[1] * 0.12, pal.floor[2] * 0.12);

    const wallTex = this.cachedTex(`towerWallTex_${idx}`, pal.wall, idx * 3 + 1);
    wallTex.uScale = (2 * Math.PI * R) / 6;
    wallTex.vScale = H / 4;
    this.wallMat.diffuseTexture = wallTex;
    this.wallMat.emissiveColor.copyFromFloats(pal.wall[0] * 0.1, pal.wall[1] * 0.1, pal.wall[2] * 0.1);

    const ceilTex = this.cachedTex(`towerCeilTex_${idx}`, pal.ceiling, idx * 3 + 2);
    ceilTex.uScale = R / 3;
    ceilTex.vScale = R / 3;
    this.ceilMat.diffuseTexture = ceilTex;
    this.ceilMat.emissiveColor.copyFromFloats(pal.ceiling[0] * 0.08, pal.ceiling[1] * 0.08, pal.ceiling[2] * 0.08);

    this.light.diffuse.copyFromFloats(pal.light[0], pal.light[1], pal.light[2]);
    this.light.specular.copyFromFloats(pal.light[0], pal.light[1], pal.light[2]);
    this.light.intensity = pal.intensity;
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
    for (let i = 0; i < MAX_MOBS; i++) {
      const p = this.placeModel(make(), 1.1, fm.name, floor);
      p.holder.setEnabled(false);
      p.anchor.setEnabled(false);
      this.mobModels[i] = p;
    }
    this.bossModel = this.placeModel(make(), 1.1 * TOWER.bossScaleMul, `${fm.name} (босс этажа)`, floor);
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
    const moveAnim = inst.anims.get("walk") ?? inst.anims.get("idle") ?? inst.anims.get("hop") ?? null;
    moveAnim?.play(true);
    const attackAnim =
      inst.anims.get("attack") ?? inst.anims.get("bite") ?? inst.anims.get("hit") ?? null;

    // Табличка — на СВОЁМ узле (scale=1), не на holder: holder масштабирован
    // по nativeHeight конкретной модели (разная у разных мобов), и табличка
    // на нём "плавала" по высоте/размеру от этажа к этажу.
    const anchor = new TransformNode("towerTagAnchor", this.scene);
    anchor.parent = this.root;
    const tag = new NameTag(this.scene, anchor, new Vector3(0, targetHeight + 0.6, 0), name, level);
    tag.showHp();
    return { inst, holder, anchor, tag, attackAnim, lastAtkPulse: false };
  }

  private disposeModels(): void {
    for (const p of this.mobModels) {
      p?.tag.dispose();
      p?.inst.dispose();
      p?.holder.dispose();
      p?.anchor.dispose();
    }
    this.mobModels.fill(null);
    if (this.bossModel) {
      this.bossModel.tag.dispose();
      this.bossModel.inst.dispose();
      this.bossModel.holder.dispose();
      this.bossModel.anchor.dispose();
      this.bossModel = null;
    }
    this.modelName = "";
  }

  /** Замах — проиграть боевую анимацию раз (если у модели она есть), не заново, если уже играет. */
  private pulseAttack(p: ModelPlacement, pulse: boolean): void {
    if (pulse && !p.lastAtkPulse) p.attackAnim?.play(false);
    p.lastAtkPulse = pulse;
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
    active: boolean,
    heroId: string,
    floor: number,
    bossActive: boolean,
    mobs: readonly TowerLiveMob[],
  ): void {
    if (!active) {
      if (this.built) this.root.setEnabled(false);
      this.wasActive = false;
      this.lastHeroId = "";
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
    }
    this.lastHeroId = heroId;
    this.wasActive = true;

    if (floor !== this.lastFloor) {
      this.lastFloor = floor;
      this.applyPalette(floor);
      this.paintLabel(floor);
      void this.loadFloorModel(floor);
    }

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
        this.pulseAttack(slot, m.atkPulse);
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
          this.pulseAttack(this.bossModel, boss.atkPulse);
        }
      } else {
        this.bossModel?.holder.setEnabled(false);
        this.bossModel?.anchor.setEnabled(false);
      }
    }
  }

  dispose(): void {
    if (!this.built) return;
    this.disposeModels();
    for (const t of this.texCache.values()) t.dispose();
    this.texCache.clear();
    this.labelTex.dispose();
    this.light.dispose();
    this.root.dispose(false, true);
    this.built = false;
  }
}
