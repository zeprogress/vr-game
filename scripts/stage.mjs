#!/usr/bin/env node
// Локальный тестовый стенд: игровой сервер (STAGING=1 — без Twitch и ботов
// с прода, «чат» — со страницы /stage.html) + Vite с HTTPS на всю сеть (Quest,
// телефон). Одна команда: npm run stage. Остановить — Ctrl+C.
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";

const ip =
  Object.values(networkInterfaces())
    .flat()
    .find((a) => a && a.family === "IPv4" && !a.internal)?.address ?? "localhost";

const kids = [];
function run(tag, color, cmd, args, env) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const pipe = (s) => (d) =>
    d.toString().split("\n").filter(Boolean).forEach((l) => s.write(`\x1b[${color}m[${tag}]\x1b[0m ${l}\n`));
  p.stdout.on("data", pipe(process.stdout));
  p.stderr.on("data", pipe(process.stderr));
  p.on("exit", (c) => {
    console.log(`[${tag}] завершился (${c}) — гашу стенд`);
    stop();
  });
  kids.push(p);
}
function stop() {
  for (const k of kids) if (!k.killed) k.kill("SIGTERM");
  setTimeout(() => process.exit(0), 300);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

run("server", "36", "npx", ["tsx", "watch", "src/server/index.ts"], { STAGING: "1", GAME_SERVER_PORT: "2567" });
run("vite", "35", "npx", ["vite", "--port", "5173", "--strictPort"], { VR: "1" });

setTimeout(() => {
  console.log(`
\x1b[1m=== ТЕСТОВЫЙ СТЕНД ===\x1b[0m
  Пульт стенда (ссылки, чат):  https://localhost:5173/stage.html
  С Quest / телефона:          https://${ip}:5173/stage.html
  (сертификат самоподписанный — в браузере «всё равно перейти»)
`);
}, 2500);
