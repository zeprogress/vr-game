import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import { loadTrees } from "../world/nature";
import { impostorsIs3D, impostorsUpdate } from "../world/TreeImpostors";
import type { LabCtx } from "./main";

/**
 * Деревья: модель против снимка-билборда — тем же кодом, что у спектатора
 * (loadTrees с noInstances + TreeImpostors). Ближний ряд — настоящие модели,
 * дальний — те же виды, но показаны снимками (как вдали, дальше 60 м).
 * Одинаковые масштаб и поворот, чтобы сравнить размер, форму и высоту.
 */
const KINDS = 5;
const GAP = 14;

export function build(ctx: LabCtx): void {
  const { scene, ui } = ctx;
  let yaw = 0;
  let showImp = true;
  // Ряд A (z=0) и ряд B (z=ROW) — одни и те же виды по порядку (вид = индекс % числу видов).
  const ROW = 22;
  const list: { x: number; z: number; scale: number; yaw: number }[] = [];
  for (const row of [0, ROW]) {
    for (let k = 0; k < KINDS; k++) list.push({ x: (k - (KINDS - 1) / 2) * GAP, z: row, scale: 1, yaw });
  }
  void loadTrees(scene, { heightAt: () => 0 }, false, true, list);
  ctx.frame(0, 6, ROW / 2, 70);

  let meshes: Mesh[] = [];
  let scanT = 0;
  ctx.onFrame((dt) => {
    scanT -= dt;
    if (scanT <= 0) {
      scanT = 1;
      meshes = scene.meshes.filter(
        (m) => !m.name.startsWith("impCap_") && (m.metadata as { impSys?: number } | null)?.impSys !== undefined,
      ) as Mesh[];
    }
    // «Камера решения» — не настоящая: стоит так, что ряд A ближе 60 м (модели),
    // ряд B дальше (снимки). Настоящая камера свободна — крути как хочешь.
    const decide = new Vector3(0, 2, showImp ? -45 : 1000);
    impostorsUpdate(decide, 0, 0, 1e5, showImp ? 60 : 1e4);
    for (const m of meshes) {
      if (m.isDisposed()) continue;
      const want = impostorsIs3D(m) !== false;
      if (m.isEnabled(false) !== want) m.setEnabled(want);
    }
  });

  ui.note(
    "Передний ряд — настоящие модели деревьев, задний — те же виды, но снимками (так они подменяются вдали у спектатора). " +
      "Порядок видов в рядах одинаковый. Покрути камеру, сравни размер, форму и высоту.",
  );
  ui.toggle("Задний ряд — снимки", showImp, (v) => (showImp = v));
  void yaw;
}
