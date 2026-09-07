import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Engines/Extensions/engine.dynamicTexture";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";

import { HUB } from "#shared/hub";
import { terrainHeight } from "#shared/terrain";
import type { Obstacle } from "../props";

/**
 * HUB «Боевой лагерь» — BLOCKOUT v1. Только примитивы и простые материалы:
 * задача — почувствовать структуру лагеря и маршрут SPAWN → оружие →
 * тренировка → костёр → ворота → поляна. Красивые модели придут потом,
 * геометрия сделана так, чтобы её можно было подменить на .glb, не трогая
 * gameplay-числа (они в `shared/hub.ts`).
 *
 * Всё в одной существующей сцене / `ZoneRoom` — не отдельный мир.
 */

export interface HubBlockout {
  /** Круги-препятствия лагеря — уходят в общий список коллизий игрока. */
  obstacles: Obstacle[];
  /** Каждый кадр из Zone.tick: `daylight` 0..1 — гасит/зажигает огонь и фонари. */
  tick(daylight: number): void;
  dispose(): void;
}

// ---- палитра лагеря (десатурированная: дерево / камень / холст / металл) ----
const C = {
  dirt: new Color3(0.36, 0.28, 0.19),
  path: new Color3(0.42, 0.34, 0.24),
  wood: new Color3(0.34, 0.24, 0.16),
  woodLight: new Color3(0.5, 0.38, 0.25),
  stone: new Color3(0.45, 0.45, 0.47),
  canvas: new Color3(0.66, 0.62, 0.55),
  banner: new Color3(0.5, 0.16, 0.16),
  ember: new Color3(1.0, 0.5, 0.15),
};

function flatMat(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
  _doubleSided = false,
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0, 0, 0);
  // Все примитивы лагеря — двусторонние: при scene.performancePriority
  // (Intermediate/Aggressive) движок проставляет мешам
  // overrideMaterialSideOrientation, и часть боксов/цилиндров рисовалась
  // изнанкой (чёрной). Двусторонний материал + twoSidedLighting снимает вопрос
  // до art-pass (замена на .glb). Небольшой эмиссив-пол — страховка на ночь.
  m.backFaceCulling = false;
  m.twoSidedLighting = true;
  // Плоская заливка: blockout читается при любом свете и ракурсе (у части
  // примитивов движок ставит «изнаночную» ориентацию — см. коммит). Art-pass
  // заменит на .glb с нормальным освещением.
  m.emissiveColor = emissive ?? color.scale(0.6);
  m.diffuseColor = color.scale(0.5);
  return m;
}

/** Табличка: заголовок + текст на холсте. Blockout — потом станет .glb со знаком. */
function makeSignTexture(scene: Scene, title: string, body: string): StandardMaterial {
  const tex = new DynamicTexture(`hubSign_${title}`, { width: 512, height: 288 }, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = "#efe6d2";
  ctx.fillRect(0, 0, 512, 288);
  ctx.fillStyle = "#5a3a1e";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#5a3a1e";
  ctx.strokeRect(6, 6, 500, 276);
  ctx.textAlign = "center";
  ctx.font = "bold 52px system-ui, sans-serif";
  ctx.fillText(title, 256, 78);
  ctx.font = "30px system-ui, sans-serif";
  body.split("\n").forEach((line, i) => ctx.fillText(line, 256, 150 + i * 44));
  tex.update(false);
  tex.uScale = -1; // CreatePlane отражает текстуру по горизонтали
  tex.uOffset = 1;
  const m = new StandardMaterial(`hubSignMat_${title}`, scene);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.specularColor = new Color3(0, 0, 0);
  m.disableLighting = true;
  m.backFaceCulling = false;
  return m;
}

/** Высота земли лагеря — террейн под ним выровнен площадкой (см. shared/terrain). */
function groundY(x: number, z: number): number {
  return terrainHeight(x, z);
}

export function buildHubBlockout(scene: Scene): HubBlockout {
  const root = new TransformNode("hub", scene);
  const cx = HUB.center.x;
  const cz = HUB.center.z;
  const obstacles: Obstacle[] = [];

  /**
   * Собрать группу примитивов: объединяем в один меш ради Quest, но у
   * `Mesh.MergeMeshes` в этой сборке box-геометрия после объединения не
   * освещается (конусы/цилиндры — норм). Пока blockout — не объединяем; на
   * этапе art-pass заменим на .glb, вопрос уйдёт сам.
   */
  const merge = (
    parts: Mesh[],
    name: string,
    mat: StandardMaterial,
    parent: TransformNode = root,
  ): void => {
    for (const p of parts) {
      p.material = mat;
      p.parent = parent;
      p.isPickable = false;
      p.name = name;
    }
  };

  const matDirt = flatMat(scene, "hubDirt", C.dirt);
  const matPath = flatMat(scene, "hubPath", C.path);
  const matWood = flatMat(scene, "hubWood", C.wood);
  const matWoodLite = flatMat(scene, "hubWoodLite", C.woodLight);
  const matStone = flatMat(scene, "hubStone", C.stone);
  const matBanner = flatMat(scene, "hubBanner", C.banner, C.banner.scale(0.12));
  const emberMat = flatMat(scene, "hubEmber", C.ember, C.ember);
  const lanternMat = flatMat(scene, "hubLantern", new Color3(1, 0.82, 0.5), new Color3(1, 0.7, 0.35));

  // --- 1. Чистая земля лагеря: диск утоптанной земли поверх травы поляны ---
  const pad = MeshBuilder.CreateDisc(
    "hubGround",
    { radius: HUB.campRadius, tessellation: 48 },
    scene,
  );
  pad.rotation.x = Math.PI / 2;
  pad.position.set(cx, groundY(cx, cz) + 0.03, cz);
  pad.material = matDirt;
  pad.parent = root;
  pad.isPickable = false;
  pad.receiveShadows = false;

  // --- 2. Центральная площадь: более светлый утоптанный круг вокруг костра ---
  const plaza = MeshBuilder.CreateDisc(
    "hubPlaza",
    { radius: HUB.plazaRadius, tessellation: 40 },
    scene,
  );
  plaza.rotation.x = Math.PI / 2;
  plaza.position.set(cx, groundY(cx, cz) + 0.05, cz);
  plaza.material = matPath;
  plaza.parent = root;
  plaza.isPickable = false;

  // --- 3. Костёр в центре: каменное кольцо + брёвна + эмиссивное ядро ---
  const fire = new TransformNode("hubCampfire", scene);
  fire.parent = root;
  fire.position.set(HUB.campfire.pos.x, groundY(cx, cz), HUB.campfire.pos.z);

  const ringParts: Mesh[] = [];
  const stones = 9;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2;
    const s = MeshBuilder.CreateBox(`fireStone${i}`, { size: 0.5 }, scene);
    s.position.set(
      Math.cos(a) * HUB.campfire.radius,
      0.18,
      Math.sin(a) * HUB.campfire.radius,
    );
    s.rotation.y = a;
    s.scaling.set(1, 0.7, 1.3);
    ringParts.push(s);
  }
  merge(ringParts, "hubFireRing", matStone, fire);

  const logs: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const l = MeshBuilder.CreateCylinder(`fireLog${i}`, { height: 2.4, diameter: 0.32 }, scene);
    l.rotation.z = Math.PI / 2 - 0.25;
    l.rotation.y = a;
    l.position.set(Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5);
    logs.push(l);
  }
  merge(logs, "hubFireLogs", matWood, fire);

  // Пламя — узкий конус в центре брёвен (не гигантский шар).
  const ember = MeshBuilder.CreateCylinder(
    "hubFlame",
    { height: 1.1, diameterBottom: 0.7, diameterTop: 0, tessellation: 7 },
    scene,
  );
  ember.position.y = 0.62;
  ember.material = emberMat;
  ember.parent = fire;
  ember.isPickable = false;
  const emberCore = MeshBuilder.CreateSphere("hubEmberCore", { diameter: 0.5, segments: 6 }, scene);
  emberCore.position.y = 0.28;
  emberCore.material = emberMat;
  emberCore.parent = fire;
  emberCore.isPickable = false;
  obstacles.push({ x: HUB.campfire.pos.x, z: HUB.campfire.pos.z, r: HUB.campfire.radius + 0.4 });

  // --- 4. Скамьи + бочки + ящики вокруг костра ---
  const clutter: Mesh[] = [];
  const benchN = 5;
  for (let i = 0; i < benchN; i++) {
    const a = (i / benchN) * Math.PI * 2 + 0.5;
    const bx = cx + Math.cos(a) * 4.2;
    const bz = cz + Math.sin(a) * 4.2;
    const seat = MeshBuilder.CreateBox(`bench${i}`, { width: 2, height: 0.18, depth: 0.5 }, scene);
    seat.position.set(bx, groundY(bx, bz) + 0.45, bz);
    seat.rotation.y = a + Math.PI / 2;
    clutter.push(seat);
    for (const s of [-0.8, 0.8]) {
      const leg = MeshBuilder.CreateBox(`benchLeg${i}_${s}`, { width: 0.16, height: 0.45, depth: 0.4 }, scene);
      leg.position.set(bx + Math.cos(a + Math.PI / 2) * s, groundY(bx, bz) + 0.22, bz + Math.sin(a + Math.PI / 2) * s);
      clutter.push(leg);
    }
  }
  // бочки и ящики — врассыпную по краю площади
  const props: { x: number; z: number; kind: "barrel" | "crate" }[] = [
    { x: cx + 6.5, z: cz - 2.5, kind: "barrel" },
    { x: cx + 7, z: cz - 1, kind: "crate" },
    { x: cx - 6, z: cz + 4.5, kind: "barrel" },
    { x: cx - 5, z: cz + 5.5, kind: "crate" },
    { x: cx + 1, z: cz + 7, kind: "barrel" },
    { x: cx - 7.5, z: cz - 4, kind: "crate" },
  ];
  for (const p of props) {
    const gy = groundY(p.x, p.z);
    if (p.kind === "barrel") {
      const b = MeshBuilder.CreateCylinder(`barrel_${p.x}_${p.z}`, { height: 1, diameter: 0.7, tessellation: 10 }, scene);
      b.position.set(p.x, gy + 0.5, p.z);
      clutter.push(b);
    } else {
      const c = MeshBuilder.CreateBox(`crate_${p.x}_${p.z}`, { size: 0.8 }, scene);
      c.position.set(p.x, gy + 0.4, p.z);
      c.rotation.y = (p.x * 13.3) % Math.PI;
      clutter.push(c);
    }
    obstacles.push({ x: p.x, z: p.z, r: 0.6 });
  }
  merge(clutter, "hubClutter", matWoodLite);

  // --- 5. Лагерные фонари на столбах (эмиссив, без PointLight) ---
  const lanternPosts: Mesh[] = [];
  const lanternGlobes: Mesh[] = [];
  const lampN = 6;
  for (let i = 0; i < lampN; i++) {
    const a = (i / lampN) * Math.PI * 2;
    const lx = cx + Math.cos(a) * (HUB.plazaRadius - 1);
    const lz = cz + Math.sin(a) * (HUB.plazaRadius - 1);
    const gy = groundY(lx, lz);
    const post = MeshBuilder.CreateCylinder(`lampPost${i}`, { height: 2.6, diameter: 0.14 }, scene);
    post.position.set(lx, gy + 1.3, lz);
    lanternPosts.push(post);
    const globe = MeshBuilder.CreateSphere(`lampGlobe${i}`, { diameter: 0.34, segments: 6 }, scene);
    globe.position.set(lx, gy + 2.55, lz);
    lanternGlobes.push(globe);
    obstacles.push({ x: lx, z: lz, r: 0.3 });
  }
  merge(lanternPosts, "hubLampPosts", matWood);
  merge(lanternGlobes, "hubLampGlobes", lanternMat);

  // --- 6. Главные ворота: две башенки + перекладина + баннер ---
  const g = HUB.gate;
  const gy = groundY(g.pos.x, g.pos.z);
  // ось «поперёк» ворот
  const perpX = -g.dir.z;
  const perpZ = g.dir.x;
  const gateParts: Mesh[] = [];
  for (const s of [-1, 1]) {
    const tx = g.pos.x + perpX * (g.width / 2) * s;
    const tz = g.pos.z + perpZ * (g.width / 2) * s;
    const tgy = groundY(tx, tz);
    const tower = MeshBuilder.CreateBox(`gateTower${s}`, { width: 1.1, height: g.height + 1.5, depth: 1.1 }, scene);
    tower.position.set(tx, tgy + (g.height + 1.5) / 2, tz);
    gateParts.push(tower);
    const roof = MeshBuilder.CreateCylinder(`gateRoof${s}`, { height: 1, diameterBottom: 1.7, diameterTop: 0, tessellation: 4 }, scene);
    roof.position.set(tx, tgy + g.height + 2, tz);
    roof.rotation.y = Math.PI / 4;
    gateParts.push(roof);
    obstacles.push({ x: tx, z: tz, r: 0.9 });
  }
  const lintel = MeshBuilder.CreateBox("gateLintel", { width: g.width + 1.2, height: 0.7, depth: 0.9 }, scene);
  lintel.position.set(g.pos.x, gy + g.height, g.pos.z);
  lintel.rotation.y = Math.atan2(g.dir.x, g.dir.z);
  gateParts.push(lintel);
  merge(gateParts, "hubGate", matWood);
  const gateBanner = MeshBuilder.CreatePlane("hubGateBanner", { width: 1.4, height: 2.6 }, scene);
  gateBanner.position.set(g.pos.x, gy + g.height - 1.4, g.pos.z);
  gateBanner.rotation.y = Math.atan2(g.dir.x, g.dir.z) + Math.PI / 2;
  gateBanner.material = matBanner;
  gateBanner.parent = root;
  gateBanner.isPickable = false;

  // --- 7. Утоптанная дорога от ворот к поляне (сегментами по рельефу) ---
  const segs = 10;
  const pathParts: Mesh[] = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    const mx = g.pos.x + g.dir.x * HUB.path.length * ((t0 + t1) / 2);
    const mz = g.pos.z + g.dir.z * HUB.path.length * ((t0 + t1) / 2);
    const seg = MeshBuilder.CreateBox(`hubPath${i}`, {
      width: HUB.path.width,
      height: 0.1,
      depth: (HUB.path.length / segs) * 1.15,
    }, scene);
    seg.position.set(mx, groundY(mx, mz) + 0.04, mz);
    seg.rotation.y = Math.atan2(g.dir.x, g.dir.z);
    pathParts.push(seg);
  }
  merge(pathParts, "hubPath", matPath);

  // --- 8. Периметр лагеря: столбы с редким заборным пряслом (не глухая стена) ---
  const fenceParts: Mesh[] = [];
  const postsN = 22;
  for (let i = 0; i < postsN; i++) {
    const a = (i / postsN) * Math.PI * 2;
    // разрыв в заборе на стороне ворот
    const toGate = Math.atan2(g.dir.z, g.dir.x);
    let da = Math.abs(((a - toGate + Math.PI) % (Math.PI * 2)) - Math.PI);
    if (da < 0.5) continue;
    const fx = cx + Math.cos(a) * (HUB.campRadius - 0.5);
    const fz = cz + Math.sin(a) * (HUB.campRadius - 0.5);
    const fgy = groundY(fx, fz);
    const post = MeshBuilder.CreateBox(`fence${i}`, { width: 0.22, height: 1.5, depth: 0.22 }, scene);
    post.position.set(fx, fgy + 0.75, fz);
    fenceParts.push(post);
    // жердь к следующему столбу
    const a2 = ((i + 1) / postsN) * Math.PI * 2;
    da = Math.abs(((a2 - toGate + Math.PI) % (Math.PI * 2)) - Math.PI);
    if (da < 0.5) continue;
    const rail = MeshBuilder.CreateBox(`rail${i}`, {
      width: (Math.PI * 2 * HUB.campRadius) / postsN,
      height: 0.14,
      depth: 0.1,
    }, scene);
    rail.position.set(
      cx + Math.cos(a + Math.PI / postsN) * (HUB.campRadius - 0.5),
      fgy + 0.95,
      cz + Math.sin(a + Math.PI / postsN) * (HUB.campRadius - 0.5),
    );
    rail.rotation.y = -(a + Math.PI / postsN) + Math.PI / 2;
    fenceParts.push(rail);
  }
  merge(fenceParts, "hubFence", matWood);

  // --- 9. Оружейная: навес + стойки (само оружие ставит CombatSystem по
  //        zone.*Home — они уже указывают сюда, см. Zone.ts) ---
  {
    const w = HUB.zones.weapons;
    const gy0 = groundY(w.x, w.z);
    const faceYaw = Math.atan2(cx - w.x, cz - w.z);
    const parts: Mesh[] = [];
    // 4 столба навеса
    for (const [sx, sz] of [[-2.5, -1.5], [2.5, -1.5], [-2.5, 1.5], [2.5, 1.5]] as const) {
      const px = w.x + Math.cos(faceYaw) * sx - Math.sin(faceYaw) * sz;
      const pz = w.z - Math.sin(faceYaw) * sx - Math.cos(faceYaw) * sz;
      const post = MeshBuilder.CreateCylinder(`wArmPost`, { height: 2.6, diameter: 0.16 }, scene);
      post.position.set(px, groundY(px, pz) + 1.3, pz);
      parts.push(post);
    }
    // стойка-планка за оружием
    const rack = MeshBuilder.CreateBox("wArmRack", { width: 5, height: 1.1, depth: 0.2 }, scene);
    rack.position.set(w.x, gy0 + 0.9, w.z);
    rack.rotation.y = faceYaw;
    parts.push(rack);
    const rack2 = MeshBuilder.CreateBox("wArmRack2", { width: 5, height: 0.15, depth: 0.4 }, scene);
    rack2.position.set(w.x, gy0 + 0.1, w.z);
    rack2.rotation.y = faceYaw;
    parts.push(rack2);
    merge(parts, "hubWeaponsRack", matWood);
    // навес-полотно
    const roof = MeshBuilder.CreatePlane("hubWeaponsCanopy", { width: 6, height: 4 }, scene);
    roof.rotation.x = Math.PI / 2;
    roof.position.set(w.x, gy0 + 2.6, w.z);
    roof.material = flatMat(scene, "hubCanopyW", C.canvas, undefined, true);
    roof.parent = root;
    roof.isPickable = false;
    obstacles.push({ x: w.x, z: w.z, r: 1.4 });
  }

  // --- 10. Тренировочная площадка: колышки-дистанции у чучел (сами чучела
  //         рисует существующая система Dummy по HUB.training.dummies) ---
  {
    const t = HUB.zones.training;
    const patch = MeshBuilder.CreateDisc("hubTrainDirt", { radius: 7, tessellation: 24 }, scene);
    patch.rotation.x = Math.PI / 2;
    patch.position.set(t.x, groundY(t.x, t.z) + 0.06, t.z);
    patch.material = matPath;
    patch.parent = root;
    patch.isPickable = false;
    const stakes: Mesh[] = [];
    for (const d of HUB.training.dummies) {
      const s = MeshBuilder.CreateBox("trainStake", { width: 0.5, height: 0.12, depth: 0.5 }, scene);
      s.position.set(d.x, groundY(d.x, d.z) + 0.07, d.z);
      stakes.push(s);
      obstacles.push({ x: d.x, z: d.z, r: 0.45 });
    }
    merge(stakes, "hubTrainStakes", matStone);
  }

  // --- 11. Главный шатёр (позади площади) ---
  {
    const mt = HUB.zones.mainTent;
    const gy0 = groundY(mt.x, mt.z);
    const parts: Mesh[] = [];
    for (const [sx, sz] of [[-5, -4], [5, -4], [-5, 4], [5, 4], [0, 0]] as const) {
      const pole = MeshBuilder.CreateCylinder("tentPole", { height: sx === 0 && sz === 0 ? 5.2 : 3.6, diameter: 0.2 }, scene);
      pole.position.set(mt.x + sx, gy0 + (sx === 0 && sz === 0 ? 2.6 : 1.8), mt.z + sz);
      parts.push(pole);
    }
    merge(parts, "hubTentPoles", matWood);
    // шатёр-крыша: четыре ската пирамидой
    const roof = MeshBuilder.CreateCylinder("hubTentRoof", { height: 2.2, diameterBottom: 15, diameterTop: 0, tessellation: 4 }, scene);
    roof.position.set(mt.x, gy0 + 4.2, mt.z);
    roof.rotation.y = Math.PI / 4;
    roof.material = flatMat(scene, "hubTentCanvas", C.canvas, undefined, true);
    roof.parent = root;
    roof.isPickable = false;
    // стены-полотна с трёх сторон (вход со стороны площади открыт)
    for (const [wx, wz, ww, ry] of [[0, -4, 10, 0], [-5, 0, 8, Math.PI / 2], [5, 0, 8, Math.PI / 2]] as const) {
      const wall = MeshBuilder.CreatePlane("tentWall", { width: ww, height: 3.4 }, scene);
      wall.position.set(mt.x + wx, gy0 + 1.7, mt.z + wz);
      wall.rotation.y = ry;
      wall.material = flatMat(scene, "hubTentWall", C.canvas.scale(0.92), undefined, true);
      wall.parent = root;
      wall.isPickable = false;
    }
    const banner = MeshBuilder.CreatePlane("hubTentBanner", { width: 1.3, height: 3 }, scene);
    banner.position.set(mt.x, gy0 + 3.4, mt.z + 4.05);
    banner.material = matBanner;
    banner.parent = root;
    banner.isPickable = false;
    obstacles.push({ x: mt.x - 3.5, z: mt.z, r: 2 }, { x: mt.x + 3.5, z: mt.z, r: 2 }, { x: mt.x, z: mt.z - 3.5, r: 2 });
  }

  // --- 12. Смотровая башня (ориентир, виден отовсюду) ---
  {
    const wt = HUB.zones.watchTower;
    const gy0 = groundY(wt.x, wt.z);
    const H = 9;
    const parts: Mesh[] = [];
    for (const [sx, sz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) {
      const leg = MeshBuilder.CreateBox("towerLeg", { width: 0.3, height: H, depth: 0.3 }, scene);
      leg.position.set(wt.x + sx, gy0 + H / 2, wt.z + sz);
      parts.push(leg);
      // раскосы
      const brace = MeshBuilder.CreateBox("towerBrace", { width: 0.16, height: 4.6, depth: 0.16 }, scene);
      brace.position.set(wt.x + sx * 0.5, gy0 + 2.4, wt.z + sz);
      brace.rotation.z = sx > 0 ? 0.6 : -0.6;
      parts.push(brace);
    }
    const platform = MeshBuilder.CreateBox("towerPlatform", { width: 4.4, height: 0.35, depth: 4.4 }, scene);
    platform.position.set(wt.x, gy0 + H, wt.z);
    parts.push(platform);
    const rail = MeshBuilder.CreateBox("towerRail", { width: 4.4, height: 1, depth: 4.4 }, scene);
    rail.position.set(wt.x, gy0 + H + 0.7, wt.z);
    parts.push(rail);
    merge(parts, "hubWatchTower", matWood);
    const roof = MeshBuilder.CreateCylinder("towerRoof", { height: 1.8, diameterBottom: 5.4, diameterTop: 0, tessellation: 4 }, scene);
    roof.position.set(wt.x, gy0 + H + 2.1, wt.z);
    roof.rotation.y = Math.PI / 4;
    roof.material = flatMat(scene, "hubTowerRoof", C.banner.scale(0.8), undefined, true);
    roof.parent = root;
    roof.isPickable = false;
    const flag = MeshBuilder.CreatePlane("hubTowerFlag", { width: 1.6, height: 1 }, scene);
    flag.position.set(wt.x + 0.9, gy0 + H + 3.4, wt.z);
    flag.material = matBanner;
    flag.parent = root;
    flag.isPickable = false;
    for (const [sx, sz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]] as const) {
      obstacles.push({ x: wt.x + sx, z: wt.z + sz, r: 0.4 });
    }
  }

  // --- 13. Торговые лавки (декор) ---
  {
    const mk = HUB.zones.market;
    for (let i = 0; i < 3; i++) {
      const sx = mk.x + (i - 1) * 3.6;
      const sz = mk.z + (i % 2) * 1.4;
      const gy0 = groundY(sx, sz);
      const parts: Mesh[] = [];
      const table = MeshBuilder.CreateBox("stallTable", { width: 2.4, height: 0.15, depth: 1 }, scene);
      table.position.set(sx, gy0 + 0.9, sz);
      parts.push(table);
      for (const lx of [-1, 1]) for (const lz of [-0.4, 0.4]) {
        const leg = MeshBuilder.CreateBox("stallLeg", { width: 0.12, height: 0.9, depth: 0.12 }, scene);
        leg.position.set(sx + lx, gy0 + 0.45, sz + lz);
        parts.push(leg);
      }
      for (const px of [-1.1, 1.1]) {
        const post = MeshBuilder.CreateCylinder("stallPost", { height: 2.4, diameter: 0.12 }, scene);
        post.position.set(sx + px, gy0 + 1.2, sz - 0.4);
        parts.push(post);
      }
      merge(parts, "hubStall", matWoodLite);
      const awn = MeshBuilder.CreatePlane("stallAwning", { width: 2.8, height: 1.8 }, scene);
      awn.rotation.x = Math.PI / 2.6;
      awn.position.set(sx, gy0 + 2.3, sz - 0.1);
      awn.material = flatMat(scene, "hubAwn", i % 2 ? C.canvas : C.banner.scale(0.9), undefined, true);
      awn.parent = root;
      awn.isPickable = false;
      obstacles.push({ x: sx, z: sz, r: 1.3 });
    }
  }

  // --- 14. Кузница (декор + свечение горна) ---
  const forgeMat = flatMat(scene, "hubForgeGlow", new Color3(1, 0.45, 0.12), new Color3(1, 0.35, 0.1));
  {
    const f = HUB.zones.forge;
    const gy0 = groundY(f.x, f.z);
    const parts: Mesh[] = [];
    const furnace = MeshBuilder.CreateBox("forgeFurnace", { width: 1.6, height: 1.6, depth: 1.6 }, scene);
    furnace.position.set(f.x, gy0 + 0.8, f.z);
    parts.push(furnace);
    const chimney = MeshBuilder.CreateCylinder("forgeChimney", { height: 2.4, diameter: 0.5 }, scene);
    chimney.position.set(f.x, gy0 + 2.6, f.z);
    parts.push(chimney);
    const anvilBase = MeshBuilder.CreateCylinder("forgeAnvilBase", { height: 0.7, diameter: 0.5 }, scene);
    anvilBase.position.set(f.x + 2, gy0 + 0.35, f.z);
    parts.push(anvilBase);
    const anvil = MeshBuilder.CreateBox("forgeAnvil", { width: 0.9, height: 0.35, depth: 0.35 }, scene);
    anvil.position.set(f.x + 2, gy0 + 0.85, f.z);
    parts.push(anvil);
    merge(parts, "hubForge", matStone);
    const glow = MeshBuilder.CreateBox("forgeGlow", { width: 0.8, height: 0.6, depth: 0.2 }, scene);
    glow.position.set(f.x, gy0 + 0.7, f.z + 0.75);
    glow.material = forgeMat;
    glow.parent = root;
    glow.isPickable = false;
    obstacles.push({ x: f.x, z: f.z, r: 1.2 }, { x: f.x + 2, z: f.z, r: 0.4 });
  }

  // --- 15. Placeholder NPC (idle-капсулы, лёгкое покачивание) + инструктор ---
  const npcMat = flatMat(scene, "hubNpc", new Color3(0.42, 0.4, 0.45));
  const instrMat = flatMat(scene, "hubInstr", new Color3(0.3, 0.42, 0.5));
  const npcs: { mesh: Mesh; phase: number; baseY: number }[] = [];
  const npcSpots: { x: number; z: number; instructor?: boolean }[] = [
    { x: cx + 2.5, z: cz + 3.5 },
    { x: cx - 2, z: cz + 3 },
    { x: HUB.zones.market.x, z: HUB.zones.market.z + 2 },
    { x: HUB.zones.forge.x + 0.6, z: HUB.zones.forge.z + 1.4 },
    { x: HUB.zones.instructor.x, z: HUB.zones.instructor.z, instructor: true },
  ];
  for (const s of npcSpots) {
    const gy0 = groundY(s.x, s.z);
    const body = MeshBuilder.CreateCapsule(`hubNpc`, { radius: 0.28, height: 1.7 }, scene);
    body.position.set(s.x, gy0 + 0.85, s.z);
    body.material = s.instructor ? instrMat : npcMat;
    body.parent = root;
    body.isPickable = false;
    npcs.push({ mesh: body, phase: (s.x * 7.3 + s.z) % 6.28, baseY: gy0 + 0.85 });
    obstacles.push({ x: s.x, z: s.z, r: 0.4 });
    if (s.instructor) {
      const tag = makeSignTexture(scene, "ИНСТРУКТОР", "Возьми оружие. Попробуй чучела.\nПроверь управление. Готов — иди к воротам.");
      const plane = MeshBuilder.CreatePlane("hubInstrSign", { width: 2.4, height: 1.4 }, scene);
      plane.position.set(s.x, gy0 + 2.3, s.z);
      plane.material = tag;
      plane.rotation.y = Math.atan2(cx - s.x, cz - s.z); // лицом к площади
      plane.parent = root;
      plane.isPickable = false;
    }
  }

  // --- 16. Таблички управления (устройство-агностично: все три варианта) ---
  const signSpecs: { at: { x: number; z: number }; title: string; body: string }[] = [
    { at: { x: cx + 3, z: cz - 4 }, title: "ДВИЖЕНИЕ", body: "WASD  ·  левый стик  ·  джойстик" },
    { at: { x: HUB.zones.weapons.x, z: HUB.zones.weapons.z + 3 }, title: "ВЗЯТЬ", body: "E  ·  Grip  ·  подойти" },
    { at: { x: HUB.zones.training.x, z: HUB.zones.training.z + 4 }, title: "АТАКА", body: "ЛКМ  ·  Trigger  ·  кнопка удара" },
  ];
  for (const s of signSpecs) {
    const gy0 = groundY(s.at.x, s.at.z);
    const post = MeshBuilder.CreateCylinder("hubSignPost", { height: 1.9, diameter: 0.12 }, scene);
    post.position.set(s.at.x, gy0 + 0.95, s.at.z);
    post.material = matWood;
    post.parent = root;
    post.isPickable = false;
    const board = MeshBuilder.CreatePlane("hubSign", { width: 1.9, height: 1.05 }, scene);
    board.position.set(s.at.x, gy0 + 1.9, s.at.z);
    board.material = makeSignTexture(scene, s.title, s.body);
    board.rotation.y = Math.atan2(cx - s.at.x, cz - s.at.z); // лицом к площади
    board.parent = root;
    board.isPickable = false;
  }

  // ---- день/ночь: костёр и фонари ярче в темноте; NPC чуть покачиваются ----
  const emberBase = C.ember.clone();
  const lanternBase = new Color3(1, 0.7, 0.35);
  const forgeBase = new Color3(1, 0.35, 0.1);
  function tick(daylight: number): void {
    const night = 1 - Math.min(1, Math.max(0, daylight));
    const glow = 0.25 + night * 0.9;
    emberMat.emissiveColor.copyFrom(emberBase).scaleInPlace(0.5 + night * 0.6);
    lanternMat.emissiveColor.copyFrom(lanternBase).scaleInPlace(glow);
    forgeMat.emissiveColor.copyFrom(forgeBase).scaleInPlace(0.7 + night * 0.4);
    const t = performance.now() / 1000;
    for (const n of npcs) {
      n.mesh.position.y = n.baseY + Math.sin(t * 1.6 + n.phase) * 0.03;
      n.mesh.rotation.y = Math.sin(t * 0.4 + n.phase) * 0.4;
    }
  }
  tick(1);

  return {
    obstacles,
    tick,
    dispose(): void {
      root.dispose(false, true);
    },
  };
}
