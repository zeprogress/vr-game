/**
 * Оверлеи стрима (этап 17 Ф6).
 *
 * DOM поверх canvas — рисуется в полном разрешении вьюпорта (1080p на боксе),
 * поэтому текст чёткий независимо от рендер-скейла спектатора. Ничего не знает
 * о Babylon: раз в кадр получает готовый контекст из Spectator.
 */

export interface OverlayCtx {
  /** Кого показываем: ник игрока / имя моба / null (обзор, путь). */
  watching: string | null;
  /** Подпись кадра для режима без цели («Обзор зоны», «Путь: …»). */
  shotLabel: string;
  /** HP цели 0..1 и абсолютные значения — или null, если у кадра нет цели. */
  targetHp: { frac: number; cur: number; max: number; name: string; boss: boolean } | null;
  /** Час мира 0..24. */
  hour: number;
  /** Ники всех онлайн-игроков. */
  online: string[];
}

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
.ov-top { right:2.2vw; top:2.4vh; text-align:right; }
.ov-clock { font-weight:700; font-size:2.3vh; letter-spacing:.06em; }
.ov-online { margin-top:1vh; font-size:1.7vh; line-height:1.5; opacity:.9; }
.ov-online b { display:block; font-size:1.3vh; letter-spacing:.16em; opacity:.6;
  text-transform:uppercase; margin-bottom:.3vh; font-weight:700; }
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
.ov-card { left:0; right:0; bottom:16vh; text-align:center; opacity:0;
  transition:opacity .5s ease; }
.ov-card.show { opacity:1; }
.ov-card .t { display:inline-block; padding:1.4vh 3vw; background:rgba(12,13,18,.72);
  border-left:.5vh solid #e8433f; }
.ov-card .t s { display:block; text-decoration:none; font-weight:800; font-size:3.6vh; }
.ov-card .t u { display:block; text-decoration:none; font-size:2vh; opacity:.8; margin-top:.5vh; }
`;

function hhmm(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function dur(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export class Overlay {
  private readonly root: HTMLDivElement;
  private readonly wm: HTMLDivElement;
  private readonly clock: HTMLDivElement;
  private readonly online: HTMLDivElement;
  private readonly watch: HTMLDivElement;
  private readonly hp: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpLabel: HTMLElement;
  private readonly card: HTMLDivElement;
  private readonly cardTitle: HTMLElement;
  private readonly cardSub: HTMLElement;
  private readonly startedAt = performance.now();
  private cardUntil = 0;

  constructor() {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = div("ov");

    this.wm = div("box ov-wm");
    this.wm.innerHTML = "<i></i><span>ZEP GAME</span>";

    const top = div("box ov-top");
    this.clock = div("ov-clock");
    this.online = div("ov-online");
    top.append(this.clock, this.online);

    this.watch = div("box ov-watch");

    this.hp = div("box ov-hp");
    this.hpLabel = document.createElement("b");
    const bar = div("bar");
    this.hpFill = div("fill");
    bar.appendChild(this.hpFill);
    this.hp.append(this.hpLabel, bar);
    this.hp.style.display = "none";

    this.card = div("box ov-card");
    const t = div("t");
    this.cardTitle = document.createElement("s");
    this.cardSub = document.createElement("u");
    t.append(this.cardTitle, this.cardSub);
    this.card.appendChild(t);

    this.root.append(this.wm, top, this.watch, this.hp, this.card);
    document.body.appendChild(this.root);
  }

  /** Заставка/нижняя треть с дашборда. */
  showCard(title: string, sub = "", secs = 6): void {
    this.cardTitle.textContent = title;
    this.cardSub.textContent = sub;
    this.cardSub.style.display = sub ? "block" : "none";
    this.card.classList.add("show");
    this.cardUntil = performance.now() + Math.max(1, secs) * 1000;
  }

  update(ctx: OverlayCtx): void {
    const now = performance.now();

    this.clock.textContent = `🕐 ${hhmm(ctx.hour)}   ⏱ ${dur((now - this.startedAt) / 1000)}`;

    if (ctx.online.length) {
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
    } else {
      this.online.innerHTML = "";
    }

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

    const hp = ctx.targetHp;
    if (hp) {
      this.hp.style.display = "";
      this.hp.classList.toggle("boss", hp.boss);
      this.hpFill.style.width = `${Math.round(Math.max(0, Math.min(1, hp.frac)) * 100)}%`;
      this.hpLabel.textContent = `${hp.name} — ${Math.max(0, Math.ceil(hp.cur))}/${Math.round(hp.max)}`;
    } else {
      this.hp.style.display = "none";
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
