/**
 * «Помощь в разработке» (страница инвентаря): ошибки и предложения от игроков.
 * Единый источник для сервера (FeedbackStore, InventoryRoom) и страницы (client/inv):
 * виды, пометки админа, подписи и цвета, лимиты.
 */
export const FEEDBACK_KINDS = ["bug", "idea"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Пометка админа; без пометки запись серая — так её оставил игрок. */
export const FEEDBACK_MARKS = ["inProgress", "done", "rejected"] as const;
export type FeedbackMark = (typeof FEEDBACK_MARKS)[number];

/** Подписи пометок у каждого вида: у ошибок и предложений «готово» и «отклонено» называются по-своему. */
export const FEEDBACK_KIND_INFO: Record<FeedbackKind, { tab: string; hint: string; placeholder: string; marks: Record<FeedbackMark, string> }> = {
  bug: {
    tab: "🐞 Ошибки",
    hint: "Опиши, что пошло не так: где, что делал, что ожидал и что получилось.",
    placeholder: "Например: при обмене с ботом кнопка «подтвердить» не нажимается…",
    marks: { inProgress: "В работе", done: "Исправлено", rejected: "Отклонено, так как не подтвердилось" },
  },
  idea: {
    tab: "💡 Предложение",
    hint: "Что добавить или поменять в игре и зачем.",
    placeholder: "Например: хочу, чтобы кольца можно было ставить в избранное…",
    marks: { inProgress: "В работе", done: "Принято и добавлено", rejected: "Отклонено" },
  },
};

/** Цвета пометок: зелёный — готово, жёлтый — в работе, красный — отклонено; без пометки — серый. */
export const FEEDBACK_MARK_COLOR: Record<FeedbackMark, string> = { inProgress: "#e8c26a", done: "#6fcf7a", rejected: "#e0645a" };
export const FEEDBACK_NO_MARK_COLOR = "#8f8a7e";

/** Длина текста, символов. */
export const FEEDBACK_TEXT_MAX = 1000;
/** Между отправками одного героя — не чаще раза в 20 с (от спама). */
export const FEEDBACK_COOLDOWN_MS = 20_000;

export function isFeedbackKind(v: unknown): v is FeedbackKind {
  return (FEEDBACK_KINDS as readonly unknown[]).includes(v);
}

export function isFeedbackMark(v: unknown): v is FeedbackMark {
  return (FEEDBACK_MARKS as readonly unknown[]).includes(v);
}

/** Запись, как её видит страница: ник автора, текст, время отправки и пометка (null — серая). */
export interface FeedbackView {
  id: string;
  nick: string;
  text: string;
  /** Мс с эпохи. */
  at: number;
  mark: FeedbackMark | null;
}
