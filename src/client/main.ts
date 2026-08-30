import { Game } from "./engine/Game";
import { NetClient } from "./net/NetClient";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

const game = new Game(canvas);
game.start();
void game.initXR();

// Этап 4b: временно подключаемся сразу. На 4c это переедет за экран входа.
const net = new NetClient();
void net.connect("тест").then((ok) => console.log(ok ? "[net] онлайн" : "[net] офлайн"));

// Отладка из консоли.
(window as unknown as { game: Game; net: NetClient }).game = game;
(window as unknown as { game: Game; net: NetClient }).net = net;

if (game.isTouch) {
  // На телефоне подсказка про мышь не нужна — управление на экране.
  hint.classList.add("hidden");
} else {
  hint.addEventListener("click", () => game.requestPointerLock());
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    hint.classList.toggle("hidden", locked);
  });
}
