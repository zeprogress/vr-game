import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";

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

function flatMat(scene: Scene, name: string, color: Color3, emissive?: Color3): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color;
  m.specularColor = new Color3(0, 0, 0);
  if (emissive) m.emissiveColor = emissive;
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
  const ring = Mesh.MergeMeshes(ringParts, true, true, undefined, false, false);
  if (ring) {
    ring.name = "hubFireRing";
    ring.material = matStone;
    ring.parent = fire;
    ring.isPickable = false;
  }

  const logs: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const l = MeshBuilder.CreateCylinder(`fireLog${i}`, { height: 2.4, diameter: 0.32 }, scene);
    l.rotation.z = Math.PI / 2 - 0.25;
    l.rotation.y = a;
    l.position.set(Math.cos(a) * 0.5, 0.3, Math.sin(a) * 0.5);
    logs.push(l);
  }
  const logMesh = Mesh.MergeMeshes(logs, true, true, undefined, false, false);
  if (logMesh) {
    logMesh.name = "hubFireLogs";
    logMesh.material = matWood;
    logMesh.parent = fire;
    logMesh.isPickable = false;
  }

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
  const clutterMesh = Mesh.MergeMeshes(clutter, true, true, undefined, false, false);
  if (clutterMesh) {
    clutterMesh.name = "hubClutter";
    clutterMesh.material = matWoodLite;
    clutterMesh.parent = root;
    clutterMesh.isPickable = false;
  }

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
  const postMesh = Mesh.MergeMeshes(lanternPosts, true, true, undefined, false, false);
  if (postMesh) {
    postMesh.name = "hubLampPosts";
    postMesh.material = matWood;
    postMesh.parent = root;
    postMesh.isPickable = false;
  }
  const globeMesh = Mesh.MergeMeshes(lanternGlobes, true, true, undefined, false, false);
  if (globeMesh) {
    globeMesh.name = "hubLampGlobes";
    globeMesh.material = lanternMat;
    globeMesh.parent = root;
    globeMesh.isPickable = false;
  }

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
  const gateMesh = Mesh.MergeMeshes(gateParts, true, true, undefined, false, false);
  if (gateMesh) {
    gateMesh.name = "hubGate";
    gateMesh.material = matWood;
    gateMesh.parent = root;
    gateMesh.isPickable = false;
  }
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
  const pathMesh = Mesh.MergeMeshes(pathParts, true, true, undefined, false, false);
  if (pathMesh) {
    pathMesh.name = "hubPath";
    pathMesh.material = matPath;
    pathMesh.parent = root;
    pathMesh.isPickable = false;
  }

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
  const fenceMesh = Mesh.MergeMeshes(fenceParts, true, true, undefined, false, false);
  if (fenceMesh) {
    fenceMesh.name = "hubFence";
    fenceMesh.material = matWood;
    fenceMesh.parent = root;
    fenceMesh.isPickable = false;
  }

  // ---- день/ночь: костёр и фонари ярче в темноте ----
  const emberBase = C.ember.clone();
  const lanternBase = new Color3(1, 0.7, 0.35);
  function tick(daylight: number): void {
    const night = 1 - Math.min(1, Math.max(0, daylight));
    const glow = 0.25 + night * 0.9;
    emberMat.emissiveColor.copyFrom(emberBase).scaleInPlace(0.5 + night * 0.6);
    lanternMat.emissiveColor.copyFrom(lanternBase).scaleInPlace(glow);
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
