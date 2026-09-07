import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";

import { HUB } from "#shared/hub";
import { terrainHeight } from "#shared/terrain";
import type { Obstacle } from "../props";
import { LIGHT_BUDGET } from "../Fireflies";
import { buildHubCampfire } from "./HubCampfire";

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
  medic: new Color3(0.24, 0.34, 0.52),
  ember: new Color3(1.0, 0.5, 0.15),
};

/**
 * Плоский материал лагеря. `emissive` задан — самосветящийся (костёр, фонари),
 * его крутит tick сам. Не задан — обычная поверхность: движок днём даёт нулевую
 * заливку (ambient=0), и без подсветки боковые грани уходят в чёрное — как во
 * всём паке, кладём эмиссив ~25% от цвета и модулируем его дневным светом в
 * tick (ночью почти ноль, чтобы лагерь не светился сам).
 */
function flatMat(
  scene: Scene,
  name: string,
  color: Color3,
  emissive?: Color3,
  dayLit?: { m: StandardMaterial; base: Color3 }[],
): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0, 0, 0);
  m.backFaceCulling = false;
  m.twoSidedLighting = true;
  m.maxSimultaneousLights = LIGHT_BUDGET; // ловит свет костра ночью
  if (emissive) {
    m.emissiveColor = emissive;
  } else if (dayLit) {
    m.emissiveColor = color.scale(0.25);
    dayLit.push({ m, base: color.clone() });
  }
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

  // Обычные поверхности лагеря — их эмиссив-заливку крутит tick по дню/ночи.
  const dayLit: { m: StandardMaterial; base: Color3 }[] = [];
  const matDirt = flatMat(scene, "hubDirt", C.dirt, undefined, dayLit);
  const matPath = flatMat(scene, "hubPath", C.path, undefined, dayLit);
  const matWood = flatMat(scene, "hubWood", C.wood, undefined, dayLit);
  const matWoodLite = flatMat(scene, "hubWoodLite", C.woodLight, undefined, dayLit);
  const matStone = flatMat(scene, "hubStone", C.stone, undefined, dayLit);
  const matBanner = flatMat(scene, "hubBanner", C.banner, C.banner.scale(0.12));
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

  // Пламя, ореол, искры, угли — портированный костёр (см. HubCampfire).
  const campfire = buildHubCampfire(
    scene,
    new Vector3(HUB.campfire.pos.x, groundY(cx, cz) + 0.1, HUB.campfire.pos.z),
  );
  obstacles.push({ x: HUB.campfire.pos.x, z: HUB.campfire.pos.z, r: HUB.campfire.radius + 0.4 });

  // --- 4. Скамьи + бочки + ящики вокруг костра ---
  const clutter: Mesh[] = [];
  const benchN = 6;
  for (let i = 0; i < benchN; i++) {
    const a = (i / benchN) * Math.PI * 2 + 0.5;
    const bx = cx + Math.cos(a) * 5.2;
    const bz = cz + Math.sin(a) * 5.2;
    const seat = MeshBuilder.CreateBox(`bench${i}`, { width: 2, height: 0.18, depth: 0.5 }, scene);
    seat.position.set(bx, groundY(bx, bz) + 0.45, bz);
    seat.rotation.y = a + Math.PI / 2;
    clutter.push(seat);
    for (const s of [-0.8, 0.8]) {
      const leg = MeshBuilder.CreateBox(`benchLeg${i}_${s}`, { width: 0.16, height: 0.45, depth: 0.4 }, scene);
      leg.position.set(bx + Math.cos(a + Math.PI / 2) * s, groundY(bx, bz) + 0.22, bz + Math.sin(a + Math.PI / 2) * s);
      clutter.push(leg);
    }
    // коллизия вдоль скамьи (2 круга — длинная, одним не накрыть)
    for (const s of [-0.7, 0.7]) {
      obstacles.push({
        x: bx + Math.cos(a + Math.PI / 2) * s,
        z: bz + Math.sin(a + Math.PI / 2) * s,
        r: 0.55,
      });
    }
  }
  // бочки и ящики — врассыпную по краю площади
  const props: { x: number; z: number; kind: "barrel" | "crate" }[] = [
    { x: cx + 11, z: cz - 4, kind: "barrel" },
    { x: cx + 11.8, z: cz - 2.4, kind: "crate" },
    { x: cx - 10, z: cz + 7.5, kind: "barrel" },
    { x: cx - 8.8, z: cz + 8.8, kind: "crate" },
    { x: cx + 2, z: cz + 12, kind: "barrel" },
    { x: cx - 12.5, z: cz - 6, kind: "crate" },
    { x: cx + 6, z: cz - 11, kind: "barrel" },
    { x: cx - 4, z: cz - 12.5, kind: "crate" },
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
  const lampN = 8;
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
  const postsN = 30;
  for (let i = 0; i < postsN; i++) {
    const a = (i / postsN) * Math.PI * 2;
    // разрыв в заборе на стороне ворот
    const toGate = Math.atan2(g.dir.z, g.dir.x);
    let da = Math.abs(((a - toGate + Math.PI) % (Math.PI * 2)) - Math.PI);
    if (da < 0.15) continue;
    const fx = cx + Math.cos(a) * (HUB.campRadius - 0.5);
    const fz = cz + Math.sin(a) * (HUB.campRadius - 0.5);
    const fgy = groundY(fx, fz);
    const post = MeshBuilder.CreateBox(`fence${i}`, { width: 0.22, height: 1.5, depth: 0.22 }, scene);
    post.position.set(fx, fgy + 0.75, fz);
    fenceParts.push(post);
    // жердь к следующему столбу
    const a2 = ((i + 1) / postsN) * Math.PI * 2;
    da = Math.abs(((a2 - toGate + Math.PI) % (Math.PI * 2)) - Math.PI);
    if (da < 0.15) continue;
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
  // Забор — сплошная коллизия по кольцу (кроме проёма ворот): игрок выходит
  // из лагеря только через ворота на дорогу к поляне.
  {
    const toGate = Math.atan2(g.dir.z, g.dir.x);
    // Круги должны перекрываться, иначе игрок пролезает между ними:
    // шаг по дуге < 2r. Радиус вырос — считаем количество от длины окружности.
    const rr = 1.2;
    const ring = Math.ceil((2 * Math.PI * (HUB.campRadius - 0.5)) / (rr * 1.6));
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      const da = Math.abs(((a - toGate + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (da < 0.2) continue; // проём ворот
      obstacles.push({
        x: cx + Math.cos(a) * (HUB.campRadius - 0.5),
        z: cz + Math.sin(a) * (HUB.campRadius - 0.5),
        r: rr,
      });
    }
  }

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
    roof.material = flatMat(scene, "hubCanopyW", C.canvas, undefined, dayLit);
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
    roof.material = flatMat(scene, "hubTentCanvas", C.canvas, undefined, dayLit);
    roof.parent = root;
    roof.isPickable = false;
    // стены-полотна с трёх сторон (вход со стороны площади открыт)
    for (const [wx, wz, ww, ry] of [[0, -4, 10, 0], [-5, 0, 8, Math.PI / 2], [5, 0, 8, Math.PI / 2]] as const) {
      const wall = MeshBuilder.CreatePlane("tentWall", { width: ww, height: 3.4 }, scene);
      wall.position.set(mt.x + wx, gy0 + 1.7, mt.z + wz);
      wall.rotation.y = ry;
      wall.material = flatMat(scene, "hubTentWall", C.canvas.scale(0.92), undefined, dayLit);
      wall.parent = root;
      wall.isPickable = false;
    }
    const banner = MeshBuilder.CreatePlane("hubTentBanner", { width: 1.3, height: 3 }, scene);
    banner.position.set(mt.x, gy0 + 3.4, mt.z + 4.05);
    banner.material = matBanner;
    banner.parent = root;
    banner.isPickable = false;
    // Коллизия по стенам шатра (задняя + две боковые), вход со стороны
    // площади открыт.
    for (let t = -1; t <= 1; t += 0.5) {
      obstacles.push({ x: mt.x + t * 4.5, z: mt.z - 4, r: 0.7 }); // задняя
      obstacles.push({ x: mt.x - 5, z: mt.z + t * 3.6, r: 0.7 }); // левая
      obstacles.push({ x: mt.x + 5, z: mt.z + t * 3.6, r: 0.7 }); // правая
    }
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
    roof.material = flatMat(scene, "hubTowerRoof", C.banner.scale(0.8), undefined, dayLit);
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
      awn.material = flatMat(scene, "hubAwn", i % 2 ? C.canvas : C.banner.scale(0.9), undefined, dayLit);
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
  const npcMat = flatMat(scene, "hubNpc", new Color3(0.42, 0.4, 0.45), undefined, dayLit);
  const instrMat = flatMat(scene, "hubInstr", new Color3(0.3, 0.42, 0.5), undefined, dayLit);
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
  }

  // --- 16. Палатка медика (синяя, юго-запад) ---
  {
    const md = HUB.zones.medic;
    const gy0 = groundY(md.x, md.z);
    const parts: Mesh[] = [];
    for (const [sx, sz] of [[-2.6, -2.2], [2.6, -2.2], [-2.6, 2.2], [2.6, 2.2]] as const) {
      const pole = MeshBuilder.CreateCylinder("medicPole", { height: 2.6, diameter: 0.16 }, scene);
      pole.position.set(md.x + sx, gy0 + 1.3, md.z + sz);
      parts.push(pole);
    }
    merge(parts, "hubMedicPoles", matWood);
    const roof = MeshBuilder.CreateCylinder(
      "hubMedicRoof",
      { height: 1.5, diameterBottom: 8, diameterTop: 0, tessellation: 4 },
      scene,
    );
    roof.position.set(md.x, gy0 + 3.3, md.z);
    roof.rotation.y = Math.PI / 4;
    roof.material = flatMat(scene, "hubMedicCanvas", C.medic, undefined, dayLit);
    roof.parent = root;
    roof.isPickable = false;
    for (const [wx, wz, ww, ry] of [
      [0, -2.2, 5.2, 0],
      [-2.6, 0, 4.4, Math.PI / 2],
    ] as const) {
      const wall = MeshBuilder.CreatePlane("medicWall", { width: ww, height: 2.4 }, scene);
      wall.position.set(md.x + wx, gy0 + 1.2, md.z + wz);
      wall.rotation.y = ry;
      wall.material = flatMat(scene, "hubMedicWall", C.medic.scale(0.85), undefined, dayLit);
      wall.parent = root;
      wall.isPickable = false;
    }
    for (let t = -1; t <= 1; t += 0.5) {
      obstacles.push({ x: md.x + t * 2.4, z: md.z - 2.2, r: 0.6 });
      obstacles.push({ x: md.x - 2.6, z: md.z + t * 2, r: 0.6 });
    }
  }

  // --- 17. Знамёна на шестах по кольцу площади (как на концепте) ---
  {
    const bannerParts: Mesh[] = [];
    const n = 8;
    const toGate = Math.atan2(g.dir.z, g.dir.x);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const da = Math.abs(((a - toGate + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (da < 0.45) continue; // не загораживаем проход к воротам
      const bx = cx + Math.cos(a) * (HUB.plazaRadius + 1.5);
      const bz = cz + Math.sin(a) * (HUB.plazaRadius + 1.5);
      const bgy = groundY(bx, bz);
      const pole = MeshBuilder.CreateCylinder("bannerPole", { height: 6.5, diameter: 0.18 }, scene);
      pole.position.set(bx, bgy + 3.25, bz);
      bannerParts.push(pole);
      const cloth = MeshBuilder.CreatePlane("bannerCloth", { width: 1.1, height: 3.2 }, scene);
      cloth.position.set(bx, bgy + 4.2, bz);
      cloth.rotation.y = a + Math.PI / 2;
      cloth.material = matBanner;
      cloth.parent = root;
      cloth.isPickable = false;
      obstacles.push({ x: bx, z: bz, r: 0.3 });
    }
    merge(bannerParts, "hubBannerPoles", matWood);
  }

  // --- 18. Палатки игроков по периметру ---
  {
    const parts: Mesh[] = [];
    const canvases: Mesh[] = [];
    for (const t of HUB.playerTents) {
      const tx = cx + Math.cos(t.a) * t.r;
      const tz = cz + Math.sin(t.a) * t.r;
      const tgy = groundY(tx, tz);
      const face = t.a + Math.PI; // вход смотрит к центру
      const ridge = MeshBuilder.CreateCylinder("ptRidge", { height: 3.4, diameter: 0.12 }, scene);
      ridge.rotation.z = Math.PI / 2;
      ridge.rotation.y = face;
      ridge.position.set(tx, tgy + 1.9, tz);
      parts.push(ridge);
      const cone = MeshBuilder.CreateCylinder(
        "ptCanvas",
        { height: 2.0, diameterBottom: 3.6, diameterTop: 0, tessellation: 4 },
        scene,
      );
      cone.position.set(tx, tgy + 1.0, tz);
      cone.rotation.y = face + Math.PI / 4;
      canvases.push(cone);
      obstacles.push({ x: tx, z: tz, r: 1.5 });
    }
    merge(parts, "hubTentRidges", matWood);
    merge(canvases, "hubPlayerTents", flatMat(scene, "hubPtCanvas", C.canvas.scale(0.95), undefined, dayLit));
  }

  // ---- день/ночь: фонари/горн ярче в темноте; NPC покачиваются; костёр ----
  const lanternBase = new Color3(1, 0.7, 0.35);
  const forgeBase = new Color3(1, 0.35, 0.1);
  let last = performance.now();
  function tick(daylight: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const d = Math.min(1, Math.max(0, daylight));
    const night = 1 - d;
    const glow = 0.25 + night * 0.9;
    lanternMat.emissiveColor.copyFrom(lanternBase).scaleInPlace(glow);
    forgeMat.emissiveColor.copyFrom(forgeBase).scaleInPlace(0.7 + night * 0.4);
    campfire.tick(dt, d);
    // Обычные поверхности: днём подсвечиваем боковые грани (заливки от движка
    // нет), ночью гасим почти в ноль — лагерь не должен светиться сам.
    const fill = 0.06 + 0.42 * d;
    for (const g of dayLit) g.m.emissiveColor.copyFrom(g.base).scaleInPlace(fill);
    const t = now / 1000;
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
      campfire.dispose();
      root.dispose(false, true);
    },
  };
}
