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
import { trees } from "#shared/trees";
import { rocks } from "#shared/rocks";
import { computeGrassLayout } from "./grassLayout";

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
/** Ниже этого AO не темнит — иначе под рощей получается чернота. */
const AO_FLOOR = 0.3;
/** Радиус затенения под кроной, м (плюс вклад размера дерева). */
const AO_TREE_REACH = 5;
const AO_TREE_PER_SCALE = 3.2;
/**
 * Камни ниже и мельче деревьев — тень короче и заметно слабее (это не
 * крона, а лёгкий прижим у основания), иначе мелкий камень тонет в кляксе.
 */
const AO_ROCK_REACH = 0.6;
const AO_ROCK_PER_SCALE = 1.6;
const AO_ROCK_STRENGTH = 0.4;
/**
 * Трава просвечивает — под кляксой не тень, а лёгкое сгущение цвета (густой
 * дёрн темнее голой земли). Слабее и рока, и особенно кроны дерева.
 */
const AO_GRASS_PER_SIZE = 0.55;
const AO_GRASS_STRENGTH = 0.22;
/** Вклад впадин рельефа: ложбины темнее гребней. */
const AO_RELIEF = 0.7;
/** На каком перепаде с соседями впадина считается глубокой, м. */
const AO_DIP_FULL = 0.4;

/**
 * Запечённое затенение по вершинам (вместо теней).
 *
 * Считаем один раз при сборке меша и кладём в цвета вершин: в рантайме это
 * стоит ноль, шейдер их и так читает. Настоящие тени тут не годятся — солнце
 * в мире движется, и запечённая тень верна лишь для одного его положения.
 * AO от солнца не зависит и переживает весь суточный цикл.
 *
 * Три вклада:
 *  - тень кроны: деревья детерминированы (#shared/trees), радиус берём по
 *    кроне, а не по стволу — шаг сетки 2.5 м, на радиусе ствола затенение
 *    попало бы в одну-две вершины и его никто бы не увидел;
 *  - камни (#shared/rocks): та же идея, но короче и слабее — не крона;
 *  - трава: клякс много (см. grassLayout.ts, общая раскладка с nature.ts),
 *    поэтому вклад на клячу — самый слабый из трёх, просто лёгкое сгущение;
 *  - вогнутость рельефа: вершина ниже соседей — ложбина, темнее.
 *
 * Высоты соседей берём прямо из сетки, а не пересчитываем surface(): это
 * убирает четыре вызова на вершину, самую дорогую часть запекания.
 */
function bakeAo(positions: number[], row: number, grassDensity: number): number[] {
  const treeList = trees();
  const rockList = rocks();
  const grassBlobs = computeGrassLayout(grassDensity).blobs;
  const n = positions.length / 3;
  const colors: number[] = new Array(n * 4);

  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    // Кроны: чем ближе и крупнее дерево, тем темнее под ним.
    let shade = 0;
    for (const t of treeList) {
      const reach = AO_TREE_REACH + t.scale * AO_TREE_PER_SCALE;
      const dx = x - t.x;
      const dz = z - t.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const k = 1 - Math.sqrt(d2) / reach;
      shade += k * k * (0.5 + t.scale * 0.3);
    }

    // Камни: короткий и слабый прижим у основания.
    for (const rk of rockList) {
      const reach = AO_ROCK_REACH + rk.scale * AO_ROCK_PER_SCALE;
      const dx = x - rk.x;
      const dz = z - rk.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const k = 1 - Math.sqrt(d2) / reach;
      shade += k * k * AO_ROCK_STRENGTH;
    }

    // Трава: под каждой кляксой — лёгкое сгущение, не тень.
    for (const gb of grassBlobs) {
      const reach = gb.size * AO_GRASS_PER_SIZE;
      const dx = x - gb.x;
      const dz = z - gb.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) continue;
      const k = 1 - Math.sqrt(d2) / reach;
      shade += k * k * AO_GRASS_STRENGTH;
    }

    // Рельеф: сравниваем с четырьмя соседями по сетке (у края — сам с собой).
    const col = i % row;
    const left = col > 0 ? positions[(i - 1) * 3 + 1] : y;
    const right = col < row - 1 ? positions[(i + 1) * 3 + 1] : y;
    const up = i >= row ? positions[(i - row) * 3 + 1] : y;
    const down = i + row < n ? positions[(i + row) * 3 + 1] : y;
    const dip = (left + right + up + down) / 4 - y;
    if (dip > 0) shade += Math.min(1, dip / AO_DIP_FULL) * AO_RELIEF;

    const ao = Math.max(AO_FLOOR, 1 - Math.min(1, shade));
    colors[i * 4] = ao;
    colors[i * 4 + 1] = ao;
    colors[i * 4 + 2] = ao;
    colors[i * 4 + 3] = 1;
  }
  return colors;
}

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
  grassDensity: number,
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
  vd.colors = bakeAo(positions, row, grassDensity);
  vd.applyToMesh(mesh);
  return mesh;
}

/**
 * `grassDensity` — та же плотность (0..1), что уходит в scatterGrass:
 * запечённое под травой AO должно совпадать с тем, что реально растёт на
 * этом пресете качества (см. buildZone в Zone.ts).
 */
export function createTerrain(scene: Scene, grassDensity = 1): Terrain {
  const size = WORLD.size;
  const seg = WORLD.subdivisions;
  const half = size / 2;
  const step = size / seg;

  const mat = grassMaterial(scene);

  // Игровая зона: та же сетка, коллизии и raycast'ы игрока.
  const mesh = buildPatch(scene, "terrain", -half, half, -half, half, step, half, false, grassDensity);
  mesh.checkCollisions = true;
  mesh.isPickable = true;
  mesh.material = mat;

  // Фартук: земля тянется дальше во все стороны — за краем зоны не пустота,
  // а те же холмы. Чисто декоративный: без коллизий и без пикинга, чуть ниже
  // игрового меша, поэтому в зоне перекрытия глубинный тест выигрывает зона.
  const far = half * (1 + 2 * APRON);
  const apron = buildPatch(
    scene,
    "terrainApron",
    -far,
    far,
    -far,
    far,
    step * 2,
    half,
    true,
    grassDensity,
  );
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
 * Домен искажаем шумом (domain warp), а сам шум ПЕРИОДИЧЕН по SPAN: решётка
 * заворачивается, поэтому текстура тайлится встык (WRAP) без шва — раньше
 * зеркальный режим давал складку по осям x=0/z=0 в центре карты.
 */
function grassMaterial(scene: Scene): StandardMaterial {
  const S = 1024;
  const SPAN = 5; // размер домена шума = период одного повтора текстуры

  const hash = (x: number, y: number): number => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  // Периодический value-noise: целочисленная решётка берётся по модулю `cells`,
  // значения на противоположных краях домена совпадают.
  const pnoise = (x: number, y: number, cells: number): number => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const w = (n: number): number => ((n % cells) + cells) % cells;
    const x0 = w(xi);
    const x1 = w(xi + 1);
    const y0 = w(yi);
    const y1 = w(yi + 1);
    const a = hash(x0, y0);
    const b = hash(x1, y0);
    const c = hash(x0, y1);
    const e = hash(x1, y1);
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + e * u * v;
  };
  // fbm по [0,SPAN)²: каждая октава укладывается целым числом клеток в SPAN,
  // поэтому сумма тоже периодична с периодом SPAN.
  const fbm = (x: number, y: number, oct = 6): number => {
    let f = 0;
    let amp = 0.5;
    for (let o = 0; o < oct; o++) {
      const fr = 1 << o;
      f += amp * pnoise(x * fr, y * fr, SPAN * fr);
      amp *= 0.5;
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
      const u = (px / S) * SPAN;
      const v = (py / S) * SPAN;

      // Domain warp: гнём координаты вторым шумом. Целые множители/сдвиги —
      // иначе искажение перестаёт быть периодичным и шов возвращается.
      const wx = u + 0.8 * fbm(u + 5, v + 1, 4);
      const wy = v + 0.8 * fbm(u + 3, v + 6, 4);

      const macro = fbm(wx, wy); // где трава гуще/суше
      const patch = fbm(wx * 2 + 40, wy * 2 + 40, 5); // проплешины
      const tuft = fbm(wx * 4 - 12, wy * 4 + 7, 4); // кустики / мох
      const grain = pnoise(u * 40, v * 40, SPAN * 40); // мелкое зерно
      const blade = pnoise(u * 90 + v * 12, v * 6, SPAN * 6); // штрихи «по травинке»

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

  // Один повтор ~30 м; текстура периодична, поэтому WRAP встык — без шва.
  const tile = WORLD.size / 30;
  for (const tx of [tex, bumpDt]) {
    tx.uScale = tile;
    tx.vScale = tile;
    tx.wrapU = Texture.WRAP_ADDRESSMODE;
    tx.wrapV = Texture.WRAP_ADDRESSMODE;
    tx.anisotropicFilteringLevel = 8; // резче под острым углом (взгляд в шлеме)
  }

  const mat = new StandardMaterial("terrainMat", scene);
  // Земля должна ловить свет светлячков, а не только солнце и небо.
  mat.maxSimultaneousLights = LIGHT_BUDGET;
  // Крошечная собственная яркость: днём тонет в солнце, ночью чуть
  // приподнимает землю над чернотой (там, где нет светлячков).
  mat.emissiveColor = new Color3(0.016, 0.02, 0.017);
  mat.diffuseTexture = tex;
  mat.bumpTexture = bumpDt;
  // Слабый рельеф: сильный bump под точечным светом светлячков даёт полосатые
  // блики на земле.
  mat.bumpTexture.level = 0.22;
  mat.specularColor = new Color3(0, 0, 0);
  return mat;
}

