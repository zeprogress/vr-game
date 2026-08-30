import { Game } from "./engine/Game";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

const game = new Game(canvas);
game.start();
void game.initXR();

// Отладка из консоли.
(window as unknown as { game: Game }).game = game;

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
