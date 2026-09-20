import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { type WeaponTier } from "#shared/items";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { attachLegendaryGlow, spawnWeaponModel, tierTint } from "./weaponModels";

export interface BowParts {
  mesh: Mesh;
  /** Локальные точки: концы плеч и точка покоя тетивы (центр). */
  topTip: Vector3;
  bottomTip: Vector3;
  nockRest: Vector3;
}

/** Масштаб/поворот модели лука из пака к контракту: плечи по Y, живот к −Z. */
const BOW_FIT = { scale: 0.69, yaw: Math.PI / 2 } as const;

/**
 * В модели лука из пака есть своя тетива (отдельный подмеш с материалом «White»).
 * Рабочую тетиву рисует игра (CombatSystem.bowString), поэтому родную убираем.
 */
function dropModelString(fit: TransformNode): void {
  for (const m of fit.getChildMeshes(false)) {
    const mm = m.material;
    if (!(mm instanceof MultiMaterial)) continue;
    for (const sm of m.subMeshes.slice()) {
      const sub = mm.subMaterials[sm.materialIndex];
      if (sub && /white/i.test(sub.name)) sm.dispose();
    }
  }
}

/**
 * Лук — модель из пака. Начало координат в рукояти, плечи по оси Y,
 * прогиб (живот) к −Z, стрела летит в −Z.
 *
 * Лук в игре один (двумя руками не удержать, тетива/стрела привязаны к его
 * мешу), поэтому обе модели — обычная и золотая — висят на одном корне, а
 * `tintBow` просто переключает, какая включена.
 */
export function createBow(scene: Scene, tier: WeaponTier = "base"): BowParts {
  const root = new Mesh("bow", scene);
  root.isPickable = false;

  const wood = spawnWeaponModel(scene, "bow", BOW_FIT, dropModelString);
  wood.name = "bow_wood";
  wood.parent = root;

  const gold = spawnWeaponModel(scene, "bow_gold", {
    ...BOW_FIT,
    tint: tierTint("bow", tier), // легендарка — фиолетовый отлив
  }, dropModelString);
  gold.name = "bow_gold";
  gold.parent = root;

  applyBowTier(root, tier);
  if (tier === "legendary") attachLegendaryGlow(scene, root, 0.35, 0.5);

  const parts: BowParts = {
    mesh: root,
    topTip: new Vector3(),
    bottomTip: new Vector3(),
    nockRest: new Vector3(),
  };
  partsByRoot.set(root, parts);
  placeString(parts, tier);
  return parts;
}

/**
 * Тетива там, где была родная в модели (концы плеч): у обычного лука y=±0.638, z=0.255,
 * у золотого плечи длиннее — y=±0.703, z=0.285. Измерено по подмешу «White» модели.
 */
const STRING_ANCHORS = {
  base: { y: 0.638, z: 0.255 },
  gold: { y: 0.703, z: 0.285 },
} as const;

const partsByRoot = new WeakMap<Mesh, BowParts>();

function placeString(parts: BowParts, tier: WeaponTier): void {
  const a = tier === "base" ? STRING_ANCHORS.base : STRING_ANCHORS.gold;
  parts.topTip.set(0, a.y, a.z);
  parts.bottomTip.set(0, -a.y, a.z);
  parts.nockRest.set(0, 0, a.z);
}

function applyBowTier(root: Mesh, tier: WeaponTier): void {
  for (const n of root.getChildren()) {
    if (n.name === "bow_wood") n.setEnabled(tier === "base");
    else if (n.name === "bow_gold") n.setEnabled(tier !== "base");
  }
}

/**
 * Переключить лук на нужный уровень (обычный ↔ золотой). Меняется только
 * видимость двух вложенных моделей — сам меш-корень тот же.
 */
export function tintBow(mesh: Mesh, tier: WeaponTier): void {
  applyBowTier(mesh, tier);
  const parts = partsByRoot.get(mesh);
  if (parts) placeString(parts, tier); // точки тетивы — по плечам этой модели (векторы общие с CombatSystem)
}
