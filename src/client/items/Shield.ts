import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { SHIELD } from "#shared/constants";
import type { WeaponTier } from "#shared/items";
import { attachLegendaryGlow } from "./weaponModels";
import { mergeToVertexColors } from "./flatMerge";

/**
 * Щит. Плоскость щита — XZ, «наружу» смотрит локальная ось +Y
 * (та же схема, что у меча: клинок вдоль +Y).
 *
 * Один и тот же круглый щит для всех тиров — меняется только окраска:
 * base — дерево с железом, gold — золото, legendary — фиолетовый с золотой
 * оковкой и свечением. Держатся одинаково: положение в руке настраивается
 * один раз на класс.
 */
const SHIELD_COLORS: Record<WeaponTier, { body: [number, number, number]; metal: [number, number, number]; glow: number }> = {
  base: { body: [0.2, 0.13, 0.08], metal: [0.62, 0.65, 0.7], glow: 0.25 },
  gold: { body: [0.85, 0.64, 0.18], metal: [1, 0.86, 0.4], glow: 0.18 },
  legendary: { body: [0.42, 0.18, 0.72], metal: [1, 0.84, 0.36], glow: 0.3 },
};

export function createShield(scene: Scene, tier: WeaponTier = "base"): Mesh {
  const c = SHIELD_COLORS[tier] ?? SHIELD_COLORS.base;
  const body = c.body;
  const metal = c.metal;
  const wood = new StandardMaterial("shieldWood", scene);
  wood.diffuseColor = new Color3(body[0], body[1], body[2]);
  wood.emissiveColor = new Color3(body[0] * c.glow, body[1] * c.glow, body[2] * c.glow);
  wood.specularColor = tier === "base" ? new Color3(0.1, 0.1, 0.1) : new Color3(0.6, 0.55, 0.4);
  wood.specularPower = tier === "base" ? 64 : 48;
  wood.maxSimultaneousLights = 1;

  const iron = new StandardMaterial("shieldIron", scene);
  iron.diffuseColor = new Color3(metal[0], metal[1], metal[2]);
  iron.emissiveColor = new Color3(metal[0] * 0.11, metal[1] * 0.11, metal[2] * 0.11);
  iron.specularColor = new Color3(0.7, 0.7, 0.7);
  iron.specularPower = 48;
  iron.maxSimultaneousLights = 1;

  const r = SHIELD.radius;

  const disc = MeshBuilder.CreateCylinder(
    "sh_body",
    { height: 0.035, diameter: r * 2, tessellation: 16 },
    scene,
  );
  disc.material = wood;

  const rim = MeshBuilder.CreateCylinder(
    "sh_rim",
    { height: 0.05, diameter: r * 2.06, tessellation: 16 },
    scene,
  );
  rim.material = iron;
  rim.scaling.y = 0.6;

  const boss = MeshBuilder.CreateSphere("sh_boss", { diameter: r * 0.55, segments: 8 }, scene);
  boss.position.y = 0.03;
  boss.scaling.y = 0.55;
  boss.material = iron;

  const grip = MeshBuilder.CreateBox("sh_grip", { width: 0.12, height: 0.03, depth: 0.03 }, scene);
  grip.position.y = -0.05;
  grip.material = wood;

  const shield = mergeToVertexColors(scene, [disc, rim, boss, grip]);
  if (!shield) throw new Error("не удалось собрать щит");
  shield.name = "shield";
  if (tier === "legendary") attachLegendaryGlow(scene, shield, 0.4, 1 / 1.5);
  return shield;
}
