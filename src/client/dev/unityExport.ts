import { EngineStore } from "@babylonjs/core/Engines/engineStore";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Matrix } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { Node } from "@babylonjs/core/node";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0";
import { inCatRegion } from "#shared/catacombs";
import { inDunRegion } from "#shared/dungeon";

/**
 * Выгрузка геометрии мира из живой сцены в .glb для Unity-клиента (unity/Assets/Locations).
 * Только для стенда, на странице спектатора (/?spectator=КЛЮЧ) в консоли:
 *   const m = await import("/src/client/dev/unityExport.ts"); await m.prepare(); await m.exportAll();
 * Файлы пишет Vite (unityExportWriter в vite.config.ts).
 */

/** Корни, которые не выгружаем: рельеф и деревья Unity строит сам, сущности, небо и эффекты живут в своём коде. */
const SKIP_ROOT = /^(mob|terrain|clouds|stars|sun|skyDome|blobShadows|bbCaptureTmp|npc_|sporeRing|cfxRing|impCap|hubFire|waterfallMist|avatar|bot|player|spec|loot|drop|beacon|fx|ball|bolt|arrow)/i;
const SKIP_MESH = /^(CommonTree|grass|impCap|nameTag|label|plate|hp)/i;

interface Region {
  name: string;
  test: (x: number, z: number) => boolean;
}

const REGIONS: Region[] = [
  { name: "catacombs", test: (x, z) => inCatRegion(x, z) },
  { name: "dungeon", test: (x, z) => inDunRegion(x, z) },
  { name: "world", test: () => true },
];

function sceneOrThrow() {
  const s = EngineStore.LastCreatedScene;
  if (!s) throw new Error("нет сцены");
  return s;
}

function rootOf(n: Node): Node {
  while (n.parent) n = n.parent;
  return n;
}

/** Меш статичного мира: виден, не скиннут, не из пропускаемых групп. */
function isStatic(m: AbstractMesh): boolean {
  if (!m.isEnabled() || !m.isVisible || m.skeleton || m.getTotalVertices() === 0) return false;
  return !SKIP_ROOT.test(rootOf(m).name) && !SKIP_MESH.test(m.name);
}

/** Сколько мешей и вершин в каждой корневой группе (включая выключенные) — для разбора сцены. */
export function allRoots(): Record<string, { n: number; on: number; v: number }> {
  const by: Record<string, { n: number; on: number; v: number }> = {};
  for (const m of sceneOrThrow().meshes) {
    const e = (by[rootOf(m).name] ??= { n: 0, on: 0, v: 0 });
    e.n++;
    if (m.isEnabled()) e.on++;
    e.v += m.getTotalVertices();
  }
  return by;
}

type Built = { build(): void; root?: Node | null };
type DunFx = Built & { kitReady?: Promise<void>; chunks: Map<string, { geo: AbstractMesh[]; lod0: AbstractMesh[]; lod1: AbstractMesh[] }> };

/**
 * Катакомбы и подземелье строятся, только когда камера внутри, — строим вручную и включаем целиком,
 * у подземелья — ближний уровень детализации (LOD0).
 */
export async function prepare(): Promise<string> {
  const spec = (window as unknown as { spec?: { catFx?: Built; dunFx?: DunFx } }).spec;
  if (!spec) throw new Error("это не страница спектатора");
  const cat = spec.catFx;
  const dun = spec.dunFx;
  // Их update() каждый кадр гасит всё, где нет камеры, — на время выгрузки отключаем (перезагрузка страницы вернёт).
  for (const fx of [cat, dun]) if (fx) (fx as unknown as { update: () => void }).update = () => {};
  if (cat && !cat.root) cat.build();
  cat?.root?.setEnabled?.(true);
  if (dun && !dun.root) dun.build();
  dun?.root?.setEnabled?.(true);
  // Набор подземелья (DungeonKit.glb) грузится асинхронно — ждём, пока появятся куски.
  for (let i = 0; i < 100 && dun && dun.chunks.size === 0; i++) await new Promise((r) => setTimeout(r, 200));
  // Мелочь (жаровни, бочки, ящики — DungeonKit.glb по dunDress) грузится отдельно и позже: ждём её модули.
  const kitReady = (): boolean => sceneOrThrow().meshes.some((m) => /^dun_.*_L0$/.test(m.name));
  for (let i = 0; i < 150 && dun && !kitReady(); i++) await new Promise((r) => setTimeout(r, 200));
  for (const ch of dun?.chunks.values() ?? []) {
    for (const m of ch.geo) m.setEnabled(true);
    for (const m of ch.lod0) m.setEnabled(true);
    for (const m of ch.lod1) m.setEnabled(false);
  }
  // Пусть рамки пересчитаются после включения.
  await new Promise((r) => setTimeout(r, 500));
  return `катакомбы: ${cat?.root ? "есть" : "нет"}, подземелье: кусков ${dun?.chunks.size ?? 0}`;
}

function regionOf(m: AbstractMesh): string {
  // Корневая группа точнее координат: у стен и свода центр рамки бывает за границей области.
  const root = rootOf(m).name;
  if (root === "catacombs" || root === "dungeon") return root;
  const c = m.getBoundingInfo().boundingBox.centerWorld;
  return REGIONS.find((r) => r.test(c.x, c.z))!.name;
}

export function listMeshes(): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const m of sceneOrThrow().meshes) {
    if (!isStatic(m)) continue;
    const r = (out[regionOf(m)] ??= {});
    const k = rootOf(m).name;
    r[k] = (r[k] ?? 0) + 1;
  }
  return out;
}

/**
 * Копия меша в чистую сцену: только позиции/нормали/UV/цвета, сразу в мировых координатах,
 * thin instances развёрнуты. Экспортёр Babylon падает на «живых» мешах игры (особые буферы вершин).
 */
function bakeInto(m: AbstractMesh, out: Scene, warn: string[], rel?: Matrix): void {
  const src = VertexData.ExtractFromMesh(m as Mesh, true, true);
  if (!src.positions || !src.indices) return;
  // rel — обратная матрица корня реквизита: меш пишется в координатах своего корня, а не мира.
  const world = rel ? m.computeWorldMatrix(true).multiply(rel) : m.computeWorldMatrix(true);
  const mats: Matrix[] = [];
  const thin = (m as Mesh).thinInstanceGetWorldMatrices?.() ?? [];
  if (thin.length) for (const t of thin) mats.push(t.multiply(world));
  else mats.push(world);
  mats.forEach((mat, i) => {
    const vd = new VertexData();
    vd.positions = src.positions!.slice();
    vd.indices = src.indices!.slice();
    if (src.normals) vd.normals = src.normals.slice();
    if (src.uvs) vd.uvs = src.uvs.slice();
    if (src.colors) {
      // Цвет вершин — ровно 4 компоненты на вершину, иначе экспортёр не примет.
      const nv = src.positions!.length / 3;
      const per = src.colors.length / nv;
      if (per === 4) vd.colors = src.colors.slice();
      else if (per === 3) {
        const c = new Float32Array(nv * 4);
        for (let k = 0; k < nv; k++) c.set([src.colors[k * 3], src.colors[k * 3 + 1], src.colors[k * 3 + 2], 1], k * 4);
        vd.colors = c;
      }
    }
    vd.transform(mat);
    const copy = new Mesh(thin.length ? `${m.name}_${i}` : m.name, out);
    vd.applyToMesh(copy);
    copy.material = m.material;
    // Отрицательный определитель (зеркало) переворачивает обход треугольников.
    if (mat.determinant() < 0) copy.flipFaces();
  });
  if (thin.length > 500) warn.push(`${m.name}: ${thin.length} копий`);
}

async function exportRegion(name: string): Promise<{ meshes: number; mb: number; warn: string[] }> {
  const scene = sceneOrThrow();
  const out = new Scene(scene.getEngine(), { virtual: true });
  const warn: string[] = [];
  let meshes = 0;
  for (const m of scene.meshes) {
    if (!isStatic(m) || regionOf(m) !== name) continue;
    try {
      bakeInto(m, out, warn);
      meshes++;
    } catch (e) {
      warn.push(`${m.name}: ${String(e)}`);
    }
  }
  if (!meshes) {
    out.dispose();
    return { meshes: 0, mb: 0, warn };
  }
  const glb = await GLTF2Export.GLBAsync(out, name, { exportWithoutWaitingForScene: true });
  out.dispose();
  const blob = Object.values(glb.glTFFiles)[0] as Blob;
  await fetch(`/__unity-export/${name}.glb`, { method: "POST", body: blob });
  return { meshes, mb: Math.round((blob.size / 1048576) * 10) / 10, warn };
}

/**
 * Клипы классов (копьё, молот, кинжалы, лук — world/classPoses.ts) собираются IK прямо на скелете и в
 * файлах моделей их нет. Строим их на рыцаре и выгружаем рыцаря с ними в ClassClips.glb: скелет общий
 * у всех скинов, Unity вешает клипы на любой.
 */
export async function exportClassClips(): Promise<{ clips: string[]; mb: number }> {
  const scene = sceneOrThrow();
  const { loadRig } = await import("../world/models");
  const { buildClassClips, gearSeat, CLASS_CLIPS } = await import("../world/classPoses");
  const rig = (await loadRig(scene, "charKnight"))();
  const groups = buildClassClips(scene, rig, (side, clip) => gearSeat(clip, side));
  groups.forEach((g, i) => (g.name = CLASS_CLIPS[i].name));
  const keep = new Set<Node>();
  const walk = (n: Node): void => {
    keep.add(n);
    for (const c of n.getChildren()) walk(c);
  };
  walk(rig.root);
  const mine = new Set(groups);
  const glb = await GLTF2Export.GLBAsync(scene, "ClassClips", {
    shouldExportNode: (n: Node) => keep.has(n),
    shouldExportAnimation: (a) => [...mine].some((g) => g.targetedAnimations.some((ta) => ta.animation === a)),
    exportWithoutWaitingForScene: true,
  });
  const blob = Object.values(glb.glTFFiles)[0] as Blob;
  await fetch(`/__unity-export/ClassClips.glb`, { method: "POST", body: blob });
  for (const g of groups) g.dispose();
  rig.dispose();
  return { clips: groups.map((g) => g.name), mb: Math.round((blob.size / 1048576) * 10) / 10 };
}

/**
 * Оружие в руках: каждый класс и тир (makeWeaponMesh — glb-модели и процедурные щит/посох), посаженный
 * в кулак рыцаря по BOT_GEAR, как seatBotGear в RemoteAvatar. Unity берёт из Gear.glb и модель, и её
 * положение относительно кулака — без пересчёта координат вручную.
 */
export async function exportGear(): Promise<{ items: number; mb: number }> {
  const scene = sceneOrThrow();
  const { loadRig } = await import("../world/models");
  const { makeWeaponMesh } = await import("../world/LootDrops");
  const { BOT_GEAR } = await import("../entities/botGear");
  const rig = (await loadRig(scene, "charKnight"))();
  const bone = (n: string): Node | undefined => rig.root.getDescendants(false).find((d) => d.name === n);
  const fistL = bone("Fist.L");
  const fistR = bone("Fist.R");
  if (!fistL || !fistR) throw new Error("нет костей Fist.L/Fist.R");
  const classes = ["sword", "bow", "shield", "staff", "dagger", "spear", "hammer"] as const;
  const tiers = ["base", "gold", "legendary", "ruby", "craft"] as const;
  const made: Mesh[] = [];
  const add = (cls: (typeof classes)[number], tier: string): void => {
    const mesh = makeWeaponMesh(scene, cls, tier as never);
    mesh.name = `gear_${cls}_${tier}`;
    mesh.rotationQuaternion = null;
    // Щит и лук — в левом кулаке (fistFor в RemoteAvatar), остальное — в правом.
    mesh.parent = cls === "shield" || cls === "bow" ? fistL : fistR;
    const g = cls === "sword" ? BOT_GEAR.sword : BOT_GEAR[cls];
    mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
    mesh.rotation.set(g.rot[0], g.rot[1], g.rot[2]);
    mesh.scaling.setAll(g.scale);
    made.push(mesh);
  };
  for (const cls of classes) for (const tier of tiers) add(cls, tier);
  add("shield", "aegis");
  add("shield", "rubyAegis");
  // glb-модели оружия (spawnWeaponModel) цепляются к корню асинхронно, после загрузки файла, — ждём геометрию у всех.
  const ready = (m: Mesh): boolean => m.getTotalVertices() > 0 || m.getChildMeshes(false).some((c) => c.getTotalVertices() > 0);
  for (let i = 0; i < 50 && !made.every(ready); i++) await new Promise((r) => setTimeout(r, 200));
  const empty = made.filter((m) => !ready(m)).map((m) => m.name);
  if (empty.length) console.warn("[unity-export] без геометрии:", empty);
  const keep = new Set<Node>();
  const walk = (n: Node): void => {
    keep.add(n);
    for (const c of n.getChildren()) walk(c);
  };
  walk(rig.root);
  const glb = await GLTF2Export.GLBAsync(scene, "Gear", {
    shouldExportNode: (n: Node) => keep.has(n),
    shouldExportAnimation: () => false,
    exportWithoutWaitingForScene: true,
  });
  const blob = Object.values(glb.glTFFiles)[0] as Blob;
  await fetch(`/__unity-export/Gear.glb`, { method: "POST", body: blob });
  for (const m of made) m.dispose();
  rig.dispose();
  return { items: made.length, mb: Math.round((blob.size / 1048576) * 10) / 10 };
}

/**
 * Оружие в руках модели со своей посадкой (Человек, botGear.MODEL_SEATS): каждый класс и тир в правом И левом
 * кулаке — узлы hgear_<R|L>_<класс>_<тир> в GearHuman.glb. Unity (HeroRig) берёт их для скинов с флагом keep.
 */
export async function exportHumanGear(model = "charHuman"): Promise<{ items: number; mb: number }> {
  const scene = sceneOrThrow();
  const { loadRig } = await import("../world/models");
  const { makeWeaponMesh } = await import("../world/LootDrops");
  const { seatFor } = await import("../entities/botGear");
  const rig = (await loadRig(scene, model as never))();
  const bone = (n: string): Node | undefined => rig.root.getDescendants(false).find((d) => d.name === n);
  const fists = { L: bone("Fist.L"), R: bone("Fist.R") };
  if (!fists.L || !fists.R) throw new Error("нет костей Fist.L/Fist.R");
  const classes = ["sword", "bow", "shield", "staff", "dagger", "spear", "hammer"] as const;
  const tiers = ["base", "gold", "legendary", "ruby", "craft"] as const;
  const made: Mesh[] = [];
  const add = (cls: (typeof classes)[number], tier: string, side: "R" | "L"): void => {
    const mesh = makeWeaponMesh(scene, cls, tier as never);
    mesh.name = `hgear_${side}_${cls}_${tier}`;
    mesh.rotationQuaternion = null;
    mesh.parent = fists[side]!;
    const g = seatFor(cls, fists[side], side);
    mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
    mesh.rotation.set(g.rot[0], g.rot[1], g.rot[2]);
    mesh.scaling.setAll(g.scale);
    made.push(mesh);
  };
  for (const side of ["R", "L"] as const) {
    for (const cls of classes) for (const tier of tiers) add(cls, tier, side);
    add("shield", "aegis", side);
    add("shield", "rubyAegis", side);
  }
  const ready = (m: Mesh): boolean => m.getTotalVertices() > 0 || m.getChildMeshes(false).some((c) => c.getTotalVertices() > 0);
  for (let i = 0; i < 50 && !made.every(ready); i++) await new Promise((r) => setTimeout(r, 200));
  const empty = made.filter((m) => !ready(m)).map((m) => m.name);
  if (empty.length) console.warn("[unity-export] без геометрии:", empty);
  const keep = new Set<Node>();
  const walk = (n: Node): void => {
    keep.add(n);
    for (const c of n.getChildren()) walk(c);
  };
  walk(rig.root);
  const glb = await GLTF2Export.GLBAsync(scene, "GearHuman", {
    shouldExportNode: (n: Node) => keep.has(n),
    shouldExportAnimation: () => false,
    exportWithoutWaitingForScene: true,
  });
  const blob = Object.values(glb.glTFFiles)[0] as Blob;
  await fetch(`/__unity-export/GearHuman.glb`, { method: "POST", body: blob });
  for (const m of made) m.dispose();
  rig.dispose();
  return { items: made.length, mb: Math.round((blob.size / 1048576) * 10) / 10 };
}

/** WAV 16 бит моно из отрисованного буфера, хвост тишины обрезан. */
function wavOf(buf: AudioBuffer): Blob {
  const d = buf.getChannelData(0);
  let n = d.length;
  while (n > 1 && Math.abs(d[n - 1]) < 1e-4) n--;
  n = Math.min(d.length, n + Math.floor(buf.sampleRate * 0.02));
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o: number, s: string): void => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  out.setUint32(4, 36 + n * 2, true);
  str(8, "WAVEfmt ");
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 1, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  str(36, "data");
  out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true);
  return new Blob([out.buffer], { type: "audio/wav" });
}

/**
 * Синтезированные звуки (audio/Sfx.ts на WebAudio: шаги, удар о землю, уровень, ранение, блок…) — записываем
 * в WAV через OfflineAudioContext тем же кодом, по 3 варианта (в синтезе есть случайность).
 * Файлы-сэмплы из public/sfx Unity берёт как есть.
 */
export async function bakeSfx(): Promise<string[]> {
  const { Sfx } = await import("../audio/Sfx");
  type S = Record<string, (...a: unknown[]) => void>;
  const list: [string, (s: S) => void][] = [
    ["footstep", (s) => s.footstep(1)],
    ["land", (s) => s.land(1)],
    ["jump", (s) => s.jump()],
    ["hitThud", (s) => s.hitThud(1)],
    ["bowDraw", (s) => s.bowDraw()],
    ["mobHop", (s) => s.mobHop()],
    ["mobHurt", (s) => s.mobHurt()],
    ["mobDie", (s) => s.mobDie()],
    ["spitterFire", (s) => s.spitterFire()],
    ["eventAnnounce", (s) => s.eventAnnounce()],
    ["block", (s) => s.block(1)],
    ["blockSoft", (s) => s.block(0.5)],
    ["levelUp", (s) => s.levelUp()],
    ["ultWarrior", (s) => s.ultWarrior()],
    ["ultArcher", (s) => s.ultArcher()],
    ["ultSupport", (s) => s.ultSupport()],
    ["ultAssassin", (s) => s.ultAssassin()],
    ["ultSpear", (s) => s.ultSpear()],
    ["ultBattlemage", (s) => s.ultBattlemage()],
    ["spiderStep", (s) => s.spiderStep()],
    ["spiderBite", (s) => s.spiderBite()],
    ["spiderWebShot", (s) => s.spiderWebShot()],
    ["spiderWebRoot", (s) => s.spiderWebRoot()],
    ["groundBash", (s) => s.groundBash()],
    ["arrowVolley", (s) => s.arrowVolley()],
    ["bossHorn", (s) => s.bossHorn()],
    ["bossFanfare", (s) => s.bossFanfare()],
    ["drink", (s) => s.drink()],
    ["pickup", (s) => s.pickup()],
    ["playerHurt", (s) => s.playerHurt()],
    ["arrowHitFlesh", (s) => s.arrowHit("flesh", 1)],
    ["arrowHitWood", (s) => s.arrowHit("wood", 1)],
  ];
  const done: string[] = [];
  for (const [name, play] of list) {
    for (let v = 0; v < 3; v++) {
      const rate = 44100;
      const ctx = new OfflineAudioContext(1, rate * 4, rate);
      const s = new Sfx() as unknown as S & Record<string, unknown>;
      const master = ctx.createGain();
      master.gain.value = 0.32; // masterTarget() при полной громкости
      master.connect(ctx.destination);
      const noise = ctx.createBuffer(1, rate / 2, rate);
      const nd = noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      Object.assign(s, { ctx, master, noiseBuf: noise, ready: () => true, ensure: () => {} });
      try {
        play(s);
      } catch (e) {
        console.warn(`[unity-export] звук ${name}:`, e);
        break;
      }
      const buf = await ctx.startRendering();
      await fetch(`/__unity-export/sfx/${name}_${v}.wav`, { method: "POST", body: wavOf(buf) });
      done.push(`${name}_${v}`);
    }
  }
  return done;
}

/**
 * Реквизит, который веб собирает кодом из примитивов: пугало (Mob.buildScarecrow) и тренировочный манекен
 * (combat/Dummy.ts) — в координатах своего корня, по узлу на вещь; и NPC лагеря (модель, место, разворот).
 */
export async function exportProps(): Promise<{ props: string[]; npcs: number }> {
  const scene = sceneOrThrow();
  const out = new Scene(scene.getEngine(), { virtual: true });
  const warn: string[] = [];
  const props: string[] = [];
  const take = (name: string, root: Node | null | undefined): void => {
    if (!root) return;
    const inv = (root as unknown as { computeWorldMatrix(f: boolean): Matrix }).computeWorldMatrix(true).clone().invert();
    const holder = new Mesh(name, out);
    for (const m of (root as unknown as { getChildMeshes(d: boolean): AbstractMesh[] }).getChildMeshes(false)) {
      if (!m.isEnabled() || SKIP_MESH.test(m.name) || m.getTotalVertices() === 0) continue;
      // Табличка с текстом (DynamicTexture): на WebGPU чтение её пикселей ждёт кадра — в скрытой вкладке выгрузка висла.
      const tex = (m.material as unknown as { diffuseTexture?: { getClassName(): string } } | null)?.diffuseTexture;
      if (tex?.getClassName() === "DynamicTexture") continue;
      const before = out.meshes.length;
      bakeInto(m, out, warn, inv);
      for (const c of out.meshes.slice(before)) c.parent = holder;
    }
    props.push(name);
  };
  const byName = (n: string): AbstractMesh | undefined => scene.meshes.find((m) => m.name === n);
  // Пугало: корень моба — родитель столба (scarePost) поднимаемся до узла моба.
  let scare: Node | null | undefined = byName("scarePost");
  while (scare?.parent && !/^mob/i.test(scare.name)) scare = scare.parent;
  take("scarecrow", scare);
  take("dummy", scene.transformNodes.find((t) => t.name === "dummyFigure")?.parent);
  const glb = await GLTF2Export.GLBAsync(out, "Props", { exportWithoutWaitingForScene: true });
  out.dispose();
  await fetch(`/__unity-export/Props.glb`, { method: "POST", body: Object.values(glb.glTFFiles)[0] as Blob });

  const npcs = scene.transformNodes
    .filter((t) => t.name.startsWith("npc_") && !t.name.startsWith("npcModel_"))
    .map((t) => {
      const q = t.rotationQuaternion;
      return { title: t.name.slice(4), x: t.position.x, y: t.position.y, z: t.position.z, yaw: q ? q.toEulerAngles().y : t.rotation.y };
    });
  await fetch(`/__unity-export/npcs.json`, { method: "POST", body: JSON.stringify({ npcs }) });
  if (warn.length) console.warn("[unity-export]", warn);
  return { props, npcs: npcs.length };
}

/** Разбор: цепочки родителей у пугала и манекенов (что и под каким корнем). */
export function debugProps(): unknown {
  const sc = sceneOrThrow();
  const chain = (n: Node | null): string[] => {
    const a: string[] = [];
    for (; n; n = n.parent) a.push(n.name);
    return a;
  };
  const post = sc.meshes.find((m) => m.name === "scarePost");
  return {
    scare: post ? chain(post) : null,
    dummies: sc.transformNodes.filter((t) => /dummy/i.test(t.name)).slice(0, 3).map(chain),
  };
}

/** Эталонный кадр для сверки с Unity: ручная камера спектатора и час мира (команда пульта «time»). */
export async function refShot(p: [number, number, number], t: [number, number, number], hour: number): Promise<void> {
  const { Vector3 } = await import("@babylonjs/core/Maths/math.vector");
  const w = window as unknown as {
    spec: { cam: { setManual(p: unknown, t: unknown, fov: number): void } };
    net: { sendSpecCmd(c: unknown): void };
  };
  w.net.sendSpecCmd({ t: "dayAuto", on: 0 });
  w.net.sendSpecCmd({ t: "time", hour });
  w.spec.cam.setManual(new Vector3(...p), new Vector3(...t), 0.9);
}

/** Снимок кадра 1600×900 рендером в текстуру (работает и со скрытой страницей) → unity/Logs/ref/<name>.png. */
export async function refCapture(name: string): Promise<number> {
  const scene = sceneOrThrow();
  const { CreateScreenshotUsingRenderTargetAsync } = await import("@babylonjs/core/Misc/screenshotTools");
  const data = await CreateScreenshotUsingRenderTargetAsync(scene.getEngine(), scene.activeCamera!, { width: 1600, height: 900 }, "image/png");
  const blob = await (await fetch(data)).blob();
  await fetch(`/__unity-export/ref/${name}.png`, { method: "POST", body: blob });
  return blob.size;
}

/**
 * Факелы и лампы катакомб (Catacombs.ts: PointLight по залам) — позиция, цвет, дальность, сила.
 * Строятся в коде по залам; в Unity ставим те же. Сначала prepare() — катакомбы должны быть построены.
 */
export async function exportCatLights(): Promise<number> {
  const scene = sceneOrThrow();
  const lights = scene.lights
    .filter((l) => l.getClassName() === "PointLight" && /^cat/.test(l.name))
    .map((l) => {
      const pl = l as unknown as { getAbsolutePosition(): { x: number; y: number; z: number }; diffuse: { r: number; g: number; b: number }; range: number; intensity: number };
      const p = pl.getAbsolutePosition();
      return { name: l.name, p: [p.x, p.y, p.z], color: [pl.diffuse.r, pl.diffuse.g, pl.diffuse.b], range: pl.range, intensity: pl.intensity };
    });
  await fetch(`/__unity-export/cat-lights.json`, { method: "POST", body: JSON.stringify({ lights }) });
  return lights.length;
}

export async function exportAll(): Promise<Record<string, { meshes: number; mb: number; warn: string[] }>> {
  const res: Record<string, { meshes: number; mb: number; warn: string[] }> = {};
  for (const r of REGIONS) res[r.name] = await exportRegion(r.name);
  return res;
}
