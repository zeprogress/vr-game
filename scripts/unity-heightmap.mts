// Выгрузка рельефа поляны для Unity-клиента (unity/): та же формула, что у сервера.
// npx tsx scripts/unity-heightmap.mts → unity/Assets/Terrain/heightmap.r16 + heightmap.json
import { writeFileSync, mkdirSync } from "node:fs";
import { terrainHeightNatural } from "../src/shared/terrain.ts";
import { WORLD } from "../src/shared/constants.ts";
import { trees } from "../src/shared/trees.ts";

const RES = 1025; // Unity: 2^n + 1
const HALF = WORLD.size / 2 + 12;
const size = HALF * 2;
const h = new Float32Array(RES * RES);
let min = Infinity;
let max = -Infinity;
for (let j = 0; j < RES; j++) {
  const z = -HALF + (j / (RES - 1)) * size;
  for (let i = 0; i < RES; i++) {
    const v = terrainHeightNatural(-HALF + (i / (RES - 1)) * size, z);
    h[j * RES + i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
}
const raw = Buffer.alloc(RES * RES * 2);
for (let k = 0; k < h.length; k++) raw.writeUInt16LE(Math.round(((h[k] - min) / (max - min)) * 65535), k * 2);
mkdirSync("unity/Assets/Terrain", { recursive: true });
writeFileSync("unity/Assets/Terrain/heightmap.r16.bytes", raw);
writeFileSync("unity/Assets/Terrain/heightmap.json", JSON.stringify({ res: RES, size, minY: min, maxY: max }));
// Деревья — те же места, что у сервера (коллизии и мобы совпадут).
writeFileSync("unity/Assets/Terrain/trees.json", JSON.stringify({ items: trees() }));
console.log(`рельеф ${RES}² на ${size} м, высоты ${min.toFixed(1)}…${max.toFixed(1)}`);
