/**
 * Сборка GLB (glTF 2.0 в одном файле) из чистых массивов — без движка, для выгрузки геометрии
 * подземелья в редактор. Координаты переводятся из осей Babylon (левая система) в glTF (правая):
 * z меняем знаком и разворачиваем обход треугольников, иначе редактор отзеркалит сцену.
 */

export interface GlbPart {
  /** Имя меша (отображается в редакторе). */
  name: string;
  /** Материал по имени (см. materials). */
  mat: string;
  /** Позиции x,y,z подряд (оси Babylon). */
  pos: readonly number[];
  /** Треугольники: тройки индексов в pos. */
  idx: readonly number[];
  /** Текстурные координаты u,v подряд (необязательно). */
  uv?: readonly number[];
  /** Цвет вершин r,g,b подряд (необязательно). */
  col?: readonly number[];
}

export interface GlbOptions {
  /** Цвет материалов по имени (0..1). Незнакомые имена — серый. */
  materials?: Readonly<Record<string, readonly [number, number, number]>>;
  /** Сдвиг корня (оси Babylon) — чтобы объект встал там же, где в игре. */
  root?: readonly [number, number, number];
}

const PAD = 4;

function padTo4(n: number): number {
  return (PAD - (n % PAD)) % PAD;
}

export function buildGlb(parts: readonly GlbPart[], opts: GlbOptions = {}): Uint8Array {
  const matNames: string[] = [];
  const matIndex = new Map<string, number>();
  const matOf = (name: string): number => {
    let i = matIndex.get(name);
    if (i === undefined) {
      i = matNames.length;
      matIndex.set(name, i);
      matNames.push(name);
    }
    return i;
  };

  // Бинарный буфер: все атрибуты подряд, каждый выровнен по 4 байтам.
  const chunks: Uint8Array[] = [];
  let binLen = 0;
  const push = (bytes: Uint8Array): number => {
    const at = binLen;
    chunks.push(bytes);
    binLen += bytes.byteLength;
    const pad = padTo4(binLen);
    if (pad) {
      chunks.push(new Uint8Array(pad));
      binLen += pad;
    }
    return at;
  };

  const accessors: unknown[] = [];
  const bufferViews: unknown[] = [];
  const addView = (bytes: Uint8Array): number => {
    const off = push(bytes);
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength });
    return bufferViews.length - 1;
  };
  const addAccessor = (view: number, type: string, componentType: number, count: number, extra: Record<string, unknown> = {}): number => {
    accessors.push({ bufferView: view, componentType, count, type, ...extra });
    return accessors.length - 1;
  };

  const meshes: unknown[] = [];
  const nodes: unknown[] = [];
  const meshNodes: number[] = [];

  for (const part of parts) {
    const n = part.pos.length / 3;
    if (n === 0 || part.idx.length === 0) continue;
    // Переход в правую систему: z → -z, обход треугольника разворачиваем (i0, i2, i1).
    const pos = new Float32Array(n * 3);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = part.pos[i * 3];
      const y = part.pos[i * 3 + 1];
      const z = 0 - part.pos[i * 3 + 2]; // 0 - z, а не -z: у нуля не появляется знак минус
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
    const tris = part.idx.length / 3;
    const idx = new Uint32Array(tris * 3);
    for (let t = 0; t < tris; t++) {
      idx[t * 3] = part.idx[t * 3];
      idx[t * 3 + 1] = part.idx[t * 3 + 2];
      idx[t * 3 + 2] = part.idx[t * 3 + 1];
    }
    // Нормали — усреднённые по площади треугольников (в новой системе).
    const nrm = new Float32Array(n * 3);
    for (let t = 0; t < tris; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      for (const v of [a, b, c]) {
        nrm[v] += nx;
        nrm[v + 1] += ny;
        nrm[v + 2] += nz;
      }
    }
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
      nrm[i * 3] /= l;
      nrm[i * 3 + 1] /= l;
      nrm[i * 3 + 2] /= l;
    }

    const attributes: Record<string, number> = {};
    attributes.POSITION = addAccessor(addView(new Uint8Array(pos.buffer)), "VEC3", 5126, n, {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
    attributes.NORMAL = addAccessor(addView(new Uint8Array(nrm.buffer)), "VEC3", 5126, n);
    if (part.uv && part.uv.length === n * 2) {
      attributes.TEXCOORD_0 = addAccessor(addView(new Uint8Array(new Float32Array(part.uv).buffer)), "VEC2", 5126, n);
    }
    if (part.col && part.col.length === n * 3) {
      attributes.COLOR_0 = addAccessor(addView(new Uint8Array(new Float32Array(part.col).buffer)), "VEC3", 5126, n);
    }
    const indices = addAccessor(addView(new Uint8Array(idx.buffer)), "SCALAR", 5125, tris * 3);

    meshes.push({
      name: part.name,
      primitives: [{ attributes, indices, material: matOf(part.mat), mode: 4 }],
    });
    nodes.push({ name: part.name, mesh: meshes.length - 1 });
    meshNodes.push(nodes.length - 1);
  }

  const root = opts.root ?? [0, 0, 0];
  nodes.push({ name: "dungeon", translation: [root[0], root[1], root[2]], children: meshNodes });
  const rootNode = nodes.length - 1;

  const materials = matNames.map((name) => {
    const c = opts.materials?.[name] ?? [0.5, 0.5, 0.5];
    return { name, pbrMetallicRoughness: { baseColorFactor: [c[0], c[1], c[2], 1], metallicFactor: 0, roughnessFactor: 1 } };
  });

  const json = {
    asset: { version: "2.0", generator: "zep lab (dungeon export)" },
    scene: 0,
    scenes: [{ nodes: [rootNode] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binLen }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = padTo4(jsonBytes.byteLength);
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.byteLength + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.byteLength);
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.byteLength + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.byteLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.byteLength;
  dv.setUint32(o, binLen, true);
  dv.setUint32(o + 4, 0x004e4942, true); // "BIN\0"
  o += 8;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}
