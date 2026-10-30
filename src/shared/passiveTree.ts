import type { Attr, ClassId } from "./classes2";

/**
 * Дерево прокачки класса (макет утверждён 2026-10-27, см. docs/passive-tree.md).
 *
 * Очко — за уровень, узел стоит 1 очко. Узел открывается, если взят любой соседний (или он у корня).
 * Атрибуты — сами узлы дерева: узел атрибута даёт ATTR_NODE (+4). Значения str…wis героя и свободные
 * очки считаются из взятых узлов (applyTree) — бой, HUD и сейвы читают те же поля, что и раньше.
 *
 * Форма у всех классов одна (тот же seed), содержимое своё. Дерево строится детерминированно,
 * поэтому номера узлов стабильны: в сейве хранится список номеров по классам.
 */

/** Сколько атрибута даёт один узел атрибута (решение пользователя 2026-10-27). */
export const ATTR_NODE = 4;
/** Узлов-очков за уровень. */
export const TREE_POINTS_PER_LEVEL = 1;

export type TreeKind = "root" | "attr" | "small" | "skill" | "key";
export type TreePart = "dmg" | "mixa" | "def" | "mixb" | "skl";

export interface TreeNode {
  id: number;
  kind: TreeKind;
  part: TreePart;
  /** Название направления (Урон, Защита, Умения или промежуточной ветки класса). */
  lane: string;
  /** Подветка (по атрибуту). */
  theme: string;
  row: number;
  /** Позиция в раскладке (шаг сетки = 1), для окна дерева. */
  x: number;
  y: number;
  name: string;
  desc: string;
  /** Узел атрибута: какой атрибут. */
  attr?: Attr;
  /** Бонус малого узла в бою (доля): какой и сколько — см. TREE_FX, treeBonusTotals. */
  fx?: { key: TreeFx; value: number };
  /** Улучшение умения (★): какому умению, какая прибавка и сколько. */
  skillMod?: { skill: string; key: SkillModKey; value: number };
  /** Ключевой узел (◆): сдвиги бонусов, прибавки к умениям, особые механики. */
  keyFx?: KeyFx;
  /** Особый малый узел: механика из KeySpecial или прибавка ко всем умениям. */
  smallSp?: { special?: keyof KeySpecial; allSkills?: SkillModKey; value: number };
  /** Действует ли узел в бою (узлы без механики помечены в окне «пока не действует»). */
  active: boolean;
}

/**
 * Прибавки к умению (сервер: castSkill). Слагаемые: rad/range — метры, dur/stun/slow — секунды, dmg/heal — доли,
 * count — штуки (удары, стрелы, волны, цели), cdAdd — секунды отката. Множители (…Mul) перемножаются.
 */
export type SkillModKey = "rad" | "range" | "dur" | "stun" | "slow" | "dmg" | "heal" | "count" | "cdAdd" | "durMul" | "radMul" | "dmgMul" | "healMul" | "stunAdd";
export type SkillMods = Partial<Record<SkillModKey, number>>;
const MUL_KEYS: readonly SkillModKey[] = ["durMul", "radMul", "dmgMul", "healMul"];

/** Особые механики ключевых узлов (сервер). */
export interface KeySpecial {
  /** +доля урона по целям ниже 20% HP. */
  execute?: number;
  /** +доля урона по оглушённым (и замедленным, обездвиженным). */
  vsStunned?: number;
  /** Каждая N-я атака бьёт дважды. */
  doubleEvery?: number;
  /** Дальний выстрел: дальше dist м — +far, ближе — +near (доли). */
  sniper?: { far: number; near: number; dist: number };
  /** Блок щитом снимает оглушение. */
  blockClearsStun?: number;
  /** После уворота — столько секунд неуязвимости. */
  dodgeInvuln?: number;
  /** После уворота — столько секунд мобы не видят героя. */
  dodgeGhost?: number;
  /** Блок отражает такую долю удара атакующему. */
  reflect?: number;
  /** Каждое умение лечит союзников рядом на такую долю HP. */
  allyHealOnCast?: number;
  /** Каждое N-е умение не тратит откат. */
  flowEvery?: number;
  /** Сколько ударов подряд после рывка гарантированно критуют. */
  forceCrits?: number;
  /** Град выпадов отбрасывает врагов. */
  flurryShove?: number;
  /** Особые малые узлы (доли): каждое умение лечит героя; ответный удар при блоке; урон по своей метке;
   *  союзники рядом получают меньше урона; кровотечение сильнее; удары отравляют (доля HP цели в секунду);
   *  шанс отбросить ударом; входящий урон меньше. */
  castHeal?: number;
  counterChance?: number;
  /** Шанс ударить током того, кто ударил вблизи (без щита и блока — боевой маг). */
  counterZap?: number;
  /** Контрудар молнией по всем врагам в этом радиусе от атакующего (ключ «Ответная буря»). */
  stormAoe?: number;
  vsMarked?: number;
  allyGuard?: number;
  bleedMul?: number;
  poisonHit?: number;
  shoveChance?: number;
  selfGuard?: number;
}

/** Особые малые узлы → механика (KeySpecial или прибавка ко всем умениям). Число описания: % → доля, м — как есть. */
const SPECIAL_SMALL: Record<string, { special?: keyof KeySpecial; allSkills?: SkillModKey; raw?: boolean }> = {
  "Восстановление": { special: "castHeal" },
  "Кража жизни": { special: "castHeal" },
  "Ответный удар": { special: "counterChance" },
  "Разряд": { special: "counterZap" },
  "Слабое место": { special: "vsMarked" },
  "Заслон": { special: "allyGuard" },
  "Кровопускание": { special: "bleedMul" },
  "Отрава": { special: "poisonHit" },
  "Отталкивание": { special: "shoveChance" },
  "Крепкая стойка": { special: "selfGuard" },
  "Зоркость": { allSkills: "range", raw: true },
};

export interface KeyFx {
  tb?: Partial<Record<TreeFx, number>>;
  /** По умению (id из classes2) или «*» — всем умениям. */
  skills?: Record<string, SkillMods>;
  special?: KeySpecial;
}

/** Что делают ключевые узлы — по имени. Тексты узлов (CONTENT) описывают ровно это. */
const KEY_FX: Record<string, KeyFx> = {
  "Двуручный размах": { tb: { dmg: 0.25, atk: -0.15 } },
  "Шквал": { tb: { dmg: -0.1 }, special: { doubleEvery: 4 } },
  "Палач": { tb: { crit: -0.05 }, special: { execute: 0.3 } },
  "Бронебойная": { tb: { pierce: 1, atk: -0.1 } },
  "Снайпер": { special: { sniper: { far: 0.4, near: -0.2, dist: 15 } } },
  "Боевой посох": { tb: { dmg: 0.2, magic: -0.1 } },
  "Поток": { tb: { heal: -0.1 }, special: { flowEvery: 3 } },
  "Благодать": { tb: { heal: 0.2, crit: -0.05 } },
  "Мясник": { tb: { atk: -0.05 }, special: { vsStunned: 0.3 } },
  "Вихрь клинков": { tb: { dmg: -0.1 }, special: { doubleEvery: 3 } },
  "Пронзатель": { tb: { dmg: 0.2, atk: -0.1 } },
  "Щит-стена": { tb: { move: -0.1 }, special: { blockClearsStun: 1 } },
  "Неприступный": { tb: { move: -0.1 }, special: { blockClearsStun: 1 } },
  "Бронированный": { tb: { physDef: 0.1, atk: -0.05 } },
  "Ясный разум": { tb: { magDef: 0.1, hp: -0.05 } },
  "Неуловимый": { tb: { hp: -0.1 }, special: { dodgeInvuln: 1 } },
  "Тень": { tb: { hp: -0.1 }, special: { dodgeGhost: 1 } },
  "Фаланга": { tb: { physDef: 0.15, move: -0.15 } },
  "Громоотвод": { tb: { magDef: 0.2, physDef: -0.1 } },
  "Возмездие": { tb: { dmg: -0.05 }, special: { reflect: 0.2 } },
  // Боевой маг: контрудар молнией без блока (у двуручного молота щита нет).
  "Ответная буря": { tb: { dmg: -0.05 }, special: { stormAoe: 4.5 } },
  "Святой страж": { skills: { "*": { cdAdd: 2 } }, special: { allyHealOnCast: 0.02 } },
  "Сотрясение": { skills: { stunBash: { cdAdd: 3 } }, special: { vsStunned: 0.15 } },
  "Перегрев": { tb: { skill: 0.2 }, skills: { "*": { cdAdd: 3 } } },
  "Охотничья сеть": { skills: { arrowRain: { durMul: 1.5, cdAdd: 3 }, webArrow: { durMul: 1.5, cdAdd: 3 } } },
  "Метка смерти": { skills: { mark: { durMul: 2, cdAdd: 4 } } },
  "Целитель леса": { skills: { lifeArrow: { healMul: 2, dmgMul: 0.8 } } },
  "Мученик": { tb: { hp: 0.2, dmg: -0.1 } },
  "Святой круг": { skills: { seal: { healMul: 2, cdAdd: 4 } } },
  "Хранитель": { tb: { heal: 0.25, magic: -0.15 } },
  "Пламя": { tb: { magic: 0.2, heal: -0.2 } },
  "Чума": { tb: { dmg: -0.1 }, skills: { plague: { dmgMul: 1.3 } } },
  "Пожиратель душ": { skills: { soulSteal: { healMul: 2, cdAdd: 4 } } },
  "Убийца из тени": { skills: { shadowStep: { cdAdd: 3 } }, special: { forceCrits: 2 } },
  "Стена копий": { tb: { dmg: -0.1 }, special: { flurryShove: 1 } },
  "Буревестник": { skills: { chain: { stunAdd: 0.3 }, seal: { stunAdd: 0.3 }, "*": { cdAdd: 3 } } },
  "Око бури": { skills: { seal: { radMul: 2, cdAdd: 4 } } },
};

/** Умения в текстах узлов (имена вариантов класса) → id умения (classes2 SKILLS2). */
const SKILL_BY_NAME: Record<ClassId, Record<string, string>> = {
  warrior: { "Оглушающий удар": "stunBash", "Печать стража": "seal", "Стягивание": "drawIn", "Рассекающий удар": "cleave", "Вихрь": "whirlwind", "Аура раскалённой стали": "steelAura" },
  archer: { "Град стрел": "arrowRain", "Метка охотника": "mark", "Стрела-паук": "webArrow", "Разрывная стрела": "blastArrow", "Шквал стрел": "arrowStorm", "Стрела-рой": "swarmArrow" },
  support: { "Аура исцеления": "massHeal", "Печать света": "seal", "Благословение": "warcry", "Огненный дождь": "arrowRain" },
  assassin: { "Теневой рывок": "shadowStep", "Пелена смерти": "smoke", "Смертельный прыжок": "stunBash", "Чумной клинок": "plague", "Призрак бездны": "abyss", "Танец клинков": "whirlwind" },
  spearman: { "Подсечка": "stunBash", "Отскок": "shadowStep", "Град выпадов": "whirlwind", "Ливень копий": "arrowRain" },
  battlemage: { "Сокрушение бури": "crush", "Грозовое поле": "seal", "Цепная молния": "chain", "Громовой вихрь": "whirlwind" },
};

/** Вид прибавки улучшения умения — по словам описания («оглушение +0,3 с», «радиус +1 м», «+1 удар»…). */
function skillModOf(desc: string): { key: SkillModKey; value: number } | null {
  const num = desc.match(/(\d+(?:,\d+)?)/);
  if (!num) return null;
  const v = parseFloat(num[1].replace(",", "."));
  if (/оглушение/.test(desc)) return { key: "stun", value: v };
  if (/замедление/.test(desc)) return { key: "slow", value: v };
  if (/радиус/.test(desc)) return { key: "rad", value: v };
  if (/дальность/.test(desc)) return { key: "range", value: v };
  if (/длительность|действие|держит/.test(desc)) return { key: "dur", value: v };
  if (/лечение/.test(desc)) return { key: "heal", value: v / 100 };
  if (/урон/.test(desc)) return { key: "dmg", value: v / 100 };
  if (/^\+\d/.test(desc)) return { key: "count", value: v };
  return null;
}

/** Бонусы малых узлов, которые считает бой (доли: 0.04 = +4%). Синхронизируются в PlayerState.tb. */
export type TreeFx = "dmg" | "atk" | "crit" | "critDmg" | "dodge" | "move" | "hp" | "physDef" | "magDef" | "regen" | "block" | "vamp" | "pierce" | "cd" | "skill" | "magic" | "heal";
export const TREE_FX: readonly TreeFx[] = ["dmg", "atk", "crit", "critDmg", "dodge", "move", "hp", "physDef", "magDef", "regen", "block", "vamp", "pierce", "cd", "skill", "magic", "heal"];

/** Какой бонус даёт малый узел — по имени (без II/III); число из описания × 0.01 (проценты → доли). */
const FX_BY_NAME: Record<string, TreeFx> = {
  "Остриё": "dmg", "Тугой лук": "dmg", "Тяжёлый посох": "dmg", "Наконечник": "dmg", "Тяжёлый молот": "dmg",
  "Пробивание": "pierce",
  "Быстрые руки": "atk", "Быстрый каст": "atk",
  "Натиск": "move", "Преследование": "move",
  "Меткость": "crit", "Удачное заклинание": "crit",
  "Тяжёлая рука": "critDmg", "В глаз": "critDmg", "Яркая вспышка": "critDmg",
  "Увёртливость": "dodge", "Отскок": "dodge", "Скрытность": "dodge", "Длинное древко": "dmg",
  "Толстая кожа": "hp",
  "Крепкий доспех": "physDef", "Грозовой доспех": "physDef",
  "Оберег": "magDef", "Стойкий дух": "magDef",
  "Регенерация": "regen",
  "Щитовая стойка": "block", "Магический щит": "block",
  "Вампиризм": "vamp",
  "Собранность": "cd",
  "Сила умений": "skill",
  "Сила магии": "magic", "Статика": "magic",
  "Сияние": "heal",
};

export interface ClassTree {
  cls: ClassId;
  nodes: TreeNode[];
  /** Соседи узла (связи двусторонние). */
  adj: number[][];
  edges: { a: number; b: number; bridge: boolean }[];
  /** Ширина и высота раскладки в шагах. */
  width: number;
  height: number;
  laneTitles: { title: string; x: number }[];
}

// ---------------------------------------------------------------- содержимое

const RU_ATTR: Record<string, Attr> = { "СИЛ": "str", "ЛОВ": "agi", "УДЧ": "luc", "ТЕЛ": "con", "МДР": "wis", "ИНТ": "int" };
export const ATTR_SHORT: Record<Attr, string> = { str: "СИЛ", agi: "ЛОВ", luc: "УДЧ", con: "ТЕЛ", wis: "МДР", int: "ИНТ" };
const ATTR_INFO: Record<Attr, string> = {
  str: "физический урон любым оружием",
  agi: "бег и темп атак",
  luc: "шанс крита и уворот",
  con: "HP и физическая броня",
  wis: "магзащита, скорость каста и откат умений",
  int: "урон магией и сила лечения",
};

interface Theme {
  title: string;
  key: string;
  attr?: string;
  /** Атрибуты по рядам по очереди (промежуточные ветки). */
  attrs?: string[];
  nodes: { text: string; skill?: boolean }[];
}

/** T(название, атрибут или [атрибуты по рядам], —, ключевой, ...узлы); узел с «★» — улучшение умения. Третий аргумент — от макета, не используется. */
const T = (title: string, attr: string | string[], _max: number, key: string, ...texts: string[]): Theme => ({
  title, key,
  attr: Array.isArray(attr) ? undefined : attr,
  attrs: Array.isArray(attr) ? attr : undefined,
  nodes: texts.map((t) => (t.startsWith("★") ? { text: t.slice(1), skill: true } : { text: t })),
});
const LEFT = -0.75, MIDDLE = 0.75, ALL = Infinity;
const CRIT = T("Удача", "УДЧ", ALL, "Палач: +30% урона по целям ниже 20% HP, шанс крита −5%",
  "Меткость: +2% шанса крита", "Тяжёлая рука: +8% урона крита", "Увёртливость: +2% уворота");
const AGI = (what: string, fast = 3) => T("Ловкость", "ЛОВ", MIDDLE, "Шквал: каждая 4-я атака бьёт дважды, урон атак −10%",
  `Быстрые руки: +${fast}% скорости ${what}`, "Натиск: +3% скорости бега");
const BODY = T("Телосложение · тело", "ТЕЛ", MIDDLE, "Бронированный: физ. защита +10%, скорость атаки −5%",
  "Толстая кожа: +5% HP", "Крепкий доспех: +2% физ. защиты", "Регенерация: +0,1% HP в секунду");
const WIS_DEF = T("Мудрость", "МДР", ALL, "Ясный разум: маг. защита +10%, HP −5%",
  "Оберег: +2% маг. защиты", "Устойчивость: +5% сопротивления оглушению");
const EVADE = (key: string) => T("Телосложение · уход", "ТЕЛ", LEFT, key, "Отскок: +3% уворота", "Гибкость: −3% урона в движении");
const OVERHEAT = "Перегрев: урон умений +20%, откат умений +3 с";
const SPIRIT = T("Дух", "МДР", ALL, "Святой страж: умения лечат союзников рядом на 2% HP, откат умений +2 с",
  "Стойкий дух: +2% маг. защиты", "Восстановление: каждое умение лечит тебя на 1% HP");
const COUNTER = T("Контратака", ["УДЧ", "ТЕЛ"], ALL, "Возмездие: блок отражает 20% урона, урон атак −5%",
  "Ответный удар: 5% шанса ответить ударом при блоке", "Вампиризм: +1% урона уходит в HP");
/**
 * «Контратака» боевого мага (молот) — без щита и блока: у двуручного молота блока нет,
 * поэтому контрудар срабатывает не по блоку, а по факту полученного удара вблизи.
 * Ключ «Ответная буря» отвечает молнией по всем врагам рядом с атакующим, «Разряд» —
 * шанс ударить током самого ударившего.
 */
const COUNTER_STORM = T("Контратака", ["УДЧ", "ТЕЛ"], ALL,
  "Ответная буря: удар в ответ бьёт молнией по врагам рядом с атакующим, урон атак −5%",
  "Разряд: 2% шанса ударить током атакующего", "Вампиризм: +1% урона уходит в HP");

interface ClassContent { mixa: string; mixb: string; themes: Record<TreePart, Theme[]> }

const CONTENT: Record<ClassId, ClassContent> = {
  warrior: { mixa: "Контратака", mixb: "Дух", themes: {
    dmg: [T("Сила", "СИЛ", LEFT, "Двуручный размах: урон +25%, скорость атаки −15%", "Остриё: +4% урона мечом", "Пробивание: +3% пробивания брони"), AGI("атаки", 2), CRIT],
    def: [T("Телосложение · щит", "ТЕЛ", LEFT, "Щит-стена: блок снимает оглушение, скорость бега −10%", "Щитовая стойка: +3% шанса блока", "Крепкий хват: блок гасит ещё 2% урона"), BODY, WIS_DEF],
    skl: [T("Мудрость", "МДР", 0, "Сотрясение: оглушённые враги получают +15% урона, откат Оглушающего удара +3 с",
        "Собранность: откат умений −2%", "★Оглушающий удар: оглушение +0,3 с", "★Печать стража: длительность +1 с", "★Стягивание: радиус +1 м"),
      T("Интеллект", "ИНТ", ALL, OVERHEAT, "Сила умений: урон умений +4%", "★Рассекающий удар: урон +6%", "★Вихрь: +1 удар за вращение", "★Аура раскалённой стали: урон ауры +8%")],
    mixa: [COUNTER],
    mixb: [SPIRIT],
  } },
  archer: { mixa: "Охота", mixb: "Природа", themes: {
    dmg: [T("Сила", "СИЛ", LEFT, "Бронебойная: стрелы пробивают насквозь, скорость стрельбы −10%", "Тугой лук: +4% урона луком", "Пробивание: +3% пробивания брони"), AGI("стрельбы"),
      T("Удача", "УДЧ", ALL, "Снайпер: +40% урона по целям дальше 15 м, урон вблизи −20%", "Меткость: +2% шанса крита", "В глаз: +8% урона крита", "Увёртливость: +2% уворота")],
    def: [EVADE("Неуловимый: после уворота 1 с неуязвимости, HP −10%"), BODY, WIS_DEF],
    skl: [T("Мудрость", "МДР", 0, "Охотничья сеть: Град стрел и Стрела-паук держат в 1,5 раза дольше, откат их +3 с",
        "Собранность: откат умений −2%", "★Град стрел: радиус +1 м", "★Метка охотника: длительность +2 с", "★Стрела-паук: паутина держит +1 с"),
      T("Интеллект", "ИНТ", ALL, OVERHEAT, "Сила умений: урон умений +4%", "★Разрывная стрела: радиус взрыва +0,5 м", "★Шквал стрел: +1 волна", "★Стрела-рой: +1 снаряд")],
    mixa: [T("Охота", ["УДЧ", "ЛОВ"], ALL, "Метка смерти: метка висит вдвое дольше, откат метки +4 с", "Слабое место: +5% урона по помеченным", "Преследование: +3% скорости бега в бою")],
    mixb: [T("Природа", "МДР", ALL, "Целитель леса: Стрела жизни лечит вдвое больше, её урон −20%", "Зоркость: +1 м дальности умений", "Восстановление: каждое умение лечит тебя на 1% HP")],
  } },
  support: { mixa: "Заступник", mixb: "Свет", themes: {
    dmg: [T("Сила", "СИЛ", LEFT, "Боевой посох: физ. урон +20%, урон магией −10%", "Тяжёлый посох: +4% урона посохом", "Пробивание: +3% пробивания брони"),
      T("Ловкость", "ЛОВ", MIDDLE, "Поток: каждое 3-е заклинание без отката, лечение −10%", "Быстрый каст: +3% скорости каста", "Натиск: +3% скорости бега"),
      T("Удача", "УДЧ", ALL, "Благодать: лечение +20%, шанс крита −5%", "Удачное заклинание: +2% шанса крита", "Яркая вспышка: +8% урона крита", "Увёртливость: +2% уворота")],
    def: [T("Телосложение · щит", "ТЕЛ", LEFT, "Неприступный: блок снимает оглушение, скорость бега −10%", "Магический щит: +3% шанса блока", "Щит веры: блок гасит ещё 2% урона"), BODY, WIS_DEF],
    skl: [T("Мудрость", "МДР", 0, "Хранитель: лечение +25%, урон магией −15%",
        "Собранность: откат умений −2%", "★Аура исцеления: радиус +1 м", "★Печать света: длительность +1 с", "★Благословение: действие +1 с"),
      T("Интеллект", "ИНТ", ALL, "Пламя: урон магией +20%, лечение −20%", "Сила магии: +4% урона магией", "★Огненный дождь: +1 волна", "★Аура исцеления: лечение +8%")],
    mixa: [T("Заступник", ["ТЕЛ", "УДЧ"], ALL, "Мученик: HP +20%, урон −10%", "Заслон: союзники рядом получают на 3% меньше урона", "Вампиризм: +1% урона уходит в HP")],
    mixb: [T("Свет", "МДР", ALL, "Святой круг: Печать света лечит вдвое, откат +4 с", "Сияние: +4% лечения", "Восстановление: каждое умение лечит тебя на 1% HP")],
  } },
  assassin: { mixa: "Яд", mixb: "Тьма", themes: {
    dmg: [T("Сила", "СИЛ", LEFT, "Мясник: +30% урона по оглушённым, скорость атаки −5%", "Остриё: +4% урона кинжалом", "Пробивание: +3% пробивания брони"),
      T("Ловкость", "ЛОВ", MIDDLE, "Вихрь клинков: каждый 3-й удар двойной, урон атак −10%", "Быстрые руки: +3% скорости атаки", "Натиск: +3% скорости бега"), CRIT],
    def: [EVADE("Тень: после уворота 1 с невидимости, HP −10%"), BODY, WIS_DEF],
    skl: [T("Мудрость", "МДР", 0, "Убийца из тени: после рывка 2 удара подряд критуют, откат рывка +3 с",
        "Собранность: откат умений −2%", "★Теневой рывок: оглушение +0,3 с", "★Пелена смерти: длительность +1 с", "★Смертельный прыжок: дальность +2 м"),
      T("Интеллект", "ИНТ", ALL, OVERHEAT, "Сила умений: урон умений +4%", "★Чумной клинок: урон яда +8%", "★Призрак бездны: длительность +1 с", "★Танец клинков: +1 удар")],
    mixa: [T("Яд", ["УДЧ", "ЛОВ"], ALL, "Чума: урон яда +30%, урон ударов −10%", "Отрава: удары отравляют на 1% HP в секунду", "Кровопускание: +10% урона кровотечения")],
    mixb: [T("Тьма", "МДР", ALL, "Пожиратель душ: Кража душ лечит вдвое, откат +4 с", "Скрытность: +3% уворота", "Кража жизни: каждое умение лечит тебя на 1% HP")],
  } },
  spearman: { mixa: "Охват", mixb: "Дух", themes: {
    dmg: [T("Сила", "СИЛ", LEFT, "Пронзатель: урон +20%, скорость атаки −10%", "Наконечник: +4% урона копьём", "Пробивание: +3% пробивания брони"), AGI("выпадов"), CRIT],
    def: [T("Телосложение · стойка", "ТЕЛ", LEFT, "Фаланга: физ. защита +15%, скорость бега −15%", "Крепкая стойка: −5% входящего урона", "Древко: −3% урона в ближнем бою"), BODY, WIS_DEF],
    skl: [T("Мудрость", "МДР", 0, "Сотрясение: оглушённые враги получают +15% урона, откат Подсечки +3 с",
        "Собранность: откат умений −2%", "★Подсечка: оглушение +0,3 с", "★Отскок: дальность +1 м"),
      T("Интеллект", "ИНТ", ALL, OVERHEAT, "Сила умений: урон умений +4%", "★Град выпадов: +1 выпад", "★Ливень копий: +1 копьё")],
    mixa: [T("Охват", ["ЛОВ", "ТЕЛ"], ALL, "Стена копий: Град выпадов отбрасывает врагов, урон −10%", "Длинное древко: +3% урона копьём", "Отталкивание: 5% шанса отбросить врага")],
    mixb: [SPIRIT],
  } },
  battlemage: { mixa: "Контратака", mixb: "Буря", themes: {
    dmg: [T("Сила", "СИЛ", LEFT, "Двуручный размах: урон +25%, скорость атаки −15%", "Тяжёлый молот: +4% урона молотом", "Пробивание: +3% пробивания брони"), AGI("атаки"), CRIT],
    def: [T("Телосложение · доспех бури", "ТЕЛ", LEFT, "Громоотвод: маг. защита +20%, физ. защита −10%", "Грозовой доспех: +2% физ. защиты", "Оберег: +2% маг. защиты"), BODY, WIS_DEF],
    skl: [T("Мудрость", "МДР", 0, "Буревестник: молнии оглушают на 0,3 с дольше, откат умений +3 с",
        "Собранность: откат умений −2%", "★Сокрушение бури: замедление +1 с", "★Грозовое поле: длительность +1 с"),
      T("Интеллект", "ИНТ", ALL, OVERHEAT, "Сила магии: +4% урона магией", "★Цепная молния: +1 цель", "★Громовой вихрь: +1 удар")],
    mixa: [COUNTER_STORM],
    mixb: [T("Буря", ["МДР", "ИНТ"], ALL, "Око бури: Грозовое поле вдвое шире, откат +4 с", "Статика: +3% урона молнией", "Восстановление: каждое умение лечит тебя на 1% HP")],
  } },
};

// ---------------------------------------------------------------- построение

/** Генератор с фиксированным зерном — то же, что в макете: дерево одинаковое на клиенте и сервере. */
function rng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const fmt = (v: number): string => (Math.round(v * 10) / 10).toString().replace(".", ",");
/** Умножить первое число в тексте эффекта («+5% урона» ×2 → «+10% урона»). */
const scaleFirst = (text: string, f: number): string => text.replace(/(\d+(?:,\d+)?)/, (m) => fmt(parseFloat(m.replace(",", ".")) * f));
const split = (t: string): [string, string] => { const i = t.indexOf(":"); return [t.slice(0, i), t.slice(i + 2)]; };

const ROWS = 13;
/** Ширина рядов: главные направления и промежуточные (начинаются выше и уже). */
const MAIN = [2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5];
const MID = [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3];
const SEED = 7;

const CLASS_NAMES: Record<ClassId, string> = {
  warrior: "Воин", archer: "Лучник", support: "Маг поддержки", assassin: "Ассасин", spearman: "Копейщик", battlemage: "Боевой маг",
};

function build(cls: ClassId): ClassTree {
  const c = CONTENT[cls];
  const lanes: { title: string; part: TreePart; mid: boolean }[] = [
    { title: "Урон", part: "dmg", mid: false }, { title: c.mixa, part: "mixa", mid: true }, { title: "Защита", part: "def", mid: false },
    { title: c.mixb, part: "mixb", mid: true }, { title: "Умения", part: "skl", mid: false },
  ];
  const R = rng(SEED);
  const widthOf = (l: number, r: number) => (lanes[l].mid ? MID : MAIN)[Math.min(r, ROWS - 1)];
  // Раскладка ряда в шагах: между главными — 2 пустых шага, рядом с промежуточным — 1; ряд центрируется.
  const rowStart: (number | null)[][] = [];
  const rowSpan: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    let cur = 0, prev = -1;
    rowStart[r] = lanes.map((ln, l) => {
      const w = widthOf(l, r);
      if (!w) return null;
      if (prev >= 0) cur += (lanes[prev].mid || ln.mid ? 1 : 2) + 1;
      const st = cur; cur += w - 1; prev = l; return st;
    });
    rowSpan[r] = cur;
  }
  const width = Math.max(...rowSpan);
  type Raw = TreeNode & { l: number; off: number; kids: number; i: number; w: number };
  const nodes: Raw[] = [{ id: 0, kind: "root", part: "dmg", lane: "", theme: "", row: -1, x: width / 2, y: ROWS + 0.2, name: CLASS_NAMES[cls],
    desc: "Стартовая точка. Узлы над ней открыты сразу.", l: -1, off: 0, kids: 0, i: 0, w: 1, active: true }];
  const edges: { a: number; b: number; bridge: boolean }[] = [];
  const link = (a: number, b: number, bridge = false) => edges.push({ a, b, bridge });
  const grid: number[][][] = lanes.map(() => []);
  const nearest = (ids: number[], id: number) => [...ids].sort((x, y) => Math.abs(nodes[x].x - nodes[id].x) - Math.abs(nodes[y].x - nodes[id].x));
  for (let r = 0; r < ROWS; r++) {
    lanes.forEach((lane, l) => {
      const w = widthOf(l, r);
      grid[l][r] = [];
      for (let i = 0; i < w; i++) {
        const n: Raw = { id: nodes.length, kind: "small", part: lane.part, lane: lane.title, theme: "", row: r, name: "", desc: "", l, off: i - (w - 1) / 2, kids: 0, i, w, active: false,
          x: width / 2 + ((rowStart[r][l] ?? 0) + i - rowSpan[r] / 2), y: ROWS - 1 - r };
        nodes.push(n);
        grid[l][r].push(n.id);
      }
      for (const id of grid[l][r]) {
        if (r === 0) { link(0, id); continue; }
        // Держится за ближайший снизу в своём направлении; первый ряд промежуточного — за ближайший у соседей.
        let below = grid[l][r - 1];
        if (!below.length) below = [...(grid[l - 1]?.[r - 1] ?? []), ...(grid[l + 1]?.[r - 1] ?? [])];
        const near = nearest(below, id);
        link(near[0], id); nodes[near[0]].kids++;
        if (near[1] != null && R() < 0.15) { link(near[1], id); nodes[near[1]].kids++; }
      }
    });
  }
  // Мосты: каждые 4 ряда крайние узлы соседних (по ряду) направлений.
  for (let r = 4; r < ROWS - 1; r += 4) {
    const present = lanes.map((_, l) => l).filter((l) => grid[l][r].length);
    for (let k = 0; k < present.length - 1; k++) {
      const a = grid[present[k]][r], b = grid[present[k + 1]][r];
      link(a[a.length - 1], b[0], true);
    }
  }
  // Подветка — по доле позиции в ряду: слева первая, справа последняя; в узких нижних рядах тоже
  // представлены крайние подветки (у урона внизу СИЛ и ЛОВ, у умений — МДР и ИНТ).
  const themeIdx = (n: Raw, k: number) => Math.min(k - 1, Math.floor((n.i / n.w) * k));
  // Содержимое: каждый 3-й ряд и нижний — атрибут подветки;
  // на вершине у каждой подветки один ключевой; малые бонусы сильнее к вершине (×1 / ×1,5 / ×2).
  for (const n of nodes) {
    if (!n.id) continue;
    const themes = c.themes[n.part];
    const ti = themeIdx(n, themes.length);
    const t = themes[ti];
    n.theme = t.title;
    if (n.row === ROWS - 1) {
      const mine = grid[n.l][n.row].map((x) => nodes[x]).filter((m) => themeIdx(m, themes.length) === ti).sort((a, b) => a.off - b.off);
      const pick = ti === 0 ? mine[0] : ti === themes.length - 1 ? mine[mine.length - 1] : mine[Math.floor((mine.length - 1) / 2)];
      if (pick === n) {
        n.kind = "key"; [n.name, n.desc] = split(t.key);
        const fx = KEY_FX[n.name];
        if (fx) { n.keyFx = fx; n.active = true; }
        continue;
      }
    }
    if (n.row % 3 === 2 || n.row === 0) {
      // Маг поддержки (посох) и боевой маг (молот): в ветке «Умения» на нижнем ряду
      // атрибутов балансим мудрость и интеллект — два крайних правых узла подветки
      // «Мудрость» отдаём «Интеллекту» (урон магией/лечение), итог 7 МДР / 9 ИНТ вместо 9 / 7.
      // Влияет только на атрибут узла, не на подпись группы и не на ключевые узлы.
      const sklShIf =
        (cls === "support" || cls === "battlemage") && n.part === "skl" && n.row === 11 && ti === 0 && n.i >= 1 ? 1 : 0;
      const ru = t.attrs ? t.attrs[n.row % t.attrs.length] : themes[Math.min(themes.length - 1, ti + sklShIf)].attr!;
      n.kind = "attr"; n.attr = RU_ATTR[ru]; n.active = true;
      n.name = `+${ATTR_NODE} ${ru}`; n.desc = `${ru}: ${ATTR_INFO[n.attr]}.`;
      continue;
    }
    const e = t.nodes[(n.row + Math.round(n.off * 2)) % t.nodes.length];
    n.kind = e.skill ? "skill" : "small";
    [n.name, n.desc] = split(e.text);
    const f = 1 + Math.floor(n.row / (ROWS / 3)) * 0.5;
    if (f > 1 && !e.skill) { n.desc = scaleFirst(n.desc, f); n.name += f >= 2 ? " III" : " II"; }
    // Бонус в бою: по имени узла, величина — первое число описания (проценты → доли).
    if (e.skill) {
      const skill = SKILL_BY_NAME[cls][n.name];
      const mod = skillModOf(n.desc);
      if (skill && mod) { n.skillMod = { skill, ...mod }; n.active = true; }
    }
    const key = e.skill ? undefined : FX_BY_NAME[n.name.replace(/ I+$/, "")];
    const num = n.desc.match(/(\d+(?:,\d+)?)/);
    if (key && num) { n.fx = { key, value: parseFloat(num[1].replace(",", ".")) / 100 }; n.active = true; }
    const sp = SPECIAL_SMALL[n.name.replace(/ I+$/, "")];
    if (sp && num) {
      const v = parseFloat(num[1].replace(",", "."));
      n.smallSp = { special: sp.special, allSkills: sp.allSkills, value: sp.raw ? v : v / 100 };
      n.active = true;
    }
  }
  const adj: number[][] = nodes.map(() => []);
  for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
  const top = ROWS - 1;
  const laneTitles = lanes.map((ln, l) => {
    const w = widthOf(l, top);
    return { title: ln.title, x: width / 2 + ((rowStart[top][l] ?? 0) + (w - 1) / 2 - rowSpan[top] / 2) };
  });
  const clean: TreeNode[] = nodes.map(({ l: _l, off: _o, kids: _k, i: _i, w: _w, ...n }) => n);
  return { cls, nodes: clean, adj, edges, width, height: ROWS + 0.2, laneTitles };
}

const CACHE = new Map<ClassId, ClassTree>();
/** Дерево класса (строится один раз). */
export function treeOf(cls: ClassId): ClassTree {
  let t = CACHE.get(cls);
  if (!t) { t = build(cls); CACHE.set(cls, t); }
  return t;
}

// ---------------------------------------------------------------- правила

/** Очков дерева на уровне. */
export function treePointsAt(level: number): number {
  return Math.max(0, Math.floor(level)) * TREE_POINTS_PER_LEVEL;
}

/** Только существующие, без корня и повторов — то, что можно хранить и применять. */
export function cleanTaken(cls: ClassId, taken: readonly number[] | undefined): number[] {
  const t = treeOf(cls);
  const out = [...new Set((taken ?? []).filter((id) => Number.isInteger(id) && id > 0 && id < t.nodes.length))];
  return pruneDetached(cls, out);
}

/** Оставить только узлы, связанные с корнем через взятые. */
export function pruneDetached(cls: ClassId, taken: readonly number[]): number[] {
  const t = treeOf(cls);
  const set = new Set(taken);
  const seen = new Set([0]);
  const q = [0];
  while (q.length) for (const x of t.adj[q.shift()!]) if (!seen.has(x) && set.has(x)) { seen.add(x); q.push(x); }
  return taken.filter((id) => seen.has(id));
}

/** Можно ли взять узел: не взят, рядом есть взятый (или корень) и есть свободное очко. */
export function canTake(cls: ClassId, taken: readonly number[], level: number, id: number): boolean {
  const t = treeOf(cls);
  if (id <= 0 || id >= t.nodes.length || taken.includes(id)) return false;
  if (taken.length >= treePointsAt(level)) return false;
  return t.adj[id].some((x) => x === 0 || taken.includes(x));
}

/** Снять узел: вместе с ним уходит всё, что потеряло связь с корнем. */
export function dropNode(cls: ClassId, taken: readonly number[], id: number): number[] {
  return pruneDetached(cls, taken.filter((x) => x !== id));
}

/** Суммы бонусов взятых малых узлов (доли), по всем видам TREE_FX. */
export function treeBonusTotals(cls: ClassId, taken: readonly number[]): Record<TreeFx, number> {
  const t = treeOf(cls);
  const out = Object.fromEntries(TREE_FX.map((k) => [k, 0])) as Record<TreeFx, number>;
  for (const id of taken) {
    const n = t.nodes[id];
    if (n?.fx) out[n.fx.key] += n.fx.value;
    for (const [k, v] of Object.entries(n?.keyFx?.tb ?? {}) as [TreeFx, number][]) out[k] += v;
  }
  return out;
}

/** Прибавки к умениям и особые механики по взятым узлам (сервер — Runtime.treeSkill / treeKey). */
export function treeSkillState(cls: ClassId, taken: readonly number[]): { skills: Record<string, SkillMods>; special: KeySpecial } {
  const t = treeOf(cls);
  const skills: Record<string, SkillMods> = {};
  const special: KeySpecial = {};
  const add = (skill: string, k: SkillModKey, v: number) => {
    const m = (skills[skill] ??= {});
    m[k] = MUL_KEYS.includes(k) ? (m[k] ?? 1) * v : (m[k] ?? 0) + v;
  };
  for (const id of taken) {
    const n = t.nodes[id];
    if (!n) continue;
    if (n.skillMod) add(n.skillMod.skill, n.skillMod.key, n.skillMod.value);
    if (n.smallSp?.allSkills) add("*", n.smallSp.allSkills, n.smallSp.value);
    if (n.smallSp?.special) (special as Record<string, number>)[n.smallSp.special] = ((special as Record<string, number>)[n.smallSp.special] ?? 0) + n.smallSp.value;
    for (const [sk, mods] of Object.entries(n.keyFx?.skills ?? {})) for (const [k, v] of Object.entries(mods) as [SkillModKey, number][]) add(sk, k, v);
    const sp = n.keyFx?.special;
    if (!sp) continue;
    for (const [k, v] of Object.entries(sp) as [keyof KeySpecial, unknown][]) {
      if (k === "sniper") special.sniper = v as KeySpecial["sniper"];
      else if (k === "doubleEvery") special.doubleEvery = Math.min(special.doubleEvery ?? Infinity, v as number);
      else (special as Record<string, number>)[k] = ((special as Record<string, number>)[k] ?? 0) + (v as number);
    }
  }
  return { skills, special };
}

/** Прибавки к умению `kind` с учётом общих («*»): слагаемые складываются, множители перемножаются. */
export function skillModsFor(skills: Record<string, SkillMods> | undefined, kind: string): SkillMods {
  const out: SkillMods = {};
  for (const m of [skills?.["*"], skills?.[kind]]) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m) as [SkillModKey, number][]) out[k] = MUL_KEYS.includes(k) ? (out[k] ?? 1) * v : (out[k] ?? 0) + v;
  }
  return out;
}

/**
 * Бонус дерева героя по виду — из поля `tb` состояния игрока (синхронизируется с сервером), как armorBonus.
 * Нет поля — ноль: расчёты для мобов и старых данных не меняются.
 */
export function treeBonus(a: object, key: TreeFx): number {
  const v = (a as { tb?: Partial<Record<TreeFx, number>> }).tb?.[key];
  return typeof v === "number" ? v : 0;
}

/** Атрибуты от дерева: старт + ATTR_NODE за каждый взятый узел атрибута. */
export function attrsFromTree(cls: ClassId, taken: readonly number[], start: number): Record<Attr, number> {
  const t = treeOf(cls);
  const out: Record<Attr, number> = { str: start, agi: start, int: start, con: start, luc: start, wis: start };
  for (const id of taken) { const a = t.nodes[id]?.attr; if (a) out[a] += ATTR_NODE; }
  return out;
}

/**
 * Кратчайший путь (по невзятым узлам) от взятой части дерева до ближайшего узла атрибута `attr`.
 * Возвращает узлы пути по порядку взятия (последний — узел атрибута) или null.
 */
export function pathToAttr(cls: ClassId, taken: readonly number[], attr: Attr): number[] | null {
  const t = treeOf(cls);
  const have = new Set([0, ...taken]);
  const prev = new Map<number, number>();
  const q: number[] = [...have];
  const seen = new Set(have);
  while (q.length) {
    const cur = q.shift()!;
    for (const x of t.adj[cur]) {
      if (seen.has(x)) continue;
      seen.add(x);
      prev.set(x, cur);
      if (t.nodes[x].attr === attr) {
        const path = [x];
        let p = cur;
        while (!have.has(p)) { path.push(p); p = prev.get(p)!; }
        return path.reverse();
      }
      q.push(x);
    }
  }
  return null;
}

/**
 * Взять до `times` узлов атрибута `attr` кратчайшими путями (кнопки «+атрибут», чат !str …).
 * Мутирует `taken`. Возвращает, сколько узлов атрибута взято. Путь берётся только целиком.
 */
export function takeAttr(cls: ClassId, taken: number[], level: number, attr: Attr, times = 1): number {
  let got = 0;
  for (let i = 0; i < times; i++) {
    const path = pathToAttr(cls, taken, attr);
    if (!path || taken.length + path.length > treePointsAt(level)) break;
    taken.push(...path);
    got++;
  }
  return got;
}

/**
 * Раскидать свободные очки по весам атрибутов класса (боты): каждый раз берём атрибут с лучшим
 * «вес / длина пути». Мутирует `taken`, возвращает число взятых узлов.
 */
export function autoTree(cls: ClassId, taken: number[], level: number, weights: Partial<Record<Attr, number>>): number {
  const before = taken.length;
  const counts: Partial<Record<Attr, number>> = {};
  for (;;) {
    let best: number[] | null = null;
    let bestScore = 0;
    let bestAttr: Attr | null = null;
    for (const [a, w] of Object.entries(weights) as [Attr, number][]) {
      if (!w || w <= 0) continue;
      const path = pathToAttr(cls, taken, a);
      if (!path || taken.length + path.length > treePointsAt(level)) continue;
      const score = w / (path.length * (1 + (counts[a] ?? 0) / 4));
      if (score > bestScore) { bestScore = score; best = path; bestAttr = a; }
    }
    if (!best || !bestAttr) break;
    taken.push(...best);
    counts[bestAttr] = (counts[bestAttr] ?? 0) + 1;
  }
  return taken.length - before;
}
