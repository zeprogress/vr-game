/**
 * Слоты снаряжения — «кукла» персонажа в инвентаре.
 *
 * Задел на будущее: руки уже живые (оружие и щит держатся физически, класс
 * и тир приезжают из CombatSystem), броня пока НЕ реализована — её слоты
 * рисуются пустыми, чтобы место под неё было видно заранее и панель не
 * пришлось перекраивать, когда броня появится.
 */
export type EquipSlot =
  | "rightHand"
  | "leftHand"
  | "head"
  | "body"
  | "hands"
  | "feet"
  | "ring1"
  | "ring2";

export interface EquipSlotDef {
  id: EquipSlot;
  /** Подпись в пустой ячейке. */
  label: string;
  /** Что сюда кладут — в подсказке. */
  hint: string;
  /** Руки работают уже сейчас; остальное — заготовка. */
  live: boolean;
}

/** Порядок = порядок в сетке 4×2: сперва руки, затем броня, в конце кольца. */
export const EQUIP_SLOTS: readonly EquipSlotDef[] = [
  { id: "rightHand", label: "прав. рука", hint: "оружие или щит", live: true },
  { id: "leftHand", label: "лев. рука", hint: "оружие или щит", live: true },
  { id: "head", label: "шлем", hint: "броня на голову", live: false },
  { id: "body", label: "тело", hint: "нагрудник", live: false },
  { id: "hands", label: "перчатки", hint: "броня на руки", live: false },
  { id: "feet", label: "ботинки", hint: "броня на ноги", live: false },
  { id: "ring1", label: "кольцо", hint: "украшение", live: false },
  { id: "ring2", label: "кольцо", hint: "украшение", live: false },
] as const;
