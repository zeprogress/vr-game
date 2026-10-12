import WebSocket from "ws";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Баллы канала Twitch → команды чата игры. Активации наград приходят EventSub-событием
 * (IRC их не отдаёт, если награда без текста). Сервер сам ходит на EventSub по WebSocket:
 * публичный адрес не нужен. Токен стримера обновляется по refresh-токену; Twitch меняет
 * его при каждом обновлении, поэтому новый сохраняется в .data (не только в env).
 */

/** Тип события: активация награды канала. */
export const REDEEM_TYPE = "channel.channel_points_custom_reward_redemption.add";
const EVENTSUB_WS = "wss://eventsub.wss.twitch.tv/ws";
const HELIX = "https://api.twitch.tv/helix";
const ID_TWITCH = "https://id.twitch.tv/oauth2";
/** Право токена стримера, без которого подписка на награды не создаётся. */
const NEEDED_SCOPE = "channel:read:redemptions";

/** Команды, которые награда не запускает: удаляют героя, меняют атрибуты или админские. */
export const REDEEM_FORBIDDEN = new Set<string>([
  "!delete", "!reset", "!respec", "!reroll", "!перекачать", "!сбросочки",
  "!stopbots", "!выгнатьботов", "!resettower", "!сбростопбашни", "!goevent",
  "!chatquest", "!ивенты", "!events", "!lvl", "!поджечь", "!burn",
]);

/** Конфиг наград (без секретов — лежит в репозитории). */
export const REDEEM_RULES_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "../../deploy/redeems.json");
/** Токен стримера после обновлений (в .data, в git не попадает). */
export const REDEEM_TOKEN_FILE = resolve(dirname(fileURLToPath(import.meta.url)), ".data/twitch-redeem.json");

export interface RedeemRule {
  /** Название награды в Twitch (регистр не важен). */
  title: string;
  /** Текст команды: «!катакомбы», «!режим агрессивно» (аргументы фиксированы). */
  command: string;
  /** Кулдаун награды, с. */
  cooldownSec: number;
  /** id награды: если задан, сопоставляется по нему (переименование в Twitch не ломает). */
  id?: string;
}

/** Разбор deploy/redeems.json. Плохие записи пропускаются с сообщением, сервер не падает. */
export function parseRedeemRules(raw: unknown): { rules: RedeemRule[]; errors: string[] } {
  const rules: RedeemRule[] = [];
  const errors: string[] = [];
  const list = (raw as { rewards?: unknown } | null)?.rewards;
  if (!Array.isArray(list)) return { rules, errors: ["в redeems.json нет массива rewards"] };
  const titles = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const e = (list[i] ?? {}) as { title?: unknown; command?: unknown; cooldownSec?: unknown; id?: unknown };
    const title = typeof e.title === "string" ? e.title.trim() : "";
    const command = typeof e.command === "string" ? e.command.trim() : "";
    if (!title) {
      errors.push(`запись #${i}: нет title`);
      continue;
    }
    if (!command.startsWith("!")) {
      errors.push(`«${title}»: команда должна начинаться с «!»`);
      continue;
    }
    const head = command.split(/\s+/)[0].toLowerCase();
    if (REDEEM_FORBIDDEN.has(head)) {
      errors.push(`«${title}»: команда ${head} за награду не запускается`);
      continue;
    }
    const key = title.toLowerCase();
    if (titles.has(key)) {
      errors.push(`«${title}»: название повторяется`);
      continue;
    }
    titles.add(key);
    const cd = typeof e.cooldownSec === "number" ? e.cooldownSec : 30;
    rules.push({
      title,
      command,
      cooldownSec: Math.max(0, Math.min(3600, cd)),
      id: typeof e.id === "string" && e.id ? e.id : undefined,
    });
  }
  return { rules, errors };
}

export function loadRedeemRules(file = REDEEM_RULES_FILE): { rules: RedeemRule[]; errors: string[] } {
  if (!existsSync(file)) return { rules: [], errors: [] };
  try {
    return parseRedeemRules(JSON.parse(readFileSync(file, "utf8")));
  } catch (e) {
    return { rules: [], errors: [`redeems.json не читается: ${(e as Error).message}`] };
  }
}

/** Минимальный интерфейс сокета: настоящий ws и тестовая заглушка подходят оба. */
export interface RedeemSocket {
  on(ev: "message" | "close" | "error", fn: (data?: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

/** Внешние зависимости (сеть, часы, таймеры) — подменяются в тестах. */
export interface RedeemDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  fetch(url: string, init?: RequestInit): Promise<Response>;
  socket(url: string): RedeemSocket;
}

const realDeps: RedeemDeps = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  fetch: (url, init) => fetch(url, init),
  socket: (url) => new WebSocket(url) as unknown as RedeemSocket,
};

export interface RedeemOptions {
  /** Логин стримера (канал). */
  channel: string;
  clientId: string;
  clientSecret: string;
  /** Начальный refresh-токен стримера из env. Дальше работает сохранённый (он новее). */
  seedRefresh: string;
  /** Куда сохранять обновлённый refresh-токен. */
  tokenFile: string;
  rules: RedeemRule[];
  /** Выполнить команду от имени зрителя (как сообщение в чате). */
  onCommand(login: string, command: string, reward: string): void;
  /** Награда ещё на перезарядке: сообщить зрителю, сколько осталось. */
  onCooldown?(login: string, reward: string, secLeft: number): void;
}

interface RedeemEvent {
  id?: string;
  user_login?: string;
  reward?: { id?: string; title?: string };
}

interface Envelope {
  metadata?: { message_id?: string; message_type?: string; subscription_type?: string };
  payload?: {
    session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string | null };
    subscription?: { status?: string };
    event?: RedeemEvent;
  };
}

function readStoredRefresh(file: string): string {
  try {
    if (!existsSync(file)) return "";
    const v = JSON.parse(readFileSync(file, "utf8")) as { refresh_token?: unknown };
    return typeof v.refresh_token === "string" ? v.refresh_token : "";
  } catch {
    return "";
  }
}

function writeStoredRefresh(file: string, token: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ refresh_token: token, saved: new Date().toISOString() }), { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    console.log(`[redeem] токен не сохранён: ${(e as Error).message}`);
  }
}

export type RedeemResult = "ok" | "cooldown" | "unknown";

export class TwitchRedeem {
  private ws: RedeemSocket | null = null;
  /** Новое соединение после session_reconnect: ждём его welcome, потом переключаемся. */
  private pendingMigration: RedeemSocket | null = null;
  private stopped = true;
  private disabled = false;
  private access = "";
  private accessExpires = 0;
  private refresh = "";
  private broadcasterId = "";
  private sessionId = "";
  private watchdog: unknown = null;
  private keepaliveMs = 15_000;
  private reconnectMs = 2000;
  private retryTimer: unknown = null;
  private readonly seen = new Set<string>();
  private readonly lastUsed = new Map<string, number>();
  private readonly unknownLogged = new Set<string>();
  private warnedNotConfigured = false;

  constructor(
    private readonly opts: RedeemOptions,
    private readonly deps: RedeemDeps = realDeps,
  ) {}

  /** Есть ли всё нужное: id и secret приложения, и хоть какой-то refresh-токен. */
  get configured(): boolean {
    return !!this.opts.clientId && !!this.opts.clientSecret && !!(readStoredRefresh(this.opts.tokenFile) || this.opts.seedRefresh);
  }

  start(): void {
    if (!this.stopped) return;
    if (!this.configured) {
      if (!this.warnedNotConfigured) {
        this.warnedNotConfigured = true;
        console.log("[redeem] баллы канала выключены: нет TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET / TWITCH_BROADCASTER_REFRESH");
      }
      return;
    }
    this.stopped = false;
    this.disabled = false;
    this.refresh = readStoredRefresh(this.opts.tokenFile) || this.opts.seedRefresh;
    void this.boot();
  }

  stop(): void {
    this.stopped = true;
    this.clearWatchdog();
    if (this.retryTimer) this.deps.clearTimer(this.retryTimer);
    this.retryTimer = null;
    this.ws?.close();
    this.ws = null;
    this.pendingMigration?.close();
    this.pendingMigration = null;
  }

  /** Тестовый стенд (без Twitch): активация награды от имени зрителя. */
  simulate(title: string, login: string): RedeemResult {
    return this.handle(login, "", title);
  }

  /** Активация награды: сопоставить с правилом, проверить кулдаун, выполнить команду. */
  handle(login: string, rewardId: string, title: string): RedeemResult {
    const rule = this.match(rewardId, title);
    if (!rule) {
      const key = rewardId || title;
      if (!this.unknownLogged.has(key)) {
        this.unknownLogged.add(key);
        console.log(`[redeem] награда «${title}» (id ${rewardId || "—"}) не привязана — добавь в deploy/redeems.json`);
      }
      return "unknown";
    }
    const now = this.deps.now();
    const last = this.lastUsed.get(rule.title);
    const cdMs = rule.cooldownSec * 1000;
    if (last !== undefined && now - last < cdMs) {
      const left = Math.ceil((cdMs - (now - last)) / 1000);
      this.opts.onCooldown?.(login, rule.title, left);
      return "cooldown";
    }
    this.lastUsed.set(rule.title, now);
    console.log(`[redeem] ${login}: «${rule.title}» → ${rule.command}`);
    try {
      this.opts.onCommand(login, rule.command, rule.title);
    } catch (e) {
      console.log(`[redeem] команда не выполнена: ${(e as Error).message}`);
    }
    return "ok";
  }

  private match(rewardId: string, title: string): RedeemRule | undefined {
    if (rewardId) {
      const byId = this.opts.rules.find((r) => r.id === rewardId);
      if (byId) return byId;
    }
    const t = title.trim().toLowerCase();
    return this.opts.rules.find((r) => r.title.toLowerCase() === t);
  }

  private async boot(): Promise<void> {
    if (this.stopped) return;
    try {
      if (!(await this.ensureAccess())) {
        if (!this.disabled) this.retryLater(() => void this.boot());
        return;
      }
      if (!(await this.validate())) {
        if (!this.disabled) this.retryLater(() => void this.boot());
        return;
      }
      this.open(EVENTSUB_WS);
    } catch (e) {
      console.log(`[redeem] запуск: ${(e as Error).message}`);
      if (!this.disabled) this.retryLater(() => void this.boot());
    }
  }

  /** Обновить access-токен по refresh-токену. Новый refresh-токен сохраняется сразу. */
  private async ensureAccess(force = false): Promise<boolean> {
    if (!force && this.access && this.deps.now() < this.accessExpires - 60_000) return true;
    const body = new URLSearchParams({
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
      grant_type: "refresh_token",
      refresh_token: this.refresh,
    });
    const r = await this.deps.fetch(`${ID_TWITCH}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (r.status === 400 || r.status === 401) {
      // Сохранённый токен не принят: пробуем стартовый из env один раз, иначе нужен новый вход.
      if (this.opts.seedRefresh && this.refresh !== this.opts.seedRefresh) {
        this.refresh = this.opts.seedRefresh;
        return this.ensureAccess(true);
      }
      this.disable("токен стримера не принят (refresh) — пройди вход заново и обнови TWITCH_BROADCASTER_REFRESH в deploy/stream.env");
      return false;
    }
    if (!r.ok) {
      console.log(`[redeem] обновление токена: HTTP ${r.status}`);
      return false;
    }
    const j = (await r.json()) as { access_token: string; refresh_token: string; expires_in: number };
    this.access = j.access_token;
    this.accessExpires = this.deps.now() + j.expires_in * 1000;
    this.refresh = j.refresh_token;
    writeStoredRefresh(this.opts.tokenFile, this.refresh);
    return true;
  }

  /** Проверить, что токен принадлежит стримеру канала и даёт право на награды. */
  private async validate(): Promise<boolean> {
    const check = () => this.deps.fetch(`${ID_TWITCH}/validate`, { headers: { Authorization: `OAuth ${this.access}` } });
    let r = await check();
    if (r.status === 401) {
      if (!(await this.ensureAccess(true))) return false;
      r = await check();
    }
    if (!r.ok) {
      console.log(`[redeem] проверка токена: HTTP ${r.status}`);
      return false;
    }
    const j = (await r.json()) as { login?: string; user_id?: string; scopes?: string[] };
    if ((j.login ?? "").toLowerCase() !== this.opts.channel.toLowerCase()) {
      this.disable(`токен другого аккаунта (${j.login ?? "?"}), нужен стример ${this.opts.channel}`);
      return false;
    }
    if (!(j.scopes ?? []).includes(NEEDED_SCOPE)) {
      this.disable(`у токена нет права ${NEEDED_SCOPE}`);
      return false;
    }
    this.broadcasterId = j.user_id ?? "";
    console.log(`[redeem] токен стримера ${j.login} принят, права есть`);
    return !!this.broadcasterId;
  }

  private open(url: string): void {
    if (this.stopped) return;
    const sock = this.deps.socket(url);
    this.attach(sock);
    this.ws = sock;
  }

  /** Переезд по session_reconnect: новое соединение открываем, старое держим до его welcome. */
  private openMigration(url: string): void {
    if (this.stopped) return;
    const sock = this.deps.socket(url);
    this.attach(sock);
    this.pendingMigration = sock;
  }

  private attach(sock: RedeemSocket): void {
    sock.on("message", (data) => this.onMessage(sock, String(data)));
    sock.on("close", () => this.onClose(sock));
    sock.on("error", (e) => console.log(`[redeem] сокет: ${(e as Error | undefined)?.message ?? String(e)}`));
  }

  private onClose(sock: RedeemSocket): void {
    if (sock === this.pendingMigration) {
      this.pendingMigration = null;
      return;
    }
    if (sock !== this.ws) return;
    this.ws = null;
    this.clearWatchdog();
    if (this.stopped || this.disabled) return;
    console.log(`[redeem] EventSub отключён, переподключение через ${Math.round(this.reconnectMs / 1000)} с`);
    this.retryLater(() => this.open(EVENTSUB_WS));
  }

  private onMessage(sock: RedeemSocket, raw: string): void {
    let msg: Envelope;
    try {
      msg = JSON.parse(raw) as Envelope;
    } catch {
      return;
    }
    const type = msg.metadata?.message_type;
    if (type === "session_welcome") {
      const session = msg.payload?.session ?? {};
      this.keepaliveMs = ((session.keepalive_timeout_seconds ?? 10) + 5) * 1000;
      if (sock === this.pendingMigration) {
        // Переезд: подписки перешли на новое соединение сами, заново не подписываемся.
        const old = this.ws;
        this.ws = sock;
        this.pendingMigration = null;
        this.sessionId = session.id ?? this.sessionId;
        this.reconnectMs = 2000;
        this.armWatchdog();
        old?.close();
        return;
      }
      this.ws = sock;
      this.reconnectMs = 2000;
      this.armWatchdog();
      void this.subscribe(session.id ?? "");
      return;
    }
    if (sock !== this.ws) return;
    if (type === "session_keepalive") {
      this.armWatchdog();
      return;
    }
    if (type === "session_reconnect") {
      const url = msg.payload?.session?.reconnect_url;
      if (url) this.openMigration(url);
      return;
    }
    if (type === "revocation") {
      const status = msg.payload?.subscription?.status ?? "";
      console.log(`[redeem] подписка отозвана: ${status}`);
      if (status === "authorization_revoked" || status === "user_removed") {
        this.disable("права отозваны — пройди вход заново");
      } else {
        void this.subscribe(this.sessionId);
      }
      return;
    }
    if (type === "notification") {
      this.armWatchdog();
      const id = msg.metadata?.message_id ?? "";
      if (id && this.remember(id)) return; // повторная доставка того же события
      if (msg.metadata?.subscription_type === REDEEM_TYPE) {
        const ev = msg.payload?.event;
        if (ev?.user_login) this.handle(ev.user_login.toLowerCase(), ev.reward?.id ?? "", ev.reward?.title ?? "");
      }
    }
  }

  /** true — такое событие уже было. Храним последние 500 id. */
  private remember(id: string): boolean {
    if (this.seen.has(id)) return true;
    this.seen.add(id);
    if (this.seen.size > 500) {
      const first = this.seen.values().next().value;
      if (first !== undefined) this.seen.delete(first);
    }
    return false;
  }

  /** Подписка на активации наград для этой сессии EventSub. */
  private async subscribe(sessionId: string): Promise<void> {
    this.sessionId = sessionId;
    if (!this.broadcasterId || !sessionId) return;
    const body = JSON.stringify({
      type: REDEEM_TYPE,
      version: "1",
      condition: { broadcaster_user_id: this.broadcasterId },
      transport: { method: "websocket", session_id: sessionId },
    });
    const send = () =>
      this.deps.fetch(`${HELIX}/eventsub/subscriptions`, {
        method: "POST",
        headers: { "Client-Id": this.opts.clientId, Authorization: `Bearer ${this.access}`, "Content-Type": "application/json" },
        body,
      });
    let r = await send();
    if (r.status === 401) {
      if (!(await this.ensureAccess(true))) return;
      r = await send();
    }
    if (r.ok || r.status === 409) {
      console.log("[redeem] подписка на награды канала активна");
      return;
    }
    if (r.status === 403) {
      this.disable(`у токена нет права ${NEEDED_SCOPE} для подписки`);
      return;
    }
    const text = await r.text();
    console.log(`[redeem] подписка не создана: HTTP ${r.status} ${text.slice(0, 160)}`);
    this.retryLater(() => void this.subscribe(sessionId), 10_000);
  }

  private armWatchdog(): void {
    this.clearWatchdog();
    this.watchdog = this.deps.setTimer(() => {
      console.log("[redeem] нет сигналов от EventSub — переподключаюсь");
      this.ws?.close();
    }, this.keepaliveMs);
  }

  private clearWatchdog(): void {
    if (this.watchdog) this.deps.clearTimer(this.watchdog);
    this.watchdog = null;
  }

  private retryLater(fn: () => void, ms = this.reconnectMs): void {
    if (this.stopped) return;
    if (this.retryTimer) this.deps.clearTimer(this.retryTimer);
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = null;
      fn();
    }, ms);
    this.reconnectMs = Math.min(this.reconnectMs * 2, 60_000);
  }

  private disable(reason: string): void {
    this.disabled = true;
    console.log(`[redeem] ${reason}`);
    this.stop();
  }
}
