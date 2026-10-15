#!/usr/bin/env node
/**
 * Создаёт награду «Камера на себя» на канале через API — только так её потом можно вернуть
 * (возврат баллов работает лишь для наград, созданных этим приложением).
 *
 * Запуск: node scripts/create-camera-reward.mjs [стоимость_в_баллах]
 * Нужны TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET (как для сервера) и токен стримера с правом
 * channel:manage:redemptions — его берём из src/server/.data/twitch-redeem.json (или из
 * TWITCH_BROADCASTER_REFRESH). Новый refresh-токен сохраняется туда же, как делает сервер.
 *
 * В конце печатает id награды — его вписать в deploy/redeems.json ("id").
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tokenFile = resolve(root, "src/server/.data/twitch-redeem.json");
const TITLE = "Камера на себя";
const cost = Number(process.argv[2] ?? 300);
const clientId = process.env.TWITCH_CLIENT_ID ?? "";
const clientSecret = process.env.TWITCH_CLIENT_SECRET ?? "";

function storedRefresh() {
  if (existsSync(tokenFile)) {
    try {
      const v = JSON.parse(readFileSync(tokenFile, "utf8"));
      if (typeof v.refresh_token === "string" && v.refresh_token) return v.refresh_token;
    } catch {
      /* пусто — возьмём из env */
    }
  }
  return process.env.TWITCH_BROADCASTER_REFRESH ?? "";
}

function saveRefresh(token) {
  const tmp = `${tokenFile}.tmp`;
  writeFileSync(tmp, JSON.stringify({ refresh_token: token, saved: new Date().toISOString() }), { mode: 0o600 });
  renameSync(tmp, tokenFile);
}

if (!clientId || !clientSecret) {
  console.error("Нужны TWITCH_CLIENT_ID и TWITCH_CLIENT_SECRET в окружении.");
  process.exit(1);
}
const refresh = storedRefresh();
if (!refresh) {
  console.error("Нет refresh-токена стримера: пройди вход в Twitch (см. deploy/stream.env.example).");
  process.exit(1);
}

const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refresh }),
});
if (!tokenRes.ok) {
  console.error(`Не удалось обновить токен (${tokenRes.status}). Возможно, токен отозван — пройди вход заново.`);
  process.exit(1);
}
const tok = await tokenRes.json();
if (tok.refresh_token) saveRefresh(tok.refresh_token);
const auth = { "Client-Id": clientId, Authorization: `Bearer ${tok.access_token}` };

const me = await fetch("https://api.twitch.tv/helix/users", { headers: auth });
const meJson = await me.json();
const broadcasterId = meJson?.data?.[0]?.id;
if (!broadcasterId) {
  console.error("Не нашёл id стримера по токену.");
  process.exit(1);
}

const created = await fetch(`https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${broadcasterId}`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ title: TITLE, cost, is_enabled: true, prompt: "Камера эфира на твоём герое на минуту" }),
});
const body = await created.json().catch(() => ({}));
if (!created.ok) {
  const msg = body?.message ?? created.statusText;
  console.error(`Награда не создана (${created.status}): ${msg}`);
  if (created.status === 403) console.error(`Нужно право channel:manage:redemptions — пройди вход заново с этим правом.`);
  process.exit(1);
}
const id = body?.data?.[0]?.id;
console.log(`Создана награда «${TITLE}», стоимость ${cost}. id: ${id}`);
console.log(`Впиши в deploy/redeems.json: "id": "${id}"`);
