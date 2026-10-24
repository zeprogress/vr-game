// Запекание текстур травы в public/textures: тот же код, что был на старте (Terrain.grassPixels), но один раз.
// Нужен запущенный стенд (npm run stage) — страница стенда импортирует Terrain.ts; Chrome управляется через CDP.
//   node tools/grass/bake-grass.cjs
const { spawn } = require("child_process");
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

const EXPR = `(async () => {
  const m = await import('/src/client/world/Terrain.ts');
  const { diffuse, bump } = m.grassPixels();
  const enc = (arr) => {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(arr), 1024, 1024), 0, 0);
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
    const res = await send("Runtime.evaluate", { expression: EXPR, awaitPromise: true, returnByValue: true, timeout: 120000 });
    if (res.result?.exceptionDetails || !res.result?.result?.value) throw new Error(JSON.stringify(res.result?.exceptionDetails ?? res));
    const { d, b } = res.result.result.value;
    const outDir = path.join(ROOT, "public/textures");
    fs.mkdirSync(outDir, { recursive: true });
    // PNG из браузера → WebP (качество 92, как и остальные текстуры): меньше загрузка, без потери на нормалях.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vrbakepng-"));
    fs.writeFileSync(path.join(tmp, "d.png"), Buffer.from(d.split(",")[1], "base64"));
    fs.writeFileSync(path.join(tmp, "b.png"), Buffer.from(b.split(",")[1], "base64"));
    const { execFileSync } = require("child_process");
    execFileSync("python3", ["-c", "from PIL import Image;import sys;Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2],'WEBP',quality=92,method=6);Image.open(sys.argv[3]).convert('RGB').save(sys.argv[4],'WEBP',quality=92,method=6)", path.join(tmp, "d.png"), path.join(outDir, "grass_diffuse.webp"), path.join(tmp, "b.png"), path.join(outDir, "grass_bump.webp")]);
    console.log("записано: public/textures/grass_diffuse.webp, grass_bump.webp");
    ws.close();
  } finally {
    chrome.kill();
  }
})().catch((e) => { console.error("ошибка:", e.message ?? e); process.exit(1); });
