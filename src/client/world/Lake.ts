import type { Scene } from "@babylonjs/core/scene";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

import { LAKE, MOUNTAIN } from "#shared/constants";
import { terrainHeight, LAKE_R_AVG, lakeShoreDistIn, SCULPT_BOUNDS } from "#shared/terrain";

export interface Lake {
  tick(dt: number): void;
}

/**
 * Гранёный blockout-камень: крупная сетка (джиттер позиции/высоты — грани
 * читаются, форма неправильная), flat shading с нормалью, принудительно
 * развёрнутой вверх (не зависит от порядка обхода треугольников — исключает
 * «чёрную дыру» из-за перевёрнутой нормали одной грани).
 */
function buildJitterRock(
  scene: Scene,
  name: string,
  x0: number,
  z0: number,
  xSpan: number,
  zSpan: number,
  heightAt: (x: number, z: number) => number,
  withinFn: (x: number, z: number) => boolean,
  color: Color3,
  seedBase: number,
): Mesh {
  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.03, 0.03, 0.03);
  mat.maxSimultaneousLights = 1;

  // Шаг мельче, чем раньше (6->4) и почти без бокового джиттера (был 0.35
  // шага — на отвесной стене каньона это боковое смещение утаскивало точку
  // выборки высоты на метры в сторону, и по факту камень сэмплился НИЖЕ
  // настоящей стены; земля просвечивала по бокам). Джиттер теперь в основном
  // в высоте (грани всё равно читаются за счёт flat shading), а не в плане.
  const STEP = 4;
  const nx = Math.max(1, Math.round(xSpan / STEP));
  const nz = Math.max(1, Math.round(zSpan / STEP));
  const stepX = xSpan / nx;
  const stepZ = zSpan / nz;
  let seed = seedBase;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  const grid: { x: number; y: number; z: number }[][] = [];
  for (let iz = 0; iz <= nz; iz++) {
    const row: { x: number; y: number; z: number }[] = [];
    for (let ix = 0; ix <= nx; ix++) {
      const gx = x0 + ix * stepX + (rnd() - 0.5) * stepX * 0.08;
      const gz = z0 + iz * stepZ + (rnd() - 0.5) * stepZ * 0.08;
      // Джиттер высоты только ВВЕРХ, с бОльшим запасом (0.4..2.4м) — чтобы
      // с гарантией перекрывать землю даже там, где сэмплированная точка
      // чуть промахнулась мимо самой крутой части стены.
      const gy = heightAt(gx, gz) + 0.4 + rnd() * 2.0;
      row.push({ x: gx, y: gy, z: gz });
    }
    grid.push(row);
  }
  const idxOf = (ix: number, iz: number): number => iz * (nx + 1) + ix;
  const within = (ix: number, iz: number): boolean => {
    const p = grid[iz][ix];
    return withinFn(p.x, p.z);
  };
  const rawPos: number[] = [];
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const p = grid[iz][ix];
      rawPos.push(p.x, p.y, p.z);
    }
  }
  const rawIdx: number[] = [];
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!within(ix, iz) || !within(ix + 1, iz) || !within(ix, iz + 1) || !within(ix + 1, iz + 1)) continue;
      const a = idxOf(ix, iz);
      const b = idxOf(ix + 1, iz);
      const c = idxOf(ix, iz + 1);
      const d = idxOf(ix + 1, iz + 1);
      rawIdx.push(a, b, c, b, d, c);
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let t = 0; t < rawIdx.length; t += 3) {
    const ia = rawIdx[t];
    const ib = rawIdx[t + 1];
    const ic = rawIdx[t + 2];
    const ax = rawPos[ia * 3];
    const ay = rawPos[ia * 3 + 1];
    const az = rawPos[ia * 3 + 2];
    const bx = rawPos[ib * 3];
    const by = rawPos[ib * 3 + 1];
    const bz = rawPos[ib * 3 + 2];
    const cxp = rawPos[ic * 3];
    const cy = rawPos[ic * 3 + 1];
    const czp = rawPos[ic * 3 + 2];
    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cxp - ax;
    const e2y = cy - ay;
    const e2z = czp - az;
    let nvx = e1y * e2z - e1z * e2y;
    let nvy = e1z * e2x - e1x * e2z;
    let nvz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nvx, nvy, nvz) || 1;
    nvx /= len;
    nvy /= len;
    nvz /= len;
    if (nvy < 0) {
      nvx = -nvx;
      nvy = -nvy;
      nvz = -nvz;
    }
    const base = positions.length / 3;
    positions.push(ax, ay, az, bx, by, bz, cxp, cy, czp);
    normals.push(nvx, nvy, nvz, nvx, nvy, nvz, nvx, nvy, nvz);
    indices.push(base, base + 1, base + 2);
  }
  const rock = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.normals = normals;
  vd.applyToMesh(rock);
  rock.material = mat;
  rock.isPickable = false;
  rock.checkCollisions = false;
  rock.freezeWorldMatrix();
  return rock;
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

  // Диск воды кроет ВЕСЬ эллипс вместе с прибрежной отмелью (см. terrain.ts:
  // дно там строго ровное floorY по всему lakeEllipseDist<shoreOuter) —
  // иначе между кромкой воды и настоящим подъёмом берега виден провал голой
  // земли. Сам меш — обычный круглый диск среднего радиуса, растянутый
  // масштабом до эллипса LAKE.rx×LAKE.rz (см. lakeEllipseDist — та же самая
  // мат.модель, чтобы дно и видимая вода совпадали).
  const shoreOuter = LAKE_R_AVG + LAKE.shoreFade;
  const water = MeshBuilder.CreateDisc(
    "lakeWater",
    { radius: shoreOuter, tessellation: 48 },
    scene,
  );
  water.rotation.x = Math.PI / 2;
  water.scaling.x = LAKE.rx / LAKE_R_AVG;
  water.scaling.y = LAKE.rz / LAKE_R_AVG; // локальный Y уходит в мировой Z после поворота на X
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

  // База/верх водопада — НЕ аналитическая формула (та подбиралась под старый
  // гладкий купол и на произвольном слепленном рельефе мажет мимо), а прямое
  // сканирование вдоль линии озеро->гора: ищем реальный резкий обрыв.
  let baseX = LAKE.x + nx * 30;
  let baseZ = LAKE.z + nz * 30;
  let topX = baseX + nx * 4;
  let topZ = baseZ + nz * 4;
  {
    const SCAN_STEP = 1.5;
    const SCAN_MAX = 150;
    const JUMP_ABOVE_WATER = 8; // м — если рельеф внезапно настолько выше воды, это обрыв
    let prevY = terrainHeight(LAKE.x, LAKE.z);
    for (let t = SCAN_STEP; t <= SCAN_MAX; t += SCAN_STEP) {
      const x = LAKE.x + nx * t;
      const z = LAKE.z + nz * t;
      const y = terrainHeight(x, z);
      if (y > LAKE.waterY + JUMP_ABOVE_WATER && prevY <= LAKE.waterY + JUMP_ABOVE_WATER) {
        baseX = LAKE.x + nx * (t - SCAN_STEP);
        baseZ = LAKE.z + nz * (t - SCAN_STEP);
        const topT = t + 3;
        topX = LAKE.x + nx * topT;
        topZ = LAKE.z + nz * topT;
        break;
      }
      prevY = y;
    }
  }
  const topY = terrainHeight(topX, topZ) + 1;
  const fallHeight = Math.max(8, Math.min(60, topY - LAKE.waterY));

  // Выступ-козырёк убран по просьбе (не подошёл визуально).

  // Текстура вертикальных потоков — иначе ровный прямоугольник читался как
  // стеклянная панель, а не вода: рваные полупрозрачные полосы разной
  // ширины/яркости, растянутые по всей высоте. UV сдвигаем в tick() —
  // единственная настоящая UV-анимация в этом файле, но она того стоит:
  // дешёвая (один текстурный семпл), а «течёт» узнаваемо только так.
  const streakTex = new DynamicTexture("waterfallStreaks", { width: 64, height: 256 }, scene, false);
  {
    const ctx = streakTex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 64, 256);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 64;
      const w = 1.5 + Math.random() * 3.5;
      const grd = ctx.createLinearGradient(0, 0, 0, 256);
      const a = 0.25 + Math.random() * 0.55;
      grd.addColorStop(0, `rgba(230,240,248,${a * 0.5})`);
      grd.addColorStop(0.6, `rgba(255,255,255,${a})`);
      grd.addColorStop(1, `rgba(255,255,255,${Math.min(1, a * 1.3)})`);
      ctx.fillStyle = grd;
      ctx.fillRect(x, 0, w, 256);
    }
    streakTex.update(false);
  }
  streakTex.hasAlpha = true;
  streakTex.wrapV = 1; // WRAP — сдвиг vOffset зацикливается
  const waterfallMat = new StandardMaterial("waterfallMat", scene);
  waterfallMat.diffuseColor = new Color3(1, 1, 1);
  waterfallMat.specularColor = new Color3(0, 0, 0);
  waterfallMat.emissiveColor = new Color3(0.6, 0.72, 0.78);
  waterfallMat.emissiveTexture = streakTex;
  waterfallMat.opacityTexture = streakTex;
  waterfallMat.alpha = 0.9;
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
    // Высота полосы в «плитках» текстуры — подлиннее полосы тянут узор не
    // растягивая (иначе редкие потоки на короткой полосе, частые на длинной).
    const vTiles = Math.max(1, h / 5);
    const uvs = [0, 0, 1, 0, 1, vTiles, 0, vTiles];
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.colors = colors;
    vd.uvs = uvs;
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
  // Ширина водопада по плану — 13м (было ~9м суммарно на 4 узких полосах).
  const STRIP_N = 5;
  for (let i = 0; i < STRIP_N; i++) {
    const w = 2.6 + Math.random() * 2.4;
    const h = fallHeight * (0.85 + Math.random() * 0.15);
    const along = (i - (STRIP_N - 1) / 2) * 3.1;
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

    // nx,nz уже смотрит ОТ озера К горе (см. выше) — это и есть «вверх по
    // склону». Раньше тут стоял минус: река шла в обратную сторону, назад
    // к озеру, и пропадала в первые же 12 м вместо подъёма к пику.
    const upx = nx;
    const upz = nz; // от водопада вверх по склону, к горе
    const perpX = -upz;
    const perpZ = upx; // поперёк русла — для виляния
    // Подъём почти до плоской вершины (см. terrain.ts PLATEAU_T) — река
    // должна уходить в даль по плато, а не обрываться на середине склона.
    // Виляние небольшое: terrain.ts режет под руслом прямую канаву шириной
    // ~5м вдоль этой же линии (nx,nz) — если лента гуляет сильно в сторону,
    // она всплывает над бортом канавы вместо того, чтобы лежать в ней.
    // Река тянется сплошной полосой во всю длину расщелины — от кончика
    // водопада до края слепленного рельефа (не на фиксированные 45м, как
    // раньше), по просьбе «непрерывной полоской в длину каньона от начала
    // карты до кончика водопада».
    const CLIMB_MARGIN = 10;
    let CLIMB = 300;
    if (upx > 0) CLIMB = Math.min(CLIMB, (SCULPT_BOUNDS.x1 - CLIMB_MARGIN - topX) / upx);
    else if (upx < 0) CLIMB = Math.min(CLIMB, (SCULPT_BOUNDS.x0 + CLIMB_MARGIN - topX) / upx);
    if (upz > 0) CLIMB = Math.min(CLIMB, (SCULPT_BOUNDS.z1 - CLIMB_MARGIN - topZ) / upz);
    else if (upz < 0) CLIMB = Math.min(CLIMB, (SCULPT_BOUNDS.z0 + CLIMB_MARGIN - topZ) / upz);
    CLIMB = Math.max(30, CLIMB);
    const N = Math.max(8, Math.round(CLIMB / 7));
    const pts: { x: number; y: number; z: number }[] = [{ x: topX, y: topY, z: topZ }];
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      const wiggle = Math.sin(t * 4.3 + 1.7) * 1.2 * t; // разворот мягче к вершине
      const px = topX + upx * (CLIMB * t) + perpX * wiggle;
      const pz = topZ + upz * (CLIMB * t) + perpZ * wiggle;
      pts.push({ x: px, y: terrainHeight(px, pz) + 0.12, z: pz });
    }
    const segs: Mesh[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dxs = b.x - a.x;
      const dzs = b.z - a.z;
      const len = Math.hypot(dxs, dzs) || 1;
      // Шире и без сужения к вершине (было 2.6->0.9 к концу) — по просьбе,
      // «река сверху шире», резкий переход в водопад делает terrain.ts
      // (обрыв), не сама лента реки.
      const w = 6;
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
    // Настоящая кромка эллипса в СТОРОНУ ЛАГЕРЯ (не усреднённый shoreOuter —
    // тот только для дна/формы диска) + отмель + запас на RISE_FADE(10) в
    // terrain.ts, чтобы точно попасть на нетронутую сушу (см. баг «причал
    // внутри вечно-подводной зоны» — не отрезать себе те же грабли), + ~12м
    // сверху — по брифу «лагерь 10-15м от ближайшего берега».
    const dockR = lakeShoreDistIn(dax, daz) + LAKE.shoreFade + 10 + 12;
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
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // По эллипсу (не по кругу — та же формула, что и lakeEllipseDist,
      // только в явном виде по углу): кромка + немного суши.
      const rimK = 1 + (rnd() * 4) / LAKE_R_AVG;
      const x = LAKE.x + ca * LAKE.rx * rimK;
      const z = LAKE.z + sa * LAKE.rz * rimK;
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

  // ---- Гора: голый камень, резкие грани (не трава, не гладкий купол) ----
  // Раньше это была круглая заплатка вокруг MOUNTAIN.x/z — не годится для
  // вручную слепленного рельефа (terrainSculpt.json), у которого форма
  // произвольная. Камень кроет весь прямоугольник лепки, но только там, где
  // ВЫШЕ ROCK_FROM И склон крутой — площадка на вершине горы тоже выше
  // ROCK_FROM, но она плоская (сделана нарочно как поляна), и там должна
  // остаться трава, а не камень. Тот же критерий, что и у травы в
  // GrassField.ts (см. её комментарий) — иначе поляна и камень разъедутся.
  {
    const ROCK_FROM = 2;
    const SLOPE_LIMIT = 0.3;
    const isRock = (x: number, z: number): boolean => {
      const y = terrainHeight(x, z);
      if (y <= ROCK_FROM) return false;
      const sd = 3;
      const dhx = terrainHeight(x + sd, z) - terrainHeight(x - sd, z);
      const dhz = terrainHeight(x, z + sd) - terrainHeight(x, z - sd);
      const slope = Math.max(Math.abs(dhx), Math.abs(dhz)) / (2 * sd);
      return slope > SLOPE_LIMIT;
    };
    buildJitterRock(
      scene,
      "mountainRock",
      SCULPT_BOUNDS.x0,
      SCULPT_BOUNDS.z0,
      SCULPT_BOUNDS.x1 - SCULPT_BOUNDS.x0,
      SCULPT_BOUNDS.z1 - SCULPT_BOUNDS.z0,
      terrainHeight,
      isRock,
      new Color3(0.42, 0.4, 0.38),
      778899,
    );
  }

  // ---- Blockout-заглушки по брифу «Mountain Lake Phase 1» ----
  // Лесные массивы (условные объёмы — НЕ отдельные деревья), площадка
  // лагеря и основные тропы. Плоские однотонные материалы, никакого декора.
  {
    // Лесные цилиндры-заглушки убраны (мешали смотреть композицию горы/реки
    // во время пересборки) — лес будет отдельным шагом пайплайна, другой
    // формой (не столбы), см. чат с пользователем.

    // Площадка лагеря — отдельная от причала (тот уже есть выше): плоский
    // box чуть в стороне от берега, костёр — маленький box на ней.
    const campMat = new StandardMaterial("campBlockMat", scene);
    campMat.diffuseColor = new Color3(0.36, 0.26, 0.16);
    campMat.specularColor = new Color3(0, 0, 0);
    campMat.maxSimultaneousLights = 1;
    const fireMat = new StandardMaterial("campFireBlockMat", scene);
    fireMat.diffuseColor = new Color3(0.5, 0.2, 0.08);
    fireMat.specularColor = new Color3(0, 0, 0);
    fireMat.maxSimultaneousLights = 1;

    const dax = -nx;
    const daz = -nz;
    const campR = lakeShoreDistIn(dax, daz) + LAKE.shoreFade + 10 + 14; // чуть дальше причала вглубь суши
    const campX = LAKE.x + dax * campR;
    const campZ = LAKE.z + daz * campR;
    const campY = terrainHeight(campX, campZ);
    // Площадка лагеря — 22м по плану (было 12).
    const platform = MeshBuilder.CreateBox("campPlatformBlock", { width: 22, height: 0.3, depth: 22 }, scene);
    platform.position.set(campX, campY + 0.15, campZ);
    platform.material = campMat;
    platform.isPickable = false;
    platform.checkCollisions = true;
    platform.freezeWorldMatrix();
    const fire = MeshBuilder.CreateBox("campFireBlock", { size: 1.2 }, scene);
    fire.position.set(campX, campY + 0.6, campZ);
    fire.material = fireMat;
    fire.isPickable = false;
    fire.freezeWorldMatrix();

    // Тропы (бежевые полосы 2.5м) — лагерь→причал (короткая, тот уже ведёт
    // в воду сам), лагерь→лес→водопад, озеро→(вверх)→река→водопад.
    const pathMat = new StandardMaterial("pathBlockMat", scene);
    pathMat.diffuseColor = new Color3(0.72, 0.64, 0.48);
    pathMat.specularColor = new Color3(0, 0, 0);
    pathMat.maxSimultaneousLights = 1;
    const pathSegs: Mesh[] = [];
    const layPath = (ax: number, az: number, bx: number, bz: number): void => {
      const dxs = bx - ax;
      const dzs = bz - az;
      const len = Math.hypot(dxs, dzs) || 1;
      const midx = (ax + bx) / 2;
      const midz = (az + bz) / 2;
      const midy = (terrainHeight(ax, az) + terrainHeight(bx, bz)) / 2;
      const seg = MeshBuilder.CreateBox("pathBlockSeg", { width: 2.5, height: 0.06, depth: len }, scene);
      seg.position.set(midx, midy + 0.1, midz);
      seg.rotation.y = Math.atan2(dxs, dzs);
      pathSegs.push(seg);
    };
    // Тропа к водопаду убрана (по просьбе — "жёлтая доска в озере": прямой
    // отрезок лагерь->водопад теперь пересекал озеро, оно выросло и уже не
    // огибается прямой линией). Оставлена только короткая тропа от лагеря
    // в сторону опушки — не пересекает воду.
    const midPathX = LAKE.x + (campX - LAKE.x) * 0.6;
    const midPathZ = campZ - 18;
    layPath(campX, campZ, midPathX, midPathZ);
    const path = Mesh.MergeMeshes(pathSegs, true, true) as Mesh;
    if (path) {
      path.material = pathMat;
      path.isPickable = false;
      path.checkCollisions = false;
      path.freezeWorldMatrix();
    }
  }

  let clock = 0;
  return {
    tick(dt: number): void {
      clock += dt;
      // Лёгкая пульсация — не UV-анимация (не пересобирает шейдер), просто
      // цвет/альфа чуть «дышат», создавая ощущение подвижной воды.
      const shimmer = 0.5 + 0.5 * Math.sin(clock * 0.6);
      waterMat.alpha = 0.82 + shimmer * 0.06;
      // Течение: текстура потоков едет вниз по UV — простая, но узнаваемая
      // анимация воды (один сэмпл текстуры, не UV-развёртка каждого квада).
      // Минус — иначе поток визуально бежал вверх, а не вниз.
      streakTex.vOffset = (streakTex.vOffset - dt * 0.9 + 1) % 1;
      const flow = 0.5 + 0.5 * Math.sin(clock * 2.2);
      waterfallMat.alpha = 0.85 + flow * 0.1;
      const foamPulse = 0.5 + 0.5 * Math.sin(clock * 1.7 + 1.1);
      foamMat.alpha = 0.5 + foamPulse * 0.18;
      const mistPulse = 0.5 + 0.5 * Math.sin(clock * 0.9 + 2.2);
      mistMat.alpha = 0.16 + mistPulse * 0.1;
    },
  };
}
