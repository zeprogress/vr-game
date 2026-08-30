import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { weaponDef, type WeaponTier } from "#shared/items";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/**
 * Низкополигональный меч. Начало координат — в рукояти;
 * клинок направлен по локальной оси +Y, кончик примерно на y = 1.0.
 */
export function createSword(scene: Scene, tier: WeaponTier = "base"): Mesh {
  const t = weaponDef("sword", tier).tint;
  // Базовый меч — учебный, деревянный: клинок, гарда и навершие того же
  // цвета, что рукоять, и без металлического блеска.
  const wooden = tier === "base";

  const steel = new StandardMaterial("swordSteel", scene);
  steel.diffuseColor = new Color3(t[0], t[1], t[2]);
  steel.emissiveColor = new Color3(t[0] * 0.28, t[1] * 0.28, t[2] * 0.28); // не проваливается в чёрный
  steel.specularColor = wooden ? new Color3(0.06, 0.05, 0.04) : new Color3(1, 1, 1);
  // Высокая степень — блик тугой и яркий, как на полированном металле.
  steel.specularPower = wooden ? 8 : 160;

  const gold = new StandardMaterial("swordGold", scene);
  gold.diffuseColor = wooden ? new Color3(t[0], t[1], t[2]) : new Color3(0.7, 0.55, 0.24);
  gold.emissiveColor = wooden
    ? new Color3(t[0] * 0.28, t[1] * 0.28, t[2] * 0.28)
    : new Color3(0.2, 0.15, 0.05);
  gold.specularColor = wooden ? new Color3(0.06, 0.05, 0.04) : new Color3(1, 0.92, 0.6);
  gold.specularPower = wooden ? 8 : 128;

  const grip = new StandardMaterial("swordGrip", scene);
  grip.diffuseColor = new Color3(t[0], t[1], t[2]);
  grip.emissiveColor = new Color3(t[0] * 0.28, t[1] * 0.28, t[2] * 0.28);
  grip.specularColor = new Color3(0, 0, 0);

  const handle = MeshBuilder.CreateCylinder("s_handle", { height: 0.24, diameter: 0.05 }, scene);
  handle.position.y = -0.12;
  handle.material = grip;

  const pommel = MeshBuilder.CreateSphere("s_pommel", { diameter: 0.08, segments: 4 }, scene);
  pommel.position.y = -0.26;
  pommel.material = gold;

  const guard = MeshBuilder.CreateBox("s_guard", { width: 0.28, height: 0.05, depth: 0.06 }, scene);
  guard.material = gold;

  const blade = MeshBuilder.CreateBox("s_blade", { width: 0.07, height: 0.95, depth: 0.02 }, scene);
  blade.position.y = 0.5;
  blade.material = steel;

  const tip = MeshBuilder.CreateCylinder("s_tip", { height: 0.12, diameterBottom: 0.07, diameterTop: 0, tessellation: 4 }, scene);
  tip.position.y = 1.03;
  // Клинок плоский (0.07 x 0.02), поэтому и остриё сплющиваем до его толщины —
  // иначе на плоском лезвии торчит четырёхгранная пирамидка.
  tip.scaling.z = 0.02 / 0.07;
  tip.material = steel;

  const sword = Mesh.MergeMeshes([handle, pommel, guard, blade, tip], true, true, undefined, false, true);
  if (!sword) throw new Error("не удалось собрать меч");
  sword.name = "sword";
  return sword;
}

/**
 * Перекрасить клинок (класс меча). Рукоять и гарда не трогаются —
 * меняется только материал стали внутри общего мультиматериала.
 */
export function tintSword(mesh: Mesh, tint: readonly [number, number, number]): void {
  const mat = mesh.material;
  const subs = (mat as MultiMaterial | null)?.subMaterials ?? [mat];
  for (const m of subs) {
    if (!m || m.name !== "swordSteel") continue;
    const sm = m as StandardMaterial;
    sm.diffuseColor.set(tint[0], tint[1], tint[2]);
    sm.emissiveColor.set(tint[0] * 0.28, tint[1] * 0.28, tint[2] * 0.28);
  }
}
