import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { TradeItemView } from "#shared/net/messages";
import { addToBag, bagCount, instanceName, ITEMS, takeFromBag, type ItemId, type Slot, type WeaponInstance } from "#shared/items";
import { gemName, parseGem, ringName, type JewelSave } from "#shared/jewels";

/**
 * Передача предметов между героями — основа подарков (сейчас) и обмена (потом).
 *
 * Работает с «снимком» инвентаря героя (InvSnap): ZoneRoom собирает его из живого героя или из
 * сохранения и потом записывает обратно — одна логика для обоих случаев. Перенос атомарный:
 * сначала проверка ВСЕГО списка, потом изменения; ошибка — ничего не тронуто.
 */

/** Предмет для передачи. */
export type TradeItem =
  | { k: "weapon"; id: string }
  | { k: "ring"; id: string }
  | { k: "gem"; key: string; n: number }
  | { k: "bag"; item: ItemId; n: number };

/** Что из сумки можно передавать. */
export const TRADE_BAG_ITEMS: readonly ItemId[] = ["scrap", "potion", "fish"];

/** Инвентарь героя для передачи. */
export interface InvSnap {
  weapons: WeaponInstance[];
  /** id оружия в руках (его не отдать — сначала снять). */
  heldIds: Set<string | null | undefined>;
  bag: Slot[];
  jewels: JewelSave;
}

/** Разбор предмета из сети: «w:<id>», «r:<id>», «g:<камень>», «b:<предмет>» + количество. */
export function parseTradeItem(code: string, n: number): TradeItem | null {
  const i = code.indexOf(":");
  if (i < 1) return null;
  const k = code.slice(0, i);
  const v = code.slice(i + 1);
  const cnt = Math.max(1, Math.min(99999, Math.floor(n) || 1));
  if (k === "w" && v) return { k: "weapon", id: v };
  if (k === "r" && v) return { k: "ring", id: v };
  if (k === "g" && parseGem(v)) return { k: "gem", key: v, n: cnt };
  if (k === "b" && (TRADE_BAG_ITEMS as readonly string[]).includes(v)) return { k: "bag", item: v as ItemId, n: cnt };
  return null;
}

/** Предмет строкой — для журнала, чата и всплывашек. */
export function tradeItemName(it: TradeItem, snap?: InvSnap): string {
  switch (it.k) {
    case "weapon": {
      const w = snap?.weapons.find((x) => x.id === it.id);
      return w ? instanceName(w) : "оружие";
    }
    case "ring": {
      const r = snap?.jewels.rings.find((x) => x.id === it.id);
      return r ? ringName(r) : "кольцо";
    }
    case "gem":
      return `${gemName(it.key)}${it.n > 1 ? ` ×${it.n}` : ""}`;
    case "bag":
      return `${ITEMS[it.item].name}${it.n > 1 ? ` ×${it.n}` : ""}`;
  }
}

/** Вынести предметы из снимка (проверка всего списка, потом изъятие). Вернёт изъятое или текст ошибки. */
export function takeItems(snap: InvSnap, items: readonly TradeItem[]): { taken: Taken[] } | { error: string } {
  // Проверка.
  const gemNeed = new Map<string, number>();
  const bagNeed = new Map<ItemId, number>();
  for (const it of items) {
    if (it.k === "weapon") {
      const w = snap.weapons.find((x) => x.id === it.id);
      if (!w) return { error: "Этого оружия уже нет в инвентаре." };
      if (snap.heldIds.has(w.id)) return { error: `«${instanceName(w)}» в руках — сначала сними.` };
    } else if (it.k === "ring") {
      const r = snap.jewels.rings.find((x) => x.id === it.id);
      if (!r) return { error: "Этого кольца уже нет." };
      if (snap.jewels.ringOn.includes(r.id)) return { error: "Кольцо надето — сначала сними." };
    } else if (it.k === "gem") {
      gemNeed.set(it.key, (gemNeed.get(it.key) ?? 0) + it.n);
    } else {
      bagNeed.set(it.item, (bagNeed.get(it.item) ?? 0) + it.n);
    }
  }
  for (const [k, n] of gemNeed) if ((snap.jewels.gems[k] ?? 0) < n) return { error: `Не хватает: ${gemName(k)} (есть ${snap.jewels.gems[k] ?? 0}).` };
  for (const [k, n] of bagNeed) if (bagCount(snap.bag, k) < n) return { error: `Не хватает: ${ITEMS[k].name} (есть ${bagCount(snap.bag, k)}).` };
  // Изъятие.
  const taken: Taken[] = [];
  for (const it of items) {
    if (it.k === "weapon") {
      const i = snap.weapons.findIndex((x) => x.id === it.id);
      const [w] = snap.weapons.splice(i, 1);
      delete w.fav; // избранное — личная пометка, не передаётся
      taken.push({ k: "weapon", w });
    } else if (it.k === "ring") {
      const i = snap.jewels.rings.findIndex((x) => x.id === it.id);
      const [r] = snap.jewels.rings.splice(i, 1);
      delete r.fav; // ★ — личная пометка, как у оружия: не передаётся
      taken.push({ k: "ring", r });
    } else if (it.k === "gem") {
      const left = (snap.jewels.gems[it.key] ?? 0) - it.n;
      if (left > 0) snap.jewels.gems[it.key] = left;
      else delete snap.jewels.gems[it.key];
      taken.push({ k: "gem", key: it.key, n: it.n });
    } else {
      takeFromBag(snap.bag, it.item, it.n);
      taken.push({ k: "bag", item: it.item, n: it.n });
    }
  }
  return { taken };
}

/** Изъятый предмет (с самим экземпляром — переносится как есть). */
export type Taken =
  | { k: "weapon"; w: WeaponInstance }
  | { k: "ring"; r: JewelSave["rings"][number] }
  | { k: "gem"; key: string; n: number }
  | { k: "bag"; item: ItemId; n: number };

/** Положить изъятое в снимок получателя. Сумка без лимита (как склад оружия), поэтому не отказывает. */
export function giveItems(snap: InvSnap, taken: readonly Taken[]): void {
  for (const t of taken) {
    if (t.k === "weapon") snap.weapons.push(t.w);
    else if (t.k === "ring") snap.jewels.rings.push(t.r);
    else if (t.k === "gem") snap.jewels.gems[t.key] = (snap.jewels.gems[t.key] ?? 0) + t.n;
    else addToBag(snap.bag, t.item, t.n);
  }
}

export function takenName(t: Taken): string {
  if (t.k === "weapon") return instanceName(t.w);
  if (t.k === "ring") return ringName(t.r);
  if (t.k === "gem") return `${gemName(t.key)}${t.n > 1 ? ` ×${t.n}` : ""}`;
  return `${ITEMS[t.item].name}${t.n > 1 ? ` ×${t.n}` : ""}`;
}

// ---------------------------------------------------------------- обмен (окно двух героев)

/** Действия обмена из окна инвентаря (страница !inv, ПК, телефон, игра). */
export const TRADE_ACTS = ["tradeOpen", "tradeAdd", "tradeRemove", "tradeConfirm", "tradeCancel"] as const;
export type TradeAct = (typeof TRADE_ACTS)[number];

/** Сторона обмена: её предметы уже сняты с инвентаря (лежат в обмене), `ok` — подтвердила. */
export interface TradeSide {
  nick: string;
  token: string;
  items: Taken[];
  ok: boolean;
}

/**
 * Обмен двух героев. Предметы каждого видны обоим; меняются местами, когда подтвердили оба.
 * Любое изменение набора сбрасывает подтверждения. Оба не обязаны быть в игре одновременно.
 */
export interface TradeSession {
  id: string;
  a: TradeSide;
  b: TradeSide;
  at: number;
}

/** Список предметов из сети: JSON [{"c": «w:<id>» | «r:<id>» | «g:<камень>» | «b:<предмет>», "n": число}]. Кривое — null. */
export function parseTradeList(raw: string): TradeItem[] | null {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length > 40) return null;
  const out: TradeItem[] = [];
  for (const e of arr) {
    const c = (e as { c?: unknown } | null)?.c;
    const n = Number((e as { n?: unknown } | null)?.n);
    if (typeof c !== "string") return null;
    const it = parseTradeItem(c, n);
    if (!it) return null;
    out.push(it);
  }
  return out;
}

/** Предмет обмена для окна: название, число и то, что нужно для иконки. */
export function itemView(t: Taken): TradeItemView {
  if (t.k === "weapon") return { k: "weapon", name: instanceName(t.w), n: 1, cls: t.w.cls, tier: t.w.tier };
  if (t.k === "ring") return { k: "ring", name: ringName(t.r), n: 1, tier: t.r.tier, gems: [...t.r.gems] };
  if (t.k === "gem") return { k: "gem", name: gemName(t.key), n: t.n, key: t.key };
  return { k: "bag", name: ITEMS[t.item].name, n: t.n, item: t.item };
}

/** Окно обмена для героя `token`: его предметы и предметы собеседника, подтверждения. */
export function tradeViewOf(rec: { trades?: TradeSession[] } | undefined, token: string): {
  sessions: { id: string; with: string; mine: { items: TradeItemView[]; ok: boolean }; theirs: { items: TradeItemView[]; ok: boolean } }[];
} {
  return {
    sessions: (rec?.trades ?? []).map((s) => {
      const mine = s.a.token === token ? s.a : s.b;
      const theirs = s.a.token === token ? s.b : s.a;
      return {
        id: s.id,
        with: theirs.nick,
        mine: { items: mine.items.map(itemView), ok: mine.ok },
        theirs: { items: theirs.items.map(itemView), ok: theirs.ok },
      };
    }),
  };
}

// ---------------------------------------------------------------- журнал

const LOG = resolve(dirname(fileURLToPath(import.meta.url)), ".data/trades.jsonl");

/** Запись в журнал передач (по строке JSON): кто, кому, что — разбирать жалобы «у меня пропало». */
export function tradeLog(e: { kind: "gift" | "trade"; from: { nick: string; token: string }; to: { nick: string; token: string }; items: readonly Taken[] }): void {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    const items = e.items.map((t) =>
      t.k === "weapon"
        ? { k: t.k, id: t.w.id, cls: t.w.cls, tier: t.w.tier, name: instanceName(t.w) }
        : t.k === "ring"
          ? { k: t.k, id: t.r.id, tier: t.r.tier, gems: t.r.gems }
          : t.k === "gem"
            ? { k: t.k, key: t.key, n: t.n }
            : { k: t.k, item: t.item, n: t.n },
    );
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), kind: e.kind, from: e.from, to: e.to, items }) + "\n");
  } catch (err) {
    console.warn("[trade] журнал не записан:", (err as Error).message);
  }
}
