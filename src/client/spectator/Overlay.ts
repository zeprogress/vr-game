import type { OverlayPatch, LeaderboardRow } from "#shared/net/messages";

/**
 * Оверлеи стрима (этап 17 Ф6).
 *
 * DOM поверх canvas — рисуется в полном разрешении вьюпорта (1080p на боксе),
 * поэтому текст чёткий независимо от рендер-скейла спектатора. Ничего не знает
 * о Babylon: раз в кадр получает готовый контекст из Spectator. Каждый элемент
 * включается/выключается с пульта (SpecCmd overlay).
 */

export interface OverlayCtx {
  /** Кого показываем: ник игрока / имя моба / null (обзор, путь). */
  watching: string | null;
  /** Подпись кадра для режима без цели («Обзор зоны», «Пролёт: …»). */
  shotLabel: string;
  /** HP цели 0..1 и абсолютные значения — или null, если у кадра нет цели. */
  targetHp: { frac: number; cur: number; max: number; name: string; boss: boolean } | null;
  /** Ники всех онлайн-игроков. */
  online: string[];
}

interface Config {
  watermark: string;
  wm: boolean;
  clock: boolean;
  online: boolean;
  watching: boolean;
  hp: boolean;
  feed: boolean;
  top: boolean;
}

const DEFAULT: Config = {
  watermark: "ZEP GAME",
  wm: true,
  clock: true,
  online: true,
  watching: true,
  hp: true,
  feed: true,
  top: true,
};

const CSS = `
.ov { position:fixed; inset:0; pointer-events:none; z-index:9;
  font-family:"Inter",system-ui,-apple-system,"Segoe UI",sans-serif;
  color:#fff; text-shadow:0 2px 10px rgba(0,0,0,.55); }
.ov .box { position:absolute; }
.ov-wm { left:2.2vw; top:2.4vh; font-weight:800; font-size:2.1vh; letter-spacing:.14em;
  display:flex; align-items:center; gap:.7vh; }
.ov-wm i { width:1vh; height:1vh; border-radius:50%; background:#e8433f;
  box-shadow:0 0 10px #e8433f; animation:ovpulse 2s ease-in-out infinite; }
@keyframes ovpulse { 0%,100%{opacity:1} 50%{opacity:.35} }
.ov-clock { right:2.2vw; top:2.4vh; font-weight:700; font-size:2.3vh; letter-spacing:.06em;
  text-align:right; }
.ov-online { right:2.2vw; top:6.4vh; text-align:right; font-size:1.7vh; line-height:1.5; opacity:.9; }
.ov-online b { display:block; font-size:1.3vh; letter-spacing:.16em; opacity:.6;
  text-transform:uppercase; margin-bottom:.3vh; font-weight:700; }
.ov-top { left:2.2vw; top:6.4vh; font-size:1.7vh; line-height:1.6; }
.ov-top b { display:block; font-size:1.3vh; letter-spacing:.16em; opacity:.6;
  text-transform:uppercase; margin-bottom:.3vh; font-weight:700; }
.ov-top div { display:flex; gap:.7vh; align-items:baseline; }
.ov-top .rk { opacity:.7; width:2.4vh; flex:none; }
.ov-top .nm { font-weight:700; }
.ov-top .lv { opacity:.75; margin-left:.4vh; }
.ov-watch { left:2.2vw; bottom:3vh; }
.ov-watch b { font-size:1.4vh; letter-spacing:.2em; opacity:.7; font-weight:700;
  text-transform:uppercase; }
.ov-watch span { display:block; font-weight:800; font-size:3.2vh; margin-top:.4vh; }
.ov-hp { left:50%; bottom:3vh; transform:translateX(-50%); width:34vw; text-align:center; }
.ov-hp b { font-weight:700; font-size:1.9vh; letter-spacing:.05em; }
.ov-hp .bar { margin-top:.8vh; height:1.3vh; border-radius:1vh; overflow:hidden;
  background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.25); }
.ov-hp .fill { height:100%; background:linear-gradient(90deg,#3ad07a,#8fe45a);
  transition:width .25s ease; }
.ov-hp.boss .fill { background:linear-gradient(90deg,#b3231d,#e8433f); }
.ov-hp.boss b { color:#ff9a95; }
.ov-feed { right:2.2vw; bottom:24vh; display:flex; flex-direction:column-reverse;
  gap:.5vh; align-items:flex-end; }
.ov-feed div { background:rgba(12,13,18,.62); padding:.5vh 1vh; border-radius:.5vh;
  font-size:1.7vh; font-weight:600; animation:ovfeed .3s ease; }
.ov-feed b { color:#8fe45a; font-weight:800; }
.ov-feed s { color:#ff9a95; font-weight:800; text-decoration:none; }
.ov-feed i { opacity:.7; font-style:normal; margin:0 .5vh; }
@keyframes ovfeed { from{opacity:0;transform:translateX(1vh)} to{opacity:1} }
.ov-card { left:0; right:0; bottom:16vh; text-align:center; opacity:0;
  transition:opacity .5s ease; }
.ov-card.show { opacity:1; }
.ov-card .t { display:inline-block; padding:1.4vh 3vw; background:rgba(12,13,18,.72);
  border-left:.5vh solid #e8433f; }
.ov-card .t s { display:block; text-decoration:none; font-weight:800; font-size:3.6vh; }
.ov-card .t u { display:block; text-decoration:none; font-size:2vh; opacity:.8; margin-top:.5vh; }
`;

function mskTime(): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return "";
  }
}

export class Overlay {
  private readonly root: HTMLDivElement;
  private readonly wm: HTMLDivElement;
  private readonly wmText: HTMLSpanElement;
  private readonly clock: HTMLDivElement;
  private readonly online: HTMLDivElement;
  private readonly watch: HTMLDivElement;
  private readonly hp: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpLabel: HTMLElement;
  private readonly card: HTMLDivElement;
  private readonly cardTitle: HTMLElement;
  private readonly cardSub: HTMLElement;
  private cardUntil = 0; // 0 — держать бесконечно (пока не скроют)
  private readonly feed: HTMLDivElement;
  private feedRows: { el: HTMLElement; until: number }[] = [];
  private readonly top: HTMLDivElement;
  private topRows: LeaderboardRow[] = [];
  private cfg: Config = { ...DEFAULT };

  constructor() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = div("ov");

    this.wm = div("box ov-wm");
    this.wm.appendChild(document.createElement("i"));
    this.wmText = document.createElement("span");
    this.wmText.textContent = this.cfg.watermark;
    this.wm.appendChild(this.wmText);

    this.clock = div("box ov-clock");
    this.online = div("box ov-online");
    this.watch = div("box ov-watch");

    this.hp = div("box ov-hp");
    this.hpLabel = document.createElement("b");
    const bar = div("bar");
    this.hpFill = div("fill");
    bar.appendChild(this.hpFill);
    this.hp.append(this.hpLabel, bar);

    this.card = div("box ov-card");
    const t = div("t");
    this.cardTitle = document.createElement("s");
    this.cardSub = document.createElement("u");
    t.append(this.cardTitle, this.cardSub);
    this.card.appendChild(t);

    this.feed = div("box ov-feed");
    this.top = div("box ov-top");

    this.root.append(
      this.wm,
      this.clock,
      this.online,
      this.watch,
      this.hp,
      this.feed,
      this.card,
      this.top,
    );
    document.body.appendChild(this.root);
  }

  /** Патч конфигурации с пульта (SpecCmd overlay). */
  setConfig(patch: OverlayPatch): void {
    if (typeof patch.watermark === "string") {
      this.cfg.watermark = patch.watermark;
      this.wmText.textContent = patch.watermark;
    }
    const flag = (v: number | undefined): boolean | undefined =>
      v === undefined ? undefined : v !== 0;
    for (const k of ["wm", "clock", "online", "watching", "hp", "feed", "top"] as const) {
      const f = flag(patch[k]);
      if (f !== undefined) this.cfg[k] = f;
    }
  }

  /** Строка кил-фида. `by` пуст — «<victim> пал». Живёт ~7 с. */
  pushKill(by: string, victim: string): void {
    if (!victim) return;
    const row = document.createElement("div");
    if (by) {
      row.innerHTML = `<b></b><i>⚔</i><s></s>`;
      row.querySelector("b")!.textContent = by;
      row.querySelector("s")!.textContent = victim;
    } else {
      row.innerHTML = `<s></s><i>пал</i>`;
      row.querySelector("s")!.textContent = victim;
    }
    this.feed.appendChild(row);
    this.feedRows.push({ el: row, until: performance.now() + 7000 });
    while (this.feedRows.length > 5) {
      this.feedRows.shift()?.el.remove();
    }
  }

  /** Топ-5 героев — приходит с сервера раз в 10 с (Ф10). */
  setLeaderboard(rows: LeaderboardRow[]): void {
    this.topRows = rows;
    this.renderTop();
  }

  private renderTop(): void {
    this.top.innerHTML = "<b>топ героев</b>";
    const medal = ["🥇", "🥈", "🥉", "4", "5"];
    this.topRows.slice(0, 5).forEach((r, i) => {
      const row = document.createElement("div");
      const rk = document.createElement("span");
      rk.className = "rk";
      rk.textContent = medal[i] ?? String(i + 1);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = r.nick;
      const lv = document.createElement("span");
      lv.className = "lv";
      lv.textContent = `ур.${r.level}`;
      row.append(rk, nm, lv);
      this.top.appendChild(row);
    });
  }

  /**
   * Заставка/нижняя треть с дашборда.
   * `secs <= 0` — держать бесконечно, пока не скроют. Пустой `title` — скрыть.
   */
  showCard(title: string, sub = "", secs = 0): void {
    if (!title) {
      this.card.classList.remove("show");
      this.cardUntil = 0;
      return;
    }
    this.cardTitle.textContent = title;
    this.cardSub.textContent = sub;
    this.cardSub.style.display = sub ? "block" : "none";
    this.card.classList.add("show");
    this.cardUntil = secs > 0 ? performance.now() + secs * 1000 : 0;
  }

  update(ctx: OverlayCtx): void {
    const now = performance.now();

    show(this.wm, this.cfg.wm);
    show(this.clock, this.cfg.clock);
    show(this.watch, this.cfg.watching);
    show(this.online, this.cfg.online && ctx.online.length > 0);
    show(this.feed, this.cfg.feed);
    show(this.top, this.cfg.top && this.topRows.length > 0);

    if (this.feedRows.length) {
      this.feedRows = this.feedRows.filter((r) => {
        if (now > r.until) {
          r.el.remove();
          return false;
        }
        return true;
      });
    }

    if (this.cfg.clock) this.clock.textContent = mskTime();

    if (this.cfg.online && ctx.online.length) {
      this.online.innerHTML = "<b>в игре</b>";
      for (const n of ctx.online.slice(0, 7)) {
        const row = document.createElement("div");
        row.textContent = n;
        this.online.appendChild(row);
      }
      if (ctx.online.length > 7) {
        const more = document.createElement("div");
        more.textContent = `+${ctx.online.length - 7}`;
        more.style.opacity = ".6";
        this.online.appendChild(more);
      }
    }

    if (this.cfg.watching) {
      if (ctx.watching) {
        this.watch.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = "смотрим";
        const s = document.createElement("span");
        s.textContent = ctx.watching;
        this.watch.append(b, s);
      } else {
        this.watch.innerHTML = `<b>${ctx.shotLabel}</b>`;
      }
    }

    const hp = ctx.targetHp;
    if (this.cfg.hp && hp) {
      show(this.hp, true);
      this.hp.classList.toggle("boss", hp.boss);
      this.hpFill.style.width = `${Math.round(Math.max(0, Math.min(1, hp.frac)) * 100)}%`;
      this.hpLabel.textContent = `${hp.name} — ${Math.max(0, Math.ceil(hp.cur))}/${Math.round(hp.max)}`;
    } else {
      show(this.hp, false);
    }

    if (this.cardUntil && now > this.cardUntil) {
      this.card.classList.remove("show");
      this.cardUntil = 0;
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

function div(cls: string): HTMLDivElement {
  const e = document.createElement("div");
  e.className = cls;
  return e;
}

function show(el: HTMLElement, on: boolean): void {
  el.style.display = on ? "" : "none";
}
