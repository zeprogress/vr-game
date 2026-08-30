/**
 * Простые процедурные звуки на Web Audio (без файлов).
 * `resume()` нужно вызвать по жесту пользователя (клик / вход в VR).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private music: HTMLAudioElement | null = null;

  private ensure(): void {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 0.5);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  resume(): void {
    this.ensure();
    void this.ctx?.resume();
    void this.music?.play().catch(() => {});
  }

  /** Фоновая музыка: тихий бесконечный цикл. Стартует при первом resume(). */
  startMusic(url: string, volume = 0.12): void {
    if (this.music) return;
    const a = new Audio(url);
    a.loop = true;
    a.volume = volume;
    a.preload = "auto";
    this.music = a;
    void a.play().catch(() => {
      /* браузер ждёт жеста — доиграем в resume() */
    });
  }

  setMusicVolume(v: number): void {
    if (this.music) this.music.volume = Math.max(0, Math.min(1, v));
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

  private env(peak: number, attack: number, decay: number, t = this.t): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master!);
    return g;
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
    const n = this.noise();
    const lp = this.filter("lowpass", 340 + Math.random() * 200);
    const g = this.env(0.7 * vol, 0.004, 0.13, t);
    n.connect(lp).connect(g);
    n.start(t);
    n.stop(t + 0.18);
    // короткий низкий «толчок» для веса
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const og = this.env(0.28 * vol, 0.003, 0.1, t);
    o.connect(og);
    o.start(t);
    o.stop(t + 0.13);
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

  swordSwing(): void {
    if (!this.ready()) return;
    const t = this.t;
    const n = this.noise();
    const bp = this.filter("bandpass", 600, 3.5);
    bp.frequency.setValueAtTime(500, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.11);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.28);
    const g = this.env(0.32, 0.06, 0.24, t);
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

  mobHop(): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.1);
    const g = this.env(0.1, 0.005, 0.1, t);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.13);
  }

  mobHurt(): void {
    if (!this.ready()) return;
    const t = this.t;
    const o = this.ctx!.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.14);
    const lp = this.filter("lowpass", 1200);
    const g = this.env(0.3, 0.003, 0.15, t);
    o.connect(lp).connect(g);
    o.start(t);
    o.stop(t + 0.18);
  }

  mobDie(): void {
    if (!this.ready()) return;
    const t = this.t;
    const n = this.noise();
    const bp = this.filter("bandpass", 500, 1.5);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(150, t + 0.25);
    const g = this.env(0.4, 0.004, 0.28, t);
    n.connect(bp).connect(g);
    n.start(t);
    n.stop(t + 0.32);
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
