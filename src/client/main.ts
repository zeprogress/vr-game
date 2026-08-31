import { Game } from "./engine/Game";
import { NetClient } from "./net/NetClient";
import { runLogin } from "./ui/Login";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

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
