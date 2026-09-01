import { defineConfig, type Plugin } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// VR=1 npm run dev  ->  https на всю локальную сеть (нужно для WebXR на Quest).
// Иначе обычный http (быстрее, годится для десктопа и телефона в LAN).
const vr = process.env.VR === "1";
const root = dirname(fileURLToPath(import.meta.url));

/**
 * Дев-эндпоинт: панель настройки экипировки шлёт сюда POST /__loadout с
 * текущими значениями, а плагин переписывает блок LOADOUT_DEFAULTS прямо в
 * src/client/config/loadout.ts. Так «Сохранить настройки» в игре кладёт числа в
 * файл (в git, общий для всех адресов и устройств), а не в localStorage.
 * Работает только у дев-сервера — в собранную игру не попадает.
 */
function loadoutWriter(): Plugin {
  const file = resolve(root, "src/client/config/loadout.ts");

  // Узнаваемые углы пишем выражением, чтобы файл оставался читаемым.
  const nice: [string, number][] = [
    ["Math.PI", Math.PI],
    ["-Math.PI", -Math.PI],
    ["Math.PI / 2", Math.PI / 2],
    ["-Math.PI / 2", -Math.PI / 2],
    ["Math.PI / 4", Math.PI / 4],
    ["-Math.PI / 4", -Math.PI / 4],
    ["Math.PI * 2", Math.PI * 2],
  ];
  const num = (n: number) => {
    for (const [expr, val] of nice) if (Math.abs(n - val) < 1e-4) return expr;
    return String(Number(n.toFixed(4)));
  };
  const arr = (a: number[]) => `[${a.map(num).join(", ")}]`;
  const place = (p: { pos: number[]; rot: number[]; scale: number }) =>
    `{ pos: ${arr(p.pos)}, rot: ${arr(p.rot)}, scale: ${num(p.scale)} }`;
  const hand = (h: { rot: number[]; scale: number; curl: number }) =>
    `{ rot: ${arr(h.rot)}, scale: ${num(h.scale)}, curl: ${num(h.curl)} }`;

  const render = (l: {
    hands: Record<string, { rot: number[]; scale: number; curl: number }>;
    items: Record<string, Record<string, { pos: number[]; rot: number[]; scale: number }>>;
    buttons: Record<string, number>;
    world: { hour: number; auto: number };
    belt: { pos: number[] };
    hud: { hpPos: number[] };
    gfx: { smooth: number };
    voice: { mic: number; spatial: number };
  }) => {
    const items = ["sword", "bow", "shield", "potion"]
      .map(
        (k) =>
          `    ${k}: {\n` +
          `      flat: ${place(l.items[k].flat)},\n` +
          `      vrLeft: ${place(l.items[k].vrLeft)},\n` +
          `      vrRight: ${place(l.items[k].vrRight)},\n` +
          `    },`,
      )
      .join("\n");
    return (
      `export const LOADOUT_DEFAULTS: Loadout = {\n` +
      `  hands: {\n` +
      `    left: ${hand(l.hands.left)},\n` +
      `    right: ${hand(l.hands.right)},\n` +
      `  },\n` +
      `  items: {\n${items}\n  },\n` +
      `  buttons: {\n` +
      `    panelToggle: ${l.buttons.panelToggle}, // Y на левом\n` +
      `    panelNext: ${l.buttons.panelNext}, // X на левом\n` +
      `    panelSpend: ${l.buttons.panelSpend}, // B на правом\n` +
      `    jump: ${l.buttons.jump}, // A на правом\n` +
      `  },\n` +
      `  world: {\n` +
      `    hour: ${num(l.world?.hour ?? 17.6)}, // час суток: свет, небо и место солнца\n` +
      `    auto: ${l.world?.auto ? 1 : 0}, // время идёт само\n` +
      `  },\n` +
      `  belt: {\n` +
      `    pos: ${arr(l.belt?.pos ?? [0.19, 0, 0.06])},\n` +
      `  },\n` +
      `  hud: {\n` +
      `    hpPos: ${arr(l.hud?.hpPos ?? [-0.24, 0.46, 0.92])},\n` +
      `  },\n` +
      `  gfx: {\n` +
      `    smooth: ${l.gfx?.smooth ? 1 : 0}, // сглаживание краёв\n` +
      `  },\n` +
      `  voice: {\n` +
      `    mic: ${l.voice?.mic ? 1 : 0}, // микрофон работает\n` +
      `    spatial: ${l.voice?.spatial ? 1 : 0}, // голос идёт от места игрока\n` +
      `  },\n` +
      `};`
    );
  };

  return {
    name: "loadout-writer",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "POST" || (req.url ?? "").split("?")[0] !== "/__loadout") {
          return next();
        }
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const reply = (code: number, obj: unknown) => {
            res.statusCode = code;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(obj));
          };
          try {
            const data = JSON.parse(body);
            if (!data?.hands?.left || !data?.items?.sword || !data?.buttons) {
              return reply(400, { ok: false, error: "неполные данные" });
            }
            let src = readFileSync(file, "utf8");
            const re = /export const LOADOUT_DEFAULTS: Loadout = \{[\s\S]*?\n\};/;
            if (!re.test(src)) return reply(500, { ok: false, error: "блок LOADOUT_DEFAULTS не найден" });
            src = src.replace(re, render(data));
            writeFileSync(file, src);
            server.config.logger.info("[loadout] настройки записаны в src/client/config/loadout.ts");
            reply(200, { ok: true });
          } catch (e) {
            reply(400, { ok: false, error: String(e) });
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [loadoutWriter(), ...(vr ? [basicSsl()] : [])],
  server: {
    host: true, // доступ по локальной сети
    port: 5173,
    // Если порт занят, Vite молча уезжает на 5174 — и туннель начинает
    // смотреть в пустоту. Лучше упасть сразу и понятно.
    strictPort: true,
    // Vite 5.4 отвергает запросы с чужим Host. Публичный адрес туннеля
    // (*.trycloudflare.com) как раз чужой, поэтому проверку снимаем:
    // это дев-сервер, который поднимают осознанно и ненадолго.
    allowedHosts: true,
    // Игровой сервер (Colyseus, :2567) ходит через тот же origin, чтобы
    // работал wss:// на HTTPS-деве и в шлеме. /matchmake — HTTP матчмейкинг;
    // /<processId>/<roomId> — WebSocket комнаты (два коротких сегмента,
    // HMR Vite сидит на "/" и под шаблон не попадает).
    proxy: {
      "/matchmake": { target: "http://localhost:2567", changeOrigin: true },
      "^/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+(\\?.*)?$": {
        target: "ws://localhost:2567",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2020",
    outDir: "dist",
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Babylon — отдельным вендор-чанком: меньше пик памяти при сборке
        // (важно на 1 ГБ VPS) и кэшируется отдельно от нашего кода.
        manualChunks(id) {
          if (id.includes("node_modules/@babylonjs/core")) return "babylon";
        },
      },
    },
  },
});
