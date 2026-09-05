import { Game } from "./engine/Game";
import { NetClient } from "./net/NetClient";
import { runLogin } from "./ui/Login";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

// ?gear=1 — панель живой настройки хвата оружия ботов (работает в любом режиме).
if (params.get("gear") === "1") {
  void import("./ui/GearTuner").then(({ mountGearTuner }) => mountGearTuner());
}

// ?groundglow=1 — панель живой настройки пятна светлячков на земле.
if (params.get("groundglow") === "1") {
  void import("./ui/GroundGlowTuner").then(({ mountGroundGlowTuner }) => mountGroundGlowTuner());
}

if (params.has("dash")) {
  bootDashboard();
} else if (params.get("spectator")) {
  bootSpectator(params.get("spectator") as string);
} else {
  bootGame();
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
    const spec = new Spectator(canvas, quality, debug, {
      rs: num("rs"),
      fpsCap,
      rw: num("rw"),
      rh: num("rh"),
      raw: params.get("rawcam") === "1",
      overlay: params.get("overlay") !== "0",
      reloadSec: (() => {
        const v = Number(params.get("reload"));
        return params.has("reload") && Number.isFinite(v) ? v : undefined;
      })(),
    });
    const net = new NetClient();
    (window as unknown as { spec: unknown; net: NetClient }).spec = spec;
    (window as unknown as { spec: unknown; net: NetClient }).net = net;
    const ok = await spec.run(net, specKey);
    if (!ok) console.error("[spectator] не удалось подключиться к серверу");
  })();
}

function bootGame(): void {
  const game = new Game(canvas);
  game.start(); // сцена рендерится за экраном входа
  void game.initXR();

  const net = new NetClient();

  // Гостевой токен — по нему сервер узнаёт персонажа между сессиями.
  let guestToken = localStorage.getItem("guestToken");
  if (!guestToken) {
    guestToken = crypto.randomUUID();
    localStorage.setItem("guestToken", guestToken);
  }

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
  ).then(({ nick, online, vr }) => {
    game.setNick(nick);
    if (online) game.attachNet(net);

    // Плашки «кликни, чтобы войти» больше нет — сам канвас ловит клик и
    // забирает захват мыши. На телефоне/VR указателя нет, слушатель не нужен.
    if (!game.isTouch && !vr) {
      canvas.addEventListener("click", () => game.requestPointerLock());
    }
  });
}
