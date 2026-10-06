/**
 * Задания (квесты дня). Каждый день у героя:
 *  - 3 простых задания — выдаются автоматически;
 *  - на доске в лагере 5 предложений (3 простых + 2 усложнённых), из них
 *    можно взять ещё 2.
 * Все задания дня разные (вид + цель не повторяются). Цели — мобы «зоны»
 * героя (±3 ур.), у усложнённых — на 3 ур. выше. Прогресс, награды и
 * сохранение ведёт сервер (ZoneRoom), окно/трекер/компас рисует клиент.
 */
import { LAKE } from "./constants";
import { BOSS, ELITE_MOBS, MOB_CAMPS } from "./mobs";

export type QuestKind = "hunt" | "champ" | "fish" | "boss";

export interface QuestSlot {
  kind: QuestKind;
  /** Усложнённое задание (больше нужно, цели сильнее, награда крупнее). */
  hard: boolean;
  /** Ключ ELITE_MOBS цели ("" — рыбалка). */
  target: string;
  need: number;
  got: number;
  claimed: boolean;
}

export interface QuestSave {
  /** Версия формата (старые доски пересобираются). */
  v: 3;
  /** Три задания дня взяты у доски (до этого прогресс не идёт). */
  accepted: boolean;
  /** День по Москве, YYYY-MM-DD. */
  day: string;
  level: number;
  /** Активные задания: 3 автоматических + взятые с доски. */
  slots: QuestSlot[];
  /** Предложения доски (взятые — убираются отсюда в slots). */
  offers: QuestSlot[];
  /** Сколько ещё можно взять с доски сегодня. */
  picksLeft: number;
  /** Бонус-свиток за все автоматические задания уже выдан. */
  allBonus?: boolean;
}

export const QUEST = {
  auto: 3,
  offersEasy: 3,
  offersHard: 2,
  picks: 2,
  need: { hunt: 15, champ: 1, fish: 5, boss: 1 } as Record<QuestKind, number>,
  hardNeed: { hunt: 30, champ: 3, fish: 15, boss: 2 } as Record<QuestKind, number>,
  hardLevelUp: 3,
  zone: 3,
  reward: {
    easy: { xpMul: 1, tokens: 2, scrap: 50 },
    hard: { xpMul: 2, tokens: 5, scrap: 150 },
  },
  boardReach: 4,
  /** Вожак лагеря: во сколько раз сильнее обычного моба лагеря. */
  champ: { hpMul: 3, dmgMul: 1.4, scaleMul: 1.3, xpMul: 4, dropMul: 3 },
} as const;

/** Типы мобов из лагерей с вожаками (без дубликатов), по возрастанию уровня. */
function campTypes(): { type: string; level: number; champ: boolean }[] {
  const byType = new Map<string, { type: string; level: number; champ: boolean }>();
  for (const c of MOB_CAMPS) {
    const cur = byType.get(c.type);
    const champ = !c.noChamp || (cur?.champ ?? false);
    byType.set(c.type, { type: c.type, level: ELITE_MOBS[c.type]?.level ?? 1, champ });
  }
  return [...byType.values()].sort((a, b) => a.level - b.level);
}

/** Мобы зоны: уровень в пределах ±zone; никого — ближайший уровень снизу. */
export function zoneTypes(level: number, zone: number = QUEST.zone, champOnly = false): string[] {
  const all = campTypes().filter((t) => !champOnly || t.champ);
  const inZone = all.filter((t) => Math.abs(t.level - level) <= zone).map((t) => t.type);
  if (inZone.length) return inZone;
  const below = all.filter((t) => t.level <= level);
  const pick = below.length ? below[below.length - 1].level : all[0]?.level;
  return all.filter((t) => t.level === pick).map((t) => t.type);
}

/** День по Москве (UTC+3) — задания обновляются в 00:00 МСК. */
export function questDay(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

export function secsToNextDay(now = Date.now()): number {
  const msk = now + 3 * 3600_000;
  const next = Math.floor(msk / 86_400_000 + 1) * 86_400_000;
  return Math.ceil((next - msk) / 1000);
}

function slot(kind: QuestKind, hard: boolean, target: string): QuestSlot {
  return { kind, hard, target, need: (hard ? QUEST.hardNeed : QUEST.need)[kind], got: 0, claimed: false };
}

export const questKey = (s: Pick<QuestSlot, "kind" | "hard" | "target">): string =>
  `${s.kind}:${s.target}:${s.hard ? "h" : "e"}`;

function shuffle<T>(a: T[], rnd: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Все возможные задания под уровень (простые / усложнённые). */
function candidates(level: number, hard: boolean): QuestSlot[] {
  const lv = hard ? level + QUEST.hardLevelUp : level;
  // Для разнообразия предложений — зона пошире, чем для самих целей охоты.
  const hunt = zoneTypes(lv);
  const huntWide = zoneTypes(lv, QUEST.zone + 3);
  const champs = zoneTypes(lv, QUEST.zone, true);
  const out: QuestSlot[] = [];
  for (const t of new Set([...hunt, ...huntWide])) out.push(slot("hunt", hard, t));
  for (const t of champs) out.push(slot("champ", hard, t));
  out.push(slot("fish", hard, ""));
  // Рейд на Багрового — только пока он в мире (2026-10-07 выключен на время теста рейд-босса).
  if (BOSS.enabled) out.push(slot("boss", hard, "boss"));
  return out;
}

/** Задания дня: 3 автоматических простых + 5 предложений доски, без повторов. */
export function makeBoard(level: number, rnd: () => number = Math.random): QuestSave {
  const easy = shuffle(candidates(level, false), rnd);
  const hard = shuffle(candidates(level, true), rnd);
  // Автоматические — по возможности разных видов (охота, вожак, рыбалка); рейд — только на доске.
  const auto: QuestSlot[] = [];
  for (const kind of ["hunt", "champ", "fish"] as const) {
    const i = easy.findIndex((s) => s.kind === kind);
    if (i >= 0 && auto.length < QUEST.auto) auto.push(...easy.splice(i, 1));
  }
  while (auto.length < QUEST.auto && easy.length) {
    const i = easy.findIndex((s) => s.kind !== "boss");
    auto.push(...easy.splice(i >= 0 ? i : 0, 1));
  }
  // На доске всегда есть рейд на Багрового и рыбалка (простые) — остальное охотой/вожаками.
  const pick = (list: QuestSlot[], kind: QuestKind): QuestSlot[] => {
    const i = list.findIndex((s) => s.kind === kind);
    return i >= 0 ? list.splice(i, 1) : [];
  };
  const offersEasy = [...pick(easy, "boss"), ...pick(easy, "fish")];
  while (offersEasy.length < QUEST.offersEasy && easy.length) offersEasy.push(easy.shift()!);
  const offersHard = [...pick(hard, "boss")];
  while (offersHard.length < QUEST.offersHard && hard.length) offersHard.push(hard.shift()!);
  const offers = [...offersEasy, ...offersHard];
  return { v: 3, accepted: false, day: questDay(), level, slots: auto, offers, picksLeft: QUEST.picks };
}

export function slotDone(s: QuestSlot): boolean {
  return s.got >= s.need;
}

/**
 * Опыт за задание — доля уровня, считается от ТЕКУЩЕГО уровня: на первых
 * уровнях задание поднимает на несколько уровней, к 30-му — ~10% уровня.
 * Плавная экспонента: ур.1 — ×3 уровня, ур.10 — ~1, ур.20 — ~0.35, ур.30 — 0.1.
 */
export function questXpFrac(level: number): number {
  return Math.max(0.03, 3 * Math.pow(0.1 / 3, (Math.max(1, level) - 1) / 29));
}

export function slotReward(s: QuestSlot): { xpMul: number; tokens: number; scrap: number } {
  return s.hard ? QUEST.reward.hard : QUEST.reward.easy;
}

export function slotTitle(s: QuestSlot): string {
  const name = ELITE_MOBS[s.target]?.name ?? s.target;
  const n = s.need;
  if (s.kind === "fish") return `Рыбалка: ${n} ${n === 1 ? "рыба" : n < 5 ? "рыбы" : "рыб"}`;
  if (s.kind === "boss") return `Рейд: Багровый слизень${n > 1 ? ` ×${n}` : ""}`;
  if (s.kind === "champ") return `Вожак: ${name}${n > 1 ? ` ×${n}` : ""}`;
  return `Охота: ${name} ×${n}`;
}

/** Куда идти по заданию (для компаса): лагерь цели, ближайший к (x,z), или озеро. */
export function questPoint(s: Pick<QuestSlot, "kind" | "target">, x: number, z: number): { x: number; z: number } {
  if (s.kind === "fish") return { x: LAKE.x, z: LAKE.z };
  if (s.kind === "boss") return { x: BOSS.home[0], z: BOSS.home[1] };
  let best: { x: number; z: number } | null = null;
  let bd = Infinity;
  for (const c of MOB_CAMPS) {
    if (c.type !== s.target || (s.kind === "champ" && c.noChamp)) continue;
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bd) {
      bd = d;
      best = { x: c.x, z: c.z };
    }
  }
  return best ?? { x, z };
}

// ---- Этап 3: сюжетная цепочка новичка и недельный контракт (у Охотника) ----

export interface StoryChapter {
  title: string;
  /** Реплика Охотника — зачем это нужно лагерю. */
  text: string;
  kind: QuestKind;
  target: string;
  need: number;
}

/** Глава за главой учат механикам: бой, рыбалка, лагеря, вожаки. Для 1–15 ур. */
export const STORY: readonly StoryChapter[] = [
  { title: "Первая кровь", text: "Пчёлы у ворот жалят новобранцев. Покажи им, кто тут хозяин.", kind: "hunt", target: "bee", need: 5 },
  { title: "Улов для котла", text: "Лагерю нужна еда. Сходи к озеру и налови рыбы.", kind: "fish", target: "", need: 3 },
  { title: "Колючая напасть", text: "Шипобрюхи расплодились у дороги. Проредим их.", kind: "hunt", target: "spikyBlob", need: 10 },
  { title: "Вожак пустыни", text: "У кактородо появился вожак — крупнее и злее. Одолей его.", kind: "champ", target: "cactoro", need: 1 },
  { title: "Орочья застава", text: "Орки-стрелки держат холм к югу. Разгони их лагерь.", kind: "hunt", target: "orcGunner", need: 10 },
  { title: "Голова заставы", text: "Последний шаг: вожак орков. Победишь — станешь защитником лагеря.", kind: "champ", target: "orcGunner", need: 1 },
];

/** Сюжет доступен, пока не пройден (уровень не ограничиваем — просто для новичков он проще). */
export const STORY_REWARD = { xpMul: 1, tokens: 2, potions: 3 } as const;
/** Титул за всю цепочку (показ — с этапа титулов). */
export const STORY_TITLE = "Защитник лагеря";

export interface StorySave {
  /** Индекс текущей главы; STORY.length — цепочка пройдена. */
  ch: number;
  got: number;
  /** Глава взята у Охотника (до этого прогресс не идёт). */
  taken?: boolean;
}

export const WEEKLY = {
  hunt: 200,
  champ: 10,
  fish: 20,
  reward: { xpMul: 3, tokens: 10 },
} as const;

export interface WeeklySave {
  /** Понедельник недели по Москве, YYYY-MM-DD. */
  week: string;
  /** Мобы зоны героя на момент выдачи — засчитываются в охоту. */
  zone: string[];
  hunt: number;
  champ: number;
  fish: number;
  claimed: boolean;
  /** Контракт взят у Охотника. */
  taken?: boolean;
}

/** Понедельник текущей недели по Москве — контракт обновляется в 00:00 МСК понедельника. */
export function questWeek(now = Date.now()): string {
  const msk = new Date(now + 3 * 3600_000);
  const dow = (msk.getUTCDay() + 6) % 7; // 0 — понедельник
  return new Date(msk.getTime() - dow * 86_400_000).toISOString().slice(0, 10);
}

export function secsToNextWeek(now = Date.now()): number {
  const monday = Date.parse(`${questWeek(now)}T00:00:00Z`) - 3 * 3600_000;
  return Math.ceil((monday + 7 * 86_400_000 - now) / 1000);
}

export function makeWeekly(level: number): WeeklySave {
  return { week: questWeek(), zone: zoneTypes(level, QUEST.zone + 2), hunt: 0, champ: 0, fish: 0, claimed: false };
}

export function weeklyDone(w: WeeklySave): boolean {
  return w.hunt >= WEEKLY.hunt && w.champ >= WEEKLY.champ && w.fish >= WEEKLY.fish;
}

// ---- Этап 4: квест чата — общая задача всем ботам зрителей ----

export const CHAT_QUEST = {
  /** Первый — через столько минут после старта сервера, дальше — раз в everyMin. */
  firstMin: 20,
  everyMin: 120,
  minBots: 3,
  durSec: 30 * 60,
  /** Цель от числа ботов в момент старта. */
  mobsPerBot: 40,
  champsPerBot: 2,
  tokens: 2,
} as const;

// ---- Этап 5: титулы — только за большие заслуги, каждый в своей области ----

export interface TitleDef {
  name: string;
  desc: string;
}

export const TITLES: readonly TitleDef[] = [
  { name: "Защитник лагеря", desc: "пройти историю Охотника" },
  { name: "Царь башни", desc: "пройти Охотничью башню целиком быстрее 3:00" },
  { name: "Драконоборец", desc: "5 раз нанести больше всех урона дракону на охоте" },
  { name: "Гроза Багрового", desc: "5 раз добить Багрового слизня" },
  { name: "Мастер-рыболов", desc: "поймать 1000 рыб" },
  { name: "Ветеран контрактов", desc: "закрыть 8 контрактов недели" },
  { name: "Легенда", desc: "первое место по уровню (один на весь мир — переходит к новому лидеру)" },
];

export const TITLE_GOALS = {
  towerSec: 3 * 60,
  dragonTop: 5,
  bossKills: 5,
  fish: 1000,
  contracts: 8,
} as const;
