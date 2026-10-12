import { PlayerStore } from "./PlayerStore";
import { WorldStore } from "./WorldStore";
import { ChatLog } from "./ChatLog";
import { FeedbackStore } from "./FeedbackStore";

/** Один экземпляр на процесс — все комнаты пишут в один файл. */
export const store = new PlayerStore();

/** Ошибки и предложения игроков («Помощь в разработке» на странице инвентаря). */
export const feedback = new FeedbackStore();

/** Состояние мира (лут на земле) — тоже одно на процесс. */
export const world = new WorldStore();

/** Лог сообщений чата Twitch (3 дня) — см. ChatLog.ts. */
export const chatLog = new ChatLog();
