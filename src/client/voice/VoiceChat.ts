import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

import type { RtcMsg } from "#shared/net/messages";

export const VOICE = {
  /** Громче этого считаем, что человек говорит (среднеквадратичный уровень). */
  speakLevel: 0.025,
  /** Сколько держать микрофон открытым после последнего звука, с. */
  hangover: 0.6,
  /** Ближе этого голос звучит в полную силу, м. */
  refDistance: 2.5,
  /** Дальше этого уже практически не слышно, м. */
  maxDistance: 45,
  rolloff: 1.1,
  /** Публичные STUN — помогают узнать свой внешний адрес. */
  stun: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
  /**
   * Свой TURN на VPS — ретранслирует голос, когда прямое соединение между
   * игроками не проходит (симметричный NAT, CGNAT, VPN у одного из них).
   * Логин/пароль общие: для игры на пару человек трафик копеечный.
   */
  turn: {
    urls: ["turn:zepgame.duckdns.org:3478?transport=udp", "turn:zepgame.duckdns.org:3478?transport=tcp"],
    username: "vrgame",
    credential: "slime-boss-2026",
  },
} as const;

/** Список ICE-серверов для RTCPeerConnection. */
export function iceServers(): RTCIceServer[] {
  return [{ urls: [...VOICE.stun] }, { ...VOICE.turn, urls: [...VOICE.turn.urls] }];
}

/** Состояние связи с одним собеседником — его показывает панель. */
export type PeerState = "новый" | "соединяется" | "говорим" | "нет связи";

interface Peer {
  pc: RTCPeerConnection;
  /** Кто начинает разговор: тот, у кого id меньше. Так не бывает встречных звонков. */
  caller: boolean;
  el: HTMLAudioElement | null;
  source: MediaStreamAudioSourceNode | null;
  panner: PannerNode | null;
  gain: GainNode | null;
  analyser: AnalyserNode | null;
  buf: Float32Array | null;
  speaking: boolean;
  state: PeerState;
  // --- запасной путь: голос через сервер ---
  /** true — WebRTC не встал, слушаем через сервер. */
  useRelay: boolean;
  /** Таймер: если за N секунд WebRTC не соединился — включаем relay. */
  relayTimer: ReturnType<typeof setTimeout> | null;
  /** Декодер opus для этого собеседника. */
  decoder: AudioDecoder | null;
  /** Вход в звуковую схему для relay-пакетов. */
  relayIn: GainNode | null;
  /** Куда планировать следующий кусок (сек. AudioContext). */
  playAt: number;
}

/** WebCodecs есть не везде (нужен для голоса через сервер). */
const CODECS_OK =
  typeof AudioEncoder !== "undefined" &&
  typeof AudioDecoder !== "undefined" &&
  typeof (globalThis as { MediaStreamTrackProcessor?: unknown }).MediaStreamTrackProcessor !==
    "undefined";

interface TrackProcessor {
  readable: ReadableStream<AudioData>;
}
type TrackProcessorCtor = new (o: { track: MediaStreamTrack }) => TrackProcessor;

/**
 * Голосовой чат: разговор идёт напрямую между игроками (WebRTC), игровой
 * сервер только сводит их друг с другом.
 *
 * Микрофон открывается сам, когда человек говорит, и закрывается в тишине —
 * в шлеме свободных кнопок под «нажми, чтобы говорить» попросту нет.
 * Голос можно слушать по месту (дальние тише, слева — слева) или всех ровно.
 */
export class VoiceChat {
  private readonly peers = new Map<string, Peer>();
  private selfId = "";
  private local: MediaStream | null = null;
  private localTrack: MediaStreamTrack | null = null;
  /** Клон дорожки для замера громкости — он всегда включён (см. start). */
  private monitorTrack: MediaStreamTrack | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localBuf: Float32Array | null = null;
  private speakTimer = 0;

  // --- голос через сервер (запасной путь) ---
  private encoder: AudioEncoder | null = null;
  private encoderStarted = false;

  /** Отправка служебного пакета — её задаёт Game. */
  send: ((msg: RtcMsg) => void) | null = null;
  /** Отправка opus-пакета голоса через сервер — её задаёт Game. */
  sendVoice: ((t: number, d: number[]) => void) | null = null;
  /** Где сейчас голова этого игрока (для звука по месту). null — не знаем. */
  peerPosition: ((id: string) => Vector3 | null) | null = null;
  /** Кто-то заговорил или замолчал — Game зажигает значок над аватаром. */
  onSpeaking: ((id: string, speaking: boolean) => void) | null = null;
  /** Связь с игроком не установилась — игрок должен об этом узнать. */
  onPeerFailed: ((id: string) => void) | null = null;
  /** Смена состояния связи с игроком — для сообщений в HUD. */
  onPeerState: ((id: string, state: PeerState) => void) | null = null;

  /** Микрофон включён (иначе молчим, но слушаем). */
  micEnabled = true;
  /** Слышать по месту или всех ровно. */
  spatial = true;
  /** Свой голос сейчас идёт в эфир. */
  speaking = false;
  /** Почему нет голоса — для честного сообщения игроку. */
  micError: string | null = null;

  constructor(private readonly ctx: AudioContext) {}

  /** Спросить микрофон. Зовётся сразу после входа: там уже был жест игрока. */
  async start(selfId: string): Promise<boolean> {
    this.selfId = selfId;
    if (this.local) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.micError = "браузер не даёт доступ к микрофону";
      return false;
    }
    try {
      this.local = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
    } catch (e) {
      this.micError = (e as Error).name === "NotAllowedError" ? "доступ не разрешён" : "микрофон не найден";
      console.warn("[voice] микрофон недоступен:", (e as Error).message);
      return false;
    }

    this.localTrack = this.local.getAudioTracks()[0] ?? null;
    if (this.localTrack) this.localTrack.enabled = false; // до первого звука молчим

    // Свой уровень слушаем по КЛОНУ дорожки. У выключенной (enabled=false)
    // дорожки все потребители — включая этот анализатор — получают тишину,
    // поэтому по самой localTrack триггер по громкости не сработал бы никогда.
    this.monitorTrack = this.localTrack?.clone() ?? null;
    const monitorStream = this.monitorTrack
      ? new MediaStream([this.monitorTrack])
      : this.local;
    const src = this.ctx.createMediaStreamSource(monitorStream);
    this.localAnalyser = this.ctx.createAnalyser();
    this.localAnalyser.fftSize = 1024;
    src.connect(this.localAnalyser);
    this.localBuf = new Float32Array(this.localAnalyser.fftSize);

    // Пиры, заведённые до того как дали микрофон, остались без исходящей
    // дорожки — досылаем её. У звонящего это поднимет пере-договор (offer),
    // и связь наконец получает звук в обе стороны.
    for (const [id, peer] of this.peers) {
      this.addLocalTracks(peer);
      if (peer.caller) void this.renegotiate(id, peer);
    }
    return true;
  }

  /** Добавить свою аудиодорожку пиру, если её там ещё нет. */
  private addLocalTracks(peer: Peer): void {
    if (!this.local) return;
    const has = peer.pc.getSenders().some((s) => s.track?.kind === "audio");
    if (has) return;
    for (const t of this.local.getTracks()) peer.pc.addTrack(t, this.local);
  }

  /** Звонящий заново шлёт offer (после добавления дорожки или смены медиа). */
  private async renegotiate(id: string, peer: Peer): Promise<void> {
    if (!peer.caller || peer.pc.signalingState !== "stable") return;
    try {
      const offer = await peer.pc.createOffer({ offerToReceiveAudio: true });
      await peer.pc.setLocalDescription(offer);
      this.send?.({ peer: id, kind: "offer", data: JSON.stringify(peer.pc.localDescription) });
    } catch (e) {
      console.warn("[voice] пере-договор не удался:", (e as Error).message);
    }
  }

  /** Появился игрок — заводим с ним связь. */
  addPeer(id: string): void {
    if (id === this.selfId || this.peers.has(id)) return;

    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    // Звонит тот, у кого id меньше: иначе оба звонят разом и связь путается.
    const caller = this.selfId < id;
    const peer: Peer = {
      pc,
      caller,
      el: null,
      source: null,
      panner: null,
      gain: null,
      analyser: null,
      buf: null,
      speaking: false,
      state: "новый",
      useRelay: false,
      relayTimer: null,
      decoder: null,
      relayIn: null,
      playAt: 0,
    };
    this.peers.set(id, peer);

    // WebRTC не встал за 7 с — включаем запасной путь через сервер.
    if (CODECS_OK) {
      peer.relayTimer = setTimeout(() => {
        if (peer.state !== "говорим") this.enableRelay(id);
      }, 7000);
    }

    this.addLocalTracks(peer);
    pc.onnegotiationneeded = () => void this.renegotiate(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send?.({ peer: id, kind: "ice", data: JSON.stringify(e.candidate) });
      }
    };
    pc.ontrack = (e) => this.attachRemote(peer, e.streams[0]);
    pc.oniceconnectionstatechange = () => {
      console.log(`[voice] ${id}: ICE ${pc.iceConnectionState}`);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      const next: PeerState =
        st === "connected" ? "говорим" : st === "failed" || st === "closed" ? "нет связи" : "соединяется";
      if (next !== peer.state) {
        peer.state = next;
        this.onPeerState?.(id, next);
      }
      console.log(`[voice] ${id}: соединение ${st}`);
      if (st === "connected") this.disableRelay(id); // WebRTC ожил — relay не нужен
      if (st === "failed") {
        if (CODECS_OK) {
          console.warn(`[voice] с ${id} прямой связи нет — перехожу на голос через сервер`);
          this.enableRelay(id);
        } else {
          console.warn(`[voice] с ${id} связь не установилась (WebCodecs недоступен)`);
          this.onPeerFailed?.(id);
        }
      }
    };

    // Первый offer шлём всегда — даже без своей дорожки (mic ещё спрашивается):
    // важно поднять ICE как можно раньше, дорожку добавит renegotiate.
    if (caller) void this.renegotiate(id, peer);
  }

  removePeer(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.relayTimer) clearTimeout(p.relayTimer);
    p.pc.close();
    p.el?.pause();
    if (p.el) p.el.srcObject = null;
    p.source?.disconnect();
    p.relayIn?.disconnect();
    p.panner?.disconnect();
    p.gain?.disconnect();
    try {
      p.decoder?.close();
    } catch {
      /* уже закрыт */
    }
    this.peers.delete(id);
    if (p.speaking) this.onSpeaking?.(id, false);
  }

  /** Пришёл служебный пакет от другого игрока. */
  async handle(msg: RtcMsg): Promise<void> {
    if (!msg?.peer) return;
    if (!this.peers.has(msg.peer)) this.addPeer(msg.peer);
    const peer = this.peers.get(msg.peer);
    if (!peer) return;

    try {
      if (msg.kind === "offer") {
        this.addLocalTracks(peer); // mic мог подъехать уже после addPeer
        await peer.pc.setRemoteDescription(JSON.parse(msg.data) as RTCSessionDescriptionInit);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send?.({ peer: msg.peer, kind: "answer", data: JSON.stringify(peer.pc.localDescription) });
      } else if (msg.kind === "answer") {
        await peer.pc.setRemoteDescription(JSON.parse(msg.data) as RTCSessionDescriptionInit);
      } else {
        await peer.pc.addIceCandidate(JSON.parse(msg.data) as RTCIceCandidateInit);
      }
    } catch (e) {
      console.warn(`[voice] пакет ${msg.kind} от ${msg.peer} не принят:`, (e as Error).message);
    }
  }

  /** Подключить чужой голос к звуковой схеме. */
  private attachRemote(peer: Peer, stream: MediaStream | undefined): void {
    if (!stream || peer.source) return;

    // Без «немого» проигрывателя Chrome не начинает тянуть поток, и в
    // Web Audio приходит тишина. Звук при этом идёт через наши узлы.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    void el.play().catch(() => {});
    peer.el = el;

    this.ensureNodes(peer);
    peer.source = this.ctx.createMediaStreamSource(stream);

    peer.analyser = this.ctx.createAnalyser();
    peer.analyser.fftSize = 512;
    peer.buf = new Float32Array(peer.analyser.fftSize);
    peer.source.connect(peer.analyser);

    this.wire(peer);
  }

  /** Общие узлы собеседника (паннер + гейн + вход для relay). */
  private ensureNodes(peer: Peer): void {
    if (peer.gain) return;
    peer.gain = this.ctx.createGain();
    peer.panner = this.ctx.createPanner();
    peer.panner.panningModel = "HRTF";
    peer.panner.distanceModel = "inverse";
    peer.panner.refDistance = VOICE.refDistance;
    peer.panner.maxDistance = VOICE.maxDistance;
    peer.panner.rolloffFactor = VOICE.rolloff;
    peer.relayIn = this.ctx.createGain();
  }

  /** Активный источник голоса: relay или прямой WebRTC. */
  private voiceInput(peer: Peer): AudioNode | null {
    return peer.useRelay ? peer.relayIn : peer.source;
  }

  /** Пересобрать цепочку под текущий режим «по месту / ровно». */
  private wire(peer: Peer): void {
    const input = this.voiceInput(peer);
    if (!input || !peer.gain || !peer.panner) return;
    peer.source?.disconnect();
    peer.relayIn?.disconnect();
    peer.panner.disconnect();
    peer.gain.disconnect();
    if (peer.analyser && peer.source && !peer.useRelay) peer.source.connect(peer.analyser);

    if (this.spatial) {
      input.connect(peer.panner);
      peer.panner.connect(peer.gain);
    } else {
      input.connect(peer.gain);
    }
    peer.gain.connect(this.ctx.destination);
  }

  // ---- голос через сервер (когда WebRTC не встал) ----

  private enableRelay(id: string): void {
    const peer = this.peers.get(id);
    if (!peer || peer.useRelay || !CODECS_OK) return;
    peer.useRelay = true;
    if (peer.relayTimer) {
      clearTimeout(peer.relayTimer);
      peer.relayTimer = null;
    }
    this.ensureNodes(peer);
    peer.playAt = 0;

    peer.decoder = new AudioDecoder({
      output: (frame) => this.playFrame(peer, frame),
      error: (e) => console.warn(`[voice] декодер ${id}:`, e.message),
    });
    peer.decoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 1 });

    this.wire(peer);
    this.startEncoder();
    console.log(`[voice] ${id}: голос через сервер`);
    if (peer.state !== "говорим") {
      peer.state = "говорим";
      this.onPeerState?.(id, "говорим");
    }
  }

  private disableRelay(id: string): void {
    const peer = this.peers.get(id);
    if (!peer?.useRelay) return;
    peer.useRelay = false;
    try {
      peer.decoder?.close();
    } catch {
      /* уже закрыт */
    }
    peer.decoder = null;
    if (peer.source) this.wire(peer);
  }

  /** Один общий энкодер: тянет PCM с микрофона и шлёт opus, пока кто-то на relay. */
  private startEncoder(): void {
    if (this.encoderStarted || !CODECS_OK) return;
    const feed = this.monitorTrack ?? this.localTrack;
    if (!feed) return;
    this.encoderStarted = true;

    this.encoder = new AudioEncoder({
      output: (chunk) => {
        if (!this.micEnabled || !this.speaking || !this.anyRelay()) return;
        const buf = new Uint8Array(chunk.byteLength);
        chunk.copyTo(buf);
        this.sendVoice?.(chunk.timestamp, Array.from(buf));
      },
      error: (e) => console.warn("[voice] энкодер:", e.message),
    });
    this.encoder.configure({
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: 1,
      bitrate: 20000,
    });

    const Ctor = (globalThis as unknown as { MediaStreamTrackProcessor: TrackProcessorCtor })
      .MediaStreamTrackProcessor;
    const proc = new Ctor({ track: feed });
    const reader = proc.readable.getReader();
    const pump = async (): Promise<void> => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (
          this.encoder?.state === "configured" &&
          this.anyRelay() &&
          this.micEnabled &&
          this.speaking
        ) {
          try {
            this.encoder.encode(value);
          } catch {
            /* энкодер занят */
          }
        }
        value.close();
      }
    };
    void pump();
  }

  private anyRelay(): boolean {
    for (const p of this.peers.values()) if (p.useRelay) return true;
    return false;
  }

  /** Пришёл opus-пакет от собеседника через сервер. */
  onVoicePacket(id: string, t: number, data: number[]): void {
    const peer = this.peers.get(id);
    if (!peer?.useRelay || peer.decoder?.state !== "configured") return;
    try {
      peer.decoder.decode(
        new EncodedAudioChunk({ type: "key", timestamp: t, data: new Uint8Array(data) }),
      );
    } catch (e) {
      console.warn(`[voice] пакет от ${id} не декодирован:`, (e as Error).message);
    }
  }

  /** Декодированный кусок -> в звуковую схему, встык к предыдущему. */
  private playFrame(peer: Peer, frame: AudioData): void {
    if (!peer.relayIn) {
      frame.close();
      return;
    }
    const frames = frame.numberOfFrames;
    const sr = frame.sampleRate;
    const ab = this.ctx.createBuffer(1, frames, sr);
    const tmp = new Float32Array(frames);
    frame.copyTo(tmp, { planeIndex: 0, format: "f32-planar" });
    ab.copyToChannel(tmp, 0);
    frame.close();

    const src = this.ctx.createBufferSource();
    src.buffer = ab;
    src.connect(peer.relayIn);
    const now = this.ctx.currentTime;
    // Небольшой буфер (0.12 с), чтобы сгладить джиттер сети.
    peer.playAt = Math.max(peer.playAt, now + 0.12);
    src.start(peer.playAt);
    peer.playAt += ab.duration;

    // Огонёк «говорит» — по факту приходящего звука.
    if (!peer.speaking) {
      peer.speaking = true;
      this.onSpeaking?.(this.idOf(peer), true);
      clearTimeout(peer.relayTimer as ReturnType<typeof setTimeout>);
      peer.relayTimer = setTimeout(() => {
        peer.speaking = false;
        this.onSpeaking?.(this.idOf(peer), false);
      }, 400);
    } else {
      clearTimeout(peer.relayTimer as ReturnType<typeof setTimeout>);
      peer.relayTimer = setTimeout(() => {
        peer.speaking = false;
        this.onSpeaking?.(this.idOf(peer), false);
      }, 400);
    }
  }

  private idOf(peer: Peer): string {
    for (const [id, p] of this.peers) if (p === peer) return id;
    return "";
  }

  /** Переключить режим слышимости на лету. */
  setSpatial(on: boolean): void {
    if (on === this.spatial) return;
    this.spatial = on;
    for (const p of this.peers.values()) this.wire(p);
  }

  /**
   * Каждый кадр: свой уровень, чужие уровни, позиции для звука по месту.
   *
   * «Уши» здесь НЕ трогаем: слушатель у AudioContext один на всех, и владеет
   * им Sfx (Game зовёт setListener каждый кадр). Раньше голос перетирал их
   * своими координатами — без инверсии Z, — и все объёмные звуки оказывались
   * отражены: моб впереди звучал сзади, а при ходьбе звук уезжал не туда.
   */
  update(dt: number): void {
    this.updateMic(dt);

    for (const [id, p] of this.peers) {
      if (this.spatial && p.panner) {
        const pos = this.peerPosition?.(id);
        // Z инвертируем — как в Sfx: оси Web Audio против Babylon.
        if (pos) setPos(p.panner, pos.x, pos.y, -pos.z);
      }
      if (p.analyser && p.buf) {
        const talking = rms(p.analyser, p.buf) > VOICE.speakLevel;
        if (talking !== p.speaking) {
          p.speaking = talking;
          this.onSpeaking?.(id, talking);
        }
      }
    }
  }

  /**
   * Дорожка WebRTC открыта всё время, пока микрофон включён — так надёжнее
   * (эхо/шум глушит сам браузер). Замер громкости оставляем только для
   * значка «говорит» над аватаром и для экономии трафика в relay.
   */
  private updateMic(dt: number): void {
    const track = this.localTrack;
    if (!track) return;
    if (track.enabled !== this.micEnabled) track.enabled = this.micEnabled;
    if (!this.micEnabled) {
      if (this.speaking) this.speaking = false;
      return;
    }
    if (!this.localAnalyser || !this.localBuf) return;

    if (rms(this.localAnalyser, this.localBuf) > VOICE.speakLevel) {
      this.speakTimer = VOICE.hangover;
    } else {
      this.speakTimer = Math.max(0, this.speakTimer - dt);
    }
    this.speaking = this.speakTimer > 0;
  }


  /** Что с кем происходит — для сообщения игроку. */
  status(): { peers: number; connected: number; states: string[] } {
    const states = [...this.peers.values()].map((p) => p.state);
    return {
      peers: this.peers.size,
      connected: states.filter((s) => s === "говорим").length,
      states,
    };
  }

  dispose(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    try {
      this.encoder?.close();
    } catch {
      /* уже закрыт */
    }
    this.encoder = null;
    this.encoderStarted = false;
    this.local?.getTracks().forEach((t) => t.stop());
    this.monitorTrack?.stop();
    this.local = null;
    this.localTrack = null;
    this.monitorTrack = null;
    this.localAnalyser = null;
  }
}

/** Средний уровень сигнала 0..1. */
function rms(an: AnalyserNode, buf: Float32Array): number {
  an.getFloatTimeDomainData(buf as unknown as Float32Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** У старых браузеров позиция задаётся методом, у новых — параметрами. */
function setPos(
  node: { positionX?: AudioParam; positionY?: AudioParam; positionZ?: AudioParam; setPosition?: (x: number, y: number, z: number) => void },
  x: number,
  y: number,
  z: number,
): void {
  if (node.positionX) {
    node.positionX.value = x;
    node.positionY!.value = y;
    node.positionZ!.value = z;
  } else {
    node.setPosition?.(x, y, z);
  }
}
