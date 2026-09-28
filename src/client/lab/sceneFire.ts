import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";

import { ELITE_MOBS, MOB } from "#shared/constants";
import { loadRig, recolorMonster, type ModelName, type RigInstance } from "../world/models";
import { createBurnFlameMesh, makeBurnFlameMaterial } from "../world/BurnFlameMat";
import { BurnParticles, FIRE_TUNE } from "../combat/BurnParticles";
import type { LabCtx } from "./main";

/**
 * Огонь: слева — старые карточки (BurnFlameMat, как сейчас на проде),
 * справа — новые частицы (BurnParticles, ?fire=1). Те же модели, тот же
 * размер и сила горения — сравнение один в один. Ползунки частиц крутят
 * FIRE_TUNE вживую; «Скопировать числа» — чтобы перенести их в код.
 */

interface Burner {
  node: TransformNode;
  rig: RigInstance | null;
  old: { mesh: Mesh; mat: ShaderMaterial } | null;
  t: number;
}

export function build(ctx: LabCtx): void {
  const { scene, ui } = ctx;
  const mobs = Object.entries(ELITE_MOBS);
  let model = "frog";
  let count = 3;
  let size = 1.2;
  let glow = 1;
  let mode = "рядом";
  let burners: Burner[] = [];
  let gen = 0;
  const fire = BurnParticles.for(scene);

  async function rebuild(): Promise<void> {
    const my = ++gen;
    for (const b of burners) {
      fire.remove(b);
      b.old?.mesh.dispose();
      b.old?.mat.dispose();
      b.rig?.dispose();
      b.node.dispose();
    }
    burners = [];
    const def = ELITE_MOBS[model];
    const make = await loadRig(scene, def.model as ModelName).catch((e: unknown) => {
      ui.note(`⚠ модель ${def.model} не загрузилась: ${String((e as Error)?.message ?? e)}`);
      console.error("[lab] loadRig", e);
      return null;
    });
    if (my !== gen) return;
    const sides = mode === "рядом" ? [-1, 1] : mode === "только старый" ? [-1] : [1];
    for (const side of sides) {
      for (let i = 0; i < count; i++) {
        const node = new TransformNode(`lab_${side}_${i}`, scene);
        const spacing = Math.max(1.6, MOB.bodyRadius * 2.4 * size);
        node.position.set(side * (2 + spacing * 0.8) + side * (i % 3) * spacing, 0, (Math.floor(i / 3) - (count > 3 ? 1 : 0)) * spacing);
        if (mode !== "рядом") node.position.x -= side * 2;
        node.scaling.setAll(size);
        let rig: RigInstance | null = null;
        if (make) {
          rig = make();
          const h = new TransformNode("holder", scene);
          h.parent = node;
          h.scaling.setAll((MOB.bodyRadius * 1.75) / rig.nativeHeight);
          rig.root.parent = h;
          recolorMonster(rig.root, def.tint ? new Color3(...def.tint) : undefined);
          rig.anims.get("idle")?.start(true);
        }
        const b: Burner = { node, rig, old: null, t: Math.random() * 5 };
        if (side < 0) {
          const mat = makeBurnFlameMaterial(scene);
          mat.setFloat("uR", MOB.bodyRadius);
          const mesh = createBurnFlameMesh(scene, "labFlames");
          mesh.material = mat;
          mesh.parent = node;
          b.old = { mesh, mat };
        }
        burners.push(b);
      }
    }
    // Камера — на всю группу: обе стороны + запас по росту мобов.
    let minX = Infinity;
    let maxX = -Infinity;
    for (const b of burners) {
      minX = Math.min(minX, b.node.position.x);
      maxX = Math.max(maxX, b.node.position.x);
    }
    const h = 0.96 * size;
    // Центр чуть правее: справа панель, сцена должна быть левее неё.
    ctx.frame((minX + maxX) / 2 + (maxX - minX) * 0.15 + 1, h * 0.6, 0, Math.max(5, (maxX - minX) * 1.1 + h * 2.5));
  }

  ctx.onFrame((dt) => {
    for (const b of burners) {
      b.t += dt;
      if (b.old) {
        b.old.mat.setFloat("uTime", b.t);
        b.old.mat.setFloat("uGlow", glow);
        b.old.mat.setFloat("uShift", MOB.bodyRadius * 2 * size);
        b.old.mesh.setEnabled(glow > 0.001);
      } else if (glow > 0.001) {
        const p = b.node.getAbsolutePosition();
        fire.set(b, p.x, p.y, p.z, MOB.bodyRadius * size, glow);
      } else {
        fire.remove(b);
      }
    }
  });

  ui.note("Слева — старый огонь (сейчас на проде), справа — новый на частицах. Крути камеру мышью, колесо — зум. «Ночь» сверху — как огонь смотрится в темноте.");
  ui.section("Сцена");
  ui.select("Моб", mobs.map(([k]) => k), model, (v) => {
    model = v;
    size = ELITE_MOBS[v].scaleMul;
    void rebuild();
  });
  ui.select("Показать", ["рядом", "только старый", "только новый"], mode, (v) => {
    mode = v;
    void rebuild();
  });
  ui.slider("Сколько мобов", 1, 9, 1, count, (v) => {
    count = v;
    void rebuild();
  });
  ui.slider("Размер моба", 0.4, 6, 0.1, size, (v) => {
    size = v;
    void rebuild();
  });
  ui.slider("Сила горения", 0, 1, 0.05, glow, (v) => (glow = v));

  ui.section("Частицы (правый огонь)");
  const t = FIRE_TUNE as Record<string, number>;
  const knob = (label: string, key: string, min: number, max: number, step: number): void =>
    ui.slider(label, min, max, step, t[key], (v) => {
      t[key] = v;
      fire.retune();
    });
  knob("Частиц в сек на моба", "rate", 5, 150, 1);
  knob("Жизнь мин, с", "lifeMin", 0.1, 2, 0.05);
  knob("Жизнь макс, с", "lifeMax", 0.1, 2.5, 0.05);
  knob("Размер мин", "sizeMin", 0.05, 1, 0.01);
  knob("Размер макс", "sizeMax", 0.05, 1.5, 0.01);
  knob("Скорость вверх", "rise", 0, 5, 0.1);
  knob("Ускорение вверх", "lift", -2, 8, 0.1);
  knob("Разброс в стороны", "spread", 0, 2, 0.05);
  knob("Яркость (альфа)", "alpha", 0.1, 2, 0.05);
  knob("Языки (1) / пятна (0)", "stretched", 0, 1, 1);
  ui.button("📋 Скопировать числа", () => {
    const txt = JSON.stringify(FIRE_TUNE);
    void navigator.clipboard?.writeText(txt);
    ui.note(`Скопировано: ${txt}`);
  });

  void rebuild();
}
