/**
 * Шаг бота в подземелье вдоль стены. Раньше шаг, пересекающий стену, отменялся целиком и гасил скорость:
 * бота, прижатого к стене телом гиганта или стража (их тело крупное, мобы отталкивают бота к стене), он
 * упирался и стоял. Теперь стена режет только свою составляющую: ось, по которой шаг проходим, остаётся.
 *
 * clear(x0, z0, x1, z1) — проходима ли прямая в подземелье (dunClear). Возвращает итоговую позицию и,
 * по каким осям шаг срезан (чтобы погасить скорость только в ту сторону).
 */
export function wallSlide(
  x0: number,
  z0: number,
  nx: number,
  nz: number,
  clear: (x0: number, z0: number, x1: number, z1: number) => boolean,
): { x: number; z: number; blockX: boolean; blockZ: boolean } {
  if (clear(x0, z0, nx, nz)) return { x: nx, z: nz, blockX: false, blockZ: false };
  const okX = nx === x0 || clear(x0, z0, nx, z0);
  const okZ = nz === z0 || clear(x0, z0, x0, nz);
  if (okX && okZ) {
    // Обе оси по отдельности проходимы, а по диагонали — угол стены: идём по той, что длиннее.
    return Math.abs(nx - x0) >= Math.abs(nz - z0)
      ? { x: nx, z: z0, blockX: false, blockZ: true }
      : { x: x0, z: nz, blockX: true, blockZ: false };
  }
  if (okX) return { x: nx, z: z0, blockX: false, blockZ: true };
  if (okZ) return { x: x0, z: nz, blockX: true, blockZ: false };
  return { x: x0, z: z0, blockX: true, blockZ: true };
}
