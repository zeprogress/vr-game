/** Тяга назад за каждый метр сверх края круга, 1/с. */
const PULL = 4;
/** Потолок тяги назад, м/с — примерно скорость бега героя. */
const PULL_MAX = 6;

/**
 * Поводок кемпа для дальников и копейщиков-кайтеров (шаг бота в ZoneRoom).
 *
 * Моб бросает погоню, как только уходит дальше MOB.leashDistance от точки своего спавна
 * (ZoneSim) и встаёт. Если бот отходит дальше, мобы за ним не идут: он стреляет в пустоту.
 * Поэтому наружу от точки спавна цели скорость не пускаем: у края круга `lim` откат идёт вдоль
 * края (по касательной), сверх края бота тянет назад. Если откат строго радиальный (моб точно на
 * линии «дом — бот»), касательной нет — бот уходит боком в сторону `side` (±1), а не встаёт.
 * Внутри круга скорость не меняется.
 */
export function leashCut(
  vx: number,
  vz: number,
  px: number,
  pz: number,
  hx: number,
  hz: number,
  lim: number,
  side = 1,
): [number, number] {
  const lx = px - hx;
  const lz = pz - hz;
  const ld = Math.hypot(lx, lz);
  // Запас полметра до края: инерция скорости всё равно перелетает его на шаг.
  const edge = lim - 0.5;
  if (ld <= edge) return [vx, vz];
  const ux = lx / ld;
  const uz = lz / ld;
  const sp = Math.hypot(vx, vz);
  const rv = vx * ux + vz * uz; // радиальная скорость, наружу > 0
  // Наружу не пускаем, а сверх края тянем назад: касательный ход и инерция иначе выносят наружу.
  const pull = Math.min(PULL * (ld - edge), PULL_MAX);
  const rvNew = Math.min(rv, 0) - pull;
  let nx = vx + (rvNew - rv) * ux;
  let nz = vz + (rvNew - rv) * uz;
  // Касательной почти не осталось (откат радиальный): уходим боком вдоль края.
  if (rv > 0) {
    const tx = -uz;
    const tz = ux;
    const tan = nx * tx + nz * tz;
    if (Math.abs(tan) < 0.3 * sp) {
      const want = side * 0.8 * sp;
      nx += (want - tan) * tx;
      nz += (want - tan) * tz;
    }
  }
  return [nx, nz];
}
