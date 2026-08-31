import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DropSave } from "./sim/ZoneSim";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/world.json");

interface WorldRecord {
  drops: DropSave[];
  savedAt: number;
}

/**
 * Состояние мира, которое должно пережить перезапуск сервера: пока это только
 * лут на земле. Мобы, куклы и время — считаются заново, их сохранять незачем.
 */
export class WorldStore {
  private drops: DropSave[] = [];

  constructor() {
    try {
      if (!existsSync(FILE)) return;
      const raw = JSON.parse(readFileSync(FILE, "utf8")) as WorldRecord;
      if (Array.isArray(raw?.drops)) this.drops = raw.drops;
      console.log(`[world] лут на земле восстановлен: ${this.drops.length}`);
    } catch (e) {
      console.warn("[world] world.json не прочитан:", (e as Error).message);
    }
  }

  /**
   * Что лежало в мире при прошлой остановке. Не очищаем: комната может
   * создаться и тут же закрыться (бронь матчмейкинга), и тогда следующая
   * получила бы пустой мир, а её сохранение затёрло бы файл.
   */
  loadDrops(): DropSave[] {
    return this.drops;
  }

  /** Записать на диск. Атомарно (tmp + rename). */
  save(drops: DropSave[]): void {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      const rec: WorldRecord = { drops, savedAt: Date.now() };
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(rec, null, 2));
      renameSync(tmp, FILE);
    } catch (e) {
      console.warn("[world] world.json не записан:", (e as Error).message);
    }
  }
}
