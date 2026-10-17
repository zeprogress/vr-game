import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { DUN_X, DUN_Y0, DUN_Z } from "#shared/dungeon";
import { dunGeometry } from "#shared/dungeonGeo";
import { buildGlb } from "#shared/glbWriter";
import { DungeonFx } from "../world/DungeonFx";
import type { LabCtx } from "./main";

/**
 * Подземелье «Глубинный храм» без сервера: тот же DungeonFx, что в игре (геометрия, набор модулей,
 * куски по зонам, LOD), камера — в ключевых точках глазами героя или облёт мышью.
 * Точки — как у рендер-превью (tools/blender/preview_dungeon.py), локальные координаты подземелья.
 */
const VIEWS: Record<string, [[number, number, number], [number, number, number]]> = {
  "B — зал руин → разлом": [[18, 56.2, -146], [0, 46, -70]],
  "C — площадка моста → зал Кольца": [[2, 48.8, -84], [0, 50, 10]],
  "E — мост над озером → водопад": [[-174, 27.8, 4], [-199, 34, -2]],
  "H — зал босса от ворот": [[0, 58, 130], [0, 62, 180]],
  "K — шахты": [[48, 54, -142], [130, 44, -120]],
  "T — обвальная галерея": [[-46, 53.5, -146], [-150, 34, -160]],
  "F — зал Кольца": [[-20, 41.8, 16], [20, 36, -30]],
  "S — ступени → озеро": [[-40, 41.5, -6], [-130, 22, 10]],
  "A — вход": [[0, 59.8, -196], [0, 54, -140]],
  "V — неф: колоннада": [[0, 57.8, 80], [0, 60, 120]],
  "V — с нефа на пещеру": [[4, 57.8, 100], [-120, 30, 60]],
  "G — с преддверия на пещеру": [[-20, 57.8, 60], [-150, 25, 0]],
};

export function build(ctx: LabCtx): void {
  const { scene, ui } = ctx;
  scene.clearColor = new Color4(0.01, 0.012, 0.02, 1);
  scene.getMeshByName("ground")?.setEnabled(false);
  const cam = scene.activeCamera as ArcRotateCamera;
  cam.upperRadiusLimit = 600;
  cam.maxZ = 2000;
  const fx = new DungeonFx(scene);
  const go = (name: string): void => {
    const [e, t] = VIEWS[name];
    cam.setTarget(new Vector3(DUN_X + t[0], DUN_Y0 + t[1], DUN_Z + t[2]));
    cam.setPosition(new Vector3(DUN_X + e[0], DUN_Y0 + e[1], DUN_Z + e[2]));
  };
  const names = Object.keys(VIEWS);
  ui.section("Точка обзора");
  ui.select("Вид", names, names[0], go);
  ui.note("Колесо — ближе/дальше, мышь — облёт вокруг цели. Свет пока общий (этап 5).");
  ui.section("Выгрузка");
  ui.button("⬇ геометрия подземелья (.glb)", exportDungeonGlb);
  ui.note("Чистая геометрия (как в игре, без LOD-дублей), сдвиг — как в мире. Текстуры в файл не входят: назначить в редакторе из public/textures/dungeon.");
  go(names[0]);
  ctx.onFrame((dt) => fx.update(dt, cam.position));
  (window as unknown as { __dun: unknown }).__dun = { fx, go, VIEWS };
}

/** Цвета материалов для выгрузки — ориентир в редакторе (текстуры в файл не входят). */
const EXPORT_COLORS: Record<string, [number, number, number]> = {
  floorStone: [0.45, 0.42, 0.38],
  floorRock: [0.35, 0.33, 0.3],
  cliff: [0.3, 0.28, 0.27],
  masonry: [0.4, 0.38, 0.36],
  wood: [0.4, 0.28, 0.18],
  water: [0.1, 0.25, 0.35],
  ceiling: [0.2, 0.19, 0.18],
  dome: [0.18, 0.18, 0.2],
};

/** Скачать геометрию подземелья одним .glb: зоны и материалы — мешами, корень — там же, где в игре. */
function exportDungeonGlb(): void {
  const parts = dunGeometry().map((p) => ({ name: `${p.zone}:${p.mat}`, mat: p.mat, pos: p.pos, idx: p.idx, uv: p.uv, col: p.col }));
  const glb = buildGlb(parts, { materials: EXPORT_COLORS, root: [DUN_X, DUN_Y0, DUN_Z] });
  const url = URL.createObjectURL(new Blob([glb.buffer as ArrayBuffer], { type: "model/gltf-binary" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "dungeon.glb";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
