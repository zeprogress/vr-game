/** Точка в мире, откуда идёт звук. */
export interface SoundAt {
  x: number;
  y: number;
  z: number;
}

/**
 * Простые процедурные звуки на Web Audio (без файлов).
 * `resume()` нужно вызвать по жесту пользователя (клик / вход в VR).
 *
 * Часть звуков объёмная: если передать точку `at`, звук идёт через PannerNode
 * и слышен с той стороны, где источник (моб, взмах, плевок).
 */
/** Играющий трек: буфер-источник + свой gain (для кроссфейда). */
interface MusicVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  url: string;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  /**
   * Фоновая музыка играет через Web Audio (декодированный буфер), как и все
   * прочие звуки — НЕ через <audio>. Так браузер не показывает «отдельный
   * плеер» / медиа-контролы и громкость честно рулится GainNode'ом.
   */
  private music: MusicVoice | null = null;
  private fadeVoice: MusicVoice | null = null;
  private musicWanted = false;
  private musicLoading = false;
  private readonly bufCache = new Map<string, AudioBuffer>();
  /** Общая «ручка громкости» музыки → destination. */
  private musicBus: GainNode | null = null;
  /** Множитель громкости 0..1 (слайдер в меню). <0.03 — полная тишина. */
  private volume = 1;
  /** Где сейчас «уши» — по ним отодвигаем слишком близкие источники. */
  private readonly ear = { x: 0, y: 0, z: 0 };

  private get dead(): boolean {
    return this.volume < 0.03;
  }
  private masterTarget(): number {
    return this.dead ? 0 : 0.45 * this.volume;
  }
  private musicTarget(): number {
    return this.dead ? 0 : this.musicVol * this.volume;
  }
  /** Пока не null — все звуки внутри `at()` идут объёмно от этой точки. */
  private spatialAt: SoundAt | null = null;

  private ensure(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterTarget();
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  /**
   * Общий аудиоконтекст. Голосовой чат вешает свои узлы сюда же:
   * браузеры не любят много контекстов, да и «разбудить» нужно один.
   */
  audioContext(): AudioContext {
    this.ensure();
    return this.ctx as AudioContext;
  }

  resume(): void {
    this.ensure();
    this.ensureMusicBus();
    void this.ctx?.resume();
    // Музыку могли попросить до первого жеста — заводим теперь.
    if (this.musicWanted && !this.music) void this.startPlaylist(0.8);
  }

  /** Поднять общий музыкальный gain (после ctx). */
  private ensureMusicBus(): void {
    if (this.musicBus || !this.ctx) return;
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicTarget();
    this.musicBus.connect(this.ctx.destination);
  }

  private musicUrl = "";
  private musicVol = 0.045;
  /** Плейлист текущей музыки: из него после каждого трека берём случайный. */
  private playlist: string[] = [];
  private lastTrack = "";

  /** Скачать и декодировать mp3 в AudioBuffer (маленький кэш). */
  private async loadBuf(url: string): Promise<AudioBuffer | null> {
    const hit = this.bufCache.get(url);
    if (hit) return hit;
    if (!this.ctx) return null;
    try {
      // С таймаутом: на мобильной сети fetch иногда виснет насмерть, и тогда
      // плейлист застревал (musicLoading не снимался).
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 15_000);
      const arr = await fetch(url, { signal: ac.signal })
        .then((r) => r.arrayBuffer())
        .finally(() => clearTimeout(t));
      const buf = await new Promise<AudioBuffer>((res, rej) =>
        this.ctx!.decodeAudioData(arr, res, rej),
      );
      // Держим 4: текущий трек + предзагруженный следующий + запас на стыке.
      if (this.bufCache.size >= 4) {
        for (const k of this.bufCache.keys()) {
          if (k !== url && k !== this.pendingNext && k !== this.music?.url) {
            this.bufCache.delete(k);
            break;
          }
        }
      }
      this.bufCache.set(url, buf);
      return buf;
    } catch {
      return null;
    }
  }

  private killVoice(v: MusicVoice | null): void {
    if (!v) return;
    v.src.onended = null;
    try {
      v.src.stop();
    } catch {
      /* уже остановлен */
    }
    try {
      v.src.disconnect();
    } catch {
      /* нет */
    }
    try {
      v.gain.disconnect();
    } catch {
      /* нет */
    }
  }

  /** Случайный трек плейлиста, по возможности не тот же, что играл только что. */
  private pickTrack(): string {
    if (this.playlist.length <= 1) return this.playlist[0] ?? "";
    const pool = this.playlist.filter((u) => u !== this.lastTrack);
    const track = pool[Math.floor(Math.random() * pool.length)];
    this.lastTrack = track;
    return track;
  }

  private async playVoice(
    url: string,
    loop: boolean,
    fadeInSec: number,
  ): Promise<MusicVoice | null> {
    this.ensureMusicBus();
    if (!this.ctx || !this.musicBus) return null;
    const wantKey = this.musicUrl;
    const buf = await this.loadBuf(url);
    if (!buf || !this.ctx || !this.musicBus || this.musicUrl !== wantKey) return null;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const gain = this.ctx.createGain();
    src.connect(gain).connect(this.musicBus);
    const voice: MusicVoice = { src, gain, url };
    if (!loop) {
      src.onended = () => {
        if (this.music === voice) this.playNext();
      };
    }
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(fadeInSec > 0 ? 0 : 1, now);
    if (fadeInSec > 0) gain.gain.linearRampToValueAtTime(1, now + fadeInSec);
    try {
      src.start();
    } catch {
      this.killVoice(voice);
      return null;
    }
    return voice;
  }

  /** Заранее выбранный и подгруженный следующий трек — чтобы не было тишины на стыке. */
  private pendingNext = "";

  /** Завести текущий плейлист (или один трек в луп). `first` — конкретный трек. */
  private async startPlaylist(fadeInSec = 0, first?: string): Promise<void> {
    if (!this.ctx || this.musicLoading) return;
    this.musicLoading = true;
    try {
      const key = this.musicUrl;
      const loop = this.playlist.length <= 1;
      // Битый файл / сорванная загрузка НЕ должны убивать плейлист: пробуем
      // несколько треков подряд, а если совсем никак — заходим позже.
      let v: MusicVoice | null = null;
      const tries = Math.min(4, Math.max(1, this.playlist.length));
      for (let i = 0; i < tries && !v && this.musicUrl === key; i++) {
        const url = i === 0 && first ? first : this.pickTrack();
        v = await this.playVoice(url, loop, fadeInSec);
      }
      if (this.musicUrl !== key) {
        this.killVoice(v);
        return;
      }
      if (!v) {
        if (this.musicWanted) {
          setTimeout(() => {
            if (!this.music && this.musicWanted) void this.startPlaylist(0);
          }, 8000);
        }
        return;
      }
      this.killVoice(this.music);
      this.music = v;
      // Следующий трек выбираем и подгружаем СЕЙЧАС — на стыке будет кэш-хит,
      // без паузы на fetch+decode (~2 c для длинного mp3).
      if (!loop) {
        this.pendingNext = this.pickTrack();
        void this.loadBuf(this.pendingNext);
      }
    } finally {
      this.musicLoading = false;
    }
  }

  /** По концу трека — заранее подгруженный следующий. */
  private playNext(): void {
    if (this.playlist.length <= 1 || this.fadeVoice) return;
    this.music = null;
    void this.startPlaylist(0, this.pendingNext || undefined);
  }

  /**
   * Фоновая музыка. `src` — один файл (луп) или список: играем случайный, по
   * концу — следующий случайный. Стартует при первом resume().
   */
  startMusic(src: string | string[], volume = 0.01): void {
    if (this.musicWanted) return;
    this.musicWanted = true;
    this.playlist = Array.isArray(src) ? [...src] : [src];
    this.musicUrl = this.playlist.join("|");
    this.musicVol = volume;
    if (this.musicBus) this.musicBus.gain.value = this.musicTarget();
    void this.startPlaylist(0.8);
  }

  /**
   * Сменить фоновую музыку с плавным переходом (~1.4 с). Тот же набор — no-op.
   * Для перехода на boss.mp3 и обратно.
   */
  setMusic(src: string | string[], volume = this.musicVol): void {
    const list = Array.isArray(src) ? [...src] : [src];
    const key = list.join("|");
    if (key === this.musicUrl) {
      this.musicVol = volume;
      return;
    }
    this.playlist = list;
    this.musicUrl = key;
    this.musicVol = volume;
    if (this.musicBus) this.musicBus.gain.value = this.musicTarget();
    if (!this.ctx || !this.musicWanted) return;

    // Старый трек уводим на затухание.
    this.killVoice(this.fadeVoice);
    const old = this.music;
    this.fadeVoice = old;
    this.music = null;
    if (old && this.ctx) {
      const now = this.ctx.currentTime;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + 1.4);
      setTimeout(() => {
        if (this.fadeVoice === old) {
          this.killVoice(old);
          this.fadeVoice = null;
        }
      }, 1600);
    }
    void this.startPlaylist(1.4);
  }

  setMusicVolume(v: number): void {
    this.musicVol = Math.max(0, Math.min(1, v));
    if (this.musicBus) this.musicBus.gain.value = this.musicTarget();
  }

  get masterVolume(): number {
    return this.volume;
  }

  /**
   * Общая громкость (слайдер в меню). Ниже ~3% — полная тишина: и звуки, и
   * музыка. Предохранитель от «тихого хвоста» при минимальной громкости.
   */
  setMasterVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.masterTarget();
    if (this.musicBus) this.musicBus.gain.value = this.musicTarget();
  }

  // --- строительные блоки ---

  private get t(): number {
    return this.ctx!.currentTime;
  }

  private noise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noiseBuf;
    return s;
  }

  private env(
    peak: number,
    attack: number,
    decay: number,
    t = this.t,
    at: SoundAt | null | undefined = this.spatialAt,
  ): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(at ? this.panAt(at) : this.master!);
    return g;
  }

  /**
   * Проиграть звук объёмно от точки `pos`. Любой звук, вызванный внутри `fn`,
   * пойдёт через паннер. Для чужих действий по сети: `sfx.at(pos, () => sfx.drink())`.
   */
  at(pos: SoundAt, fn: () => void): void {
    const prev = this.spatialAt;
    this.spatialAt = pos;
    try {
      fn();
    } finally {
      this.spatialAt = prev;
    }
  }

  /**
   * PannerNode в точке `at`, подключённый к мастеру. Живёт с одним звуком.
   * Z инвертируем: у Web Audio «вперёд» это −Z, у Babylon +Z.
   */
  private panAt(at: SoundAt): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = "HRTF";
    p.distanceModel = "inverse";
    p.refDistance = 5;
    p.maxDistance = 55;
    p.rolloffFactor = 0.8;

    // Свой меч и своя бутылка — в полуметре от головы. Вплотную к уху HRTF
    // вжимает звук в один наушник, и «взмах справа» звучит как в другой
    // комнате слева. Поэтому близкие источники отодвигаем на MIN_EAR,
    // сохраняя направление: сторона слышна, но звук остаётся при тебе.
    const MIN_EAR = 1.6;
    let dx = at.x - this.ear.x;
    let dy = at.y - this.ear.y;
    let dz = at.z - this.ear.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < MIN_EAR) {
      if (d < 1e-3) {
        dx = 0;
        dy = 0;
        dz = MIN_EAR; // ровно в голове — считаем, что прямо перед лицом
      } else {
        const k = MIN_EAR / d;
        dx *= k;
        dy *= k;
        dz *= k;
      }
    }
    const x = this.ear.x + dx;
    const y = this.ear.y + dy;
    const z = this.ear.z + dz;

    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = -z;
    } else {
      (p as unknown as { setPosition(px: number, py: number, pz: number): void }).setPosition(
        x,
        y,
        -z,
      );
    }
    p.connect(this.master!);
    return p;
  }

  /**
   * Положение и направление «ушей» игрока — звать каждый кадр, иначе объёмные
   * звуки будут приходить не с той стороны. Голова = позиция и взгляд камеры.
   */
  setListener(pos: SoundAt, forward: SoundAt, up: SoundAt): void {
    if (!this.ctx) return;
    this.ear.x = pos.x;
    this.ear.y = pos.y;
    this.ear.z = pos.z;
    const l = this.ctx.listener;
    // Z инвертируем и у слушателя, и у источников — оси Web Audio против Babylon.
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = -pos.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = -forward.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      const legacy = l as unknown as {
        setPosition(x: number, y: number, z: number): void;
        setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
      };
      legacy.setPosition(pos.x, pos.y, -pos.z);
      legacy.setOrientation(forward.x, forward.y, -forward.z, up.x, up.y, up.z);
    }
  }

  private filter(type: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  // --- звуки ---

  footstep(vol = 1): void {
    if (!this.ready()) return;
    const t = this.t;
    // Глухой мягкий удар подошвы о землю — низкий фильтр, быстро глохнет.
    const n = this.noise();
    const lp = this.filter("lowpass", 190 + Math.random() * 80);
    lp.frequency.exponentialRampToValueAtTime(85, t + 0.1);
    const g = this.env(0.24 * vol, 0.004, 0.09, t);
    n.connect(lp).connect(g);
    n.start(t);
    n.stop(t + 0.14);
    // Низкий «вес» шага — совсем тихо.
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.09);
    const og = this.env(0.1 * vol, 0.004, 0.08, t);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.12);
    // Приглушённый шорох земли — в средних частотах, без «звона» сверху.
    const n2 = this.noise();
    const bp = this.filter("bandpass", 700 + Math.random() * 250, 0.7);
    const g2 = this.env(0.03 * vol, 0.003, 0.06, t);
    n2.connect(bp).connect(g2);
    n2.start(t);
    n2.stop(t + 0.08);
  }

  land(vol = 1): void {
    if (!this.ready()) return;
    const t = this.t;
    const n = this.noise();
    const lp = this.filter("lowpass", 260);
    const g = this.env(0.5 * vol, 0.004, 0.18, t);
    n.connect(lp).connect(g);
    n.start(t);
    n.stop(t + 0.24);
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.16);
    const og = this.env(0.35 * vol, 0.004, 0.18, t);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.22);
  }

  jump(): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(210, t);
    o.frequency.linearRampToValueAtTime(430, t + 0.12);
    const g = this.env(0.16, 0.01, 0.14, t);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.17);
  }

  swordSwing(at?: SoundAt): void {
    if (!this.ready()) return;
    const t = this.t;
    const n = this.noise();
    const bp = this.filter("bandpass", 600, 3.5);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.11);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.28);
    const g = this.env(0.32, 0.06, 0.24, t, at);
    n.connect(bp).connect(g);
    n.start(t);
    n.stop(t + 0.32);
  }

  hitThud(vol = 1): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.16);
    const og = this.env(0.55 * vol, 0.003, 0.2, t);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.24);
    const n = this.noise();
    const hp = this.filter("highpass", 1400);
    const ng = this.env(0.25 * vol, 0.002, 0.07, t);
    n.connect(hp).connect(ng);
    n.start(t);
    n.stop(t + 0.1);
  }

  bowDraw(): void {
    if (!this.ready()) return;
    const t = this.t;
    const n = this.noise();
    const bp = this.filter("bandpass", 400, 6);
    bp.frequency.setValueAtTime(280, t);
    bp.frequency.linearRampToValueAtTime(520, t + 0.35);
    const g = this.env(0.12, 0.08, 0.3, t);
    n.connect(bp).connect(g);
    n.start(t);
    n.stop(t + 0.4);
  }

  bowRelease(power: number): void {
    if (!this.ready()) return;
    const t = this.t;
    const base = 90 + power * 70;
    for (const mult of [1, 1.5, 2.01]) {
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(base * mult, t);
      o.frequency.exponentialRampToValueAtTime(base * mult * 0.6, t + 0.18);
      const g = this.env(0.18 / mult, 0.002, 0.2, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.24);
    }
    const n = this.noise();
    const hp = this.filter("highpass", 2000);
    const ng = this.env(0.12, 0.001, 0.05, t);
    n.connect(hp).connect(ng);
    n.start(t);
    n.stop(t + 0.07);
  }

  mobHop(at?: SoundAt): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.1);
    const g = this.env(0.1, 0.005, 0.1, t, at);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.13);
  }

  mobHurt(at?: SoundAt): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.14);
    const lp = this.filter("lowpass", 1200);
    const g = this.env(0.3, 0.003, 0.15, t, at);
    o.connect(lp).connect(g);
    o.start(t);
    o.stop(t + 0.18);
  }

  mobDie(at?: SoundAt): void {
    if (!this.ready()) return;
    const t = this.t;
    const n = this.noise();
    const bp = this.filter("bandpass", 500, 1.5);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(150, t + 0.25);
    const g = this.env(0.4, 0.004, 0.28, t, at);
    n.connect(bp).connect(g);
    n.start(t);
    n.stop(t + 0.32);
  }

  /** Плевок плевуна: резкий выхлоп воздуха с падающим тоном. Объёмный. */
  spitterFire(at?: SoundAt): void {
    if (!this.ready()) return;
    const t = this.t;
    // Шипящий выхлоп.
    const n = this.noise();
    const bp = this.filter("bandpass", 1600, 1.4);
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.16);
    const ng = this.env(0.34, 0.004, 0.16, t, at);
    n.connect(bp).connect(ng);
    n.start(t);
    n.stop(t + 0.22);
    // «Тьфу» — короткий гортанный призвук.
    const o = this.ctx!.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
    const lp = this.filter("lowpass", 900);
    const og = this.env(0.22, 0.003, 0.12, t, at);
    o.connect(lp).connect(og);
    o.start(t);
    o.stop(t + 0.16);
  }

  /** Разрыв огненного снаряда посоха. `power` 0..1 — крупнее заряд, глубже бум. */
  fireBurst(at: SoundAt | undefined, power = 0.5): void {
    if (!this.ready()) return;
    const t = this.t;
    const p = Math.max(0, Math.min(1, power));
    // Низкий "бум".
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160 - p * 60, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.22 + p * 0.15);
    const og = this.env(0.5 + p * 0.3, 0.003, 0.28 + p * 0.2, t, at);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.6);
    // Шипящий выхлоп пламени.
    const n = this.noise();
    const bp = this.filter("bandpass", 900, 0.8);
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.25);
    const ng = this.env(0.3 + p * 0.2, 0.002, 0.24, t, at);
    n.connect(bp).connect(ng);
    n.start(t);
    n.stop(t + 0.35);
  }

  /** Лязг блока. strength: 1 — щит (звонко), <1 — меч (глуше). */
  block(strength = 1): void {
    if (!this.ready()) return;
    const t = this.t;
    const base = 320 + strength * 380;
    for (const mult of [1, 1.61, 2.37]) {
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(base * mult, t);
      o.frequency.exponentialRampToValueAtTime(base * mult * 0.82, t + 0.22);
      const g = this.env((0.22 * strength) / mult, 0.002, 0.26, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.3);
    }
    const n = this.noise();
    const bp = this.filter("bandpass", 2600, 1.2);
    const ng = this.env(0.26 * strength, 0.001, 0.09, t);
    n.connect(bp).connect(ng);
    n.start(t);
    n.stop(t + 0.12);
  }

  /** Повышение уровня: короткий восходящий аккорд. */
  levelUp(): void {
    if (!this.ready()) return;
    const t0 = this.t;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.09;
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t);
      const g = this.env(0.22, 0.01, 0.35, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.4);
    });
  }

  /** Критический выстрел из лука: тяжёлый мясистый удар с коротким низким гулом. */
  crit(): void {
    if (!this.ready()) return;
    const t = this.t;
    // Низкое тело удара — падающая синусоида, даёт «вес».
    const body = this.ctx!.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(190, t);
    body.frequency.exponentialRampToValueAtTime(64, t + 0.22);
    const bodyG = this.env(0.5, 0.002, 0.24, t);
    body.connect(bodyG);
    body.start(t);
    body.stop(t + 0.3);
    // Средний акцент — квинта в низком регистре, короткая.
    for (const [f, d] of [
      [330, 0],
      [247, 0.03],
    ] as const) {
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t + d);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + d + 0.16);
      const g = this.env(0.18, 0.003, 0.16, t + d);
      o.connect(g);
      o.start(t + d);
      o.stop(t + d + 0.22);
    }
    // Глухой транзиент-щелчок вместо свиста.
    const n = this.noise();
    const bp = this.filter("bandpass", 1100, 2);
    const ng = this.env(0.22, 0.001, 0.05, t);
    n.connect(bp).connect(ng);
    n.start(t);
    n.stop(t + 0.07);
  }

  /** Босс вступил в бой: низкий тревожный «рог» из двух нот. */
  bossHorn(): void {
    if (!this.ready()) return;
    const t0 = this.t;
    const notes = [
      [98, 0], // G2
      [73.42, 0.42], // D2
    ] as const;
    for (const [f, dt] of notes) {
      const t = t0 + dt;
      for (const mul of [1, 2, 3]) {
        const o = this.ctx!.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(f * mul, t);
        o.frequency.linearRampToValueAtTime(f * mul * 0.985, t + 1.1);
        const g = this.env(0.16 / mul, 0.06, 1.2, t, null);
        o.connect(g);
        o.start(t);
        o.stop(t + 1.4);
      }
    }
  }

  /** Босс повержен: короткая триумфальная фанфара (мажорный аккорд + арпеджио). */
  bossFanfare(): void {
    if (!this.ready()) return;
    const t0 = this.t;
    // Арпеджио вверх, затем звенящий аккорд.
    const arp = [392, 523.25, 659.25, 783.99, 1046.5];
    arp.forEach((f, i) => {
      const t = t0 + i * 0.1;
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t);
      const g = this.env(0.24, 0.008, 0.3, t, null);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.35);
    });
    const chordT = t0 + arp.length * 0.1;
    for (const f of [523.25, 659.25, 783.99, 1046.5]) {
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, chordT);
      const g = this.env(0.16, 0.02, 1.6, chordT, null);
      o.connect(g);
      o.start(chordT);
      o.stop(chordT + 1.8);
    }
  }

  /** Глоток: пара низких «бульков» и выдох. */
  drink(): void {
    if (!this.ready()) return;
    const t0 = this.t;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.11;
      // Низкий «бульк» плюс призвук повыше — от него глоток звонкий, а не глухой.
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(190 + i * 30, t);
      o.frequency.exponentialRampToValueAtTime(85 + i * 22, t + 0.09);
      const g = this.env(0.5, 0.004, 0.1, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.13);

      const hi = this.ctx!.createOscillator();
      hi.type = "sine";
      hi.frequency.setValueAtTime(640 + i * 90, t);
      hi.frequency.exponentialRampToValueAtTime(300 + i * 60, t + 0.06);
      const hg = this.env(0.16, 0.003, 0.06, t);
      hi.connect(hg);
      hi.start(t);
      hi.stop(t + 0.08);
    }
    // Выдох после глотка — короткий шум через полосовой фильтр.
    const t = t0 + 0.34;
    const n = this.noise();
    const bp = this.filter("bandpass", 1100, 0.7);
    const g = this.env(0.2, 0.02, 0.18, t);
    n.connect(bp).connect(g);
    n.start(t);
    n.stop(t + 0.22);
  }

  /** Короткий звонкий блип при подборе лута. */
  pickup(): void {
    if (!this.ready()) return;
    const t0 = this.t;
    [880, 1318.5].forEach((f, i) => {
      const t = t0 + i * 0.055;
      const o = this.ctx!.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(f, t);
      const g = this.env(0.16, 0.004, 0.12, t);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.16);
    });
  }

  playerHurt(): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.2);
    const g = this.env(0.5, 0.003, 0.24, t);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.28);
    const n = this.noise();
    const hp = this.filter("highpass", 900);
    const ng = this.env(0.18, 0.002, 0.09, t);
    n.connect(hp).connect(ng);
    n.start(t);
    n.stop(t + 0.12);
  }

  arrowHit(kind: "flesh" | "wood", vol = 1): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = kind === "wood" ? "square" : "sine";
    o.frequency.setValueAtTime(kind === "wood" ? 260 : 150, t);
    o.frequency.exponentialRampToValueAtTime(kind === "wood" ? 120 : 60, t + 0.09);
    const og = this.env((kind === "wood" ? 0.3 : 0.42) * vol, 0.002, 0.11, t);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.13);
    const n = this.noise();
    const f = this.filter(kind === "wood" ? "bandpass" : "highpass", kind === "wood" ? 1800 : 2400, 2);
    const ng = this.env(0.2 * vol, 0.001, 0.05, t);
    n.connect(f).connect(ng);
    n.start(t);
    n.stop(t + 0.07);
  }

  private ready(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }
}
