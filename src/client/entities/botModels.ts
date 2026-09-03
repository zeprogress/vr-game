import type { Scene } from "@babylonjs/core/scene";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";

/**
 * Модельки ботов зрителей (Ф10). Процедурные, лоу-поли, в стиле остального
 * мира. `variant` 1..BOT.skins. Модель смотрит в +Z (совпадает с yaw от
 * atan2(dx,dz) на сервере), «голова» у y≈0, «ноги» у y≈-1.7 — как у обычного
 * плоского аватара.
 */
export function makeBotBody(scene: Scene, variant: number, tint: Color3): TransformNode {
  const root = new TransformNode(`botBody_${variant}_${Math.random().toString(36).slice(2, 7)}`, scene);

  const body = new StandardMaterial(`botMat_${root.name}`, scene);
  body.diffuseColor = tint.clone();
  body.emissiveColor = tint.scale(0.14);
  body.specularColor = new Color3(0.08, 0.08, 0.08);
  body.maxSimultaneousLights = 3;

  const dark = new StandardMaterial(`botDark_${root.name}`, scene);
  dark.diffuseColor = new Color3(0.04, 0.04, 0.05);
  dark.emissiveColor = new Color3(0.02, 0.02, 0.03);
  dark.specularColor = new Color3(0, 0, 0);
  dark.maxSimultaneousLights = 2;

  const parts: Mesh[] = [];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number): Mesh => {
    const m = MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, scene);
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };
  const sph = (dia: number, x: number, y: number, z: number, sy = 1): Mesh => {
    const m = MeshBuilder.CreateSphere("p", { diameter: dia, segments: 8 }, scene);
    m.position.set(x, y, z);
    m.scaling.y = sy;
    parts.push(m);
    return m;
  };
  const cyl = (dia: number, h: number, x: number, y: number, z: number): Mesh => {
    const m = MeshBuilder.CreateCylinder("p", { diameter: dia, height: h, tessellation: 10 }, scene);
    m.position.set(x, y, z);
    parts.push(m);
    return m;
  };

  // Тёмная деталь (глаза/щель) — не мержится, свой материал.
  const detail = (w: number, h: number, x: number, y: number, z: number, rz = 0): void => {
    const m = MeshBuilder.CreateBox("botFace", { width: w, height: h, depth: 0.04 }, scene);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.material = dark;
    m.isPickable = false;
    m.parent = root;
  };
  const face = (w: number, h: number, y: number, z: number): void => detail(w, h, 0, y, z);

  switch (variant) {
    case 2: {
      // Слизень-рыцарь: пузо-каплей, ведро-шлем, культяпки-руки.
      sph(1.0, 0, -1.15, 0, 0.85);
      sph(0.78, 0, -0.7, 0.02, 0.7);
      cyl(0.52, 0.5, 0, -0.15, 0); // шлем
      box(0.54, 0.16, 0.1, 0, -0.12, 0.24); // козырёк-щель спереди
      box(0.2, 0.2, 0.2, -0.5, -0.85, 0);
      box(0.2, 0.2, 0.2, 0.5, -0.85, 0);
      face(0.34, 0.06, -0.16, 0.27);
      break;
    }
    case 3: {
      // Пугало: тонкий столб, крест-руки, соломенная голова, шляпа-конус.
      box(0.16, 1.5, 0.16, 0, -1.0, 0);
      box(1.5, 0.14, 0.14, 0, -0.55, 0); // перекладина-руки
      sph(0.3, -0.78, -0.55, 0); // солома на концах
      sph(0.3, 0.78, -0.55, 0);
      sph(0.42, 0, -0.05, 0, 1.1); // мешок-голова
      const hat = MeshBuilder.CreateCylinder("p", { diameterTop: 0, diameterBottom: 0.7, height: 0.55, tessellation: 12 }, scene);
      hat.position.set(0, 0.35, -0.02);
      parts.push(hat);
      box(0.5, 0.06, 0.5, 0, 0.12, 0); // поля шляпы
      detail(0.05, 0.16, -0.1, -0.05, 0.34, 0.6); // сшитые X-глаза
      detail(0.05, 0.16, 0.1, -0.05, 0.34, -0.6);
      break;
    }
    case 4: {
      // Грибник: широкая шляпка-купол, короткое тело, ножки.
      const cap = MeshBuilder.CreateSphere("p", { diameter: 1.35, segments: 10, slice: 0.5 }, scene);
      cap.position.set(0, 0.02, 0.04);
      cap.rotation.x = -0.12; // чуть наклон вперёд
      parts.push(cap);
      cyl(0.55, 0.95, 0, -0.75, 0);
      box(0.2, 0.18, 0.34, -0.2, -1.32, 0.05);
      box(0.2, 0.18, 0.34, 0.2, -1.32, 0.05);
      face(0.42, 0.1, -0.55, 0.28);
      break;
    }
    default: {
      // Голем: блочный, широкий, тяжёлый.
      box(0.7, 0.85, 0.5, 0, -0.75, 0); // торс
      box(1.1, 0.34, 0.6, 0, -0.36, 0); // плечи
      box(0.42, 0.42, 0.42, 0, -0.02, 0.02); // голова-куб
      box(0.26, 0.7, 0.28, -0.44, -0.7, 0); // руки
      box(0.26, 0.7, 0.28, 0.44, -0.7, 0);
      box(0.3, 0.6, 0.34, -0.2, -1.45, 0); // ноги
      box(0.3, 0.6, 0.34, 0.2, -1.45, 0);
      face(0.3, 0.08, -0.02, 0.22);
      break;
    }
  }

  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false);
  if (merged) {
    merged.name = "botMerged";
    merged.material = body;
    merged.isPickable = false;
    merged.parent = root;
  }
  return root;
}
