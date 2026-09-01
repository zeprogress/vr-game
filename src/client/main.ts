import { Game } from "./engine/Game";
import { NetClient } from "./net/NetClient";
import { runLogin } from "./ui/Login";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

// --- Режим невидимого спектатора для стрима (этап 17): /?spectator=КЛЮЧ ---
const params = new URLSearchParams(location.search);
const specKey = params.get("spectator");
if (specKey) {
  hint.classList.add("hidden");
  const q = params.get("q");
  const quality =
    q === "potato" || q === "low" || q === "med" || q === "high" ? q : "high";
  const debug = params.get("debug") === "1";
  const num = (k: string): number | undefined => {
    const v = Number(params.get(k));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  void (async () => {
    const { Spectator } = await import("./spectator/Spectator");
    const spec = new Spectator(canvas, quality, debug, {
      rs: num("rs"),
      fpsCap: num("fpscap"),
      rw: num("rw"),
      rh: num("rh"),
    });
    const net = new NetClient();
    (window as unknown as { spec: unknown; net: NetClient }).spec = spec;
    (window as unknown as { spec: unknown; net: NetClient }).net = net;
    const ok = await spec.run(net, specKey);
    if (!ok) console.error("[spectator] не удалось подключиться к серверу");
  })();
} else {
  bootGame();
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

  void runLogin(net, guestToken, {
    isVrAvailable: () => game.isVrAvailable(),
    whenXrReady: () => game.xrReady,
    enterVR: () => game.enterVR(),
  }).then(({ nick, online, vr }) => {
    game.setNick(nick);
    if (online) game.attachNet(net);

    if (game.isTouch || vr) {
      hint.classList.add("hidden"); // на телефоне и в VR подсказка клавиш не нужна
    } else {
      hint.classList.remove("hidden");
      hint.addEventListener("click", () => game.requestPointerLock());
      document.addEventListener("pointerlockchange", () => {
        hint.classList.toggle("hidden", document.pointerLockElement === canvas);
      });
    }
  });
}
