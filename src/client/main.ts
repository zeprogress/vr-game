import { createWebGpuEngine } from "./engine/webgpu";
import { Game } from "./engine/Game";
import { NetClient } from "./net/NetClient";
import { runLogin } from "./ui/Login";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

/**
 * Ошибка запуска — на экран, а не молча в консоль: на телефоне консоли не видно, и раньше
 * падение до экрана входа выглядело как «игра сама стартует героем 1 ур. без входа».
 */
let booted = false;
function showBootError(what: unknown): void {
  if (booted) return;
  const msg = what instanceof Error ? `${what.name}: ${what.message}` : String(what);
  // Экран входа на месте — запуск прошёл (до входа бывают безобидные отказы, например автозвук).
  // Проверяем чуть позже: вход рисуется после сцены.
  setTimeout(() => {
    if (!booted && !document.getElementById("login") && !params.get("spectator") && !params.has("dash")) bootErrorBox(msg);
  }, 1500);
}
function bootErrorBox(msg: string): void {
  let box = document.getElementById("boot-error");
  if (!box) {
    box = document.createElement("div");
    box.id = "boot-error";
    box.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:20000;padding:12px 14px;border-radius:10px;" +
      "background:#3a1418;border:1px solid #c0392b;color:#ffd9d9;font:14px/1.4 system-ui;white-space:pre-wrap";
    document.body.appendChild(box);
  }
  box.textContent = `Не удалось запустить игру — пришли скриншот разработчику:\n${msg}`;
}
window.addEventListener("error", (e) => showBootError(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => showBootError(e.reason));

// Локальный тестовый стенд (npm run stage) — плашка, чтобы не спутать с продом.
if (import.meta.env.DEV) {
  const b = document.createElement("div");
  b.textContent = "ТЕСТОВЫЙ СТЕНД";
  b.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:99;padding:3px 8px;border-radius:4px;" +
    "background:#c0392bcc;color:#fff;font:700 11px system-ui;pointer-events:none";
  document.body.appendChild(b);
}

// ?gear=1 — панель живой настройки хвата оружия ботов (работает в любом режиме).
if (params.get("gear") === "1") {
  void import("./ui/GearTuner").then(({ mountGearTuner }) => mountGearTuner());
}

// ?groundglow=1 — панель живой настройки пятна светлячков на земле.
if (params.get("groundglow") === "1") {
  void import("./ui/GroundGlowTuner").then(({ mountGroundGlowTuner }) => mountGroundGlowTuner());
}

// ?grasstune=1 — панель живой настройки света/вида травы (ближней и дальней).
if (params.get("grasstune") === "1") {
  void import("./ui/GrassTuner").then(({ mountGrassTuner }) => mountGrassTuner());
}

// ?fog=1 — панель живой настройки ночного тумана.
if (params.get("fog") === "1") {
  void import("./ui/FogTuner").then(({ mountFogTuner }) => mountFogTuner());
}

// ?moblight=1 — панель живой настройки освещения полевых мобов (не башня).
if (params.get("moblight") === "1") {
  void import("./ui/MobLightTuner").then(({ mountMobLightTuner }) => mountMobLightTuner());
}

// ?tpcam=1 — панель живой настройки камеры от третьего лица (смартфон).
if (params.get("tpcam") === "1") {
  void import("./ui/TpCamTuner").then(({ mountTpCamTuner }) => mountTpCamTuner());
}

// ?towerlight=1 — панель живой настройки освещения «Охотничьей башни»
// (нужен спектатор с активной ареной — см. ?towertest=1 у bootSpectator).
if (params.get("towerlight") === "1") {
  void import("./ui/TowerLightTuner").then(({ mountTowerLightTuner }) => mountTowerLightTuner());
}

if (params.has("dash")) {
  bootDashboard();
} else if (params.get("spectator")) {
  bootSpectator(params.get("spectator") as string);
} else {
  void bootGame();
}

/** Пульт стрима (этап 17 Ф5): /?dash=КЛЮЧ (или ?dash=1 после первого раза). */
function bootDashboard(): void {
  void import("./dash/Dashboard").then(({ Dashboard }) => {
    (window as unknown as { dash: unknown }).dash = new Dashboard(params.get("dash"));
  });
}

/** Невидимый спектатор для стрима (этап 17): /?spectator=КЛЮЧ. */
function bootSpectator(specKey: string): void {
  const q = params.get("q");
  const quality = q === "potato" || q === "low" || q === "med" || q === "high" ? q : "high";
  const debug = params.get("debug") === "1";
  const num = (k: string): number | undefined => {
    const v = Number(params.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  // fpscap=0 — явно снять кэп пресета (иначе через `num` было бы undefined → пресет).
  const fpsCap = params.has("fpscap")
    ? Math.max(0, Number(params.get("fpscap")) || 0)
    : undefined;
  void (async () => {
    const { Spectator } = await import("./spectator/Spectator");
    const gpu = await createWebGpuEngine(canvas, { antialias: true, stencil: false, premultipliedAlpha: false });
    const spec = new Spectator(canvas, quality, debug, {
      rs: num("rs"),
      fpsCap,
      rw: num("rw"),
      rh: num("rh"),
      raw: params.get("rawcam") === "1",
      overlay: params.get("overlay") === "ext" ? "ext" : params.get("overlay") !== "0",
      obs: params.get("obs") === "1",
      perf: params.get("perf") === "1",
      freecam: params.get("freecam") === "1",
      reloadSec: (() => {
        const v = Number(params.get("reload"));
        return params.has("reload") && Number.isFinite(v) ? v : undefined;
      })(),
    }, gpu ?? undefined);
    const net = new NetClient();
    (window as unknown as { spec: unknown; net: NetClient }).spec = spec;
    (window as unknown as { spec: unknown; net: NetClient }).net = net;
    const ok = await spec.run(net, specKey);
    if (!ok) console.error("[spectator] не удалось подключиться к серверу");
  })();
}

/** Гостевой токен — по нему сервер узнаёт безымянного персонажа между сессиями. Хранилище может быть запрещено (Safari) — тогда на сессию. */
function guestTokenOf(): string {
  let t: string | null = null;
  try {
    t = localStorage.getItem("guestToken");
  } catch {
    /* хранилище запрещено */
  }
  if (t) return t;
  // randomUUID нет в старых iOS — запасной вариант.
  t = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem("guestToken", t);
  } catch {
    /* не сохранится — ничего */
  }
  return t;
}

async function bootGame(): Promise<void> {
  // Качество графики выбора больше нет — всегда максимум на всех платформах.
  // В VR сверху ложится лёгкий профиль (см. Game.applyVrQuality).
  const gpu = await createWebGpuEngine(canvas, { antialias: true, stencil: true });
  const game = new Game(canvas, gpu ?? undefined);
  game.start(); // сцена рендерится за экраном входа
  void game.initXR().catch((e) => console.warn("[xr] init", e));

  const net = new NetClient();
  const guestToken = guestTokenOf();

  // Отладка из консоли.
  (window as unknown as { game: Game; net: NetClient }).game = game;
  (window as unknown as { game: Game; net: NetClient }).net = net;

  // ?stream — вход по нику Twitch: забрать своего бота (Ф10).
  const streamMode = new URLSearchParams(location.search).has("stream");

  void runLogin(
    net,
    guestToken,
    {
      isVrAvailable: () => game.isVrAvailable(),
      whenXrReady: () => game.xrReady,
      enterVR: () => game.enterVR(),
      requestPointerLock: () => game.requestPointerLock(),
    },
    streamMode,
  ).then(({ nick, vr }) => {
    booted = true;
    game.setNick(nick);
    game.attachNet(net); // игра только онлайн
    game.enterWorld(); // теперь можно завести фоновую музыку

    // Плашки «кликни, чтобы войти» больше нет — сам канвас ловит клик и
    // забирает захват мыши. На телефоне/VR указателя нет, слушатель не нужен.
    if (!game.isTouch && !vr) {
      canvas.addEventListener("click", () => game.requestPointerLock());
    }
  });
}
