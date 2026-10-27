import type { HeroStatRow } from "../heroStats";

/**
 * Кадр оверлея стрима — один на всех. Им кормится и оверлей в самом спектраторе (Overlay.ts),
 * и отдельная страница оверлея (overlay.html): рендерящий спектатор собирает его один раз и шлёт
 * серверу, тот — спектаторам. Поэтому панели в обоих местах одинаковые.
 */
export interface OverlayCtx {
  /** Кого показываем: ник игрока / имя моба / null (обзор, путь). */
  watching: string | null;
  /** Подпись кадра для режима без цели («Обзор зоны», «Пролёт: …»). */
  shotLabel: string;
  /** HP цели 0..1 и абсолютные значения — или null, если у кадра нет цели. */
  /** hits — «здоровье» в ударах (дракон охоты на элиту), подпись «N / M ударов». */
  targetHp: { frac: number; cur: number; max: number; name: string; boss: boolean; hits?: boolean } | null;
  /** Плашка босса сверху — отдельно от HP цели (босс рядом с камерой эфира); не задано — берётся targetHp, если это босс. */
  bossHp?: OverlayCtx["targetHp"];
  /** Таблица характеристик игрока под ником в «смотрим» (см. #shared/heroStats). */
  watchStats: HeroStatRow[] | null;
  /** Титул героя (под ником) или null. */
  watchTitle?: string | null;
  /** Уровень героя — «N ур.» рядом с ником. */
  watchLevel: number | null;
  /** Баффы на герое в «смотрим»: иконка, название, что даёт, сколько осталось (с) и цвет. */
  watchBuffs: { icon: string; name: string; desc: string; secs: number; color: string }[] | null;
  /** Краткий инвентарь игрока — строка под полосой «HP цели» (только для игрока). */
  watchInv: string | null;
  /** Онлайн-игроки: ник и говорит ли сейчас (зелёный огонёк). */
  /** plat: 0 — не пришло (боты), 1 — ПК, 2 — телефон, 3 — VR (см. PlayerState.plat). */
  online: readonly { nick: string; speaking: boolean; bot: boolean; plat: number }[];
  /** Квест чата (все боты вместе) или null. */
  chatQuest?: { title: string; got: number; need: number; secs: number } | null;
  /** Катакомбы: сбор/забег — панель с таймером и командами чата. */
  catacombs?: { gather: boolean; hall: string; left: number; party: number; final: boolean; lives: number } | null;
  /** Текущий забег «Охотничьей башни» — этаж/мобы/босс, или null если башня не активна. */
  towerStatus: {
    heroNick: string;
    floor: number;
    mobsLeft: number;
    mobsTotal: number;
    bossActive: boolean;
    /** Секунд с начала забега. */
    timeSec: number;
  } | null;
}

/** Кадр для страницы оверлея: контекст плюс строка сверху (ивент или новости). */
export type OverlayFrame = OverlayCtx & { ticker: string; tickerKind: "event" | "news" };
