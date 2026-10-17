import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGlb } from "../../src/shared/glbWriter";

/** Разбор GLB обратно: JSON и бинарный буфер. */
function parse(glb: Uint8Array): { json: any; bin: Uint8Array } {
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67, "магия glTF");
  assert.equal(dv.getUint32(4, true), 2, "версия 2");
  assert.equal(dv.getUint32(8, true), glb.byteLength, "длина файла");
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jl)));
  const bo = 20 + jl + 8;
  const bl = dv.getUint32(20 + jl, true);
  return { json, bin: glb.subarray(bo, bo + bl) };
}

const TRI = {
  name: "tri",
  mat: "stone",
  pos: [0, 0, 0, 1, 0, 0, 0, 0, 1],
  idx: [0, 1, 2],
};

test("GLB: заголовок, JSON и буфер сходятся", () => {
  const { json, bin } = parse(buildGlb([TRI], { root: [10, -500, 3] }));
  assert.equal(json.meshes.length, 1);
  assert.equal(json.materials[0].name, "stone");
  assert.equal(bin.byteLength, json.buffers[0].byteLength);
});

test("переход в правую систему: z меняет знак, обход треугольника разворачивается", () => {
  const { json, bin } = parse(buildGlb([TRI]));
  const posAcc = json.accessors[json.meshes[0].primitives[0].attributes.POSITION];
  const view = json.bufferViews[posAcc.bufferView];
  const f = new Float32Array(bin.buffer.slice(bin.byteOffset + view.byteOffset, bin.byteOffset + view.byteOffset + 36));
  assert.deepEqual(Array.from(f.slice(0, 3)), [0, 0, 0]);
  assert.deepEqual(Array.from(f.slice(6, 9)), [0, 0, -1], "третья вершина: z стал -1");
  assert.deepEqual(posAcc.min, [0, 0, -1]);
  assert.deepEqual(posAcc.max, [1, 0, 0]);
  const idxAcc = json.accessors[json.meshes[0].primitives[0].indices];
  const iv = json.bufferViews[idxAcc.bufferView];
  const ui = new Uint32Array(bin.buffer.slice(bin.byteOffset + iv.byteOffset, bin.byteOffset + iv.byteOffset + 12));
  assert.deepEqual(Array.from(ui), [0, 2, 1], "обход развёрнут");
});

test("корень получает сдвиг; нормали есть у каждой вершины", () => {
  const { json } = parse(buildGlb([TRI], { root: [10, -500, 3] }));
  const root = json.nodes.find((n: any) => n.name === "dungeon");
  assert.deepEqual(root.translation, [10, -500, 3]);
  const prim = json.meshes[0].primitives[0];
  assert.ok(prim.attributes.NORMAL !== undefined);
});

test("пустые части пропускаются, цвет вершин и UV — по наличию", () => {
  const empty = { name: "e", mat: "stone", pos: [], idx: [] };
  const withUv = { ...TRI, name: "uv", uv: [0, 0, 1, 0, 0, 1], col: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const { json } = parse(buildGlb([empty, withUv]));
  assert.equal(json.meshes.length, 1);
  const attrs = json.meshes[0].primitives[0].attributes;
  assert.ok(attrs.TEXCOORD_0 !== undefined);
  assert.ok(attrs.COLOR_0 !== undefined);
});
