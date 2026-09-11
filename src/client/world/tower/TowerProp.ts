import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { terrainHeight } from "#shared/terrain";
import { TOWER_PROP_POS } from "#shared/tower";
import type { Obstacle } from "../props";

export interface TowerProp {
  obstacles: Obstacle[];
  dispose(): void;
}

/**
 * Декоративная башня-веха на основной карте — по паттерну `HubBlockout.ts`:
 * только примитивы, склеенные в один меш (`Mesh.MergeMeshes`) ради кадрового
 * бюджета шлема. Один силуэт: сужающийся ствол + конус-крыша + пара
 * выступов-балконов, тёмный камень.
 */
export function buildTowerProp(scene: Scene): TowerProp {
  const root = new TransformNode("towerProp", scene);
  const x = TOWER_PROP_POS.x;
  const z = TOWER_PROP_POS.z;
  const groundY = terrainHeight(x, z);
  root.position.set(x, groundY, z);

  const mat = new StandardMaterial("towerPropMat", scene);
  mat.diffuseColor = new Color3(0.24, 0.22, 0.26);
  mat.specularColor = new Color3(0, 0, 0);

  const roofMat = new StandardMaterial("towerPropRoofMat", scene);
  roofMat.diffuseColor = new Color3(0.35, 0.14, 0.16);
  roofMat.specularColor = new Color3(0, 0, 0);

  const parts: Mesh[] = [];
  let h = 0;
  // Ствол — 5 сужающихся кверху секций (силуэт «неровной» башни, не идеальный конус).
  const segs: { h: number; d0: number; d1: number }[] = [
    { h: 6, d0: 13, d1: 12 },
    { h: 7, d0: 12, d1: 10.5 },
    { h: 7, d0: 10.5, d1: 9 },
    { h: 6, d0: 9, d1: 7.5 },
    { h: 6, d0: 7.5, d1: 6 },
  ];
  for (const s of segs) {
    const seg = MeshBuilder.CreateCylinder(
      "towerPropSeg",
      { height: s.h, diameterTop: s.d1, diameterBottom: s.d0, tessellation: 12 },
      scene,
    );
    seg.position.y = h + s.h / 2;
    parts.push(seg);
    h += s.h;
  }
  // Пара выступов-балконов на разной высоте — силуэт не гладкий столб.
  for (const by of [10, 20]) {
    const balcony = MeshBuilder.CreateCylinder(
      "towerPropBalcony",
      { height: 0.6, diameter: 14.5, tessellation: 12 },
      scene,
    );
    balcony.position.y = by;
    parts.push(balcony);
  }
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false) ?? parts[0];
  merged.name = "towerPropBody";
  merged.material = mat;
  merged.parent = root;
  merged.isPickable = false;
  merged.createNormals(true);
  merged.freezeWorldMatrix();
  merged.doNotSyncBoundingInfo = true;

  // Крыша-конус.
  const roof = MeshBuilder.CreateCylinder(
    "towerPropRoof",
    { height: 9, diameterTop: 0, diameterBottom: 7, tessellation: 12 },
    scene,
  );
  roof.position.y = h + 4.5;
  roof.material = roofMat;
  roof.parent = root;
  roof.isPickable = false;
  roof.freezeWorldMatrix();
  roof.doNotSyncBoundingInfo = true;

  return {
    obstacles: [{ x, z, r: 6.5 }],
    dispose(): void {
      merged.material?.dispose();
      merged.dispose();
      roof.material?.dispose();
      roof.dispose();
      root.dispose();
    },
  };
}
