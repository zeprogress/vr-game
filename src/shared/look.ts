import type { WeaponTier } from "./items";

/**
 * Общий вид интерфейса — ОДНО место для цветов и подписей, которые повторяются
 * на всех платформах (ПК/телефон, VR-холсты, спектатор, страница !inv).
 * В HTML они доступны как CSS-переменные (themeCss → :root { --tier-gold: … }),
 * на холстах — напрямую из TIER_LOOK.
 */
export interface TierLook {
  /** Как тир называется у предмета («золотое»). */
  name: string;
  /** Цвет текста и значка предмета этого тира. */
  color: string;
  /** Рамка ячейки. */
  edge: string;
  /** Внутреннее свечение ячейки (box-shadow). */
  glow: string;
  /** Фон карточки на VR-холсте. */
  bg: string;
}

export const TIER_LOOK: Record<WeaponTier, TierLook> = {
  base: { name: "обычное", color: "#e6e0d0", edge: "#6b6b6b", glow: "rgba(0,0,0,0)", bg: "#1d1c25" },
  gold: { name: "золотое", color: "#ffd166", edge: "#d9a21b", glow: "rgba(217,162,27,.3)", bg: "#2a2416" },
  legendary: { name: "уникальное", color: "#c79bff", edge: "#9b5cf0", glow: "rgba(155,92,240,.4)", bg: "#251a33" },
};

/** Цвет оценки предмета («оценка 47»). */
export const QUALITY_COLOR = "#ffcf5a";

/** CSS-переменные общего вида — вставляется один раз в каждую страницу (см. client/ui/icons.ts). */
export function themeCss(): string {
  const v: string[] = [`--quality:${QUALITY_COLOR}`];
  for (const [t, l] of Object.entries(TIER_LOOK)) {
    v.push(`--tier-${t}:${l.color}`, `--tier-${t}-edge:${l.edge}`, `--tier-${t}-glow:${l.glow}`, `--tier-${t}-bg:${l.bg}`);
  }
  return `:root{${v.join(";")}}`;
}
