import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataFile } from "./dataDir";
import { itemView, type Taken } from "./trade";
import { armorLabel } from "#shared/armor";
import { CRAFT_ITEMS } from "#shared/craft";
import { instanceEffects, instanceLabels, instanceName, ITEMS, weaponQuality } from "#shared/items";
import { neckLabel } from "#shared/necklaces";
import { ringLabel } from "#shared/jewels";
import { MARKET, type MarketData, type MarketLotView, type MarketOfferOut, type MarketOutgoingView } from "#shared/market";

const FILE = dataFile("market.json");

export interface MarketOffer {
  id: string;
  buyerToken: string;
  buyerNick: string;
  /** Предметы покупателя уже изъяты из его инвентаря. */
  items: Taken[];
  at: number;
}

export interface MarketListing {
  id: string;
  sellerToken: string;
  sellerNick: string;
  /** Предмет уже изъят у продавца. */
  item: Taken;
  price: number;
  note: string;
  createdAt: number;
  expiresAt: number;
  offers: MarketOffer[];
}

interface MarketFile {
  listings: MarketListing[];
}

/** Заявки рынка переживают рестарт; журнал передач — в trades.jsonl. */
export class MarketStore {
  private listings: MarketListing[] = [];

  constructor() {
    try {
      if (!existsSync(FILE)) return;
      const raw = JSON.parse(readFileSync(FILE, "utf8")) as MarketFile;
      if (Array.isArray(raw?.listings)) this.listings = raw.listings.filter((l) => l && typeof l.id === "string" && l.item && typeof l.sellerToken === "string");
      console.log(`[market] восстановлено заявок: ${this.listings.length}`);
    } catch (e) {
      console.warn("[market] market.json не прочитан:", (e as Error).message);
    }
  }

  all(): readonly MarketListing[] {
    return this.listings;
  }

  get(id: string): MarketListing | undefined {
    return this.listings.find((l) => l.id === id);
  }

  bySeller(token: string): MarketListing[] {
    return this.listings.filter((l) => l.sellerToken === token);
  }

  countBySeller(token: string): number {
    return this.listings.reduce((n, l) => n + (l.sellerToken === token ? 1 : 0), 0);
  }

  add(l: MarketListing): void {
    this.listings.push(l);
    this.save();
  }

  remove(id: string): MarketListing | undefined {
    const i = this.listings.findIndex((l) => l.id === id);
    if (i < 0) return undefined;
    const [l] = this.listings.splice(i, 1);
    this.save();
    return l;
  }

  update(l: MarketListing): void {
    const i = this.listings.findIndex((x) => x.id === l.id);
    if (i >= 0) this.listings[i] = l;
    this.save();
  }

  save(): void {
    try {
      mkdirSync(dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      writeFileSync(tmp, JSON.stringify({ listings: this.listings }, null, 0));
      renameSync(tmp, FILE);
    } catch (e) {
      console.warn("[market] не сохранилось:", (e as Error).message);
    }
  }
}

export const market = new MarketStore();

/** «Банки» (зелья) на рынок не выставляются и в обмен не предлагаются. */
export function marketForbidden(t: Taken): boolean {
  return t.k === "bag" && t.item === "potion";
}

/** Полное описание предмета для карточки рынка. */
export function marketDetails(t: Taken): string[] {
  if (t.k === "weapon") {
    return [
      ...instanceLabels(t.w),
      ...instanceEffects(t.w),
      `Оценка ${weaponQuality(t.w)}`,
      ...(t.w.sharp ? [`Заточка +${t.w.sharp}`] : []),
    ].filter(Boolean);
  }
  if (t.k === "armor") return [armorLabel(t.a)];
  if (t.k === "ring") return [ringLabel(t.r)];
  if (t.k === "neck") return [neckLabel(t.n)];
  if (t.k === "bag") return [ITEMS[t.item].name];
  if (t.k === "mat") return [CRAFT_ITEMS[t.id].name];
  return ["Камень"];
}

/** Сетевое представление заявки для конкретного смотрящего. */
export function marketLotView(l: MarketListing, token: string): MarketLotView {
  const mine = l.sellerToken === token;
  return {
    id: l.id,
    seller: l.sellerNick,
    price: l.price,
    note: l.note,
    createdAt: l.createdAt,
    expiresAt: l.expiresAt,
    item: itemView(l.item),
    details: marketDetails(l.item),
    mine,
    ...(mine ? { offers: l.offers.map(marketOfferView) } : {}),
  };
}

function marketOfferView(o: MarketOffer): MarketOfferOut {
  return { id: o.id, buyer: o.buyerNick, items: o.items.map(itemView), details: o.items.map(marketDetails), at: o.at };
}

/** Данные вкладки «Рынок»: все лоты, мои лоты, лом в сумке. */
export function marketViewFor(token: string, scrap: number): MarketData {
  const lot = (l: MarketListing) => marketLotView(l, token);
  const outgoing: MarketOutgoingView[] = [];
  for (const l of market.all()) {
    for (const o of l.offers) {
      if (o.buyerToken !== token) continue;
      outgoing.push({
        offerId: o.id,
        lotId: l.id,
        lotName: marketItemName(l.item),
        seller: l.sellerNick,
        items: o.items.map(itemView),
        details: o.items.map(marketDetails),
        at: o.at,
      });
    }
  }
  return {
    lots: market.all().map(lot),
    mine: market.bySeller(token).map(lot),
    outgoing,
    scrap,
    feePct: MARKET.fee,
  };
}

/** Название предмета для тоста/журнала. */
export function marketItemName(t: Taken): string {
  if (t.k === "weapon") return instanceName(t.w);
  if (t.k === "armor") return armorLabel(t.a);
  if (t.k === "ring") return ringLabel(t.r);
  if (t.k === "neck") return neckLabel(t.n);
  if (t.k === "gem") return "камень";
  if (t.k === "mat") return CRAFT_ITEMS[t.id].name;
  return ITEMS[t.item].name;
}
