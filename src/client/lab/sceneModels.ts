import { TransformNode } from "@babylonjs/core/Meshes/transformNode";

import { MOB } from "#shared/constants";
import { MODELS, loadRig, recolorMonster, type ModelName, type RigInstance } from "../world/models";
import type { LabCtx } from "./main";

/**
 * Любая модель из MODELS: размер (в тех же единицах, что scaleMul мобов —
 * 1 ≈ 0.96 м роста) и все её анимации кнопками. Для подбора размера новых
 * мобов и проверки, какие клипы есть у модели.
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

  async function load(): Promise<void> {
    rig?.dispose();
    rig = null;
    const make = await loadRig(scene, name).catch(() => null);
    if (!make) return;
    rig = make();
    rig.root.parent = holder;
    holder.scaling.setAll((MOB.bodyRadius * 1.75) / rig.nativeHeight);
    if (name.startsWith("mon")) recolorMonster(rig.root);
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
    void load();
  });
  ui.slider("Размер (scaleMul)", 0.2, 8, 0.1, size, (v) => (size = v));
  ui.note("Рост ≈ 0.96 м × размер. Голем 2.55, колосс 5.4, призрак 1.1.");
  ui.toggle("Вращать", spin, (v) => (spin = v));
  ui.section("Анимации");
  animBox = ui.group();
  void load();
}
