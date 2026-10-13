import type { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

import { DUN_X, DUN_Y0, DUN_Z } from "#shared/dungeon";
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
  go(names[0]);
  ctx.onFrame((dt) => fx.update(dt, cam.position));
  (window as unknown as { __dun: unknown }).__dun = { fx, go, VIEWS };
}
