import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("Владыка Бездны: все звуки из карты Sfx.LORD_SFX собраны в public/sfx (tools/sfx/dragon_sfx.py)", () => {
  const src = readFileSync("src/client/audio/Sfx.ts", "utf8");
  const table = src.slice(src.indexOf("LORD_SFX"), src.indexOf("};", src.indexOf("LORD_SFX")));
  const urls = [...table.matchAll(/"(\/sfx\/lord-[a-z-]+\.(?:wav|mp3))"/g)].map((m) => m[1]);
  assert.equal(urls.length, 17, "17 звуков");
  for (const u of urls) assert.ok(existsSync("public" + u), `нет файла public${u}`);
});

test("Владыка Бездны: каждое событие сервера (DragonAct) рисует клиент (ui/DragonAct.ts)", () => {
  const server = readFileSync("src/server/rooms/dragonFight.ts", "utf8");
  const client = readFileSync("src/client/ui/DragonAct.ts", "utf8");
  const kinds = [...server.matchAll(/\| "(dragon[A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 12);
  for (const k of kinds) assert.ok(client.includes(`case "${k}"`), `клиент не рисует ${k}`);
});
