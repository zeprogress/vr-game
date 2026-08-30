import { PlayerStore } from "./PlayerStore";

/** Один экземпляр на процесс — все комнаты пишут в один файл. */
export const store = new PlayerStore();
