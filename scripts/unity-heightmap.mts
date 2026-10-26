// Выгрузка рельефа поляны для Unity-клиента (unity/): та же формула, что у сервера.
// npx tsx scripts/unity-heightmap.mts → unity/Assets/Terrain/heightmap.r16 + heightmap.json
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { ELITE_MOBS, SLIME_CFG, SPITTER_CFG, BOSS_CFG, SHARD_CFG } from "../src/shared/mobs.ts";
import { SKIN_MODELS } from "../src/shared/skins.ts";
import { terrainHeightNatural } from "../src/shared/terrain.ts";
import { WORLD } from "../src/shared/constants.ts";
import { trees } from "../src/shared/trees.ts";
import { dayState } from "../src/client/world/DayTime.ts";
import { dunLights, dunDress } from "../src/shared/dungeonDress.ts";
import { PLAY_BOUNDS } from "../src/shared/raid.ts";
import { DUN_X, DUN_Z, DUN_Y0, DUN_HALF, DUN_CAM_MIN } from "../src/shared/dungeon.ts";
import { CAT_Z0 } from "../src/shared/catacombs.ts";
import { MSG } from "../src/shared/net/messages.ts";
import { PROGRESSION } from "../src/shared/constants.ts";
import { meleeAnimRate, atMaxLevel, xpToNext } from "../src/shared/progression.ts";
import { SPECTATE, BOT, SKILL } from "../src/shared/constants.ts";
import { BOSS, MOB, BLINK, PULL, CHARGE, SPIKES, CHIEF_HEAL, FREEZE, SPORE } from "../src/shared/mobs.ts";
import { HUB, HUB_CENTER } from "../src/shared/hub.ts";
import { CINE_PATHS, INTRO_PATH, ROTATION, ROTATION_IDLE } from "../src/client/spectator/cine.ts";

const RES = 1025; // Unity: 2^n + 1
const HALF = WORLD.size / 2 + 12;
// Квадрат со сдвигом к югу: плато рейд-босса (PLAY_BOUNDS.z0) лежит за краем поляны — как кеш высот сервера.
const size = HALF * 2 + Math.max(0, -HALF - (PLAY_BOUNDS.z0 - 8));
const x0 = -size / 2;
const z0 = Math.min(-HALF, PLAY_BOUNDS.z0 - 8);
const h = new Float32Array(RES * RES);
let min = Infinity;
let max = -Infinity;
for (let j = 0; j < RES; j++) {
  const z = z0 + (j / (RES - 1)) * size;
  for (let i = 0; i < RES; i++) {
    const v = terrainHeightNatural(x0 + (i / (RES - 1)) * size, z);
    h[j * RES + i] = v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
}
const raw = Buffer.alloc(RES * RES * 2);
for (let k = 0; k < h.length; k++) raw.writeUInt16LE(Math.round(((h[k] - min) / (max - min)) * 65535), k * 2);
mkdirSync("unity/Assets/Terrain", { recursive: true });
writeFileSync("unity/Assets/Terrain/heightmap.r16.bytes", raw);
writeFileSync("unity/Assets/Terrain/heightmap.json", JSON.stringify({ res: RES, size, x0, z0, minY: min, maxY: max }));
// Деревья — те же места, что у сервера (коллизии и мобы совпадут).
writeFileSync("unity/Assets/Terrain/trees.json", JSON.stringify({ items: trees() }));
// Спектатор: кинопути, лагерь (группу там не снимаем), агро босса, константы режиссёра.
writeFileSync(
  "unity/Assets/Terrain/spectator.json",
  JSON.stringify({
    paths: CINE_PATHS.map((p) => ({
      name: p.name,
      duration: p.duration,
      fov: p.fov ?? 0,
      freePitch: !!p.freePitch,
      lookLevel: p.lookLevel ?? 0,
      keys: p.keys.map((k) => ({ p: k.p, l: k.l })),
    })),
    introPath: INTRO_PATH,
    rotation: ROTATION,
    rotationIdle: ROTATION_IDLE,
    hub: { x: HUB_CENTER.x, z: HUB_CENTER.z, r: HUB.safeRadius },
    bossAggro: BOSS.aggroRange,
    mobBodyRadius: MOB.bodyRadius,
    spectate: SPECTATE,
    // Радиусы и времена умений по умолчанию — когда событие (ActRelay) пришло без r/d (Spectator.onAct).
    fx: {
      stunRadius: BOT.stunRadius, stunCast: BOT.stunCastTime, healRadius: BOT.healRadius, healCast: BOT.healCastTime,
      rainRadius: BOT.rainRadius, rainCast: BOT.rainCastTime, rainDuration: SKILL.arrowRain.duration,
      freezeRadius: FREEZE.radius, freezeWindup: FREEZE.windup, spikesRadius: SPIKES.radius, spikesWindup: SPIKES.windup,
      sporeRadius: SPORE.radius, sporeWindup: SPORE.windup, sporeDuration: SPORE.duration,
      chargeWindup: CHARGE.windup, pullWindup: PULL.windup, blinkFade: BLINK.fade, chiefHealRadius: CHIEF_HEAL.radius,
    },
    // Области под землёй (inDunRegion / inCatRegion): камера там идёт по полу и не проходит сквозь стены.
    dun: { x: DUN_X, z: DUN_Z, half: DUN_HALF + 20, camMin: DUN_CAM_MIN },
    cat: { z0: CAT_Z0, halfX: 100 }, // halfX — CAT_HALF_X в shared/catacombs.ts (не экспортируется)
  }),
);
// Модели: ключ MobState.model → файл (MODELS в client/world/models.ts), посадка элитных мобов, скины героев.
const modelsSrc =
  readFileSync("src/client/world/models.ts", "utf8") + readFileSync("src/client/items/weaponModels.ts", "utf8");
const models = [...modelsSrc.matchAll(/^\s+(\w+): "\/models\/([^"]+)"/gm)].map((m) => ({ key: m[1], path: m[2] }));
const elites = Object.values(ELITE_MOBS).map((d) => ({
  model: d.model ?? "",
  drop: d.modelDrop ?? 0,
  attackClip: d.attackClip ?? "",
  noSquash: !!d.noSquash,
  scaleMul: d.scaleMul ?? 1,
  tint: d.tint ? [...d.tint] : [],
}));
// Цвет вида для мобов без своей модели (recolorRig в combat/Mob.ts): тело полупрозрачное, глаза тёмные.
const kinds = Object.entries({ slime: SLIME_CFG, spitter: SPITTER_CFG, boss: BOSS_CFG, shard: SHARD_CFG }).map(([kind, c]) => ({
  kind,
  name: c.name,
  tint: [...c.tint],
  alpha: c.alpha,
}));
// По уровням 1..max: темп замаха героя (meleeAnimRate) и опыт до следующего уровня (полоска на плашке).
const levels = Array.from({ length: PROGRESSION.maxLevel }, (_, i) => i + 1);
const meleeRate = levels.map((l) => meleeAnimRate(l));
const xpNext = levels.map((l) => (atMaxLevel(l) ? -1 : xpToNext(l)));
writeFileSync(
  "unity/Assets/Terrain/models.json",
  JSON.stringify({ models, elites, kinds, skins: SKIN_MODELS, bodyRadius: MOB.bodyRadius, meleeRate, xpNext }),
);

// Свет: dayState веба по часам (шаг 0.1 ч) и огни подземелья (жаровни, кристаллы — dunLights).
const c3 = (c: { r: number; g: number; b: number }): number[] => [c.r, c.g, c.b];
const day = Array.from({ length: 241 }, (_, i) => {
  const d = dayState(i / 10);
  return {
    sunDir: [d.sunDir.x, d.sunDir.y, d.sunDir.z],
    sun: c3(d.sunColor),
    sunI: d.sunIntensity,
    zenith: d.zenith.map((v) => v / 255),
    horizon: d.horizon.map((v) => v / 255),
    fog: c3(d.fog),
    fogNear: d.fogNear,
    fogFar: d.fogFar,
    disc: c3(d.disc),
    daylight: d.daylight,
  };
});
const dun = dunLights().map((l) => ({ p: l.p, color: l.color, range: l.range, power: l.power, flame: l.flame ?? 0 }));
writeFileSync("unity/Assets/Terrain/light.json", JSON.stringify({ day, dun }));

// Мелочь подземелья (жаровни, бочки, ящики, кости, колонны…): модули DungeonKit.glb по dunDress — в координатах
// корня подземелья (DUN_X, DUN_Y0, DUN_Z), как в DungeonFx.loadKit. Браузер не нужен.
const dress = dunDress().map((d) => ({ k: d.k, zone: d.zone, p: d.p, f: d.f, up: d.up, s: d.s }));
// NPC лагеря (Zone.ts → spawnHubNpc): модель, место, лицом к костру.
const fire = HUB.campfire.pos;
const npcs = [
  { title: "Трактирщик ◈", model: "charViking", ...HUB.zones.tavern },
  { title: "Охотник", model: "charCowboy", ...HUB.zones.hunter },
].map((n) => ({ ...n, y: terrainHeightNatural(n.x, n.z), yaw: Math.atan2(fire.x - n.x, fire.z - n.z) }));
writeFileSync(
  "unity/Assets/Terrain/props.json",
  JSON.stringify({ dunOrigin: [DUN_X, DUN_Y0, DUN_Z], dress, npcs }),
);

// Все типы сообщений сервера: Unity-клиент глушит необработанные (иначе SDK пишет предупреждение на каждое).
mkdirSync("unity/Assets/Resources", { recursive: true });
writeFileSync("unity/Assets/Resources/msgTypes.json", JSON.stringify({ types: [...new Set(Object.values(MSG))] }));
console.log(`рельеф ${RES}² на ${size} м, высоты ${min.toFixed(1)}…${max.toFixed(1)}`);
