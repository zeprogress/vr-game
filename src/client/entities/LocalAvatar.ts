import type { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Quaternion } from "@babylonjs/core/Maths/math.vector";
import type { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { BuffOrbitFx } from "../ui/BuffOutlineFx";
import { CLASS_CLIP_NAMES, CLASS_ONE_SHOT, classAnimSet, classClipsFor, type ClassAnimSet } from "../world/classPoses";
import { StunStarsFx } from "../ui/StunStarsFx";

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
const CLIPS: readonly string[] = ["idle", "walk", "run", "swordslash", "recievehit", "pickup", "jump", "roll", "death", ...CLASS_CLIP_NAMES];
const ONE_SHOT = new Set<string>(["swordslash", "recievehit", "pickup", "jump", "roll", ...CLASS_ONE_SHOT]);
/** Подбор играем вдвое быстрее, как у RemoteAvatar (видно спектатору так же). */
const PICKUP_RATE = 2;

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
  /** Клип текущего замаха (swordslash или клип класса: выпад, удар молотом, укол). */
  private swingClip = "swordslash";
  /** Клипы класса по оружию в руках (стойка/удар); null — обычные. */
  private animSet: ClassAnimSet | null = null;
  private gearSig = "";
  private classGroups: AnimationGroup[] = [];
  private hitUntil = 0;
  private pickupUntil = 0;
  private jumpUntil = 0;
  private dead = false;
  private deadAnim = false;
  /** Гистерезис порогов шаг/бег — как у RemoteAvatar (иначе клип щёлкает на границе). */
  private locoRun = false;
  private locoMove = false;
  private hidden = false;
  /** Баффы — кружащие мечи (×2 опыт/урон) и щиты («Тепло костра»). */
  private readonly buffAura: BuffOrbitFx;
  /** 🧪 Умения ассасина в силе — фигурки вокруг героя (яд, тень, дым). */
  private skillBuffs = { plague: false, abyss: false, smoke: false };
  private campWarm = false;
  /** Свитки: ветер (башмаки) и мудрость (стрелки вверх). */
  private windBuff = false;
  private xpBuff = false;
  private buffed = false;
  private readonly stunStars: StunStarsFx;
  private stunned = false;

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode("localAvatar", scene);
    this.buffAura = new BuffOrbitFx(scene, this.root, -0.75);
    this.stunStars = new StunStarsFx(scene, this.root, 0.4);
    void this.reload();
  }

  /** Бафф победы над событием — синяя аура. */
  setBuffed(on: boolean): void {
    this.buffed = on;
  }

  /** «Тепло костра» (бафф лагеря) — оранжевое свечение у ног. */
  setCampWarm(on: boolean): void {
    this.campWarm = on;
  }

  /** 🧪 Умения ассасина в силе (яд, тень, дым) — фигурки по кругу. */
  setSkillBuffs(b: { plague: boolean; abyss: boolean; smoke: boolean }): void {
    this.skillBuffs = b;
  }

  /** Свитки: ветер и мудрость — значки по кругу. */
  setScrolls(wind: boolean, xp: boolean): void {
    this.windBuff = wind;
    this.xpBuff = xp;
  }

  /** Оглушён (напр. волной "Чародея руин") — звёздочки над головой. */
  setStunned(on: boolean): void {
    this.stunned = on;
  }

  /** skin из PlayerState: 0 — базовый рыцарь, 1..N — модель из набора ботов. */
  setSkin(skin: number): void {
    if (skin === this.skin) return;
    this.skin = skin;
    void this.reload();
  }

  /** Что в руках (классы оружия) — выбирает стойку и удар класса. */
  setGear(left: string, right: string): void {
    const sig = `${left}|${right}`;
    if (sig === this.gearSig) return;
    this.gearSig = sig;
    this.animSet = classAnimSet(left, right);
  }

  /**
   * speed — множитель темпа атаки (>1 быстрее): ускоряет и клип, и окно.
   * kind/hand — каким оружием и какой рукой (клип класса; левый кинжал — свой клип).
   */
  swing(speed = 1, kind?: string, hand?: "left" | "right"): void {
    this.swingSpeed = speed > 0.1 ? speed : 1;
    const set = this.animSet;
    const useClass = !!set && (kind === undefined || kind === "dagger" || kind === "spear" || kind === "hammer" || kind === "bow");
    const name = useClass && set ? (hand === "left" && set.alt ? set.alt : set.attack) : "swordslash";
    if (name !== this.swingClip) {
      this.rig?.anims.get(this.swingClip)?.stop();
      this.animW.set(this.swingClip, 0);
      this.swingClip = name;
    }
    const g = this.rig?.anims.get(name);
    if (g) {
      // Окно = реальная длина клипа с учётом скорости (как у ботов).
      this.swingUntil =
        performance.now() + ((g.to - g.from) / 60 / this.swingSpeed) * 1000;
      // Babylon .start() на уже играющей группе — no-op: жёсткий сброс.
      if (g.isPlaying) g.stop();
      g.reset();
      g.start(false, this.swingSpeed, g.from, g.to, false);
      g.setWeightForAllAnimatables(1);
      this.animW.set(name, 1);
    } else {
      this.swingUntil = performance.now() + 500 / this.swingSpeed;
    }
  }
  hurt(): void {
    this.hitUntil = performance.now() + HIT_MS;
  }

  /** Подобрал предмет — наклон с подбором (как видят другие и спектатор). */
  pickup(): void {
    this.pickupUntil = this.playOneShot("pickup", PICKUP_RATE, 600);
  }

  /** Разовый клип умения (кувырок рывка, прыжок «Сокрушения») — поверх всего, кроме замаха. */
  private extraClip = "";
  private extraUntil = 0;
  private extraRate = 1;
  oneShot(name: string, rate = 1): void {
    const until = this.playOneShot(name, rate, 600);
    this.extraClip = name;
    this.extraRate = rate;
    this.extraUntil = until;
  }

  /** Прыжок — клип прыжка на время полёта. */
  jump(): void {
    this.jumpUntil = this.playOneShot("jump", 1.3, 700);
  }

  /** Смерть: клип смерти один раз и застыть (раньше модель просто пряталась). */
  setDead(on: boolean): void {
    this.dead = on;
  }

  /** Запустить разовый клип сначала; вернуть, до какого момента он «хочется». */
  private playOneShot(name: string, rate: number, fallbackMs: number): number {
    const g = this.rig?.anims.get(name);
    if (!g) return performance.now() + fallbackMs;
    if (g.isPlaying) g.stop();
    g.reset();
    g.start(false, rate, g.from, g.to, false);
    g.setWeightForAllAnimatables(1);
    this.animW.set(name, 1);
    return performance.now() + ((g.to - g.from) / 60 / rate) * 1000;
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
          // smoothNormals: убирает фасетчатый вид. Раньше уводило свет
          // ровно на 180° (зеркальный масштаб в трансформе меша) — теперь
          // models.ts компенсирует это по знаку определителя мировой матрицы.
          make = await loadRig(this.scene, this.model(), { smoothNormals: true });
        } catch {
          return; // модель не пришла — остаёмся без тела, не долбим
        }
        if (this.disposed || this.skin !== want) continue; // skin сменился

        // Оружие CombatSystem висит в кости кулака — отцепляем, иначе
        // dispose рига снесёт и его. Следующий кадр пересадит на новый риг.
        for (const f of [this.fistL, this.fistR]) {
          for (const c of f?.getChildren() ?? []) c.parent = null;
        }
        for (const g of this.classGroups) g.dispose();
        this.classGroups = [];
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

        // Клипы классов (выпад, молот, кинжалы, лук) — на скелете этой модели.
        try {
          this.classGroups = classClipsFor(this.scene, rig, this.model());
        } catch (e) {
          console.warn("[avatar] клипы классов не собрались:", (e as Error).message);
        }
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
    const show = !this.hidden;
    this.buffAura.set({
      victory: show && this.buffed,
      camp: show && this.campWarm,
      scrollWind: show && this.windBuff,
      scrollXp: show && this.xpBuff,
      plague: show && this.skillBuffs.plague,
      abyss: show && this.skillBuffs.abyss,
      smoke: show && this.skillBuffs.smoke,
    });
    this.buffAura.update(dt);
    this.stunStars.setActive(this.stunned && !this.hidden);
    this.stunStars.update(dt);

    const rig = this.rig;
    if (!rig || this.hidden) return;

    // Смерть — приоритет: клип один раз и застываем на последнем кадре.
    if (this.dead) {
      if (!this.deadAnim) {
        this.deadAnim = true;
        for (const n of CLIPS) {
          if (n === "death") continue;
          rig.anims.get(n)?.stop();
          this.animW.set(n, 0);
        }
        const d = rig.anims.get("death");
        if (d) {
          d.start(false, 1, d.from, d.to, false);
          d.setWeightForAllAnimatables(1);
          this.animW.set("death", 1);
        }
      }
      return;
    }
    if (this.deadAnim) {
      this.deadAnim = false;
      const d = rig.anims.get("death");
      d?.stop();
      d?.reset();
      this.animW.set("death", 0);
    }

    const now = performance.now();
    const run = this.locoRun ? speed > 1.8 : speed > 2.4;
    const move = this.locoMove ? speed > 0.25 : speed > 0.45;
    this.locoRun = run;
    this.locoMove = move;
    let want: string;
    if (now < this.extraUntil) want = this.extraClip;
    else if (now < this.swingUntil) want = this.swingClip;
    else if (now < this.hitUntil) want = "recievehit";
    else if (now < this.pickupUntil) want = "pickup";
    else if (now < this.jumpUntil) want = "jump";
    else if (run) want = "run";
    else if (move) want = "walk";
    else want = this.animSet && rig.anims.has(this.animSet.idle) ? this.animSet.idle : "idle";

    const k = Math.min(1, dt * 12);
    for (const n of CLIPS) {
      if (n === "death") continue;
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
        const rate = n === this.swingClip ? this.swingSpeed : n === "pickup" ? PICKUP_RATE : n === this.extraClip ? this.extraRate : 1;
        g.start(false, rate, g.from, g.to, false);
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
    for (const g of this.classGroups) g.dispose();
    this.buffAura.dispose();
    this.stunStars.dispose();
    this.rig?.dispose();
    this.holder?.dispose();
    this.root.dispose();
  }
}
