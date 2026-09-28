/**
 * Локальный тестовый стенд (npm run stage, STAGING=1): чата Twitch там нет,
 * поэтому сообщения «от зрителя» шлём сами — страница /stage.html или
 * GET /api/devchat?nick=…&text=… (только при STAGING=1, см. index.ts).
 * ZoneRoom регистрирует сюда свой onChat при создании.
 */
let handler: ((nick: string, text: string) => void) | null = null;

export const devChat = {
  set(fn: ((nick: string, text: string) => void) | null): void {
    handler = fn;
  },
  /** false — мира ещё нет (никто не заходил): комната создаётся первым входом. */
  send(nick: string, text: string): boolean {
    if (!handler) return false;
    handler(nick, text);
    return true;
  },
};
