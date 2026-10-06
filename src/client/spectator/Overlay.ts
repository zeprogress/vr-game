import { glyph, itemIcon } from "#shared/icons";
import { CAT_HELP } from "#shared/catacombs";
import { ensureIconCss, iconHtml } from "../ui/icons";
import type { OverlayPatch, LeaderboardRow, CatBoardRow, LootItem } from "#shared/net/messages";
import type { HeroStatRow } from "#shared/heroStats";
import { TOWER } from "#shared/tower";
import { AEGIS_NAME, ITEMS } from "#shared/items";

/**
 * Оверлеи стрима (этап 17 Ф6).
 *
 * DOM поверх canvas — рисуется в полном разрешении вьюпорта (1080p на боксе),
 * поэтому текст чёткий независимо от рендер-скейла спектатора. Ничего не знает
 * о Babylon: раз в кадр получает готовый контекст из Spectator. Каждый элемент
 * включается/выключается с пульта (SpecCmd overlay).
 */


/** Время забега башни «0:00». */
/** Урон коротко: 9840, 41.7k, 128k. */
function fmtDmg(n: number): string {
  return n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n);
}

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Атрибуты в «смотрим»: подпись и цвет (сила — красный, ловкость — зелёный, интеллект — синий). */
const ATTR_UI: [string, string][] = [
  ["сил", "#ff6b5e"],
  ["лов", "#6fdc6f"],
  ["инт", "#6fb0ff"],
  ["тел", "#e8a35a"],
  ["удч", "#e8d45a"],
  ["мдр", "#c79bff"],
];

export interface OverlayCtx {
  /** Кого показываем: ник игрока / имя моба / null (обзор, путь). */
  watching: string | null;
  /** Подпись кадра для режима без цели («Обзор зоны», «Пролёт: …»). */
  shotLabel: string;
  /** HP цели 0..1 и абсолютные значения — или null, если у кадра нет цели. */
  targetHp: { frac: number; cur: number; max: number; name: string; boss: boolean } | null;
  /** Таблица характеристик игрока под ником в «смотрим» (см. #shared/heroStats). */
  watchStats: HeroStatRow[] | null;
  /** Титул героя (под ником) или null. */
  watchTitle?: string | null;
  /** Уровень героя — «N ур.» рядом с ником. */
  watchLevel: number | null;
  /** Атрибуты героя [сил, лов, инт] — отдельная цветная строка. */
  watchAttrs: number[] | null;
  /** Баффы на герое в «смотрим»: иконка, название, что даёт, сколько осталось (с) и цвет. */
  watchBuffs: { icon: string; name: string; desc: string; secs: number; color: string }[] | null;
  /** Краткий инвентарь игрока — строка под полосой «HP цели» (только для игрока). */
  watchInv: string | null;
  /** Онлайн-игроки: ник и говорит ли сейчас (зелёный огонёк). */
  /** plat: 0 — не пришло (боты), 1 — ПК, 2 — телефон, 3 — VR (см. PlayerState.plat). */
  online: readonly { nick: string; speaking: boolean; bot: boolean; plat: number }[];
  /** Квест чата (все боты вместе) или null. */
  chatQuest?: { title: string; got: number; need: number; secs: number } | null;
  /** Катакомбы: сбор/забег — панель с таймером и командами чата. */
  catacombs?: { gather: boolean; hall: string; left: number; party: number; final: boolean; lives: number } | null;
  /** Текущий забег «Охотничьей башни» — этаж/мобы/босс, или null если башня не активна. */
  towerStatus: {
    heroNick: string;
    floor: number;
    mobsLeft: number;
    mobsTotal: number;
    bossActive: boolean;
    /** Секунд с начала забега. */
    timeSec: number;
  } | null;
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
.ov-clock small { font-size:1.5vh; font-weight:600; opacity:.7; margin-left:.7vh;
  letter-spacing:.04em; }
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
.ov-catboard { left:2.2vw; top:23vh; font-size:1.7vh; line-height:1.6; padding-top:1.2vh; }
.ov-catboard b { display:block; font-size:1.3vh; letter-spacing:.16em; opacity:.6;
  text-transform:uppercase; margin-bottom:.3vh; font-weight:700; }
.ov-catboard div { display:flex; gap:.9vh; align-items:center; min-height:2.9vh; }
.ov-catboard .rk { flex:none; width:3vh; text-align:center; line-height:1; opacity:.7;
  font-size:1.7vh; font-variant-numeric:tabular-nums; }
.ov-catboard .rk.medal { font-size:2.5vh; opacity:1; }
.ov-catboard .nm { font-weight:700; }
.ov-catboard .lv { opacity:.75; margin-left:.4vh; }
.ov-watch { left:2.2vw; bottom:3vh; }
.ov-watch b { font-size:1.4vh; letter-spacing:.2em; opacity:.7; font-weight:700;
  text-transform:uppercase; }
.ov-watch span { display:block; font-weight:800; font-size:3.2vh; margin-top:.4vh; }
.ov-watch table.stats { border-collapse:collapse; margin-top:.6vh; }
.ov-watch table.stats td { font-size:1.7vh; font-weight:500; padding:.15vh 0;
  letter-spacing:.02em; opacity:.92; }
.ov-watch table.stats td.lb { opacity:.68; padding-right:1.2vh; white-space:nowrap; }
.ov-watch table.stats td.vl { font-weight:700; text-align:right; }
.ov-watch em.ttl { display:block; font-style:normal; font-weight:700; font-size:1.8vh; color:#c79bff; margin-top:.2vh; }
.ov-watch span .lvl { font-size:2vh; font-weight:700; opacity:.75; margin-left:.4vh; }
.ov-watch table.stats i.at { font-style:normal; font-weight:800; opacity:1; }
.ov-watch .buffs { display:flex; flex-direction:column; gap:.4vh; margin-top:.8vh; }
.ov-watch .buff { display:flex; align-items:center; gap:.7vh; padding:.3vh 1vh .3vh .6vh; border-radius:.8vh;
  background:rgba(0,0,0,.35); border-left:.35vh solid var(--bc); box-shadow:0 0 1.2vh -0.4vh var(--bc);
  white-space:nowrap; font-size:1.55vh; animation:ovBuffGlow 2.4s ease-in-out infinite; }
.ov-watch .buff .ic { font-style:normal; font-size:1.8vh; line-height:1; }
.ov-watch .buff .tx { display:flex; align-items:baseline; gap:.7vh; }
.ov-watch .buff .nm { font-weight:800; color:var(--bc); }
.ov-watch .buff .ds { font-weight:500; opacity:.85; }
.ov-watch .buff .tm { margin-left:auto; padding-left:1vh; font-weight:700; opacity:.75; font-variant-numeric:tabular-nums; }
@keyframes ovBuffGlow { 50% { box-shadow:0 0 1.8vh 0 var(--bc); } }
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
.ov-feed u { text-decoration:none; font-weight:800; }
.ov-feed u.gold { color:#f5c542; }
.ov-feed u.legendary { color:#b67cff; text-shadow:0 0 .6vh rgba(182,124,255,.6); }
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
/* Баннер с лутом (успешный ивент/добит босс) — крупнее + иконки добычи. */
.ov-boss.has-loot s { font-size:8.2vh; }
.ov-boss.has-loot u { font-size:2.7vh; }
.ov-card.has-loot .t s { font-size:4.4vh; }
.ov-card.has-loot .t u { font-size:2.3vh; }
.ov-loot { display:flex; gap:1.4vh; justify-content:center; margin-top:1.6vh; }
.ov-loot .it { position:relative; width:7vh; height:7vh; border-radius:1.2vh;
  background:rgba(0,0,0,.35); border:.15vh solid rgba(255,255,255,.25);
  display:flex; align-items:center; justify-content:center; box-shadow:0 .4vh 1.4vh rgba(0,0,0,.5); }
.ov-loot .it img { width:72%; height:72%; object-fit:contain; }
.ov-loot .it { background:#0f0e13; border:.25vh solid var(--tier-base-edge); color:var(--tier-base); }
.ov-loot .it.t-gold { border-color:var(--tier-gold-edge); color:var(--tier-gold); box-shadow:inset 0 0 1.4vh var(--tier-gold-glow), 0 .4vh 1.4vh rgba(0,0,0,.5); }
.ov-loot .it.t-legendary { border-color:var(--tier-legendary-edge); color:var(--tier-legendary); box-shadow:inset 0 0 1.6vh var(--tier-legendary-glow), 0 .4vh 1.4vh rgba(0,0,0,.5); }
.ov-loot .it .ico { font-size:3.8vh; line-height:1; display:flex; align-items:center; justify-content:center; }
.ov-loot .it .tint { width:60%; height:60%; border-radius:.6vh; }
.ov-loot .it .cnt { position:absolute; right:.3vh; bottom:.1vh; font:800 1.6vh system-ui,sans-serif;
  color:#fff; text-shadow:0 .1vh .3vh #000,0 0 .3vh #000; }
.ov-ticker { left:50%; top:4vh; transform:translateX(-50%); text-align:center;
  font-weight:800; font-size:5.2vh; letter-spacing:.02em; text-transform:none;
  color:#1f7bff; max-width:86vw;
  text-shadow:0 0 .5vh rgba(0,0,0,.95), 0 0 1.4vh rgba(0,0,0,.9),
    0 0 3vh rgba(0,0,0,.8), 0 0 5vh rgba(0,0,0,.6); }
.ov-ticker.news { top:7vh; font-size:2.3vh; font-weight:400; letter-spacing:normal;
  color:#fff; animation:none;
  text-shadow:0 .15vh .5vh rgba(0,0,0,.85); }
/* Ниже рейтинга башни (тот — с 23vh, до 5 строк ≈ до 43vh), иначе перекрывал его. */
.ov-cattop { left:1.2vw; top:12vh; width:22vw; font-size:1.65vh; border-left:.35vh solid #ff5a3c; }
.ov-cattop b { display:block; font-weight:800; font-size:1.9vh; color:#ffb199; letter-spacing:.03em; margin-bottom:.5vh; }
.ov-cattop .hd, .ov-cattop .r { display:grid; grid-template-columns:1fr 5vw 3.6vw 2.4vw; gap:.4vw; font-variant-numeric:tabular-nums; }
.ov-cattop .hd { opacity:.6; font-size:1.3vh; }
.ov-cattop .r span:not(.nm) { text-align:right; }
.ov-cattop .r .nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ov-cattop .r.dead { opacity:.45; }
.ov-cat { right:1.2vw; bottom:6vh; width:21vw; font-size:1.55vh; line-height:1.35; border-left:.35vh solid #9146ff; }
.ov-cat b { display:block; font-weight:800; font-size:2vh; color:#d6b8ff; letter-spacing:.03em; }
.ov-cat .st { margin:.3vh 0 .8vh; opacity:.92; font-variant-numeric:tabular-nums; }
.ov-cat .c { display:flex; gap:.6vw; margin:.25vh 0; }
.ov-cat .c i { font-style:normal; font-weight:800; color:#ffd66b; min-width:8.2vw; white-space:nowrap; }
.ov-cat .c span { opacity:.85; }
.ov-cq { left:50%; bottom:12.5vh; transform:translateX(-50%); width:32vw; text-align:center; font-size:1.8vh; }
.ov-cq b { display:block; font-weight:800; font-size:2.2vh; color:#d6b8ff; letter-spacing:.02em; }
.ov-cq .bar { height:1.1vh; margin:.7vh 0 .4vh; background:rgba(255,255,255,.14); border-radius:1vh; overflow:hidden; }
.ov-cq .bar i { display:block; height:100%; background:linear-gradient(90deg,#9146ff,#c79bff); border-radius:1vh; }
.ov-cq span { opacity:.85; font-variant-numeric:tabular-nums; }
.ov-towerstatus { left:2.2vw; top:47vh; text-align:left; font-size:1.7vh; }
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
  private readonly cardLoot: HTMLDivElement;
  private cardUntil = 0; // 0 — держать бесконечно (пока не скроют)
  private readonly feed: HTMLDivElement;
  private feedRows: { el: HTMLElement; until: number }[] = [];
  private readonly boss: HTMLDivElement;
  private readonly bossTitle: HTMLElement;
  private readonly bossSub: HTMLElement;
  private readonly bossLoot: HTMLDivElement;
  private bossUntil = 0;
  private readonly top: HTMLDivElement;
  private topRows: LeaderboardRow[] = [];
  /** Топ по «Охотничьей башне» — своя панель под основным топом. */
  private readonly catBoard: HTMLDivElement;
  private catBoardRows: CatBoardRow[] = [];
  private readonly ticker: HTMLDivElement;
  private tickerText = "";
  private tickerKind: "event" | "news" = "event";
  private readonly towerStatus: HTMLDivElement;
  private readonly cq: HTMLDivElement;
  private readonly cat: HTMLDivElement = div("box ov-cat");
  private lastCatSig = "";
  private lastCqSig = "";
  private lastTowerStatusSig = "";
  private cfg: Config = { ...DEFAULT };
  // Кэш последнего отрисованного состояния — не трогаем DOM, пока данные не
  // изменились (update() зовётся каждый кадр; за часы стрима постоянный
  // innerHTML+createElement подвешивал слабый стрим-бокс).
  private lastOnlineSig = " ";
  private lastWatchSig = " ";
  private lastClock = "";

  constructor() {
    const style = document.createElement("style");
    ensureIconCss();
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
    this.cardLoot = div("ov-loot");
    t.append(this.cardTitle, this.cardSub, this.cardLoot);
    this.card.appendChild(t);

    this.feed = div("box ov-feed");
    this.top = div("box ov-top");
    this.catBoard = div("box ov-catboard");
    this.ticker = div("box ov-ticker");
    this.towerStatus = div("box ov-towerstatus");
    this.cq = div("box ov-cq");

    this.boss = div("box ov-boss");
    this.bossTitle = document.createElement("s");
    this.bossSub = document.createElement("u");
    this.bossLoot = div("ov-loot");
    this.boss.append(this.bossTitle, this.bossSub, this.bossLoot);

    this.root.append(
      this.cat,
      this.catTop,
      this.wm,
      this.clock,
      this.online,
      this.watch,
      this.hp,
      this.feed,
      this.card,
      this.boss,
      this.top,
      this.catBoard,
      this.ticker,
      this.towerStatus,
      this.cq,
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
      row.innerHTML = `<b></b><i>${glyph("ui.kill")}</i><s></s>`;
      row.querySelector("b")!.textContent = by;
      row.querySelector("s")!.textContent = victim;
    } else {
      row.innerHTML = `<s></s><i>пал</i>`;
      row.querySelector("s")!.textContent = victim;
    }
    this.addFeedRow(row, 7000);
  }

  private addFeedRow(row: HTMLElement, lifeMs: number): void {
    this.feed.appendChild(row);
    this.feedRows.push({ el: row, until: performance.now() + lifeMs });
    while (this.feedRows.length > 6) {
      this.feedRows.shift()?.el.remove();
    }
  }

  /** Строка «подобрал» в кил-фиде: золотое/уникальное оружие или щит. */
  pushPickup(nick: string, item: string, tier: "gold" | "legendary"): void {
    const row = document.createElement("div");
    row.innerHTML = `<b></b><i>подобрал</i><u></u>`;
    row.querySelector("b")!.textContent = nick;
    const u = row.querySelector("u")!;
    u.textContent = item;
    u.className = tier;
    this.addFeedRow(row, 9000);
  }

  /** Топ-5 героев — приходит с сервера раз в 10 с (Ф10). */
  /** Таблица забега катакомб: пока идёт забег — вместо топа героев и башни. */
  private catTopRows: { nick: string; dmg: number; kills: number; deaths: number; dead: boolean }[] = [];
  private readonly catTop: HTMLDivElement = div("box ov-cattop");
  private catTopSig = "";
  setCatTop(rows: { nick: string; dmg: number; kills: number; deaths: number; dead: boolean }[]): void {
    this.catTopRows = rows;
  }

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

  /** Рекорды катакомб (вместо башни): лучший урон героя за один забег — тот же ритм, что и setLeaderboard. */
  setCatBoard(rows: CatBoardRow[]): void {
    this.catBoardRows = rows;
    this.renderCatBoard();
  }

  private renderCatBoard(): void {
    this.catBoard.innerHTML = "<b>☠ рекорды катакомб</b>";
    const medal = ["🥇", "🥈", "🥉"];
    this.catBoardRows.slice(0, 5).forEach((r, i) => {
      const row = document.createElement("div");
      const rk = document.createElement("span");
      rk.className = i < 3 ? "rk medal" : "rk";
      rk.textContent = medal[i] ?? String(i + 1);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = r.nick;
      const lv = document.createElement("span");
      lv.className = "lv";
      lv.textContent = `урон ${fmtDmg(r.dmg)}${r.wins ? ` · ${r.wins}🏆` : ""}`;
      row.append(rk, nm, lv);
      this.catBoard.appendChild(row);
    });
  }

  /** Иконка (или цветной квадрат — нет своей картинки) + счётчик, для баннера с лутом. */
  private renderLoot(el: HTMLDivElement, loot: LootItem[] | undefined): void {
    el.innerHTML = "";
    if (!loot || loot.length === 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    for (const l of loot) {
      const def = ITEMS[l.id];
      // Иконки как в окне снаряжения игры: оружие — значок класса в рамке цвета тира.
      const w = def.weapon;
      const it = div(`it${w ? ` t-${w.tier}` : ""}`);
      it.title = l.aegis ? AEGIS_NAME : def.name;
      const ico = document.createElement("span");
      ico.className = "ico";
      ico.innerHTML = iconHtml(itemIcon(l.id, l.aegis));
      it.appendChild(ico);
      if (l.count > 1) {
        const cnt = document.createElement("span");
        cnt.className = "cnt";
        cnt.textContent = `×${l.count}`;
        it.appendChild(cnt);
      }
      el.appendChild(it);
    }
  }

  /**
   * Заставка/нижняя треть с дашборда.
   * `secs <= 0` — держать бесконечно, пока не скроют. Пустой `title` — скрыть.
   * `loot` — успешный ивент: показать иконки добычи, баннер крупнее.
   */
  showCard(title: string, sub = "", secs = 0, loot?: LootItem[]): void {
    if (!title) {
      this.card.classList.remove("show");
      this.cardUntil = 0;
      return;
    }
    this.cardTitle.textContent = title;
    this.cardSub.textContent = sub;
    this.cardSub.style.display = sub ? "block" : "none";
    this.renderLoot(this.cardLoot, loot);
    this.card.classList.toggle("has-loot", !!loot && loot.length > 0);
    this.card.classList.add("show");
    this.cardUntil = secs > 0 ? performance.now() + secs * 1000 : 0;
  }

  /** Большой баннер по центру: босс появился / повержен. */
  bossBanner(kind: "spawn" | "down", by?: string, loot?: string, lootItems?: LootItem[]): void {
    this.boss.classList.remove("warn", "win");
    if (kind === "down") {
      this.boss.classList.add("win");
      this.bossTitle.textContent = "Босс повержен!";
      this.bossSub.textContent = by ? `Решающий удар: ${by}` : "";
      void loot;
    } else {
      this.boss.classList.add("warn");
      this.bossTitle.textContent = "Босс появился";
      this.bossSub.textContent = "Багровый слизень вышел на охоту";
    }
    this.bossSub.style.display = this.bossSub.textContent ? "block" : "none";
    this.renderLoot(this.bossLoot, kind === "down" ? lootItems : undefined);
    this.boss.classList.toggle("has-loot", kind === "down" && !!lootItems && lootItems.length > 0);
    this.boss.classList.add("show");
    // С лутом — дольше на экране, есть что разглядеть; без — тоже дольше, чем
    // раньше (было 5200 фиксированно на всё подряд).
    this.bossUntil = performance.now() + (kind === "down" && lootItems?.length ? 9000 : 7000);
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
    // Катакомбы идут — вместо топов слева таблица забега (урон, убийства, смерти).
    // Топ урона — только пока идут катакомбы (и 15 с финала); закончились — снова топ по уровню.
    if (!ctx.catacombs && this.catTopRows.length) this.catTopRows = [];
    const catRun = !!ctx.catacombs && !ctx.catacombs.gather && this.catTopRows.length > 0;
    show(this.top, this.cfg.top && !catRun && this.topRows.length > 0);
    show(this.catBoard, this.cfg.top && !catRun && this.catBoardRows.length > 0);
    show(this.catTop, catRun);
    if (catRun) {
      const sig = this.catTopRows.map((r) => `${r.nick}${r.dmg}${r.kills}${r.deaths}${r.dead}`).join("|");
      if (sig !== this.catTopSig) {
        this.catTopSig = sig;
        this.catTop.innerHTML = "<b>☠ урон в катакомбах</b>";
        const hd = div("hd");
        hd.innerHTML = "<span></span><span>урон</span><span>убито</span><span>☠</span>";
        this.catTop.appendChild(hd);
        this.catTopRows.forEach((r, i) => {
          const row = div(r.dead ? "r dead" : "r");
          const nm = document.createElement("span");
          nm.className = "nm";
          nm.textContent = `${i + 1}. ${r.nick}`;
          const d = document.createElement("span");
          d.textContent = fmtDmg(r.dmg);
          const k = document.createElement("span");
          k.textContent = String(r.kills);
          const de = document.createElement("span");
          de.textContent = String(r.deaths);
          row.append(nm, d, k, de);
          this.catTop.appendChild(row);
        });
      }
    }
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
        const tail = document.createElement("small");
        tail.textContent = "(мск)";
        this.clock.replaceChildren(document.createTextNode(t), tail);
        this.lastClock = t;
      }
    }

    // Живые игроки (ПК/телефон/VR) сверху, боты — ниже; порядок внутри групп прежний.
    const ONLINE_ROWS = 10;
    const onlineSorted = this.cfg.online ? [...ctx.online].sort((x, y) => Number(x.bot) - Number(y.bot)) : [];
    const onlineSig = this.cfg.online
      ? onlineSorted
          .slice(0, ONLINE_ROWS)
          .map((p) => `${p.nick}${p.speaking ? 1 : 0}${p.bot ? 1 : 0}${p.plat}`)
          .join("|") + `${ctx.online.length}`
      : "";
    if (this.cfg.online && ctx.online.length && onlineSig !== this.lastOnlineSig) {
      this.lastOnlineSig = onlineSig;
      this.online.innerHTML = "<b>в игре</b>";
      for (const p of onlineSorted.slice(0, ONLINE_ROWS)) {
        const row = document.createElement("div");
        const dot = document.createElement("i");
        dot.className = "spk";
        if (!p.speaking) dot.style.visibility = "hidden"; // держит выравнивание
        const nm = document.createElement("span");
        const platIcon = p.bot ? "🤖" : p.plat === 3 ? "🥽" : p.plat === 2 ? "📱" : p.plat === 1 ? "🖥" : "";
        nm.textContent = (platIcon ? `${platIcon} ` : "") + p.nick;
        row.append(dot, nm);
        this.online.appendChild(row);
      }
      if (ctx.online.length > ONLINE_ROWS) {
        const more = document.createElement("div");
        more.textContent = `+${ctx.online.length - ONLINE_ROWS}`;
        more.style.opacity = ".6";
        this.online.appendChild(more);
      }
    }

    const statsSig = ctx.watchStats?.map((r) => `${r.label}:${r.value}`).join(",") ?? "";
    const buffSig = ctx.watchBuffs?.map((x) => `${x.name}:${Math.ceil(x.secs / 60)}`).join(",") ?? "";
    const watchSig = this.cfg.watching ? `${ctx.watching}|${ctx.watchTitle}|${ctx.watchLevel}|${ctx.watchAttrs?.join("/")}|${ctx.shotLabel}|${statsSig}|${buffSig}` : "";
    if (this.cfg.watching && watchSig !== this.lastWatchSig) {
      this.lastWatchSig = watchSig;
      if (ctx.watching) {
        this.watch.innerHTML = "";
        const s = document.createElement("span");
        s.textContent = ctx.watching;
        if (ctx.watchLevel !== null) {
          const lv = document.createElement("small");
          lv.className = "lvl";
          lv.textContent = `${ctx.watchLevel} ур.`;
          s.append(" ", lv);
        }
        this.watch.append(s);
        if (ctx.watchTitle) {
          const t = document.createElement("em");
          t.className = "ttl";
          t.textContent = ctx.watchTitle;
          this.watch.append(t);
        }
        if (ctx.watchStats && ctx.watchStats.length > 0) {
          const table = document.createElement("table");
          table.className = "stats";
          // Шесть атрибутов — двумя строками по три.
          for (let row0 = 0; ctx.watchAttrs && row0 < ATTR_UI.length; row0 += 3) {
            const tr = document.createElement("tr");
            const lb = document.createElement("td");
            lb.className = "lb";
            if (row0 === 0) lb.append("Атрибуты ");
            const vl = document.createElement("td");
            vl.className = "vl";
            ATTR_UI.slice(row0, row0 + 3).forEach(([name, color], j) => {
              const i = row0 + j;
              if (j > 0) {
                lb.append("/");
                vl.append("/");
              }
              const n = document.createElement("i");
              n.className = "at";
              n.style.color = color;
              n.textContent = name;
              lb.append(n);
              const v = document.createElement("i");
              v.className = "at";
              v.style.color = color;
              v.textContent = String(ctx.watchAttrs![i] ?? 1);
              vl.append(v);
            });
            tr.append(lb, vl);
            table.appendChild(tr);
          }
          for (const row of ctx.watchStats) {
            const tr = document.createElement("tr");
            const lb = document.createElement("td");
            lb.className = "lb";
            lb.textContent = row.label;
            const vl = document.createElement("td");
            vl.className = "vl";
            vl.textContent = row.value;
            tr.append(lb, vl);
            table.appendChild(tr);
          }
          this.watch.append(table);
        }
        if (ctx.watchBuffs && ctx.watchBuffs.length > 0) {
          const list = document.createElement("div");
          list.className = "buffs";
          for (const bf of ctx.watchBuffs) {
            const row = document.createElement("div");
            row.className = "buff";
            row.style.setProperty("--bc", bf.color);
            const ic = document.createElement("i");
            ic.className = "ic";
            ic.textContent = bf.icon;
            const tx = document.createElement("div");
            tx.className = "tx";
            const nm = document.createElement("em");
            nm.className = "nm";
            nm.style.fontStyle = "normal";
            nm.textContent = bf.name;
            const ds = document.createElement("em");
            ds.className = "ds";
            ds.style.fontStyle = "normal";
            ds.textContent = bf.desc;
            tx.append(nm, ds);
            const tm = document.createElement("em");
            tm.className = "tm";
            tm.style.fontStyle = "normal";
            tm.textContent = `${Math.ceil(bf.secs / 60)} мин`;
            row.append(ic, tx, tm);
            list.append(row);
          }
          this.watch.append(list);
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

    const ct = ctx.catacombs;
    show(this.cat, !!ct);
    if (ct) {
      const mm = `${Math.floor(ct.left / 60)}:${String(ct.left % 60).padStart(2, "0")}`;
      const sig = `${ct.gather}|${ct.hall}|${mm}|${ct.party}|${ct.final}|${ct.lives}`;
      if (sig !== this.lastCatSig) {
        this.lastCatSig = sig;
        this.cat.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = "☠ КАТАКОМБЫ";
        const st = div("st");
        st.textContent = ct.gather
          ? `сбор отряда · ${ct.party} героев · спуск через ${mm}`
          : `${ct.final ? "⚔ " : ""}${ct.hall} · отряд ${ct.party} · жизней ❤${ct.lives} · осталось ${mm}`;
        this.cat.append(b, st);
        for (const [cmd, what] of CAT_HELP) {
          if (!ct.gather && cmd === "!катакомбы") continue;
          const row = div("c");
          const i = document.createElement("i");
          i.textContent = cmd;
          const sp = document.createElement("span");
          sp.textContent = what;
          row.append(i, sp);
          this.cat.append(row);
        }
      }
    }

    const cq = ctx.chatQuest;
    show(this.cq, !!cq);
    if (cq) {
      const sig = `${cq.title}|${cq.got}|${Math.ceil(cq.secs / 60)}`;
      if (sig !== this.lastCqSig) {
        this.lastCqSig = sig;
        const pct = Math.min(100, Math.round((cq.got / Math.max(1, cq.need)) * 100));
        this.cq.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = cq.title;
        const bar = div("bar");
        const fill = document.createElement("i");
        fill.style.width = `${pct}%`;
        bar.append(fill);
        const sp = document.createElement("span");
        sp.textContent = `${cq.got} / ${cq.need} · осталось ${Math.ceil(cq.secs / 60)} мин · !квест — участвовать`;
        this.cq.append(b, bar, sp);
      }
    }

    const ts = ctx.towerStatus;
    // Раньше было завязано на cfg.clock — если на пульте выключены часы,
    // панель этажа гасла вместе с ними, хотя это разные виджеты. Своего
    // тумблера у неё нет, поэтому вешаем на cfg.top (тот же, что у топов).
    show(this.towerStatus, this.cfg.top && !!ts);
    if (ts) {
      const sig = `${ts.heroNick}|${ts.floor}|${ts.mobsLeft}|${ts.mobsTotal}|${ts.bossActive ? 1 : 0}|${ts.timeSec}`;
      if (sig !== this.lastTowerStatusSig) {
        this.lastTowerStatusSig = sig;
        this.towerStatus.classList.toggle("boss", ts.bossActive);
        this.towerStatus.innerHTML = "";
        const b = document.createElement("b");
        b.textContent = "Охотничья башня";
        const span = document.createElement("span");
        span.textContent = `Этаж ${ts.floor}/${TOWER.floors} · ${fmtTime(ts.timeSec)}`;
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
