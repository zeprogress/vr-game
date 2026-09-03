/**
 * .gltf с одним встроенным base64-буфером и без картинок → бинарный .glb.
 * Без зависимостей: GLB = заголовок + JSON-чанк + BIN-чанк.
 *
 *   node scripts/gltf-to-glb.mjs in.gltf out.glb
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("укажи: node scripts/gltf-to-glb.mjs in.gltf out.glb");
  process.exit(1);
}

const gltf = JSON.parse(readFileSync(inPath, "utf8"));
if (!gltf.buffers || gltf.buffers.length !== 1) {
  throw new Error(`ожидал ровно 1 буфер, а их ${gltf.buffers?.length}`);
}
if (gltf.images?.length) throw new Error("в файле есть images — конвертер их не тянет");

const uri = gltf.buffers[0].uri || "";
const m = /^data:[^;]*;base64,(.*)$/s.exec(uri);
if (!m) throw new Error("буфер не data:base64 — нечего паковать");
const bin = Buffer.from(m[1], "base64");
delete gltf.buffers[0].uri;
gltf.buffers[0].byteLength = bin.length;

const pad = (b, fill) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]));
const jsonChunk = pad(Buffer.from(JSON.stringify(gltf), "utf8"), 0x20);
const binChunk = pad(bin, 0x00);

const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);

const jh = Buffer.alloc(8);
jh.writeUInt32LE(jsonChunk.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4); // "JSON"

const bh = Buffer.alloc(8);
bh.writeUInt32LE(binChunk.length, 0);
bh.writeUInt32LE(0x004e4942, 4); // "BIN\0"

writeFileSync(outPath, Buffer.concat([header, jh, jsonChunk, bh, binChunk]));
console.log(`${outPath}  ${(total / 1024).toFixed(0)} КБ`);
