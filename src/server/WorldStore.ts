import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DropSave } from "./sim/ZoneSim";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/world.json");

/**
 * Настройки пульта, которые должны переживать перезапуск сервера (Ф10):
 * видимость метки камеры зрителя и её лучей, время суток с авто-ходом,
 * оверлей стрима. Раньше жили только в памяти комнаты (сброс на рестарт)
 * или вовсе только в localStorage одного браузера (оверлей на дашборде) —
 * попросили сделать общими для всех и переживающими рестарт.
 */
export interface PultSettings {
  specVisible: boolean;
  specRaysVisible: boolean;
  hour: number;
  dayAuto: boolean;
  overlay: Record<string, unknown>;
}

interface WorldRecord {
  drops: DropSave[];
  /** Общая подгонка положений/света — админ задаёт её всем из панели. */
  loadout?: Record<string, unknown>;
  pult?: Partial<PultSettings>;
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
  private pult: Partial<PultSettings> = {};

  constructor() {
    try {
      if (!existsSync(FILE)) return;
      const raw = JSON.parse(readFileSync(FILE, "utf8")) as WorldRecord;
      if (Array.isArray(raw?.drops)) this.drops = raw.drops;
      if (raw?.loadout && typeof raw.loadout === "object" && !Array.isArray(raw.loadout)) {
        this.loadout = raw.loadout as Record<string, unknown>;
      }
      if (raw?.pult && typeof raw.pult === "object" && !Array.isArray(raw.pult)) {
        this.pult = raw.pult as Partial<PultSettings>;
      }
      console.log(
        `[world] восстановлено: лут ${this.drops.length}, общая подгонка ${Object.keys(this.loadout).length ? "есть" : "нет"}, пульт ${Object.keys(this.pult).length ? "есть" : "нет"}`,
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

  /** Настройки пульта (частично — что уже когда-то сохраняли). */
  loadPult(): Partial<PultSettings> {
    return this.pult;
  }

  /** Слить патч в настройки пульта и записать файл (merge, не замена). */
  savePult(patch: Partial<PultSettings>): void {
    this.pult = { ...this.pult, ...patch };
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
      const rec: WorldRecord = {
        drops: this.drops,
        loadout: this.loadout,
        pult: this.pult,
        savedAt: Date.now(),
      };
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify(rec, null, 2));
      renameSync(tmp, FILE);
    } catch (e) {
      console.warn("[world] world.json не записан:", (e as Error).message);
    }
  }
}
