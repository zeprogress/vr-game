import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";

import { SHIELD } from "#shared/constants";
import { weaponDef, type WeaponTier } from "#shared/items";
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

export function createShield(scene: Scene, tier: WeaponTier = "base", aegis = false): Mesh {
  // Эгида (старый уникальный щит) — свой прежний вид: фиолетовый треугольник.
  if (aegis) return createTriangleShield(scene, "legendary");
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

/**
 * Вытянутый треугольный щит: широкий верх, острый низ.
 *
 * Набран полосами убывающей ширины. Рукоять сидит ближе к широкому концу,
 * и НАЧАЛО КООРДИНАТ переносится в неё же — предмет крепится к руке своим
 * началом, значит держать щит игрок будет ровно за рукоять.
 */
function createTriangleShield(scene: Scene, tier: WeaponTier): Mesh {
  const tint = weaponDef("shield", tier).tint;

  const face = new StandardMaterial("shieldFace", scene);
  face.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
  face.emissiveColor = new Color3(tint[0] * 0.22, tint[1] * 0.2, tint[2] * 0.1);
  face.specularColor = new Color3(0.85, 0.8, 0.5);
  face.specularPower = 64;
  face.maxSimultaneousLights = 1;

  const grim = new StandardMaterial("shieldGrip", scene);
  grim.diffuseColor = new Color3(tint[0] * 0.45, tint[1] * 0.4, tint[2] * 0.25);
  grim.specularColor = new Color3(0.3, 0.3, 0.2);
  grim.maxSimultaneousLights = 1;

  const w = SHIELD.radius * 2; // ширина вверху
  const h = SHIELD.radius * 3.1; // высота: заметно вытянут
  /** Где сидит рукоять: ближе к широкому концу, а не по центру. */
  const gripZ = h * 0.3;

  // Треугольник набираем полосами убывающей ширины — верх широкий, низ острый.
  const parts: Mesh[] = [];
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const f = i / bands;
    const next = (i + 1) / bands;
    const bw = w * (1 - f) || 0.01;
    const band = MeshBuilder.CreateBox(
      `sh_band${i}`,
      { width: bw, height: 0.03, depth: h * (next - f) },
      scene,
    );
    band.position.z = h * 0.5 - h * (f + (next - f) / 2);
    band.material = face;
    parts.push(band);
  }

  const grip = MeshBuilder.CreateBox("sh_grip", { width: 0.12, height: 0.035, depth: 0.03 }, scene);
  grip.position.set(0, -0.05, gripZ);
  grip.material = grim;
  parts.push(grip);

  const shield = mergeToVertexColors(scene, parts);
  if (!shield) throw new Error("не удалось собрать треугольный щит");

  // Переносим начало координат в рукоять и разворачиваем — всё вживляем
  // в вершины, чтобы положение в руке настраивалось независимо от сборки.
  shield.position.z = -gripZ;
  shield.bakeCurrentTransformIntoVertices();
  shield.rotation.y = Math.PI / 2;
  shield.bakeCurrentTransformIntoVertices();
  shield.name = "shield";
  if (tier === "legendary") attachLegendaryGlow(scene, shield, 0.4, 1 / 1.5);
  return shield;
}
