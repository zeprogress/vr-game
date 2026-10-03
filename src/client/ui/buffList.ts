import { BUFFS, BUFF_ORDER, buffHex, type BuffId } from "#shared/buffs";
import { glyph } from "#shared/icons";

/**
 * Баффы героя — одним списком для всех платформ (рамка героя ПК/телефона,
 * «смотрим» у спектатора, строка в VR). Названия, значки и цвета — из общей
 * таблицы shared/buffs.ts (по ней же кружат фигурки вокруг героя).
 */
export interface BuffEntry {
  id: BuffId;
  icon: string;
  name: string;
  desc: string;
  secs: number;
  color: string;
}

export function buffList(p: {
  buffSecs?: number;
  campBuffSecs?: number;
  scrollXpSecs?: number;
  scrollWindSecs?: number;
  plagueSecs?: number;
  abyssSecs?: number;
  smokeSecs?: number;
  towerFloor?: number;
}): BuffEntry[] {
  if ((p.towerFloor ?? 0) > 0) return []; // в башне баффы не действуют
  const secs: Record<BuffId, number> = {
    victory: p.buffSecs ?? 0,
    camp: p.campBuffSecs ?? 0,
    scrollXp: p.scrollXpSecs ?? 0,
    scrollWind: p.scrollWindSecs ?? 0,
    plague: p.plagueSecs ?? 0,
    abyss: p.abyssSecs ?? 0,
    smoke: p.smokeSecs ?? 0,
  };
  return BUFF_ORDER.filter((id) => secs[id] > 0).map((id) => ({
    id,
    icon: glyph(BUFFS[id].icon),
    name: BUFFS[id].name,
    desc: BUFFS[id].desc,
    secs: secs[id],
    color: buffHex(id),
  }));
}

export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
