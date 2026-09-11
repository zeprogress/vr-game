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

    const bossFgMat = new StandardMaterial(`towerBossBarFgMat_${id}`, this.scene);
    bossFgMat.diffuseColor = new Color3(0.75, 0.1, 0.75);
    bossFgMat.emissiveColor = new Color3(0.4, 0.05, 0.4);
    bossFgMat.specularColor = new Color3(0, 0, 0);
    bossFgMat.disableLighting = true;
    const bossBarFg = MeshBuilder.CreatePlane(`towerBossBarFg_${id}`, { width: 2.3, height: 0.16 }, this.scene);
    bossBarFg.parent = root;
    bossBarFg.position.set(0, 2.3, -5.49);
    bossBarFg.billboardMode = Mesh.BILLBOARDMODE_Y;
    bossBarFg.isPickable = false;
    bossBarFg.material = bossFgMat;
    bossBarFg.setEnabled(false);
    bossBarFg.setPivotPoint(new Vector3(-1.15, 0, 0));

    const heroBarBg = bossBarBg.clone(`towerHeroBarBg_${id}`);
    heroBarBg.position.set(0, 2.7, 0);
    heroBarBg.scaling.set(0.7, 0.7, 1);
    heroBarBg.setEnabled(true);
    const heroFgMat = new StandardMaterial(`towerHeroBarFgMat_${id}`, this.scene);
    heroFgMat.diffuseColor = new Color3(0.15, 0.8, 0.25);
    heroFgMat.emissiveColor = new Color3(0.05, 0.35, 0.1);
    heroFgMat.specularColor = new Color3(0, 0, 0);
    heroFgMat.disableLighting = true;
    const heroBarFg = MeshBuilder.CreatePlane(`towerHeroBarFg_${id}`, { width: 2.3 * 0.7, height: 0.16 * 0.7 }, this.scene);
    heroBarFg.parent = root;
    heroBarFg.position.set(0, 2.7, 0.01);
    heroBarFg.billboardMode = Mesh.BILLBOARDMODE_Y;
    heroBarFg.isPickable = false;
    heroBarFg.material = heroFgMat;
    heroBarFg.setPivotPoint(new Vector3(-0.805, 0, 0));

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
    };
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
      }

      for (let i = 0; i < rig.mobSlots.length; i++) rig.mobSlots[i].setEnabled(i < e.mobsLeft);

      rig.boss.setEnabled(e.bossActive);
      rig.bossBarBg.setEnabled(e.bossActive);
      rig.bossBarFg.setEnabled(e.bossActive);
      if (e.bossActive) rig.bossBarFg.scaling.x = Math.max(0.001, e.bossHpFrac);

      rig.heroBarFg.scaling.x = Math.max(0.001, e.heroHpFrac);
    }
    for (const [id, rig] of this.rigs) {
      if (seen.has(id)) continue;
      this.disposeRig(rig);
      this.rigs.delete(id);
    }
  }

  private disposeRig(rig: Rig): void {
    rig.labelTex.dispose();
    rig.root.dispose(false, true); // и меши-дети, и их материалы
  }

  dispose(): void {
    for (const rig of this.rigs.values()) this.disposeRig(rig);
    this.rigs.clear();
  }
}
