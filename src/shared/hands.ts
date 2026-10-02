import { bothHandsCls, DUAL_WIELD, type WeaponClass } from "./items";

/**
 * Правила рук — ОДНО место для сервера (боты, !equip, страница !inv) и клиента.
 *
 *  - Двуручное (лук, копьё, молот) занимает обе руки: со вторым предметом не сочетается.
 *  - Щит — во второй руке с любым одноручным (меч, кинжал, посох).
 *  - Два одинаковых одноручных — только парные (DUAL_WIELD: меч, кинжал).
 *  - Разные виды одноручного вместе не носят (меч + кинжал, меч + посох…).
 *  - Вторая рука у одноручного может быть пустой: щит сам НЕ надевается.
 *  - Основное оружие — в правой руке; щит — в левой.
 *
 * Состояние рук — строки как в PlayerState (пусто — рука пустая). Двуручное
 * пишется в правую (левая пустая); клиент шлёт его в обеих — это то же самое.
 */
export type Side = "left" | "right";

export interface HandsState {
  rightCls: string;
  rightTier: string;
  leftCls: string;
  leftTier: string;
}

/** Оружие, которое держат обе руки (список — items.bothHandsCls: лук, копьё, молот). */
export function isTwoHanded(cls: string | null | undefined): boolean {
  return bothHandsCls(cls ?? undefined);
}

/** Можно ли держать эти два предмета одновременно (по одному в руке). Пусто — всегда можно. */
export function canHoldTogether(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  if (isTwoHanded(a) || isTwoHanded(b)) return false;
  if (a === "shield" && b === "shield") return false;
  if (a === "shield" || b === "shield") return true;
  return a === b && !!DUAL_WIELD[a as WeaponClass];
}

/** Руки допустимы? (двуручное, записанное в обе руки, — допустимо). */
export function handsValid(h: HandsState): boolean {
  if (h.leftCls && h.leftCls === h.rightCls && isTwoHanded(h.leftCls)) return true;
  return canHoldTogether(h.leftCls, h.rightCls);
}

/** Есть ли в руках оружие для атаки (не щит). */
export function hasAttackWeapon(h: HandsState): boolean {
  return (!!h.rightCls && h.rightCls !== "shield") || (!!h.leftCls && h.leftCls !== "shield");
}

function setHand(h: HandsState, s: Side, cls: string, tier: string): void {
  if (s === "left") {
    h.leftCls = cls;
    h.leftTier = tier;
  } else {
    h.rightCls = cls;
    h.rightTier = tier;
  }
}
const clsOf = (h: HandsState, s: Side): string => (s === "left" ? h.leftCls : h.rightCls);

/** Привести к виду «оружие — в правой, щит — в левой» (одно оружие в левой переезжает в правую). */
export function normalizeHands(h: HandsState): void {
  if (!h.rightCls && h.leftCls && h.leftCls !== "shield") {
    setHand(h, "right", h.leftCls, h.leftTier);
    setHand(h, "left", "", "");
  }
  if (h.rightCls === "shield" && !h.leftCls) {
    setHand(h, "left", "shield", h.rightTier);
    setHand(h, "right", "", "");
  }
  if (h.leftCls && h.leftCls === h.rightCls && isTwoHanded(h.leftCls)) setHand(h, "left", "", "");
}

/**
 * Надеть предмет. `side` — куда просили (учитывается для второго меча/кинжала
 * к такому же в правой). Меняет `h`; возвращает руки, из которых что-то
 * пришлось убрать (их прежние предметы — на склад).
 */
export function equipHands(h: HandsState, cls: string, tier: string, side: Side = "right"): Side[] {
  const removed = new Set<Side>();
  const drop = (s: Side): void => {
    if (clsOf(h, s)) removed.add(s);
    setHand(h, s, "", "");
  };
  // Двуручное в руках уходит целиком — что бы ни надевали.
  if (isTwoHanded(h.rightCls) || isTwoHanded(h.leftCls)) {
    drop("left");
    drop("right");
  }
  if (isTwoHanded(cls)) {
    drop("left");
    drop("right");
    setHand(h, "right", cls, tier);
  } else if (cls === "shield") {
    if (h.rightCls === "shield") drop("right");
    drop("left");
    setHand(h, "left", cls, tier);
  } else if (side === "left" && h.rightCls === cls && DUAL_WIELD[cls as WeaponClass]) {
    // Второй меч/кинжал — в левую к такому же в правой.
    drop("left");
    setHand(h, "left", cls, tier);
  } else {
    drop("right");
    setHand(h, "right", cls, tier);
    if (!canHoldTogether(cls, h.leftCls)) drop("left");
  }
  normalizeHands(h);
  return [...removed];
}

/**
 * Снять предмет с руки `side` (на склад). Без оружия героя не оставляем —
 * тогда текст отказа; иначе null. Второе оружие переезжает в правую руку.
 */
export function unequipHand(h: HandsState, side: Side): string | null {
  const two = isTwoHanded(h.rightCls) || isTwoHanded(h.leftCls);
  if (!clsOf(h, side) && !two) return "В этой руке пусто.";
  const next: HandsState = { ...h };
  if (two) {
    setHand(next, "left", "", "");
    setHand(next, "right", "", "");
  } else setHand(next, side, "", "");
  normalizeHands(next);
  if (!hasAttackWeapon(next)) return "Без оружия героя не оставить — сначала надень другое.";
  Object.assign(h, next);
  return null;
}
