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
 *  - Ожерелье (shared/necklaces.ts, 2026-10-23): один слот, аффиксы умений с заточкой, гнёзда под те же камни;
 *    выпадает как кольцо (свой бросок), рубиновое — из сундука супербосса катакомб. Хранится здесь же (necks/neckOn).
 *
 * Сервер хранит всё в записи героя (PlayerStore: rings/ringOn/gems) — и для живого героя тоже;
 * прибавку к атрибутам живому герою кладёт в PlayerState.gb (её читают формулы через attrOf).
 */
import type { Attr } from "./classes2";
import { ATTR_LOOK } from "./look";
import { armorLevelMul } from "./armor";
import {
  emptyRingSkillBonus, RING_ROLL, RING_TIERS, ringEnchantRow, ringQuality, ringRollText, ringRollValue, rollRingAffixes, rollRingSockets, sanitizeRingRolls, seededByString,
  type RingRoll, type RingSkillBonus, type RingTier,
} from "./ringAffixes";
import type { EnchantInfo } from "./items";
import { NECK_TIER_NAME, neckBonusOf, neckEnchantRow, neckLabel, neckQuality, neckScrap, rollNecklace, sanitizeNeck, type NeckInst, type NeckStat, type NeckTier } from "./necklaces";

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

export { RING_TIERS, type RingTier } from "./ringAffixes";
/** Имя тира кольца. Гнёзда и аффиксы по тиру — RING_ROLL (shared/ringAffixes.ts). */
export const RING_LOOK: Record<RingTier, { name: string }> = {
  base: { name: "Обычное кольцо" },
  gold: { name: "Золотое кольцо" },
  legendary: { name: "Уникальное кольцо" },
  ruby: { name: "Рубиновое кольцо" },
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
  scrap: { base: 30, gold: 100, legendary: 300, ruby: 3000 } as Record<RingTier, number>, // 2026-10-07: ×10; рубиновое — 2026-10-23
  /** Шанс с обычного моба за убийство; элита/боссы — множитель drop.elite/boss. */
  gemChance: 0.05, // 2026-10-13: ×2 (было 0.025)
  ringChance: 0.0005, // 2026-10-13: ×2 (было 0.00025, до того ×0.1 от 0.0025); мобы, элита и боссы — через chanceMul
  /** Множители шансов: элитный моб лагеря / босс (рейд-босс, Владыка, Багровый). */
  eliteMul: 5, // 2026-10-21: ×5 (было ×3) — элитные кольца 0.25% за убийство
  bossMul: 40,
  /** Доли тиров выпавшего кольца (золотое и уникальное умножаются на уровень моба — RING_LEVEL_GATE). */
  ringTierW: { base: 0.7, gold: 0.25, legendary: 0.05, ruby: 0 } as Record<RingTier, number>, // рубиновое — только из сундука катакомб
  /** Слотов колец у героя. */
  slots: 2,
} as const;

/**
 * Золотое и уникальное кольцо: с 1-го уровня моба шанс нулевой, растёт линейно и к 53-му — как было.
 * Обычное кольцо от уровня не зависит. Уровень — armorLevelMul (тот же гейт, что у брони).
 */
export const RING_LEVEL_GATE = { from: 1, full: 53 } as const;

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
  /** Камни в гнёздах (длина = гнёзд этого кольца, RING_ROLL.sockets тира), null — пусто. */
  gems: (GemKey | null)[];
  /** Аффиксы урона умений (shared/ringAffixes.ts). У старых колец раскатываются при загрузке (jewelsOf). */
  rolls: RingRoll[];
  /** ★ избранное — не разбирается; личная пометка, при передаче снимается. */
  fav?: boolean;
}

/** Всё о кольцах и камнях героя (поля записи PlayerStore). */
export interface JewelSave {
  rings: RingInst[];
  /** id колец в слотах 1 и 2. */
  ringOn: [string | null, string | null];
  /** Камни в сумке: ключ → сколько. */
  gems: Record<GemKey, number>;
  /** Ожерелья (shared/necklaces.ts) и id надетого. */
  necks: NeckInst[];
  neckOn: string | null;
}

/** Нормализовать сохранённое (старые записи — без полей). */
export function jewelsOf(r: { rings?: unknown; ringOn?: unknown; gems?: unknown; necks?: unknown; neckOn?: unknown }): JewelSave {
  const rings: RingInst[] = Array.isArray(r.rings)
    ? (r.rings as RingInst[])
        .filter((x) => x && typeof x.id === "string" && RING_TIERS.includes(x.tier))
        .map((x) => {
          // Гнёзд — сколько сохранено, в пределах тира (уникальное — 1 или 2); у старых колец так и остаётся.
          const [lo, hi] = RING_ROLL.sockets[x.tier];
          const g = Array.isArray(x.gems) ? x.gems : [];
          const n = Math.max(lo, Math.min(hi, g.length || lo));
          const fav = x.fav === true ? { fav: true } : {};
          // Старое кольцо без аффиксов — раскатываем по его id: одинаково при каждой загрузке, пока не сохранили.
          const rolls = sanitizeRingRolls(x.rolls) ?? rollRingAffixes(x.tier, seededByString(x.id));
          return { id: x.id, tier: x.tier, gems: Array.from({ length: n }, (_, i) => (parseGem(g[i]) ? (g[i] as string) : null)), rolls, ...fav };
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
  const necks = (Array.isArray(r.necks) ? r.necks : []).map((x) => sanitizeNeck(x, (k) => !!parseGem(k))).filter((x): x is NeckInst => !!x);
  const neckOn = typeof r.neckOn === "string" && necks.some((x) => x.id === r.neckOn) ? r.neckOn : null;
  return { rings, ringOn, gems, necks, neckOn };
}

/** Поля записи героя для сохранения колец, камней и ожерелий — одно место для всех store.put. */
export function jewelPatch(js: JewelSave): Pick<JewelSave, "rings" | "ringOn" | "gems" | "necks" | "neckOn"> {
  return { rings: js.rings, ringOn: js.ringOn, gems: js.gems, necks: js.necks, neckOn: js.neckOn };
}

/** Новое кольцо тира: гнёзда и аффиксы — по RING_ROLL. */
export function newRing(tier: RingTier, id: string, rnd = Math.random): RingInst {
  return { id, tier, gems: Array.from({ length: rollRingSockets(tier, rnd) }, () => null), rolls: rollRingAffixes(tier, rnd) };
}

/** Сумма аффиксов надетых колец (урон умений и ульты) — сервер множит удар по условиям (ringSkillMul). */
export function ringSkillBonusOf(js: Pick<JewelSave, "rings" | "ringOn">): RingSkillBonus {
  const b = emptyRingSkillBonus();
  for (const id of js.ringOn) {
    const r = id ? js.rings.find((x) => x.id === id) : undefined;
    if (r) for (const a of r.rolls) b[a.stat] += ringRollValue(r.tier, a);
  }
  return b;
}

/** Надетое ожерелье (или null). */
export function wornNeck(js: Pick<JewelSave, "necks" | "neckOn">): NeckInst | null {
  return js.neckOn ? js.necks.find((x) => x.id === js.neckOn) ?? null : null;
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
  /** Надетое ожерелье: доли к радиусу, длительности и дальности умений (PlayerState.gb.skRad/skDur/skRng). */
  skRad: number;
  skDur: number;
  skRng: number;
}

/** Прибавка от надетых колец, ожерелья и камней в них. */
export function jewelBonus(js: Pick<JewelSave, "rings" | "ringOn" | "necks" | "neckOn">): JewelBonus {
  const nb = neckBonusOf(wornNeck(js));
  const b: JewelBonus = { str: 0, agi: 0, int: 0, con: 0, luc: 0, wis: 0, rings: 0, skRad: nb.radius, skDur: nb.duration, skRng: nb.range };
  // Камни надетого ожерелья — атрибуты, как в кольце.
  for (const k of wornNeck(js)?.gems ?? []) {
    const g = parseGem(k);
    if (g) b[g.attr] += g.lv;
  }
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
export function ringLabel(r: { tier: RingTier; gems: readonly (GemKey | null)[] }): string {
  const g = r.gems.filter(Boolean) as string[];
  return g.length ? `${ringName(r)}: ${g.map(gemName).join(", ")}` : ringName(r);
}

/** Прибавки кольца строками для подсказки: аффиксы умений, «Маг. защита 10%», «+2 Сила». */
export function ringBonusText(r: { tier: RingTier; gems: readonly (GemKey | null)[]; rolls?: readonly RingRoll[] }): string[] {
  const out = [...(r.rolls ?? []).map((x) => ringRollText(r.tier, x)), `Маг. защита ${Math.round(RING.mres * 100)}%`];
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
  | { op: "ringFav"; id: string }
  | { op: "gemIn"; id: string; idx: number; gem: GemKey }
  | { op: "gemOut"; id: string; idx: number }
  | { op: "gemMerge"; gem: GemKey }
  | { op: "gemMergeAll" }
  | { op: "gemSplit"; gem: GemKey }
  | { op: "ringScrapAll" }
  | { op: "neckOn"; id: string }
  | { op: "neckOff" }
  | { op: "neckScrap"; id: string }
  | { op: "neckFav"; id: string };

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
  const neck = (id: string): NeckInst | undefined => js.necks.find((x) => x.id === id);
  /** Кольцо или ожерелье с гнёздами (камни в них вставляются одинаково). */
  const holder = (id: string): { gems: (GemKey | null)[]; name: string } | undefined => {
    const r = ring(id);
    if (r) return { gems: r.gems, name: ringName(r) };
    const n = neck(id);
    return n ? { gems: n.gems, name: NECK_TIER_NAME[n.tier] } : undefined;
  };
  switch (o.op) {
    case "neckOn": {
      const n = neck(o.id);
      if (!n) return { ok: false, text: "Этого ожерелья уже нет." };
      js.neckOn = n.id;
      return { ok: true, text: `Надето: ${neckLabel(n)}` };
    }
    case "neckOff": {
      if (!js.neckOn) return { ok: false, text: "Ожерелье и так не надето." };
      js.neckOn = null;
      return { ok: true, text: "Ожерелье снято" };
    }
    case "neckFav": {
      const n = neck(o.id);
      if (!n) return { ok: false, text: "Этого ожерелья уже нет." };
      if (n.fav) {
        delete n.fav;
        return { ok: true, text: `Убрано из избранного: ${NECK_TIER_NAME[n.tier]}` };
      }
      n.fav = true;
      return { ok: true, text: `★ В избранном: ${NECK_TIER_NAME[n.tier]} — не разбирается` };
    }
    case "neckScrap": {
      const n = neck(o.id);
      if (!n) return { ok: false, text: "Этого ожерелья уже нет." };
      if (js.neckOn === n.id) return { ok: false, text: "Ожерелье надето — сначала сними." };
      if (n.fav) return { ok: false, text: "Ожерелье в избранном ★ — сними звёздочку, чтобы разобрать." };
      for (const k of n.gems) if (k) addGem(js, k, 1);
      js.necks = js.necks.filter((x) => x !== n);
      const got = neckScrap(n);
      return { ok: true, text: `${NECK_TIER_NAME[n.tier]} → лом +${got}${n.gems.some(Boolean) ? " (камни — в сумку)" : ""}`, scrap: got };
    }
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
    case "ringFav": {
      const r = ring(o.id);
      if (!r) return { ok: false, text: "Этого кольца уже нет." };
      if (r.fav) {
        delete r.fav;
        return { ok: true, text: `Убрано из избранного: ${ringLabel(r)}` };
      }
      r.fav = true;
      return { ok: true, text: `★ В избранном: ${ringLabel(r)} — не разбирается` };
    }
    case "ringScrap": {
      const r = ring(o.id);
      if (!r) return { ok: false, text: "Этого кольца уже нет." };
      if (js.ringOn.includes(r.id)) return { ok: false, text: "Кольцо надето — сначала сними." };
      if (r.fav) return { ok: false, text: "Кольцо в избранном ★ — сними звёздочку, чтобы разобрать." };
      // Камни из разбираемого кольца возвращаются в сумку бесплатно.
      for (const k of r.gems) if (k) addGem(js, k, 1);
      js.rings = js.rings.filter((x) => x !== r);
      const got = RING.scrap[r.tier];
      return { ok: true, text: `${ringName(r)} → лом +${got}${r.gems.some(Boolean) ? " (камни — в сумку)" : ""}`, scrap: got };
    }
    case "gemIn": {
      const r = holder(o.id);
      const g = parseGem(o.gem);
      if (!r) return { ok: false, text: "Этого украшения уже нет." };
      if (!g || !(js.gems[o.gem] > 0)) return { ok: false, text: "Такого камня в сумке нет." };
      if (!r.gems.length) return { ok: false, text: `У «${r.name}» нет гнёзд.` };
      let idx = o.idx >= 0 && o.idx < r.gems.length ? o.idx : r.gems.indexOf(null);
      if (idx < 0) return { ok: false, text: "Свободных гнёзд нет — сначала выньте камень." };
      if (r.gems[idx]) {
        idx = r.gems.indexOf(null);
        if (idx < 0) return { ok: false, text: "Гнездо занято — сначала выньте камень." };
      }
      r.gems[idx] = o.gem;
      addGem(js, o.gem, -1);
      return { ok: true, text: `${gemName(o.gem)} → ${r.name}` };
    }
    case "gemOut": {
      const r = holder(o.id);
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
      // Все кольца и ожерелья из сумки в лом; надетые, ★ избранные и рубиновые ожерелья остаются. Камни — в сумку.
      const bag = js.rings.filter((r) => !js.ringOn.includes(r.id) && !r.fav && r.tier !== "ruby");
      const bagN = js.necks.filter((n) => js.neckOn !== n.id && !n.fav && n.tier !== "ruby");
      if (!bag.length && !bagN.length) return { ok: false, text: "Украшений для разбора нет — надетые и избранные ★ не разбираются." };
      let got = 0;
      for (const r of bag) {
        for (const k of r.gems) if (k) addGem(js, k, 1);
        got += RING.scrap[r.tier];
      }
      for (const n of bagN) {
        for (const k of n.gems) if (k) addGem(js, k, 1);
        got += neckScrap(n);
      }
      js.rings = js.rings.filter((r) => !bag.includes(r));
      js.necks = js.necks.filter((n) => !bagN.includes(n));
      const what = [bag.length ? `колец ${bag.length}` : "", bagN.length ? `ожерелий ${bagN.length}` : ""].filter(Boolean).join(", ");
      return { ok: true, text: `Разобрано: ${what} → лом +${got}`, scrap: got };
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
    case "ringFav":
      return { op: "ringFav", id };
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
    case "neckOn":
      return { op: "neckOn", id };
    case "neckOff":
      return { op: "neckOff" };
    case "neckScrap":
      return { op: "neckScrap", id };
    case "neckFav":
      return { op: "neckFav", id };
  }
  return null;
}
export const JEWEL_ACTS = ["ringOn", "ringOff", "ringScrap", "ringFav", "ringScrapAll", "gemIn", "gemOut", "gemMerge", "gemMergeAll", "gemSplit", "neckOn", "neckOff", "neckScrap", "neckFav"] as const;
export type JewelAct = (typeof JEWEL_ACTS)[number];

/**
 * Что выпало с моба (или ничего): chanceMul — множитель шансов (элита/босс); level — уровень моба.
 * Золотое и уникальное кольцо × уровень (RING_LEVEL_GATE), обычное — как было.
 */
export function rollJewelDrop(chanceMul: number, ringMul = 1, level: number = RING_LEVEL_GATE.full, rnd = Math.random): { gem?: GemKey; ring?: RingTier; neck?: NeckTier } {
  const out: { gem?: GemKey; ring?: RingTier; neck?: NeckTier } = {};
  if (rnd() < RING.gemChance * chanceMul) out.gem = gemKey(GEM_ATTRS[Math.floor(rnd() * GEM_ATTRS.length)], 1);
  // Тир — доли RING.ringTierW; золотое и уникальное × уровень моба; что не досталось — пусто (предмета нет).
  const tierRoll = (): RingTier | undefined => {
    const lv = armorLevelMul(level, RING_LEVEL_GATE);
    const x = rnd();
    let edge = 0;
    for (const t of RING_TIERS) {
      edge += RING.ringTierW[t] * (t === "base" ? 1 : lv);
      if (x < edge) return t;
    }
    return undefined;
  };
  if (rnd() < RING.ringChance * chanceMul * ringMul) out.ring = tierRoll();
  // Ожерелье — свой бросок с теми же шансами и тирами, что у кольца (рубиновое — только из сундука катакомб).
  if (rnd() < RING.ringChance * chanceMul * ringMul) out.neck = tierRoll();
  return out;
}

/** Новое ожерелье тира (id — короткий случайный). */
export function newNecklace(tier: NeckTier, id: string, rnd = Math.random): NeckInst {
  return rollNecklace(tier, id, rnd);
}

/** Ожерелье для окна инвентаря: подпись, оценка, лом, строки заточки (как у брони) и камни. */
export interface PcInvNeck {
  id: string;
  tier: NeckTier;
  gems: (GemKey | null)[];
  /** Оценка — сумма очков аффиксов; rolls — сколько аффиксов (для подписи оценки). */
  pts: number;
  rolls: number;
  scrap: number;
  label: string;
  /** Аффиксы строками («Радиус умений +6.0%»). */
  affs: string[];
  stats: NeckStat[];
  ench: (EnchantInfo & { label: string })[];
  fav?: boolean;
}

export function pcInvNeck(n: NeckInst): PcInvNeck {
  const ench = n.rolls.map((_, i) => neckEnchantRow(n, i)!);
  return {
    id: n.id, tier: n.tier, gems: [...n.gems], pts: neckQuality(n), rolls: n.rolls.length, scrap: neckScrap(n),
    label: neckLabel(n), affs: ench.map((e) => e.label), stats: n.rolls.map((r) => r.stat), ench, ...(n.fav ? { fav: true } : {}),
  };
}

/** Кольцо для окна инвентаря: гнёзда, лом, аффиксы с заточкой (как у ожерелья). */
export interface PcInvRing {
  id: string;
  tier: RingTier;
  gems: (GemKey | null)[];
  scrap: number;
  fav?: boolean;
  /** Аффиксы: оценка (сумма очков), их число, строки и заточка. */
  pts: number;
  nRolls: number;
  rolls: RingRoll[];
  affs: string[];
  ench: (EnchantInfo & { label: string })[];
}

export function pcInvRing(r: RingInst): PcInvRing {
  const ench = r.rolls.map((_, i) => ringEnchantRow(r, i)!);
  return {
    id: r.id, tier: r.tier, gems: [...r.gems], scrap: RING.scrap[r.tier], ...(r.fav ? { fav: true } : {}),
    pts: ringQuality(r), nRolls: r.rolls.length, rolls: r.rolls.map((x) => ({ stat: x.stat, pts: x.pts })), affs: ench.map((e) => e.label), ench,
  };
}

/** Данные колец, ожерелий и камней для окна инвентаря (ПК/телефон, страница !inv, VR). */
export interface PcInvJewels {
  rings: PcInvRing[];
  ringOn: [string | null, string | null];
  necks: PcInvNeck[];
  neckOn: string | null;
  /** Камни в сумке: [ключ, сколько], по атрибуту и уровню. */
  gems: [GemKey, number][];
}
export function pcInvJewels(js: JewelSave): PcInvJewels {
  const gems = Object.entries(js.gems).sort((a, b) => {
    const ga = parseGem(a[0])!;
    const gb = parseGem(b[0])!;
    return GEM_ATTRS.indexOf(ga.attr) - GEM_ATTRS.indexOf(gb.attr) || gb.lv - ga.lv;
  });
  return {
    rings: js.rings.map(pcInvRing),
    ringOn: [...js.ringOn],
    necks: js.necks.map(pcInvNeck),
    neckOn: js.neckOn,
    gems,
  };
}

/** Прибавка по данным окна инвентаря (клиент): то же, что jewelBonus по записи. */
export function pcJewelBonus(j: PcInvJewels | undefined): JewelBonus {
  // Ожерелье из вида окна: аффиксы — по stats и очкам строк заточки.
  const necks: NeckInst[] = (j?.necks ?? []).map((n) => ({ id: n.id, tier: n.tier, gems: n.gems, rolls: n.stats.map((stat, i) => ({ stat, pts: n.ench[i]?.points ?? 1 })) }));
  return jewelBonus({ rings: j?.rings ?? [], ringOn: j?.ringOn ?? [null, null], necks, neckOn: j?.neckOn ?? null });
}
