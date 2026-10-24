// Запекание процедурных текстур земли в public/textures: тот же код, что был на старте, но один раз.
//   трава поляны  — Terrain.grassPixels (1024²) → grass_diffuse.webp, grass_bump.webp
//   земля лагеря  — hub/HubBlockout.campGroundPixels (512²) → camp_ground_diffuse.webp, camp_ground_bump.webp
// Нужен запущенный стенд (npm run stage): страница стенда импортирует модули, Chrome управляется через CDP.
//   node tools/grass/bake-grass.cjs
const { spawn, execFileSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const WebSocket = require("ws");

const ROOT = path.resolve(__dirname, "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9335;
const PAGE = "https://localhost:5173/stage.html";
const getJSON = (u) => new Promise((ok, no) => http.get(u, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => { try { ok(JSON.parse(d)); } catch (e) { no(e); } }); }).on("error", no));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Задания: модуль, функция, размер, имена файлов (диффуз, нормали).
const JOBS = [
  { mod: "/src/client/world/Terrain.ts", fn: "grassPixels", size: 1024, out: ["grass_diffuse", "grass_bump"] },
  { mod: "/src/client/world/hub/HubBlockout.ts", fn: "campGroundPixels", size: 512, out: ["camp_ground_diffuse", "camp_ground_bump"] },
];

const exprFor = (j) => `(async () => {
  const m = await import('${j.mod}');
  const { diffuse, bump } = m.${j.fn}();
  const enc = (arr) => {
    const c = document.createElement('canvas'); c.width = ${j.size}; c.height = ${j.size};
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(arr), ${j.size}, ${j.size}), 0, 0);
    return c.toDataURL('image/png');
  };
  return { d: enc(diffuse), b: enc(bump) };
})()`;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vrbake-"));
  const chrome = spawn(CHROME, ["--headless=new", "--ignore-certificate-errors", `--remote-debugging-port=${PORT}`, `--user-data-dir=${dir}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  try {
    let targets;
    for (let i = 0; i < 50; i++) { try { targets = await getJSON(`http://127.0.0.1:${PORT}/json`); if (targets.find((t) => t.type === "page")) break; } catch {} await sleep(200); }
    const page = targets.find((t) => t.type === "page");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r) => ws.on("open", r));
    let id = 0; const pending = new Map();
    ws.on("message", (m) => { const j = JSON.parse(m); if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); } });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    await send("Page.enable"); await send("Runtime.enable");
    await send("Page.navigate", { url: PAGE });
    await sleep(4000);
    const outDir = path.join(ROOT, "public/textures");
    fs.mkdirSync(outDir, { recursive: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vrbakepng-"));
    for (const j of JOBS) {
      const res = await send("Runtime.evaluate", { expression: exprFor(j), awaitPromise: true, returnByValue: true, timeout: 120000 });
      if (res.result?.exceptionDetails || !res.result?.result?.value) throw new Error(`${j.fn}: ${JSON.stringify(res.result?.exceptionDetails ?? res)}`);
      const { d, b } = res.result.result.value;
      const [dn, bn] = j.out;
      fs.writeFileSync(path.join(tmp, `${dn}.png`), Buffer.from(d.split(",")[1], "base64"));
      fs.writeFileSync(path.join(tmp, `${bn}.png`), Buffer.from(b.split(",")[1], "base64"));
      // PNG из браузера → WebP (качество 92): меньше загрузка, нормали без заметной потери.
      execFileSync("python3", ["-c", "import sys;from PIL import Image;Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2],'WEBP',quality=92,method=6);Image.open(sys.argv[3]).convert('RGB').save(sys.argv[4],'WEBP',quality=92,method=6)", path.join(tmp, `${dn}.png`), path.join(outDir, `${dn}.webp`), path.join(tmp, `${bn}.png`), path.join(outDir, `${bn}.webp`)]);
      console.log(`записано: public/textures/${dn}.webp, ${bn}.webp`);
    }
    ws.close();
  } finally {
    chrome.kill();
  }
})().catch((e) => { console.error("ошибка:", e.message ?? e); process.exit(1); });
