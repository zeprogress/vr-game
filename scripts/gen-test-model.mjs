/**
 * Генератор тест-модели для пайплайна ассетов (этап 12).
 *
 * Пишет `public/models/pedestal.glb` — ступенчатый постамент, СПЕЧЁННЫЙ в один
 * меш (как приходят реальные пропы), с НАМЕРЕННО «чужим» материалом (глянцевый
 * серый металл-рафнесс), чтобы было видно, что перекраска в нашу плоскую
 * палитру реально срабатывает.
 *
 * Никаких зависимостей: собираем бинарный .glb вручную. Запуск:
 *   node scripts/gen-test-model.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", "pedestal.glb");

// грани единичного куба: нормаль + 4 угла (CCW снаружи)
const FACES = [
  { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
  { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
];

// три яруса: [центр Y, размеры XZ, высота]
const TIERS = [
  { cy: 0.15, w: 1.6, h: 0.3 },
  { cy: 0.75, w: 1.1, h: 0.9 },
  { cy: 1.28, w: 1.35, h: 0.16 },
];

const pos = [];
const nrm = [];
const idx = [];
for (const tier of TIERS) {
  for (const f of FACES) {
    const base = pos.length / 3;
    for (const [x, y, z] of f.v) {
      pos.push(x * tier.w, tier.cy + y * tier.h, z * tier.w);
      nrm.push(...f.n);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

const axisMinMax = (arr, i) => {
  let mn = Infinity;
  let mx = -Infinity;
  for (let k = i; k < arr.length; k += 3) {
    if (arr[k] < mn) mn = arr[k];
    if (arr[k] > mx) mx = arr[k];
  }
  return [mn, mx];
};
const mm = [0, 1, 2].map((i) => axisMinMax(pos, i));

const posBuf = Buffer.from(new Float32Array(pos).buffer);
const nrmBuf = Buffer.from(new Float32Array(nrm).buffer);
let idxBuf = Buffer.from(new Uint16Array(idx).buffer);
if (idxBuf.length % 4 !== 0) idxBuf = Buffer.concat([idxBuf, Buffer.alloc(4 - (idxBuf.length % 4))]);
const bin = Buffer.concat([posBuf, nrmBuf, idxBuf]);

const gltf = {
  asset: { version: "2.0", generator: "zepgame gen-test-model" },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: "pedestal", mesh: 0 }],
  meshes: [
    { name: "pedestal", primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] },
  ],
  materials: [
    {
      name: "GlossyStone",
      pbrMetallicRoughness: {
        baseColorFactor: [0.55, 0.56, 0.58, 1],
        metallicFactor: 0.9,
        roughnessFactor: 0.25,
      },
    },
  ],
  buffers: [{ byteLength: bin.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: posBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length, byteLength: nrmBuf.length, target: 34962 },
    { buffer: 0, byteOffset: posBuf.length + nrmBuf.length, byteLength: idxBuf.length, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3", min: mm.map((a) => a[0]), max: mm.map((a) => a[1]) },
    { bufferView: 1, componentType: 5126, count: nrm.length / 3, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: idx.length, type: "SCALAR" },
  ],
};

const pad = (b, fill) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]));
const jsonChunk = pad(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
const binChunk = pad(bin, 0x00);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

const jsonHead = Buffer.alloc(8);
jsonHead.writeUInt32LE(jsonChunk.length, 0);
jsonHead.writeUInt32LE(0x4e4f534a, 4);

const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(binChunk.length, 0);
binHead.writeUInt32LE(0x004e4942, 4);

writeFileSync(OUT, Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk]));
console.log(`wrote ${OUT} (${12 + 8 + jsonChunk.length + 8 + binChunk.length} bytes, ${pos.length / 3} verts)`);
