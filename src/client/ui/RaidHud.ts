import { inRaidCrack, inRaidGap, nearestGap, RAID, RAID_FIGHT, RAID_PHASES } from "#shared/raid";
import { FX_RGB, rgbHex } from "#shared/look";
import type { RaidView } from "../world/RaidArena";

const MOON = rgbHex(FX_RGB.moon);
const GOLD = rgbHex(FX_RGB.moonGold);

/** Где стоит и куда смотрит свой герой (для подсказки «в разрыве» и стрелки). */
export interface RaidHudMe {
  x: number;
  z: number;
  /** Куда смотрит камера (yaw, рад). */
  yaw: number;
  dead: boolean;
}

/**
 * Панель боя с рейд-боссом (ПК/телефон и эфир): фаза, HP с отметками фаз, «✓ в разрыве / ✗ вне» со
 * стрелкой к ближайшему разрыву (у игрока), таймеры «Прилива», «Слезы», «Вздоха», «Притяжение».
 * Видна, пока идёт бой и герой (или камера эфира) у арены.
 */
export class RaidHud {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly pct: HTMLSpanElement;
  private readonly status: HTMLDivElement;
  private readonly arrow: HTMLSpanElement;
  private readonly statusText: HTMLSpanElement;
  private readonly timers: HTMLDivElement;
  private shown = false;

  constructor(private readonly spectator = false) {
    ensureCss();
    this.el = div("rh-root" + (spectator ? " rh-spec" : ""));
    this.title = div("rh-title");
    const bar = div("rh-bar");
    this.fill = div("rh-fill");
    bar.append(this.fill);
    for (const p of RAID_PHASES.slice(1)) {
      const t = div("rh-tick");
      t.style.left = `${p.from * 100}%`;
      bar.append(t);
    }
    this.pct = document.createElement("span");
    this.pct.className = "rh-pct";
    bar.append(this.pct);
    this.status = div("rh-status");
    this.arrow = document.createElement("span");
    this.arrow.className = "rh-arrow";
    this.arrow.textContent = "⬆";
    this.statusText = document.createElement("span");
    this.status.append(this.arrow, this.statusText);
    this.timers = div("rh-timers");
    this.el.append(this.title, bar, this.status, this.timers);
    this.el.style.display = "none";
    document.body.append(this.el);
  }

  update(v: RaidView | null, me: RaidHudMe | null): void {
    const near = this.spectator || (!!me && Math.hypot(me.x - RAID.x, me.z - RAID.z) < (v?.edge ?? RAID.r) + 40);
    const show = !!v && v.ph > 0 && near;
    if (show !== this.shown) {
      this.shown = show;
      this.el.style.display = show ? "" : "none";
    }
    if (!show || !v) return;

    this.title.textContent = `🌙 Лунный аватар · фаза ${v.ph}/${RAID_PHASES.length}`;
    const frac = v.boss && v.boss.maxHp > 0 ? Math.max(0, v.boss.hp / v.boss.maxHp) : 0;
    this.fill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.pct.textContent = `${Math.ceil(frac * 100)}%`;

    // Свой герой: в разрыве ли, стрелка к ближайшему разрыву, особые угрозы.
    if (me && !me.dead && !this.spectator) {
      const onArena = Math.hypot(me.x - RAID.x, me.z - RAID.z) < v.edge;
      const inGap = inRaidGap(me.x, me.z, v.o, v.on, v.gap);
      const pullBurn = v.pull && Math.hypot(me.x - RAID.x, me.z - RAID.z) < RAID_FIGHT.pull.coreR + 1;
      const inCrack = v.crackOn && inRaidCrack(me.x, me.z, v.cracks, v.ang);
      let text: string;
      let tone: "ok" | "bad" | "warn";
      if (inCrack) {
        text = "Пропасть под ногами — уходи!";
        tone = "bad";
      } else if (pullBurn) {
        text = "Притяжение жжёт — отойди от центра!";
        tone = "bad";
      } else if (onArena && !inGap && v.tide > 0 && v.tide <= RAID_FIGHT.tide.warn) {
        text = "Прилив — беги в разрыв!";
        tone = "bad";
      } else if (inGap && onArena) {
        text = "✓ В РАЗРЫВЕ — полный урон";
        tone = "ok";
      } else {
        text = onArena
          ? `✗ Вне разрыва — урон ${Math.round(RAID_FIGHT.outGap * 100)}%`
          : "Зайди на арену и встань в разрыв";
        tone = "warn";
      }
      this.statusText.textContent = text;
      this.status.className = `rh-status rh-${tone}`;
      const g = nearestGap(me.x, me.z, v.o, v.on);
      if (g !== null && !(inGap && onArena)) {
        const r = Math.max(8, Math.min(v.edge - 3, Math.hypot(me.x - RAID.x, me.z - RAID.z)));
        const gx = RAID.x + Math.sin(g) * r;
        const gz = RAID.z + Math.cos(g) * r;
        const dir = Math.atan2(gx - me.x, gz - me.z);
        this.arrow.style.display = "";
        this.arrow.style.transform = `rotate(${(((dir - me.yaw) * 180) / Math.PI).toFixed(0)}deg)`;
      } else this.arrow.style.display = "none";
      this.status.style.display = "";
    } else this.status.style.display = "none";

    // Таймеры способностей.
    const chips: string[] = [];
    const chip = (name: string, sec: number, hot: number): void => {
      if (sec > 0) chips.push(`<span class="rh-chip${sec <= hot ? " rh-hot" : ""}">${name} ${sec} с</span>`);
    };
    chip("Прилив", v.tide, RAID_FIGHT.tide.warn);
    chip("Слеза", v.tear, 2);
    if (v.breath > 0) chip("Вздох — прыгай", v.breath, RAID_FIGHT.breath.warn);
    if (v.pull) chips.push(`<span class="rh-chip rh-hot">Притяжение!</span>`);
    if (v.cracks.length) chips.push(`<span class="rh-chip${v.crackOn ? "" : " rh-hot"}">${v.crackOn ? "Пропасти" : "Трещины!"}</span>`);
    this.timers.innerHTML = chips.join("");
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

let cssDone = false;
function ensureCss(): void {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement("style");
  s.textContent = `
.rh-root { position:fixed; top:10px; left:50%; transform:translateX(-50%); width:min(380px, 92vw); z-index:40; pointer-events:none;
  font:600 13px system-ui, sans-serif; color:#eef2ff; background:rgba(10,12,28,.72); border:1px solid rgba(200,215,255,.35);
  border-radius:10px; padding:7px 10px 8px; text-shadow:0 1px 2px #000; }
.rh-spec { top:58px; width:min(420px, 92vw); font-size:15px; }
.rh-title { color:${MOON}; font-weight:800; margin-bottom:5px; letter-spacing:.2px; }
.rh-bar { position:relative; height:12px; border-radius:6px; background:rgba(255,255,255,.12); overflow:hidden; }
.rh-fill { position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg, #9fb6ff, ${MOON}); }
.rh-tick { position:absolute; top:0; bottom:0; width:2px; margin-left:-1px; background:${GOLD}; opacity:.9; }
.rh-pct { position:absolute; right:6px; top:-1px; font-size:11px; }
.rh-status { margin-top:6px; font-weight:800; display:flex; align-items:center; gap:7px; }
.rh-arrow { display:inline-block; font-size:17px; line-height:1; }
.rh-ok { color:#8ff0a0; } .rh-warn { color:#ffd27a; } .rh-bad { color:#ff7b7b; }
.rh-timers { margin-top:6px; display:flex; flex-wrap:wrap; gap:5px; }
.rh-chip { background:rgba(255,255,255,.1); border-radius:6px; padding:1px 7px; font-size:12px; }
.rh-spec .rh-chip { font-size:14px; }
.rh-hot { background:rgba(255,90,90,.35); color:#fff; }
`;
  document.head.append(s);
}
