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
import { LIGHT_BUDGET } from "../world/Fireflies";
import { weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import { radialGlowTexture } from "../ui/GlowSprite";

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
void main() {
  float p = 0.85 + sin(uT * 3.0) * 0.15;
  vA = (0.36 + p * 0.36) * uAmp;
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
uniform sampler2D tex;
void main() {
  float a = texture2D(tex, vUV).a * vA;
  gl_FragColor = vec4(0.6, 0.22, 1.0, a);
}
`;

const glowMats = new WeakMap<Scene, Map<number, ShaderMaterial>>();

function glowMaterial(scene: Scene, amp: number): ShaderMaterial {
  let byAmp = glowMats.get(scene);
  if (!byAmp) glowMats.set(scene, (byAmp = new Map()));
  let mat = byAmp.get(amp);
  if (!mat) {
    mat = new ShaderMaterial(`${GLOW}Mat${amp}`, scene, GLOW, {
      attributes: ["position", "uv"],
      uniforms: ["world", "view", "viewProjection", "uT", "uAmp"],
      samplers: ["tex"],
      needAlphaBlending: true,
    });
    mat.setTexture("tex", radialGlowTexture(scene));
    mat.setFloat("uAmp", amp);
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    const m = mat;
    mat.onBindObservable.add(() => m.getEffect()?.setFloat("uT", performance.now() / 1000));
    byAmp.set(amp, mat);
  }
  return mat;
}

export function attachLegendaryGlow(
  scene: Scene,
  host: Mesh,
  radius = 0.6,
  /** Множитель яркости — не размера. Оружие ×0.5, Эгида ×(1/1.5) по просьбе. */
  intensity = 1,
): void {
  const shell = MeshBuilder.CreatePlane("legGlow", { size: radius * 2 }, scene);
  shell.material = glowMaterial(scene, Math.round(intensity * 1000) / 1000);
  shell.isPickable = false;
  shell.parent = host;
  // Развёрнут шейдером, а рамка у плоскости остаётся «плашмя»: не даём отсечь его по ней.
  shell.alwaysSelectAsActiveMesh = true;
}

/**
 * Цвет для перекраски оружия по тиру. base/gold — цвет из пака (undefined),
 * legendary — цвет аффикса (огонь / охота / эгида / буря), из WeaponDef.tint.
 */
export function tierTint(cls: WeaponClass, tier: WeaponTier): Color3 | undefined {
  if (tier !== "legendary") return undefined;
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
        mat.maxSimultaneousLights = LIGHT_BUDGET;
        done.add(mat);
      }
    }
    onReady?.(fitNode);
  });
  return root;
}
