import type { CatReportMsg } from "#shared/net/messages";
import { AEGIS_NAME, ITEMS } from "#shared/items";
import { itemIcon, type IconKey } from "#shared/icons";
import { CATACOMBS } from "#shared/catacombs";
import { gemName, ringName, type RingTier } from "#shared/jewels";
import { gemHtml, ringHtml } from "#shared/jewelIcons";
import { ensureIconCss, iconHtml } from "./icons";

/**
 * Итог пройденных катакомб — большая таблица по центру экрана (почти на весь
 * экран): кто сколько нанёс урона, убийства, смерти и что кому выпало из
 * сундуков. Один модуль на всех: игрок (ПК/телефон), спектатор и OBS-оверлей.
 * Показывается после карточки победы (delay), сам гаснет через hold секунд;
 * клик/Esc — закрыть раньше.
 */

const CSS = `
.cat-rep{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at center,rgba(10,6,14,.72),rgba(0,0,0,.86));
  opacity:0;transition:opacity .6s ease;pointer-events:auto;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.cat-rep.cr-show{opacity:1}
.cat-rep .cr-pn{width:min(92vw,170vh);max-height:92vh;overflow:auto;display:flex;flex-direction:column;gap:1.6vh;
  padding:3vh 3.2vh 2.4vh;border-radius:2.2vh;color:#f1ead8;
  background:linear-gradient(180deg,#1d1622 0%,#120e16 100%);
  border:.3vh solid var(--tier-gold-edge);box-shadow:0 0 6vh rgba(217,162,27,.25),inset 0 0 4vh rgba(0,0,0,.6)}
.cat-rep .cr-hd{text-align:center}
.cat-rep .cr-tt{font-weight:900;font-size:5.4vh;letter-spacing:.12em;color:var(--tier-gold);
  text-shadow:0 0 2.4vh rgba(255,190,60,.45),0 .3vh 0 #000}
.cat-rep .cr-st{margin-top:.6vh;font-size:max(2.4vh,12px);opacity:.9}
.cat-rep .cr-st b{color:#ff8a5c}
.cat-rep .cr-rt{display:flex;flex-wrap:wrap;justify-content:center;gap:.6vh;margin-top:1.2vh;font-size:1.8vh}
.cat-rep .cr-rt span{padding:.4vh 1.2vh;border-radius:99px;background:#2a2230;border:.15vh solid #4a3d55;white-space:nowrap}
.cat-rep .cr-rt i{font-style:normal;opacity:.55;align-self:center}
.cat-rep table{width:100%;border-collapse:separate;border-spacing:0 .7vh}
.cat-rep table{display:table}.cat-rep tr{display:table-row}.cat-rep td,.cat-rep th{display:table-cell}
.cat-rep th{font-size:1.6vh;font-weight:700;letter-spacing:.14em;text-transform:uppercase;opacity:.55;text-align:left;padding:0 1.2vh}
.cat-rep th.cr-n,.cat-rep td.cr-n{text-align:center}
.cat-rep td{background:rgba(255,255,255,.045);padding:1vh 1.2vh;font-size:max(2.4vh,12px);vertical-align:middle}
.cat-rep td:first-child{border-radius:1.2vh 0 0 1.2vh}
.cat-rep td:last-child{border-radius:0 1.2vh 1.2vh 0}
.cat-rep tr.cr-top td{background:rgba(255,200,80,.09)}
.cat-rep .cr-rk{width:5vh;text-align:center;font-weight:800;font-size:2.6vh;opacity:.75}
.cat-rep .cr-rk.cr-md{font-size:3.6vh;opacity:1}
.cat-rep .cr-hero{display:flex;align-items:center;gap:1.2vh;white-space:nowrap}
.cat-rep .cr-hero .cr-ci{font-size:3.2vh;width:4.4vh;height:4.4vh;display:flex;align-items:center;justify-content:center;
  border-radius:1vh;background:#2a2230}
.cat-rep .cr-hero .cr-nm{font-weight:800;font-size:max(2.7vh,13px);max-width:30vh;overflow:hidden;text-overflow:ellipsis}
.cat-rep .cr-hero .cr-lv{opacity:.6;font-size:1.9vh}
.cat-rep .cr-dm{min-width:24vh}
.cat-rep .cr-dm .cr-v{font-weight:800;font-size:max(2.7vh,13px);font-variant-numeric:tabular-nums}
.cat-rep .cr-dm .cr-pc{opacity:.6;font-size:1.8vh;margin-left:.8vh}
.cat-rep .cr-dm .cr-bar{margin-top:.5vh;height:.9vh;border-radius:1vh;background:rgba(255,255,255,.08);overflow:hidden}
.cat-rep .cr-dm .cr-bar div{height:100%;border-radius:1vh;background:linear-gradient(90deg,#ff7b3a,#ffd166)}
.cat-rep td.cr-n{font-variant-numeric:tabular-nums;font-weight:700}
.cat-rep td.cr-dead{color:#ff8a8a}
.cat-rep .cr-lt{display:flex;flex-wrap:wrap;gap:.7vh}
.cat-rep .cr-it{position:relative;width:5.4vh;height:5.4vh;border-radius:1vh;display:flex;align-items:center;justify-content:center;
  background:#0f0e13;border:.22vh solid var(--tier-base-edge);color:var(--tier-base)}
.cat-rep .cr-it.cr-t-gold{border-color:var(--tier-gold-edge);color:var(--tier-gold);box-shadow:inset 0 0 1.2vh var(--tier-gold-glow)}
.cat-rep .cr-it.cr-t-ruby{border-color:var(--tier-ruby-edge);color:var(--tier-ruby);box-shadow:inset 0 0 1.6vh var(--tier-ruby-glow)}
.cat-rep .cr-it.cr-t-legendary{border-color:var(--tier-legendary-edge);color:var(--tier-legendary);box-shadow:inset 0 0 1.4vh var(--tier-legendary-glow)}
.cat-rep .cr-it .cr-ico{font-size:3vh;line-height:1;display:flex}
.cat-rep .cr-it .cr-ico > span{width:1em;height:1em}
.cat-rep .cr-it .cr-cnt{position:absolute;right:.25vh;bottom:0;font:800 1.4vh system-ui,sans-serif;color:#fff;text-shadow:0 0 .4vh #000,0 0 .4vh #000}
.cat-rep .cr-ft{display:flex;justify-content:space-between;align-items:center;font-size:1.8vh;opacity:.75;gap:2vh}
.cat-rep .cr-ft .cr-x{cursor:pointer;padding:.6vh 1.6vh;border-radius:1vh;background:#2a2230;border:.15vh solid #4a3d55}
@media (orientation:portrait){
  .cat-rep .cr-pn{width:96vw;padding:2vh 1.6vh;gap:1vh}
  .cat-rep .cr-tt{font-size:2.6vh;letter-spacing:.06em}
  .cat-rep .cr-st{font-size:1.5vh}
  .cat-rep .cr-rt{font-size:1.2vh}
  .cat-rep td{font-size:1.5vh;padding:.6vh .5vh}
  .cat-rep .cr-rk{width:auto;font-size:1.6vh}.cat-rep .cr-rk.cr-md{font-size:2.2vh}
  .cat-rep .cr-hero{gap:.6vh}
  .cat-rep .cr-hero .cr-ci{font-size:1.8vh;width:2.6vh;height:2.6vh}
  .cat-rep .cr-hero .cr-nm{font-size:1.6vh;max-width:24vw}
  .cat-rep .cr-hero .cr-lv,.cat-rep .cr-dm .cr-pc,.cat-rep .cr-k{display:none}
  .cat-rep .cr-dm{min-width:0}.cat-rep .cr-dm .cr-v{font-size:1.6vh}
  .cat-rep .cr-it{width:3vh;height:3vh}
  .cat-rep .cr-it .cr-ico{font-size:1.7vh}
  .cat-rep th{font-size:1vh;padding:0 .5vh}
  .cat-rep .cr-ft{font-size:1.2vh}
}
`;

let styled = false;
let current: { el: HTMLElement; timers: number[]; onKey: (e: KeyboardEvent) => void } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const fmtNum = (n: number): string => Math.round(n).toLocaleString("ru-RU");
const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/** Убрать таблицу (если открыта). */
export function hideCatReport(): void {
  if (!current) return;
  const c = current;
  current = null;
  for (const t of c.timers) clearTimeout(t);
  window.removeEventListener("keydown", c.onKey);
  c.el.classList.remove("cr-show");
  setTimeout(() => c.el.remove(), 650);
}

/**
 * Показать итог забега. delayMs — подождать (карточка «повержен!» идёт первой), holdSec — сколько держать.
 * closable — можно закрыть кликом/Esc (игрок); у зрителя таблица просто висит своё время.
 */
export function showCatReport(m: CatReportMsg, o: { delayMs?: number; holdSec?: number; closable?: boolean; parent?: HTMLElement } = {}): void {
  hideCatReport();
  ensureIconCss();
  if (!styled) {
    styled = true;
    const st = document.createElement("style");
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = el("div", "cat-rep");
  const pn = el("div", "cr-pn");
  root.appendChild(pn);

  const hd = el("div", "cr-hd");
  hd.appendChild(el("div", "cr-tt", "☠ КАТАКОМБЫ ПРОЙДЕНЫ"));
  const st = el("div", "cr-st");
  const boss = el("b", undefined, m.boss);
  st.append(boss, ` повержен · время ${fmtTime(m.secs)} · жизней отряда ❤ ${m.lives}/${m.livesMax}`);
  hd.appendChild(st);
  if (m.halls.length) {
    const rt = el("div", "cr-rt");
    m.halls.forEach((h, i) => {
      if (i) rt.appendChild(el("i", undefined, "→"));
      rt.appendChild(el("span", undefined, h));
    });
    hd.appendChild(rt);
  }
  pn.appendChild(hd);

  const total = m.rows.reduce((s, r) => s + r.dmg, 0) || 1;
  const best = m.rows[0]?.dmg || 1;
  const tb = el("table");
  const head = el("tr");
  for (const [t, c] of [["#", "cr-n"], ["герой", ""], ["урон", ""], ["убийств", "cr-n cr-k"], ["смертей", "cr-n"], ["добыча", ""]] as const) head.appendChild(el("th", c, t));
  tb.appendChild(head);
  const medals = ["🥇", "🥈", "🥉"];
  m.rows.forEach((r, i) => {
    const tr = el("tr", i === 0 ? "cr-top" : "");
    tr.appendChild(el("td", `cr-rk${i < 3 ? " cr-md" : ""}`, medals[i] ?? String(i + 1)));
    const hero = el("td");
    const hw = el("div", "cr-hero");
    const ci = el("span", "cr-ci");
    if (r.cls) ci.innerHTML = iconHtml(`c.${r.cls}` as IconKey);
    const nm = el("span", "cr-nm", r.nick);
    hw.append(ci, nm, el("span", "cr-lv", r.level ? `ур. ${r.level}` : ""));
    hero.appendChild(hw);
    tr.appendChild(hero);
    const dm = el("td", "cr-dm");
    const line = el("div");
    line.append(el("span", "cr-v", fmtNum(r.dmg)), el("span", "cr-pc", `${Math.round((r.dmg / total) * 100)}%`));
    const bar = el("div", "cr-bar");
    const fill = el("div");
    fill.style.width = `${Math.max(2, (r.dmg / best) * 100)}%`;
    bar.appendChild(fill);
    dm.append(line, bar);
    tr.appendChild(dm);
    tr.appendChild(el("td", "cr-n cr-k", fmtNum(r.kills)));
    tr.appendChild(el("td", `cr-n${r.deaths ? " cr-dead" : ""}`, String(r.deaths)));
    const lt = el("td");
    const box = el("div", "cr-lt");
    for (const l of r.loot) {
      // Кольцо/камень с мобов забега — свой значок (shared/jewelIcons.ts).
      if (l.jw) {
        const tier = l.jw.startsWith("ring:") ? (l.jw.slice(5) as RingTier) : null;
        const it = el("div", `cr-it${tier ? ` cr-t-${tier}` : ""}`);
        it.title = tier ? ringName({ tier }) : gemName(l.jw);
        const ico = el("span", "cr-ico");
        ico.innerHTML = tier ? ringHtml(tier) : gemHtml(l.jw);
        it.appendChild(ico);
        if (l.count > 1) it.appendChild(el("span", "cr-cnt", `×${l.count}`));
        box.appendChild(it);
        continue;
      }
      const def = ITEMS[l.id];
      if (!def) continue;
      const it = el("div", `cr-it${def.weapon ? ` cr-t-${def.weapon.tier}` : ""}`);
      it.title = l.aegis ? AEGIS_NAME : def.name;
      const ico = el("span", "cr-ico");
      ico.innerHTML = iconHtml(itemIcon(l.id, l.aegis));
      it.appendChild(ico);
      if (l.count > 1) it.appendChild(el("span", "cr-cnt", `×${l.count}`));
      box.appendChild(it);
    }
    if (!box.childElementCount) box.appendChild(el("span", undefined, "—"));
    lt.appendChild(box);
    tr.appendChild(lt);
    tb.appendChild(tr);
  });
  pn.appendChild(tb);

  const ft = el("div", "cr-ft");
  ft.appendChild(el("span", undefined, `отряду — ×2 опыт и урон ${CATACOMBS.buffMinutes} мин · добыча уже на складе (!inv)`));
  if (o.closable) {
    const x = el("span", "cr-x", "закрыть ✕");
    x.addEventListener("click", hideCatReport);
    ft.appendChild(x);
  }
  pn.appendChild(ft);
  if (o.closable) root.addEventListener("click", (e) => e.target === root && hideCatReport());
  else root.style.pointerEvents = "none";

  const onKey = (e: KeyboardEvent): void => {
    if (o.closable && e.key === "Escape") hideCatReport();
  };
  const timers: number[] = [];
  current = { el: root, timers, onKey };
  timers.push(
    window.setTimeout(() => {
      (o.parent ?? document.body).appendChild(root);
      requestAnimationFrame(() => root.classList.add("cr-show"));
      window.addEventListener("keydown", onKey);
    }, o.delayMs ?? 0),
  );
  timers.push(window.setTimeout(hideCatReport, (o.delayMs ?? 0) + (o.holdSec ?? 25) * 1000));
}
