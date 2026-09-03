import WebSocket from "ws";

type ChatHandler = (nick: string, text: string) => void;

/**
 * Анонимное чтение чата Twitch по IRC-over-WebSocket (логин `justinfan…` —
 * без токена, только чтение). Отдаёт каждое сообщение как `(nick, text)`.
 * Сам переподключается. Отправлять в чат не умеет (и не нужно).
 */
export class TwitchChat {
  private ws: WebSocket | null = null;
  private closed = false;
  private reconnectMs = 2000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly channel: string;

  constructor(
    channel: string,
    private readonly onMessage: ChatHandler,
  ) {
    this.channel = channel.toLowerCase().replace(/^#/, "").trim();
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
    this.pingTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (this.closed) return;
    const ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectMs = 2000;
      ws.send("PASS SCHMOOPIIE");
      ws.send(`NICK justinfan${Math.floor(Math.random() * 90000 + 10000)}`);
      ws.send(`JOIN #${this.channel}`);
      console.log(`[twitch] подключён к чату #${this.channel}`);
      // Twitch рвёт тихие соединения — шлём свой PING раз в 4 мин.
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => ws.send("PING :tmi.twitch.tv"), 240_000);
    });

    ws.on("message", (data: WebSocket.Data) => this.onData(String(data)));
    ws.on("error", (e: Error) => {
      if (!this.closed) console.log(`[twitch] ошибка: ${e.message}`);
    });
    ws.on("close", () => {
      this.ws = null;
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
      // :login!login@login.tmi.twitch.tv PRIVMSG #chan :text
      const m = line.match(/^:(\w+)!\w+@[\w.]+ PRIVMSG #\S+ :(.*)$/);
      if (!m) continue;
      const nick = m[1];
      const text = m[2].replace(/[\r\n]/g, "").trim();
      try {
        this.onMessage(nick, text);
      } catch (e) {
        console.log(`[twitch] обработчик упал: ${(e as Error).message}`);
      }
    }
  }
}
