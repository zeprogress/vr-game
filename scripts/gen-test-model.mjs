/**
 * Генератор тест-модели для пайплайна ассетов (этап 12).
 *
 * Пишет `public/models/pedestal.glb` — ступенчатый постамент из трёх блоков
 * с НАМЕРЕННО «чужим» материалом (глянцевый серый металл-рафнесс), чтобы
 * было видно, что перекраска в нашу плоскую палитру (loadModel → recolor)
 * реально срабатывает.
 *
 * Никаких зависимостей: собираем бинарный .glb вручную. Запуск:
 *   node scripts/gen-test-model.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "models", "pedestal.glb");

// --- геометрия единичного куба (центр в 0, сторона 1), 24 вершины, плоские нормали ---
const F = [
  { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
  { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
];

const pos = [];
const nrm = [];
const idx = [];
for (const face of F) {
  const base = pos.length / 3;
  for (const p of face.v) {
    pos.push(...p);
    nrm.push(...face.n);
  }
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

const min = (a, s) => [0, 1, 2].map((i) => Math.min(...a.filter((_, k) => k % 3 === i)) * s);
const max = (a, s) => [0, 1, 2].map((i) => Math.max(...a.filter((_, k) => k % 3 === i)) * s);

// --- три яруса: широкое основание → тело → тонкая плита-крышка ---
const TIERS = [
  { t: [0, 0.15, 0], s: [1.6, 0.3, 1.6] },
  { t: [0, 0.75, 0], s: [1.1, 0.9, 1.1] },
  { t: [0, 1.28, 0], s: [1.35, 0.16, 1.35] },
];

// --- бинарный буфер: [positions f32][normals f32][indices u16 + pad] ---
const posBuf = Buffer.from(new Float32Array(pos).buffer);
const nrmBuf = Buffer.from(new Float32Array(nrm).buffer);
let idxBuf = Buffer.from(new Uint16Array(idx).buffer);
if (idxBuf.length % 4 !== 0) idxBuf = Buffer.concat([idxBuf, Buffer.alloc(4 - (idxBuf.length % 4))]);
const bin = Buffer.concat([posBuf, nrmBuf, idxBuf]);

const gltf = {
  asset: { version: "2.0", generator: "zepgame gen-test-model" },
  scene: 0,
  scenes: [{ nodes: TIERS.map((_, i) => i) }],
  nodes: TIERS.map((tier, i) => ({
    name: `pedestal_tier_${i}`,
    mesh: 0,
    translation: tier.t,
    scale: tier.s,
  })),
  meshes: [
    {
      name: "block",
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    },
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
    { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3", min: min(pos, 1), max: max(pos, 1) },
    { bufferView: 1, componentType: 5126, count: nrm.length / 3, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: idx.length, type: "SCALAR" },
  ],
};

// --- упаковка в .glb (12-байт заголовок + JSON-chunk + BIN-chunk) ---
const pad = (b, fill) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]));
const jsonChunk = pad(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
const binChunk = pad(bin, 0x00);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

const jsonHead = Buffer.alloc(8);
jsonHead.writeUInt32LE(jsonChunk.length, 0);
jsonHead.writeUInt32LE(0x4e4f534a, 4); // "JSON"

const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(binChunk.length, 0);
binHead.writeUInt32LE(0x004e4942, 4); // "BIN\0"

writeFileSync(OUT, Buffer.concat([header, jsonHead, jsonChunk, binHead, binChunk]));
console.log(`wrote ${OUT} (${(12 + 8 + jsonChunk.length + 8 + binChunk.length)} bytes)`);
