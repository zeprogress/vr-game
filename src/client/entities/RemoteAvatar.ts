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
import { SpeechBubble } from "../ui/SpeechBubble";
import { HealthBar3D } from "../ui/HealthBar3D";
import type { Hittable } from "../combat/Hittable";
import { makeBotBody } from "./botModels";
import { loadRig, recolorCharacter, BOT_SKIN_MODELS, type RigInstance } from "../world/models";
import { BlobShadow } from "../world/blobShadow";
import { PLAYER } from "#shared/constants";

/** Доворот модели бота, если её «перёд» смотрит не в +Z. Подбор: `?byaw=<рад>`. */
const BOT_MODEL_YAW = (() => {
  const p = new URLSearchParams(location.search);
  const v = Number(p.get("byaw"));
  return p.has("byaw") && Number.isFinite(v) ? v : 0;
})();
/**
 * Единый масштаб персонажа. Не нормируем по высоте: у ведьмы/мага шляпа, у
 * гоблина низкий рост — пусть так и будет, естественный разброс. 0.78 —
 * это ×1.5 от исходных 0.52. Подбор вживую: `?botscale=0.9`.
 */
const BOT_RIG_SCALE = (() => {
  const v = Number(new URLSearchParams(location.search).get("botscale"));
  return Number.isFinite(v) && v > 0.1 && v < 4 ? v : 0.78;
})();
/** Масштаб заглушки — вровень с ригом (заглушка ~2.1 м «нативной», риг ~3.6). */
const BOT_STUB_SCALE = BOT_RIG_SCALE * 1.7;
/** Ноги модели ниже локального нуля аватара (ноль = уровень глаз ≈ 1.7 м). */
const BOT_FEET_Y = -1.68;
/**
 * Хват оружия у бота. Замер по скелету пака: направление локоть→кулак
 * совпадает с локальной осью Y кости `Fist.*` — то есть Y идёт вдоль
 * предплечья наружу. Клинок меча в модели тоже смотрит по +Y
 * (COMBAT.swordTipLocal), поэтому меч садится в кулак БЕЗ доворота.
 *
 * Масштаб: кость наследует масштаб рига (BOT_RIG_SCALE), поэтому здесь он
 * обратный с поправкой на рост персонажа — иначе меч выглядит игрушечным
 * в руке двухметрового рыцаря.
 */
const BOT_SWORD = { pos: [0, 0.05, 0] as const, rot: [0, 0, 0] as const, scale: 1.7 };
/**
 * Щит держат поперёк предплечья, а не вдоль: его лицевая сторона смотрит
 * по +Y модели (см. shield.flat в LOADOUT — там разворот на π/2 по X кладёт
 * её вперёд). Тем же разворотом уводим лицо щита с оси предплечья.
 */
const BOT_SHIELD = { pos: [0, 0.05, 0] as const, rot: [Math.PI / 2, 0, 0] as const, scale: 1.7 };
/** Радиус пятна-тени под аватаром, м. */
const SHADOW_RADIUS = 0.5;
/** Во сколько раз плашка бота крупнее обычной — её читают со стрима издалека. */
const BOT_TAG_SCALE = 2.1;
/**
 * Постоянная сглаживания позиции бота, с. Симуляция сервера и рассылка
 * патчей у Colyseus идут разными таймерами и дрейфуют: часть патчей ловит
 * ноль шагов симуляции, часть — два. Снапшот с двойным перемещением
 * интерполятор раскладывает на один ровный интервал сетки, и бот прыгает
 * вперёд. Фильтр съедает эти ступеньки ценой отставания ~v*tau (на бегу это
 * около 30 см — для чужой модели незаметно).
 */
const BOT_POS_TAU = 0.1;
/** Скачок больше этого — телепорт (респавн), фильтр не тянем, ставим сразу. */
const BOT_POS_SNAP = 5;

export type MakeWeapon = (cls: WeaponClass, tier: WeaponTier) => Mesh;

const FWD_Z = new Vector3(0, 0, 1);

/** Рендерим на N мс в прошлом — между двумя пришедшими снапшотами. Запас в
 *  ~2.5 серверных тика: одна опоздавшая пачка не оголяет буфер (иначе рывок). */
const INTERP_DELAY = 140;
/** Если свежий снапшот старше — держим позу (не экстраполируем). */
const HOLD_AFTER = 300;
const BUFFER_MS = 700;

/** Клипы модели бота, которые реально используем (в паке их больше). */
const BOT_CLIPS = ["idle", "walk", "run", "swordslash", "death"] as const;

interface Snap {
  t: number;
  mode: PlayerMode;
  head: number[]; // 7: x y z qx qy qz qw
  handL: number[];
  handR: number[];
}

function writeXf(d: number[], x: Xf): void {
  d[0] = x.x;
  d[1] = x.y;
  d[2] = x.z;
  d[3] = x.qx;
  d[4] = x.qy;
  d[5] = x.qz;
  d[6] = x.qw;
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
  private bubble: SpeechBubble | null = null;
  /** Пятно-тень под ногами: без неё модель читается как парящая. */
  private readonly shadow: BlobShadow;
  private head!: Mesh;
  private handL: Mesh | null = null;
  private handR: Mesh | null = null;
  private capsule: Mesh | null = null;
  private botBody: TransformNode | null = null;
  private botRig: RigInstance | null = null;
  private botHolder: TransformNode | null = null;
  /** Кости кулаков рига — в них садится оружие бота. */
  private botFistR: TransformNode | null = null;
  private botFistL: TransformNode | null = null;
  private botRigLoading = false;
  private botRigWant = 0; // какой skin должен быть на модели (0 — нет)
  private builtRigSkin = 0; // какой skin уже собран
  private skin = 0;
  private builtSkin = -1;
  private mode: PlayerMode | null = null;

  // Анимации модели бота (crossfade по весам).
  private readonly animW = new Map<string, number>();
  private planarSpeed = 0;
  /** Текущий режим ходьбы — для гистерезиса порогов (иначе клип щёлкает). */
  private locoRun = false;
  private locoMove = false;
  private readonly _smoothPos = new Vector3();
  private smoothInit = false;
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
  /** Отработавшие снапшоты возвращаем сюда — не мусорим каждый тик. */
  private readonly snapPool: Snap[] = [];
  private readonly _qa = new Quaternion();
  private readonly _qb = new Quaternion();
  /** Оценка реального интервала между снапшотами (ЕМА) и сырое время предыдущего. */
  private snapDt = 55;
  private lastPushRaw = 0;
  private deadAnim = false;

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

    this.shadow = new BlobShadow(scene, id);
    this.nameTag = new NameTag(scene, this.root, new Vector3(0, 0.42, 0), nick, null);
    this.setMode(mode);
  }

  /** Реплика хозяина бота из чата канала — облачко над головой (Ф10). */
  say(text: string): void {
    if (!this.bubble) {
      this.bubble = new SpeechBubble(this.scene, this.root, this.bubbleY);
    }
    this.bubble.show(text);
  }

  /** Высота облачка: чуть выше плашки с ником. */
  private bubbleY = 1.5;

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
    this.botFistR = this.botFistL = null;
    this.builtRigSkin = 0;
    this.smoothInit = false;
    this.animW.clear();
    this.deadAnim = false;
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
      this.botBody.scaling.setAll(BOT_STUB_SCALE);
      // Заглушка сделана «ногами на -1.7»; после масштаба возвращаем их туда.
      this.botBody.position.y = 1.7 * (BOT_STUB_SCALE - 1);
      // Пустая «голова» — держатель для eyeForward / NameTag якоря.
      this.head = MeshBuilder.CreateBox("botHeadAnchor", { size: 0.01 }, this.scene);
      this.head.parent = this.botBody;
      this.head.isVisible = false;
      // Модельки бота выше «головы» плоского аватара — поднимаем плашку
      // (точное значение под рост модели ставит loadBotRig) и делаем крупнее.
      this.nameTag.setScale(BOT_TAG_SCALE);
      this.nameTag.setAnchorY(1.5 * BOT_STUB_SCALE);
      this.botRigWant = this.skin;
      void this.loadBotRig();
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

  /** Это бот зрителя (Ф10) с моделью персонажа. */
  get isBot(): boolean {
    return this.skin > 0;
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
    let last: Snap | undefined = this.buf[this.buf.length - 1];
    const h = p.head;
    // Дедуп без аллокации: сервер шлёт ~18 Гц, кадров больше — не копим одинаковое.
    if (
      last &&
      last.mode === p.mode &&
      Math.abs(h.x - last.head[0]) < 1e-4 &&
      Math.abs(h.y - last.head[1]) < 1e-4 &&
      Math.abs(h.z - last.head[2]) < 1e-4 &&
      Math.abs(h.qx - last.head[3]) < 1e-4 &&
      Math.abs(h.qy - last.head[4]) < 1e-4 &&
      Math.abs(h.qz - last.head[5]) < 1e-4 &&
      Math.abs(h.qw - last.head[6]) < 1e-4
    ) {
      return;
    }
    // Телепорт (респавн) — не тащим модель интерполяцией через всю карту.
    if (last && (Math.abs(h.x - last.head[0]) > 8 || Math.abs(h.z - last.head[2]) > 8)) {
      for (const old of this.buf) this.snapPool.push(old);
      this.buf.length = 0;
      last = undefined;
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

    const s = this.snapPool.pop() ?? {
      t: 0,
      mode: "flat" as PlayerMode,
      head: new Array<number>(7).fill(0),
      handL: new Array<number>(7).fill(0),
      handR: new Array<number>(7).fill(0),
    };
    s.t = t;
    s.mode = p.mode;
    writeXf(s.head, p.head);
    writeXf(s.handL, p.handL);
    writeXf(s.handR, p.handR);
    this.buf.push(s);
    while (this.buf.length > 2 && this.buf[0].t < now - BUFFER_MS) {
      const old = this.buf.shift();
      if (old) this.snapPool.push(old);
    }
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
    this.bubble?.update(dt);
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
      this.smoothBotPos(dt);
      if (this.botRig) this.stepBotLocomotion(now, dt);
      else this.animateSwing(now);
    } else {
      this.applyXf(this.root, this.head.rotationQuaternion!, a.head, b.head, s, true);
      if (this.mode === "vr") {
        this.applyXf(this.handL!, this.handL!.rotationQuaternion!, a.handL, b.handL, s, false);
        this.applyXf(this.handR!, this.handR!.rotationQuaternion!, a.handR, b.handR, s, false);
      }
    }
    // Тень — от ног: корпус аватара стоит на уровне глаз.
    const p = this.root.position;
    this.shadow.setEnabled(!this.dead);
    if (!this.dead) this.shadow.place(p.x, p.y - PLAYER.eyeHeight, p.z, SHADOW_RADIUS);
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

  /**
   * Подгрузить персонажа для бота (skin = this.botRigWant) и заменить им
   * заглушку / прежнюю модель. Если skin сменился во время загрузки (команда
   * `!skin` в чате) — грузим заново.
   */
  private async loadBotRig(): Promise<void> {
    if (this.botRigLoading) return; // уже крутится — подхватит новый botRigWant сам
    this.botRigLoading = true;
    try {
      while (!this.disposed && this.botRigWant > 0 && this.builtRigSkin !== this.botRigWant) {
        const want = this.botRigWant;
        const model = BOT_SKIN_MODELS[(want - 1) % BOT_SKIN_MODELS.length];
        let make: () => RigInstance;
        try {
          make = await loadRig(this.scene, model);
        } catch {
          this.builtRigSkin = want; // модель не пришла — оставляем заглушку, не долбим
          continue;
        }
        if (this.disposed || this.botRigWant !== want) continue; // skin сменился — заново
        const rig = make();

        // Прежняя модель (смена скина) — снять.
        this.botRig?.dispose();
        this.botHolder?.dispose();
        this.botRig = this.botHolder = null;

        // Обёртка: масштаб + доворот держим здесь, модель не трогаем.
        const holder = new TransformNode(`botModel_${this.id}`, this.scene);
        holder.parent = this.root;
        holder.rotationQuaternion = Quaternion.RotationYawPitchRoll(BOT_MODEL_YAW, 0, 0);
        holder.position.set(0, BOT_FEET_Y, 0);
        rig.root.parent = holder;
        rig.root.position.setAll(0);
        holder.scaling.setAll(BOT_RIG_SCALE);

        recolorCharacter(rig.root);
        for (const m of rig.meshes) m.isPickable = false;

        // Все клипы в покой, кроме idle — его запускаем сразу, чтобы модель не
        // мелькнула в T-позе. Дальше веса гоняет stepBotLocomotion().
        for (const g of rig.anims.values()) g.stop();
        for (const n of BOT_CLIPS) this.animW.set(n, n === "idle" ? 1 : 0);
        const idle = rig.anims.get("idle");
        idle?.start(true, 1, idle.from, idle.to, false);
        idle?.setWeightForAllAnimatables(1);
        this.deadAnim = false;

        // Сносим заглушку, перецепляем якорь головы.
        this.botBody?.dispose(false, true);
        this.botBody = null;
        this.head.dispose();
        this.head = MeshBuilder.CreateBox("botHeadAnchor", { size: 0.01 }, this.scene);
        this.head.parent = holder;
        this.head.position.set(0, rig.nativeHeight * 0.82, 0);
        this.head.rotationQuaternion = Quaternion.Identity();
        this.head.isVisible = false;
        this.head.isPickable = false;
        // Плашка — точно над макушкой конкретной модели, облачко — над плашкой.
        const tagY = BOT_FEET_Y + rig.nativeHeight * BOT_RIG_SCALE + 0.3;
        this.nameTag.setAnchorY(tagY);
        this.bubbleY = tagY + 1.25; // над увеличенной плашкой
        this.bubble?.setAnchorY(this.bubbleY);

        const bone = (n: string): TransformNode | null =>
          (rig.root.getDescendants(false).find((d) => d.name === n) as TransformNode | undefined) ??
          null;
        this.botFistR = bone("Fist.R");
        this.botFistL = bone("Fist.L");

        this._prevPos.copyFrom(this.root.position); // без ложного «бега» в первый кадр
        this.botHolder = holder;
        this.botRig = rig;
        this.builtRigSkin = want;
        this.gearKeyR = this.gearKeyL = ""; // кости кулаков появились — пересобрать оружие в них
      }
    } finally {
      this.botRigLoading = false;
    }
  }

  /** Съедает ступеньки в позиции бота (см. BOT_POS_TAU). */
  private smoothBotPos(dt: number): void {
    const p = this.root.position;
    if (!this.smoothInit) {
      this._smoothPos.copyFrom(p);
      this.smoothInit = true;
      return;
    }
    const jump = Math.hypot(p.x - this._smoothPos.x, p.z - this._smoothPos.z);
    if (jump > BOT_POS_SNAP) {
      this._smoothPos.copyFrom(p); // респавн — догонять нечего
      return;
    }
    const k = 1 - Math.exp(-dt / BOT_POS_TAU);
    this._smoothPos.x += (p.x - this._smoothPos.x) * k;
    this._smoothPos.y += (p.y - this._smoothPos.y) * k;
    this._smoothPos.z += (p.z - this._smoothPos.z) * k;
    p.copyFrom(this._smoothPos);
  }

  /** Каждый кадр для бота с моделью: выбор клипа по скорости + crossfade. */
  private stepBotLocomotion(now: number, dt: number): void {
    const rig = this.botRig!;

    // Смерть — приоритет: клип один раз, застываем на последнем кадре.
    // Нет клипа в паке — валим модель набок.
    if (this.dead) {
      if (!this.deadAnim) {
        this.deadAnim = true;
        for (const n of BOT_CLIPS) {
          if (n === "death") continue;
          rig.anims.get(n)?.stop();
          this.animW.set(n, 0);
        }
        const d = rig.anims.get("death");
        if (d) {
          d.start(false, 1, d.from, d.to, false);
          d.setWeightForAllAnimatables(1);
          this.animW.set("death", 1);
        } else if (this.botHolder) {
          this.botHolder.rotation.x = -Math.PI / 2;
          this.botHolder.position.set(0, BOT_FEET_Y + 0.15, 0);
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
      if (this.botHolder) {
        this.botHolder.rotation.x = 0;
        this.botHolder.position.set(0, BOT_FEET_Y, 0);
      }
      this._prevPos.copyFrom(this.root.position);
    }

    const p = this.root.position;
    // Кап на скачок (телепорт/первый кадр) — иначе «бег» на ровном месте.
    const inst = Math.min(12, Math.hypot(p.x - this._prevPos.x, p.z - this._prevPos.z) / Math.max(dt, 1e-3));
    this._prevPos.copyFrom(p);
    this.planarSpeed += (inst - this.planarSpeed) * Math.min(1, dt * 8);

    // Пороги с гистерезисом: у бота скорость гуляет около границы (тормозит
    // у моба, толкается с соседями), и на одном пороге клип щёлкал бег↔шаг
    // каждый кадр — это читалось как рывок.
    const run = this.locoRun ? this.planarSpeed > 1.8 : this.planarSpeed > 2.4;
    const move = this.locoMove ? this.planarSpeed > 0.25 : this.planarSpeed > 0.45;
    this.locoRun = run;
    this.locoMove = move;

    let want: string;
    if (now < this.swingUntil) want = "swordslash";
    else if (run) want = "run";
    else if (move) want = "walk";
    else want = "idle";

    const k = Math.min(1, dt * 12);
    for (const n of BOT_CLIPS) {
      if (n === "death") continue;
      const g = rig.anims.get(n);
      if (!g) continue;
      const target = n === want ? 1 : 0;
      let w = this.animW.get(n) ?? 0;
      w += (target - w) * k;
      if (w <= 0.003) {
        w = 0;
        if (g.isPlaying && n !== want) g.stop();
      } else if (!g.isPlaying && n !== "swordslash") {
        // swordslash перезапускается из playSwing(); в цикле его не гоняем.
        g.start(true, 1, g.from, g.to, false);
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

    const mesh = this.makeWeapon!(cls as WeaponClass, tier as WeaponTier);
    mesh.isPickable = false;
    mesh.rotationQuaternion = null; // ставим углами Эйлера
    for (const c of mesh.getChildMeshes()) c.isPickable = false;

    // Бот с моделью персонажа: оружие садится в кость кулака и ездит с рукой
    // во всех клипах, включая SwordSlash.
    if (this.skin > 0 && this.botRig) {
      const fist = side === "left" ? this.botFistL : this.botFistR;
      if (!fist) {
        mesh.dispose();
        return null;
      }
      const g = side === "left" ? BOT_SHIELD : BOT_SWORD;
      mesh.parent = fist;
      mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
      mesh.rotation.set(g.rot[0], g.rot[1], g.rot[2]);
      mesh.scaling.setAll(g.scale);
      return mesh;
    }

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
    this.shadow.dispose();
    this.speakDot?.dispose();
    this.gearL?.dispose();
    this.gearR?.dispose();
    this.bar?.dispose();
    this.bubble?.dispose();
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
