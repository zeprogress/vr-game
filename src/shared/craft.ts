/**
 * Крафт оружия (2026-10-19). Единый источник: материалы, катализаторы, методы, исходы, скрытые
 * рецепты, шансы и сборка оружия. Сервер (ZoneRoom.craftAct) и все окна (ПК, телефон, !inv, VR)
 * берут числа и подписи отсюда.
 *
 * Крафт = ОСНОВА (класс оружия) + 1–3 МАТЕРИАЛА + КАТАЛИЗАТОР (необязательно) + МЕТОД.
 *  - Материал задаёт ролл: разные материалы — разные роллы, одинаковые — тот же ролл выше по очкам.
 *  - Катализатор возвращается. Камень любого вида улучшает шансы (сильнее с уровнем); особый
 *    катализатор (Ледяное сердце, Ядовитое жало) даёт особый ролл, которого у обычного оружия нет.
 *  - Метод — лом и характер: ковка надёжна, закалка поднимает роллы, резьба добавляет ролл,
 *    выдержка рискованна, но чаще даёт отличный и редкий исход.
 *  - Исход случаен: провал / обычный / хороший / отличный / редкий. Сила: обычный — как уникальное,
 *    редкий — ×1.38 (≈ рубиновое + 20%), плюс заточка как у всего оружия.
 *  - Скрытые рецепты — точные сочетания, их находят только опытом: именное оружие, исход не ниже
 *    хорошего и один ролл сверх предела. Найденный рецепт записывается в книгу героя.
 *  - Мастерство кузнеца — долгая прогрессия: опыт за каждый крафт, с уровнем лучше шансы и
 *    открываются методы (сначала только ковка). Так начать просто, а расти — долго.
 *
 * Результат — мастерское оружие (тир `craft`, тёмно-оранжевое): обычный экземпляр со своими роллами,
 * точится, передаётся и разбирается как остальное оружие.
 */
import { ATTACK_CLASSES, CRAFT_RARE_POW, affixAtPoints, affixOverCap, AFFIX_NAME, isMeleeClass, LOOT_VER, POINTS_MAX, rollableSubs, shortId, sortAffixes, WEAPON_NOUN, type AffixSub, type RolledAffix, type WeaponClass, type WeaponInstance } from "./items";
import { GEM_LOOK, parseGem, type GemAttr } from "./jewels";

// ---------------------------------------------------------------- материалы и катализаторы

export type CraftMatId = "alloy" | "web" | "scale" | "bone";
export type CraftCatId = "frost" | "sting";
export type CraftItemId = CraftMatId | CraftCatId;

export interface CraftItemDef {
  name: string;
  /** mat — тратится; cat — особый катализатор, возвращается. */
  kind: "mat" | "cat";
  /** Откуда берётся — подпись в окне крафта. */
  src: string;
  /** Цвет подписи и значка. */
  color: string;
}

export const CRAFT_ITEMS: Record<CraftItemId, CraftItemDef> = {
  alloy: { name: "Сплав", kind: "mat", src: `переплавка лома в окне крафта`, color: "#c9ced6" },
  web: { name: "Паутина", kind: "mat", src: "пауки подземелья", color: "#e8eef5" },
  scale: { name: "Чешуя дракона", kind: "mat", src: "драконы: Огнекрылый (охота), Владыка Бездны (катакомбы)", color: "#ff7a3d" },
  bone: { name: "Кость", kind: "mat", src: "костяные мобы: жнец, призрак, вождь", color: "#efe3c4" },
  frost: { name: "Ледяное сердце", kind: "cat", src: "Ледяной демон (редко)", color: "#7fd8ff" },
  sting: { name: "Ядовитое жало", kind: "cat", src: "пауки подземелья (редко)", color: "#8cf05a" },
};
export const CRAFT_MATS: readonly CraftMatId[] = ["alloy", "web", "scale", "bone"];
export const CRAFT_CATS: readonly CraftCatId[] = ["frost", "sting"];

export function isCraftItem(v: unknown): v is CraftItemId {
  return typeof v === "string" && v in CRAFT_ITEMS;
}

/** Переплавка: столько лома → один сплав. */
export const CRAFT_SMELT = 100;

/** Особый ролл катализатора. */
const CAT_ROLL: Record<CraftCatId, AffixSub> = { frost: "chill", sting: "venom" };

/**
 * Ролл материала на оружии класса `cls`. Кость — вампиризм в ближнем бою; у лука — пронзание
 * (костяной наконечник), у посоха — поджог.
 */
export function matRoll(m: CraftMatId, cls: WeaponClass): AffixSub {
  switch (m) {
    case "alloy":
      return "dmgFlat";
    case "web":
      return "atkSpeedPct";
    case "scale":
      return "critChance";
    case "bone":
      return isMeleeClass(cls) ? "vamp" : cls === "bow" ? "pierce" : "ignite";
  }
}

/** Что даёт особый ролл в бою (сервер — ZoneRoom.craftProc). */
export const CRAFT_PROC = {
  /** Холод: замедление цели на sec с, скорость и темп × mul. */
  chill: { sec: 2, mul: 0.65 },
  /** Яд: стак яда (правила «Чумного клинка»: стаки и взрыв) — урон в секунду за стак = доля удара. */
  venom: { tickFrac: 0.12, burstFrac: 0.6 },
} as const;

// ---------------------------------------------------------------- методы и исходы

export type CraftMethodId = "forge" | "temper" | "carve" | "age";

export interface CraftMethodDef {
  name: string;
  /** С какого уровня мастерства кузнеца открыт. */
  lv: number;
  /** Одна строка: чем метод отличается. */
  note: string;
  /** Цена в ломе. */
  cost: number;
  /** Веса исходов: провал, обычный, хороший, отличный, редкий (сумма 100). */
  odds: readonly [number, number, number, number, number];
  /** Прибавка к нижней границе очков всех роллов. */
  floorAdd: number;
  /** Сколько роллов сверх исхода (до 4). */
  rollAdd: number;
}

export const CRAFT_METHODS: Record<CraftMethodId, CraftMethodDef> = {
  forge: { name: "Ковка", lv: 1, note: "надёжно: провал редко, но и редкий исход реже", cost: 150, odds: [5, 50, 30, 12, 3], floorAdd: 0, rollAdd: 0 },
  temper: { name: "Закалка", lv: 3, note: "роллы крепче: +6 очков к каждому", cost: 250, odds: [15, 40, 25, 14, 6], floorAdd: 6, rollAdd: 0 },
  carve: { name: "Резьба", lv: 5, note: "тоньше: +1 ролл к исходу (до 4)", cost: 250, odds: [15, 40, 25, 14, 6], floorAdd: 0, rollAdd: 1 },
  age: { name: "Выдержка", lv: 8, note: "риск: провал чаще, отличный и редкий — вдвое чаще", cost: 400, odds: [25, 25, 22, 18, 10], floorAdd: 0, rollAdd: 0 },
};
export const CRAFT_METHOD_IDS: readonly CraftMethodId[] = ["forge", "temper", "carve", "age"];

export function isCraftMethod(v: unknown): v is CraftMethodId {
  return typeof v === "string" && v in CRAFT_METHODS;
}

export interface CraftOutcomeDef {
  name: string;
  /** Роллов у оружия (без метода «Резьба»). */
  rolls: number;
  /** «Мастерство»: прибавка к урону (сила уникального × (1 + pow)). */
  pow: number;
  /** Нижняя граница очков роллов (1..33). */
  floor: number;
  /** Цвет подписи исхода. */
  color: string;
}

/** Исходы по порядку: 0 — провал. Сила: обычный = уникальное, хороший ≈ рубиновое, редкий ≈ рубиновое + 20%. */
export const CRAFT_OUTCOMES: readonly CraftOutcomeDef[] = [
  { name: "Провал", rolls: 0, pow: 0, floor: 0, color: "#ff6b6b" },
  { name: "Обычный", rolls: 2, pow: 0, floor: 1, color: "#e6e0d0" },
  { name: "Хороший", rolls: 3, pow: 0.15, floor: 6, color: "#7fe08a" },
  { name: "Отличный", rolls: 3, pow: 0.25, floor: 12, color: "#6fc3ff" },
  { name: "Редкий", rolls: 4, pow: CRAFT_RARE_POW, floor: 18, color: "#ffb347" },
];

export const CRAFT = {
  /** Материалов в одном крафте. */
  maxMats: 3,
  /** Роллов у оружия — не больше. */
  maxRolls: 4,
  /** Каждая копия материала сверх первой — к нижней границе очков его ролла. */
  copyFloor: 8,
  /** Камень-катализатор: уровни сверх этого шансы не улучшают. */
  gemLvCap: 5,
  /** Камень за уровень: −2 к провалу, +1 к отличному, +1 к редкому (веса до нормировки). */
  gemFail: 2,
  gemUp: 1,
  /** Провал: возвращается эта доля лома метода (материалы пропадают, катализатор цел). */
  failRefund: 0.5,
  /** Скрытый рецепт: ролл-звезда — максимум вида × это. */
  starMul: 1.5,
} as const;

// ---------------------------------------------------------------- мастерство кузнеца

export const SMITH = {
  maxLv: 20,
  /** Опыта до следующего уровня: base + step × (ур. − 1). */
  base: 4,
  step: 2,
  /** Опыт за крафт: 1 + индекс исхода (провал 1 … редкий 5); найденный рецепт — ещё столько. */
  foundXp: 10,
  /** За каждый уровень сверх первого: провал −fail, отличный +great, редкий +rare (веса до нормировки). */
  fail: 0.5,
  great: 0.3,
  rare: 0.2,
} as const;

/** Уровень кузнеца по опыту и сколько набрано/нужно до следующего. */
export function smithLevel(xp: number): { lv: number; have: number; need: number; maxed: boolean } {
  let lv = 1;
  let left = Math.max(0, Math.floor(xp));
  for (;;) {
    if (lv >= SMITH.maxLv) return { lv, have: 0, need: 0, maxed: true };
    const need = SMITH.base + SMITH.step * (lv - 1);
    if (left < need) return { lv, have: left, need, maxed: false };
    left -= need;
    lv++;
  }
}

/** Опыт кузнеца за один крафт. */
export function smithXpFor(outcome: number, found: boolean): number {
  return 1 + Math.max(0, outcome) + (found ? SMITH.foundXp : 0);
}

// ---------------------------------------------------------------- скрытые рецепты

/** Катализатор: особый (frost/sting) или камень вида (gem:luc — любого уровня). */
export type CraftCatKey = CraftCatId | `gem:${GemAttr}`;

export interface CraftRecipe {
  id: string;
  name: string;
  cls: WeaponClass;
  /** Материалы — точный набор (порядок не важен). */
  mats: readonly CraftMatId[];
  cat: CraftCatKey | null;
  method: CraftMethodId;
  /** Ролл «сверх предела» — CRAFT.starMul от максимума вида. */
  star: AffixSub;
  /** Строчка-описание под оружием (карточка крафта). */
  lore: string;
}

export const CRAFT_RECIPES: readonly CraftRecipe[] = [
  { id: "webweaver", name: "Ткач паутины", cls: "bow", mats: ["web", "web", "bone"], cat: "sting", method: "temper", star: "atkSpeedPct", lore: "Тетива из паучьего шёлка поёт быстрее ветра." },
  { id: "frostguard", name: "Ледяной страж", cls: "hammer", mats: ["bone", "bone", "alloy"], cat: "frost", method: "age", star: "vamp", lore: "Холод сковывает врага, а сила его уходит к владельцу." },
  { id: "dragonblood", name: "Кровь дракона", cls: "dagger", mats: ["scale", "scale", "scale"], cat: "gem:luc", method: "temper", star: "critChance", lore: "Клинок из чешуи помнит, куда бить." },
  { id: "ashstaff", name: "Посох пепла", cls: "staff", mats: ["bone", "bone", "scale"], cat: "gem:int", method: "carve", star: "critChance", lore: "Кость и пламя: каждый огнешар — как удар грома." },
  { id: "stormfang", name: "Клык бури", cls: "spear", mats: ["web", "scale", "alloy"], cat: null, method: "forge", star: "dmgFlat", lore: "Наконечник, что пробивает ряды насквозь." },
  { id: "crusher", name: "Сокрушитель", cls: "sword", mats: ["alloy", "alloy", "alloy"], cat: "gem:str", method: "forge", star: "dmgFlat", lore: "Простая сталь в руке силы — тяжелее любого молота." },
];

/** Полный состав рецепта (для найденных). */
export function recipeText(r: CraftRecipe): string {
  const mats = groupMats(r.mats).map(([m, n]) => (n > 1 ? `${CRAFT_ITEMS[m].name} ×${n}` : CRAFT_ITEMS[m].name)).join(" + ");
  const cat = r.cat === null ? "" : ` + ${catName(r.cat)}`;
  return `${WEAPON_NOUN[r.cls].name} + ${mats}${cat} · ${CRAFT_METHODS[r.method].name} · ★ ${AFFIX_NAME[r.star]} сверх предела`;
}

function catName(k: CraftCatKey): string {
  if (k.startsWith("gem:")) return `${GEM_LOOK[k.slice(4) as GemAttr].name} (любой ур.)`;
  return CRAFT_ITEMS[k as CraftCatId].name;
}

// ---------------------------------------------------------------- ввод и предпросмотр

export interface CraftInput {
  cls: WeaponClass;
  /** 1–3 материала (повторы — можно). */
  mats: CraftMatId[];
  /** Катализатор: особый (frost/sting), камень (ключ «str:3») или ничего. */
  cat: CraftCatId | string | null;
  method: CraftMethodId;
}

/** Строка действия для сети: «cls|mat,mat,mat|cat|method» (cat пусто — без катализатора). */
export function craftCode(i: CraftInput): string {
  return `${i.cls}|${i.mats.join(",")}|${i.cat ?? ""}|${i.method}`;
}

export function parseCraftCode(code: unknown): CraftInput | null {
  if (typeof code !== "string" || code.length > 120) return null;
  const [cls, mats, cat, method] = code.split("|");
  if (!ATTACK_CLASSES.includes(cls as WeaponClass) || !isCraftMethod(method)) return null;
  const list = (mats ?? "").split(",").filter(Boolean);
  if (list.length < 1 || list.length > CRAFT.maxMats || !list.every((m) => isCraftItem(m) && CRAFT_ITEMS[m].kind === "mat")) return null;
  const c = cat ? cat : null;
  if (c !== null && !(isCraftItem(c) && CRAFT_ITEMS[c].kind === "cat") && !parseGem(c)) return null;
  return { cls: cls as WeaponClass, mats: list as CraftMatId[], cat: c, method };
}

function groupMats(mats: readonly CraftMatId[]): [CraftMatId, number][] {
  const m = new Map<CraftMatId, number>();
  for (const x of mats) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m];
}

/** Скрытый рецепт, которому точно соответствует ввод (или null). */
export function matchRecipe(i: CraftInput): CraftRecipe | null {
  const key = (l: readonly string[]): string => [...l].sort().join(",");
  const gem = i.cat ? parseGem(i.cat) : null;
  const catKey: CraftCatKey | null = gem ? `gem:${gem.attr}` : (i.cat as CraftCatId | null);
  for (const r of CRAFT_RECIPES) {
    if (r.cls === i.cls && r.method === i.method && r.cat === catKey && key(r.mats) === key(i.mats)) return r;
  }
  return null;
}

/** Шансы исходов в процентах (сумма 100) по методу, катализатору и уровню кузнеца; скрытый рецепт — без провала и обычного. */
export function craftOdds(i: Pick<CraftInput, "method" | "cat">, smithLv = 1, recipe = false): number[] {
  const w = [...CRAFT_METHODS[i.method].odds];
  const up = Math.max(0, Math.min(SMITH.maxLv, smithLv) - 1);
  w[0] = Math.max(0, w[0] - SMITH.fail * up);
  w[3] += SMITH.great * up;
  w[4] += SMITH.rare * up;
  const gem = i.cat ? parseGem(i.cat) : null;
  if (gem) {
    const s = Math.min(CRAFT.gemLvCap, gem.lv);
    w[0] = Math.max(0, w[0] - CRAFT.gemFail * s);
    w[3] += CRAFT.gemUp * s;
    w[4] += CRAFT.gemUp * s;
  }
  if (recipe) {
    w[0] = 0;
    w[1] = 0;
  }
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (x / sum) * 100);
}

/** Какие роллы получит оружие: по порядку важности (особый катализатор, затем материалы по числу копий). */
export function plannedRolls(i: CraftInput): { sub: AffixSub; copies: number; from: string }[] {
  const out: { sub: AffixSub; copies: number; from: string }[] = [];
  if (i.cat && isCraftItem(i.cat) && CRAFT_ITEMS[i.cat].kind === "cat") {
    out.push({ sub: CAT_ROLL[i.cat as CraftCatId], copies: 1, from: CRAFT_ITEMS[i.cat].name });
  }
  const by = new Map<AffixSub, { copies: number; from: string[] }>();
  for (const m of i.mats) {
    const sub = matRoll(m, i.cls);
    const e = by.get(sub) ?? { copies: 0, from: [] };
    e.copies++;
    if (!e.from.includes(CRAFT_ITEMS[m].name)) e.from.push(CRAFT_ITEMS[m].name);
    by.set(sub, e);
  }
  const mats = [...by].sort((a, b) => b[1].copies - a[1].copies);
  for (const [sub, e] of mats) if (!out.some((o) => o.sub === sub)) out.push({ sub, copies: e.copies, from: e.from.join(", ") });
  return out;
}

/** Роллов при исходе `o` с этим методом. */
export function rollsFor(o: number, method: CraftMethodId): number {
  return o <= 0 ? 0 : Math.min(CRAFT.maxRolls, CRAFT_OUTCOMES[o].rolls + CRAFT_METHODS[method].rollAdd);
}

// ---------------------------------------------------------------- запасы героя

/** Материалы и особые катализаторы героя (поле записи PlayerStore `mats`). */
export type CraftStock = Partial<Record<CraftItemId, number>>;

export function craftStockOf(v: unknown): CraftStock {
  const out: CraftStock = {};
  if (v && typeof v === "object") {
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const c = Math.floor(Number(n));
      if (isCraftItem(k) && c > 0) out[k] = c;
    }
  }
  return out;
}

export function addStock(s: CraftStock, id: CraftItemId, n: number): void {
  const v = (s[id] ?? 0) + n;
  if (v > 0) s[id] = v;
  else delete s[id];
}

/** Книга рецептов героя (поле записи `recipes`): только известные id. */
export function recipeBookOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && CRAFT_RECIPES.some((r) => r.id === x)) : [];
}

// ---------------------------------------------------------------- крафт

export type CraftResult =
  | { ok: false; text: string }
  | {
      ok: true;
      /** Индекс исхода (CRAFT_OUTCOMES), 0 — провал. */
      outcome: number;
      /** Новое оружие (нет при провале). */
      weapon: WeaponInstance | null;
      /** Лом: списать `cost`, вернуть `refund` (провал). */
      cost: number;
      refund: number;
      /** Найден скрытый рецепт, которого не было в книге. */
      found: CraftRecipe | null;
      /** Опыт кузнеца за этот крафт. */
      xp: number;
      recipe: CraftRecipe | null;
      text: string;
    };

/**
 * Один крафт. Проверяет запасы (материалы, особый катализатор, камень, лом), бросает исход и собирает
 * оружие. Ничего не списывает: вызывающий тратит материалы (`i.mats`) и лом по ответу.
 * `gems` — камни в сумке героя (ключ → сколько), `book` — найденные рецепты.
 */
export function craftWeapon(
  i: CraftInput,
  have: { stock: CraftStock; gems: Record<string, number>; scrap: number; book: readonly string[]; smithXp: number },
  by: string,
  rnd: () => number = Math.random,
): CraftResult {
  const need = new Map<CraftMatId, number>();
  for (const m of i.mats) need.set(m, (need.get(m) ?? 0) + 1);
  for (const [m, n] of need) {
    if ((have.stock[m] ?? 0) < n) return { ok: false, text: `Не хватает: ${CRAFT_ITEMS[m].name} (нужно ${n}, есть ${have.stock[m] ?? 0}).` };
  }
  if (i.cat) {
    if (isCraftItem(i.cat)) {
      if (!((have.stock[i.cat] ?? 0) > 0)) return { ok: false, text: `Нет катализатора: ${CRAFT_ITEMS[i.cat].name}.` };
    } else if (!((have.gems[i.cat] ?? 0) > 0)) return { ok: false, text: "Такого камня в сумке нет." };
  }
  const method = CRAFT_METHODS[i.method];
  const smith = smithLevel(have.smithXp).lv;
  if (smith < method.lv) return { ok: false, text: `${method.name} откроется на ${method.lv} уровне кузнеца (сейчас ${smith}).` };
  if (have.scrap < method.cost) return { ok: false, text: `Нужно лома: ${method.cost} (есть ${have.scrap}).` };

  const recipe = matchRecipe(i);
  const odds = craftOdds(i, smith, !!recipe);
  let x = rnd() * 100;
  let outcome = odds.length - 1;
  for (let k = 0; k < odds.length; k++) {
    if (x < odds[k]) {
      outcome = k;
      break;
    }
    x -= odds[k];
  }
  const found = recipe && !have.book.includes(recipe.id) ? recipe : null;
  if (outcome === 0) {
    const refund = Math.floor(method.cost * CRAFT.failRefund);
    return { ok: true, outcome, weapon: null, cost: method.cost, refund, found, recipe, xp: smithXpFor(0, !!found), text: `Провал — материалы сгорели, лом вернулся наполовину (+${refund}). Катализатор цел.` };
  }
  const o = CRAFT_OUTCOMES[outcome];
  const n = rollsFor(outcome, i.method);
  const floor = Math.min(POINTS_MAX, o.floor + method.floorAdd);
  const pts = (lo: number): number => {
    const l = Math.max(1, Math.min(POINTS_MAX, lo));
    return l + Math.floor(rnd() * (POINTS_MAX - l + 1));
  };
  const affixes: RolledAffix[] = [];
  const used = new Set<AffixSub>();
  for (const r of plannedRolls(i)) {
    if (affixes.length >= n) break;
    used.add(r.sub);
    affixes.push(affixAtPoints(r.sub, pts(floor + CRAFT.copyFloor * (r.copies - 1))));
  }
  // Остальные места — случайные роллы класса (не повторяясь).
  while (affixes.length < n) {
    const pool = rollableSubs(i.cls).filter((s) => !used.has(s));
    if (!pool.length) break;
    const sub = pool[Math.floor(rnd() * pool.length)];
    used.add(sub);
    affixes.push(affixAtPoints(sub, pts(floor)));
  }
  // Скрытый рецепт: ролл-звезда сверх предела (если такого вида нет — встаёт вместо последнего).
  if (recipe) {
    const star = affixOverCap(recipe.star, CRAFT.starMul);
    const at = affixes.findIndex((a) => a.sub === recipe.star);
    if (at >= 0) affixes[at] = star;
    else affixes[affixes.length - 1] = star;
  }
  sortAffixes(affixes);
  const weapon: WeaponInstance = {
    id: shortId(rnd),
    cls: i.cls,
    tier: "craft",
    affixes,
    lv: LOOT_VER,
    ...(i.cls === "staff" ? { sv: 1 } : {}),
    ...(o.pow > 0 ? { cp: o.pow } : {}),
    by,
    ...(recipe ? { nm: recipe.name, rc: recipe.id } : {}),
  };
  const what = recipe ? `«${recipe.name}»` : WEAPON_NOUN[i.cls].name.toLowerCase();
  const text = `${o.name} исход: ${what}${o.pow > 0 ? ` · Мастерство +${Math.round(o.pow * 100)}%` : ""}${found ? " — найден скрытый рецепт!" : ""}`;
  return { ok: true, outcome, weapon, cost: method.cost, refund: 0, found, recipe, xp: smithXpFor(outcome, !!found), text };
}

// ---------------------------------------------------------------- данные окна

/** Крафт в данных окна инвентаря (ПК/телефон, !inv, VR). */
export interface PcInvCraft {
  /** Материалы и особые катализаторы: [id, сколько]. */
  stock: [CraftItemId, number][];
  /** Найденные скрытые рецепты (id). */
  book: string[];
  /** Опыт кузнеца (уровень — smithLevel). */
  xp: number;
}

export function pcInvCraft(rec: { mats?: unknown; recipes?: unknown; smithXp?: unknown }): PcInvCraft {
  const s = craftStockOf(rec.mats);
  const order: CraftItemId[] = [...CRAFT_MATS, ...CRAFT_CATS];
  return { stock: order.filter((k) => (s[k] ?? 0) > 0).map((k) => [k, s[k]!]), book: recipeBookOf(rec.recipes), xp: Math.max(0, Math.floor(Number(rec.smithXp) || 0)) };
}

// ---------------------------------------------------------------- добыча

/** Что падает с элитных мобов (ключ ELITE_MOBS): шанс за убийство и сколько штук. Вожак — × CRAFT_DROP_CHAMP. */
export const CRAFT_DROPS: Partial<Record<string, readonly { id: CraftItemId; chance: number; n?: number }[]>> = {
  spider: [
    { id: "web", chance: 0.01 }, // 2026-10-19: было 0.25, потом 0.03 (пауков много — паутины было слишком много)
    { id: "sting", chance: 0.001 }, // 2026-10-19: было 0.004 (катализатор не тратится — один на тысячу пауков)
  ],
  skeletonReaver: [{ id: "bone", chance: 0.25 }],
  boneWraith: [{ id: "bone", chance: 0.2 }],
  boneChief: [{ id: "bone", chance: 0.2 }],
  frostDemon: [{ id: "frost", chance: 0.01 }],
  worldElite: [{ id: "scale", chance: 1, n: 3 }],
  catDragon: [{ id: "scale", chance: 1, n: 3 }],
};
/** Вожак лагеря — шансы × это. */
export const CRAFT_DROP_CHAMP = 4;

/** Разыграть материалы с элитного моба. */
export function rollCraftDrop(eliteKey: string, champ: boolean, rnd: () => number = Math.random): { id: CraftItemId; n: number }[] {
  const out: { id: CraftItemId; n: number }[] = [];
  for (const e of CRAFT_DROPS[eliteKey] ?? []) {
    if (rnd() < Math.min(1, e.chance * (champ ? CRAFT_DROP_CHAMP : 1))) out.push({ id: e.id, n: e.n ?? 1 });
  }
  return out;
}
