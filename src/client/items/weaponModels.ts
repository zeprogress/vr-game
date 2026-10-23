import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Effect } from "@babylonjs/core/Materials/effect";
import { Constants } from "@babylonjs/core/Engines/constants";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

import { containerFor, recolorFlat } from "../world/models";
import { flattenToVertexColors } from "./flatMerge";
import { sharpGlowMul, weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import { radialGlowTexture } from "../ui/GlowSprite";
import { sharpGlowTune, sharpGlowVersion } from "./sharpGlowTune";

/**
 * Фиолетовое пульсирующее свечение уникального оружия — плоский спрайт, который
 * ВЕРШИННЫЙ ШЕЙДЕР сам разворачивает к глазам (по осям матрицы вида), поэтому
 * ему не нужен ни billboardMode (пересчёт матрицы на CPU каждый кадр, из-за
 * которого свечение «плыло» при движении стиком), ни покадровый JS: пульсация
 * тоже в шейдере, время подставляется при привязке материала. Материал и
 * текстура общие на сцену (по яркости).
 */
const GLOW = "legendGlow";
Effect.ShadersStore[`${GLOW}VertexShader`] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 view;
uniform mat4 viewProjection;
#ifdef MULTIVIEW
uniform mat4 viewProjectionR;
#endif
uniform float uT;
uniform float uAmp;
varying vec2 vUV;
varying float vA;
varying float vS;
void main() {
  float p = 0.85 + sin(uT * 3.0) * 0.15;
  vA = (0.36 + p * 0.36) * uAmp;
  vS = 0.5 + 0.5 * sin(uT * 2.1 + position.x * 4.0 + position.y * 3.0);
  vUV = uv;
  vec3 c = world[3].xyz;
  float sc = length(world[0].xyz) * p;
  vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
  vec3 up = vec3(view[0][1], view[1][1], view[2][1]);
  vec3 wp = c + (right * position.x + up * position.y) * sc;
#ifdef MULTIVIEW
  if (gl_ViewID_OVR == 0u) { gl_Position = viewProjection * vec4(wp, 1.0); } else { gl_Position = viewProjectionR * vec4(wp, 1.0); }
#else
  gl_Position = viewProjection * vec4(wp, 1.0);
#endif
}
`;
Effect.ShadersStore[`${GLOW}FragmentShader`] = `
precision highp float;
varying vec2 vUV;
varying float vA;
varying float vS;
uniform sampler2D tex;
uniform vec3 uCol;
uniform vec3 uCol2;
uniform float uShim;
void main() {
  // Перелив (крафт, uShim 1): цвет волной уходит к золотому и обратно; без uShim — ровный цвет тира.
  // Скрытый рецепт (uShim 2): волна резче и доходит до золота полностью, на гребне свечение ярче.
  float strong = clamp(uShim - 1.0, 0.0, 1.0);
  float s = mix(vS, smoothstep(0.15, 0.85, vS), strong);
  vec3 col = mix(uCol, uCol2, s * min(uShim, 1.0));
  float a = texture2D(tex, vUV).a * vA * (1.0 + 0.8 * strong * s);
  gl_FragColor = vec4(col, a);
}
`;

const glowMats = new WeakMap<Scene, Map<string, ShaderMaterial>>();

/** Цвет свечения по тиру: уникальное — фиолетовое, рубиновое — алое, мастерское (крафт) — тёмно-оранжевое. */
const GLOW_COL = { legendary: new Color3(0.6, 0.22, 1), ruby: new Color3(1, 0.1, 0.22), craft: new Color3(1, 0.38, 0.02) } as const;
/** Тир со свечением (уникальное, рубиновое, мастерское). */
export type GlowTier = keyof typeof GLOW_COL;
export function isGlowTier(t: string): t is GlowTier {
  return t in GLOW_COL;
}

/** Цвет перелива мастерского свечения (к нему уходит волна). */
const GLOW_SHIMMER = new Color3(1, 0.82, 0.36);

/** Свечение оружия по скрытому рецепту (2026-10-23): шире в size раз, перелив заметнее (uShim 2). */
export const RECIPE_GLOW = { size: 1.5 } as const;

/** shim: 0 — ровный цвет тира, 1 — перелив мастерского, 2 — сильный перелив скрытого рецепта. */
function glowMaterial(scene: Scene, amp: number, col: Color3 = GLOW_COL.legendary, shim = 0): ShaderMaterial {
  let byAmp = glowMats.get(scene);
  if (!byAmp) glowMats.set(scene, (byAmp = new Map()));
  const key = `${amp}|${col.toHexString()}|${shim}`;
  let mat = byAmp.get(key);
  if (!mat) {
    mat = new ShaderMaterial(`${GLOW}Mat${key}`, scene, GLOW, {
      attributes: ["position", "uv"],
      uniforms: ["world", "view", "viewProjection", "uT", "uAmp", "uCol", "uCol2", "uShim"],
      samplers: ["tex"],
      needAlphaBlending: true,
    });
    mat.setTexture("tex", radialGlowTexture(scene));
    mat.setFloat("uAmp", amp);
    mat.setColor3("uCol", col);
    mat.setColor3("uCol2", GLOW_SHIMMER);
    mat.setFloat("uShim", shim);
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    const m = mat;
    mat.onBindObservable.add(() => m.getEffect()?.setFloat("uT", performance.now() / 1000));
    byAmp.set(key, mat);
  }
  return mat;
}

/** Базовое свечение шелла, как его создали: сила и цвет — чтобы менять по точкам без пересборки. */
const glowBase = new WeakMap<Mesh, { amp: number; col: Color3; shim: boolean }>();
/** Последняя применённая прибавка по корню оружия (и номер настройки): пересчёт только при смене. */
const sharpApplied = new WeakMap<TransformNode, { pct: number; ver: number; rc: boolean }>();

export function attachLegendaryGlow(
  scene: Scene,
  host: Mesh,
  radius = 0.6,
  /** Множитель яркости — не размера. Оружие ×0.5, Эгида ×(1/1.5) по просьбе. */
  intensity = 1,
  /** Тир свечения: уникальное — фиолетовое, рубиновое — алое и ярче, мастерское — тёмно-оранжевое. */
  tier: GlowTier = "legendary",
  /** Где светит: точка в системе хоста (у оружия — на клинке, наконечнике, камне; по умолчанию — в руке). */
  at: Vector3 = Vector3.Zero(),
): void {
  const shell = MeshBuilder.CreatePlane("legGlow", { size: radius * 2 }, scene);
  const amp = Math.round(intensity * (tier === "ruby" ? 1.4 : tier === "craft" ? 1.2 : 1) * 1000) / 1000;
  shell.material = glowMaterial(scene, amp, GLOW_COL[tier], tier === "craft" ? 1 : 0);
  glowBase.set(shell, { amp, col: GLOW_COL[tier], shim: tier === "craft" });
  shell.isPickable = false;
  shell.parent = host;
  shell.position.copyFrom(at);
  // Развёрнут шейдером, а рамка у плоскости остаётся «плашмя»: не даём отсечь его по ней.
  shell.alwaysSelectAsActiveMesh = true;
}

/** Забыть применённую прибавку: у корня появилось новое свечение (лук стал уникальным) — пересчитаем в ближайший кадр. */
export function forgetSharpGlow(root: TransformNode): void {
  sharpApplied.delete(root);
}

/**
 * Свечение оружия в руке по точкам атаки: без прибавки не горит, с каждой точкой светит
 * сильнее (сила) и шире (радиус); на +10 точках — как было (sharpGlowMul). Зовётся каждый
 * кадр, но пересчитывает только при смене прибавки или настройки (sharpGlowTune). Щит сюда
 * не передаём; лут на земле свечение не меняет — ему эту функцию не зовут. rc — оружие по скрытому рецепту.
 */
export function applySharpGlow(root: TransformNode, pct: number, rc = false): void {
  const ver = sharpGlowVersion();
  const done = sharpApplied.get(root);
  if (done && done.pct === pct && done.ver === ver && done.rc === rc) return;
  sharpApplied.set(root, { pct, ver, rc });
  const strength = sharpGlowMul(pct, sharpGlowTune.strength);
  const radius = sharpGlowMul(pct, sharpGlowTune.radius);
  for (const c of root.getChildMeshes(false, (n) => glowBase.has(n as Mesh))) {
    const g = c as Mesh;
    const base = glowBase.get(g)!;
    g.isVisible = pct > 0;
    if (pct <= 0) continue;
    // Скрытый рецепт: аура шире и перелив сильнее (только у мастерского — у него и есть перелив).
    const recipe = rc && base.shim;
    g.scaling.setAll(radius * (recipe ? RECIPE_GLOW.size : 1));
    g.material = glowMaterial(g.getScene(), Math.round(base.amp * strength * 1000) / 1000, base.col, recipe ? 2 : base.shim ? 1 : 0);
  }
}

/**
 * Цвет для перекраски оружия по тиру. base/gold — цвет из пака (undefined),
 * legendary — цвет аффикса (огонь / охота / эгида / буря), из WeaponDef.tint.
 */
export function tierTint(cls: WeaponClass, tier: WeaponTier): Color3 | undefined {
  if (!isGlowTier(tier)) return undefined;
  const t = weaponDef(cls, tier).tint;
  return new Color3(t[0], t[1], t[2]);
}

/**
 * Модели оружия из пака (Ultimate RPG Items Pack, Quaternius): только плоские
 * цвета материалов, без текстур. Конверсия OBJ→glb — `obj2gltf`, файлы в
 * `public/models/weapons/`.
 *
 * Фабрики оружия синхронные (их зовёт конструктор CombatSystem), поэтому
 * `spawnWeaponModel` сразу отдаёт пустой корневой Mesh, а модель подвешивает
 * на него, когда догрузится контейнер. Попадания считаются по локальным
 * точкам-константам (кончик клинка и т.п.), не по геометрии, — оружие «бьёт»
 * даже за тот кадр, пока меш ещё летит по сети.
 */

export const WEAPON_MODELS = {
  sword: "/models/weapons/sword.glb",
  sword_gold: "/models/weapons/sword_gold.glb",
  bow: "/models/weapons/bow.glb",
  bow_gold: "/models/weapons/bow_gold.glb",
  crystal: "/models/weapons/crystal.glb",
  // Оружие «Классов 2.0» (пока только лаборатория): кинжал и молот — из того
  // же пака, копьё — собрано в Blender (scripts/blender-class-weapons.py).
  dagger: "/models/weapons/dagger.glb",
  dagger_gold: "/models/weapons/dagger_gold.glb",
  hammer: "/models/weapons/hammer.glb",
  hammer_gold: "/models/weapons/hammer_gold.glb",
  spear: "/models/weapons/spear.glb",
  spear_gold: "/models/weapons/spear_gold.glb",
} as const;

export type WeaponModel = keyof typeof WEAPON_MODELS;

export interface WeaponFit {
  /** Равномерный масштаб модели. */
  scale: number;
  /** Довороты модели перед подвесом (класс-специфичны). */
  yaw?: number;
  pitch?: number;
  roll?: number;
  /** Сдвиг после масштаба/поворота — чтобы точка хвата совпала с origin. */
  offset?: Vector3;
  /** Принудительный цвет всех материалов (иначе из пака). */
  tint?: Color3;
  /** Куда вешать (по умолчанию — на возвращаемый root). */
  parent?: TransformNode;
}

/**
 * Прогреть контейнеры оружия, лежащего в мире с самого старта (меч + лук).
 * Золото и кристалл грузятся лениво при первом обращении — на слабом
 * браузере шлема лишние параллельные загрузки при заходе только мешают.
 */
export function preloadWeaponModels(scene: Scene): void {
  void containerFor(scene, WEAPON_MODELS.sword);
  void containerFor(scene, WEAPON_MODELS.bow);
}

/**
 * Синхронно вернуть корневой Mesh; асинхронно наполнить его плоскошейдерной
 * копией модели `key`, приведённой к локальному контракту оружия.
 * `onReady` — когда модель уже висит (для доводки конкретным классом).
 */
export function spawnWeaponModel(
  scene: Scene,
  key: WeaponModel,
  fit: WeaponFit,
  onReady?: (fitNode: TransformNode) => void,
): Mesh {
  const root = new Mesh(`w_${key}`, scene);
  void containerFor(scene, WEAPON_MODELS[key]).then((c) => {
    if (root.isDisposed()) return;
    const inst = c.instantiateModelsToScene((n) => n, false);
    const src = inst.rootNodes[0] as TransformNode | undefined;
    if (!src) return;

    // Обёртка: наш масштаб/поворот/сдвиг отдельно от конверсии координат glTF,
    // которая сидит в rotationQuaternion у src.
    const fitNode = new TransformNode(`${key}_fit`, scene);
    fitNode.parent = fit.parent ?? root;
    fitNode.rotationQuaternion = Quaternion.RotationYawPitchRoll(
      fit.yaw ?? 0,
      fit.pitch ?? 0,
      fit.roll ?? 0,
    );
    fitNode.scaling.setAll(fit.scale);
    if (fit.offset) fitNode.position.copyFrom(fit.offset);
    src.parent = fitNode;

    recolorFlat(src, fit.tint);
    // Палитра пака у оружия тёмная (тёмная сталь) — приподнимаем к свету.
    // Эмиссив маленький: пусть форму лепит солнце (иначе клинок плоский).
    // Немного блеска — сталь ловит блик от солнца.
    const done = new Set<StandardMaterial>();
    for (const m of src.getChildMeshes(false)) {
      m.isPickable = false;
      m.applyFog = true;
      const mat = m.material as StandardMaterial | null;
      if (mat && "emissiveColor" in mat && !done.has(mat)) {
        mat.diffuseColor = Color3.Lerp(mat.diffuseColor, new Color3(1, 1, 1), 0.3);
        mat.emissiveColor = mat.diffuseColor.scale(0.05); // было 0.13 — оружие «светилось» само
        mat.specularColor = new Color3(0.35, 0.35, 0.35);
        mat.specularPower = 48;
        // recolorFlat ставит потолок в 2 источника (для статичных пропов).
        // Оружие в руке должно ловить и свет светлячков — поднимаем.
        mat.maxSimultaneousLights = 1;
        done.add(mat);
      }
    }
    onReady?.(fitNode);

    // Все детали модели — в один меш с цветами в вершинах: одна отрисовка вместо 4–6.
    const parts = src.getChildMeshes(false).filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0);
    const flat = flattenToVertexColors(scene, fit.parent ?? root, parts, `${key}_flat`);
    if (flat) src.dispose(false, true);
  });
  return root;
}
