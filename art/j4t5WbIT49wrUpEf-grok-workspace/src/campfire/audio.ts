type CampAudio = {
  resume: () => void;
  setMuted: (muted: boolean) => void;
  dispose: () => void;
};

function makeNoiseBuffer(ctx: AudioContext, seconds = 2) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.2;
  }
  return buffer;
}

export function createCampfireAudio(): CampAudio {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const noise = ctx.createBufferSource();
  noise.buffer = makeNoiseBuffer(ctx, 3);
  noise.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 720;
  filter.Q.value = 0.7;

  const rumble = ctx.createBiquadFilter();
  rumble.type = "lowpass";
  rumble.frequency.value = 180;

  const crackleGain = ctx.createGain();
  crackleGain.gain.value = 0.9;
  const rumbleGain = ctx.createGain();
  rumbleGain.gain.value = 0.45;

  noise.connect(filter);
  noise.connect(rumble);
  filter.connect(crackleGain).connect(master);
  rumble.connect(rumbleGain).connect(master);
  noise.start();

  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.35;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 90;
  lfo.connect(lfoGain).connect(filter.frequency);
  lfo.start();

  let popTimer = 0;
  let stopped = false;
  const pops: AudioBufferSourceNode[] = [];

  const pop = () => {
    if (stopped) return;
    const src = ctx.createBufferSource();
    src.buffer = makeNoiseBuffer(ctx, 0.08);
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.35 + Math.random() * 0.25, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.07 + Math.random() * 0.05);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 1400;
    bp.Q.value = 1.4;
    src.connect(bp).connect(g).connect(master);
    src.start();
    src.stop(now + 0.2);
    pops.push(src);
    src.onended = () => {
      const i = pops.indexOf(src);
      if (i >= 0) pops.splice(i, 1);
    };
  };

  const tick = () => {
    if (stopped) return;
    popTimer += 16;
    if (popTimer > 220 + Math.random() * 520) {
      pop();
      popTimer = 0;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  let muted = false;
  const applyGain = () => {
    const target = muted ? 0 : 0.055;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.18);
  };

  return {
    resume: () => {
      void ctx.resume();
      applyGain();
    },
    setMuted: (next) => {
      muted = next;
      applyGain();
    },
    dispose: () => {
      stopped = true;
      void ctx.close();
    },
  };
}
