import type { TradeItemView } from "./net/messages";

/** Внутриигровой рынок: лимиты и сетевые представления заявок. */
export const MARKET = {
  /** Активных заявок на одного героя. */
  maxListings: 20,
  /** Предметов в одном предложении обмена. */
  maxOfferItems: 10,
  /** Максимальная цена в ломе. */
  maxPrice: 100_000_000,
  /** Длина описания продавца. */
  maxNote: 140,
  /** Срок заявки. */
  days: 14,
  /** Комиссия рынка с продажи (сжигается). */
  fee: 0.05,
  /** Предложений на одну заявку. */
  maxOffers: 20,
} as const;

/** Предложение обмена: предметы покупателя уже в эскроу. */
export interface MarketOfferOut {
  id: string;
  buyer: string;
  items: TradeItemView[];
  details: string[][];
  at: number;
}

/** Заявка на рынке. */
export interface MarketLotView {
  id: string;
  seller: string;
  price: number;
  note: string;
  createdAt: number;
  expiresAt: number;
  item: TradeItemView;
  details: string[];
  mine: boolean;
  /** Только продавцу: входящие предложения. */
  offers?: MarketOfferOut[];
}

/** Моё предложение обмена, ожидающее продавца. */
export interface MarketOutgoingView {
  offerId: string;
  lotId: string;
  lotName: string;
  seller: string;
  items: TradeItemView[];
  details: string[][];
  at: number;
}

export interface MarketData {
  lots: MarketLotView[];
  mine: MarketLotView[];
  /** Предложения, где я покупатель (можно отозвать). */
  outgoing: MarketOutgoingView[];
  scrap: number;
  feePct: number;
}

export type MarketAct =
  | "marketList"
  | "marketCancel"
  | "marketBuy"
  | "marketOffer"
  | "marketAccept"
  | "marketDecline"
  | "marketRetract";

export const MARKET_ACTS: readonly MarketAct[] = [
  "marketList", "marketCancel", "marketBuy", "marketOffer", "marketAccept", "marketDecline", "marketRetract",
];
