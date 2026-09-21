import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import "@babylonjs/core/Meshes/thinInstanceMesh";

import type { Terrain } from "./Terrain";
import { LIGHT_BUDGET } from "./Fireflies";
import { noGrass } from "./grassLayout";

/**
 * Трава и кусты — ТОЛЬКО перед игроком.
 *
 * Раньше ~3900 пучков были раскиданы по всей карте и рисовались всегда (у thin-инстансов нет отсечения по кадру):
 * то, что за спиной, стоило вершин впустую. Теперь клетки сетки живут «виртуально»: позиция/вид/цвет каждой
 * клетки — детерминированная функция её номера (кэшируется кусками), а раз в ~0.2 с (и только если голова
 * заметно сдвинулась/повернулась) в буферы тонких инстансов пишутся клетки внутри конуса взгляда и круга вокруг.
 * Тот же бюджет вершин даёт в 2–3 раза гуще траву там, куда смотришь. Ветра нет (дешевле шейдер).
 *
 * Виды: короткая (много), высокая, «метёлки» — три отрисовки, плюс кусты — одна. Края конуса и дальний край плавно
 * «врастают» (масштаб от 0), чтобы появление не выглядело щелчком.
 */
const CELL = 0.55; // шаг сетки травы, м
const CHUNK = 16; // клеток в куске по стороне (кэш)
const STRIDE = 11; // valid, x, y, z, yaw, s, hMul, r, g, b, kind
const BUSH_CELL = 3.4;
const R_GRASS = 25;
const R_BUSH = 34;
const R_NEAR = 5; // вокруг игрока трава всегда — за спиной не должно быть плешей рядом
const COS_HALF = Math.cos((62 * Math.PI) / 180);
const MAX_NEW_CHUNKS = 4; // сколько новых кусков считать за одну пересборку (остальное — в следующую)
const REACH = 165; // дальше от центра карты травы нет

function hash(ix: number, iz: number, k: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(k + 1, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

interface Kind {
  mesh: Mesh;
  buf: Float32Array;
  col: Float32Array | null;
  n: number;
}

function firstGeometry(root: TransformNode): Mesh | null {
  const m = root.getChildMeshes(false).find((c) => c.getTotalVertices() > 0) as Mesh | undefined;
  if (!m) return null;
  m.setParent(null);
  m.bakeCurrentTransformIntoVertices(); // низ на y = 0, чистый меш под тонкие инстансы
  return m;
}

export async function loadGrassField(
  scene: Scene,
  terrain: Terrain,
  density: number,
  lite: boolean,
): Promise<(dt: number, daylight: number) => void> {
  if (density <= 0) return () => {};
  await import("@babylonjs/loaders/glTF/2.0");
  const load = (n: string) => LoadAssetContainerAsync(`/models/nature/${n}.gltf`, scene).catch(() => null);
  const [cShort, cTall, cWispy, cBush] = await Promise.all([
    load("Grass_Common_Short"),
    load("Grass_Common_Tall"),
    load("Grass_Wispy_Short"),
    load("Bush_Common"),
  ]);
  if (!cShort) return () => {};

  const mat = new StandardMaterial("grassMat", scene);
  const tex = cShort.textures[0];
  if (tex) {
    tex.hasAlpha = true;
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    mat.transparencyMode = 1;
    mat.alphaCutOff = 0.3;
  }
  mat.diffuseColor = new Color3(0.5, 0.72, 0.38);
  const emiDay = new Color3(0.11, 0.2, 0.09);
  mat.emissiveColor = emiDay.clone();
  mat.specularColor = new Color3(0, 0, 0);
  mat.backFaceCulling = false;
  mat.maxSimultaneousLights = lite ? 2 : LIGHT_BUDGET;

  const kinds: Kind[] = [];
  const addKind = (c: typeof cBush, name: string, material: StandardMaterial, withColor: boolean): number => {
    if (!c) return -1;
    const inst = c.instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0] as TransformNode | undefined;
    const m = root ? firstGeometry(root) : null;
    if (!m) return -1;
    // В модель запечён сильный AO у корней (вершинные цвета) — почти чёрный: приподнимаем нижний край.
    const vcol = m.getVerticesData(VertexBuffer.ColorKind);
    if (vcol && withColor) {
      for (let i = 0; i < vcol.length; i += 4) {
        vcol[i] = 0.42 + vcol[i] * 0.48;
        vcol[i + 1] = 0.42 + vcol[i + 1] * 0.48;
        vcol[i + 2] = 0.42 + vcol[i + 2] * 0.48;
      }
      m.setVerticesData(VertexBuffer.ColorKind, vcol, false);
    }
    m.material = material;
    m.useVertexColors = !!vcol && withColor;
    m.isPickable = false;
    m.name = name;
    m.alwaysSelectAsActiveMesh = true;
    m.doNotSyncBoundingInfo = true;
    const cap = withColor ? 4096 : 256;
    const buf = new Float32Array(16 * cap);
    m.thinInstanceSetBuffer("matrix", buf, 16, false);
    let col: Float32Array | null = null;
    if (withColor) {
      col = new Float32Array(4 * cap);
      m.thinInstanceSetBuffer("color", col, 4, false);
    }
    m.setEnabled(false);
    kinds.push({ mesh: m, buf, col, n: 0 });
    return kinds.length - 1;
  };
  const kShort = addKind(cShort, "grassBlade", mat, true);
  const kTall = addKind(cTall, "grassBladeTall", mat, true);
  const kWispy = addKind(cWispy, "grassBladeWispy", mat, true);

  // Кусты: свой материал — листва с текстурой куста, без вершинных цветов.
  let kBush = -1;
  if (cBush) {
    const bm = new StandardMaterial("bushMat", scene);
    const bt = cBush.textures[0];
    if (bt) {
      bt.hasAlpha = true;
      bm.diffuseTexture = bt;
      bm.useAlphaFromDiffuseTexture = true;
      bm.transparencyMode = 1;
      bm.alphaCutOff = 0.28;
    }
    bm.diffuseColor = new Color3(0.72, 0.82, 0.6);
    bm.emissiveColor = new Color3(0.12, 0.18, 0.09);
    bm.specularColor = new Color3(0, 0, 0);
    bm.backFaceCulling = false;
    bm.maxSimultaneousLights = lite ? 2 : LIGHT_BUDGET;
    kBush = addKind(cBush, "grassBush", bm, false);
  }

  // ---- кэш кусков клеток ----
  const chunks = new Map<number, Float32Array>();
  const chunkKey = (cx: number, cz: number): number => (cx + 4096) * 8192 + (cz + 4096);
  const ncell = CHUNK * CHUNK;
  const build = (cx: number, cz: number): Float32Array => {
    const a = new Float32Array(ncell * STRIDE);
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const ix = cx * CHUNK + i;
        const iz = cz * CHUNK + j;
        const o = (j * CHUNK + i) * STRIDE;
        // плотность: часть клеток пустая (density 0..1) и небольшая случайная «плешивость»
        if (hash(ix, iz, 0) > density * 0.92) continue;
        const x = (ix + 0.5 + (hash(ix, iz, 1) - 0.5) * 0.9) * CELL;
        const z = (iz + 0.5 + (hash(ix, iz, 2) - 0.5) * 0.9) * CELL;
        if (Math.hypot(x, z) > REACH || noGrass(x, z)) continue;
        // низкочастотное «пятно»: где-то гуще, где-то проплешины и поляны
        const patch = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.09 + Math.sin(x * 0.05) * 2);
        if (hash(ix, iz, 3) > 0.35 + patch * 0.65) continue;
        const rk = hash(ix, iz, 4);
        const kind = rk < 0.62 || kTall < 0 ? kShort : rk < 0.86 || kWispy < 0 ? kTall : kWispy;
        const b = 0.6 + hash(ix, iz, 5) * 0.9;
        const warm = (hash(ix, iz, 6) - 0.45) * 0.5;
        a[o] = 1;
        a[o + 1] = x;
        a[o + 2] = terrain.heightAt(x, z) - 0.03;
        a[o + 3] = z;
        a[o + 4] = hash(ix, iz, 7) * Math.PI * 2;
        a[o + 5] = 0.4 + hash(ix, iz, 8) * 0.36;
        a[o + 6] = 0.9 + hash(ix, iz, 9) * 0.7;
        a[o + 7] = b + warm * 0.7;
        a[o + 8] = b + warm * 0.15;
        a[o + 9] = b - warm * 0.5;
        a[o + 10] = kind;
      }
    }
    return a;
  };

  let lastX = 1e9;
  let lastZ = 1e9;
  let lastFx = 0;
  let lastFz = 0;
  let acc = 1;
  const fwd = new Vector3();
  const write = (k: Kind, x: number, y: number, z: number, yaw: number, sx: number, sy: number, r: number, g: number, b: number): void => {
    let idx = k.n;
    if (idx * 16 + 16 > k.buf.length) {
      // рост буфера: редкость — раз в сессии
      const nb = new Float32Array(k.buf.length * 2);
      nb.set(k.buf);
      k.buf = nb;
      k.mesh.thinInstanceSetBuffer("matrix", k.buf, 16, false);
      if (k.col) {
        const nc = new Float32Array(k.col.length * 2);
        nc.set(k.col);
        k.col = nc;
        k.mesh.thinInstanceSetBuffer("color", k.col, 4, false);
      }
      idx = k.n;
    }
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const o = idx * 16;
    const m = k.buf;
    m[o] = c * sx; m[o + 1] = 0; m[o + 2] = -s * sx; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = sy; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s * sx; m[o + 9] = 0; m[o + 10] = c * sx; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
    if (k.col) {
      const co = idx * 4;
      k.col[co] = r; k.col[co + 1] = g; k.col[co + 2] = b; k.col[co + 3] = 1;
    }
    k.n++;
  };

  const rebuild = (cx: number, cz: number, fx: number, fz: number): void => {
    for (const k of kinds) k.n = 0;
    let budget = MAX_NEW_CHUNKS;
    const span = CHUNK * CELL;
    const x0 = Math.floor((cx - R_GRASS) / span);
    const x1 = Math.floor((cx + R_GRASS) / span);
    const z0 = Math.floor((cz - R_GRASS) / span);
    const z1 = Math.floor((cz + R_GRASS) / span);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = chunkKey(gx, gz);
        let a = chunks.get(key);
        if (!a) {
          if (budget-- <= 0) continue;
          a = build(gx, gz);
          chunks.set(key, a);
        }
        for (let n = 0; n < ncell; n++) {
          const o = n * STRIDE;
          if (a[o] === 0) continue;
          const dx = a[o + 1] - cx;
          const dz = a[o + 3] - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > R_GRASS * R_GRASS) continue;
          const d = Math.sqrt(d2);
          // Плавное «врастание»: у дальнего края и у краёв конуса масштаб от 0.
          let f = Math.min(1, (R_GRASS - d) / 7);
          if (d > R_NEAR) {
            const cosA = (dx * fx + dz * fz) / d;
            if (cosA < COS_HALF - 0.12) continue;
            f = Math.min(f, (cosA - (COS_HALF - 0.12)) / 0.12);
          }
          if (f <= 0.02) continue;
          const k = kinds[a[o + 10]];
          const sx = a[o + 5] * (0.5 + 0.5 * f);
          write(k, a[o + 1], a[o + 2], a[o + 3], a[o + 4], sx, sx * a[o + 6] * f, a[o + 7], a[o + 8], a[o + 9]);
        }
      }
    }
    // Кусты: крупнее и реже, чуть дальше.
    if (kBush >= 0) {
      const bk = kinds[kBush];
      const bx0 = Math.floor((cx - R_BUSH) / BUSH_CELL);
      const bx1 = Math.floor((cx + R_BUSH) / BUSH_CELL);
      const bz0 = Math.floor((cz - R_BUSH) / BUSH_CELL);
      const bz1 = Math.floor((cz + R_BUSH) / BUSH_CELL);
      for (let ix = bx0; ix <= bx1; ix++) {
        for (let iz = bz0; iz <= bz1; iz++) {
          if (hash(ix, iz, 20) > 0.62 * density) continue;
          const x = (ix + 0.5 + (hash(ix, iz, 21) - 0.5) * 0.85) * BUSH_CELL;
          const z = (iz + 0.5 + (hash(ix, iz, 22) - 0.5) * 0.85) * BUSH_CELL;
          if (Math.hypot(x, z) > REACH || noGrass(x, z)) continue;
          const dx = x - cx;
          const dz = z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 > R_BUSH * R_BUSH) continue;
          const d = Math.sqrt(d2);
          let f = Math.min(1, (R_BUSH - d) / 8);
          if (d > R_NEAR) {
            const cosA = (dx * fx + dz * fz) / d;
            if (cosA < COS_HALF - 0.12) continue;
            f = Math.min(f, (cosA - (COS_HALF - 0.12)) / 0.12);
          }
          if (f <= 0.02) continue;
          const sc = (0.5 + hash(ix, iz, 23) * 0.7) * (0.4 + 0.6 * f);
          write(bk, x, terrain.heightAt(x, z) - 0.05, z, hash(ix, iz, 24) * Math.PI * 2, sc, sc * (0.85 + hash(ix, iz, 25) * 0.4), 1, 1, 1);
        }
      }
    }
    for (const k of kinds) {
      k.mesh.thinInstanceCount = k.n;
      k.mesh.setEnabled(k.n > 0);
      if (k.n > 0) {
        k.mesh.thinInstanceBufferUpdated("matrix");
        if (k.col) k.mesh.thinInstanceBufferUpdated("color");
      }
    }
  };

  let lastK = -1;
  return (dt: number, daylight: number) => {
    // Собственная яркость травы к ночи (остаток чуть больше — трава ночью не должна проваливаться в черноту).
    const kk = 0.2 + 0.8 * daylight;
    if (Math.abs(kk - lastK) >= 0.004) {
      lastK = kk;
      mat.emissiveColor.copyFromFloats(emiDay.r * kk, emiDay.g * kk, emiDay.b * kk);
    }
    acc += dt;
    if (acc < 0.2) return;
    const cam = scene.activeCamera;
    if (!cam) return;
    const p = cam.globalPosition;
    cam.getDirectionToRef(Vector3.Forward(), fwd);
    const fl = Math.hypot(fwd.x, fwd.z);
    const fx = fl > 1e-3 ? fwd.x / fl : lastFx;
    const fz = fl > 1e-3 ? fwd.z / fl : lastFz;
    // Пересобираем, только если голова заметно сдвинулась или повернулась.
    const moved = Math.hypot(p.x - lastX, p.z - lastZ);
    const turned = fx * lastFx + fz * lastFz < 0.9986; // ~3°
    if (moved < 0.35 && !turned && kinds[0].n > 0) return;
    acc = 0;
    lastX = p.x;
    lastZ = p.z;
    lastFx = fx;
    lastFz = fz;
    rebuild(p.x, p.z, fx, fz);
  };
}
