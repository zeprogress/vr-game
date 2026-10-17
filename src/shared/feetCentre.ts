/** Вершины одного меша: позиции из буфера (x, y, z подряд) и его мировая матрица (16 чисел, как у Babylon). */
export interface MeshVerts {
  pos: ArrayLike<number>;
  world: ArrayLike<number>;
}

/** Доля роста снизу, которую считаем «ступнями». */
export const FEET_BAND = 0.1;

/**
 * Середина между ногами модели: центр двух групп нижних вершин (нижние `band` роста). Группы делим
 * по самому широкому просвету по X. Результат — в координатах корня: `origin` (мировая позиция
 * корня) вычитается, поэтому замер годится и для корня, стоящего в любой точке мира. Корень на
 * замере должен быть без масштаба и курса (как замер следа). null — двух групп нет.
 */
export function feetCentre(
  parts: readonly MeshVerts[],
  origin: { x: number; z: number },
  band = FEET_BAND,
): { x: number; z: number } | null {
  const pts: number[] = []; // x, y, z по всем вершинам — в координатах корня
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { pos, world: w } of parts) {
    for (let i = 0; i + 2 < pos.length; i += 3) {
      const px = pos[i];
      const py = pos[i + 1];
      const pz = pos[i + 2];
      const y = px * w[1] + py * w[5] + pz * w[9] + w[13];
      pts.push(px * w[0] + py * w[4] + pz * w[8] + w[12] - origin.x, y, px * w[2] + py * w[6] + pz * w[10] + w[14] - origin.z);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!(maxY > minY)) return null;
  const limit = minY + band * (maxY - minY);
  const low: number[] = []; // смещения нижних вершин в pts
  for (let i = 0; i < pts.length; i += 3) if (pts[i + 1] <= limit) low.push(i);
  if (low.length < 2) return null;
  low.sort((a, b) => pts[a] - pts[b]);
  let cut = 1;
  let gap = -Infinity;
  for (let k = 1; k < low.length; k++) {
    const g = pts[low[k]] - pts[low[k - 1]];
    if (g > gap) {
      gap = g;
      cut = k;
    }
  }
  const centre = (idx: number[]): { x: number; z: number } => {
    let sx = 0;
    let sz = 0;
    for (const i of idx) {
      sx += pts[i];
      sz += pts[i + 2];
    }
    return { x: sx / idx.length, z: sz / idx.length };
  };
  const a = centre(low.slice(0, cut));
  const b = centre(low.slice(cut));
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}
