import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import { LAKE, MOUNTAIN } from "#shared/constants";
import { terrainHeight } from "#shared/terrain";

export interface Lake {
  tick(dt: number): void;
}

/**
 * Озеро + водопад со склона горы (см. план «озеро+горы»). Статичная
 * геометрия — один диск воды, одна лента водопада, по одному материалу на
 * каждый, `maxSimultaneousLights=1` (как весь остальной мир). Никакой
 * честной жидкости/рефлексий/`WaterMaterial` — только мягкая пульсация
 * цвета/прозрачности в `tick()`, без текстур и UV-анимации.
 */
export function createLake(scene: Scene): Lake {
  const waterMat = new StandardMaterial("lakeWaterMat", scene);
  waterMat.diffuseColor = new Color3(0.09, 0.22, 0.28);
  waterMat.emissiveColor = new Color3(0.05, 0.13, 0.17);
  waterMat.specularColor = new Color3(0.25, 0.3, 0.32);
  waterMat.specularPower = 48;
  waterMat.alpha = 0.86;
  waterMat.maxSimultaneousLights = 1;
  waterMat.backFaceCulling = false;

  // Диск воды кроет ВЕСЬ радиус вместе с прибрежной отмелью (см. terrain.ts:
  // дно там строго ровное floorY на всём этом круге) — иначе между кромкой
  // воды и настоящим подъёмом берега виден провал голой земли.
  const shoreOuter = LAKE.radius + LAKE.shoreFade;
  const water = MeshBuilder.CreateDisc(
    "lakeWater",
    { radius: shoreOuter, tessellation: 48 },
    scene,
  );
  water.rotation.x = Math.PI / 2;
  water.position.set(LAKE.x, LAKE.waterY, LAKE.z);
  water.material = waterMat;
  water.isPickable = false;
  water.checkCollisions = false;
  water.freezeWorldMatrix();

  // Водопад — прямая лента от склона горы до глади озера, чуть в стороне
  // ближнего берега (между LAKE и MOUNTAIN, по прямой между их центрами).
  const dx = MOUNTAIN.x - LAKE.x;
  const dz = MOUNTAIN.z - LAKE.z;
  const dl = Math.hypot(dx, dz) || 1;
  const nx = dx / dl;
  const nz = dz / dl;
  const baseX = LAKE.x + nx * (shoreOuter - 3);
  const baseZ = LAKE.z + nz * (shoreOuter - 3);
  // Раньше бралось +9 вдоль склона — попадало ЕЩЁ в переходную зону чаши
  // озера (terrain.ts гасит подъём горы там же, где сам понижает дно под
  // воду), и водопад выходил метра 4-6 высотой вместо нормального. +18 —
  // это уже чисто склон горы, без вмешательства озера (ld от центра озера
  // там за пределами shoreOuter+RISE_FADE=50).
  const topX = baseX + nx * 18;
  const topZ = baseZ + nz * 18;
  const topY = terrainHeight(topX, topZ) + 1;
  const fallHeight = Math.max(8, Math.min(16, topY - LAKE.waterY));

  // Вершинный цвет (у истока, светлее/голубее) и нижний (пена у подножия,
  // почти белый) — материал с вершинными цветами вместо плоской заливки,
  // иначе лента издалека читалась просто как светлая карточка, не как вода.
  const waterfallMat = new StandardMaterial("waterfallMat", scene);
  waterfallMat.diffuseColor = new Color3(1, 1, 1);
  waterfallMat.specularColor = new Color3(0, 0, 0);
  waterfallMat.emissiveColor = new Color3(0.5, 0.62, 0.68);
  waterfallMat.alpha = 0.62;
  waterfallMat.maxSimultaneousLights = 1;
  waterfallMat.backFaceCulling = false;
  waterfallMat.disableLighting = true;

  const faceYaw = Math.atan2(-nx, -nz); // лицом к озеру (см. ниже)
  const midX = (baseX + topX) / 2;
  const midY = (LAKE.waterY + topY) / 2;
  const midZ = (baseZ + topZ) / 2;
  const fx = Math.cos(faceYaw); // локальная «вширь» ленты в мировых XZ
  const fz = -Math.sin(faceYaw);
  // Каждая полоса — не CreatePlane, а свой квад с вершинными цветами:
  // верх (у истока) бледно-голубой и прозрачнее, низ (у пены) ярче и
  // непрозрачнее — глаз читает это как льющуюся воду, а не плитку.
  const buildStrip = (name: string, along: number, w: number, h: number, forward: number): Mesh => {
    const cx = midX + fx * along + Math.sin(faceYaw) * forward;
    const cz = midZ + fz * along + Math.cos(faceYaw) * forward;
    const hw = w / 2;
    const positions = [
      -hw, h / 2, 0, // верх-лево
      hw, h / 2, 0, // верх-право
      hw, -h / 2, 0, // низ-право
      -hw, -h / 2, 0, // низ-лево
    ];
    const top: [number, number, number, number] = [0.72, 0.84, 0.92, 0.45];
    const bottom: [number, number, number, number] = [0.93, 0.97, 1, 0.8];
    const colors = [...top, ...top, ...bottom, ...bottom];
    const indices = [0, 1, 2, 0, 2, 3];
    const normals = [0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1];
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.colors = colors;
    vd.applyToMesh(m, false);
    m.useVertexColors = true;
    m.hasVertexAlpha = true;
    m.position.set(cx, midY, cz);
    m.rotation.y = faceYaw + (Math.random() - 0.5) * 0.08;
    m.material = waterfallMat;
    m.isPickable = false;
    m.checkCollisions = false;
    m.freezeWorldMatrix();
    return m;
  };
  // Не одна ровная лента, а несколько неровных полос вразнобой по ширине/
  // сдвигу — читается как рассыпающийся поток, а не гладкая плитка.
  const strips: Mesh[] = [];
  const STRIP_N = 4;
  for (let i = 0; i < STRIP_N; i++) {
    const w = 2.2 + Math.random() * 2.2;
    const h = fallHeight * (0.85 + Math.random() * 0.15);
    const along = (i - (STRIP_N - 1) / 2) * 1.9;
    const forward = (Math.random() - 0.5) * 0.7;
    strips.push(buildStrip(`waterfallStrip${i}`, along, w, h, forward));
  }

  // Пена у подножия — мягкое светлое пятно на глади озера в месте падения.
  const foamMat = new StandardMaterial("waterfallFoamMat", scene);
  foamMat.diffuseColor = new Color3(0, 0, 0);
  foamMat.specularColor = new Color3(0, 0, 0);
  foamMat.emissiveColor = new Color3(0.78, 0.86, 0.9);
  foamMat.alpha = 0.6;
  foamMat.disableLighting = true;
  foamMat.backFaceCulling = false;
  const foam = MeshBuilder.CreateDisc("waterfallFoam", { radius: 3.6, tessellation: 20 }, scene);
  foam.rotation.x = Math.PI / 2;
  foam.position.set(baseX, LAKE.waterY + 0.03, baseZ);
  foam.material = foamMat;
  foam.isPickable = false;
  foam.checkCollisions = false;
  foam.freezeWorldMatrix();

  // Лёгкая дымка-брызги над пеной — несколько полупрозрачных сфер, как
  // облака в Sky.ts (низкополигональные, один меш, без частиц).
  const mistMat = new StandardMaterial("waterfallMistMat", scene);
  mistMat.diffuseColor = new Color3(1, 1, 1);
  mistMat.emissiveColor = new Color3(0.8, 0.86, 0.9);
  mistMat.specularColor = new Color3(0, 0, 0);
  mistMat.alpha = 0.22;
  mistMat.disableLighting = true;
  mistMat.disableDepthWrite = true;
  mistMat.backFaceCulling = false;
  const puffs: Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const puff = MeshBuilder.CreateSphere(`waterfallMist${i}`, { diameter: 1, segments: 5 }, scene);
    const sc = 1.4 + Math.random() * 1.3;
    puff.scaling.set(sc, sc * 0.6, sc);
    puff.position.set(
      baseX + (Math.random() - 0.5) * 3,
      LAKE.waterY + 0.6 + Math.random() * 1.4,
      baseZ + (Math.random() - 0.5) * 3,
    );
    puffs.push(puff);
  }
  const mist = Mesh.MergeMeshes(puffs, true, true) as Mesh;
  mist.material = mistMat;
  mist.isPickable = false;
  mist.checkCollisions = false;
  mist.freezeWorldMatrix();

  // ---- Река от склона горы до вершины водопада ----
  // Ломаная вверх по склону от topX/topZ (голова водопада) к пику горы, с
  // боковым виляньем — не идеально прямая линия. Каждый сегмент — плоская
  // лента по рельефу (terrainHeight в его середине), один материал.
  {
    const riverMat = new StandardMaterial("riverMat", scene);
    riverMat.diffuseColor = new Color3(0.55, 0.68, 0.76);
    riverMat.emissiveColor = new Color3(0.4, 0.53, 0.6);
    riverMat.specularColor = new Color3(0.2, 0.24, 0.26);
    riverMat.alpha = 0.75;
    riverMat.maxSimultaneousLights = 1;
    riverMat.backFaceCulling = false;

    const upx = -nx;
    const upz = -nz; // от водопада вверх по склону, к горе
    const perpX = -upz;
    const perpZ = upx; // поперёк русла — для виляния
    const N = 5;
    const pts: { x: number; y: number; z: number }[] = [{ x: topX, y: topY, z: topZ }];
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const wiggle = Math.sin(t * 4.3 + 1.7) * 3.5 * t; // разворот сильнее к вершине
      const px = topX + upx * (12 * t) + perpX * wiggle;
      const pz = topZ + upz * (12 * t) + perpZ * wiggle;
      pts.push({ x: px, y: terrainHeight(px, pz) + 0.12, z: pz });
    }
    const segs: Mesh[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dxs = b.x - a.x;
      const dzs = b.z - a.z;
      const len = Math.hypot(dxs, dzs) || 1;
      const w = 2.6 - i * 0.32; // сужается к вершине
      const seg = MeshBuilder.CreateBox(`riverSeg${i}`, { width: Math.max(0.9, w), height: 0.08, depth: len * 1.05 }, scene);
      seg.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      seg.rotation.y = Math.atan2(dxs, dzs);
      segs.push(seg);
    }
    const river = Mesh.MergeMeshes(segs, true, true) as Mesh;
    river.material = riverMat;
    river.isPickable = false;
    river.checkCollisions = false;
    river.freezeWorldMatrix();
  }

  // ---- Причал и мини-лагерь на дальнем от горы берегу ----
  {
    const woodMat = new StandardMaterial("dockWoodMat", scene);
    woodMat.diffuseColor = new Color3(0.32, 0.22, 0.14);
    woodMat.specularColor = new Color3(0.05, 0.05, 0.05);
    woodMat.maxSimultaneousLights = 1;
    const crateMat = new StandardMaterial("dockCrateMat", scene);
    crateMat.diffuseColor = new Color3(0.4, 0.29, 0.18);
    crateMat.specularColor = new Color3(0.05, 0.05, 0.05);
    crateMat.maxSimultaneousLights = 1;
    const bannerMat = new StandardMaterial("dockBannerMat", scene);
    bannerMat.diffuseColor = new Color3(0.16, 0.28, 0.5);
    bannerMat.emissiveColor = new Color3(0.05, 0.09, 0.16);
    bannerMat.specularColor = new Color3(0, 0, 0);
    bannerMat.maxSimultaneousLights = 1;

    // Противоположный от горы берег — там, где к озеру ближе всего от центра
    // мира (удобно идти от поляны), направление -(nx,nz) от центра озера.
    // Причал ставим НА СУШЕ (за пределами вечно-подводной зоны terrain.ts:
    // там дно ровно floorY на всём shoreOuter, «берег» на shoreOuter-1 — это
    // всё ещё дно озера под водой) и тянем доски ОТТУДА к воде, а не наоборот.
    const dax = -nx;
    const daz = -nz;
    // shoreOuter+RISE_FADE(10) — где подъём к обычному рельефу ТОЛЬКО
    // заканчивается; берём якорь заметно дальше (+20), чтобы точно попасть
    // на нетронутую сушу, а не в хвост переходной зоны (там и словили баг —
    // even shoreOuter+7 всё ещё оказалось внутри неё).
    const dockR = shoreOuter + 20;
    const shoreX = LAKE.x + dax * dockR;
    const shoreZ = LAKE.z + daz * dockR;
    const dockYaw = Math.atan2(dax, daz);
    // Доска садится на то, что выше — землю или гладь воды: у берега на
    // рельеф, дальше в озеро — на уровень воды. Так причал естественно
    // «плывёт» по границе суша/вода, а не проваливается и не висит.
    const restY = (x: number, z: number): number => Math.max(terrainHeight(x, z), LAKE.waterY) + 0.1;

    const planks: Mesh[] = [];
    const PLANK_N = 7;
    for (let i = 0; i < PLANK_N; i++) {
      const t = i / (PLANK_N - 1);
      const along = -22 + t * 22; // от воды (за кромку) до берега (якорь)
      const px = shoreX + Math.sin(dockYaw) * along;
      const pz = shoreZ + Math.cos(dockYaw) * along;
      const plank = MeshBuilder.CreateBox(`dockPlank${i}`, { width: 3.4, height: 0.14, depth: 0.85 }, scene);
      plank.position.set(px, restY(px, pz) + 0.3, pz);
      plank.rotation.y = dockYaw;
      planks.push(plank);
    }
    // Сваи под причал — там, где он реально над водой (дальние от берега доски).
    for (const along of [-20, -14, -8]) {
      const px = shoreX + Math.sin(dockYaw) * along;
      const pz = shoreZ + Math.cos(dockYaw) * along;
      const pile = MeshBuilder.CreateCylinder("dockPile", { diameter: 0.22, height: 1.4 }, scene);
      pile.position.set(px, restY(px, pz) - 0.4, pz);
      planks.push(pile);
    }
    const dock = Mesh.MergeMeshes(planks, true, true) as Mesh;
    dock.material = woodMat;
    dock.isPickable = false;
    dock.checkCollisions = true; // по причалу можно ходить
    dock.freezeWorldMatrix();

    // Ящики/бочки у берега (твёрдая земля), чуть в стороне от досок.
    const crateSideX = shoreX + Math.cos(dockYaw) * 2.4 + Math.sin(dockYaw) * 1.5;
    const crateSideZ = shoreZ - Math.sin(dockYaw) * 2.4 + Math.cos(dockYaw) * 1.5;
    const crateY = terrainHeight(crateSideX, crateSideZ);
    const crates: Mesh[] = [];
    const crate1 = MeshBuilder.CreateBox("dockCrate1", { size: 0.7 }, scene);
    crate1.position.set(crateSideX, crateY + 0.35, crateSideZ);
    crate1.rotation.y = dockYaw + 0.3;
    crates.push(crate1);
    const barrel = MeshBuilder.CreateCylinder("dockBarrel", { diameter: 0.6, height: 0.9 }, scene);
    barrel.position.set(crateSideX + 1.1, crateY + 0.45, crateSideZ + 0.4);
    crates.push(barrel);
    const crates2 = Mesh.MergeMeshes(crates, true, true) as Mesh;
    crates2.material = crateMat;
    crates2.isPickable = false;
    crates2.checkCollisions = true;
    crates2.freezeWorldMatrix();

    // Флаг на шесте у причала — на твёрдой земле, чуть в стороне от воды.
    const poleX = shoreX - Math.sin(dockYaw) * 1.6;
    const poleZ = shoreZ - Math.cos(dockYaw) * 1.6;
    const poleBaseY = terrainHeight(poleX, poleZ);
    const poleH = 3.2;
    const pole = MeshBuilder.CreateCylinder("dockPole", { diameter: 0.1, height: poleH }, scene);
    pole.position.set(poleX, poleBaseY + poleH / 2, poleZ);
    pole.material = woodMat;
    pole.isPickable = false;
    pole.freezeWorldMatrix();
    const flag = MeshBuilder.CreateBox("dockBanner", { width: 0.02, height: 0.85, depth: 0.55 }, scene);
    flag.position.set(poleX + 0.28, poleBaseY + poleH - 0.55, poleZ);
    flag.material = bannerMat;
    flag.isPickable = false;
    flag.freezeWorldMatrix();
  }

  // ---- Береговая полоса: мелкие камни у кромки воды (переход к траве) ----
  {
    const shoreRockMat = new StandardMaterial("shoreRockMat", scene);
    shoreRockMat.diffuseColor = new Color3(0.36, 0.36, 0.38);
    shoreRockMat.specularColor = new Color3(0.05, 0.05, 0.05);
    shoreRockMat.maxSimultaneousLights = 1;
    const rocks: Mesh[] = [];
    const ROCK_N = 22;
    let seed = 1234567;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < ROCK_N; i++) {
      const a = rnd() * Math.PI * 2;
      const r = shoreOuter - 1 + rnd() * 4; // прямо на кромке ± немного суши
      const x = LAKE.x + Math.cos(a) * r;
      const z = LAKE.z + Math.sin(a) * r;
      const y = terrainHeight(x, z);
      const s = 0.18 + rnd() * 0.35;
      const rock = MeshBuilder.CreateSphere(`shoreRock${i}`, { diameter: 1, segments: 4 }, scene);
      rock.scaling.set(s, s * 0.7, s);
      rock.position.set(x, y + s * 0.25, z);
      rock.rotation.set(rnd() * 0.5, rnd() * Math.PI, rnd() * 0.5);
      rocks.push(rock);
    }
    const shoreRocks = Mesh.MergeMeshes(rocks, true, true) as Mesh;
    shoreRocks.material = shoreRockMat;
    shoreRocks.isPickable = false;
    shoreRocks.checkCollisions = false;
    shoreRocks.freezeWorldMatrix();
  }

  let clock = 0;
  return {
    tick(dt: number): void {
      clock += dt;
      // Лёгкая пульсация — не UV-анимация (не пересобирает шейдер), просто
      // цвет/альфа чуть «дышат», создавая ощущение подвижной воды.
      const shimmer = 0.5 + 0.5 * Math.sin(clock * 0.6);
      waterMat.alpha = 0.82 + shimmer * 0.06;
      const flow = 0.5 + 0.5 * Math.sin(clock * 2.2);
      waterfallMat.alpha = 0.48 + flow * 0.14;
      const foamPulse = 0.5 + 0.5 * Math.sin(clock * 1.7 + 1.1);
      foamMat.alpha = 0.5 + foamPulse * 0.18;
      const mistPulse = 0.5 + 0.5 * Math.sin(clock * 0.9 + 2.2);
      mistMat.alpha = 0.16 + mistPulse * 0.1;
    },
  };
}
