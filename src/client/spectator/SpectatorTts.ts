/**
 * Проигрывание озвучки чата на стриме. Сервер синтезирует mp3 (Fish Audio) и
 * шлёт спектатору путь `/tts/<id>.mp3`; здесь очередь — фетчим, декодируем в
 * общий AudioContext и играем по одному, чтобы реплики не наезжали.
 *
 * Этот модуль подгружается динамически — если озвучка на стриме выключена,
 * он в бандл спектатора вообще не тянется.
 */
export class SpectatorTts {
  private readonly queue: { url: string; nick: string }[] = [];
  /** Кто сейчас говорит (ник автора сообщения) или null, когда тихо — для значка в VR. */
  onSpeaking: ((nick: string | null) => void) | null = null;
  private playing = false;
  private readonly gain: GainNode;

  constructor(
    private readonly ctx: AudioContext,
    volume = 0.9,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = volume;
    this.gain.connect(ctx.destination);
  }

  setVolume(v: number): void {
    this.gain.gain.value = Math.max(0, Math.min(1, v));
  }

  enqueue(url: string, nick = ""): void {
    // Не копим бесконечно — на бурном чате старые реплики уже неактуальны.
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push({ url, nick });
    void this.pump();
  }

  /** Сбросить очередь (озвучку выключили в меню). Уже играющая реплика доиграет. */
  clear(): void {
    this.queue.length = 0;
  }

  private async pump(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        this.onSpeaking?.(item.nick || null);
        await this.playOne(item.url).catch((e) =>
          console.warn("[tts] не проиграл:", (e as Error).message),
        );
        this.onSpeaking?.(null);
      }
    } finally {
      this.playing = false;
    }
  }

  private async playOne(url: string): Promise<void> {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.arrayBuffer();
    // Колбэк-форма — надёжнее в старых Safari (как в Sfx).
    const buf = await new Promise<AudioBuffer>((ok, no) =>
      this.ctx.decodeAudioData(arr, ok, no),
    );
    await new Promise<void>((resolve) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      src.onended = () => resolve();
      src.start();
    });
  }
}
