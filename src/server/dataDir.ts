import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Каталог данных сервера: сейвы героев, мир, чат, инвентарные сессии, логи
 * обменов и награды Twitch. По умолчанию — `src/server/.data`.
 *
 * `ZEP_DATA_DIR` переносит ВСЁ разом: удобно держать ветку реворка со своими
 * сейвами, не трогая основную. `PLAYERS_FILE` остаётся точечным override
 * только для `players.json`.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = process.env.ZEP_DATA_DIR
  ? resolve(process.cwd(), process.env.ZEP_DATA_DIR)
  : resolve(HERE, ".data");

export function dataFile(name: string): string {
  return resolve(DATA_DIR, name);
}
