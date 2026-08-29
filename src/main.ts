import { Game } from "./engine/Game";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const hint = document.getElementById("hint") as HTMLDivElement;

const game = new Game(canvas);
game.start();

// Pointer lock: клик по подсказке — входим в управление.
hint.addEventListener("click", () => game.player.requestPointerLock());

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  hint.classList.toggle("hidden", locked);
});
