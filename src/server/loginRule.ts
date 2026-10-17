/**
 * Правило входа по нику (обычный вход, не стрим и не спектатор): временно пускаем только тех,
 * кто создал героя через `!play` в чате Twitch, и только из браузера, который подтвердил ник
 * кодом из чата. Чистая функция — без хранилища и комнат, поэтому тестируется отдельно.
 */
export type LoginVerdict = { ok: true } | { ok: false; reason: "closed" | "code" };

/** `rec` — запись героя (nick:<ник>) или undefined; `authed` — браузер подтвердил этот ник кодом. */
export function loginVerdict(rec: { viaPlay?: boolean } | undefined, authed: boolean): LoginVerdict {
  if (!rec || rec.viaPlay !== true) return { ok: false, reason: "closed" };
  return authed ? { ok: true } : { ok: false, reason: "code" };
}

export const LOGIN_CLOSED_TEXT =
  "Вход временно закрыт: играть можно только тем, кто создал героя через !play в чате Twitch канала.";
export const LOGIN_CODE_TEXT = "Подтверди вход: напиши код со страницы входа в чат Twitch от этого ника.";
