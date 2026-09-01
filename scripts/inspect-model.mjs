/**
 * Осмотр .glb: меши, материалы, анимации, габариты, ось «переда».
 * Запуск:  node scripts/inspect-model.mjs public/models/slime.glb
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, extname } from "node:path";

const arg = process.argv[2];
if (!arg) {
  console.error("укажи путь: node scripts/inspect-model.mjs public/models/slime.glb");
  process.exit(1);
}

const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
const { Scene } = await import("@babylonjs/core/scene.js");
await import("@babylonjs/core/Loading/loadingScreen.js");
await import("@babylonjs/loaders/glTF/2.0/index.js");
const { LoadAssetContainerAsync } = await import("@babylonjs/core/Loading/sceneLoader.js");

const engine = new NullEngine();
const scene = new Scene(engine);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = arg.startsWith("/") ? arg : join(root, arg);
const ext = extname(path).toLowerCase() || ".glb";
const mime = ext === ".glb" ? "model/gltf-binary" : "model/gltf+json";
const dataUri = `data:${mime};base64,${readFileSync(path).toString("base64")}`;

const c = await LoadAssetContainerAsync(dataUri, scene, { pluginExtension: ext });

console.log("=== " + basename(path) + " ===");
console.log("meshes:", c.meshes.length);
for (const m of c.meshes) {
  const v = m.getTotalVertices?.() ?? 0;
  console.log(`  · ${m.name}  verts=${v}  mat=${m.material?.name ?? "-"} (${m.material?.getClassName?.() ?? "-"})`);
}

console.log("materials:", c.materials.length);
for (const mat of c.materials) {
  const col =
    mat.albedoColor?.asArray?.().map((n) => +n.toFixed(2)) ??
    mat.diffuseColor?.asArray?.().map((n) => +n.toFixed(2)) ??
    "-";
  console.log(`  · ${mat.name} (${mat.getClassName()})  color=${JSON.stringify(col)}  textures=${mat.getActiveTextures?.().length ?? 0}`);
}

console.log("animationGroups:", c.animationGroups.length);
for (const g of c.animationGroups) {
  console.log(`  · "${g.name}"  from=${g.from} to=${g.to}  targets=${g.targetedAnimations.length}`);
}

console.log("skeletons:", c.skeletons.length, c.skeletons.map((s) => `${s.name}(${s.bones.length} bones)`).join(", "));

// габариты всей модели
c.meshes.forEach((m) => m.computeWorldMatrix(true));
let mn = null;
let mx = null;
for (const m of c.meshes) {
  if (!m.getBoundingInfo || m.getTotalVertices?.() === 0) continue;
  m.refreshBoundingInfo?.();
  const bb = m.getBoundingInfo().boundingBox;
  const lo = bb.minimumWorld;
  const hi = bb.maximumWorld;
  mn = mn ? mn.map((n, i) => Math.min(n, [lo.x, lo.y, lo.z][i])) : [lo.x, lo.y, lo.z];
  mx = mx ? mx.map((n, i) => Math.max(n, [hi.x, hi.y, hi.z][i])) : [hi.x, hi.y, hi.z];
}
if (mn) {
  console.log("bounds min:", mn.map((n) => +n.toFixed(3)));
  console.log("bounds max:", mx.map((n) => +n.toFixed(3)));
  console.log(
    "size (WxHxD):",
    [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]].map((n) => +n.toFixed(3)),
  );
}

engine.dispose();
