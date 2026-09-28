import type { Scene } from "@babylonjs/core/scene";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import type { Particle } from "@babylonjs/core/Particles/particle";
import "@babylonjs/core/Particles/particleSystemComponent";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Огонь горящих мобов на частицах (по умолчанию; `?fire=0` — старые
 * карточки BurnFlameMat). ОДНА система на всю сцену — одна отрисовка на
 * всех горящих сразу: каждая новая частица рождается на случайном горящем
 * мобе (чаще — на том, что горит сильнее). Расчёт ~сотен частиц на CPU —
 * доли миллисекунды; текстура — мягкое пятно, нарисованное в коде.
 */

const CAPACITY = 1200; // крупные мобы (колосс) берут много частиц — запас, чтобы мелким хватало

/**
 * Живые параметры огня — лаборатория (lab.html, сцена «огонь») крутит их
 * ползунками и зовёт retune(); найденные числа переносятся сюда как дефолт.
 */
export const FIRE_TUNE = {
  /** Частиц в секунду на моба при полном горении (× его масштаб). */
  rate: 42,
  lifeMin: 0.4,
  lifeMax: 0.8,
  sizeMin: 0.18,
  sizeMax: 0.32,
  /** Ускорение вверх, м/с². */
  lift: 2.2,
  /** Стартовая скорость вверх, м/с (±половина — разброс). */
  rise: 1.9,
  /** Боковой разброс скорости. */
  spread: 0.35,
  /** Множитель прозрачности всего огня. */
  alpha: 1,
  /** 1 — языки вытянуты вдоль движения, 0 — круглые пятна. */
  stretched: 1,
};

interface Src {
  x: number;
  y: number;
  z: number;
  /** Радиус тела (м) — разброс точки рождения и размер языков. */
  r: number;
  glow: number;
  seenAt: number;
}

type ScaledParticle = Particle & { __s?: number };

const PER_SCENE = new WeakMap<Scene, BurnParticles>();

/** Частицы — огонь по умолчанию (одобрено на стенде 2026-09-28); ?fire=0 — старые карточки BurnFlameMat. */
export const FIRE_PARTICLES =
  typeof location === "undefined" || new URLSearchParams(location.search).get("fire") !== "0";

export class BurnParticles {
  static for(scene: Scene): BurnParticles {
    let b = PER_SCENE.get(scene);
    if (!b) {
      b = new BurnParticles(scene);
      PER_SCENE.set(scene, b);
    }
    return b;
  }

  private readonly ps: ParticleSystem;
  private readonly srcs = new Map<object, Src>();
  private readonly list: Src[] = [];
  private totalW = 0;
  private now = 0;

  private constructor(scene: Scene) {
    const ps = new ParticleSystem("burnFire", CAPACITY, scene);
    ps.particleTexture = softDot(scene);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitter = Vector3.Zero();
    ps.isLocal = false;
    ps.minEmitPower = 1;
    ps.maxEmitPower = 1;
    ps.gravity = new Vector3(0, FIRE_TUNE.lift, 0);
    // Размер: вспыхивает, потом язык сужается кверху.
    ps.addSizeGradient(0, 0.55);
    ps.addSizeGradient(0.15, 1);
    ps.addSizeGradient(1, 0.25);
    ps.emitRate = 0;

    ps.startPositionFunction = (_m, pos, p): void => {
      const s = this.pick();
      if (!s) {
        pos.set(0, -1000, 0);
        return;
      }
      // Рост модели ≈ 1.75 радиуса тела (как в Mob.attachModel). Рождаем по
      // телу вокруг его середины (20–70% роста) — у маленьких и у огромных
      // мобов огонь одинаково «на теле», а не у ног.
      const h = s.r * 1.75;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * s.r * 0.65;
      pos.set(s.x + Math.cos(a) * rr, s.y + h * (0.2 + Math.random() * 0.5), s.z + Math.sin(a) * rr);
      // Частица растёт МЕДЛЕННО (корень) и с потолком: раньше она росла прямо
      // пропорционально мобу, и на колоссе (×5.4) частицы сливались в один
      // слепящий шар. Крупному мобу — больше частиц (вес в tick), а не гигантские.
      (p as ScaledParticle).__s = Math.min(2.2, Math.max(0.6, Math.sqrt(s.r / 0.55)));
    };
    ps.startDirectionFunction = (_m, dir): void => {
      const t = FIRE_TUNE;
      dir.set(
        (Math.random() - 0.5) * t.spread,
        t.rise * (0.7 + Math.random() * 0.6),
        (Math.random() - 0.5) * t.spread,
      );
    };
    // Масштаб под размер моба: Babylon сбрасывает particle.scale ПОСЛЕ
    // startPositionFunction, поэтому применяем его на первом обновлении.
    const base = ps.updateFunction;
    ps.updateFunction = (particles: Particle[]): void => {
      base(particles);
      for (const p of particles as ScaledParticle[]) {
        if (p.__s) {
          p.scale.scaleInPlace(p.__s);
          p.__s = 0;
        }
      }
    };
    this.ps = ps;
    this.retune();
    ps.start();

    scene.onBeforeRenderObservable.add(() => this.tick(scene.getEngine().getDeltaTime() / 1000));
  }

  /** Применить FIRE_TUNE (лаборатория меняет его на лету). */
  retune(): void {
    const t = FIRE_TUNE;
    const ps = this.ps;
    ps.minLifeTime = t.lifeMin;
    ps.maxLifeTime = Math.max(t.lifeMin, t.lifeMax);
    ps.minSize = t.sizeMin;
    ps.maxSize = Math.max(t.sizeMin, t.sizeMax);
    ps.gravity.set(0, t.lift, 0);
    // Вытянуты вдоль движения — языки пламени, а не круглые пятна.
    ps.billboardMode = t.stretched ? ParticleSystem.BILLBOARDMODE_STRETCHED : ParticleSystem.BILLBOARDMODE_ALL;
    // Цвет за жизнь: жёлтая сердцевина → оранжевый → тёмно-красный → гаснет.
    // Альфа умеренная: при сложении цветов десятки частиц иначе выжигают моба в белое.
    const a = t.alpha;
    for (const g of [...(ps.getColorGradients() ?? [])]) ps.removeColorGradient(g.gradient);
    ps.addColorGradient(0, new Color4(1, 0.9, 0.5, 0));
    ps.addColorGradient(0.1, new Color4(1, 0.7, 0.25, 0.55 * a));
    ps.addColorGradient(0.4, new Color4(1, 0.38, 0.06, 0.42 * a));
    ps.addColorGradient(0.75, new Color4(0.55, 0.1, 0.02, 0.2 * a));
    ps.addColorGradient(1, new Color4(0.15, 0.04, 0.02, 0));
  }

  /** Моб горит: где он и насколько (0..1). Звать каждый кадр, пока горит. */
  set(key: object, x: number, y: number, z: number, r: number, glow: number): void {
    let s = this.srcs.get(key);
    if (!s) {
      s = { x, y, z, r, glow, seenAt: 0 };
      this.srcs.set(key, s);
    }
    s.x = x;
    s.y = y;
    s.z = z;
    s.r = r;
    s.glow = glow;
    s.seenAt = this.now;
  }

  remove(key: object): void {
    this.srcs.delete(key);
  }

  private tick(dt: number): void {
    this.now += Math.min(0.1, dt);
    // Шаг симуляции — реальное время кадра, а не фиксированные 1/60: иначе
    // огонь в шлеме на 90 Гц шёл в 1.5 раза быстрее, а на 30 FPS — вдвое медленнее.
    this.ps.updateSpeed = Math.min(0.05, Math.max(0.004, dt));
    this.list.length = 0;
    this.totalW = 0;
    let rate = 0;
    for (const [k, s] of this.srcs) {
      // Моб перестал сообщать о себе (выгружен/умер без remove) — забываем.
      if (this.now - s.seenAt > 0.5) {
        this.srcs.delete(k);
        continue;
      }
      this.list.push(s);
      const w = s.glow * Math.max(0.5, s.r / 0.55);
      this.totalW += w;
      rate += FIRE_TUNE.rate * w;
    }
    this.ps.emitRate = Math.min(rate, CAPACITY * 1.2);
  }

  private pick(): Src | null {
    if (this.list.length === 0) return null;
    let t = Math.random() * this.totalW;
    for (const s of this.list) {
      t -= s.glow * Math.max(0.5, s.r / 0.55);
      if (t <= 0) return s;
    }
    return this.list[this.list.length - 1];
  }
}

/** Мягкое круглое пятно 64×64 — белое в центре, прозрачное к краю (цвет даёт градиент). */
function softDot(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("burnDot", { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}
