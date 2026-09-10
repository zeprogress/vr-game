/**
 * Фоновая музыка. Общий список для игры и стрим-спектатора (раньше был
 * продублирован в обоих — разъезжался).
 *
 * `TOWN_MUSIC` — спокойный фон: после каждого трека берётся случайный из
 * набора. `BOSS_MUSIC` — рядом с живым боссом.
 */
export const TOWN_MUSIC = [
  "/music/castle-hall-1.mp3",
  "/music/castle-hall-2.mp3",
  "/music/village-waltz-1.mp3",
  "/music/village-waltz-2.mp3",
  "/music/village-dawn.mp3",
  "/music/medieval-dawn.mp3",
  "/music/moonlit-meadow-path.mp3",
];

export const BOSS_MUSIC = "/music/boss.mp3";
