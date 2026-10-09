import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PLAYER, RESPAWN } from "#shared/constants";
import type { HeldWeapons, SaveMsg, StowedWeapon } from "#shared/net/messages";
import { blankProgress, maxHpFor, resetAttrs, type Progress } from "#shared/progression";
import { emptyBag, type Slot, type WeaponInstance } from "#shared/items";
import type { QuestSave, StorySave, WeeklySave } from "#shared/quests";
import type { RingInst } from "#shared/jewels";

/** Позиция + прогресс + здоровье. С этапа 7 всё это считает сервер. */
import type { TradeOffer } from "./trade";

export interface PlayerRecord extends SaveMsg, Progress {
  token: string;
  nick: string;
  hp: number;
  /** Что игрок честно поднял: ключи вида "sword:gold". */
  owned: string[];
  /** Оружие, убранное за спину при прошлом выходе. */
  stowed: StowedWeapon[];
  /** Что было в руках при прошлом выходе. */
  held: HeldWeapons;
  /** Панельные настройки (положения рук/предметов, HUD, графика, голос). */
  overrides: Record<string, unknown>;
  bag: Slot[];
  /** Внешность бота зрителя (Ф10) — держится за ником между сессиями. */
  skin?: number;
  /** Добитых мобов за всё время — для таблицы лидеров (Ф10). */
  kills?: number;
  /** Самый высокий этаж «Охотничьей башни», до которого дошёл герой. */
  bestTowerFloor?: number;
  /** Лучшее время ПОЛНОГО прохождения башни, с (меньше — выше в рейтинге). */
  bestTowerTimeSec?: number;
  /** Лагерь, выбранный зрителем командой !camp (ключ ELITE_MOBS); нет — автовыбор. */
  campPref?: string;
  /** Сколько раз уже сбрасывал атрибуты — от этого цена следующего (respecCostFor). */
  respecCount?: number;
  /** Когда герой впервые прошёл башню целиком (мс с эпохи) — порядок «каким по счёту». */
  towerClearedAt?: number;
  /** Ресурс с мини-боссов башни (название/применение — TBD). */
  towerShards?: number;
  /** Продолжать ли ботом после выхода (панель C). По умолчанию — нет. */
  leaveBot?: boolean;
  /** ВРЕМЕННО (KEEP_BOTS_FOREVER): бот сейчас в мире — восстановить после рестарта. */
  botActive?: boolean;
  /** Когда хозяин-ник последний раз писал в чат (мс с эпохи): таймер ухода бота переживает рестарты сервера. */
  lastChatAt?: number;
  /** Собранное оружие-инстансы (каждое со своими роллами аффиксов) — весь склад персонажа. */
  weapons?: WeaponInstance[];
  /** Какой инстанс закреплён в какой руке ("!equip") — null/отсутствует — автовыбор лучшего. */
  equippedWeaponId?: { left: string | null; right: string | null };
  /** Секрет для веб-страницы инвентаря ("!inv") — отдельный от guestToken/nick:, только на чтение своего склада. */
  viewToken?: string;
  /** Доска заданий дня (квесты) — прогресс и что уже сдано. */
  quests?: QuestSave;
  /** Сюжет Охотника и недельный контракт. */
  story?: StorySave;
  weekly?: WeeklySave;
  /** Полученные титулы и выбранный для показа под ником. */
  titles?: string[];
  title?: string;
  /** Счётчики заслуг для титулов. */
  fishTotal?: number;
  bossKills?: number;
  dragonTop?: number;
  contracts?: number;
  /** Жетоны заданий ◈ — валюта лавки трактирщика. */
  tokens?: number;
  /** Свитки: до какого момента действуют (мс с эпохи) — переживают перезаход. */
  scrollXpUntil?: number;
  /** Катакомбы: лучший урон за один забег, забегов и побед (таблица рекордов у спектатора). */
  catBestDmg?: number;
  catRuns?: number;
  catWins?: number;
  /** Сезон рекордов катакомб (CATACOMBS.season): у записи старого сезона рекорды не считаются и обнуляются при следующем забеге. */
  catSeason?: number;
  /** Бафф победы над событием (×2 опыт/урон) и «Тепло костра»: до какого момента (мс с эпохи) — переживают перезаход и смену ПК ↔ бот. */
  eventBuffUntil?: number;
  campBuffUntil?: number;
  scrollWindUntil?: number;
  /** Версия системы атрибутов: 2 — «Классы 2.0» (6 атрибутов, цена очков растёт). Нет/1 — старая. */
  attrVer?: number;
  /** Класс бота зрителя (оружие класса), выбранный !class. Нет — прежнее/случайное. */
  botClass?: string;
  /** Хозяин сам распределяет очки атрибутов (вложил вручную или сбросил) — бот больше не раскидывает их сам. */
  manualAttrs?: boolean;
  /** Выбранные умения (2 из пула класса), по классу: { warrior: ["stunBash","crush"], … }. */
  skills?: Record<string, string[]>;
  /** Кольца и камни (shared/jewels.ts JewelSave): все кольца, надетые в слотах 1/2, камни в сумке. */
  rings?: RingInst[];
  ringOn?: [string | null, string | null];
  gems?: Record<string, number>;
  /** Непрочитанные подарки (server/trade.ts): показываются в инвентаре, пока не нажмут «Понятно». */
  giftNotes?: { from: string; text: string; at: number }[];
  /** Обмен: предложения, ждущие ответа (входящие) и отправленные; предметы отправителя — в предложении. */
  tradeIn?: TradeOffer[];
  tradeOut?: TradeOffer[];
  updatedAt: number;
}

/** Текущая версия системы атрибутов. */
export const ATTR_VER = 2;

/**
 * Переход на «Классы 2.0»: у старых записей три атрибута по 1 очку за
 * уровень — сбрасываем все шесть к стартовым и отдаём очки уровня по новой
 * системе (бесплатный сброс). Записи без con/luc/wis тоже лечатся здесь.
 */
export function migrateAttrs(r: PlayerRecord): boolean {
  if (r.attrVer === ATTR_VER) return false;
  resetAttrs(r);
  r.attrVer = ATTR_VER;
  r.respecCount = 0;
  return true;
}

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/players.json");

function blank(token: string): PlayerRecord {
  const p = blankProgress();
  return {
    token,
    nick: "гость",
    x: RESPAWN.spawnX,
    y: PLAYER.eyeHeight,
    z: RESPAWN.spawnZ,
    yaw: 0,
    ...p,
    hp: maxHpFor(p.level, p),
    attrVer: ATTR_VER,
    owned: [],
    stowed: [],
    held: { left: null, right: null },
    overrides: {},
    bag: emptyBag(),
    kills: 0,
    bestTowerFloor: 0,
    towerShards: 0,
    leaveBot: false,
    weapons: [],
    updatedAt: 0,
  };
}

/**
 * Простое хранилище персонажей: всё в памяти + периодический дамп в JSON.
 * С этапа 7 прогресс и HP считает сервер — здесь они просто переживают перезапуск.
 */
export class PlayerStore {
  private readonly records = new Map<string, PlayerRecord>();
  private dirty = false;

  constructor() {
    try {
      if (existsSync(FILE)) {
        const raw = JSON.parse(readFileSync(FILE, "utf8")) as PlayerRecord[];
        let migrated = 0;
        for (const r of raw) {
          if (!r?.token) continue;
          if (migrateAttrs(r)) migrated++;
          this.records.set(r.token, r);
        }
        console.log(`[store] загружено персонажей: ${this.records.size}${migrated ? `, переведено на «Классы 2.0»: ${migrated}` : ""}`);
        if (migrated) this.dirty = true;
      }
    } catch (e) {
      console.warn("[store] players.json не прочитан:", (e as Error).message);
    }
  }

  get(token: string): PlayerRecord | undefined {
    return this.records.get(token);
  }

  /** Все записи — для таблицы лидеров (Ф10). Не для горячего пути: копия. */
  entries(): PlayerRecord[] {
    return [...this.records.values()];
  }

  /** Обновить (или создать) запись. */
  put(token: string, patch: Partial<PlayerRecord>): void {
    const cur = this.records.get(token) ?? blank(token);
    this.records.set(token, { ...cur, ...patch, token, updatedAt: Date.now() });
    this.dirty = true;
  }

  /** Удалить запись целиком (сброс прогресса по `!delete`). */
  del(token: string): boolean {
    if (!this.records.delete(token)) return false;
    this.dirty = true;
    return true;
  }

  /** Обнулить статистику «Охотничьей башни» у всех — топ по этажам с чистого листа. */
  resetTowerStats(): void {
    for (const r of this.records.values()) {
      r.bestTowerFloor = 0;
      r.towerShards = 0;
      r.towerClearedAt = undefined;
      r.bestTowerTimeSec = undefined;
    }
    this.dirty = true;
  }

  /** Записать на диск, если что-то менялось. Атомарно (tmp + rename). */
  /** Диагностика (server/perf.ts): последняя запись — сколько заняла и сколько байт. */
  readonly lastFlush = { ms: 0, bytes: 0, count: 0 };

  flush(): void {
    if (!this.dirty) return;
    try {
      const t0 = performance.now();
      mkdirSync(dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      const json = JSON.stringify([...this.records.values()], null, 2);
      writeFileSync(tmp, json);
      renameSync(tmp, FILE);
      this.dirty = false;
      this.lastFlush.ms = performance.now() - t0;
      this.lastFlush.bytes = json.length;
      this.lastFlush.count++;
    } catch (e) {
      console.warn("[store] players.json не записан:", (e as Error).message);
    }
  }
}
