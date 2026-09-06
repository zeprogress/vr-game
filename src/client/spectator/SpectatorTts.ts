/**
 * Проигрывание озвучки чата на стриме. Сервер синтезирует mp3 (Fish Audio) и
 * шлёт спектатору путь `/tts/<id>.mp3`; здесь очередь — фетчим, декодируем в
 * общий AudioContext и играем по одному, чтобы реплики не наезжали.
 *
 * Этот модуль подгружается динамически — если озвучка на стриме выключена,
 * он в бандл спектатора вообще не тянется.
 */
export class SpectatorTts {
  private readonly queue: string[] = [];
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

  enqueue(url: string): void {
    // Не копим бесконечно — на бурном чате старые реплики уже неактуальны.
    if (this.queue.length >= 4) this.queue.shift();
    this.queue.push(url);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.queue.length) {
        const url = this.queue.shift()!;
        await this.playOne(url).catch((e) =>
          console.warn("[tts] не проиграл:", (e as Error).message),
        );
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
