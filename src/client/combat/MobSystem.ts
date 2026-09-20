import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import "@babylonjs/core/Meshes/Builders/sphereBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Room } from "colyseus.js";

import { SPITTER, SPITTER_CFG, BOSS_CFG } from "#shared/constants";
import type { MobState, ZoneState } from "#shared/net/schema";
import { Mob } from "./Mob";
import { Dummy } from "./Dummy";
import { createArrowProto } from "./Arrow";
import type { Hittable, HitReporter } from "./Hittable";
import type { Sfx } from "../audio/Sfx";

/**
 * Плевок летит на клиенте по собственной баллистике и мягко подтягивается
 * к серверной позиции. Иначе он двигался бы рывками — патчи приходят 20 раз
 * в секунду, а кадров в 3-4 раза больше.
 */
interface BallView {
  mesh: Mesh;
  pos: Vector3;
  vel: Vector3;
  /** Последняя скорость, пришедшая с сервера — чтобы не сбрасывать свою гравитацию каждый кадр. */
  srvVy: number;
}

/** Огненный снаряд игрока: раскалённое ядро + аддитивный ореол-пламя. */
interface BoltView {
  core: Mesh;
  glow: Mesh;
  pos: Vector3;
  vel: Vector3;
  r: number;
  age: number;
  /** kind 1 — стрела (лук бота): вместо огня рисуем древко по вектору скорости. */
  arrow?: Mesh;
}

/** Одна искра-уголёк, разлетающаяся из эпицентра взрыва (см. Burst.sparks). */
interface Spark {
  mesh: Mesh;
  dir: Vector3;
  speed: number;
}

/** Вспышка на месте разрыва снаряда: раздувается и гаснет. */
interface Burst {
  flash: Mesh;
  ring: Mesh;
  sparks: Spark[];
  pos: Vector3;
  age: number;
  life: number;
  peak: number;
}

/** VR: сколько ближайших мобов рисуем и сколько из них с плашкой имени. */
const VR_MAX_MOBS = 20;
const VR_MAX_UI = 5;

/** Ленивые виды мобов: создаём ближе SPAWN_R, сносим дальше DESPAWN_R (м); за проход — не больше MAT_PER_PASS. */
const MOB_SPAWN_R = 150;
const MOB_DESPAWN_R = 185;
const MAT_PER_PASS = 4;
/** Мобов дальше (м) обновляем не каждый кадр, а ~20 раз в секунду. */
const MOB_FAR_UPDATE_R = 50;

/**
 * Мобы, куклы и плевки — ВИД поверх состояния сервера (этап 6).
 * Держит `targets` (общий массив для CombatSystem) в актуальном виде.
 */
export class NetMobs {
  private room: Room<ZoneState> | null = null;
  private readonly mobs = new Map<string, Mob>();
  /** VR: id мобов, которых рисуем в этом кадре (ближайшие) и у которых показываем плашку. */
  private readonly vrDrawSet = new Set<string>();
  private readonly vrUiSet = new Set<string>();
  private rankT = 0;
  private readonly dummies = new Map<string, Dummy>();
  private readonly balls = new Map<string, BallView>();
  private readonly ballProto: Mesh; // плевок плевуна
  private readonly ballProtoBoss: Mesh; // плевок босса
  private readonly bolts = new Map<string, BoltView>();
  private readonly boltCoreProto: Mesh;
  private readonly boltGlowProto: Mesh;
  private arrowProto: Mesh | null = null;
  /** Смартфон: снаряды крупнее — на маленьком экране их не видно. */
  boltViewScale = 1;
  private readonly burstFlashProto: Mesh;
  private readonly burstRingProto: Mesh;
  private readonly burstSparkProto: Mesh;
  private readonly bursts: Burst[] = [];
  private burstSeq = 0;
  /** Ночная подсветка от огнешара — позиция и сила. Обновляется в update(). */
  private readonly fireLightPos = new Vector3();
  private fireLightPower = 0;
  fireLight(): { pos: Vector3; power: number } | null {
    return this.fireLightPower > 0.01 ? { pos: this.fireLightPos, power: this.fireLightPower } : null;
  }

  constructor(
    private readonly scene: Scene,
    private readonly sfx: Sfx,
    /** Общий массив целей — тот же, что получил CombatSystem. */
    private readonly targets: Hittable[],
    private readonly report: HitReporter,
    /** true — облегчённый вид мобов: без плашки, HP-полоски, ран; глаза остаются (слабый GPU). */
    private readonly leanMobs = false,
    /** Множитель плашек мобов (смартфон — 2). */
    private readonly mobUiScale = 1,
  ) {
    // Плевок в цвет своего моба, полупрозрачный.
    const spitBall = (name: string, tint: readonly [number, number, number]): Mesh => {
      const mat = new StandardMaterial(`${name}Mat`, scene);
      mat.diffuseColor = new Color3(tint[0], tint[1], tint[2]);
      mat.emissiveColor = new Color3(tint[0] * 0.35, tint[1] * 0.35, tint[2] * 0.35);
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = 0.62;
      mat.backFaceCulling = true;
      const m = MeshBuilder.CreateSphere(name, { diameter: SPITTER.ballRadius * 2, segments: 6 }, scene);
      m.material = mat;
      m.isPickable = false;
      m.setEnabled(false);
      return m;
    };
    this.ballProto = spitBall("spitBall", SPITTER_CFG.tint);
    this.ballProtoBoss = spitBall("spitBallBoss", BOSS_CFG.tint);

    // Огненный снаряд: раскалённое ядро (диаметр 1 — масштабируем под радиус).
    const coreMat = new StandardMaterial("boltCoreMat", scene);
    coreMat.diffuseColor = new Color3(0.05, 0.02, 0);
    coreMat.emissiveColor = new Color3(1, 0.62, 0.18);
    coreMat.specularColor = new Color3(0, 0, 0);
    coreMat.disableLighting = true;
    coreMat.alpha = 0.9;
    coreMat.disableDepthWrite = true;
    this.boltCoreProto = MeshBuilder.CreateSphere("boltCore", { diameter: 1, segments: 8 }, scene);
    this.boltCoreProto.material = coreMat;
    this.boltCoreProto.isPickable = false;
    this.boltCoreProto.setEnabled(false);

    // Ореол пламени — аддитивный билборд.
    const glowMat = new StandardMaterial("boltGlowMat", scene);
    glowMat.emissiveColor = new Color3(1, 0.4, 0.08);
    glowMat.diffuseColor = new Color3(0, 0, 0);
    glowMat.specularColor = new Color3(0, 0, 0);
    glowMat.disableLighting = true;
    glowMat.alphaMode = Constants.ALPHA_ADD;
    glowMat.disableDepthWrite = true;
    glowMat.alpha = 0.5;
    this.boltGlowProto = MeshBuilder.CreatePlane("boltGlow", { size: 1 }, scene);
    this.boltGlowProto.material = glowMat;
    this.boltGlowProto.isPickable = false;
    this.boltGlowProto.setEnabled(false);

    // Вспышка попадания: раньше плоско залитая сфера (силуэт без градиента —
    // выглядела скорее шариком, чем огнём). Теперь билборд с радиальным
    // градиентом (белое-горячее ядро → жёлтый → оранжевый край) — читается
    // как настоящий клубок пламени. Обычное альфа-смешивание (не аддитивное)
    // — иначе на светлом небе огонь не виден.
    const flashMat = new StandardMaterial("burstFlashMat", scene);
    flashMat.diffuseColor = new Color3(0, 0, 0);
    flashMat.specularColor = new Color3(0, 0, 0);
    flashMat.disableLighting = true;
    flashMat.alphaMode = Constants.ALPHA_COMBINE;
    flashMat.disableDepthWrite = true;
    flashMat.backFaceCulling = false;
    const flashTex = new DynamicTexture("burstFlashTex", { width: 128, height: 128 }, scene, false);
    const fc = flashTex.getContext() as unknown as CanvasRenderingContext2D;
    const fg = fc.createRadialGradient(64, 64, 0, 64, 64, 64);
    fg.addColorStop(0.0, "rgba(255,255,250,1)");
    fg.addColorStop(0.35, "rgba(255,225,150,0.95)");
    fg.addColorStop(0.65, "rgba(255,150,60,0.7)");
    fg.addColorStop(1.0, "rgba(255,90,30,0)");
    fc.fillStyle = fg;
    fc.fillRect(0, 0, 128, 128);
    flashTex.hasAlpha = true;
    flashTex.update();
    flashMat.emissiveTexture = flashTex;
    flashMat.opacityTexture = flashTex;
    this.burstFlashProto = MeshBuilder.CreatePlane("burstFlash", { size: 1 }, scene);
    this.burstFlashProto.material = flashMat;
    this.burstFlashProto.isPickable = false;
    this.burstFlashProto.setEnabled(false);

    const ringMat = new StandardMaterial("burstRingMat", scene);
    ringMat.emissiveColor = new Color3(1, 0.42, 0.1);
    ringMat.diffuseColor = new Color3(0, 0, 0);
    ringMat.specularColor = new Color3(0, 0, 0);
    ringMat.disableLighting = true;
    ringMat.alphaMode = Constants.ALPHA_COMBINE;
    ringMat.disableDepthWrite = true;
    ringMat.backFaceCulling = false;
    // Круглое кольцо, а не квадрат: плоскость без текстуры красилась ровной
    // заливкой на всю карту — виден был оранжевый КВАДРАТ. Даём радиальный
    // градиент и в emissive, и в opacity (diffuse при disableLighting не
    // работает — те же грабли, что были у блика костра).
    const ringTex = new DynamicTexture("burstRingTex", { width: 128, height: 128 }, scene, false);
    const rc = ringTex.getContext() as unknown as CanvasRenderingContext2D;
    const g = rc.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0.0, "rgba(255,255,255,0.05)");
    g.addColorStop(0.55, "rgba(255,255,255,0.45)");
    g.addColorStop(0.82, "rgba(255,255,255,1)");
    g.addColorStop(1.0, "rgba(255,255,255,0)");
    rc.fillStyle = g;
    rc.fillRect(0, 0, 128, 128);
    ringTex.hasAlpha = true;
    ringTex.update();
    ringMat.emissiveTexture = ringTex;
    ringMat.opacityTexture = ringTex;
    this.burstRingProto = MeshBuilder.CreatePlane("burstRing", { size: 1 }, scene);
    this.burstRingProto.material = ringMat;
    this.burstRingProto.isPickable = false;
    this.burstRingProto.setEnabled(false);

    // Искры-угольки: маленькие яркие квадратики, разлетающиеся из эпицентра —
    // без них раздувающийся шар+кольцо читался слишком гладко и "не заметно
    // менялся" на глаз (было лишь чуть крупнее). Общий материал на все искры.
    const sparkMat = new StandardMaterial("burstSparkMat", scene);
    sparkMat.emissiveColor = new Color3(1, 0.85, 0.4);
    sparkMat.diffuseColor = new Color3(0, 0, 0);
    sparkMat.specularColor = new Color3(0, 0, 0);
    sparkMat.disableLighting = true;
    sparkMat.alphaMode = Constants.ALPHA_ADD;
    sparkMat.disableDepthWrite = true;
    sparkMat.backFaceCulling = false;
    this.burstSparkProto = MeshBuilder.CreatePlane("burstSpark", { size: 1 }, scene);
    this.burstSparkProto.material = sparkMat;
    this.burstSparkProto.isPickable = false;
    this.burstSparkProto.setEnabled(false);
  }

  /** Разрыв снаряда: `hit` — попал по цели (ярче, со звуком), иначе — угас. */
  private spawnBurst(pos: Vector3, radius: number, hit: boolean): void {
    if (this.bursts.length >= 10) {
      const old = this.bursts.shift();
      old?.flash.dispose(false, false);
      old?.ring.dispose(false, false);
      for (const s of old?.sparks ?? []) s.mesh.dispose(false, false);
    }
    const n = this.burstSeq++;
    const flash = this.burstFlashProto.clone(`burstF_${n}`);
    const ring = this.burstRingProto.clone(`burstR_${n}`);
    // Материал общий (клон материала клонировал и текстуру, а сеттер hasAlpha
    // на свежей текстуре дёргал markAllMaterialsAsDirty каждый разрыв снаряда —
    // это роняло кадр в VR). Индивидуальное затухание — через mesh.visibility.
    flash.setEnabled(true);
    ring.setEnabled(true);
    flash.position.copyFrom(pos);
    ring.position.copyFrom(pos);
    // Искры — только на реальном попадании (угасший в воздухе снаряд бьёт тише,
    // без разлёта углей). Разлетаются в случайных направлениях "вверх-в стороны".
    const sparks: Spark[] = [];
    if (hit) {
      const count = 9;
      for (let i = 0; i < count; i++) {
        const s = this.burstSparkProto.clone(`burstS_${n}_${i}`);
        s.setEnabled(true);
        s.position.copyFrom(pos);
        sparks.push({
          mesh: s,
          dir: new Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize(),
          speed: 2.2 + Math.random() * 2.6,
        });
      }
    }
    this.bursts.push({
      flash,
      ring,
      sparks,
      pos: pos.clone(),
      age: 0,
      life: hit ? 0.6 : 0.28,
      // Даже мелкий быстрый снаряд бьёт заметно; крупный — огненный шар.
      peak: Math.max(radius, 0.28) * (hit ? 6.5 : 2.4),
    });
    if (hit) this.sfx.at({ x: pos.x, y: pos.y, z: pos.z }, () => this.sfx.fireBurst(undefined, radius / 0.62));
  }

  private updateBursts(dt: number): void {
    const cam = this.scene.activeCamera;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const f = b.age / b.life;
      if (f >= 1) {
        b.flash.dispose(false, false);
        b.ring.dispose(false, false);
        for (const s of b.sparks) s.mesh.dispose(false, false);
        this.bursts.splice(i, 1);
        continue;
      }
      const fade = 1 - f;
      // Ядро (градиентный билборд): мгновенно раздувается, держится, гаснет.
      const flashScale = b.peak * (0.55 + 0.45 * Math.min(1, f * 4)) * (0.55 + 0.45 * fade);
      b.flash.scaling.setAll(flashScale);
      b.flash.visibility = Math.min(1, fade * 1.7);
      if (cam) b.flash.lookAt(cam.globalPosition);
      // Кольцо: расходится наружу и истончается.
      const ringScale = b.peak * (0.4 + 2.6 * f);
      b.ring.scaling.setAll(ringScale);
      b.ring.visibility = fade * 0.2; // белая волна: 0.8 → 0.4 → 0.2
      if (cam) b.ring.lookAt(cam.globalPosition);
      // Искры: летят наружу по прямой, чуть тормозя гравитацией, гаснут к концу жизни.
      for (const s of b.sparks) {
        const dist = s.speed * b.age * (1 - 0.5 * f);
        s.mesh.position.copyFrom(b.pos);
        s.mesh.position.x += s.dir.x * dist;
        s.mesh.position.y += s.dir.y * dist - 1.4 * b.age * b.age; // лёгкое падение
        s.mesh.position.z += s.dir.z * dist;
        s.mesh.scaling.setAll(b.peak * 0.16 * fade);
        s.mesh.visibility = fade;
        if (cam) s.mesh.lookAt(cam.globalPosition);
      }
    }
  }

  /** Живой моб по id — например, чтобы «MISS» шёл следом за движущейся целью. */
  getMob(id: string): Mob | undefined {
    return this.mobs.get(id);
  }

  /** Ленивое создание видов мобов: только рядом с игроком (включать для игровых клиентов). */
  lazy = false;
  private matT = 0;

  private createMob(id: string, s: MobState): void {
    if (this.mobs.has(id)) return;
    const m = new Mob(
      this.scene,
      s.kind,
      id,
      this.sfx,
      this.report,
      this.leanMobs,
      this.mobUiScale,
      s.model,
      s.mobName,
      s.mobLevel,
    );
    m.farLodOn = this.lazy; // упрощённая модель вдали — только для игроков, не для спектатора
    this.mobs.set(id, m);
    this.targets.push(m);
  }

  /**
   * Раз в 0.25 с: создаём виды подошедших мобов (ближайшие первыми, не больше
   * MAT_PER_PASS за проход — чтобы не было всплеска) и сносим тех, кто ушёл дальше
   * DESPAWN_R. Дальние мобы живут только данными из состояния сервера.
   */
  private materialize(room: Room<ZoneState>, pp: Vector3): void {
    const cand: { id: string; s: MobState; d2: number }[] = [];
    const drop: string[] = [];
    room.state.mobs.forEach((s, id) => {
      const d2 = (s.x - pp.x) ** 2 + (s.z - pp.z) ** 2;
      const boss = s.kind === "boss";
      if (this.mobs.has(id)) {
        if (!boss && d2 > MOB_DESPAWN_R * MOB_DESPAWN_R) drop.push(id);
      } else if (!s.dead && (boss || d2 <= MOB_SPAWN_R * MOB_SPAWN_R)) {
        cand.push({ id, s, d2 });
      }
    });
    for (const id of drop) {
      const m = this.mobs.get(id);
      if (!m) continue;
      this.mobs.delete(id);
      this.removeTarget(m);
      m.dispose();
    }
    cand.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < Math.min(MAT_PER_PASS, cand.length); i++) this.createMob(cand[i].id, cand[i].s);
  }

  attach(room: Room<ZoneState>): void {
    this.detach();
    this.room = room;

    room.state.mobs.onAdd((s, id) => {
      // Ленивый режим (игроки): объект Mob (модель, скелет, материалы) создаём,
      // только когда моб подошёл ближе SPAWN_R — см. materialize().
      if (this.lazy) return;
      this.createMob(id, s);
    }, true);
    room.state.mobs.onRemove((_s, id) => {
      const m = this.mobs.get(id);
      if (!m) return;
      this.mobs.delete(id);
      this.removeTarget(m);
      m.dispose();
    });

    room.state.dummies.onAdd((s, id) => {
      const d = new Dummy(this.scene, id, new Vector3(s.x, s.y, s.z), this.report);
      this.dummies.set(id, d);
      this.targets.push(d);
    }, true);
    room.state.dummies.onRemove((_s, id) => {
      const d = this.dummies.get(id);
      if (!d) return;
      this.dummies.delete(id);
      this.removeTarget(d);
      d.dispose();
    });
  }

  private removeTarget(t: Hittable): void {
    const i = this.targets.indexOf(t);
    if (i >= 0) this.targets.splice(i, 1);
  }

  update(dt: number, playerPos: Vector3, playerAim: Vector3): void {
    const room = this.room;
    if (!room) return;

    // VR: рисуем только ближайших мобов (лимит), остальные отключены целиком;
    // плашки имён — ещё у меньшего числа. Мобы вне лимита продолжают
    // обновляться логикой, просто невидимы.
    const vr = !!(this.scene.activeCamera as { rigCameras?: unknown[] } | null)?.rigCameras?.length;
    // Ранжирование — 4 раза в секунду (сортировка каждый кадр — лишняя стоимость).
    this.rankT -= dt;
    if (vr && this.rankT <= 0) {
      this.rankT = 0.25;
      this.vrDrawSet.clear();
      this.vrUiSet.clear();
      const ranked: { id: string; d: number; boss: boolean }[] = [];
      room.state.mobs.forEach((s, id) => {
        if (s.dead) {
          this.vrDrawSet.add(id); // проигрывает смерть, сам скроется через 1.5 с
          return;
        }
        const d = (s.x - playerPos.x) ** 2 + (s.z - playerPos.z) ** 2;
        ranked.push({ id, d, boss: s.kind === "boss" });
      });
      ranked.sort((a, b) => a.d - b.d);
      let n = 0;
      for (const r of ranked) {
        if (r.boss || n < VR_MAX_MOBS) this.vrDrawSet.add(r.id);
        if (n < VR_MAX_UI) this.vrUiSet.add(r.id);
        n++;
      }
    }
    if (this.lazy) {
      this.matT -= dt;
      if (this.matT <= 0) {
        this.matT = 0.25;
        this.materialize(room, playerPos);
      }
    }
    room.state.mobs.forEach((s, id) => {
      const m = this.mobs.get(id);
      if (!m) return;
      const draw = vr ? !!s.dead || this.vrDrawSet.has(id) : true;
      let mdt = dt;
      if (this.lazy && !s.dead && draw && MOB_FAR_UPDATE_R > 0) {
        // Дальнего видимого моба считаем ~20 раз в секунду (позиция и так сглаживается).
        const d2 = (s.x - playerPos.x) ** 2 + (s.z - playerPos.z) ** 2;
        if (d2 > MOB_FAR_UPDATE_R * MOB_FAR_UPDATE_R) {
          m.idleAcc += dt;
          if (m.idleAcc < 0.05) return;
          mdt = m.idleAcc;
          m.idleAcc = 0;
          m.applyState(s, mdt, playerPos, playerAim, draw, vr ? this.vrUiSet.has(id) : true);
          return;
        }
      }
      if (vr && !draw) {
        // Невидимого живого моба обновляем 4 раза в секунду (dt копится): он всё
        // равно не рисуется, а обход десятков схем каждый кадр — это и был netMobs.
        m.idleAcc += dt;
        if (m.idleAcc < 0.25) return;
        mdt = m.idleAcc;
      }
      m.idleAcc = 0;
      m.applyState(s, mdt, playerPos, playerAim, draw, vr ? this.vrUiSet.has(id) : true);
    });
    room.state.dummies.forEach((s, id) => {
      this.dummies.get(id)?.applyState(s, dt);
    });

    // Плевки: множество появляется/исчезает — синхронизируем меши.
    room.state.balls.forEach((s, id) => {
      let b = this.balls.get(id);
      if (!b) {
        const mesh = (s.boss ? this.ballProtoBoss : this.ballProto).clone(`spitBall_${id}`);
        mesh.setEnabled(true);
        b = {
          mesh,
          pos: new Vector3(s.x, s.y, s.z),
          vel: new Vector3(s.vx, s.vy, s.vz),
          srvVy: s.vy,
        };
        this.balls.set(id, b);
        // Новый плевок = плевун только что выстрелил — звук с той стороны.
        this.sfx.spitterFire({ x: s.x, y: s.y, z: s.z });
      }

      // Пришёл новый патч — берём скорость сервера как есть.
      if (s.vy !== b.srvVy) {
        b.vel.set(s.vx, s.vy, s.vz);
        b.srvVy = s.vy;
      }
      // Между патчами летим сами с той же гравитацией, что на сервере.
      b.vel.y -= SPITTER.ballGravity * dt;
      b.pos.addInPlaceFromFloats(b.vel.x * dt, b.vel.y * dt, b.vel.z * dt);

      // И мягко сходимся с серверной позицией, чтобы не расходиться.
      const k = 1 - Math.exp(-dt * 8);
      b.pos.x += (s.x - b.pos.x) * k;
      b.pos.y += (s.y - b.pos.y) * k;
      b.pos.z += (s.z - b.pos.z) * k;

      b.mesh.position.copyFrom(b.pos);
    });
    for (const [id, b] of this.balls) {
      if (!room.state.balls.has(id)) {
        b.mesh.dispose();
        this.balls.delete(id);
      }
    }

    // Огненные снаряды игроков.
    const cam = this.scene.activeCamera;
    room.state.bolts.forEach((s, id) => {
      let bo = this.bolts.get(id);
      if (!bo) {
        const isArrow = s.kind === 1;
        const core = this.boltCoreProto.clone(`bolt_${id}`);
        const glow = this.boltGlowProto.clone(`boltGlow_${id}`);
        core.setEnabled(!isArrow);
        glow.setEnabled(!isArrow);
        let arrow: Mesh | undefined;
        if (isArrow) {
          if (!this.arrowProto) this.arrowProto = createArrowProto(this.scene);
          arrow = this.arrowProto.clone(`arrow_${id}`) ?? undefined;
          arrow?.setEnabled(true);
        }
        bo = {
          core,
          glow,
          arrow,
          pos: new Vector3(s.x, s.y, s.z),
          vel: new Vector3(s.vx, s.vy, s.vz),
          r: s.r || 0.15,
          age: 0,
        };
        this.bolts.set(id, bo);
        // Стрелам (kind 1) звук выстрела даёт act:"bow" от стрелка — здесь бы
        // вышел двойной. Огнешару (kind 0) свой act не шлётся — озвучиваем тут.
        if ((s.kind ?? 0) === 0) {
          this.sfx.at({ x: s.x, y: s.y, z: s.z }, () => this.sfx.bowRelease(0.6));
        }
      }
      bo.age += dt;
      bo.vel.set(s.vx, s.vy, s.vz);
      bo.pos.addInPlaceFromFloats(s.vx * dt, s.vy * dt, s.vz * dt);
      const k = 1 - Math.exp(-dt * 10);
      bo.pos.x += (s.x - bo.pos.x) * k;
      bo.pos.y += (s.y - bo.pos.y) * k;
      bo.pos.z += (s.z - bo.pos.z) * k;

      if (bo.arrow) {
        bo.arrow.position.copyFrom(bo.pos);
        if (bo.vel.lengthSquared() > 1e-4) {
          bo.arrow.lookAt(bo.pos.add(bo.vel));
        }
        bo.arrow.scaling.setAll(Math.max(1, this.boltViewScale * 0.6));
      } else {
        const flick = 0.85 + 0.15 * Math.sin(bo.age * 40 + bo.pos.x);
        const vs = this.boltViewScale;
        bo.core.position.copyFrom(bo.pos);
        bo.core.scaling.setAll(bo.r * 2 * flick * vs);
        bo.glow.position.copyFrom(bo.pos);
        bo.glow.scaling.setAll(bo.r * 6 * flick * vs);
        if (cam) bo.glow.lookAt(cam.globalPosition);
      }
    });
    for (const [id, bo] of this.bolts) {
      if (!room.state.bolts.has(id)) {
        // Снаряд исчез: попал по цели или угас/врезался в землю. Определяем
        // по близости живой цели к его последней позиции.
        let hit = false;
        for (const m of this.mobs.values()) {
          const c = m.center?.();
          if (c && Vector3.Distance(c, bo.pos) < bo.r + 1.7) {
            hit = true;
            break;
          }
        }
        if (!hit) {
          for (const d of this.dummies.values()) {
            const p = d.root.position;
            if (Vector3.Distance(new Vector3(p.x, p.y + 0.9, p.z), bo.pos) < bo.r + 1.5) {
              hit = true;
              break;
            }
          }
        }
        if (bo.arrow) {
          // Стрела бота: глухой «тук», без огненной вспышки/звука мага.
          this.sfx.at(
            { x: bo.pos.x, y: bo.pos.y, z: bo.pos.z },
            () => this.sfx.arrowHit(hit ? "flesh" : "wood", 0.8),
          );
        } else {
          this.spawnBurst(bo.pos, bo.r, hit);
        }
        bo.core.dispose();
        bo.glow.dispose();
        bo.arrow?.dispose();
        this.bolts.delete(id);
      }
    }

    this.updateBursts(dt);

    // Ночная подсветка от огнешара: приоритет у свежего взрыва, иначе — снаряд.
    this.fireLightPower = 0;
    for (const b of this.bursts) {
      const f = b.age / b.life;
      const p = b.peak * (1 - f) * 0.9;
      if (p > this.fireLightPower) {
        this.fireLightPower = p;
        this.fireLightPos.copyFrom(b.pos);
      }
    }
    if (this.fireLightPower < 1.5) {
      for (const bo of this.bolts.values()) {
        if (2 > this.fireLightPower) {
          this.fireLightPower = 2;
          this.fireLightPos.copyFrom(bo.pos);
        }
      }
    }
  }

  detach(): void {
    for (const m of this.mobs.values()) {
      this.removeTarget(m);
      m.dispose();
    }
    for (const d of this.dummies.values()) {
      this.removeTarget(d);
      d.dispose();
    }
    for (const b of this.balls.values()) b.mesh.dispose();
    for (const bo of this.bolts.values()) {
      bo.core.dispose();
      bo.glow.dispose();
      bo.arrow?.dispose();
    }
    for (const b of this.bursts.values()) {
      b.flash.dispose(false, false);
      b.ring.dispose(false, false);
      for (const s of b.sparks) s.mesh.dispose(false, false);
    }
    this.bursts.length = 0;
    this.mobs.clear();
    this.dummies.clear();
    this.balls.clear();
    this.bolts.clear();
    this.room = null;
  }
}
