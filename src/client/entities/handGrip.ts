import type { Scene } from "@babylonjs/core/scene";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { RigInstance } from "../world/models";

/**
 * Сжатый кулак на руке с оружием или щитом. У моделей с пальцами (Human_Male.glb: кости Left_Index1…
 * Right_Pinky3) кисть спокойная, пока рука пустая, и сгибается в кулак, когда в ней оружие. Обе позы берём
 * из клипа «Fist» (первый кадр — спокойная кисть, последний — кулак) один раз при создании. У моделей без пальцев (Quaternius) костей нет —
 * ничего не делаем, их кулак и так в скелете (Fist.L / Fist.R).
 *
 * Пальцы не зависят от клипов тела: каждый кадр (после анимаций) ставим их между покоем и кулаком по доле
 * сжатия (плавно, ~0.1 с), поэтому смена клипа не сбивает хват.
 */
const FINGER = /^(Left|Right)_(Thumb|Index|Middle|Ring|Pinky)\d$/;

interface FingerBone {
  node: TransformNode;
  side: "L" | "R";
  rest: Quaternion;
  fist: Quaternion;
}

/** Какие кисти сжаты при этом оружии: в руке что-то есть, а копьё и молот левая держит за древко. */
export function handsBusy(left: string, right: string): [boolean, boolean] {
  return [left !== "" || right === "spear" || right === "hammer", right !== ""];
}

export class HandGrip {
  private readonly bones: FingerBone[] = [];
  private readonly want = { L: false, R: false };
  private readonly grip = { L: 0, R: 0 };
  private readonly scene: Scene;
  private readonly obs: unknown;
  private readonly tmp = new Quaternion();

  constructor(scene: Scene, rig: RigInstance) {
    this.scene = scene;
    const nodes = (rig.root.getDescendants(false).filter((n) => FINGER.test(n.name)) as TransformNode[]).filter(
      (n) => n.rotationQuaternion,
    );
    const fist = rig.anims.get("fist");
    const rest = nodes.map((n) => n.rotationQuaternion!.clone());
    const fq = rest.map((q) => q.clone());
    if (fist) {
      // Кадр начала — спокойная кисть, кадр конца — кулак. Значения — прямо из кривых клипа: goToFrame у
      // остановленной группы ничего не делает (аниматоров нет), и кулак совпадал с открытой ладонью.
      for (const ta of fist.targetedAnimations) {
        if (ta.animation.targetProperty !== "rotationQuaternion") continue;
        const i = nodes.indexOf(ta.target as TransformNode);
        if (i < 0) continue;
        rest[i].copyFrom(ta.animation.evaluate(fist.from) as Quaternion);
        fq[i].copyFrom(ta.animation.evaluate(fist.to) as Quaternion);
      }
    }
    nodes.forEach((node, i) => {
      node.rotationQuaternion = rest[i].clone();
      this.bones.push({ node, side: node.name.startsWith("Left") ? "L" : "R", rest: rest[i], fist: fq[i] });
    });
    this.obs = scene.onAfterAnimationsObservable.add(() => this.apply());
  }

  /** Есть ли пальцы, которые надо сгибать (иначе экземпляр ничего не делает). */
  get active(): boolean {
    return this.bones.length > 0;
  }

  /** В руке оружие или щит. */
  setHolding(left: boolean, right: boolean): void {
    this.want.L = left;
    this.want.R = right;
  }

  private apply(): void {
    if (!this.bones.length) return;
    const dt = Math.min(0.1, this.scene.getEngine().getDeltaTime() / 1000);
    const k = 1 - Math.exp(-dt * 10);
    for (const s of ["L", "R"] as const) {
      this.grip[s] += ((this.want[s] ? 1 : 0) - this.grip[s]) * k;
    }
    for (const b of this.bones) {
      Quaternion.SlerpToRef(b.rest, b.fist, this.grip[b.side], this.tmp);
      b.node.rotationQuaternion = this.tmp.clone();
    }
  }

  dispose(): void {
    this.scene.onAfterAnimationsObservable.remove(this.obs as never);
    this.bones.length = 0;
  }
}
