import { skillArrowTime } from "#shared/classes2";
import type { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { createArrowProto } from "../combat/Arrow";

/**
 * Летящие стрелы умений лучника — та же модель стрелы, что у выстрела из лука (createArrowProto), а не
 * молнии-следы. Инстансы одной модели: сколько бы стрел ни летело — три отрисовки (древко, наконечник,
 * оперение), материалы не клонируются. Один экземпляр на сцену (игра, спектатор), сам обновляется перед кадром.
 *
 * Время полёта — по общей скорости SKILL_ARROW.speed: сервер наносит урон через то же время, поэтому цифры
 * урона и взрыв появляются ровно в момент попадания стрелы.
 */

type P = { x: number; y: number; z: number };

interface Flight {
  inst: InstancedMesh;
  a: P;
  b: P;
  /** Высота дуги над прямой в середине пути, м. */
  arc: number;
  t: number;
  /** Время полёта, с. */
  T: number;
  /** Сколько стрела торчит в точке попадания, с (0 — исчезает сразу). */
  stick: number;
  onHit?: () => void;
  landed: boolean;
}

/** Предел одновременно видимых стрел умений (лишние — старые гаснут). */
const MAX_LIVE = 96;

export class SkillArrows {
  private static readonly byScene = new WeakMap<Scene, SkillArrows>();

  static of(scene: Scene): SkillArrows {
    let s = SkillArrows.byScene.get(scene);
    if (!s) SkillArrows.byScene.set(scene, (s = new SkillArrows(scene)));
    return s;
  }

  private readonly proto: Mesh;
  private readonly free: InstancedMesh[] = [];
  private readonly live: Flight[] = [];
  private n = 0;
  private readonly tmp = new Vector3();

  private constructor(scene: Scene) {
    this.proto = createArrowProto(scene, false);
    this.proto.name = "skillArrowProto";
    // Прототип включён, но не рисуется сам: инстансы рисуются только при включённом источнике.
    this.proto.setEnabled(true);
    this.proto.isVisible = false;
    scene.onBeforeRenderObservable.add(() => this.update(Math.min(0.1, scene.getEngine().getDeltaTime() / 1000)));
  }

  /**
   * Стрела из `a` в `b`. Время — по скорости стрелы (или `time`), `arc` — подъём дуги, `scale` — размер
   * (на стриме и в шлеме мелкую стрелу не видно), `stick` — сколько торчит после попадания, `onHit` — в момент попадания.
   */
  fly(a: P, b: P, o: { time?: number; arc?: number; stick?: number; scale?: number; onHit?: () => void } = {}): void {
    const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const T = o.time ?? skillArrowTime(dist);
    if (this.live.length >= MAX_LIVE) this.end(this.live.shift()!);
    const inst = this.free.pop() ?? this.proto.createInstance(`skillArrow${this.n++}`);
    inst.setEnabled(true);
    inst.isPickable = false;
    inst.scaling.setAll(o.scale ?? 1.5);
    const f: Flight = { inst, a: { ...a }, b: { ...b }, arc: o.arc ?? Math.min(2, dist * 0.04), t: 0, T, stick: o.stick ?? 0, onHit: o.onHit, landed: false };
    this.place(f, 0);
    this.live.push(f);
  }

  private pos(f: Flight, u: number, out: Vector3): Vector3 {
    return out.set(
      f.a.x + (f.b.x - f.a.x) * u,
      f.a.y + (f.b.y - f.a.y) * u + f.arc * 4 * u * (1 - u),
      f.a.z + (f.b.z - f.a.z) * u,
    );
  }

  /** Поставить стрелу в долю пути u и повернуть наконечником по ходу полёта. */
  private place(f: Flight, u: number): void {
    const p = this.pos(f, u, f.inst.position);
    const ahead = this.pos(f, Math.min(1, u + 0.02), this.tmp);
    if (u >= 0.98) {
      // У самого конца — направление по последнему отрезку пути (а не в точку же самую).
      const back = this.pos(f, 0.96, new Vector3());
      ahead.copyFrom(p).addInPlace(p.subtract(back));
    }
    if (Vector3.DistanceSquared(p, ahead) > 1e-8) f.inst.lookAt(ahead);
  }

  private end(f: Flight): void {
    f.inst.setEnabled(false);
    if (this.free.length < MAX_LIVE) this.free.push(f.inst);
    else f.inst.dispose();
  }

  private update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.t += dt;
      if (!f.landed) {
        const u = Math.min(1, f.t / f.T);
        this.place(f, u);
        if (u < 1) continue;
        f.landed = true;
        f.t = 0;
        f.onHit?.();
      }
      if (f.t >= f.stick) {
        this.end(f);
        this.live.splice(i, 1);
      }
    }
  }
}
