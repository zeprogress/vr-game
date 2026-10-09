/**
 * Кольца и камни (2026-10-07). Единый источник: виды, числа, хранение и все операции.
 *
 *  - У героя 2 слота колец. Кольцо: обычное (без гнёзд), золотое (1 гнездо), уникальное (2).
 *    Любое надетое кольцо — маг. защита RING.mres (два кольца — 1 − 0.9·0.9).
 *  - Камни шести видов, по атрибуту; уровень без потолка, прибавка = уровню.
 *    С мобов падают только 1 ур.; три камня одного вида и уровня → один уровнем выше.
 *  - Вынуть камень из кольца — за лом (RING.unsocketPerLv × уровень), камень цел.
 *  - Кольца разбираются в лом, камни — нет.
 *  - Кольца на модели героя не видны — только в инвентаре.
 *
 * Сервер хранит всё в записи героя (PlayerStore: rings/ringOn/gems) — и для живого героя тоже;
 * прибавку к атрибутам живому герою кладёт в PlayerState.gb (её читают формулы через attrOf).
 */
import type { Attr } from "./classes2";
import { ATTR_LOOK } from "./look";

export type GemAttr = Attr;
export const GEM_ATTRS: readonly GemAttr[] = ["str", "agi", "int", "wis", "luc", "con"];

/** Камень: название и цвет — цвет атрибута (look.ts ATTR_LOOK, один на всю игру). */
export const GEM_LOOK: Record<GemAttr, { name: string; c: string; d: string; l: string }> = {
  str: { name: "Камень силы", ...ATTR_LOOK.str },
  agi: { name: "Камень ловкости", ...ATTR_LOOK.agi },
  int: { name: "Камень интеллекта", ...ATTR_LOOK.int },
  wis: { name: "Камень мудрости", ...ATTR_LOOK.wis },
  luc: { name: "Камень удачи", ...ATTR_LOOK.luc },
  con: { name: "Камень телосложения", ...ATTR_LOOK.con },
};

export type RingTier = "base" | "gold" | "legendary";
export const RING_TIERS: readonly RingTier[] = ["base", "gold", "legendary"];
export const RING_LOOK: Record<RingTier, { name: string; sockets: number; band: readonly [string, string, string] }> = {
  base: { name: "Обычное кольцо", sockets: 0, band: ["#f4f3ef", "#b9b6ad", "#6b6b6b"] },
  gold: { name: "Золотое кольцо", sockets: 1, band: ["#fff1b8", "#ffd166", "#a8740c"] },
  legendary: { name: "Уникальное кольцо", sockets: 2, band: ["#f1e6ff", "#b989ff", "#4d2496"] },
};

/** Числа колец и камней. */
export const RING = {
  /** Маг. защита одного надетого кольца (доля). */
  mres: 0.1,
  /** Сколько камней сливаются в один уровнем выше. */
  combine: 3,
  /** Вынуть камень: лом за каждый уровень камня. */
  unsocketPerLv: 3,
  /** Лом за разбор кольца. */
  scrap: { base: 30, gold: 100, legendary: 300 } as Record<RingTier, number>, // 2026-10-07: ×10
  /** Шанс с обычного моба за убийство; элита/боссы — множитель drop.elite/boss. */
  gemChance: 0.025,
  ringChance: 0.0025,
  /** Множители шансов: элитный моб лагеря / босс (рейд-босс, Владыка, Багровый). */
  eliteMul: 3,
  bossMul: 40,
  /** Доли тиров выпавшего кольца. */
  ringTierW: { base: 0.7, gold: 0.25, legendary: 0.05 } as Record<RingTier, number>,
  /** Слотов колец у героя. */
  slots: 2,
} as const;

/** Камень: «str:3» — атрибут и уровень. */
export type GemKey = string;
export function gemKey(attr: GemAttr, lv: number): GemKey {
  return `${attr}:${lv}`;
}
export function parseGem(k: unknown): { attr: GemAttr; lv: number } | null {
  if (typeof k !== "string") return null;
  const [a, l] = k.split(":");
  const lv = Math.floor(Number(l));
  if (!GEM_ATTRS.includes(a as GemAttr) || !(lv >= 1 && lv <= 999)) return null;
  return { attr: a as GemAttr, lv };
}
export function gemName(k: GemKey): string {
  const g = parseGem(k);
  return g ? `${GEM_LOOK[g.attr].name} ${g.lv} ур.` : "Камень";
}

export interface RingInst {
  id: string;
  tier: RingTier;
  /** Камни в гнёздах (длина = гнёзд у тира), null — пусто. */
  gems: (GemKey | null)[];
}

/** Всё о кольцах и камнях героя (поля записи PlayerStore). */
export interface JewelSave {
  rings: RingInst[];
  /** id колец в слотах 1 и 2. */
  ringOn: [string | null, string | null];
  /** Камни в сумке: ключ → сколько. */
  gems: Record<GemKey, number>;
}

/** Нормализовать сохранённое (старые записи — без полей). */
export function jewelsOf(r: { rings?: unknown; ringOn?: unknown; gems?: unknown }): JewelSave {
  const rings: RingInst[] = Array.isArray(r.rings)
    ? (r.rings as RingInst[])
        .filter((x) => x && typeof x.id === "string" && RING_TIERS.includes(x.tier))
        .map((x) => {
          const n = RING_LOOK[x.tier].sockets;
          const g = Array.isArray(x.gems) ? x.gems : [];
          return { id: x.id, tier: x.tier, gems: Array.from({ length: n }, (_, i) => (parseGem(g[i]) ? (g[i] as string) : null)) };
        })
    : [];
  const on = Array.isArray(r.ringOn) ? (r.ringOn as unknown[]) : [];
  const has = (id: unknown): string | null => (typeof id === "string" && rings.some((x) => x.id === id) ? id : null);
  const ringOn: [string | null, string | null] = [has(on[0]), has(on[1])];
  if (ringOn[0] && ringOn[0] === ringOn[1]) ringOn[1] = null;
  const gems: Record<GemKey, number> = {};
  if (r.gems && typeof r.gems === "object") {
    for (const [k, v] of Object.entries(r.gems as Record<string, unknown>)) {
      const n = Math.floor(Number(v));
      if (parseGem(k) && n > 0) gems[k] = n;
    }
  }
  return { rings, ringOn, gems };
}

export interface JewelBonus {
  str: number;
  agi: number;
  int: number;
  con: number;
  luc: number;
  wis: number;
  /** Сколько колец надето (маг. защита — по RING.mres за каждое). */
  rings: number;
}

/** Прибавка от надетых колец и камней в них. */
export function jewelBonus(js: JewelSave): JewelBonus {
  const b: JewelBonus = { str: 0, agi: 0, int: 0, con: 0, luc: 0, wis: 0, rings: 0 };
  for (const id of js.ringOn) {
    const r = id ? js.rings.find((x) => x.id === id) : undefined;
    if (!r) continue;
    b.rings++;
    for (const k of r.gems) {
      const g = parseGem(k);
      if (g) b[g.attr] += g.lv;
    }
  }
  return b;
}

/** Маг. защита от колец: 1 − (1 − mres)^n. */
export function ringResist(rings: number): number {
  return 1 - Math.pow(1 - RING.mres, Math.max(0, rings));
}

export function ringName(r: { tier: RingTier }): string {
  return RING_LOOK[r.tier].name;
}

/** Кольцо одной строкой: «Золотое кольцо: Камень силы 2 ур.». */
export function ringLabel(r: RingInst): string {
  const g = r.gems.filter(Boolean) as string[];
  return g.length ? `${ringName(r)}: ${g.map(gemName).join(", ")}` : ringName(r);
}

/** Прибавки кольца строками для подсказки: «+2 Сила», «Маг. защита 10%». */
export function ringBonusText(r: RingInst): string[] {
  const out = [`Маг. защита ${Math.round(RING.mres * 100)}%`];
  for (const k of r.gems) {
    const g = parseGem(k);
    if (g) out.push(`+${g.lv} ${ATTR_SHORT[g.attr]}`);
  }
  return out;
}
export const ATTR_SHORT: Record<GemAttr, string> = { str: "Сила", agi: "Ловкость", int: "Интеллект", con: "Телосложение", luc: "Удача", wis: "Мудрость" };

const addGem = (js: JewelSave, k: GemKey, n: number): void => {
  const v = (js.gems[k] ?? 0) + n;
  if (v > 0) js.gems[k] = v;
  else delete js.gems[k];
};

// ---------------------------------------------------------------- операции (меняют js; ошибка — строкой)

export type JewelOp =
  | { op: "ringOn"; id: string; slot: number }
  | { op: "ringOff"; slot: number }
  | { op: "ringScrap"; id: string }
  | { op: "gemIn"; id: string; idx: number; gem: GemKey }
  | { op: "gemOut"; id: string; idx: number }
  | { op: "gemMerge"; gem: GemKey }
  | { op: "gemMergeAll" }
  | { op: "gemSplit"; gem: GemKey }
  | { op: "ringScrapAll" };

export interface JewelOpResult {
  ok: boolean;
  text: string;
  /** Лом: + получен (разбор), − списать (вынуть камень). */
  scrap?: number;
}

/**
 * Применить операцию. `scrapHave` — лом в сумке (хватит ли на «вынуть»). Списание/начисление лома
 * делает вызывающий по `scrap` в ответе.
 */
export function applyJewelOp(js: JewelSave, o: JewelOp, scrapHave: number): JewelOpResult {
  const ring = (id: string): RingInst | undefined => js.rings.find((x) => x.id === id);
  switch (o.op) {
    case "ringOn": {
      const r = ring(o.id);
      if (!r) return { ok: false, text: "Этого кольца уже нет." };
      const slot = o.slot === 1 ? 1 : 0;
      const other = slot === 1 ? 0 : 1;
      if (js.ringOn[other] === r.id) js.ringOn[other] = null;
      js.ringOn[slot] = r.id;
      return { ok: true, text: `Надето: ${ringLabel(r)}` };
    }
    case "ringOff": {
      const slot = o.slot === 1 ? 1 : 0;
      if (!js.ringOn[slot]) return { ok: false, text: "Слот и так пуст." };
      js.ringOn[slot] = null;
      return { ok: true, text: "Кольцо снято" };
    }
    case "ringScrap": {
      const r = ring(o.id);
      if (!r) return { ok: false, text: "Этого кольца уже нет." };
      if (js.ringOn.includes(r.id)) return { ok: false, text: "Кольцо надето — сначала сними." };
      // Камни из разбираемого кольца возвращаются в сумку бесплатно.
      for (const k of r.gems) if (k) addGem(js, k, 1);
      js.rings = js.rings.filter((x) => x !== r);
      const got = RING.scrap[r.tier];
      return { ok: true, text: `${ringName(r)} → лом +${got}${r.gems.some(Boolean) ? " (камни — в сумку)" : ""}`, scrap: got };
    }
    case "gemIn": {
      const r = ring(o.id);
      const g = parseGem(o.gem);
      if (!r) return { ok: false, text: "Этого кольца уже нет." };
      if (!g || !(js.gems[o.gem] > 0)) return { ok: false, text: "Такого камня в сумке нет." };
      if (!r.gems.length) return { ok: false, text: "У обычного кольца нет гнёзд." };
      let idx = o.idx >= 0 && o.idx < r.gems.length ? o.idx : r.gems.indexOf(null);
      if (idx < 0) return { ok: false, text: "Свободных гнёзд нет — сначала выньте камень." };
      if (r.gems[idx]) {
        idx = r.gems.indexOf(null);
        if (idx < 0) return { ok: false, text: "Гнездо занято — сначала выньте камень." };
      }
      r.gems[idx] = o.gem;
      addGem(js, o.gem, -1);
      return { ok: true, text: `${gemName(o.gem)} → ${ringName(r)}` };
    }
    case "gemOut": {
      const r = ring(o.id);
      const k = r?.gems[o.idx];
      const g = parseGem(k);
      if (!r || !k || !g) return { ok: false, text: "В этом гнезде нет камня." };
      const cost = RING.unsocketPerLv * g.lv;
      if (scrapHave < cost) return { ok: false, text: `Нужно лома: ${cost} (есть ${scrapHave}).` };
      r.gems[o.idx] = null;
      addGem(js, k, 1);
      return { ok: true, text: `${gemName(k)} вынут — лом −${cost}`, scrap: -cost };
    }
    case "gemMerge": {
      const g = parseGem(o.gem);
      if (!g) return { ok: false, text: "Нет такого камня." };
      const have = js.gems[o.gem] ?? 0;
      if (have < RING.combine) return { ok: false, text: `Нужно ${RING.combine} одинаковых камня (есть ${have}).` };
      addGem(js, o.gem, -RING.combine);
      const up = gemKey(g.attr, g.lv + 1);
      addGem(js, up, 1);
      return { ok: true, text: `${RING.combine} × ${gemName(o.gem)} → ${gemName(up)}` };
    }
    case "gemSplit": {
      const g = parseGem(o.gem);
      if (!g) return { ok: false, text: "Нет такого камня." };
      if (g.lv <= 1) return { ok: false, text: "Камень 1 уровня не делится." };
      if (!(js.gems[o.gem] > 0)) return { ok: false, text: "Такого камня в сумке нет." };
      const down = gemKey(g.attr, g.lv - 1);
      addGem(js, o.gem, -1);
      addGem(js, down, RING.combine);
      return { ok: true, text: `${gemName(o.gem)} → ${RING.combine} × ${gemName(down)}` };
    }
    case "ringScrapAll": {
      // Все кольца из сумки в лом; надетые остаются. Камни из разобранных — в сумку.
      const bag = js.rings.filter((r) => !js.ringOn.includes(r.id));
      if (!bag.length) return { ok: false, text: "Колец в сумке нет — надетые не разбираются." };
      let got = 0;
      for (const r of bag) {
        for (const k of r.gems) if (k) addGem(js, k, 1);
        got += RING.scrap[r.tier];
      }
      js.rings = js.rings.filter((r) => js.ringOn.includes(r.id));
      return { ok: true, text: `Колец разобрано: ${bag.length} → лом +${got}`, scrap: got };
    }
    case "gemMergeAll": {
      // От младших уровней к старшим — новые камни сразу идут в следующее соединение.
      const made = new Map<GemKey, number>();
      for (let more = true; more; ) {
        more = false;
        const keys = Object.keys(js.gems).sort((a, b) => (parseGem(a)?.lv ?? 0) - (parseGem(b)?.lv ?? 0));
        for (const k of keys) {
          const g = parseGem(k);
          const n = Math.floor((js.gems[k] ?? 0) / RING.combine);
          if (!g || n <= 0) continue;
          const up = gemKey(g.attr, g.lv + 1);
          addGem(js, k, -n * RING.combine);
          addGem(js, up, n);
          made.set(up, (made.get(up) ?? 0) + n);
          more = true;
        }
      }
      if (!made.size) return { ok: false, text: `Нечего соединять — нужно ${RING.combine} одинаковых камня.` };
      // Итог — только камни, что остались после всех соединений (промежуточные ушли выше).
      const res = [...made.keys()].filter((k) => (js.gems[k] ?? 0) > 0).map((k) => `${gemName(k)} ×${js.gems[k]}`);
      return { ok: true, text: `Камни соединены: ${res.join(", ")}` };
    }
  }
}

/** Разбор действия из сети (страница/окно): act + id/idx/fuel → операция. */
export function jewelOpFrom(act: string, id: string, idx: number, fuel?: string): JewelOp | null {
  switch (act) {
    case "ringOn":
      return { op: "ringOn", id, slot: idx };
    case "ringOff":
      return { op: "ringOff", slot: idx };
    case "ringScrap":
      return { op: "ringScrap", id };
    case "gemIn":
      return fuel ? { op: "gemIn", id, idx, gem: fuel } : null;
    case "gemOut":
      return { op: "gemOut", id, idx };
    case "gemMerge":
      return { op: "gemMerge", gem: id };
    case "gemMergeAll":
      return { op: "gemMergeAll" };
    case "gemSplit":
      return id ? { op: "gemSplit", gem: id } : null;
    case "ringScrapAll":
      return { op: "ringScrapAll" };
  }
  return null;
}
export const JEWEL_ACTS = ["ringOn", "ringOff", "ringScrap", "ringScrapAll", "gemIn", "gemOut", "gemMerge", "gemMergeAll", "gemSplit"] as const;
export type JewelAct = (typeof JEWEL_ACTS)[number];

/** Что выпало с моба (или ничего): chanceMul — множитель шансов (элита/босс). */
export function rollJewelDrop(chanceMul: number, rnd = Math.random): { gem?: GemKey; ring?: RingTier } {
  const out: { gem?: GemKey; ring?: RingTier } = {};
  if (rnd() < RING.gemChance * chanceMul) out.gem = gemKey(GEM_ATTRS[Math.floor(rnd() * GEM_ATTRS.length)], 1);
  if (rnd() < RING.ringChance * chanceMul) {
    let x = rnd();
    out.ring = "base";
    for (const t of RING_TIERS) {
      x -= RING.ringTierW[t];
      if (x < 0) {
        out.ring = t;
        break;
      }
    }
  }
  return out;
}

/** Данные колец и камней для окна инвентаря (ПК/телефон, страница !inv, VR). */
export interface PcInvJewels {
  rings: { id: string; tier: RingTier; gems: (GemKey | null)[]; scrap: number }[];
  ringOn: [string | null, string | null];
  /** Камни в сумке: [ключ, сколько], по атрибуту и уровню. */
  gems: [GemKey, number][];
}
export function pcInvJewels(js: JewelSave): PcInvJewels {
  const gems = Object.entries(js.gems).sort((a, b) => {
    const ga = parseGem(a[0])!;
    const gb = parseGem(b[0])!;
    return GEM_ATTRS.indexOf(ga.attr) - GEM_ATTRS.indexOf(gb.attr) || gb.lv - ga.lv;
  });
  return { rings: js.rings.map((r) => ({ id: r.id, tier: r.tier, gems: [...r.gems], scrap: RING.scrap[r.tier] })), ringOn: [...js.ringOn], gems };
}

/** Прибавка по данным окна инвентаря (клиент): то же, что jewelBonus по записи. */
export function pcJewelBonus(j: PcInvJewels | undefined): JewelBonus {
  return jewelBonus({ rings: (j?.rings ?? []) as RingInst[], ringOn: j?.ringOn ?? [null, null], gems: {} });
}
