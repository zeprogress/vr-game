/**
 * Живой бой с мобом на локальном стенде (npm run stage — только с разрешения пользователя): герой-клиент
 * встаёт рядом с ближайшим мобом модели <model> и стоит, через половину времени отходит на дальнюю
 * дистанцию (проверить умения по дальним). Пишет каждые 5 с: HP героя, оглушение, что прилетело —
 * удары (mh: урон, замедление, оглушение, отброс) и события-эффекты (ac) по маске.
 * Так Ледяной гигант был проверен до игры: стаки 1→4, на 5-м — глыба, бросок и разлом по дальнему.
 *
 *   npx tsx scripts/stage-mob-test.mts <model> [секунд=40] [--near 5] [--far 14] [--acts "^giant|frost|ice"] [--lvl 100]
 *   npx tsx scripts/stage-mob-test.mts monIceGiant 40 --acts "^giant|frostStack|iceEncase"
 */
import { Client, type Room } from "colyseus.js";
import { SPECTATOR_KEY } from "../src/shared/constants.ts";

const argv = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const model = argv[0];
if (!model || model.startsWith("--")) {
  console.error("нужно имя модели моба (MODELS в src/client/world/models.ts), например monIceGiant");
  process.exit(2);
}
const secs = Number(argv[1] && !argv[1].startsWith("--") ? argv[1] : 40);
const near = Number(opt("--near", "5"));
const far = Number(opt("--far", "14"));
const actRe = new RegExp(opt("--acts", "."));
const lvl = opt("--lvl", "100");
const HTTP = "http://localhost:2567";
const nick = "моб-тест";
const sid = "1ce91a47-0000-4000-8000-00000000a1a1";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (t: string) =>
  fetch(`${HTTP}/api/devchat?nick=${encodeURIComponent(nick)}&text=${encodeURIComponent(t)}`).then((r) => r.text());

const c = new Client("ws://localhost:2567");
const spec: Room = await c.joinOrCreate("zone", { spectator: SPECTATOR_KEY });
spec.onMessage("*", () => {});
await wait(800);
// Герой создаётся через чат стенда (!play), вход — кодом со страницы инвентаря.
await say("!play");
await wait(1500);
{
  const inv: Room = await c.joinOrCreate("inventory_room", { nick, sid });
  let page: { authed?: boolean; code?: string } | null = null;
  inv.onMessage("*", (t, m) => {
    if (t === "inv") page = m;
  });
  await wait(800);
  const pg = page as { authed?: boolean; code?: string } | null;
  if (!pg?.authed && pg?.code) {
    await say(pg.code);
    await wait(500);
  }
  await inv.leave();
}
const room: Room = await c.joinOrCreate("zone", { nick, sid });
const log = { hits: 0, dmg: 0, slowMax: 0, stun: 0, kb: 0, acts: {} as Record<string, number>, mine: [] as string[] };
room.onMessage("*", (type, m) => {
  if (type === "mh") {
    log.hits++;
    log.dmg += m.dmg ?? 0;
    if (m.slowFrac && m.slowSec) log.slowMax = Math.max(log.slowMax, m.slowFrac);
    if (m.stunSec) log.stun++;
    if (m.knockback) log.kb++;
  } else if (type === "ac" && actRe.test(m.k)) {
    log.acts[m.k] = (log.acts[m.k] ?? 0) + 1;
    if (m.id === room.sessionId) log.mine.push(`${m.k}${m.d != null ? ":" + m.d : ""}`);
  }
});
await wait(800);
console.log(`!lvl ${lvl}:`, await say(`!lvl ${lvl}`));

type M = { model: string; x: number; y: number; z: number; dead?: boolean };
let mid = "";
let best = Infinity;
(spec.state.mobs as Map<string, M>).forEach((m, id) => {
  if (m.model !== model || m.dead) return;
  const me = room.state.players.get(room.sessionId);
  const d = me ? Math.hypot(m.x - me.x, m.z - me.z) : 0;
  if (d < best) {
    best = d;
    mid = id;
  }
});
const mob0 = spec.state.mobs.get(mid) as M | undefined;
if (!mob0) {
  console.error(`моба ${model} на стенде нет (живого)`);
  process.exit(1);
}
console.log(`моб ${mid} в (${mob0.x.toFixed(1)}, ${mob0.y.toFixed(1)}, ${mob0.z.toFixed(1)})`);
const head = [mob0.x + near * 0.8, mob0.y + 1.6, mob0.z + near * 0.6, 0, 0, 0, 1];
const zero = [0, 0, 0, 0, 0, 0, 1];
const t0 = Date.now();
let lastLog = -1;
while (Date.now() - t0 < secs * 1000) {
  const g = spec.state.mobs.get(mid) as M | undefined;
  const dist = Date.now() - t0 > (secs * 1000) / 2 ? far : near;
  if (g) {
    const dx = head[0] - g.x;
    const dz = head[2] - g.z;
    const d = Math.hypot(dx, dz) || 1;
    head[0] = g.x + (dx / d) * dist;
    head[2] = g.z + (dz / d) * dist;
  }
  room.send("m", { mode: "flat", plat: 1, head, handL: zero, handR: zero, guard: { sx: 0, sz: 1, wx: 0, wz: 1 } });
  await wait(100);
  const me = room.state.players.get(room.sessionId);
  const sec = Math.floor((Date.now() - t0) / 5000);
  if (sec !== lastLog) {
    lastLog = sec;
    console.log(
      `${sec * 5}с ${dist}м hp ${Math.round(me?.hp)}/${Math.round(me?.maxHp)} оглушён ${me?.stunned} | моб замах ${(g as { attackSeq?: number })?.attackSeq} вид ${(g as { attackKind?: number })?.attackKind} | ${JSON.stringify(log)}`,
    );
  }
  if (me?.dead) {
    console.log("герой погиб");
    break;
  }
}
await room.leave();
await spec.leave();
process.exit(0);
