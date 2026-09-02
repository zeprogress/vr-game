#!/usr/bin/env node
// Игровая сессия под наблюдением: ставит перехваты (hooks.js) и стримит консоль.
// Надень шлем, играй — [CAST] / [BURST] / [CAST-ABORT] и ошибки идут сюда.
//
//   node scripts/quest/watch.mjs            # 2 мин
//   node scripts/quest/watch.mjs 300000     # 5 мин
//   node scripts/quest/watch.mjs --follow
//
// Требует scripts/quest/connect.sh.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = process.env.CDP_PORT || 9222;
const here = dirname(fileURLToPath(import.meta.url));
const hooks = readFileSync(join(here, "hooks.js"), "utf8");
const argv = process.argv.slice(2);
const follow = argv.includes("--follow");
const ms = Number(argv.find((a) => /^\d+$/.test(a))) || 120000;

let list;
try {
  list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
} catch {
  console.error(`нет CDP на :${PORT} — запусти scripts/quest/connect.sh`);
  process.exit(2);
}
const page =
  list.find((p) => p.type === "page" && p.url.includes("zepgame")) ||
  list.find((p) => p.type === "page");
if (!page) {
  console.error("страница игры не найдена");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const send = (method, params) => ws.send(JSON.stringify({ id: ++id, method, params }));
const ts = () => new Date().toISOString().slice(11, 23);
const arg = (a) =>
  a?.value ?? a?.description ?? (a?.type === "undefined" ? "undefined" : JSON.stringify(a));

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === "Runtime.consoleAPICalled") {
    console.log(`${ts()} [${m.params.type}] ${m.params.args.map(arg).join(" ")}`);
  } else if (m.method === "Runtime.exceptionThrown") {
    const e = m.params.exceptionDetails;
    console.log(`${ts()} [exception] ${e.exception?.description || e.text}`);
  } else if (m.method === "Log.entryAdded") {
    console.log(`${ts()} [${m.params.entry.level}] ${m.params.entry.text}`);
  }
});

await new Promise((r) => ws.addEventListener("open", r));
send("Runtime.enable");
send("Log.enable");
setTimeout(() => send("Runtime.evaluate", { expression: hooks }), 300);
if (!follow) setTimeout(() => process.exit(0), ms);
