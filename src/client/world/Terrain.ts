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

/** На сколько мировых «сторон» продлеваем землю за игровую зону (в каждую сторону). */
const APRON = 2;

/**
 * Строит участок рельефа [x0..x1]×[z0..z1] сеткой с шагом `step`.
 * `skipInner` — не класть квадраты, целиком лежащие в игровой зоне (там свой меш).
 * UV в мировом масштабе игровой зоны, чтобы текстура тайлилась одинаково.
 */
function buildPatch(
  scene: Scene,
  name: string,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  step: number,
  inner: number,
  skipInner: boolean,
): Mesh {
  const nx = Math.round((x1 - x0) / step);
  const nz = Math.round((z1 - z0) / step);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const size = WORLD.size;

  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const x = x0 + ix * step;
      const z = z0 + iz * step;
      positions.push(x, surface(x, z), z);
      uvs.push((x + size / 2) / size, (z + size / 2) / size);
    }
  }
  const row = nx + 1;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (skipInner) {
        // Оставляем нахлёст в одну ячейку внутрь зоны: прячет щель на стыке
        // (у фартука шаг вдвое крупнее игрового меша).
        const cx = x0 + (ix + 0.5) * step;
        const cz = z0 + (iz + 0.5) * step;
        if (Math.abs(cx) < inner - step && Math.abs(cz) < inner - step) continue;
      }
      const a = iz * row + ix;
      indices.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }

  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.uvs = uvs;
  vd.applyToMesh(mesh);
  return mesh;
}

export function createTerrain(scene: Scene): Terrain {
  const size = WORLD.size;
  const seg = WORLD.subdivisions;
  const half = size / 2;
  const step = size / seg;

  const mat = grassMaterial(scene);

  // Игровая зона: та же сетка, коллизии и raycast'ы игрока.
  const mesh = buildPatch(scene, "terrain", -half, half, -half, half, step, half, false);
  mesh.checkCollisions = true;
  mesh.isPickable = true;
  mesh.material = mat;

  // Фартук: земля тянется дальше во все стороны — за краем зоны не пустота,
  // а те же холмы. Чисто декоративный: без коллизий и без пикинга, чуть ниже
  // игрового меша, поэтому в зоне перекрытия глубинный тест выигрывает зона.
  const far = half * (1 + 2 * APRON);
  const apron = buildPatch(scene, "terrainApron", -far, far, -far, far, step * 2, half, true);
  apron.material = mat;
  apron.isPickable = false;
  apron.checkCollisions = false;
  apron.position.y = -0.06;
  apron.doNotSyncBoundingInfo = true;
  apron.alwaysSelectAsActiveMesh = true;
  apron.freezeWorldMatrix();

  return { mesh, heightAt: surface };
}

/**
 * Земля: процедурная текстура вместо плоского цвета.
 *
 * Считаем разом две карты из одного поля высот `H`:
 *  - diffuse: слои травы (густая → средняя → сухая) + редкие проплешины земли,
 *    мох в ложбинах, сухие кустики на буграх, затенение по «рельефу» дёрна;
 *  - bump: тот же микрорельеф, чтобы трава ловила боковой свет и не выглядела
 *    гладким линолеумом при взгляде вскользь (важно в шлеме).
 * Домен искажаем шумом (domain warp) и поворачиваем октавы — это ломает сетку
 * повторов, поэтому зеркальный тайлинг не читается даже вблизи.
 */
function grassMaterial(scene: Scene): StandardMaterial {
  const S = 1024;

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
  // Октавы с поворотом: соседние слои шума не выстраиваются в клетку.
  const fbm = (x: number, y: number, oct = 6): number => {
    let f = 0;
    let amp = 0.5;
    let px = x;
    let py = y;
    for (let o = 0; o < oct; o++) {
      f += amp * vnoise(px, py);
      amp *= 0.5;
      const rx = (px * 1.6 - py * 1.2) * 2;
      const ry = (px * 1.2 + py * 1.6) * 2;
      px = rx;
      py = ry;
    }
    return f;
  };
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (a: number, b: number, x: number): number => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };

  // Палитра под пак: сочная трава, без бурых пятен по умолчанию.
  const deep = [46, 78, 34];
  const mid = [86, 116, 46];
  const dry = [132, 140, 66];
  const moss = [40, 66, 40];
  const dirt = [104, 82, 54];

  const P = S * S;
  const H = new Float32Array(P); // микрорельеф дёрна (0..1)
  const R = new Uint8ClampedArray(P);
  const G = new Uint8ClampedArray(P);
  const B = new Uint8ClampedArray(P);

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const i = py * S + px;
      const u = (px / S) * 5;
      const v = (py / S) * 5;

      // Domain warp: гнём координаты вторым шумом.
      const wx = u + 0.8 * fbm(u + 5.2, v + 1.3, 4);
      const wy = v + 0.8 * fbm(u + 2.8, v + 6.1, 4);

      const macro = fbm(wx, wy); // где трава гуще/суше
      const patch = fbm(wx * 2.1 + 40, wy * 2.1 + 40, 5); // проплешины
      const tuft = fbm(wx * 4.3 - 12, wy * 4.3 + 7, 4); // кустики / мох
      const grain = vnoise(u * 40, v * 40); // мелкое зерно
      const blade = vnoise(u * 90 + v * 12, v * 6); // штрихи «по травинке»

      // Рельеф дёрна: крупная волна + бугорки от кустиков + зерно.
      const h = clamp01(
        0.5 + (macro - 0.5) * 0.7 + (tuft - 0.5) * 0.5 + (grain - 0.5) * 0.35,
      );
      H[i] = h;

      let col: number[];
      if (macro < 0.5) col = deep.map((c, k) => lerp(c, mid[k], macro * 2));
      else col = mid.map((c, k) => lerp(c, dry[k], (macro - 0.5) * 2));

      // Мох в ложбинах, сухие кустики на буграх.
      const mossy = smooth(0.62, 0.78, tuft) * (1 - h) * 0.6;
      col = col.map((c, k) => lerp(c, moss[k], mossy));
      const dryTuft = smooth(0.66, 0.8, 1 - tuft) * h * 0.35;
      col = col.map((c, k) => lerp(c, dry[k], dryTuft));

      // Редкие проплешины голой земли.
      const bare = smooth(0.66, 0.82, patch);
      col = col.map((c, k) => lerp(c, dirt[k], bare * 0.85));

      // Затенение по рельефу + анизотропные штрихи + зерно.
      const ao = 0.78 + h * 0.32;
      const streak = 0.94 + blade * 0.12;
      const gr = 0.94 + grain * 0.12;
      const shade = ao * streak * gr;
      R[i] = col[0] * shade;
      G[i] = col[1] * shade;
      B[i] = col[2] * shade;
    }
  }

  // --- diffuse ---
  const tex = new DynamicTexture("grassTex", { width: S, height: S }, scene, true);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let i = 0; i < P; i++) {
    const o = i * 4;
    d[o] = R[i];
    d[o + 1] = G[i];
    d[o + 2] = B[i];
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);

  // --- bump (normal map из поля высот H) ---
  const bumpDt = new DynamicTexture("grassBump", { width: S, height: S }, scene, false);
  const bctx = bumpDt.getContext() as unknown as CanvasRenderingContext2D;
  const bimg = bctx.createImageData(S, S);
  const bd = bimg.data;
  const strength = 2.2;
  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const i = py * S + px;
      const l = H[py * S + ((px - 1 + S) % S)];
      const r = H[py * S + ((px + 1) % S)];
      const t = H[((py - 1 + S) % S) * S + px];
      const b = H[((py + 1) % S) * S + px];
      let nx = (l - r) * strength;
      let ny = (t - b) * strength;
      let nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const o = i * 4;
      bd[o] = (nx * 0.5 + 0.5) * 255;
      bd[o + 1] = (ny * 0.5 + 0.5) * 255;
      bd[o + 2] = (nz * 0.5 + 0.5) * 255;
      bd[o + 3] = 255;
    }
  }
  bctx.putImageData(bimg, 0, 0);
  bumpDt.update(false);

  // Один повтор ~30 м; зеркальный тайлинг + domain warp прячут швы.
  const tile = WORLD.size / 30;
  for (const tx of [tex, bumpDt]) {
    tx.uScale = tile;
    tx.vScale = tile;
    tx.wrapU = Texture.MIRROR_ADDRESSMODE;
    tx.wrapV = Texture.MIRROR_ADDRESSMODE;
    tx.anisotropicFilteringLevel = 8; // резче под острым углом (взгляд в шлеме)
  }

  const mat = new StandardMaterial("terrainMat", scene);
  // Земля должна ловить свет светлячков, а не только солнце и небо.
  mat.maxSimultaneousLights = LIGHT_BUDGET;
  mat.diffuseTexture = tex;
  mat.bumpTexture = bumpDt;
  mat.bumpTexture.level = 0.55;
  mat.specularColor = new Color3(0, 0, 0);
  return mat;
}

