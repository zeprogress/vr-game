import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";

import {
  loadRig,
  recolorCharacter,
  BOT_SKIN_MODELS,
  type ModelName,
  type RigInstance,
} from "../world/models";

/**
 * Видимая модель самого игрока — нужна только в режиме «от третьего лица»
 * (смартфон). Это чисто локальный визуал: другим игрокам нас по-прежнему
 * показывает их RemoteAvatar по сетевым пакетам.
 *
 * Один скелет и набор клипов из пака Quaternius (как у ботов). Гоняем веса
 * четырёх лупов (idle/walk/run) + разовые swordslash/recievehit. Логику
 * порогов взяли из RemoteAvatar.stepBotLocomotion, только проще.
 */
const CLIPS = ["idle", "walk", "run", "swordslash", "recievehit"] as const;
const ONE_SHOT = new Set<string>(["swordslash", "recievehit"]);

/** Масштаб и посадка модели — как у ботов (см. RemoteAvatar). */
const RIG_SCALE = 0.52;
const FEET_Y = -1.68;
const HIT_MS = 500;

export class LocalAvatar {
  private readonly root: TransformNode;
  private holder: TransformNode | null = null;
  private rig: RigInstance | null = null;
  private readonly animW = new Map<string, number>();
  private fistL: TransformNode | null = null;
  private fistR: TransformNode | null = null;

  private skin = 0; // 0 — базовый рыцарь; syncSelf позовёт setSkin() с реальным
  private loading = false;
  private disposed = false;

  private swingUntil = 0;
  private swingSpeed = 1;
  private hitUntil = 0;
  private hidden = false;

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode("localAvatar", scene);
    void this.reload();
  }

  /** skin из PlayerState: 0 — базовый рыцарь, 1..N — модель из набора ботов. */
  setSkin(skin: number): void {
    if (skin === this.skin) return;
    this.skin = skin;
    void this.reload();
  }

  /** speed — множитель темпа атаки (>1 быстрее): ускоряет и клип, и окно. */
  swing(speed = 1): void {
    this.swingSpeed = speed > 0.1 ? speed : 1;
    const g = this.rig?.anims.get("swordslash");
    if (g) {
      // Окно = реальная длина клипа с учётом скорости (как у ботов).
      this.swingUntil =
        performance.now() + ((g.to - g.from) / 60 / this.swingSpeed) * 1000;
      g.start(false, this.swingSpeed, g.from, g.to, false);
      g.setWeightForAllAnimatables(1);
      this.animW.set("swordslash", 1);
    } else {
      this.swingUntil = performance.now() + 500 / this.swingSpeed;
    }
  }
  hurt(): void {
    this.hitUntil = performance.now() + HIT_MS;
  }

  /** Кость кулака для крепления оружия (как у ботов). null — риг не готов. */
  fistBone(side: "left" | "right"): TransformNode | null {
    return side === "left" ? this.fistL : this.fistR;
  }

  private model(): ModelName {
    return this.skin >= 1
      ? BOT_SKIN_MODELS[(this.skin - 1) % BOT_SKIN_MODELS.length]
      : "charKnight";
  }

  private async reload(): Promise<void> {
    if (this.loading) return; // подхватит актуальный skin сам
    this.loading = true;
    try {
      while (!this.disposed) {
        const want = this.skin;
        let make: () => RigInstance;
        try {
          make = await loadRig(this.scene, this.model());
        } catch {
          return; // модель не пришла — остаёмся без тела, не долбим
        }
        if (this.disposed || this.skin !== want) continue; // skin сменился

        // Оружие CombatSystem висит в кости кулака — отцепляем, иначе
        // dispose рига снесёт и его. Следующий кадр пересадит на новый риг.
        for (const f of [this.fistL, this.fistR]) {
          for (const c of f?.getChildren() ?? []) c.parent = null;
        }
        this.rig?.dispose();
        this.holder?.dispose();
        this.fistL = this.fistR = null;

        const holder = new TransformNode(`localAvatarModel`, this.scene);
        holder.parent = this.root;
        holder.position.set(0, FEET_Y, 0);
        holder.rotationQuaternion = Quaternion.Identity();
        holder.scaling.setAll(RIG_SCALE);

        const rig = make();
        rig.root.parent = holder;
        rig.root.position.setAll(0);
        recolorCharacter(rig.root);
        for (const m of rig.meshes) m.isPickable = false;

        for (const g of rig.anims.values()) g.stop();
        this.animW.clear();
        for (const n of CLIPS) this.animW.set(n, n === "idle" ? 1 : 0);
        const idle = rig.anims.get("idle");
        idle?.start(true, 1, idle.from, idle.to, false);
        idle?.setWeightForAllAnimatables(1);

        const bone = (n: string): TransformNode | null =>
          (rig.root.getDescendants(false).find((d) => d.name === n) as
            | TransformNode
            | undefined) ?? null;
        this.fistL = bone("Fist.L");
        this.fistR = bone("Fist.R");

        this.holder = holder;
        this.rig = rig;
        this.applyHidden();
        return;
      }
    } finally {
      this.loading = false;
    }
  }

  /**
   * Каждый кадр. `eye*` — позиция глаз игрока (как у RemoteAvatar.root):
   * модель сажается на землю смещением FEET_Y внутри.
   */
  update(
    dt: number,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    yaw: number,
    speed: number,
    hide: boolean,
  ): void {
    if (hide !== this.hidden) {
      this.hidden = hide;
      this.applyHidden();
    }
    this.root.position.set(eyeX, eyeY, eyeZ);
    this.root.rotation.y = yaw;

    const rig = this.rig;
    if (!rig || this.hidden) return;

    const now = performance.now();
    let want: string;
    if (now < this.swingUntil) want = "swordslash";
    else if (now < this.hitUntil) want = "recievehit";
    else if (speed > 3.2) want = "run";
    else if (speed > 0.4) want = "walk";
    else want = "idle";

    const k = Math.min(1, dt * 12);
    for (const n of CLIPS) {
      const g = rig.anims.get(n);
      if (!g) continue;
      const target = n === want ? 1 : 0;
      let w = this.animW.get(n) ?? 0;
      w += (target - w) * k;
      if (w <= 0.003) {
        w = 0;
        if (g.isPlaying && n !== want) g.stop();
      } else if (!g.isPlaying && !ONE_SHOT.has(n)) {
        g.start(true, 1, g.from, g.to, false);
      } else if (!g.isPlaying && n === want) {
        // Разовый клип (swordslash/recievehit): триггер уже прошёл, но клип
        // мог доиграть — перезапускаем, пока окно не закрылось.
        g.start(false, n === "swordslash" ? this.swingSpeed : 1, g.from, g.to, false);
      }
      this.animW.set(n, w);
      g.setWeightForAllAnimatables(w);
    }
  }

  private applyHidden(): void {
    this.root.setEnabled(!this.hidden);
  }

  dispose(): void {
    this.disposed = true;
    this.rig?.dispose();
    this.holder?.dispose();
    this.root.dispose();
  }
}
