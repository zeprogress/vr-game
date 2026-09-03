import type { Scene } from "@babylonjs/core/scene";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/capsuleBuilder";

import type { PlayerMode, PlayerState, Xf } from "#shared/net/schema";
import type { WeaponClass, WeaponTier } from "#shared/items";
import type { WeaponKind } from "#shared/combat";
import { LOADOUT } from "../config/loadout";
import { NameTag } from "../ui/NameTag";
import { HealthBar3D } from "../ui/HealthBar3D";
import type { Hittable } from "../combat/Hittable";
import { makeBotBody } from "./botModels";
import { loadRig, recolorCharacter, BOT_SKIN_MODELS, type RigInstance } from "../world/models";

/** Доворот модели бота, если её «перёд» смотрит не в +Z. Подбор: `?byaw=<рад>`. */
const BOT_MODEL_YAW = (() => {
  const p = new URLSearchParams(location.search);
  const v = Number(p.get("byaw"));
  return p.has("byaw") && Number.isFinite(v) ? v : 0;
})();
/**
 * Единый масштаб персонажа (подобран так, что «обычный» рост ≈ 1.85 м).
 * Не нормируем по высоте: у ведьмы/мага шляпа, у гоблина низкий рост — пусть
 * так и будет, естественный разброс.
 */
const BOT_RIG_SCALE = 0.52;
/** Ноги модели ниже локального нуля аватара (ноль = уровень глаз ≈ 1.7 м). */
const BOT_FEET_Y = -1.68;

export type MakeWeapon = (cls: WeaponClass, tier: WeaponTier) => Mesh;

const FWD_Z = new Vector3(0, 0, 1);

/** Рендерим на 100 мс в прошлом — между двумя пришедшими снапшотами. */
const INTERP_DELAY = 100;
/** Если свежий снапшот старше — держим позу (не экстраполируем). */
const HOLD_AFTER = 260;
const BUFFER_MS = 600;

interface Snap {
  t: number;
  mode: PlayerMode;
  head: readonly [number, number, number, number, number, number, number];
  handL: readonly [number, number, number, number, number, number, number];
  handR: readonly [number, number, number, number, number, number, number];
}

function snapXf(x: Xf): Snap["head"] {
  return [x.x, x.y, x.z, x.qx, x.qy, x.qz, x.qw];
}

/** Цвет игрока из его id — чтобы отличать аватары. */
function colorFor(id: string): Color3 {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return Color3.FromHSV(h % 360, 0.55, 0.85);
}

/**
 * Чужой игрок. В VR — голова-куб + две кисти; в плоском — капсула + голова.
 * Транспорт сглаживается интерполяцией между снапшотами (4e).
 * В PvP (этап 10) — цель для оружия: реализует `Hittable`.
 */
export class RemoteAvatar implements Hittable {
  private readonly root: TransformNode;
  private readonly mat: StandardMaterial;
  private readonly nameTag: NameTag;
  private head!: Mesh;
  private handL: Mesh | null = null;
  private handR: Mesh | null = null;
  private capsule: Mesh | null = null;
  private botBody: TransformNode | null = null;
  private botRig: RigInstance | null = null;
  private botHolder: TransformNode | null = null;
  private botRigLoading = false;
  private skin = 0;
  private builtSkin = -1;
  private mode: PlayerMode | null = null;

  // Анимации модели бота (crossfade по весам).
  private animName = "idle";
  private readonly animW = new Map<string, number>();
  private planarSpeed = 0;
  private swingUntil = 0;
  private lastUpdate = 0;
  private readonly _prevPos = new Vector3();
  private disposed = false;

  /** Оружие в руках — чтобы союзники видели, кто с чем. */
  private gearL: Mesh | null = null;
  private gearR: Mesh | null = null;
  private gearKeyL = "";
  private gearKeyR = "";
  private wantL: readonly [string, string] = ["", ""];
  private wantR: readonly [string, string] = ["", ""];

  private readonly buf: Snap[] = [];
  private readonly _qa = new Quaternion();
  private readonly _qb = new Quaternion();
  /** Оценка реального интервала между снапшотами (ЕМА) и сырое время предыдущего. */
  private snapDt = 55;
  private lastPushRaw = 0;

  // --- PvP (этап 10) ---
  private hp = 100;
  private maxHp = 100;
  private dead = false;
  private theirPvp = false;
  private myPvp = false;
  private bar: HealthBar3D | null = null;
  private now = 0;
  private lastHitAt = -999;
  private nick: string;
  private level = 0; // 0 — ещё не знаем (первый push всегда перерисует плашку бота)
  private swingAt = -999;
  /** Сообщить серверу о попадании по этому игроку. Ставит Game (только PvP). */
  onHit: ((weapon: WeaponKind, dir: Vector3) => void) | null = null;
  readonly id: string;

  constructor(
    private readonly scene: Scene,
    id: string,
    nick: string,
    mode: PlayerMode,
    private readonly makeWeapon: MakeWeapon | null = null,
  ) {
    this.id = id;
    this.nick = nick;
    this.root = new TransformNode(`avatar_${id}`, scene);
    this.root.rotationQuaternion = Quaternion.Identity();

    this.mat = new StandardMaterial(`avatarMat_${id}`, scene);
    this.mat.diffuseColor = colorFor(id);
    this.mat.specularColor = new Color3(0.1, 0.1, 0.1);

    this.nameTag = new NameTag(scene, this.root, new Vector3(0, 0.42, 0), nick, null);
    this.setMode(mode);
  }

  /** Быстрый замах — по сети (act:swing). Виден на модельке бота. */
  playSwing(): void {
    this.swingAt = this.now;
    const g = this.botRig?.anims.get("swordslash");
    if (g) {
      g.start(false, 1.35, g.from, g.to, false);
      g.setWeightForAllAnimatables(1);
      this.animW.set("swordslash", 1);
      this.swingUntil = this.now + ((g.to - g.from) / 60 / 1.35) * 1000;
    }
  }

  private setMode(mode: PlayerMode): void {
    if (this.mode === mode && this.builtSkin === this.skin) return;
    this.mode = mode;
    this.builtSkin = this.skin;
    this.head?.dispose();
    this.handL?.dispose();
    this.handR?.dispose();
    this.capsule?.dispose();
    this.botBody?.dispose(false, true);
    this.botRig?.dispose();
    this.botHolder?.dispose();
    this.botRig = this.botHolder = null;
    this.animW.clear();
    this.animName = "idle";
    this.handL = this.handR = this.capsule = this.botBody = null;
    // Оружие висело на кистях/корпусе — пересоберём под новый режим.
    this.gearL?.dispose();
    this.gearR?.dispose();
    this.gearL = this.gearR = null;
    this.gearKeyL = this.gearKeyR = "";

    if (this.skin > 0) {
      // Бот зрителя (Ф10): персонаж из пака грузится асинхронно; пока не
      // пришёл — показываем процедурную заглушку (4 варианта). Корпус целиком
      // поворачивается по yaw (крутится this.root, см. update()).
      const stub = ((this.skin - 1) % 4) + 1;
      this.botBody = makeBotBody(this.scene, stub, this.mat.diffuseColor);
      this.botBody.parent = this.root;
      // Пустая «голова» — держатель для eyeForward / NameTag якоря.
      this.head = MeshBuilder.CreateBox("botHeadAnchor", { size: 0.01 }, this.scene);
      this.head.parent = this.botBody;
      this.head.isVisible = false;
      // Модельки бота выше «головы» плоского аватара — поднимаем плашку.
      this.nameTag.setAnchorY(0.72);
      void this.loadBotRig(this.skin);
    } else if (mode === "vr") {
      this.head = MeshBuilder.CreateBox("avatarHead", { size: 0.22 }, this.scene);
      this.handL = this.makeHand("avatarHandL");
      this.handR = this.makeHand("avatarHandR");
      this.head.parent = this.root;
      this.head.material = this.mat;
    } else {
      this.head = MeshBuilder.CreateSphere("avatarHead", { diameter: 0.24, segments: 8 }, this.scene);
      this.capsule = MeshBuilder.CreateCapsule(
        "avatarBody",
        { radius: 0.26, height: 1.5 },
        this.scene,
      );
      this.capsule.parent = this.root;
      this.capsule.position.set(0, -0.85, 0);
      this.capsule.material = this.mat;
      this.capsule.isPickable = false;
      this.head.parent = this.root;
      this.head.material = this.mat;
    }
    this.head.rotationQuaternion = Quaternion.Identity();
    this.head.isPickable = false;
  }

  private makeHand(name: string): Mesh {
    const h = MeshBuilder.CreateBox(name, { width: 0.09, height: 0.05, depth: 0.13 }, this.scene);
    h.parent = this.root;
    h.rotationQuaternion = Quaternion.Identity();
    h.material = this.mat;
    h.isPickable = false;
    return h;
  }

  /** Где сейчас голова — по ней голос звучит из нужного места. */
  get position(): Vector3 {
    return this.root.getAbsolutePosition();
  }

  private readonly _fwd = new Vector3();
  /** Направление взгляда головы в мире — для камеры «из глаз» (этап 17 Ф3). */
  get eyeForward(): Vector3 {
    this.head.getDirectionToRef(FWD_Z, this._fwd);
    return this._fwd;
  }

  /** Огонёк над головой, пока игрок говорит. */
  setSpeaking(on: boolean): void {
    if (on && !this.speakDot) {
      const dot = MeshBuilder.CreateSphere(`speak_${this.root.name}`, { diameter: 0.12, segments: 6 }, this.scene);
      const m = new StandardMaterial("speakMat", this.scene);
      m.emissiveColor = new Color3(0.4, 1, 0.5);
      m.diffuseColor = new Color3(0, 0, 0);
      m.specularColor = new Color3(0, 0, 0);
      m.disableLighting = true;
      dot.material = m;
      dot.parent = this.root;
      dot.position.set(0, 0.62, 0);
      dot.isPickable = false;
      this.speakDot = dot;
    }
    this.speakDot?.setEnabled(on);
  }
  private speakDot: Mesh | null = null;

  /** Пришло новое состояние от сервера — кладём снапшот с меткой времени. */
  push(now: number, p: PlayerState): void {
    this.wantL = [p.leftCls, p.leftTier];
    this.wantR = [p.rightCls, p.rightTier];
    this.skin = p.skin ?? 0;
    if (this.skin > 0 && (p.level !== this.level || this.nick !== p.nick)) {
      this.level = p.level;
      this.nick = p.nick;
      this.nameTag.setInfo(p.nick, p.level);
    }
    this.hp = p.hp;
    this.maxHp = p.maxHp > 0 ? p.maxHp : 100;
    this.dead = p.dead === 1;
    this.theirPvp = p.pvp === 1;
    const last = this.buf[this.buf.length - 1];
    const head = snapXf(p.head);
    // Дедуп: сервер шлёт ~18 Гц, кадров больше — не копим одинаковое.
    if (last && last.mode === p.mode && head.every((v, i) => Math.abs(v - last.head[i]) < 1e-4)) {
      return;
    }
    // Снапшоты приходят ровным темпом на сервере, но НАБЛЮДАЕМ мы их на границах
    // кадров рендера (кэп 30 fps → интервал прыгает 33/66 мс). Если ставить метку
    // по факту наблюдения, интерполяция «плывёт» по скорости — заметно, когда
    // бот/игрок бежит. Кладём снапшоты на ровную сетку по оценке серверного
    // темпа, мягко подтягивая её к реальному времени, чтобы не убегать.
    let t = now;
    if (last && this.lastPushRaw > 0) {
      const real = now - this.lastPushRaw;
      if (real > 8 && real < 500) this.snapDt += (real - this.snapDt) * 0.15;
      t = last.t + this.snapDt;
      const lo = now - this.snapDt * 1.5;
      const hi = now + this.snapDt * 0.5;
      if (t < lo) t = lo;
      else if (t > hi) t = hi;
    }
    this.lastPushRaw = now;
    this.buf.push({ t, mode: p.mode, head, handL: snapXf(p.handL), handR: snapXf(p.handR) });
    while (this.buf.length > 2 && this.buf[0].t < now - BUFFER_MS) this.buf.shift();
  }

  /** true — мы с этим игроком в PvP (у обоих флаг, он жив). */
  private get pvpTarget(): boolean {
    return this.myPvp && this.theirPvp && !this.dead;
  }

  /** Game каждый кадр: включён ли МОЙ флаг PvP. */
  setMyPvp(on: boolean): void {
    this.myPvp = on;
  }

  // ---- Hittable ----

  get alive(): boolean {
    return this.pvpTarget;
  }

  hitSegment(): { a: Vector3; b: Vector3; radius: number } {
    const h = this.position; // root = голова
    return {
      a: new Vector3(h.x, h.y + 0.05, h.z),
      b: new Vector3(h.x, h.y - 1.5, h.z),
      radius: 0.34,
    };
  }

  hit(_dir: Vector3, weapon: WeaponKind): boolean {
    if (!this.pvpTarget) return false;
    // За один взмах не шлём десяток заявок — сервер всё равно ограничит темпом.
    if (this.now - this.lastHitAt < 320) return false;
    this.lastHitAt = this.now;
    this.onHit?.(weapon, _dir);
    return true;
  }

  center(): Vector3 {
    const h = this.position;
    return new Vector3(h.x, h.y - 0.8, h.z);
  }

  /** Каждый кадр: ставим позу на INTERP_DELAY мс назад между снапшотами. */
  update(now: number): void {
    this.now = now;
    const dt = this.lastUpdate > 0 ? Math.min(0.1, (now - this.lastUpdate) / 1000) : 0.016;
    this.lastUpdate = now;
    this.syncBar();
    if (this.buf.length === 0) return;
    const target = now - INTERP_DELAY;

    let a = this.buf[0];
    let b = this.buf[this.buf.length - 1];
    if (target <= a.t) {
      b = a; // ещё нет истории — держим самый старый
    } else if (target >= b.t) {
      a = b; // отстали / игрок замер — держим самый свежий
    } else {
      for (let i = 1; i < this.buf.length; i++) {
        if (this.buf[i].t >= target) {
          a = this.buf[i - 1];
          b = this.buf[i];
          break;
        }
      }
    }

    const stale = now - b.t > HOLD_AFTER;
    const s = stale || b.t === a.t ? 1 : (target - a.t) / (b.t - a.t);

    this.setMode(b.mode);
    // Бот: поворачиваем корпус целиком (root); обычный аватар — только «голову».
    if (this.skin > 0) {
      if (!this.root.rotationQuaternion) this.root.rotationQuaternion = Quaternion.Identity();
      this.applyXf(this.root, this.root.rotationQuaternion, a.head, b.head, s, true);
      if (this.botRig) this.stepBotLocomotion(now, dt);
      else this.animateSwing(now);
    } else {
      this.applyXf(this.root, this.head.rotationQuaternion!, a.head, b.head, s, true);
      if (this.mode === "vr") {
        this.applyXf(this.handL!, this.handL!.rotationQuaternion!, a.handL, b.handL, s, false);
        this.applyXf(this.handR!, this.handR!.rotationQuaternion!, a.handR, b.handR, s, false);
      }
    }
    this.applyGear();
  }

  /** Анимация замаха бота: короткий рывок-наклон корпуса и назад. */
  private animateSwing(now: number): void {
    if (!this.botBody) return;
    const f = (now - this.swingAt) / 360;
    if (f < 0 || f >= 1) {
      this.botBody.rotation.x = 0;
      this.botBody.position.z = 0;
      return;
    }
    // Резкий замах вперёд (первая треть) и плавный возврат.
    const chop = f < 0.35 ? f / 0.35 : 1 - (f - 0.35) / 0.65;
    this.botBody.rotation.x = -0.6 * chop;
    this.botBody.position.z = 0.25 * chop;
  }

  /** Подгрузить персонажа для бота и заменить им процедурную заглушку. */
  private async loadBotRig(skinAtCall: number): Promise<void> {
    if (this.botRigLoading) return;
    this.botRigLoading = true;
    const model = BOT_SKIN_MODELS[(skinAtCall - 1) % BOT_SKIN_MODELS.length];
    try {
      const make = await loadRig(this.scene, model);
      if (this.disposed || this.skin !== skinAtCall || this.botRig) return;
      const rig = make();

      // Обёртка: масштаб + доворот держим здесь, трансформы самой модели не трогаем.
      const holder = new TransformNode(`botModel_${this.id}`, this.scene);
      holder.parent = this.root;
      holder.rotationQuaternion = Quaternion.RotationYawPitchRoll(BOT_MODEL_YAW, 0, 0);
      holder.position.set(0, BOT_FEET_Y, 0);
      rig.root.parent = holder;
      rig.root.position.setAll(0);
      holder.scaling.setAll(BOT_RIG_SCALE);

      recolorCharacter(rig.root);
      for (const m of rig.meshes) m.isPickable = false;

      // Клипы в покое; веса гоняет stepBotAnims().
      for (const [n, g] of rig.anims) {
        g.stop();
        this.animW.set(n, n === "idle" ? 1 : 0);
      }
      this.animName = "idle";

      // Готово — сносим заглушку, перецепляем якорь головы.
      this.botBody?.dispose(false, true);
      this.botBody = null;
      this.head.dispose();
      this.head = MeshBuilder.CreateBox("botHeadAnchor", { size: 0.01 }, this.scene);
      this.head.parent = holder;
      this.head.position.set(0, rig.nativeHeight * 0.82, 0);
      this.head.rotationQuaternion = Quaternion.Identity();
      this.head.isVisible = false;
      this.head.isPickable = false;

      this._prevPos.copyFrom(this.root.position); // без ложного «бега» в первый кадр
      this.botHolder = holder;
      this.botRig = rig;
      this.gearKeyR = this.gearKeyL = ""; // оружие боту-персонажу пока не вешаем
    } catch {
      // модель не пришла — остаётся процедурная заглушка
    } finally {
      this.botRigLoading = false;
    }
  }

  /** Каждый кадр для бота с моделью: выбор клипа по скорости + crossfade. */
  private stepBotLocomotion(now: number, dt: number): void {
    const p = this.root.position;
    // Кап на скачок (телепорт/первый кадр) — иначе «бег» на ровном месте.
    const inst = Math.min(12, Math.hypot(p.x - this._prevPos.x, p.z - this._prevPos.z) / Math.max(dt, 1e-3));
    this._prevPos.copyFrom(p);
    this.planarSpeed += (inst - this.planarSpeed) * Math.min(1, dt * 8);

    let want: string;
    if (now < this.swingUntil) want = "swordslash";
    else if (this.planarSpeed > 2.2) want = "run";
    else if (this.planarSpeed > 0.35) want = "walk";
    else want = "idle";
    this.animName = want;

    const k = Math.min(1, dt * 12);
    for (const [n, g] of this.botRig!.anims) {
      const target = n === this.animName ? 1 : 0;
      let w = this.animW.get(n) ?? 0;
      w += (target - w) * k;
      if (w <= 0.003) {
        w = 0;
        if (g.isPlaying && n !== this.animName) g.stop();
      } else if (!g.isPlaying) {
        g.start(n !== "swordslash", n === "swordslash" ? 1.35 : 1, g.from, g.to, false);
      }
      this.animW.set(n, w);
      g.setWeightForAllAnimatables(w);
    }
  }

  /** Полоска здоровья над головой — только пока мы с игроком в PvP. */
  private syncBar(): void {
    const show = this.pvpTarget;
    if (show && !this.bar) {
      this.bar = new HealthBar3D(this.scene, this.root, new Vector3(0, 0.5, 0), 0.5);
    }
    if (!this.bar) return;
    this.bar.setVisible(show);
    if (show) this.bar.set(this.maxHp > 0 ? Math.max(0, this.hp) / this.maxHp : 0);
  }

  /** Показываем оружие в руках союзника — по данным сервера (leftCls/…). */
  private applyGear(): void {
    if (!this.makeWeapon) return;
    this.gearL = this.fitGear("left", this.wantL, this.gearL, () => (this.gearKeyL = keyOf(this.wantL)), this.gearKeyL);
    this.gearR = this.fitGear("right", this.wantR, this.gearR, () => (this.gearKeyR = keyOf(this.wantR)), this.gearKeyR);
  }

  private fitGear(
    side: "left" | "right",
    want: readonly [string, string],
    cur: Mesh | null,
    markKey: () => void,
    curKey: string,
  ): Mesh | null {
    const key = keyOf(want);
    if (key === curKey) return cur;
    cur?.dispose();
    markKey();
    const [cls, tier] = want;
    if (cls !== "sword" && cls !== "bow" && cls !== "shield") return null;
    if (!tier) return null;

    // Бот с моделью персонажа: клип SwordSlash самодостаточен, отдельный меш
    // меча пока не вешаем (нужен подбор в кость кулака «вживую»).
    if (this.skin > 0 && this.botRig) return null;

    const mesh = this.makeWeapon!(cls as WeaponClass, tier as WeaponTier);
    mesh.isPickable = false;
    mesh.rotationQuaternion = null; // ставим углами Эйлера
    for (const c of mesh.getChildMeshes()) c.isPickable = false;

    if (this.mode === "vr") {
      const hand = side === "left" ? this.handL : this.handR;
      const slot = side === "left" ? "vrLeft" : "vrRight";
      const pl = LOADOUT.items[cls][slot];
      mesh.parent = hand ?? this.root;
      mesh.position.set(pl.pos[0], pl.pos[1], pl.pos[2]);
      mesh.rotation.set(pl.rot[0], pl.rot[1], pl.rot[2]);
      mesh.scaling.setAll(pl.scale);
    } else {
      // Плоский аватар: оружие просто держим сбоку от корпуса.
      mesh.parent = this.root;
      mesh.position.set(side === "left" ? -0.32 : 0.32, -0.35, 0.1);
      mesh.rotation.set(0, 0, side === "left" ? 0.5 : -0.5);
      mesh.scaling.setAll(0.7);
    }
    return mesh;
  }

  /** node.position (или root) + кватернион = интерполяция a->b. `isRoot` — позиция мировая. */
  private applyXf(
    node: TransformNode,
    q: Quaternion,
    a: Snap["head"],
    b: Snap["head"],
    s: number,
    isRoot: boolean,
  ): void {
    const x = a[0] + (b[0] - a[0]) * s;
    const y = a[1] + (b[1] - a[1]) * s;
    const z = a[2] + (b[2] - a[2]) * s;
    if (isRoot) {
      node.position.set(x, y, z);
    } else {
      const r = this.root.position;
      node.position.set(x - r.x, y - r.y, z - r.z);
    }
    this._qa.set(a[3], a[4], a[5], a[6]);
    this._qb.set(b[3], b[4], b[5], b[6]);
    Quaternion.SlerpToRef(this._qa, this._qb, s, q);
  }

  dispose(): void {
    this.disposed = true;
    this.speakDot?.dispose();
    this.gearL?.dispose();
    this.gearR?.dispose();
    this.bar?.dispose();
    this.botRig?.dispose();
    this.botHolder?.dispose();
    this.nameTag.dispose();
    this.root.dispose(false, true);
  }
}

/** Ключ «класс:уровень» — по нему решаем, надо ли пересобирать меш оружия. */
function keyOf(w: readonly [string, string]): string {
  return `${w[0]}:${w[1]}`;
}
