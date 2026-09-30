import { CAMPFIRE, EVENT } from "#shared/constants";

/**
 * Баффы героя — одним списком для всех платформ (рамка героя ПК/телефона,
 * «смотрим» у спектатора, строка в VR). Иконки и цвета — как у фигурок,
 * кружащих вокруг героя (BuffOrbitFx): меч красный, щит золотой, мудрость
 * голубая, ветер зелёный.
 */
export interface BuffEntry {
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
  towerFloor?: number;
}): BuffEntry[] {
  if ((p.towerFloor ?? 0) > 0) return []; // в башне баффы не действуют
  const out: BuffEntry[] = [];
  if ((p.buffSecs ?? 0) > 0) {
    out.push({
      icon: "⚔️",
      name: "Благословение победы",
      desc: `×${EVENT.invasion.buffXpMult} опыта и ×${EVENT.invasion.buffDmgMult} урона`,
      secs: p.buffSecs!,
      color: "#ff5a5a",
    });
  }
  if ((p.campBuffSecs ?? 0) > 0) {
    out.push({ icon: "🛡️", name: "Тепло костра", desc: `−${Math.round(CAMPFIRE.buffDef * 100)}% входящего урона`, secs: p.campBuffSecs!, color: "#ffc24a" });
  }
  if ((p.scrollXpSecs ?? 0) > 0) {
    out.push({ icon: "📜", name: "Свиток мудрости", desc: "×2 опыта", secs: p.scrollXpSecs!, color: "#7fd0ff" });
  }
  if ((p.scrollWindSecs ?? 0) > 0) {
    out.push({ icon: "🪶", name: "Свиток ветра", desc: "+20% скорости бега", secs: p.scrollWindSecs!, color: "#8fe8b0" });
  }
  return out;
}

export const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
