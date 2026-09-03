import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";

/**
 * Модельки ботов зрителей (Ф10). Процедурные, лоу-поли, «пухлые стражи» в
 * стиле остального мира — заглушка, пока нет пака персонажей. `variant`
 * 1..BOT.skins. Модель смотрит в +Z (совпадает с yaw от atan2(dx,dz) на
 * сервере), локальный ноль — на уровне глаз (y≈0), «ноги» у y≈-1.7 — как у
 * обычного плоского аватара.
 *
 * Три материала: тело (основной приглушённый цвет), акцент (тёмный оттенок
 * того же тона — шлемы/панцирь/суставы), тёмная деталь (глаза/козырёк).
 * Каждая группа мержится в один меш → 3 draw call на бота.
 */
export function makeBotBody(scene: Scene, variant: number, tint: Color3): TransformNode {
  const root = new TransformNode(`botBody_${variant}_${Math.random().toString(36).slice(2, 7)}`, scene);

  // Гасим кислотность цвета аватара: тянем к тёплому серому.
  const grey = new Color3(0.62, 0.6, 0.56);
  const bodyCol = Color3.Lerp(tint, grey, 0.44);
  const accentCol = bodyCol.scale(0.58);

  const mkMat = (name: string, col: Color3, emit: number): StandardMaterial => {
    const m = new StandardMaterial(`${name}_${root.name}`, scene);
    m.diffuseColor = col;
    m.emissiveColor = col.scale(emit);
    m.specularColor = new Color3(0.05, 0.05, 0.05);
    m.maxSimultaneousLights = 3;
    return m;
  };
  const bodyMat = mkMat("botBody", bodyCol, 0.16);
  const accentMat = mkMat("botAccent", accentCol, 0.12);
  const darkMat = mkMat("botDark", new Color3(0.05, 0.05, 0.06), 0.02);

  const body: Mesh[] = [];
  const accent: Mesh[] = [];
  const dark: Mesh[] = [];

  const put = (bucket: Mesh[], m: Mesh, x: number, y: number, z: number): Mesh => {
    m.position.set(x, y, z);
    bucket.push(m);
    return m;
  };
  const sph = (
    bucket: Mesh[],
    dia: number,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
  ): Mesh => {
    const m = MeshBuilder.CreateSphere("p", { diameter: dia, segments: 10 }, scene);
    m.scaling.set(sx, sy, sz);
    return put(bucket, m, x, y, z);
  };
  const dome = (bucket: Mesh[], dia: number, x: number, y: number, z: number, sy = 1): Mesh => {
    const m = MeshBuilder.CreateSphere("p", { diameter: dia, segments: 12, slice: 0.5 }, scene);
    m.scaling.y = sy;
    return put(bucket, m, x, y, z);
  };
  const cap = (bucket: Mesh[], r: number, h: number, x: number, y: number, z: number): Mesh => {
    const m = MeshBuilder.CreateCapsule("p", { radius: r, height: h, tessellation: 10, subdivisions: 1 }, scene);
    return put(bucket, m, x, y, z);
  };
  const cyl = (
    bucket: Mesh[],
    dTop: number,
    dBot: number,
    h: number,
    x: number,
    y: number,
    z: number,
  ): Mesh => {
    const m = MeshBuilder.CreateCylinder("p", { diameterTop: dTop, diameterBottom: dBot, height: h, tessellation: 12 }, scene);
    return put(bucket, m, x, y, z);
  };
  const box = (bucket: Mesh[], w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
    const m = MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, scene);
    return put(bucket, m, x, y, z);
  };
  /** Пара глаз (тёмные), симметрично по X. */
  const eyes = (dia: number, x: number, y: number, z: number, sy = 1): void => {
    sph(dark, dia, -x, y, z, 1, sy, 1);
    sph(dark, dia, x, y, z, 1, sy, 1);
  };

  switch (variant) {
    case 2: {
      // Дух леса (кодама): тонкое тело, большая круглая голова, рожок.
      cap(body, 0.3, 1.25, 0, -1.0, 0);
      sph(body, 0.82, 0, 0.04, 0.02, 1.06, 0.98, 1);
      cyl(accent, 0, 0.18, 0.26, 0.03, 0.42, -0.06); // рожок назад
      cap(body, 0.085, 0.5, -0.32, -0.88, 0.02);
      cap(body, 0.085, 0.5, 0.32, -0.88, 0.02);
      sph(body, 0.17, -0.32, -1.14, 0.02);
      sph(body, 0.17, 0.32, -1.14, 0.02);
      sph(accent, 0.26, -0.16, -1.6, 0.03, 1.3, 0.7, 1.4);
      sph(accent, 0.26, 0.16, -1.6, 0.03, 1.3, 0.7, 1.4);
      eyes(0.11, 0.16, 0.06, 0.37, 1.5);
      box(dark, 0.13, 0.035, 0.04, 0, -0.1, 0.41); // ротик
      break;
    }
    case 3: {
      // Гриб-рыцарь: широкий купол-шлем, коренастое тело, пятна на шляпе.
      dome(accent, 1.55, 0, 0.02, 0.02, 0.62); // шляпа-шлем
      cyl(accent, 1.4, 1.2, 0.12, 0, -0.16, 0); // край шляпы
      cyl(dark, 0.66, 0.66, 0.42, 0, -0.4, 0.03); // тёмный «козырёк»-голова
      cap(body, 0.46, 0.95, 0, -1.05, 0);
      cap(body, 0.14, 0.62, -0.52, -1.0, 0.02); // руки
      cap(body, 0.14, 0.62, 0.52, -1.0, 0.02);
      box(body, 0.32, 0.16, 0.42, -0.26, -1.62, 0.06); // ступни
      box(body, 0.32, 0.16, 0.42, 0.26, -1.62, 0.06);
      // Пятна на шляпе.
      sph(body, 0.2, -0.34, 0.28, 0.18, 1, 0.4, 1);
      sph(body, 0.2, 0.3, 0.26, -0.22, 1, 0.4, 1);
      sph(body, 0.16, 0.06, 0.42, 0.3, 1, 0.4, 1);
      eyes(0.09, 0.14, -0.36, 0.33);
      break;
    }
    case 4: {
      // Панцирный жук-страж: горб-панцирь, голова низко и вперёд, усики.
      const shell = dome(accent, 1.5, 0, -0.42, -0.06, 1.02);
      shell.rotation.x = -0.42;
      shell.scaling.x = 1.08;
      shell.scaling.z = 1.2;
      cap(body, 0.44, 0.95, 0, -1.06, 0.06);
      sph(body, 0.52, 0, -0.5, 0.56, 1, 0.92, 1); // голова вперёд-вниз
      cyl(dark, 0.04, 0.04, 0.34, -0.12, -0.16, 0.6); // усики
      cyl(dark, 0.04, 0.04, 0.34, 0.12, -0.16, 0.6);
      cap(body, 0.12, 0.5, -0.48, -1.0, 0.14); // руки
      cap(body, 0.12, 0.5, 0.48, -1.0, 0.14);
      cap(accent, 0.17, 0.42, -0.26, -1.44, 0);
      cap(accent, 0.17, 0.42, 0.26, -1.44, 0);
      box(body, 0.3, 0.14, 0.4, -0.26, -1.63, 0.08);
      box(body, 0.3, 0.14, 0.4, 0.26, -1.63, 0.08);
      eyes(0.13, 0.14, -0.46, 0.82, 1.1);
      break;
    }
    default: {
      // Каменный голем: валун-корпус, короткие толстые руки, широкая стойка.
      sph(body, 1.4, 0, -1.02, 0, 1.16, 0.98, 1.06);
      sph(body, 1.06, 0, -0.44, -0.02, 1.04, 1, 1);
      sph(body, 0.56, 0, 0.14, 0.08, 1.12, 0.94, 1); // голова
      box(accent, 0.5, 0.13, 0.16, 0, 0.16, 0.29); // надбровье
      sph(accent, 0.48, -0.64, -0.34, 0); // плечи
      sph(accent, 0.48, 0.64, -0.34, 0);
      cap(body, 0.17, 0.72, -0.72, -0.86, 0.02); // руки
      cap(body, 0.17, 0.72, 0.72, -0.86, 0.02);
      sph(accent, 0.36, -0.74, -1.22, 0.05); // кулаки
      sph(accent, 0.36, 0.74, -1.22, 0.05);
      cap(accent, 0.22, 0.5, -0.3, -1.4, 0); // ноги
      cap(accent, 0.22, 0.5, 0.3, -1.4, 0);
      box(body, 0.36, 0.17, 0.46, -0.3, -1.63, 0.06); // ступни
      box(body, 0.36, 0.17, 0.46, 0.3, -1.63, 0.06);
      eyes(0.11, 0.14, 0.13, 0.31);
      break;
    }
  }

  const merge = (bucket: Mesh[], mat: StandardMaterial, name: string): void => {
    if (bucket.length === 0) return;
    const m = bucket.length === 1 ? bucket[0] : Mesh.MergeMeshes(bucket, true, true, undefined, false, false);
    if (!m) return;
    m.name = name;
    m.material = mat;
    m.isPickable = false;
    m.parent = root;
  };
  merge(body, bodyMat, "botBody");
  merge(accent, accentMat, "botAccent");
  merge(dark, darkMat, "botDark");
  return root;
}
