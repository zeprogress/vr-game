import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DropSave } from "./sim/ZoneSim";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/world.json");

interface WorldRecord {
  drops: DropSave[];
  /** Общая подгонка положений/света — админ задаёт её всем из панели. */
  loadout?: Record<string, unknown>;
  savedAt: number;
}

/**
 * Состояние мира, которое должно пережить перезапуск сервера: лут на земле
 * и общая подгонка снаряжения (её админ правит в панели, применяется всем).
 * Мобы, куклы и время — считаются заново, их сохранять незачем.
 */
export class WorldStore {
  private drops: DropSave[] = [];
  private loadout: Record<string, unknown> = {};

  constructor() {
    try {
      if (!existsSync(FILE)) return;
      const raw = JSON.parse(readFileSync(FILE, "utf8")) as WorldRecord;
      if (Array.isArray(raw?.drops)) this.drops = raw.drops;
      if (raw?.loadout && typeof raw.loadout === "object" && !Array.isArray(raw.loadout)) {
        this.loadout = raw.loadout as Record<string, unknown>;
      }
      console.log(
        `[world] восстановлено: лут ${this.drops.length}, общая подгонка ${Object.keys(this.loadout).length ? "есть" : "нет"}`,
      );
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

  /** Общая подгонка снаряжения (частичный Loadout, JSON как есть). */
  loadLoadout(): Record<string, unknown> {
    return this.loadout;
  }

  /** Сохранить общую подгонку и записать файл. */
  saveLoadout(loadout: Record<string, unknown>): void {
    this.loadout = loadout;
    this.writeFile();
  }

  /** Записать на диск. Атомарно (tmp + rename). */
  save(drops: DropSave[]): void {
    // Держим в памяти актуальное: следующая комната в этом же процессе
    // берёт лут через loadDrops(). Без этого очистка мира (или пустой
    // список при выходе последнего игрока) не переживала пересоздание
    // комнаты — старый лут возвращался.
    this.drops = drops;
    this.writeFile();
  }

  private writeFile(): void {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      const rec: WorldRecord = { drops: this.drops, loadout: this.loadout, savedAt: Date.now() };
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(rec, null, 2));
      renameSync(tmp, FILE);
    } catch (e) {
      console.warn("[world] world.json не записан:", (e as Error).message);
    }
  }
}
