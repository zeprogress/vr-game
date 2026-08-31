import { PlayerStore } from "./PlayerStore";
import { WorldStore } from "./WorldStore";

/** Один экземпляр на процесс — все комнаты пишут в один файл. */
export const store = new PlayerStore();

/** Состояние мира (лут на земле) — тоже одно на процесс. */
export const world = new WorldStore();
