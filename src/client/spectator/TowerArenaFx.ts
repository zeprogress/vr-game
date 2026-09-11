import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { floorMonster, TOWER } from "#shared/tower";
import { loadRig, recolorMonster, type ModelName, type RigInstance } from "../world/models";

/** Сколько слотов мобов держим всегда — максимум по floorMobCount (см. tower.ts). */
const MAX_MOBS = 10;
/** Палитра площадки/декора — своя на этаж (по floor % длины), для «разных» этажей без 3D-арт-работы. */
const PALETTES: readonly [number, number, number][] = [
  [0.42, 0.42, 0.46], // камень
  [0.55, 0.18, 0.14], // лава
  [0.2, 0.36, 0.5], // лёд
  [0.22, 0.4, 0.2], // заросли
  [0.62, 0.58, 0.5], // кость
  [0.32, 0.16, 0.42], // пустота
];

/** Ширина планок-заливок (bossBarFg/heroBarFg) в их СОБСТВЕННЫХ локальных
 *  единицах — родительский масштаб (0.7 у полосы героя) применяется сам. */
const BAR_FG_HALF_W = 1.15;

/**
 * Сжать полосу HP от ПРАВОГО края (левый — фиксирован), без billboard-качания:
 * `fg` — ребёнок billboard-подложки, свой billboardMode/pivot ему не нужен —
 * просто сдвигаем локальную позицию вместе со scaling.x.
 */
function setBarFrac(fg: Mesh, frac: number): void {
  const f = Math.max(0.001, Math.min(1, frac));
  fg.scaling.x = f;
  fg.position.x = -BAR_FG_HALF_W * (1 - f);
}

interface ModelPlacement {
  inst: RigInstance;
  holder: TransformNode;
}

interface Rig {
  root: TransformNode;
  platform: Mesh;
  platMat: StandardMaterial;
  mobSlots: Mesh[];
  boss: Mesh;
  bossMat: StandardMaterial;
  bossBarBg: Mesh;
  bossBarFg: Mesh;
  heroBarBg: Mesh;
  heroBarFg: Mesh;
  label: Mesh;
  labelTex: DynamicTexture;
  lastFloor: number;
  /** Модель этажа, если уже загрузилась — иначе видны кубы-заглушки (mobSlots/boss). */
  modelName: string;
  mobModels: (ModelPlacement | null)[];
  bossModel: ModelPlacement | null;
  /** Токен против гонки: этаж может смениться раньше, чем догрузится предыдущий. */
  loadSeq: number;
}

export interface TowerFxEntry {
  id: string;
  pos: Vector3;
  floor: number;
  mobsLeft: number;
  mobsTotal: number;
  bossActive: boolean;
  bossHpFrac: number;
  heroHpFrac: number;
}

/**
 * Визуал «Охотничьей башни» (фаза C, v1) — герой физически стоит на далёкой
 * скрытой точке (TOWER_HIDE), сама симуляция боя в отдельной TowerRoom (числа,
 * без пространства); здесь только декоративная площадка+мобы-заглушки+босс+
 * полоски HP вокруг него, собранные из примитивов (моделей пака пока нет —
 * это Фаза E). Один риг на героя, по факту почти всегда только один активен.
 */
export class TowerArenaFx {
  private readonly rigs = new Map<string, Rig>();

  constructor(private readonly scene: Scene) {}

  private buildRig(id: string): Rig {
    const root = new TransformNode(`towerRig_${id}`, this.scene);

    const platform = MeshBuilder.CreateCylinder(
      `towerPlat_${id}`,
      { diameter: 11, height: 0.3, tessellation: 24 },
      this.scene,
    );
    platform.parent = root;
    platform.position.y = -0.15;
    platform.isPickable = false;
    const platMat = new StandardMaterial(`towerPlatMat_${id}`, this.scene);
    platMat.specularColor = new Color3(0, 0, 0);
    platform.material = platMat;

    const mobProto = MeshBuilder.CreateBox(`towerMobProto_${id}`, { size: 0.9 }, this.scene);
    const mobMat = new StandardMaterial(`towerMobMat_${id}`, this.scene);
    mobMat.diffuseColor = new Color3(0.7, 0.1, 0.1);
    mobMat.emissiveColor = new Color3(0.25, 0.02, 0.02);
    mobMat.specularColor = new Color3(0, 0, 0);
    mobProto.material = mobMat;
    mobProto.isPickable = false;
    mobProto.parent = root;
    const mobSlots: Mesh[] = [];
    for (let i = 0; i < MAX_MOBS; i++) {
      const m = i === 0 ? mobProto : mobProto.clone(`towerMob_${id}_${i}`);
      const a = (i / MAX_MOBS) * Math.PI * 2;
      m.position.set(Math.cos(a) * 4, 0.45, Math.sin(a) * 4);
      m.parent = root;
      mobSlots.push(m);
    }

    const boss = MeshBuilder.CreateBox(`towerBoss_${id}`, { size: 1.8 }, this.scene);
    boss.position.set(0, 0.9, -5.5);
    boss.parent = root;
    boss.isPickable = false;
    const bossMat = new StandardMaterial(`towerBossMat_${id}`, this.scene);
    bossMat.diffuseColor = new Color3(0.5, 0.15, 0.55);
    bossMat.emissiveColor = new Color3(0.2, 0.05, 0.22);
    bossMat.specularColor = new Color3(0, 0, 0);
    boss.material = bossMat;
    boss.setEnabled(false);

    const barBgMat = new StandardMaterial(`towerBarBgMat_${id}`, this.scene);
    barBgMat.diffuseColor = new Color3(0.08, 0.08, 0.08);
    barBgMat.specularColor = new Color3(0, 0, 0);
    barBgMat.disableLighting = true;
    barBgMat.emissiveColor = new Color3(0.08, 0.08, 0.08);

    const bossBarBg = MeshBuilder.CreatePlane(`towerBossBarBg_${id}`, { width: 2.4, height: 0.24 }, this.scene);
    bossBarBg.parent = root;
    bossBarBg.position.set(0, 2.3, -5.5);
    bossBarBg.billboardMode = Mesh.BILLBOARDMODE_Y;
    bossBarBg.isPickable = false;
    bossBarBg.material = barBgMat;
    bossBarBg.setEnabled(false);

    // ВАЖНО: полоса-заливка (fg) — РЕБЁНОК подложки (bg), а не root, и БЕЗ
    // своего billboardMode/pivot. Билборд поворачивает меш вокруг его pivot;
    // если сама fg билбордится да ещё с pivot на левом краю (чтобы шкала
    // сжималась от края, а не от центра) — она вращается вокруг ЭТОЙ точки,
    // а не центра, и на орбите камеры видимо "сползает"/качается. Ребёнок
    // billboard-меша просто наследует его поворот целиком, без своего.
    const bossFgMat = new StandardMaterial(`towerBossBarFgMat_${id}`, this.scene);
    bossFgMat.diffuseColor = new Color3(0.75, 0.1, 0.75);
    bossFgMat.emissiveColor = new Color3(0.4, 0.05, 0.4);
    bossFgMat.specularColor = new Color3(0, 0, 0);
    bossFgMat.disableLighting = true;
    const bossBarFg = MeshBuilder.CreatePlane(`towerBossBarFg_${id}`, { width: 2.3, height: 0.16 }, this.scene);
    bossBarFg.parent = bossBarBg;
    bossBarFg.position.set(0, 0, -0.01);
    bossBarFg.isPickable = false;
    bossBarFg.material = bossFgMat;
    bossBarFg.setEnabled(false);

    const heroBarBg = bossBarBg.clone(`towerHeroBarBg_${id}`);
    heroBarBg.parent = root;
    heroBarBg.position.set(0, 2.7, 0);
    heroBarBg.scaling.set(0.7, 0.7, 1);
    heroBarBg.setEnabled(true);
    const heroFgMat = new StandardMaterial(`towerHeroBarFgMat_${id}`, this.scene);
    heroFgMat.diffuseColor = new Color3(0.15, 0.8, 0.25);
    heroFgMat.emissiveColor = new Color3(0.05, 0.35, 0.1);
    heroFgMat.specularColor = new Color3(0, 0, 0);
    heroFgMat.disableLighting = true;
    const heroBarFg = MeshBuilder.CreatePlane(`towerHeroBarFg_${id}`, { width: 2.3, height: 0.16 }, this.scene);
    heroBarFg.parent = heroBarBg;
    heroBarFg.position.set(0, 0, -0.01);
    heroBarFg.isPickable = false;
    heroBarFg.material = heroFgMat;

    const labelTex = new DynamicTexture(`towerLabelTex_${id}`, { width: 256, height: 64 }, this.scene, false);
    labelTex.hasAlpha = true;
    const labelMat = new StandardMaterial(`towerLabelMat_${id}`, this.scene);
    labelMat.diffuseTexture = labelTex;
    labelMat.emissiveTexture = labelTex;
    labelMat.opacityTexture = labelTex;
    labelMat.useAlphaFromDiffuseTexture = true;
    labelMat.disableLighting = true;
    labelMat.specularColor = new Color3(0, 0, 0);
    labelMat.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(`towerLabel_${id}`, { width: 3, height: 0.75 }, this.scene);
    label.parent = root;
    label.position.set(0, 3.4, 0);
    label.billboardMode = Mesh.BILLBOARDMODE_Y;
    label.isPickable = false;
    label.material = labelMat;

    return {
      root, platform, platMat, mobSlots, boss, bossMat, bossBarBg, bossBarFg,
      heroBarBg, heroBarFg, label, labelTex, lastFloor: -1,
      modelName: "", mobModels: new Array(MAX_MOBS).fill(null), bossModel: null, loadSeq: 0,
    };
  }

  /**
   * Догрузить модель этажа (Quaternius, см. FLOOR_MONSTERS) и подменить ею
   * кубы-заглушки — асинхронно, с защитой от гонки (этаж мог смениться ещё
   * раз, пока эта модель грузилась). Если загрузка не удалась — кубы и
   * останутся, это не баг, а честный фолбэк.
   */
  private async loadFloorModel(rig: Rig, floor: number): Promise<void> {
    const fm = floorMonster(floor);
    const mySeq = ++rig.loadSeq;
    let make: (() => RigInstance) | null = null;
    try {
      make = await loadRig(this.scene, fm.model as ModelName);
    } catch {
      return;
    }
    if (rig.root.isDisposed() || rig.loadSeq !== mySeq) return; // устарело или риг снесён

    this.disposeFloorModels(rig);
    rig.modelName = fm.model;
    for (let i = 0; i < rig.mobSlots.length; i++) {
      const placement = this.placeModel(make(), rig.root, rig.mobSlots[i].position, 1.1);
      rig.mobModels[i] = placement;
      rig.mobSlots[i].setEnabled(false); // кубик больше не нужен — есть модель
    }
    rig.bossModel = this.placeModel(make(), rig.root, rig.boss.position, 1.1 * TOWER.bossScaleMul);
    rig.boss.setEnabled(false);
  }

  /** Поставить экземпляр модели на место кубика-заглушки, подогнав высоту. */
  private placeModel(inst: RigInstance, parent: TransformNode, pos: Vector3, targetHeight: number): ModelPlacement {
    const holder = new TransformNode("towerModelHolder", this.scene);
    holder.parent = parent;
    holder.position.copyFrom(pos);
    inst.root.parent = holder;
    inst.root.position.set(0, 0, 0);
    const base = targetHeight / (inst.nativeHeight || 1);
    holder.scaling.setAll(base);
    recolorMonster(inst.root); // родная текстура пака + эмиссив под дневной свет
    const anim = inst.anims.get("idle") ?? inst.anims.get("walk") ?? inst.anims.get("hop") ?? null;
    anim?.play(true);
    return { inst, holder };
  }

  private disposeFloorModels(rig: Rig): void {
    for (const p of rig.mobModels) {
      p?.inst.dispose();
      p?.holder.dispose();
    }
    rig.mobModels.fill(null);
    if (rig.bossModel) {
      rig.bossModel.inst.dispose();
      rig.bossModel.holder.dispose();
      rig.bossModel = null;
    }
  }

  private paintLabel(rig: Rig, floor: number): void {
    const ctx = rig.labelTex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 256, 64);
    ctx.font = "700 34px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(240,240,245,0.95)";
    ctx.fillText(`Этаж ${floor}`, 128, 34);
    rig.labelTex.update();
  }

  /** Раз в кадр: `entries` — только герои, у кого сейчас идёт забег (towerFloor > 0). */
  update(entries: readonly TowerFxEntry[]): void {
    const seen = new Set<string>();
    for (const e of entries) {
      seen.add(e.id);
      let rig = this.rigs.get(e.id);
      if (!rig) {
        rig = this.buildRig(e.id);
        this.rigs.set(e.id, rig);
      }
      rig.root.position.copyFrom(e.pos);

      if (rig.lastFloor !== e.floor) {
        rig.lastFloor = e.floor;
        this.paintLabel(rig, e.floor);
        const pal = PALETTES[(e.floor - 1) % PALETTES.length];
        rig.platMat.diffuseColor.copyFromFloats(pal[0], pal[1], pal[2]);
        rig.platMat.emissiveColor.copyFromFloats(pal[0] * 0.35, pal[1] * 0.35, pal[2] * 0.35);
        void this.loadFloorModel(rig, e.floor);
      }

      const hasModels = rig.modelName !== "";
      for (let i = 0; i < rig.mobSlots.length; i++) {
        const on = i < e.mobsLeft;
        if (hasModels) rig.mobModels[i]?.holder.setEnabled(on);
        else rig.mobSlots[i].setEnabled(on);
      }

      if (hasModels) rig.bossModel?.holder.setEnabled(e.bossActive);
      else rig.boss.setEnabled(e.bossActive);
      rig.bossBarBg.setEnabled(e.bossActive);
      rig.bossBarFg.setEnabled(e.bossActive);
      if (e.bossActive) setBarFrac(rig.bossBarFg, e.bossHpFrac);

      setBarFrac(rig.heroBarFg, e.heroHpFrac);
    }
    for (const [id, rig] of this.rigs) {
      if (seen.has(id)) continue;
      this.disposeRig(rig);
      this.rigs.delete(id);
    }
  }

  private disposeRig(rig: Rig): void {
    rig.loadSeq++; // ещё не пришедшую загрузку модели тоже глушим
    this.disposeFloorModels(rig);
    rig.labelTex.dispose();
    rig.root.dispose(false, true); // и меши-дети, и их материалы
  }

  dispose(): void {
    for (const rig of this.rigs.values()) this.disposeRig(rig);
    this.rigs.clear();
  }
}
