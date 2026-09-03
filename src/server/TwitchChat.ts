import WebSocket from "ws";

type ChatHandler = (nick: string, text: string) => void;

/** Не чаще одного сообщения в чат раз в столько мс (у Twitch лимит 20/30 с). */
const SEND_GAP_MS = 1600;
/** Скользящее окно на всякий случай — если очередь вдруг длинная. */
const WINDOW_MS = 30_000;
const WINDOW_MAX = 18;
/** Длиннее Twitch всё равно обрежет. */
const MAX_LEN = 460;
/** Больше этого в очереди не копим — лучше потерять, чем отвечать с минутным лагом. */
const QUEUE_MAX = 8;

/**
 * Чат Twitch по IRC-over-WebSocket. Сам переподключается.
 *
 * Читает всегда. Писать умеет, только если заданы `TWITCH_BOT_USER` и
 * `TWITCH_OAUTH` (токен с правами chat:read + chat:edit) — анонимный логин
 * `justinfan…` отправлять сообщения не может. Если токен не принят, тихо
 * откатываемся на анонимное чтение: команды `!play` и прочие продолжают
 * работать, просто без ответов в чат.
 */
export class TwitchChat {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectMs = 2000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly channel: string;

  private readonly botUser: string;
  private readonly oauth: string;
  /** Токен отвергли — дальше подключаемся анонимно и не пробуем писать. */
  private authFailed = false;
  private ready = false;
  private readonly queue: string[] = [];
  private sentAt: number[] = [];
  /** Что мы недавно отправили — чтобы отличить эхо своего ответа от живого сообщения. */
  private readonly recentSent: { t: number; text: string }[] = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private warnedNoAuth = false;

  constructor(
    channel: string,
    private readonly onMessage: ChatHandler,
    /** Логин аккаунта-бота и его токен. Пусто — только чтение. */
    auth: { user?: string; token?: string } = {},
  ) {
    this.channel = channel.toLowerCase().replace(/^#/, "").trim();
    this.botUser = (auth.user ?? "").toLowerCase().replace(/^@/, "").trim();
    // Токен принимаем и с префиксом `oauth:`, и без него.
    this.oauth = (auth.token ?? "").trim().replace(/^oauth:/i, "");
  }

  /** Можем ли писать в чат (заданы логин и токен, и он ещё не отвергнут). */
  get canSend(): boolean {
    return !!this.botUser && !!this.oauth && !this.authFailed;
  }

  start(): void {
    if (!this.channel || this.channel.includes(" ")) {
      console.log(`[twitch] канал не задан ("${this.channel}") — чат отключён`);
      return;
    }
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.pingTimer = this.drainTimer = null;
    this.queue.length = 0;
    this.ws?.close();
    this.ws = null;
  }

  /** Написать в чат канала. Без токена — тихо ничего не делает. */
  say(text: string): void {
    if (!this.canSend) {
      if (!this.warnedNoAuth) {
        this.warnedNoAuth = true;
        console.log("[twitch] ответы в чат выключены: нет TWITCH_BOT_USER / TWITCH_OAUTH");
      }
      return;
    }
    const clean = text.replace(/[\r\n]+/g, " ").trim().slice(0, MAX_LEN);
    if (!clean) return;
    if (this.queue.length >= QUEUE_MAX) return;
    this.queue.push(clean);
    if (!this.ready) console.log("[twitch] сокет не готов — реплика в очереди");
    this.drain();
  }

  private drain(): void {
    if (this.drainTimer || this.queue.length === 0) return;
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    this.sentAt = this.sentAt.filter((t) => now - t < WINDOW_MS);
    const last = this.sentAt[this.sentAt.length - 1] ?? 0;
    let wait = Math.max(0, last + SEND_GAP_MS - now);
    if (this.sentAt.length >= WINDOW_MAX) {
      wait = Math.max(wait, this.sentAt[0] + WINDOW_MS - now);
    }
    if (wait > 0) {
      this.drainTimer = setTimeout(() => {
        this.drainTimer = null;
        this.drain();
      }, wait);
      return;
    }

    const msg = this.queue.shift();
    if (!msg) return;
    this.sentAt.push(now);
    this.ws.send(`PRIVMSG #${this.channel} :${msg}`);
    this.recentSent.push({ t: now, text: msg });
    if (this.recentSent.length > 12) this.recentSent.shift();
    console.log(`[twitch] -> ${msg.slice(0, 80)}`);
    if (this.queue.length > 0) this.drain();
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws = ws;
    this.ready = false;

    ws.on("open", () => {
      this.reconnectMs = 2000;
      if (this.canSend) {
        ws.send(`PASS oauth:${this.oauth}`);
        ws.send(`NICK ${this.botUser}`);
      } else {
        ws.send("PASS SCHMOOPIIE");
        ws.send(`NICK justinfan${Math.floor(Math.random() * 90000 + 10000)}`);
      }
      ws.send(`JOIN #${this.channel}`);
      this.ready = true;
      console.log(
        `[twitch] подключён к чату #${this.channel}` +
          (this.canSend ? ` как ${this.botUser} (может отвечать)` : " (только чтение)"),
      );
      // Twitch рвёт тихие соединения — шлём свой PING раз в 4 мин.
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => ws.send("PING :tmi.twitch.tv"), 240_000);
      this.drain();
    });

    ws.on("message", (data: WebSocket.Data) => this.onData(String(data)));
    ws.on("error", (e: Error) => {
      if (!this.closed) console.log(`[twitch] ошибка: ${e.message}`);
    });
    ws.on("close", () => {
      this.ws = null;
      this.ready = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.closed) return;
      console.log(`[twitch] отключён, переподключение через ${this.reconnectMs} мс`);
      setTimeout(() => this.connect(), this.reconnectMs);
      this.reconnectMs = Math.min(this.reconnectMs * 2, 60_000);
    });
  }

  private onData(raw: string): void {
    for (const line of raw.split("\r\n")) {
      if (line === "") continue;
      if (line.startsWith("PING")) {
        this.ws?.send(line.replace("PING", "PONG"));
        continue;
      }
      // Twitch объясняет отказы в NOTICE: неподтверждённая почта, followers-only,
      // лимит темпа, бан. Без этого «сообщение не появилось» неотличимо от «не отправляли».
      if (line.includes("NOTICE")) console.log(`[twitch] NOTICE: ${line.slice(0, 200)}`);
      // Токен протух или неверен — Twitch отвечает NOTICE и рвёт соединение.
      if (line.includes("NOTICE") && /authentication failed|improperly formatted auth/i.test(line)) {
        this.authFailed = true;
        this.queue.length = 0;
        console.log(
          "[twitch] токен не принят — дальше только чтение. " +
            "Обнови TWITCH_OAUTH в deploy/stream.env (токены Twitch протухают).",
        );
        continue;
      }
      // :login!login@login.tmi.twitch.tv PRIVMSG #chan :text
      const m = line.match(/^:(\w+)!\w+@[\w.]+ PRIVMSG #\S+ :(.*)$/);
      if (!m) continue;
      const nick = m[1];
      const text = m[2].replace(/[\r\n]/g, "").trim();
      // Отбрасываем только ЭХО собственного ответа, а не всё от нашего ника:
      // аккаунт бота часто совпадает с аккаунтом стримера, и фильтр по нику
      // глушил его же команды (!play, !info) в собственном чате.
      if (this.botUser && nick.toLowerCase() === this.botUser) {
        const t = Date.now();
        if (this.recentSent.some((r) => t - r.t < 15_000 && r.text === text)) continue;
      }
      try {
        this.onMessage(nick, text);
      } catch (e) {
        console.log(`[twitch] обработчик упал: ${(e as Error).message}`);
      }
    }
  }
}
