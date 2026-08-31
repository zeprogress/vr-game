import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LIGHT_BUDGET } from "./Fireflies";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";

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

/**
 * Земля: процедурная текстура вместо плоского цвета.
 *
 * Крупные мягкие пятна (гуще/суше трава, проплешины земли) задаёт фрактальный
 * шум, мелкое зерно — верхняя октава. Тайлится зеркально, поэтому швы на стыке
 * повторов не бросаются в глаза.
 */
function grassMaterial(scene: Scene): StandardMaterial {
  const S = 512;
  const tex = new DynamicTexture("grassTex", { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(S, S);
  const d = img.data;

  const hash = (x: number, y: number): number => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const vnoise = (x: number, y: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const e = hash(xi + 1, yi + 1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + e * u * v;
  };
  const fbm = (x: number, y: number): number => {
    let f = 0;
    let amp = 0.5;
    let freq = 1;
    for (let o = 0; o < 5; o++) {
      f += amp * vnoise(x * freq, y * freq);
      freq *= 2;
      amp *= 0.5;
    }
    return f;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const smooth = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // Земляная палитра: густая трава -> средняя -> подсохшая -> голая земля.
  const deep = [52, 72, 38];
  const mid = [78, 98, 50];
  const dry = [120, 124, 68];
  const dirt = [96, 76, 53];

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const nx = (px / S) * 5;
      const ny = (py / S) * 5;
      const macro = fbm(nx, ny); // крупные пятна травы
      const patch = fbm(nx * 2.1 + 40, ny * 2.1 + 40); // где земля проступает
      const grain = vnoise(nx * 34, ny * 34); // мелкое зерно

      let col: number[];
      if (macro < 0.5) col = deep.map((c, i) => lerp(c, mid[i], macro * 2));
      else col = mid.map((c, i) => lerp(c, dry[i], (macro - 0.5) * 2));

      const bare = smooth(0.6, 0.8, patch);
      col = col.map((c, i) => lerp(c, dirt[i], bare * 0.8));

      const b = 0.85 + grain * 0.3;
      const j = (Math.random() - 0.5) * 12;
      const o = (py * S + px) * 4;
      d[o] = Math.max(0, Math.min(255, col[0] * b + j));
      d[o + 1] = Math.max(0, Math.min(255, col[1] * b + j));
      d[o + 2] = Math.max(0, Math.min(255, col[2] * b + j));
      d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);

  // Один повтор ~36 м; зеркальное тайлинг прячет швы.
  tex.uScale = WORLD.size / 36;
  tex.vScale = WORLD.size / 36;
  tex.wrapU = Texture.MIRROR_ADDRESSMODE;
  tex.wrapV = Texture.MIRROR_ADDRESSMODE;

  const mat = new StandardMaterial("terrainMat", scene);
  // Земля должна ловить свет светлячков, а не только солнце и небо.
  mat.maxSimultaneousLights = LIGHT_BUDGET;
  mat.diffuseTexture = tex;
  mat.specularColor = new Color3(0, 0, 0);
  return mat;
}

