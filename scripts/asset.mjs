#!/usr/bin/env node
/**
 * Пайплайн ассетов ZEP GAME: запускает скрипты Blender без интерфейса и печатает только итог
 * (JSON) — дёшево по токенам: ни скриншотов, ни шума Blender.
 *
 *   npm run asset -- inspect <модель>                       — треугольники, материалы, кости, клипы, рост
 *   npm run asset -- preview <модель> <out.png> [--anim Run] — лист превью 2×2 (и кадры клипа)
 *   npm run asset -- prep <вход> <выход.glb> [опции]        — под стиль и бюджеты игры (см. docs/pipelines/models.md)
 *   npm run asset -- newloc <сцена.blend> [--size 80]       — заготовка локации с коллекциями пайплайна
 *   npm run asset -- scatter <сцена.blend> --kit Rocks [--count 300 …] — расставить детали по земле (см. docs/pipelines/locations.md)
 *   npm run asset -- location <сцена.blend> <папка> [--name hub2] — GLB с инстансами + карта высот + коллайдеры
 *
 * Blender: переменная BLENDER или /Applications/Blender.app (macOS).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = {
  inspect: "inspect_model.py",
  preview: "preview_model.py",
  prep: "prep_model.py",
  location: "export_location.py",
  scatter: "scatter.py",
  newloc: "new_location.py",
};
const [cmd, ...rest] = process.argv.slice(2);
if (!SCRIPTS[cmd]) {
  console.error(`команды: ${Object.keys(SCRIPTS).join(", ")}`);
  process.exit(2);
}
const blender =
  process.env.BLENDER ||
  ["/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender", "C:/Program Files/Blender Foundation/Blender/blender.exe"].find((p) => existsSync(p));
if (!blender) {
  console.error("Blender не найден — укажи путь в переменной BLENDER");
  process.exit(2);
}
// Пути — абсолютные: Blender запускается со своей рабочей папкой.
const isPath = (a) =>
  !a.startsWith("--") && !/^-?\d+(\.\d+)?$/.test(a) && (/[\\/]/.test(a) || /\.(glb|gltf|fbx|obj|blend|png|jpg|json)$/i.test(a));
const args = rest.map((a) => (isPath(a) ? resolve(a) : a));
const r = spawnSync(blender, ["-b", "--factory-startup", "-noaudio", "-P", join(root, "tools/blender", SCRIPTS[cmd]), "--", ...args], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
const lines = out.split("\n").filter((l) => l.startsWith("ZEP_RESULT "));
if (!lines.length) {
  // Не дошли до результата — последние строки ошибки, без простыни лога.
  console.error(out.split("\n").filter((l) => /Error|Traceback|error:|raise|File "/.test(l)).slice(-12).join("\n") || out.slice(-1500));
  process.exit(1);
}
for (const l of lines) console.log(JSON.stringify(JSON.parse(l.slice(11)), null, 1));
