/**
 * Огранка: применение рун к граням предмета. Правила — shared/runes.ts.
 *
 * Грань = ролл предмета (у оружия — RolledAffix, у брони — ArmorRoll). Руна задаёт ЕГО вид
 * и силу: «вид:сила» → очки ролла (runePts). Ставится только в пустое гнездо; вынуть
 * можно за лом (грань исчезает, руна возвращается в сумку).
 */
import { AFFIX_ORDER, POINTS_MAX, affixAtPoints, affixPoints, rollableSubs, sortAffixes, type AffixSub, type WeaponInstance } from "#shared/items";
import { ARMOR_POINTS_MAX, armorPool, type ArmorInstance } from "#shared/armor";
import { parseRuneKey, rollRune, runePts, runeRemoveCost, runeSlots, type RuneStock } from "#shared/runes";

export type RuneItem = WeaponInstance | ArmorInstance;

export function isWeapon(x: RuneItem): x is WeaponInstance {
  return Array.isArray((x as WeaponInstance).affixes);
}

export function slotsOf(x: RuneItem): number {
  return runeSlots(x.tier);
}

export function gradeCount(x: RuneItem): number {
  return isWeapon(x) ? x.affixes.length : x.rolls.length;
}

/** Свободное гнездо: true, если гнёзд по грейду больше, чем граней. */
export function hasFreeSlot(x: RuneItem): boolean {
  return gradeCount(x) < slotsOf(x);
}

/** Пулы видов граней предмета (для проверки «а такая руна вообще сюда годится»). */
function poolOf(x: RuneItem): readonly string[] {
  return isWeapon(x) ? rollableSubs(x.cls) : armorPool(x.part, x.tier);
}

/**
 * Вставить руну `key` в предмет. Возвращает ошибку текстом или null при успехе.
 * Склад рун НЕ меняется — это делает вызывающий (списывает руну).
 */
export function insertRune(x: RuneItem, key: string, rnd: () => number = Math.random): string | null {
  const parsed = parseRuneKey(key);
  if (!parsed) return "Такой руны нет.";
  if (!poolOf(x).includes(parsed.sub)) return "Эта руна сюда не встаёт.";
  if (!hasFreeSlot(x)) return "Свободных гнёзд нет — сначала вынь грань.";
  const pts = runePts(parsed.power);
  if (isWeapon(x)) {
    // Грань того же вида уже стоит: руну можно поставить только СИЛЬНЕЕ (повышает очки).
    const same = x.affixes.find((a) => a.sub === parsed.sub);
    if (same) {
      if (affixPoints(same, x) >= pts) return "Такая грань уже не слабее.";
      x.affixes[x.affixes.indexOf(same)] = affixAtPoints(parsed.sub, Math.min(POINTS_MAX, pts), same.cap ?? 1, x.cls);
      return null;
    }
    const a = affixAtPoints(parsed.sub, Math.min(POINTS_MAX, pts), 1, x.cls);
    x.affixes.push(a);
    sortAffixes(x.affixes);
  } else {
    const same = x.rolls.find((r) => r.stat === parsed.sub);
    if (same) {
      if (same.pts >= pts) return "Такая грань уже не слабее.";
      same.pts = Math.min(ARMOR_POINTS_MAX, pts);
      return null;
    }
    x.rolls.push({ stat: parsed.sub as ArmorRollStat, pts: Math.min(ARMOR_POINTS_MAX, pts) });
    x.rolls.sort((a, b) => AFFIX_ORDER.indexOf(a.stat as AffixSub) - AFFIX_ORDER.indexOf(b.stat as AffixSub));
  }
  void rnd;
  return null;
}

type ArmorRollStat = ArmorInstance["rolls"][number]["stat"];

/**
 * Вынуть грань `idx`: она исчезает из предмета, а руна возвращается в сумку.
 * Цена в ломе — runeRemoveCost(тир). Возвращает [ключ руны, ошибку] — одно из двух.
 */
export function removeRune(x: RuneItem, idx: number): { key?: string; err?: string } {
  if (isWeapon(x)) {
    const a = x.affixes[idx];
    if (!a) return { err: "Такой грани нет." };
    const key = runeKeyOf(a.sub, affixPoints(a, x));
    x.affixes.splice(idx, 1);
    return { key };
  }
  const r = x.rolls[idx];
  if (!r) return { err: "Такой грани нет." };
  const key = runeKeyOf(r.stat, r.pts);
  x.rolls.splice(idx, 1);
  return { key };
}

/** Ключ руны, соответствующей грани с `pts` очками (ближайшая сила). */
export function runeKeyOf(sub: string, pts: number): string {
  const power = pts <= 10 ? 1 : pts <= 16 ? 2 : pts <= 23 ? 3 : pts <= 29 ? 4 : 5;
  return `${sub}:${power}`;
}

/** Слияние рун: две одинаковые силы n → одна n+1. Возвращает новый склад или ошибку. */
export function mergeRunes(stock: RuneStock, key: string): { stock?: RuneStock; key?: string; err?: string } {
  const parsed = parseRuneKey(key);
  if (!parsed) return { err: "Такой руны нет." };
  if (parsed.power >= 5) return { err: "Совершеннее быть не может." };
  if ((stock[key] ?? 0) < 2) return { err: "Нужны две такие руны." };
  const next = `${parsed.sub}:${parsed.power + 1}`;
  const out: RuneStock = { ...stock };
  out[key] = (out[key] ?? 0) - 2;
  if (out[key] <= 0) delete out[key];
  out[next] = (out[next] ?? 0) + 1;
  return { stock: out, key: next };
}

export { runeRemoveCost };

/** Случайная руна с дропа: вид — из пула класса (см. shared/runes.ts rollRune). */
export function randomRune(cls: WeaponInstance["cls"], kind: "regular" | "elite" | "champ" | "boss", rnd: () => number = Math.random): { sub: AffixSub; power: number } {
  const pool = rollableSubs(cls);
  const sub = pool[Math.floor(rnd() * pool.length)];
  return rollRune(sub, kind, rnd);
}
