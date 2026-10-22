import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

test("Лавовый монстр: все звуки из карты Sfx.LAVA_SFX собраны в public/sfx (tools/sfx/lava_sfx.py)", () => {
  const src = readFileSync("src/client/audio/Sfx.ts", "utf8");
  const table = src.slice(src.indexOf("LAVA_SFX"), src.indexOf("} as const;", src.indexOf("LAVA_SFX")));
  const urls = [...table.matchAll(/"(\/sfx\/lava-[a-z]+\.(?:wav|mp3))"/g)].map((m) => m[1]);
  assert.equal(urls.length, 8, "8 звуков");
  for (const u of urls) assert.ok(existsSync("public" + u), `нет файла public${u}`);
});
