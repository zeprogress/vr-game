/**
 * Геометрия и расстановка подземелья в JSON — для рендер-превью в Blender (tools/blender/preview_dungeon.py).
 *   npx tsx tools/dungeon/export.mts <out.json>
 */
import { writeFileSync } from "node:fs";
import { dunGeometry } from "../../src/shared/dungeonGeo";
import { dunDress } from "../../src/shared/dungeonDress";
import { DUN_FALLS, DUN_ZONES, dunFloorLocal } from "../../src/shared/dungeon";

const out = process.argv[2] ?? "art/build/dungeon.json";
const zones = DUN_ZONES.map((z) => ({ id: z.id, u: z.u, v: z.v, h: dunFloorLocal(z.u, z.v) ?? 20, ceil: z.ceil, style: z.style }));
writeFileSync(out, JSON.stringify({ geo: dunGeometry(), dress: dunDress(), zones, falls: DUN_FALLS }));
console.log(out);
