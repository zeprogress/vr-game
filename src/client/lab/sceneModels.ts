import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";

import { CAT_THEMES } from "#shared/catacombs";
import { MOB } from "#shared/mobs";
import { MODELS, loadRig, recolorMonster, type ModelName, type RigInstance } from "../world/models";
import { createSky, type Sky } from "../world/Sky";
import { tunedDayState } from "../world/lightTune";
import { modelLight, setModelLight, type ModelLight } from "../combat/mobLightTune";
import type { LabCtx } from "./main";

/**
 * Любая модель из MODELS: размер, все её анимации кнопками и свет — как в игре.
 * «Место»: поле (солнце и небо по «Часу» — тот же DayState, что у мира) или катакомбы
 * (без солнца, факелы выбранной темы). Свет вида — правка MODEL_LIGHT: та же таблица
 * и та же запись в localStorage, что у панели ?moblight=1 в игре.
 */
export function build(ctx: LabCtx): void {
  const { scene, ui } = ctx;
  const names = Object.keys(MODELS) as ModelName[];
  let name: ModelName = (names.find((n) => n === "monMushColossus") ?? names[0]) as ModelName;
  let size = 3;
  let spin = true;
  let rig: RigInstance | null = null;
  const node = new TransformNode("labModel", scene);
  const holder = new TransformNode("labHolder", scene);
  holder.parent = node;
  let animBox: HTMLElement | null = null;

  // ---- свет: лаборатория берёт те же источники, что мир (солнце, небо, туман, факелы) ----
  const sun = scene.getLightByName("sun") as DirectionalLight;
  const hemi = scene.getLightByName("hemi") as HemisphericLight;
  const ground = scene.getMaterialByName("groundMat") as StandardMaterial;
  let place: "field" | "cat" = "field";
  let hour = 12;
  let theme = 0;
  let sky: Sky | null = null;
  let skyMeshes: AbstractMesh[] = [];
  let torches: PointLight[] = [];
  const lightBox = ui.group();

  /** Поле: солнце и небо на час, как в игре. Заливки в игре нет — объём даёт солнце и небо. */
  function applyField(): void {
    for (const t of torches) t.dispose();
    torches = [];
    const d = tunedDayState(hour);
    if (!sky) {
      const before = new Set<AbstractMesh>(scene.meshes);
      sky = createSky(scene, d);
      skyMeshes = scene.meshes.filter((m) => !before.has(m));
    }
    for (const m of skyMeshes) m.setEnabled(true);
    sun.direction.copyFrom(d.sunDir);
    sun.position = d.sunDir.scale(-60);
    sun.intensity = d.sunIntensity;
    sun.diffuse.copyFrom(d.sunColor);
    hemi.intensity = 0;
    ground.diffuseColor = new Color3(0.28, 0.42, 0.22);
    sky.apply(d);
    sky.repaint(d);
  }

  /** Катакомбы: без солнца и неба, темно, только факелы выбранной темы — как в зале. */
  function applyCat(): void {
    for (const m of skyMeshes) m.setEnabled(false);
    sun.intensity = 0;
    hemi.intensity = 0.04;
    ground.diffuseColor = new Color3(0.12, 0.11, 0.1);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 6;
    scene.fogEnd = 40;
    scene.fogColor = new Color3(0.03, 0.025, 0.03);
    scene.clearColor = new Color4(0.02, 0.018, 0.022, 1);
    for (const t of torches) t.dispose();
    // Факелы — в узле модели: масштаб и вращение модели переносятся на них вместе со светом.
    const H = MOB.bodyRadius * 1.75; // рост модели в единицах узла (см. load)
    const c = CAT_THEMES[theme].light;
    torches = [0, 1, 2, 3].map((i) => {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const l = new PointLight(`labTorch${i}`, new Vector3(Math.cos(a) * H * 0.9, H * 0.75, Math.sin(a) * H * 0.9), scene);
      l.parent = node;
      l.diffuse = new Color3(c[0], c[1], c[2]);
      l.specular = new Color3(0.15, 0.08, 0.03);
      l.range = 26;
      l.intensity = 1.4;
      return l;
    });
  }

  /** Свет этой модели: три ползунка MODEL_LIGHT. Только для мобов (mon*) — в игре их берут только они. */
  function buildModelLight(): void {
    lightBox.innerHTML = "";
    if (!name.startsWith("mon")) {
      const p = document.createElement("div");
      p.className = "note";
      p.textContent = "Свет вида — только у мобов (mon*): в игре его берут только они.";
      lightBox.appendChild(p);
      return;
    }
    const f = (n: number): string => n.toFixed(2);
    const cur: ModelLight = { ...modelLight(name) };
    const out = document.createElement("div");
    out.className = "note";
    const show = (): void => {
      out.textContent = `${name}: { emissive: ${f(cur.emissive)}, diffuse: ${f(cur.diffuse)}, tex: ${f(cur.tex)} },`;
    };
    const rows: [keyof ModelLight, string, number][] = [
      ["emissive", "свечение", 1.5],
      ["diffuse", "освещённость", 3],
      ["tex", "яркость текстуры", 3],
    ];
    for (const [key, label, max] of rows) {
      const r = document.createElement("label");
      r.className = "row";
      const t = document.createElement("span");
      t.textContent = label;
      const wrap = document.createElement("div");
      wrap.className = "sl";
      const inp = document.createElement("input");
      Object.assign(inp, { type: "range", min: "0", max: String(max), step: "0.01", value: String(cur[key]) });
      const val = document.createElement("b");
      val.textContent = f(cur[key]);
      inp.oninput = () => {
        cur[key] = Number(inp.value);
        val.textContent = f(cur[key]);
        setModelLight(name, { ...cur });
        show();
      };
      wrap.append(inp, val);
      r.append(t, wrap);
      lightBox.appendChild(r);
    }
    const copy = document.createElement("button");
    copy.textContent = "Скопировать строку";
    copy.onclick = () => void navigator.clipboard?.writeText(out.textContent ?? "");
    show();
    lightBox.append(out, copy);
  }

  async function load(): Promise<void> {
    rig?.dispose();
    rig = null;
    const make = await loadRig(scene, name).catch(() => null);
    if (!make) return;
    rig = make();
    rig.root.parent = holder;
    holder.scaling.setAll((MOB.bodyRadius * 1.75) / rig.nativeHeight);
    if (name.startsWith("mon")) recolorMonster(rig.root, undefined, false, name);
    const first = rig.anims.get("idle") ?? [...rig.anims.values()][0];
    first?.start(true);
    if (animBox) {
      animBox.innerHTML = "";
      for (const [k, g] of rig.anims) {
        const b = document.createElement("button");
        b.textContent = k;
        b.onclick = () => {
          for (const x of rig?.anims.values() ?? []) x.stop();
          g.start(true);
        };
        animBox.appendChild(b);
      }
    }
  }

  let lastSize = -1;
  ctx.onFrame((dt) => {
    if (size !== lastSize) {
      lastSize = size;
      ctx.frame(0.8 * size * 0.3, 0.96 * size * 0.55, 0, Math.max(3.5, 0.96 * size * 2.6));
    }
    node.scaling.setAll(size);
    if (spin) node.rotation.y += dt * 0.5;
  });

  ui.select("Модель", names, name, (v) => {
    name = v as ModelName;
    buildModelLight();
    void load();
  });
  ui.slider("Размер (scaleMul)", 0.2, 8, 0.1, size, (v) => (size = v));
  ui.note("Рост ≈ 0.96 м × размер. Голем 2.55, колосс 5.4, призрак 1.1.");
  ui.toggle("Вращать", spin, (v) => (spin = v));
  ui.section("Свет");
  ui.select("Место", ["Поле", "Катакомбы"], "Поле", (v) => {
    place = v === "Поле" ? "field" : "cat";
    if (place === "field") applyField();
    else applyCat();
  });
  ui.slider("Час суток", 0, 24, 0.25, hour, (v) => {
    hour = v;
    if (place === "field") applyField();
  });
  ui.select(
    "Тема катакомб",
    CAT_THEMES.map((t) => t.name),
    CAT_THEMES[theme].name,
    (v) => {
      theme = Math.max(0, CAT_THEMES.findIndex((t) => t.name === v));
      if (place === "cat") applyCat();
    },
  );
  ui.note("Поле — солнце и небо по часу, как в мире. Катакомбы — без солнца, факелы темы. «Ночь» в шапке здесь не нужна: время задаёт «Час».");
  ui.section("Свет этой модели");
  buildModelLight();
  ui.section("Анимации");
  animBox = ui.group();
  applyField();
  void load();
}
