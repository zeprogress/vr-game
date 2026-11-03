/**
 * Перековка (2026-11-04): полировка за лом, валюты (Грань, Эссенция, Знамение), трещины
 * и история предмета. Правила и числа — в shared/nature.ts и shared/items.ts.
 *
 * Работает и с оружием, и с бронёй: общий вид предмета (tier, cracks, rh, rolls/affixes)
 * приводим к внутреннему `ReforgeTarget`.
 */
import {
  CRACK_MAX,
  REFORGE_MIN_ROLLS,
  emptyHistory,
  historyBonus,
  polishChance,
  polishCost,
  polishMul,
  type ReforgeHistory,
  type ReforgeMode,
} from "#shared/nature";
import {
  AFFIX_ORDER,
  POINTS_MAX,
  affixAtPoints,
  affixPoints,
  rollableSubs,
  sortAffixes,
  type AffixSub,
  type WeaponInstance,
} from "#shared/items";
import { ARMOR_POINTS_MAX, armorPool, type ArmorInstance, type ArmorRoll } from "#shared/armor";

export type ReforgeItem = WeaponInstance | ArmorInstance;

export function isWeaponItem(x: ReforgeItem): x is WeaponInstance {
  return Array.isArray((x as WeaponInstance).affixes);
}

export interface ReforgeOutcome {
  ok: boolean;
  text: string;
  /** Удача (true) или неудача — окно красит красным. */
  up?: boolean;
}

function tierOf(x: ReforgeItem): string {
  return x.tier;
}

/** Очки граней по порядку. */
function pointsOf(x: ReforgeItem): number[] {
  return isWeaponItem(x) ? x.affixes.map((a) => affixPoints(a, x)) : x.rolls.map((r) => r.pts);
}

function setPoints(x: ReforgeItem, idx: number, pts: number): void {
  if (isWeaponItem(x)) {
    const a = x.affixes[idx];
    if (!a) return;
    const p = Math.max(1, Math.min(POINTS_MAX, Math.round(pts)));
    a.value = affixAtPoints(a.sub, p, a.cap ?? 1, x.cls).value;
  } else {
    const r = x.rolls[idx];
    if (r) r.pts = Math.max(1, Math.min(ARMOR_POINTS_MAX, Math.round(pts)));
  }
}

function histOf(x: ReforgeItem): ReforgeHistory {
  return x.rh ? { ...emptyHistory(), ...x.rh } : emptyHistory();
}

function cracksOf(x: ReforgeItem): number {
  return Math.max(0, Math.min(CRACK_MAX, Math.floor(x.cracks ?? 0)));
}

/** Строка вида для эссенции (какой вид грани поставить). */
export function reforgeKinds(x: ReforgeItem): AffixSub[] {
  return isWeaponItem(x) ? rollableSubs(x.cls) : [];
}

/**
 * Полировка: перекатывает очки ВСЕХ граней. Возвращает множитель и пишет историю.
 * Провал — значения вниз, но не ниже 1; выше потолка не поднимаем.
 */
export function polishItem(x: ReforgeItem, rnd: () => number = Math.random): { up: boolean; mul: number } {
  const h = histOf(x);
  const cracks = cracksOf(x);
  const chance = polishChance(cracks, x.nat);
  const up = rnd() < chance;
  const mul = up ? 1 + polishMul(rnd) * 0.5 : 0.75 + rnd() * 0.2;
  const cap = Math.min(1, historyBonus(h).cap);
  if (cracks < CRACK_MAX) {
    for (let i = 0; i < pointsOf(x).length; i++) {
      const p0 = pointsOf(x)[i];
      const next = Math.min(POINTS_MAX, Math.max(1, Math.round(p0 * mul * cap)));
      setPoints(x, i, next);
    }
  }
  // Вторая трещина: при полировке одна случайная грань теряет очко.
  if (cracks === 2) {
    const n = pointsOf(x).length;
    if (n > 0) {
      const i = Math.floor(rnd() * n);
      setPoints(x, i, Math.max(1, pointsOf(x)[i] - 1));
    }
  }
  h.pol++;
  if (up) h.up++;
  x.rh = h;
  return { up, mul };
}

/** Замена грани `idx` на случайную из пула (Грань). История: +1 замена. */
export function brandItem(x: ReforgeItem, idx: number, rnd: () => number = Math.random): { ok: boolean; text: string } {
  if (isWeaponItem(x)) {
    const cur = x.affixes[idx];
    if (!cur) return { ok: false, text: "Такой грани нет." };
    const used = new Set(x.affixes.map((a) => a.sub));
    const pool = rollableSubs(x.cls).filter((s) => !used.has(s) && s !== cur.sub);
    if (pool.length === 0) return { ok: false, text: "Менять не на что: в пуле предмета кончились виды граней." };
    const sub = pool[Math.floor(rnd() * pool.length)];
    x.affixes[idx] = affixAtPoints(sub, affixPoints(cur, x), cur.cap ?? 1, x.cls);
    sortAffixes(x.affixes);
  } else {
    const cur = x.rolls[idx];
    if (!cur) return { ok: false, text: "Такой грани нет." };
    const used = new Set(x.rolls.map((r) => r.stat));
    const pool = armorPool(x.part, x.tier).filter((s) => !used.has(s) && s !== cur.stat);
    if (pool.length === 0) return { ok: false, text: "Менять не на что: в пуле части кончились виды граней." };
    const stat = pool[Math.floor(rnd() * pool.length)];
    x.rolls[idx] = { ...cur, stat };
    x.rolls.sort((a, b) => AFFIX_ORDER.indexOf(a.stat as AffixSub) - AFFIX_ORDER.indexOf(b.stat as AffixSub));
  }
  const h = histOf(x);
  h.swaps++;
  x.rh = h;
  return { ok: true, text: "Грань заменена." };
}

/**
 * Эссенция: выбранная грань становится нужного вида; одна другая случайная меняет вид;
 * снимает одну трещину, если лечить есть что. История: +1 замена, +1 лечение.
 */
export function essenceItem(x: ReforgeItem, idx: number, kind: string, rnd: () => number = Math.random): { ok: boolean; text: string } {
  const h = histOf(x);
  if (isWeaponItem(x)) {
    const cur = x.affixes[idx];
    if (!cur) return { ok: false, text: "Такой грани нет." };
    const sub = kind as AffixSub;
    if (!rollableSubs(x.cls).includes(sub)) return { ok: false, text: "Такая грань у этого класса не бывает." };
    x.affixes[idx] = affixAtPoints(sub, affixPoints(cur, x), cur.cap ?? 1, x.cls);
    // Заражение: одна другая грань меняет вид случайно.
    const others = x.affixes.map((a, i) => ({ a, i })).filter((o) => o.i !== idx);
    if (others.length > 0) {
      const o = others[Math.floor(rnd() * others.length)];
      const pool = rollableSubs(x.cls).filter((s) => s !== sub);
      if (pool.length > 0) {
        const ns = pool[Math.floor(rnd() * pool.length)];
        x.affixes[o.i] = affixAtPoints(ns, affixPoints(o.a, x), o.a.cap ?? 1, x.cls);
      }
    }
    sortAffixes(x.affixes);
  } else {
    const cur = x.rolls[idx];
    if (!cur) return { ok: false, text: "Такой грани нет." };
    const stat = kind as ArmorRoll["stat"];
    if (!armorPool(x.part, x.tier).includes(stat)) return { ok: false, text: "У этой части такой грани не бывает." };
    x.rolls[idx] = { ...cur, stat };
    const others = x.rolls.map((r, i) => ({ r, i })).filter((o) => o.i !== idx);
    if (others.length > 0) {
      const o = others[Math.floor(rnd() * others.length)];
      const pool = armorPool(x.part, x.tier).filter((s) => s !== stat);
      if (pool.length > 0) x.rolls[o.i] = { ...o.r, stat: pool[Math.floor(rnd() * pool.length)] };
    }
    x.rolls.sort((a, b) => AFFIX_ORDER.indexOf(a.stat as AffixSub) - AFFIX_ORDER.indexOf(b.stat as AffixSub));
  }
  h.swaps++;
  // Лечение: одна трещина за эссенцию.
  let healed = false;
  if (cracksOf(x) > 0) {
    x.cracks = cracksOf(x) - 1;
    h.healed++;
    healed = true;
  }
  x.rh = h;
  return { ok: true, text: healed ? "Грань поставлена · трещина залечена." : "Грань поставлена (заражение: ещё одна грань сменилась)." };
}

/** Раскол (Знамение): стирает выбранную грань; ниже минимума грейда — +1 трещина. */
export function omenItem(x: ReforgeItem, idx: number): { ok: boolean; text: string } {
  const count = isWeaponItem(x) ? x.affixes.length : x.rolls.length;
  const min = REFORGE_MIN_ROLLS[tierOf(x)] ?? 1;
  if (count <= 1) return { ok: false, text: "Последнюю грань расколоть нельзя." };
  if (isWeaponItem(x)) x.affixes.splice(idx, 1);
  else x.rolls.splice(idx, 1);
  let cracked = false;
  if (count - 1 < min) {
    x.cracks = Math.min(CRACK_MAX, cracksOf(x) + 1);
    cracked = true;
  }
  const h = histOf(x);
  h.swaps++;
  x.rh = h;
  return { ok: true, text: cracked ? `Грань расколота · трещина ${cracksOf(x)}/3` : "Грань расколота." };
}

/** Цена действия валютой (штук). */
export function reforgePrice(mode: ReforgeMode): number {
  return mode === "polish" || mode === "heal" ? 0 : 1;
}

export { polishCost, polishChance, cracksOf };
