import { CAT_HALLS, CAT_PHASE, catParseRoute } from "#shared/catacombs";
import { CAT_BOSS_NAMES, ELITE_MOBS } from "#shared/mobs";
import { RAID } from "#shared/raid";
import { heroStatRows, type HeroStatRow } from "#shared/heroStats";
import { ITEMS, weaponDef, type ItemId, type WeaponClass } from "#shared/items";
import type { PlayerState, ZoneState } from "#shared/net/schema";
import type { OverlayCtx } from "#shared/net/overlayFrame";
import { buffList } from "../ui/buffList";

export type OverlayOnline = { nick: string; speaking: boolean; bot: boolean; plat: number };
export type OverlayTickerKind = "event" | "news";

/**
 * Строка сверху: идёт ивент или катакомбы — крупно. Считается из состояния комнаты, поэтому её одинаково
 * видят и рендерящий спектатор, и отдельная страница оверлея (overlay.html) — без кадра из сцены.
 */
export function tickerOf(st: ZoneState | null | undefined): { ticker: string; tickerKind: OverlayTickerKind } {
  if (st && st.catPhase >= CAT_PHASE.run) {
    // Идут катакомбы — сверху пусто: зрителю и так видно, что это забег (баннеры, таблица урона).
    return { ticker: "", tickerKind: "event" };
  }
  if (st?.catPhase === CAT_PHASE.gather) return { ticker: "Идёт сбор в Катакомбы (!катакомбы)", tickerKind: "event" };
  if (st?.eventKind === 1) return { ticker: "Идёт ивент — нашествие мобов (!event)", tickerKind: "event" };
  if (st?.eventKind === 2) return { ticker: "Идёт ивент — охота на элиту (!event)", tickerKind: "event" };
  if (st?.eventKind === 3) return { ticker: "Идёт ивент — Охотничья башня (!event)", tickerKind: "event" };
  // Иначе — пусто: новостная строка приходит кадром из рендерящего спектатора, если он есть.
  return { ticker: "", tickerKind: "news" };
}

/** Онлайн из состояния комнаты: игроки и боты. `speaking` решает вызывающий (голос есть только у спектатора). */
export function onlineOf(
  st: ZoneState | null | undefined,
  speaking: (id: string, nick: string) => boolean,
): OverlayOnline[] {
  const out: OverlayOnline[] = [];
  st?.players.forEach((p, id) =>
    out.push({ nick: p.nick, speaking: speaking(id, p.nick), bot: id.startsWith("bot:"), plat: p.plat }),
  );
  return out;
}

/** Квест чата для панели оверлея — из состояния комнаты. */
export function chatQuestOf(st: ZoneState | null | undefined): OverlayCtx["chatQuest"] {
  return st?.cqTitle ? { title: st.cqTitle, got: st.cqGot, need: st.cqNeed, secs: st.cqSecs } : null;
}

/** Катакомбы (сбор и забег) для панели оверлея — из состояния комнаты. */
export function catacombsOf(st: ZoneState | null | undefined): OverlayCtx["catacombs"] {
  return st && st.catPhase >= CAT_PHASE.gather
    ? { gather: st.catPhase === CAT_PHASE.gather, hall: CAT_HALLS[catParseRoute(st.catRoute)[st.catHi] ?? 0].name, left: st.catLeft, party: st.catParty, final: st.catFinal === 1, lives: st.catLives }
    : null;
}

/**
 * Босс для полоски HP: Багровый, текущий босс катакомб (catBoss), дракон «Охоты на элиту» (фаза),
 * рейд-босс (Лунный аватар) и суперболссы катакомб по имени.
 */
/** Одиночные боссы мира (элиты с полоской HP босса): охота на элиту, голем, колосс, чародей руин, рейд-босс. */
const WORLD_BOSS_NAMES = new Set(
  ["worldElite", "golem", "mushColossus", "ruinMage", RAID.boss].map((k) => ELITE_MOBS[k]?.name).filter(Boolean),
);

/** От стольких HP моб — босс для плашки (Ледяной гигант, Страж лавы и т.п.). Пугало (у него табло в info) — не босс. */
const BOSS_HP = 100_000;

function isBossMob(st: ZoneState, id: string, m: { kind: string; mobName: string; phase: number; maxHp: number; info: string }): boolean {
  const name = m.mobName || mobName(m.kind);
  if (m.info) return false; // табло над Пугалом
  return m.kind === "boss" || id === st.catBoss || m.phase > 0 || CAT_BOSS_NAMES.includes(name) || WORLD_BOSS_NAMES.has(name) || m.maxHp >= BOSS_HP;
}

export function mobName(kind: string): string {
  return kind === "boss" ? "Багровый" : kind === "spitter" ? "Плевун" : "Слизень";
}

/** Подпись кадра без цели («Обзор зоны», «Пролёт: …»). Вид кадра — как у камеры спектатора. */
export function shotLabel(kind: string): string {
  if (kind === "free") return "Свободная камера";
  if (kind === "overview") return "Обзор зоны";
  if (kind.startsWith("path ")) return `Пролёт: ${kind.slice(6, -1)}`;
  if (kind === "orbitBoss") return "Багровый";
  return "Зона";
}

/** Таблица понятных характеристик игрока для панели «смотрим» (см. #shared/heroStats). */
function playerStatRows(p: PlayerState): HeroStatRow[] {
  // «Удар конусом» (прокол копья) зрителям не нужен — он есть в инвентаре игрока.
  const rows = heroStatRows(p).filter((r) => r.label !== "Удар конусом");
  rows.push({ label: "Убийств в минуту", value: String(p.kpm) });
  return rows;
}

/** Ярлык оружия/щита в руке для панели «HP цели». */
function weaponLabel(cls: string, tier: string): string | null {
  if (tier === "legendary" || tier === "ruby" || tier === "craft") return weaponDef(cls as WeaponClass, tier).name.toLowerCase();
  if (cls === "shield") return "щит";
  const base = cls === "sword" ? "меч" : cls === "bow" ? "лук" : cls === "staff" ? "посох" : null;
  if (!base) return null;
  return tier === "gold" ? `золотой ${base}` : base;
}

/** Краткий инвентарь игрока: что в руках + содержимое сумки. */
function playerInvLine(p: PlayerState): string {
  const hands: string[] = [];
  const r = weaponLabel(p.rightCls, p.rightTier);
  const l = weaponLabel(p.leftCls, p.leftTier);
  if (r) hands.push(r);
  if (l && l !== r) hands.push(l);
  const counts = new Map<string, number>();
  p.bag.forEach((sl) => {
    if (sl.item && sl.count > 0) counts.set(sl.item, (counts.get(sl.item) ?? 0) + sl.count);
  });
  const bag: string[] = [];
  for (const [id, n] of counts) {
    const short = id === "potion" ? "зелья" : (ITEMS[id as ItemId]?.short ?? id).toLowerCase();
    bag.push(`${short} ×${n}`);
  }
  const parts = [...hands, ...bag];
  return parts.length ? parts.join(" · ") : "";
}

export type WatchPanels = Pick<OverlayCtx, "watching" | "watchStats" | "watchInv" | "watchBuffs" | "watchLevel" | "watchTitle" | "targetHp">;

/**
 * Панели «смотрим» для кадра камеры: кого показываем (игрок или моб по id) — из состояния комнаты.
 * Один расчёт для веб-спектатора и страницы оверлея (за Unity-спектатора, который шлёт только цель кадра).
 */
export function watchPanels(st: ZoneState | null | undefined, subj: { type: string; id: string | null }): WatchPanels {
  const out: WatchPanels = { watching: null, watchStats: null, watchInv: null, watchBuffs: null, watchLevel: null, watchTitle: null, targetHp: null };
  if (!st || !subj.id) return out;
  if (subj.type === "player") {
    const p = st.players.get(subj.id);
    if (!p) return out;
    const buffs = buffList(p);
    return {
      watching: p.nick,
      watchStats: playerStatRows(p),
      watchInv: playerInvLine(p),
      watchBuffs: buffs.length ? buffs : null,
      watchLevel: p.level,
      watchTitle: p.title || null,
      targetHp: { frac: p.hp / (p.maxHp || 1), cur: p.hp, max: p.maxHp, name: p.nick, boss: false },
    };
  }
  if (subj.type === "mob") {
    const m = st.mobs.get(subj.id);
    if (!m || m.dead) return out;
    const name = m.mobName || mobName(m.kind);
    out.watching = name;
    const hunt = st.eventKind === 2 && m.phase > 0; // дракон охоты: здоровье — удары
    out.targetHp = { frac: m.hp / (m.maxHp || 1), cur: m.hp, max: m.maxHp, name: hunt ? `${name} · фаза ${m.phase}` : name, boss: isBossMob(st, subj.id, m), hits: hunt };
  }
  return out;
}

/** Последний босс плашки: держимся за него, пока жив и рядом, — плашка не прыгает между соседями. */
let lastBossId = "";

/**
 * HP живого босса рядом с камерой эфира (state.specX/Z, в пределах `near` м) — для полоски HP босса,
 * когда камера не смотрит на него прямо (Unity-спектатор не сообщает цель в аренах катакомб и общих планах).
 * Босс — как в watchPanels: Багровый, боссы катакомб, боссы мира и любой моб от BOSS_HP. null — рядом нет.
 */
export function nearBossHp(st: ZoneState | null | undefined, near = 90): OverlayCtx["targetHp"] {
  if (!st) return null;
  // Босс катакомб — главный: пока жив и камера в его арене (150 м), плашка за ним, как в игре (CatBossHud).
  const cb = st.catBoss ? st.mobs.get(st.catBoss) : undefined;
  if (cb && !cb.dead && (!st.specActive || Math.hypot(cb.x - st.specX, cb.z - st.specZ) < 150)) {
    lastBossId = st.catBoss;
    return { frac: cb.hp / (cb.maxHp || 1), cur: cb.hp, max: cb.maxHp, name: cb.mobName || "Босс катакомб", boss: true };
  }
  // Камера эфира не прислала положение — ближайшим не выбрать: берём любого живого босса.
  const anywhere = !st.specActive;
  let best: OverlayCtx["targetHp"] = null;
  let bestId = "";
  let bestScore = Infinity;
  st.mobs.forEach((m, id) => {
    if (m.dead || !isBossMob(st, id, m)) return;
    // Ближе к камере или к точке, куда она смотрит; босс в бою (ранен) — впереди целого.
    const d = anywhere ? 0 : Math.min(Math.hypot(m.x - st.specX, m.z - st.specZ), Math.hypot(m.x - st.specTX, m.z - st.specTZ));
    if (d > near && !anywhere) return;
    const score = d + (m.hp < m.maxHp ? 0 : 1000) - (id === lastBossId ? 500 : 0);
    if (score >= bestScore) return;
    bestScore = score;
    bestId = id;
    // Дракон охоты (фаза > 0 во время охоты): здоровье — удары, в подписи фаза, как в игре (HuntBossFinder).
    const hunt = st.eventKind === 2 && m.phase > 0;
    const name = m.mobName || mobName(m.kind);
    best = { frac: m.hp / (m.maxHp || 1), cur: m.hp, max: m.maxHp, name: hunt ? `${name} · фаза ${m.phase}` : name, boss: true, hits: hunt };
  });
  lastBossId = bestId;
  return best;
}
