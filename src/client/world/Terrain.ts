import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LIGHT_BUDGET } from "./Fireflies";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

import { WORLD } from "#shared/constants";
import { terrainHeight as surface } from "#shared/terrain";

export interface Terrain {
  mesh: Mesh;
  /** Высота поверхности в точке (x, z) — аналитическая, совпадает с мешем. */
  heightAt(x: number, z: number): number;
}

export function createTerrain(scene: Scene): Terrain {
  const size = WORLD.size;
  const seg = WORLD.subdivisions;
  const half = size / 2;
  const step = size / seg;

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iz = 0; iz <= seg; iz++) {
    for (let ix = 0; ix <= seg; ix++) {
      const x = -half + ix * step;
      const z = -half + iz * step;
      positions.push(x, surface(x, z), z);
      uvs.push(ix / seg, iz / seg);
    }
  }
  const row = seg + 1;
  for (let iz = 0; iz < seg; iz++) {
    for (let ix = 0; ix < seg; ix++) {
      const a = iz * row + ix;
      // Обход по часовой (нормали вверх для левосторонней системы Babylon).
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);

  const mesh = new Mesh("terrain", scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.applyToMesh(mesh);

  mesh.checkCollisions = true;
  mesh.isPickable = true;
  mesh.material = grassMaterial(scene);

  return { mesh, heightAt: surface };
}

/** Зелёный материал с процедурным шумом, чтобы земля не была плоским цветом. */
function grassMaterial(scene: Scene): StandardMaterial {
  const tex = new DynamicTexture("grassTex", { width: 256, height: 256 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#4a7c3a";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const shade = 60 + Math.floor(Math.random() * 70);
    ctx.fillStyle = `rgba(${shade - 20}, ${shade + 40}, ${shade - 10}, 0.5)`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  tex.update();
  tex.uScale = 40;
  tex.vScale = 40;

  const mat = new StandardMaterial("terrainMat", scene);
  // Земля должна ловить свет светлячков, а не только солнце и небо.
  mat.maxSimultaneousLights = LIGHT_BUDGET;
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0, 0, 0);
  return mat;
}

