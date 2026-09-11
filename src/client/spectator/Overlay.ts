import type { OverlayPatch, LeaderboardRow, TowerBoardRow } from "#shared/net/messages";
import { TOWER } from "#shared/tower";

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
  /** Краткие характеристики игрока под ником в «смотрим» (без атрибутов). */
  watchStats: string | null;
  /** Краткий инвентарь игрока — строка под полосой «HP цели» (только для игрока). */
  watchInv: string | null;
  /** Онлайн-игроки: ник и говорит ли сейчас (зелёный огонёк). */
  online: readonly { nick: string; speaking: boolean }[];
  /** Текущий забег «Охотничьей башни» — этаж/мобы/босс, или null если башня не активна. */
  towerStatus: { heroNick: string; floor: number; mobsLeft: number; mobsTotal: number; bossActive: boolean } | null;
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
  ticker: boolean;
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
  ticker: true,
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
.ov-online div { display:flex; gap:.7vh; align-items:center; justify-content:flex-end; }
.ov-online i.spk { width:1vh; height:1vh; border-radius:50%; background:#3ad16b;
  box-shadow:0 0 8px #3ad16b; flex:none; }
.ov-top { left:2.2vw; top:6.4vh; font-size:1.7vh; line-height:1.6; }
.ov-top b { display:block; font-size:1.3vh; letter-spacing:.16em; opacity:.6;
  text-transform:uppercase; margin-bottom:.3vh; font-weight:700; }
.ov-top div { display:flex; gap:.9vh; align-items:center; min-height:2.9vh; }
.ov-top .rk { flex:none; width:3vh; text-align:center; line-height:1; opacity:.7;
  font-size:1.7vh; font-variant-numeric:tabular-nums; }
.ov-top .rk.medal { font-size:2.5vh; opacity:1; }
.ov-top .nm { font-weight:700; }
.ov-top .lv { opacity:.75; margin-left:.4vh; }
.ov-towertop { left:2.2vw; top:23vh; font-size:1.7vh; line-height:1.6; }
.ov-towertop b { display:block; font-size:1.3vh; letter-spacing:.16em; opacity:.6;
  text-transform:uppercase; margin-bottom:.3vh; font-weight:700; }
.ov-towertop div { display:flex; gap:.9vh; align-items:center; min-height:2.9vh; }
.ov-towertop .rk { flex:none; width:3vh; text-align:center; line-height:1; opacity:.7;
  font-size:1.7vh; font-variant-numeric:tabular-nums; }
.ov-towertop .rk.medal { font-size:2.5vh; opacity:1; }
.ov-towertop .nm { font-weight:700; }
.ov-towertop .lv { opacity:.75; margin-left:.4vh; }
.ov-watch { left:2.2vw; bottom:3vh; }
.ov-watch b { font-size:1.4vh; letter-spacing:.2em; opacity:.7; font-weight:700;
  text-transform:uppercase; }
.ov-watch span { display:block; font-weight:800; font-size:3.2vh; margin-top:.4vh; }
.ov-watch i { display:block; font-style:normal; font-weight:500; font-size:1.8vh;
  opacity:.88; margin-top:.4vh; letter-spacing:.02em; }
.ov-hp { left:50%; bottom:3vh; transform:translateX(-50%); width:34vw; text-align:center; }
.ov-hp b { font-weight:700; font-size:1.9vh; letter-spacing:.05em; }
.ov-hp i { display:block; font-style:normal; font-weight:500; font-size:1.5vh;
  opacity:.82; margin-top:.5vh; letter-spacing:.02em; }
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
.ov-boss { left:50%; top:34%; transform:translate(-50%,-50%) scale(.94); text-align:center;
  opacity:0; transition:opacity .5s ease, transform .5s ease; }
.ov-boss.show { opacity:1; transform:translate(-50%,-50%) scale(1); }
.ov-boss s { display:block; text-decoration:none; font-weight:900; font-size:7vh;
  letter-spacing:.04em; text-transform:uppercase; }
.ov-boss u { display:block; text-decoration:none; font-weight:600; font-size:2.4vh;
  opacity:.9; margin-top:1vh; }
.ov-boss.warn s { color:#ff9b8a; text-shadow:0 0 3vh rgba(220,40,30,.7),0 .5vh 1vh rgba(0,0,0,.6); }
.ov-boss.win s { color:#ffe08a; text-shadow:0 0 3vh rgba(255,190,90,.7),0 .5vh 1vh rgba(0,0,0,.6); }
.ov-ticker { left:50%; top:12vh; transform:translateX(-50%); text-align:center;
  font-weight:900; font-size:3.4vh; letter-spacing:.03em; text-transform:uppercase;
  color:#5ba8ff; max-width:80vw;
  -webkit-text-stroke:.12vh #000;
  text-shadow:0 0 2.2vh rgba(60,140,255,.65), 0 .2vh .35vh rgba(0,0,0,.75); }
.ov-ticker.news { top:9vh; font-size:2.3vh; font-weight:400; letter-spacing:normal;
  text-transform:none; color:#fff; -webkit-text-stroke:0;
  text-shadow:0 .15vh .5vh rgba(0,0,0,.85); }
.ov-towerstatus { left:2.2vw; top:34vh; text-align:left; font-size:1.7vh; }
.ov-towerstatus b { display:block; font-size:3.9vh; letter-spacing:.16em; opacity:.6;
  text-transform:uppercase; margin-bottom:.3vh; font-weight:700; }
.ov-towerstatus span { display:block; font-weight:800; font-size:6.6vh; }
.ov-towerstatus i { display:block; font-style:normal; opacity:.85; font-size:4.5vh; margin-top:.2vh; }
.ov-towerstatus.boss span { color:#ff9a95; }
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
  private readonly hpInv: HTMLElement;
  private readonly card: HTMLDivElement;
  private readonly cardTitle: HTMLElement;
  private readonly cardSub: HTMLElement;
  private cardUntil = 0; // 0 — держать бесконечно (пока не скроют)
  private readonly feed: HTMLDivElement;
  private feedRows: { el: HTMLElement; until: number }[] = [];
  private readonly boss: HTMLDivElement;
  private readonly bossTitle: HTMLElement;
  private readonly bossSub: HTMLElement;
  private bossUntil = 0;
  private readonly top: HTMLDivElement;
  private topRows: LeaderboardRow[] = [];
  /** Топ по «Охотничьей башне» — своя панель под основным топом. */
  private readonly towerTop: HTMLDivElement;
  private towerTopRows: TowerBoardRow[] = [];
  private readonly ticker: HTMLDivElement;
  private tickerText = "";
  private tickerKind: "event" | "news" = "event";
  private readonly towerStatus: HTMLDivElement;
  private lastTowerStatusSig = "";
  private cfg: Config = { ...DEFAULT };
  // Кэш последнего отрисованного состояния — не трогаем DOM, пока данные не
  // изменились (update() зовётся каждый кадр; за часы стрима постоянный
  // innerHTML+createElement подвешивал слабый стрим-бокс).
  private lastOnlineSig = " ";
  private lastWatchSig = " ";
  private lastClock = "";

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
    this.hpInv = document.createElement("i");
    this.hp.append(this.hpLabel, bar, this.hpInv);

    this.card = div("box ov-card");
    const t = div("t");
    this.cardTitle = document.createElement("s");
    this.cardSub = document.createElement("u");
    t.append(this.cardTitle, this.cardSub);
    this.card.appendChild(t);

    this.feed = div("box ov-feed");
    this.top = div("box ov-top");
    this.towerTop = div("box ov-towertop");
    this.ticker = div("box ov-ticker");
    this.towerStatus = div("box ov-towerstatus");

    this.boss = div("box ov-boss");
    this.bossTitle = document.createElement("s");
    this.bossSub = document.createElement("u");
    this.boss.append(this.bossTitle, this.bossSub);

    this.root.append(
      this.wm,
      this.clock,
      this.online,
      this.watch,
      this.hp,
      this.feed,
      this.card,
      this.boss,
      this.top,
      this.towerTop,
      this.ticker,
      this.towerStatus,
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
    for (const k of ["wm", "clock", "online", "watching", "hp", "feed", "top", "ticker"] as const) {
      const f = flag(patch[k]);
      if (f !== undefined) this.cfg[k] = f;
    }
    // конфиг мог скрыть/показать блоки — заставить перерисоваться
    this.lastOnlineSig = " ";
    this.lastWatchSig = " ";
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
    const medal = ["🥇", "🥈", "🥉"];
    this.topRows.slice(0, 5).forEach((r, i) => {
      const row = document.createElement("div");
      const rk = document.createElement("span");
      rk.className = i < 3 ? "rk medal" : "rk";
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

  /** Топ-5 по «Охотничьей башне» — тот же ритм, что и setLeaderboard. */
  setTowerBoard(rows: TowerBoardRow[]): void {
    this.towerTopRows = rows;
    this.renderTowerTop();
  }

  private renderTowerTop(): void {
    this.towerTop.innerHTML = "<b>башня — лучший этаж</b>";
    const medal = ["🥇", "🥈", "🥉"];
    this.towerTopRows.slice(0, 5).forEach((r, i) => {
      const row = document.createElement("div");
      const rk = document.createElement("span");
      rk.className = i < 3 ? "rk medal" : "rk";
      rk.textContent = medal[i] ?? String(i + 1);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = r.nick;
      const lv = document.createElement("span");
      lv.className = "lv";
      lv.textContent = `этаж ${r.floor}`;
      row.append(rk, nm, lv);
      this.towerTop.appendChild(row);
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

  /** Большой баннер по центру: босс появился / повержен. */
  bossBanner(kind: "spawn" | "down", by?: string, loot?: string): void {
    this.boss.classList.remove("warn", "win");
    if (kind === "down") {
      this.boss.classList.add("win");
      this.bossTitle.textContent = "Босс повержен!";
      this.bossSub.textContent = [
        by ? `Решающий удар: ${by}` : "",
        loot ? `Добыча: ${loot}` : "",
      ]
        .filter(Boolean)
        .join("   ·   ");
    } else {
      this.boss.classList.add("warn");
      this.bossTitle.textContent = "Босс появился";
      this.bossSub.textContent = "Багровый слизень вышел на охоту";
    }
    this.bossSub.style.display = this.bossSub.textContent ? "block" : "none";
    this.boss.classList.add("show");
    this.bossUntil = performance.now() + 5200;
  }

  /**
   * Текст строки сверху по центру. `kind`: "event" — крупно (идёт ивент),
   * "news" — спокойнее и мельче (свежие изменения игры). Пустая строка — прячем.
   */
  setTicker(text: string, kind: "event" | "news" = "event"): void {
    this.tickerText = text;
    this.tickerKind = kind;
  }

  update(ctx: OverlayCtx): void {
    const now = performance.now();
    if (this.bossUntil && now > this.bossUntil) {
      this.boss.classList.remove("show");
      this.bossUntil = 0;
    }

    show(this.wm, this.cfg.wm);
    show(this.clock, this.cfg.clock);
    show(this.watch, this.cfg.watching);
    show(this.online, this.cfg.online && ctx.online.length > 0);
    show(this.feed, this.cfg.feed);
    show(this.top, this.cfg.top && this.topRows.length > 0);
    show(this.towerTop, this.cfg.top && this.towerTopRows.length > 0);
    const tickOn = this.cfg.ticker && this.tickerText.length > 0;
    show(this.ticker, tickOn);
    if (tickOn) {
      if (this.ticker.textContent !== this.tickerText) {
        this.ticker.textContent = this.tickerText;
      }
      this.ticker.classList.toggle("news", this.tickerKind === "news");
    }

    if (this.feedRows.length) {
      this.feedRows = this.feedRows.filter((r) => {
        if (now > r.until) {
          r.el.remove();
          return false;
        }
        return true;
      });
    }

    if (this.cfg.clock) {
      const t = mskTime();
      if (t !== this.lastClock) {
        this.clock.textContent = t;
        this.lastClock = t;
      }
    }

    const onlineSig = this.cfg.online
      ? ctx.online
          .slice(0, 7)
          .map((p) => `${p.nick}${p.speaking ? 1 : 0}`)
          .join("") + `${ctx.online.length}`
      : "";
    if (this.cfg.online && ctx.online.length && onlineSig !== this.lastOnlineSig) {
      this.lastOnlineSig = onlineSig;
      this.online.innerHTML = "<b>в игре</b>";
      for (const p of ctx.online.slice(0, 7)) {
        const row = document.createElement("div");
        const dot = document.createElement("i");
        dot.className = "spk";
        if (!p.speaking) dot.style.visibility = "hidden"; // держит выравнивание
        const nm = document.createElement("span");
        nm.textContent = p.nick;
        row.append(dot, nm);
        this.online.appendChild(row);
      }
      if (ctx.online.length > 7) {
        const more = document.createElement("div");
        more.textContent = `+${ctx.online.length - 7}`;
        more.style.opacity = ".6";
        this.online.appendChild(more);
      }
    }

    const watchSig = this.cfg.watching
      ? `${ctx.watching}|${ctx.shotLabel}|${ctx.watchStats ?? ""}`
      : "";
    if (this.cfg.watching && watchSig !== this.lastWatchSig) {
      this.lastWatchSig = watchSig;
      if (ctx.watching) {
        this.watch.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = "смотрим";
        const s = document.createElement("span");
        s.textContent = ctx.watching;
        this.watch.append(b, s);
        if (ctx.watchStats) {
          const i = document.createElement("i");
          i.textContent = ctx.watchStats;
          this.watch.append(i);
        }
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
      const inv = ctx.watchInv ?? "";
      show(this.hpInv, inv.length > 0);
      if (this.hpInv.textContent !== inv) this.hpInv.textContent = inv;
    } else {
      show(this.hp, false);
    }

    if (this.cardUntil && now > this.cardUntil) {
      this.card.classList.remove("show");
      this.cardUntil = 0;
    }

    const ts = ctx.towerStatus;
    // Раньше было завязано на cfg.clock — если на пульте выключены часы,
    // панель этажа гасла вместе с ними, хотя это разные виджеты. Своего
    // тумблера у неё нет, поэтому вешаем на cfg.top (тот же, что у топов).
    show(this.towerStatus, this.cfg.top && !!ts);
    if (ts) {
      const sig = `${ts.heroNick}|${ts.floor}|${ts.mobsLeft}|${ts.mobsTotal}|${ts.bossActive ? 1 : 0}`;
      if (sig !== this.lastTowerStatusSig) {
        this.lastTowerStatusSig = sig;
        this.towerStatus.classList.toggle("boss", ts.bossActive);
        this.towerStatus.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = "Охотничья башня";
        const span = document.createElement("span");
        span.textContent = `Этаж ${ts.floor}/${TOWER.floors}`;
        const i = document.createElement("i");
        i.textContent = ts.bossActive ? `${ts.heroNick} · мини-босс` : `${ts.heroNick} · мобов ${ts.mobsLeft}/${ts.mobsTotal}`;
        this.towerStatus.append(b, span, i);
      }
    } else {
      this.lastTowerStatusSig = "";
    }
  }

  /** Скрыть/показать весь оверлей целиком (OBS-режим: прячем, пока нет связи). */
  setShown(v: boolean): void {
    this.root.style.display = v ? "" : "none";
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
