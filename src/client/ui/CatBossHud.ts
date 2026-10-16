import { MOB_ARMOR } from "#shared/mobs";
import { MOB_ARMOR_LOOK, MOB_DEF_SHIELD } from "#shared/look";

/** Что панели нужно знать о боссе катакомб (MobState). */
export interface CatBossView {
  name: string;
  hp: number;
  maxHp: number;
  /** Биты защит (MOB_ARMOR) и проценты резистов. */
  armor: number;
  resPhys: number;
  resRanged: number;
  resMagic: number;
  resDodge: number;
}

/** Босс катакомб из RoomState (catBoss → MobState); нет или мёртв — null. Одинаково у игрока и зрителя. */
export function catBossViewOf(st: {
  catBoss: string;
  mobs: { get(id: string): (Omit<CatBossView, "name"> & { mobName: string; dead: number }) | undefined };
}): CatBossView | null {
  const m = st.catBoss ? st.mobs.get(st.catBoss) : undefined;
  if (!m || m.dead) return null;
  return {
    name: m.mobName || "Босс катакомб",
    hp: m.hp,
    maxHp: m.maxHp,
    armor: m.armor,
    resPhys: m.resPhys,
    resRanged: m.resRanged,
    resMagic: m.resMagic,
    resDodge: m.resDodge,
  };
}

/** Подпись значка защиты в панели: бит → короткое имя и процент (у отражения/отбивания процента нет). */
const RES_ROWS: readonly { bit: number; label: string; pct: (v: CatBossView) => number | null }[] = [
  { bit: MOB_ARMOR.phys, label: "Физ.", pct: (v) => v.resPhys },
  { bit: MOB_ARMOR.ranged, label: "Дальн.", pct: (v) => v.resRanged },
  { bit: MOB_ARMOR.magic, label: "Магия", pct: (v) => v.resMagic },
  { bit: MOB_ARMOR.dodge, label: "Уворот", pct: (v) => v.resDodge },
  { bit: MOB_ARMOR.parry, label: "Отбивает", pct: () => null },
  { bit: MOB_ARMOR.reflect, label: "Отражает", pct: () => null },
];

/**
 * Панель босса катакомб сверху (ПК/телефон и эфир): имя, HP и резисты — те же значки-щиты,
 * что на плашке моба (MOB_ARMOR_LOOK), с процентом. Видна, пока босс жив.
 */
export class CatBossHud {
  private readonly el: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly pct: HTMLSpanElement;
  private readonly res: HTMLDivElement;
  private shown = false;
  private resSig = "";

  constructor(spectator = false) {
    ensureCss();
    this.el = div("cbh-root" + (spectator ? " cbh-spec" : ""));
    this.title = div("cbh-title");
    const bar = div("cbh-bar");
    this.fill = div("cbh-fill");
    this.pct = document.createElement("span");
    this.pct.className = "cbh-pct";
    bar.append(this.fill, this.pct);
    this.res = div("cbh-res");
    this.el.append(this.title, bar, this.res);
    this.el.style.display = "none";
    document.body.append(this.el);
  }

  update(v: CatBossView | null): void {
    const show = !!v && v.hp > 0;
    if (show !== this.shown) {
      this.shown = show;
      this.el.style.display = show ? "" : "none";
    }
    if (!show || !v) return;
    this.title.textContent = `☠ ${v.name}`;
    const frac = v.maxHp > 0 ? Math.max(0, Math.min(1, v.hp / v.maxHp)) : 0;
    this.fill.style.width = `${(frac * 100).toFixed(1)}%`;
    this.pct.textContent = `${Math.ceil(v.hp).toLocaleString("ru-RU")} / ${Math.ceil(v.maxHp).toLocaleString("ru-RU")} · ${Math.ceil(frac * 100)}%`;

    const sig = `${v.armor}|${v.resPhys}|${v.resRanged}|${v.resMagic}|${v.resDodge}`;
    if (sig === this.resSig) return;
    this.resSig = sig;
    const chips: string[] = [];
    for (const row of RES_ROWS) {
      if ((v.armor & row.bit) === 0) continue;
      const look = MOB_ARMOR_LOOK.find((d) => d.bit === row.bit);
      if (!look) continue;
      const p = row.pct(v);
      chips.push(`<span class="cbh-chip">${shieldSvg(look.color, look.sym)}${row.label}${p !== null ? ` ${p}%` : ""}</span>`);
    }
    this.res.innerHTML = chips.join("");
    this.res.style.display = chips.length ? "" : "none";
  }
}

/** Щит защиты как на плашке моба (shared/look.ts), только SVG. */
function shieldSvg(color: string, sym: string): string {
  return (
    `<svg class="cbh-ico" viewBox="0 0 20 20"><path d="${MOB_DEF_SHIELD}" fill="${color}" stroke="rgba(6,8,12,.9)" stroke-width="2.4" stroke-linejoin="round"/>` +
    (sym ? `<path d="${sym}" fill="none" stroke="#15171d" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` : "") +
    `</svg>`
  );
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
.cbh-root { position:fixed; top:10px; left:50%; transform:translateX(-50%); width:min(420px, 92vw); z-index:40; pointer-events:none;
  font:600 13px system-ui, sans-serif; color:#f4eee8; background:rgba(22,10,10,.74); border:1px solid rgba(255,160,120,.35);
  border-radius:10px; padding:7px 10px 8px; text-shadow:0 1px 2px #000; }
.cbh-spec { top:58px; width:min(600px, 94vw); font-size:18px; padding:10px 14px 12px; }
.cbh-title { color:#ffb38a; font-weight:800; margin-bottom:7px; letter-spacing:.2px; }
.cbh-spec .cbh-title { font-size:21px; }
.cbh-bar { position:relative; height:14px; border-radius:7px; background:rgba(255,255,255,.12); overflow:hidden; }
.cbh-spec .cbh-bar { height:22px; border-radius:11px; }
.cbh-fill { position:absolute; left:0; top:0; bottom:0; background:linear-gradient(90deg, #a3241c, #ff6a3d); }
.cbh-pct { position:absolute; right:6px; top:0; font-size:11px; line-height:14px; }
.cbh-spec .cbh-pct { font-size:15px; line-height:22px; }
.cbh-res { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
.cbh-chip { display:inline-flex; align-items:center; gap:4px; background:rgba(255,255,255,.1); border-radius:6px; padding:1px 7px 1px 4px; font-size:12px; }
.cbh-spec .cbh-chip { font-size:16px; padding:3px 10px 3px 6px; }
.cbh-ico { width:15px; height:15px; flex:none; }
.cbh-spec .cbh-ico { width:22px; height:22px; }
`;
  document.head.append(s);
}
