import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

import type { RtcMsg } from "#shared/net/messages";

export const VOICE = {
  /** Громче этого считаем, что человек говорит (среднеквадратичный уровень). */
  speakLevel: 0.045,
  /** Сколько держать микрофон открытым после последнего звука, с. */
  hangover: 0.6,
  /** Ближе этого голос звучит в полную силу, м. */
  refDistance: 2.5,
  /** Дальше этого уже практически не слышно, м. */
  maxDistance: 45,
  rolloff: 1.1,
  /** Публичные STUN — без них соединение не найдёт путь наружу. */
  stun: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
} as const;

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
}

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
  private localAnalyser: AnalyserNode | null = null;
  private localBuf: Float32Array | null = null;
  private speakTimer = 0;

  /** Отправка служебного пакета — её задаёт Game. */
  send: ((msg: RtcMsg) => void) | null = null;
  /** Где сейчас голова этого игрока (для звука по месту). null — не знаем. */
  peerPosition: ((id: string) => Vector3 | null) | null = null;
  /** Кто-то заговорил или замолчал — Game зажигает значок над аватаром. */
  onSpeaking: ((id: string, speaking: boolean) => void) | null = null;
  /** Связь с игроком не установилась — игрок должен об этом узнать. */
  onPeerFailed: ((id: string) => void) | null = null;

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

    // Свой уровень слушаем отдельным узлом — в динамики он не идёт.
    const src = this.ctx.createMediaStreamSource(this.local);
    this.localAnalyser = this.ctx.createAnalyser();
    this.localAnalyser.fftSize = 1024;
    src.connect(this.localAnalyser);
    this.localBuf = new Float32Array(this.localAnalyser.fftSize);
    return true;
  }

  /** Появился игрок — заводим с ним связь. */
  addPeer(id: string): void {
    if (id === this.selfId || this.peers.has(id)) return;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: [...VOICE.stun] }] });
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
    };
    this.peers.set(id, peer);

    if (this.local) for (const t of this.local.getTracks()) pc.addTrack(t, this.local);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.send?.({ peer: id, kind: "ice", data: JSON.stringify(e.candidate) });
      }
    };
    pc.ontrack = (e) => this.attachRemote(peer, e.streams[0]);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      peer.state =
        st === "connected" ? "говорим" : st === "failed" || st === "closed" ? "нет связи" : "соединяется";
      if (st === "failed") {
        console.warn(`[voice] с ${id} связь не установилась — обычно это VPN или строгий NAT`);
        this.onPeerFailed?.(id);
      }
    };

    if (caller) {
      void (async () => {
        try {
          const offer = await pc.createOffer({ offerToReceiveAudio: true });
          await pc.setLocalDescription(offer);
          this.send?.({ peer: id, kind: "offer", data: JSON.stringify(pc.localDescription) });
        } catch (e) {
          console.warn("[voice] не смог позвать:", (e as Error).message);
        }
      })();
    }
  }

  removePeer(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.el?.pause();
    if (p.el) p.el.srcObject = null;
    p.source?.disconnect();
    p.panner?.disconnect();
    p.gain?.disconnect();
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

    peer.source = this.ctx.createMediaStreamSource(stream);
    peer.gain = this.ctx.createGain();
    peer.panner = this.ctx.createPanner();
    peer.panner.panningModel = "HRTF";
    peer.panner.distanceModel = "inverse";
    peer.panner.refDistance = VOICE.refDistance;
    peer.panner.maxDistance = VOICE.maxDistance;
    peer.panner.rolloffFactor = VOICE.rolloff;

    peer.analyser = this.ctx.createAnalyser();
    peer.analyser.fftSize = 512;
    peer.buf = new Float32Array(peer.analyser.fftSize);
    peer.source.connect(peer.analyser);

    this.wire(peer);
  }

  /** Пересобрать цепочку под текущий режим «по месту / ровно». */
  private wire(peer: Peer): void {
    if (!peer.source || !peer.gain || !peer.panner) return;
    peer.source.disconnect();
    peer.panner.disconnect();
    peer.gain.disconnect();
    if (peer.analyser) peer.source.connect(peer.analyser);

    if (this.spatial) {
      peer.source.connect(peer.panner);
      peer.panner.connect(peer.gain);
    } else {
      peer.source.connect(peer.gain);
    }
    peer.gain.connect(this.ctx.destination);
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

  /** Микрофон открывается на голос и закрывается в тишине. */
  private updateMic(dt: number): void {
    const track = this.localTrack;
    if (!track) return;
    if (!this.micEnabled) {
      if (track.enabled) track.enabled = false;
      if (this.speaking) this.speaking = false;
      return;
    }
    if (!this.localAnalyser || !this.localBuf) return;

    if (rms(this.localAnalyser, this.localBuf) > VOICE.speakLevel) {
      this.speakTimer = VOICE.hangover; // говорим — держим открытым
    } else {
      this.speakTimer = Math.max(0, this.speakTimer - dt);
    }
    const on = this.speakTimer > 0;
    if (track.enabled !== on) track.enabled = on;
    this.speaking = on;
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
    this.local?.getTracks().forEach((t) => t.stop());
    this.local = null;
    this.localTrack = null;
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
