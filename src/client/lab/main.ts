import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/groundBuilder";

/**
 * Лаборатория (lab.html) — лёгкая отдельная сцена для точечной проверки ДО
 * деплоя: без сервера, мира, мобов, сети и HUD. Только площадка, свет,
 * камера мышью и одна проверяемая вещь с ползунками. Сцены — в SCENES ниже,
 * выбор — ?s=<id> (переключение перезагружает страницу: чистый старт).
 */

export interface Panel {
  section(title: string): void;
  note(text: string): void;
  slider(label: string, min: number, max: number, step: number, value: number, on: (v: number) => void): void;
  select(label: string, options: string[], value: string, on: (v: string) => void): void;
  toggle(label: string, value: boolean, on: (v: boolean) => void): void;
  button(label: string, on: () => void): void;
  /** Пересобрать блок кнопок (напр. список анимаций после загрузки модели). */
  group(): HTMLElement;
}

export interface LabCtx {
  scene: Scene;
  /** Навести камеру: центр и расстояние. */
  frame(x: number, y: number, z: number, radius: number): void;
  ui: Panel;
  /** Каждый кадр, dt в секундах. */
  onFrame(fn: (dt: number) => void): void;
}

interface LabScene {
  id: string;
  title: string;
  load: () => Promise<{ build(ctx: LabCtx): void | Promise<void> }>;
}

const SCENES: LabScene[] = [
  { id: "classes", title: "⚔️ Классы 2.0: бой и баланс", load: () => import("./sceneClasses") },
  { id: "fire", title: "🔥 Огонь: старый vs частицы", load: () => import("./sceneFire") },
  { id: "models", title: "👾 Модели и анимации", load: () => import("./sceneModels") },
  { id: "fx", title: "✨ Эффекты умений", load: () => import("./sceneFx") },
  { id: "trees", title: "🌳 Деревья: модель vs снимок", load: () => import("./sceneTrees") },
];

const params = new URLSearchParams(location.search);
const cur = SCENES.find((s) => s.id === params.get("s")) ?? SCENES[0];

const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { stencil: true });
const scene = new Scene(engine);
const DAY = new Color4(0.55, 0.72, 0.9, 1);
const NIGHT = new Color4(0.03, 0.04, 0.08, 1);
scene.clearColor = DAY;

// Цель камеры чуть правее центра — справа висит панель, сцена видна слева от неё.
const cam = new ArcRotateCamera("cam", -Math.PI / 2, 1.2, 16, new Vector3(2.5, 1, 0), scene);
(window as unknown as { __lab: unknown }).__lab = { scene, cam, engine };
cam.lowerRadiusLimit = 2;
cam.upperRadiusLimit = 80;
cam.wheelDeltaPercentage = 0.02;
cam.minZ = 0.05;
cam.attachControl(canvas, true);

const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
hemi.intensity = 0.75;
const sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.3), scene);
sun.intensity = 0.8;

const ground = MeshBuilder.CreateGround("ground", { width: 60, height: 60 }, scene);
const gm = new StandardMaterial("groundMat", scene);
gm.diffuseColor = new Color3(0.28, 0.42, 0.22);
gm.specularColor = new Color3(0, 0, 0);
ground.material = gm;
ground.isPickable = false;

// ---- панель ----
const side = document.getElementById("side")!;
const body = document.getElementById("body")!;
function row(label: string, el: HTMLElement): HTMLElement {
  const r = document.createElement("label");
  r.className = "row";
  const t = document.createElement("span");
  t.textContent = label;
  r.append(t, el);
  body.appendChild(r);
  return r;
}
const ui: Panel = {
  section(title) {
    const h = document.createElement("h3");
    h.textContent = title;
    body.appendChild(h);
  },
  note(text) {
    const p = document.createElement("div");
    p.className = "note";
    p.textContent = text;
    body.appendChild(p);
  },
  slider(label, min, max, step, value, on) {
    const wrap = document.createElement("div");
    wrap.className = "sl";
    const inp = document.createElement("input");
    Object.assign(inp, { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) });
    const out = document.createElement("b");
    out.textContent = String(value);
    inp.oninput = () => {
      out.textContent = inp.value;
      on(Number(inp.value));
    };
    wrap.append(inp, out);
    row(label, wrap);
  },
  select(label, options, value, on) {
    const sel = document.createElement("select");
    for (const o of options) sel.add(new Option(o, o, false, o === value));
    sel.onchange = () => on(sel.value);
    row(label, sel);
  },
  toggle(label, value, on) {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = value;
    cb.onchange = () => on(cb.checked);
    row(label, cb);
  },
  button(label, on) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = on;
    body.appendChild(b);
  },
  group() {
    const d = document.createElement("div");
    d.className = "grp";
    body.appendChild(d);
    return d;
  },
};

// Выбор сцены + общие переключатели.
const pick = document.getElementById("pick") as HTMLSelectElement;
for (const s of SCENES) pick.add(new Option(s.title, s.id, false, s === cur));
pick.onchange = () => {
  location.search = `?s=${pick.value}`;
};
document.getElementById("night")!.addEventListener("change", (e) => {
  const on = (e.target as HTMLInputElement).checked;
  scene.clearColor = on ? NIGHT : DAY;
  // Лунная ночь: темно, но модели видны (иначе чёрные силуэты).
  hemi.intensity = on ? 0.38 : 0.75;
  hemi.diffuse = on ? new Color3(0.55, 0.62, 0.9) : new Color3(1, 1, 1);
  sun.intensity = on ? 0.18 : 0.8;
  gm.diffuseColor = on ? new Color3(0.08, 0.12, 0.07) : new Color3(0.28, 0.42, 0.22);
});
document.getElementById("hide")!.addEventListener("click", () => side.classList.toggle("min"));

const frames: ((dt: number) => void)[] = [];
const stats = document.getElementById("stats")!;
let statT = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
  for (const f of frames) f(dt);
  scene.render();
  statT += dt;
  if (statT > 0.5) {
    statT = 0;
    const parts = scene.particleSystems.reduce((n, p) => n + p.getActiveCount(), 0);
    stats.textContent = `${engine.getFps().toFixed(0)} fps · мешей ${scene.getActiveMeshes().length} · частиц ${parts}`;
  }
});
addEventListener("resize", () => engine.resize());

const frame = (x: number, y: number, z: number, radius: number): void => {
  cam.target.set(x, y, z);
  cam.radius = radius;
};
void cur.load().then((m) => m.build({ scene, ui, frame, onFrame: (fn) => frames.push(fn) }));
