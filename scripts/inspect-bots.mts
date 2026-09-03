/**
 * Осмотр процедурных ботов (botModels.ts): габариты и число мешей для 4 вариантов.
 * Запуск:  npx tsx scripts/inspect-bots.mts
 */
import { NullEngine } from "@babylonjs/core/Engines/nullEngine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Color3 } from "@babylonjs/core/Maths/math.color.js";
import "@babylonjs/core/Loading/loadingScreen.js";
import { makeBotBody } from "../src/client/entities/botModels";

const engine = new NullEngine();
const scene = new Scene(engine);

const tint = Color3.FromHSV(210, 0.55, 0.85); // типичный цвет аватара

for (let v = 1; v <= 4; v++) {
  const root = makeBotBody(scene, v, tint);
  for (const n of root.getDescendants(false)) n.computeWorldMatrix(true);
  root.computeWorldMatrix(true);
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
  console.log(
    `variant ${v}: меши=${meshes.length} [${meshes.map((m) => m.name).join(", ")}]  ` +
      `размер WxHxD=${size.join("x")}  низ y=${lo[1].toFixed(2)} верх y=${hi[1].toFixed(2)}`,
  );
  root.dispose(false, true);
}

engine.dispose();
