import type { Scene } from "@babylonjs/core/scene";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Vector3, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { WebXRCamera } from "@babylonjs/core/XR/webXRCamera";
import { Ray } from "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Culling/ray";
import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/discBuilder";

import { PLAYER, PLAYER_HP, TELEPORT, WORLD } from "#shared/constants";
import { emptyInput, type InputSource, type InputState } from "../input/InputSource";
import type { Progression } from "./Progression";
import { ThirdPersonCam } from "./ThirdPersonCam";
import { TP_CAM_TUNE } from "./tpCamTune";

const GROUND_SNAP = 0.2; // м, зазор до земли, при котором считаем «стоим»
const STEP_HEIGHT = 0.35; // м, высоту ниже этого можно перешагнуть
const FORWARD = new Vector3(0, 0, 1); // локальная ось «вперёд»

/**
 * Движение персонажа от первого лица. Управляется любым InputSource
 * (десктоп / тач / VR) — сам источник ввода здесь не важен.
 *
 * Коллизии — только лучами (raycast): вниз для земли, по осям X/Z для стен.
 * Просто, предсказуемо и достаточно для зоны из прямоугольных препятствий.
 */
export class PlayerController {
  readonly camera: FreeCamera;
  private readonly body: Mesh;
  private readonly scene: Scene;
  private input: InputSource | null = null;

  private yaw = 0;
  private pitch = 0;
  private verticalVelocity = 0;
  private grounded = false;

  /**
   * Камера «от третьего лица» (смартфон). null — режим от первого лица
   * (десктоп/VR). Включает Game через enableThirdPerson().
   */
  private tp: ThirdPersonCam | null = null;
  /** Сглаженная горизонтальная скорость, м/с — для выбора клипа у LocalAvatar. */
  private _planarSpeed = 0;
  private readonly _feet = new Vector3();

  /** Ввод, снятый в последнем update() — читают другие системы (бой). */
  lastInput: InputState = emptyInput();

  /** Хуки для звука/UI. Назначает Game. */
  readonly hooks: {
    step?: () => void;
    land?: (impact: number) => void;
    hurt?: (hp: number, dmg: number) => void;
    heal?: (hp: number) => void;
    respawn?: () => void;
  } = {};
  private stepDist = 0;

  hp: number = PLAYER_HP.max;
  private hurtTimer = 0; // с с последнего урона

  /** Онлайн (этап 7): HP, реген и смерть считает сервер — локально не трогаем. */
  netControlled = false;
  /** Лежит мёртвый: ввод игнорируется до возрождения. */
  dead = false;

  // --- телепорт-перемещение (VR, включает админ на весь мир) ---
  private teleportMode = false;
  private teleAimed = false; // прицел показан (стик отклонён)
  private teleValid = false; // цель годная для прыжка
  private readonly teleTarget = new Vector3();
  private teleReticle: Mesh | null = null;
  private teleportBlink = false; // одноразовый флаг: только что прыгнули

  setTeleportMode(on: boolean): void {
    if (on === this.teleportMode) return;
    this.teleportMode = on;
    if (!on) this.hideTeleportAim();
  }

  /** Game читает раз в кадр: true — сыграть блинк (был прыжок). */
  consumeTeleportBlink(): boolean {
    const b = this.teleportBlink;
    this.teleportBlink = false;
    return b;
  }

  get maxHp(): number {
    return this.prog?.maxHp ?? PLAYER_HP.max;
  }
  private get speed(): number {
    return this.prog?.moveSpeed ?? PLAYER.runSpeed;
  }

  /** Сколько секунд прошло с последнего урона. */
  get sinceHurt(): number {
    return this.hurtTimer;
  }
  private spawn = new Vector3(0, PLAYER.eyeHeight, -20);
  /** Стволы деревьев: из них игрока выталкивает наружу. */
  private obstacles: { x: number; z: number; r: number }[] = [];

  /**
   * Задать непроходимые стволы.
   *
   * Лучами тонкий ствол ловится плохо: луч идёт из центра тела, и мимо
   * ствола можно проскользнуть боком. Расталкивание по кругу и надёжнее,
   * и дешевле — лучей на это не тратим вовсе.
   */
  setObstacles(list: { x: number; z: number; r: number }[]): void {
    this.obstacles = list;
  }

  /** Вытолкнуть тело из стволов, в которые оно въехало. */
  private pushOutOfObstacles(): void {
    if (this.obstacles.length === 0) return;
    const p = this.body.position;
    for (const o of this.obstacles) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const need = o.r + PLAYER.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= need * need) continue;
      const d = Math.sqrt(d2);
      if (d < 1e-4) {
        p.x += need; // ровно в центре — сдвигаем в любую сторону
        continue;
      }
      const push = (need - d) / d;
      p.x += dx * push;
      p.z += dz * push;
    }
  }

  /** Не выпускать за край карты — там кончается земля. */
  private clampToWorld(): void {
    const lim = WORLD.size / 2 - 2;
    const p = this.body.position;
    if (p.x < -lim) p.x = -lim;
    else if (p.x > lim) p.x = lim;
    if (p.z < -lim) p.z = -lim;
    else if (p.z > lim) p.z = lim;
  }

  /** В VR камера гарнитуры парентится к этому ригу; риг мы двигаем/крутим сами. */
  private xrRig: TransformNode | null = null;
  private xrCamera: WebXRCamera | null = null;
  private readonly fwd = new Vector3();
  /** Предыдущая ЛОКАЛЬНАЯ позиция головы в риге — для учёта ходьбы по комнате. */
  private xrHeadLX = 0;
  private xrHeadLZ = 0;
  private xrHeadTracked = false;

  constructor(
    scene: Scene,
    private readonly prog?: Progression,
  ) {
    this.scene = scene;

    this.body = MeshBuilder.CreateBox("playerBody", { size: PLAYER.radius * 2 }, scene);
    this.body.isVisible = false;
    this.body.isPickable = false;
    this.body.position.set(0, PLAYER.eyeHeight, -20);

    this.camera = new FreeCamera("player", this.body.position.clone(), scene);
    this.camera.minZ = 0.1;
    this.hp = this.maxHp;
  }

  setInput(source: InputSource): void {
    this.input?.dispose();
    this.input = source;
  }

  get position(): Vector3 {
    return this.body.position;
  }

  get inVR(): boolean {
    return this.xrCamera !== null;
  }

  /** Перевести плоский режим в вид от третьего лица (только смартфон). */
  enableThirdPerson(): void {
    if (!this.tp) this.tp = new ThirdPersonCam(this.scene);
  }

  /** Сейчас управление идёт от третьего лица. */
  get thirdPerson(): boolean {
    return this.tp !== null && this.xrCamera === null;
  }

  /** Камера, которую должна рендерить сцена (в VR — гарнитуры). */
  get renderCamera(): Camera {
    if (this.xrCamera) return this.xrCamera;
    return this.tp ? this.tp.camera : this.camera;
  }

  /** Куда повёрнут персонаж (yaw в радианах). */
  get facing(): number {
    return this.yaw;
  }

  /** Сглаженная горизонтальная скорость тела, м/с. */
  get planarSpeed(): number {
    return this._planarSpeed;
  }

  /** Плавно довернуть персонажа лицом к точке (автонаводка удара). */
  faceTowards(x: number, z: number, dt: number): void {
    const t = Math.atan2(x - this.body.position.x, z - this.body.position.z);
    this.yaw = lerpAngle(this.yaw, t, Math.min(1, dt * 9));
  }

  /**
   * Позиция глаз в мире. В VR — голова гарнитуры, в плоском режиме — камера.
   * ВАЖНО: в VR плоская `camera` не обновляется, брать её globalPosition нельзя.
   */
  get eyePosition(): Vector3 {
    // В плоском режиме глаза = тело: `camera` может быть неактивной (третье
    // лицо рендерит другая), и её globalPosition тогда не освежается.
    return this.xrCamera ? this.xrCamera.globalPosition : this.body.position;
  }

  /** Направление взгляда в мире (единичное). */
  get eyeForward(): Vector3 {
    return (this.xrCamera ?? this.camera).getDirection(FORWARD);
  }

  private readonly _eyeQ = new Quaternion();
  /** Поворот головы в мире (кватернион) — для сетевого аватара. */
  get eyeRotation(): Quaternion {
    const cam = this.xrCamera ?? this.camera;
    if (cam.rotationQuaternion) return this._eyeQ.copyFrom(cam.rotationQuaternion);
    Quaternion.FromEulerVectorToRef(cam.rotation, this._eyeQ); // FreeCamera: euler -> quat
    return this._eyeQ;
  }

  /**
   * Эффекты удара без изменения HP: виньетка + хуки. Онлайн HP шлёт сервер.
   * Игрока при уроне НЕ сдвигаем — в шлеме толчок камеры дезориентирует, а
   * рассинхрон с реальным положением тела ощущается как баг.
   */
  hurtFx(amount: number, _dir?: Vector3): void {
    this.hurtTimer = 0;
    this.hooks.hurt?.(this.hp, amount);
  }

  /** Здоровье, присланное сервером. */
  setHp(hp: number): void {
    this.hp = Math.max(0, hp);
  }

  /** Возрождение по команде сервера. */
  teleportTo(x: number, y: number, z: number): void {
    this.body.position.set(x, y, z);
    this.verticalVelocity = 0;
    this.placeOnGround();
  }

  // ---- телепорт-перемещение ----

  /** Кадр в режиме телепорта: пока стик отклонён — целимся, отпустил — прыгаем. */
  private tickTeleport(sx: number, sy: number, fx: number, fz: number, pos: Vector3): void {
    const mag = Math.hypot(sx, sy);
    if (mag <= TELEPORT.armAt) {
      if (this.teleAimed && this.teleValid) this.doTeleport();
      this.hideTeleportAim();
      return;
    }
    // Мировое направление отклонения стика (та же матрица, что у скольжения).
    let dx = fz * sx + fx * sy;
    let dz = -fx * sx + fz * sy;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const push = Math.min(1, (mag - TELEPORT.armAt) / (1 - TELEPORT.armAt));
    const reach = TELEPORT.minRange + (TELEPORT.range - TELEPORT.minRange) * push;
    const tx = pos.x + dx * reach;
    const tz = pos.z + dz * reach;

    const ray = new Ray(new Vector3(tx, pos.y + 3, tz), Vector3.Down(), 60);
    const gy = this.scene.pickWithRay(ray, this.isSolid)?.pickedPoint?.y ?? null;
    const edge = WORLD.size / 2 - 1;
    let valid = gy !== null && Math.abs(tx) < edge && Math.abs(tz) < edge;
    if (valid) {
      for (const o of this.obstacles) {
        if (Math.hypot(tx - o.x, tz - o.z) < o.r + PLAYER.radius) {
          valid = false;
          break;
        }
      }
    }
    this.teleTarget.set(tx, gy ?? pos.y - PLAYER.eyeHeight, tz);
    this.teleValid = valid;
    this.teleAimed = true;
    this.showTeleReticle(valid);
  }

  private doTeleport(): void {
    const t = this.teleTarget;
    this.body.position.set(t.x, t.y + PLAYER.eyeHeight, t.z);
    this.verticalVelocity = 0;
    this.grounded = true;
    // Заново взять базу головы: иначе следующий кадр примет прыжок за
    // «шаг по комнате» и толкнёт тело.
    this.xrHeadTracked = false;
    this.teleportBlink = true;
    this.hideTeleportAim();
  }

  private showTeleReticle(valid: boolean): void {
    if (!this.teleReticle) {
      const disc = MeshBuilder.CreateDisc("teleReticle", { radius: PLAYER.radius, tessellation: 28 }, this.scene);
      disc.rotation.x = Math.PI / 2;
      disc.isPickable = false;
      const m = new StandardMaterial("teleReticleMat", this.scene);
      m.disableLighting = true;
      m.backFaceCulling = false;
      disc.material = m;
      this.teleReticle = disc;
    }
    const m = this.teleReticle.material as StandardMaterial;
    m.emissiveColor = valid ? new Color3(0.2, 0.85, 1) : new Color3(0.9, 0.25, 0.2);
    m.alpha = valid ? 0.7 : 0.4;
    this.teleReticle.position.set(this.teleTarget.x, this.teleTarget.y + 0.04, this.teleTarget.z);
    this.teleReticle.setEnabled(true);
  }

  private hideTeleportAim(): void {
    this.teleAimed = false;
    this.teleValid = false;
    this.teleReticle?.setEnabled(false);
  }

  /** Получить урон (одиночный режим). Игрока при этом не отталкиваем. */
  damage(amount: number, _dir?: Vector3): void {
    if (this.hp <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.hurtTimer = 0;
    this.hooks.hurt?.(this.hp, amount);
    if (this.hp <= 0) {
      this.hp = this.maxHp;
      this.body.position.copyFrom(this.spawn);
      this.placeOnGround();
      this.hooks.respawn?.();
    }
  }

  /** Снимок позиции и направления взгляда — для сохранения (этап 5). */
  snapshotState(): { x: number; y: number; z: number; yaw: number } {
    const p = this.body.position;
    return { x: p.x, y: p.y, z: p.z, yaw: this.yaw };
  }

  /** Восстановить позицию и yaw из сейва. */
  restoreState(s: { x: number; y: number; z: number; yaw: number }): void {
    this.body.position.set(s.x, s.y, s.z);
    this.yaw = s.yaw;
    this.pitch = 0;
    this.placeOnGround();
  }

  /** Поставить тело на поверхность в текущей точке (x, z). */
  placeOnGround(): void {
    const p = this.body.position;
    const ray = new Ray(new Vector3(p.x, 500, p.z), Vector3.Down(), 1000);
    const hit = this.scene.pickWithRay(ray, this.isSolid);
    if (hit?.pickedPoint) p.y = hit.pickedPoint.y + PLAYER.eyeHeight;
    this.verticalVelocity = 0;
  }

  /** Вход в VR: камеру гарнитуры вешаем на управляемый нами риг. */
  enterXR(xrCamera: WebXRCamera): void {
    if (!this.xrRig) this.xrRig = new TransformNode("xrRig", this.scene);
    xrCamera.parent = this.xrRig;
    this.xrCamera = xrCamera;
    this.xrHeadTracked = false;
  }

  exitXR(): void {
    if (this.xrCamera) this.xrCamera.parent = null;
    this.xrCamera = null;
  }

  /** Вызывается каждый кадр из рендер-лупа. dt — секунды. */
  update(dt: number): void {
    // Мёртвый не ходит и не бьёт — ввод глушим целиком.
    const inp = this.dead ? emptyInput() : (this.input?.sample() ?? emptyInput());
    this.lastInput = inp;
    const pos = this.body.position;
    const vr = this.xrCamera !== null;
    const tp = !vr && this.tp ? this.tp : null;

    // --- Поворот ---
    // Третье лицо: правое перетаскивание крутит ОБЗОР (камеру), не персонажа —
    // его yaw доворачивается в сторону хода ниже. Первое лицо: мышь/тач крутят
    // сам взгляд. VR: yaw — snap-turn, pitch всегда 0.
    if (tp) {
      tp.applyLook(inp.lookYaw, inp.lookPitch);
      this.pitch = 0;
    } else {
      this.yaw += inp.lookYaw;
      this.pitch = vr ? 0 : clamp(this.pitch + inp.lookPitch, -PLAYER.pitchClamp, PLAYER.pitchClamp);
    }

    // --- VR: физическая ходьба по комнате переносится в тело ---
    // Берём смещение головы в ЛОКАЛЬНЫХ осях рига (не зависит от snap-turn)
    // и поворачиваем его текущим yaw. Так поворот стиком не толкает тело вбок.
    if (vr && this.xrCamera) {
      const h = this.xrCamera.position;
      if (this.xrHeadTracked) {
        const dlx = h.x - this.xrHeadLX;
        const dlz = h.z - this.xrHeadLZ;
        const c = Math.cos(this.yaw);
        const s = Math.sin(this.yaw);
        this.moveAxis(dlx * c + dlz * s, 0);
        this.moveAxis(0, -dlx * s + dlz * c);
      }
      this.xrHeadLX = h.x;
      this.xrHeadLZ = h.z;
      this.xrHeadTracked = true;
    }

    // --- База движения: в VR — куда смотрит голова, иначе — yaw ---
    let fx: number;
    let fz: number;
    if (vr && this.xrCamera) {
      this.xrCamera.getDirectionToRef(FORWARD, this.fwd);
      const l = Math.hypot(this.fwd.x, this.fwd.z) || 1;
      fx = this.fwd.x / l;
      fz = this.fwd.z / l;
    } else if (tp) {
      // Третье лицо: стик задаёт направление ОТНОСИТЕЛЬНО камеры.
      fx = Math.sin(tp.yaw);
      fz = Math.cos(tp.yaw);
    } else {
      fx = Math.sin(this.yaw);
      fz = Math.cos(this.yaw);
    }

    // --- Горизонталь по осям (естественное скольжение вдоль стен) ---
    let mx = fz * inp.moveX + fx * inp.moveY;
    let mz = -fx * inp.moveX + fz * inp.moveY;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const moving = len > 0.05;
    // Третье лицо: персонаж доворачивается лицом туда, куда бежит.
    if (tp && moving) {
      this.yaw = lerpAngle(this.yaw, Math.atan2(mx, mz), Math.min(1, dt * TP_CAM_TUNE.turnRate));
    }
    const speed = this.speed * dt;
    const bx = pos.x;
    const bz = pos.z;
    if (this.teleportMode && vr) {
      // Стик не скользит — целимся и прыгаем (см. tickTeleport).
      this.tickTeleport(inp.moveX, inp.moveY, fx, fz, pos);
    } else {
      this.hideTeleportAim();
      this.moveAxis(mx * speed, 0);
      this.moveAxis(0, mz * speed);
    }

    // --- Шаги (звук) ---
    if (this.grounded) {
      this.stepDist += Math.hypot(pos.x - bx, pos.z - bz);
      if (this.stepDist >= PLAYER.strideLength) {
        this.stepDist = 0;
        this.hooks.step?.();
      }
    } else {
      this.stepDist = PLAYER.strideLength * 0.6; // приземлился — шаг почти сразу
    }

    this.pushOutOfObstacles();
    this.clampToWorld();

    // Сглаженная горизонтальная скорость — по фактическому смещению тела.
    const moved = Math.hypot(pos.x - bx, pos.z - bz) / Math.max(dt, 1e-3);
    this._planarSpeed += (moved - this._planarSpeed) * Math.min(1, dt * 8);

    // --- Земля под ногами (гравитация есть, прыжка нет) ---
    const groundY = this.rayDown();

    if (this.grounded && this.verticalVelocity <= 0) {
      if (groundY !== null) pos.y = groundY + PLAYER.eyeHeight;
      this.verticalVelocity = 0;
    } else {
      this.verticalVelocity -= PLAYER.gravity * dt;
      pos.y += this.verticalVelocity * dt;
      if (groundY !== null && pos.y < groundY + PLAYER.eyeHeight) {
        pos.y = groundY + PLAYER.eyeHeight;
        if (this.verticalVelocity < -3) this.hooks.land?.(-this.verticalVelocity);
        this.verticalVelocity = 0;
      }
    }

    const gapNow = groundY === null ? Infinity : pos.y - PLAYER.eyeHeight - groundY;
    if (this.verticalVelocity <= 0) this.grounded = gapNow <= GROUND_SNAP;

    // --- Камера следует за телом ---
    if (vr && this.xrRig && this.xrCamera) {
      // Голова должна оказаться ровно над телом. Компенсируем комнатное
      // смещение головы: сдвигаем риг на -(смещение головы в мире).
      const h = this.xrCamera.position;
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      const hwx = h.x * c + h.z * s;
      const hwz = -h.x * s + h.z * c;
      this.xrRig.position.set(pos.x - hwx, pos.y - PLAYER.eyeHeight, pos.z - hwz);
      this.xrRig.rotation.set(0, this.yaw, 0);
      this.xrRig.computeWorldMatrix(true);
    } else {
      this.camera.position.copyFrom(pos);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      if (tp) {
        // `camera` — теперь «глаза» для боя/сети/звука, но не рендерится.
        // Освежаем её матрицы вручную, дальше двигаем орбитальную камеру.
        this.camera.getViewMatrix(true);
        // Камера сама заезжает за спину ТОЛЬКО когда игрок бежит примерно
        // «от камеры» (стик вперёд). При боковом стике — нет: иначе база
        // движения крутится вслед за камерой и получается спираль на месте.
        const dragging = Math.abs(inp.lookYaw) > 1e-6 || Math.abs(inp.lookPitch) > 1e-6;
        const mostlyForward = inp.moveY > 0.2 && Math.abs(inp.moveX) < 0.4;
        if (!dragging && moving && mostlyForward) {
          tp.followBehind(this.yaw, Math.min(1, dt * TP_CAM_TUNE.followRate));
        }
        this._feet.set(pos.x, pos.y - PLAYER.eyeHeight, pos.z);
        tp.update(this._feet, this.isSolid, this.scene);
      }
    }

    // --- Реген здоровья после паузы без урона (офлайн; онлайн считает сервер) ---
    this.hurtTimer += dt;
    if (!this.netControlled && this.hp > 0 && this.hp < this.maxHp && this.hurtTimer > PLAYER_HP.regenDelay) {
      this.hp = Math.min(this.maxHp, this.hp + PLAYER_HP.regen * dt);
      this.hooks.heal?.(this.hp);
    }

    // TODO(этап 7): primaryAction / interact -> отправка на сервер.
    void inp.primaryAction;
    void inp.interact;
  }

  /** Движение по одной горизонтальной оси с упором в стены (3 луча по высоте). */
  private moveAxis(dx: number, dz: number): void {
    const dist = Math.abs(dx) + Math.abs(dz);
    if (dist < 1e-5) return;
    const pos = this.body.position;
    const dir = new Vector3(Math.sign(dx), 0, Math.sign(dz));
    const feetY = pos.y - PLAYER.eyeHeight;

    let allowed = dist;
    for (const h of [STEP_HEIGHT + 0.05, PLAYER.eyeHeight * 0.6, PLAYER.eyeHeight - 0.15]) {
      const ray = new Ray(new Vector3(pos.x, feetY + h, pos.z), dir, dist + PLAYER.radius);
      const hit = this.scene.pickWithRay(ray, this.isSolid);
      if (hit?.hit && hit.distance < Infinity) {
        allowed = Math.min(allowed, Math.max(0, hit.distance - PLAYER.radius));
      }
    }
    pos.x += dir.x * allowed;
    pos.z += dir.z * allowed;
  }

  /** Y поверхности под телом или null. */
  private rayDown(): number | null {
    const pos = this.body.position;
    const ray = new Ray(pos.clone(), Vector3.Down(), PLAYER.eyeHeight + 0.6);
    const hit = this.scene.pickWithRay(ray, this.isSolid);
    return hit?.pickedPoint?.y ?? null;
  }

  private isSolid = (m: AbstractMesh): boolean =>
    m.isPickable && m.checkCollisions && m !== this.body;

  dispose(): void {
    this.input?.dispose();
    this.teleReticle?.material?.dispose();
    this.teleReticle?.dispose();
    this.tp?.camera.dispose();
    this.body.dispose();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Интерполяция углов по кратчайшей дуге (радианы). */
function lerpAngle(a: number, b: number, t: number): number {
  const d = (((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
