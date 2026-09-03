/**
 * Осмотр моделей ботов (Ф10): процедурные заглушки + персонажи из пака.
 * Запуск:  npx tsx scripts/inspect-bots.mts
 */
import { readFileSync } from "node:fs";
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import "@babylonjs/core/Loading/loadingScreen.js";
import "@babylonjs/loaders/glTF/2.0/index.js";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader.js";
import { makeBotBody } from "../src/client/entities/botModels";
import { recolorCharacter, BOT_SKIN_MODELS, MODELS } from "../src/client/world/models";

const engine = new NullEngine();
const scene = new Scene(engine);

console.log("--- процедурные заглушки ---");
const tint = Color3.FromHSV(210, 0.55, 0.85);
for (let v = 1; v <= 4; v++) {
  const root = makeBotBody(scene, v, tint);
  for (const n of root.getDescendants(false)) n.computeWorldMatrix(true);
  const meshes = root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    m.refreshBoundingInfo({});
    m.computeWorldMatrix(true);
    const bb = m.getBoundingInfo().boundingBox;
    lo = lo.map((n, i) => Math.min(n, bb.minimumWorld.asArray()[i]));
    hi = hi.map((n, i) => Math.max(n, bb.maximumWorld.asArray()[i]));
  }
  const size = hi.map((n, i) => +(n - lo[i]).toFixed(2));
  console.log(`  вариант ${v}: меши=${meshes.length} размер=${size.join("x")} низ=${lo[1].toFixed(2)} верх=${hi[1].toFixed(2)}`);
  root.dispose(false, true);
}

console.log("--- персонажи из пака ---");
const want = ["idle", "walk", "run", "swordslash"];
const shortName = (g: string): string => (g.split(/[|_]/).pop() ?? g).toLowerCase();
for (const key of BOT_SKIN_MODELS) {
  const path = "public" + MODELS[key];
  try {
    const uri = `data:model/gltf-binary;base64,${readFileSync(path).toString("base64")}`;
    const c = await LoadAssetContainerAsync(uri, scene, { pluginExtension: ".glb" });
    const inst = c.instantiateModelsToScene((n) => n, false);
    const root = inst.rootNodes[0];
    recolorCharacter(root as never);
    const meshes = root.getChildMeshes(false).filter((m) => m.getTotalVertices() > 0);
    root.computeWorldMatrix(true);
    for (const n of root.getDescendants(false)) n.computeWorldMatrix(true);
    let loY = Infinity, hiY = -Infinity;
    for (const m of meshes) {
      m.refreshBoundingInfo({});
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      loY = Math.min(loY, bb.minimumWorld.y);
      hiY = Math.max(hiY, bb.maximumWorld.y);
    }
    const h = hiY - loY;
    const clips = new Set(inst.animationGroups.map((g) => shortName(g.name)));
    const missing = want.filter((w) => !clips.has(w));
    const matNames = [...new Set(meshes.map((m) => m.material?.name))].join(",");
    console.log(
      `  ${key.padEnd(16)} нативная h=${h.toFixed(2)} → в игре ${(h * 0.52).toFixed(2)} м  меши=${meshes.length} ` +
        `клипов=${clips.size} ` +
        (missing.length ? `НЕТ ${missing.join(",")}` : "ok idle/walk/run/swordslash"),
    );
    if (key === BOT_SKIN_MODELS[0]) console.log(`     клипы: ${[...clips].join(", ")}\n     материалы: ${matNames}`);
    for (const g of inst.animationGroups) g.dispose();
    for (const s of inst.skeletons) s.dispose();
    root.dispose(false, true);
    c.dispose();
  } catch (e) {
    console.log(`  ${key}: ОШИБКА ${(e as Error).message}`);
  }
}

engine.dispose();
