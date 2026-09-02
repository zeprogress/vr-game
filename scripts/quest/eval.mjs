#!/usr/bin/env node
// Выполнить JS-выражение в запущенной игре на шлеме (Quest Browser) через CDP.
//
//   node scripts/quest/eval.mjs 'window.game.combat.mana'
//   echo 'долгое выражение' | node scripts/quest/eval.mjs
//
// Требует проброшенный порт: scripts/quest/connect.sh (один раз за сессию).
const PORT = process.env.CDP_PORT || 9222;

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
  console.error("страница игры не найдена (открой zepgame.duckdns.org в шлеме)");
  process.exit(1);
}

const expr =
  process.argv[2] ??
  (await new Promise((r) => {
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => r(s));
  }));

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});

await new Promise((r) => ws.addEventListener("open", r));
const res = await send("Runtime.evaluate", {
  expression: expr,
  returnByValue: true,
  awaitPromise: true,
  allowUnsafeEvalBlocklistBypass: true,
});
ws.close();

if (res.result?.exceptionDetails) {
  const e = res.result.exceptionDetails;
  console.error("EXCEPTION:", e.exception?.description || e.text);
  process.exit(1);
}
const v = res.result?.result;
console.log(v?.type === "string" ? v.value : JSON.stringify(v?.value ?? { type: v?.type }, null, 2));
