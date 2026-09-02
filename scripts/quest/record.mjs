#!/usr/bin/env node
// Записать экран шлема, забрать mp4, разложить на кадры для покадрового разбора.
//
//   node scripts/quest/record.mjs 12          # 12 c, кадры каждые 0.5 c
//   node scripts/quest/record.mjs 20 0.25     # 20 c, кадр каждые 0.25 c
//
// Пишет в .tmp/quest/<timestamp>/ (video.mp4 + frame-*.jpg). Требует metavr + ffmpeg.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const secs = Number(process.argv[2]) || 12;
const step = Number(process.argv[3]) || 0.5;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = `.tmp/quest/${stamp}`;
mkdirSync(dir, { recursive: true });

const dev = "/sdcard/qrec.mp4";
console.log(`запись ${secs} c…  (играй в шлеме)`);
try {
  execFileSync("metavr", ["adb", "shell", "screenrecord", "--time-limit", String(secs), "--bit-rate", "8000000", dev], {
    stdio: "inherit",
    timeout: (secs + 15) * 1000,
  });
} catch {
  /* screenrecord выходит по --time-limit ненулевым кодом — это норм */
}

execFileSync("metavr", ["adb", "pull", dev, `${dir}/video.mp4`], { stdio: "inherit" });
execFileSync("metavr", ["adb", "shell", "rm", dev], { stdio: "inherit" });
execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", `${dir}/video.mp4`, "-vf", `fps=1/${step}`, `${dir}/frame-%03d.jpg`], {
  stdio: "inherit",
});

console.log(`\nготово: ${dir}/`);
console.log("кадры: frame-*.jpg — читай их через Read");
