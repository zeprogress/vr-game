import { Client } from "colyseus.js";
import { PcInventory, type PcInventoryHooks } from "../pc/PcInventory";
import { injectPcStyle } from "../pc/pcStyle";
import type { PcInvData } from "#shared/net/messages";
import { UPDATES } from "#shared/updates";

interface InvWeapon {
  num: number;
  id: string;
  cls: string;
  tier: "base" | "gold" | "legendary";
  name: string;
  affixes: string[];
  /** Сумма очков роллов (1..33 за ролл) — показывается в скобках у названия. */
  quality: number;
  /** Сколько лома даст переработка. */
  scrap: number;
  ench: EnchRow[];
}

interface EnchRow {
  label: string;
  points: number;
  max: boolean;
  chance: number;
  cost: number;
}

interface EnchResult {
  ok: boolean;
  text: string;
  enchant?: { id: string; idx: number; up: boolean; gain: number; cost: number; label: string };
}

interface InvHand {
  cls?: string;
  name: string;
  tier: "gold" | "legendary";
  affixes: string[];
  quality: number;
  id: string;
  ench: EnchRow[];
}

interface InvMisc {
  name: string;
  count: number;
}

interface InvStatRow {
  label: string;
  value: string;
}

interface InvMsg {
  ok: boolean;
  /** Старая ссылка с токеном — перейти на /inv?ник. */
  redirect?: string;
  nick?: string;
  authed?: boolean;
  code?: string;
  level?: number;
  /** Опыт к следующему уровню, 0..1. */
  xpFrac?: number;
  stats?: InvStatRow[];
  hands?: { left: InvHand | null; right: InvHand | null };
  weapons?: InvWeapon[];
  misc?: InvMisc[];
  scrapHave?: number;
  attrs?: { unspent: number; str: number; agi: number; int: number };
  fish?: number;
  respecCost?: number;
  /** Данные окна снаряжения (как в игре) и что в руках (вид/тир). */
  pc?: PcInvData;
  heldHands?: { left: { cls: string; tier: string } | null; right: { cls: string; tier: string } | null };
  /** Жетоны заданий ◈ и свитки (читаются отсюда). */
  tokens?: number;
  scrolls?: { id: string; name: string; hint: string; count: number; activeSecs: number }[];
  error?: string;
}

function walletHtml(msg: InvMsg): string {
  if (msg.tokens === undefined) return "";
  const rows = (msg.scrolls ?? [])
    .map((sc) => {
      const active = sc.activeSecs > 0;
      const btn =
        msg.authed && sc.count > 0
          ? `<button class="act" data-act="scroll" data-id="${escapeHtml(sc.id)}"${active ? " disabled" : ""}>${active ? "Действует" : "Прочитать"}</button>`
          : "";
      return (
        `<div class="wrow wscroll"><div><b>${escapeHtml(sc.name)} ×${sc.count}</b>` +
        `<small>${escapeHtml(sc.hint)}</small>` +
        (active ? `<span class="active">действует ещё ${Math.ceil(sc.activeSecs / 60)} мин — второй прочитать нельзя</span>` : "") +
        `</div>${btn}</div>`
      );
    })
    .join("");
  return (
    `<h2 class="section">Жетоны и свитки</h2><div class="wallet">` +
    `<div class="wrow"><span>Жетоны заданий</span><span class="wtokens" title="Жетоны тратятся у трактирщика в лагере: зелья, лом, свитки, сундук оружия">◈ ${msg.tokens}</span></div>` +
    rows +
    `</div>`
  );
}

const ATTRS: { key: "str" | "agi" | "int"; name: string; hint: string }[] = [
  { key: "str", name: "Сила", hint: "HP, урон ближнего боя, броня" },
  { key: "agi", name: "Ловкость", hint: "скорость атаки, стрелы, бег, уворот" },
  { key: "int", name: "Интеллект", hint: "мана, сила магии, защита от снарядов" },
];

function attrsHtml(msg: InvMsg): string {
  const a = msg.attrs;
  if (!a) return "";
  const can = !!msg.authed && a.unspent > 0;
  const rows = ATTRS.map((r) => {
    const btns = can
      ? `<div class="abtns"><button class="act attr" data-act="stat" data-id="${r.key}" data-n="1">+1</button>` +
        (a.unspent >= 5 ? `<button class="act attr" data-act="stat" data-id="${r.key}" data-n="5">+5</button>` : "") +
        `</div>`
      : "";
    return (
      `<div class="arow ${r.key}"><div><div class="aname">${r.name} <b>${a[r.key]}</b></div>` +
      `<div class="ahint">${r.hint}</div></div>${btns}</div>`
    );
  }).join("");
  // Сброс атрибутов — за жетон ◈; второе нажатие подтверждает (как «На лом»).
  const cost = msg.respecCost ?? 0;
  const fish = msg.tokens ?? 0; // имя осталось от рыбы — это жетоны
  const invested = a.str + a.agi + a.int - 3 > 0;
  const armed = armedScrap === "respec";
  // cost < 0 — сброс выключен на сервере: кнопку не показываем.
  const respec = msg.authed && cost >= 0
    ? `<div class="respec"><button class="act respecbtn${armed ? " armed" : ""}" data-act="respec" data-id="respec" ${
        fish < cost || !invested ? "disabled" : ""
      }>${armed ? "Точно сбросить?" : "↺ Сбросить атрибуты"} — ${cost === 0 ? "бесплатно" : `${cost} ◈`}</button>` +
      `<span class="fishhave">у тебя ${fish} ◈${!invested ? " · сбрасывать нечего" : fish < cost ? " · не хватает" : ""}</span></div>`
    : "";
  const head =
    a.unspent > 0
      ? `Свободных очков: <b class="afree">${a.unspent}</b>${msg.authed ? "" : " — войди кодом, чтобы вложить"}`
      : "Свободных очков нет — их дают за новый уровень";
  return `<div class="attrs"><div class="ahead">${head}</div>${rows}${respec}</div>`;
}

const titleEl = document.getElementById("title")!;
const subEl = document.getElementById("sub")!;
const listEl = document.getElementById("list")!;
const toastEl = document.getElementById("toast")!;

const params = new URLSearchParams(location.search);
const legacyToken = params.get("t") ?? "";
// /inv?ник — сам ник и есть весь query (без "ключ=").
const nickArg = params.get("n") ?? (location.search.length > 1 && !location.search.includes("=")
  ? decodeURIComponent(location.search.slice(1))
  : "");

const SID_KEY = "zepInvSid";
function loadSid(): string {
  try {
    return localStorage.getItem(SID_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveSid(sid: string): void {
  try {
    localStorage.setItem(SID_KEY, sid);
  } catch {
    /* приватный режим — сессия проживёт до закрытия вкладки */
  }
}

function renderError(text: string): void {
  subEl.textContent = "";
  listEl.innerHTML = `<div class="error">${text}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Тир по-русски — CSS-класс/ключ ("legendary" и т.п.) остаётся как есть. */
const TIER_RU: Record<"base" | "gold" | "legendary", string> = {
  base: "база",
  gold: "золото",
  legendary: "уникальное",
};

/** « (N)» — очки роллов; у оружия без роллов ничего не пишем. */
function qualityTag(q: number, count: number): string {
  return count > 0 ? ` <span class="quality">(оценка ${q})</span>` : "";
}

function handHtml(label: string, h: InvHand | null): string {
  if (!h) return `<div class="hand empty-hand">${label}: пусто/базовое</div>`;
  const affixes = h.affixes.length ? h.affixes.join(", ") : "без роллов";
  return (
    `<div class="hand ${h.tier}${h.ench.length ? " pickable" : ""}" data-ench="${escapeHtml(h.id)}"><span class="hand-label">${label}:</span> <span class="hand-name">${escapeHtml(h.name)}${qualityTag(h.quality, h.affixes.length)}</span>` +
    `<div class="affixes">${escapeHtml(affixes)}</div></div>`
  );
}

let toastTimer = 0;
function toast(text: string, ok: boolean): void {
  toastEl.textContent = text;
  toastEl.className = ok ? "show" : "show bad";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.className = ""), 3000);
}

let room: { send(type: string, msg?: unknown): void; leave(): void } | null = null;
let last: InvMsg | null = null;
/** id предмета, по которому нажали «На лом» один раз — второй клик подтверждает. */
let armedScrap = "";

let pcInv: PcInventory | null = null;
let viewMode: "new" | "old" = (() => {
  try {
    return localStorage.getItem("zep.invView") === "old" ? "old" : "new";
  } catch {
    return "new";
  }
})();
let heldHands: NonNullable<InvMsg["heldHands"]> = { left: null, right: null };

/** Окно снаряжения из игры, встроенное в страницу. Действия идут на сервер как раньше. */
function pageInv(): PcInventory {
  if (pcInv) return pcInv;
  injectPcStyle();
  const act = (a: string, id: string, idx = 0): void => {
    if (!last?.authed) {
      toast("Сначала подтверди вход кодом в чате", false);
      return;
    }
    room?.send("act", { act: a, id, idx });
  };
  pcInv = new PcInventory({
    page: true,
    touch: matchMedia("(pointer: coarse)").matches,
    request: () => room?.send("refresh"),
    act: (m) => act(m.act, m.id || (m.act === "title" ? "-" : m.id), m.idx),
    hands: () => heldHands as ReturnType<PcInventoryHooks["hands"]>,
    equip: (w) => act("equip", w.id),
    toBag: () => toast("Снять оружие в сумку можно в игре", false),
    scrap: (w) => act("scrap", w.id),
    drop: () => toast("Выбросить можно только в игре", false),
    useItem: (id) => act("scroll", id),
  });
  document.getElementById("invMount")!.append(pcInv.element);
  return pcInv;
}

function renderInv(msg: InvMsg): void {
  last = msg;
  if (!msg.ok) {
    renderError(
      msg.error
        ? escapeHtml(msg.error)
        : "Ссылка недействительна — попроси новую командой !inv в чате.",
    );
    return;
  }
  titleEl.textContent = `Инвентарь — ${msg.nick ?? "?"}`;
  if (pcInv && viewMode === "old") pcInv.element.style.display = "none";
  subEl.textContent = msg.authed ? "✓ вход подтверждён — можно менять снаряжение" : "";

  const authHtml = msg.authed
    ? ""
    : `<div class="auth">Чтобы надевать и разбирать предметы, напиши в чат Twitch с ника <b>${escapeHtml(msg.nick ?? "")}</b> код:` +
      `<div class="code">${escapeHtml(msg.code ?? "----")}</div>` +
      `<div class="auth-note">Страница откроется сама. Код действует 10 минут, вход запоминается в этом браузере.</div></div>`;

  // Окно как в игре (то же PcInventory): снаряжение, атрибуты, заточка — с иконками и подсказками.
  if (msg.pc && viewMode === "new") {
    listEl.innerHTML = authHtml;
    const inv = pageInv();
    heldHands = msg.heldHands ?? { left: null, right: null };
    inv.setData(msg.pc);
    inv.setXp(msg.level ?? 1, msg.xpFrac ?? 0, (msg.xpFrac ?? 0) >= 1);
    if (!inv.isOpen) inv.open("gear");
    return;
  }

  const statsHtml =
    msg.stats && msg.stats.length > 0
      ? `<div class="stats"><div class="stat"><span class="stat-label">Уровень</span><span class="stat-value">${msg.level ?? ""}</span></div>` +
        msg.stats
          .map(
            (s) =>
              `<div class="stat"><span class="stat-label">${escapeHtml(s.label)}</span><span class="stat-value">${escapeHtml(s.value)}</span></div>`,
          )
          .join("") +
        `</div>`
      : "";

  const hands = msg.hands;
  // Лук занимает обе руки: в интерфейсе он в левой, а в правой — стрела (как в игре).
  const bow = hands ? (hands.left?.cls === "bow" ? hands.left : hands.right?.cls === "bow" ? hands.right : null) : null;
  const handsHtml = hands
    ? bow
      ? `<div class="hands">${handHtml("Левая рука", bow)}<div class="hand empty-hand">Правая рука: <b>Стрела</b> — лук занимает обе руки</div></div>`
      : `<div class="hands">${handHtml("Левая рука", hands.left)}${handHtml("Правая рука", hands.right)}</div>`
    : "";

  const weapons = msg.weapons ?? [];
  const weaponsHtml =
    weapons.length === 0
      ? '<div class="empty">Склад пуст — золотое и уникальное оружие падает с боёв.</div>'
      : weapons
          .map((w) => {
            const affixes = w.affixes.length ? w.affixes.join(", ") : "без роллов";
            const btns = msg.authed
              ? `<div class="btns"><button class="act equip" data-act="equip" data-id="${escapeHtml(w.id)}">Надеть</button>` +
                `<button class="act scrap${armedScrap === w.id ? " armed" : ""}" data-act="scrap" data-id="${escapeHtml(w.id)}">` +
                `${armedScrap === w.id ? "Точно?" : "На лом"} +${w.scrap}</button></div>`
              : "";
            return (
              `<div class="weapon ${w.tier}${w.ench.length ? " pickable" : ""}" data-ench="${escapeHtml(w.id)}">` +
              `<div class="winfo"><div class="name">${w.num}) ${escapeHtml(w.name)}${qualityTag(w.quality, w.affixes.length)}</div>` +
              `<div class="affixes">${escapeHtml(affixes)}</div>` +
              `<div class="meta">${TIER_RU[w.tier]}${w.ench.length ? " · ⚒ нажми, чтобы заточить" : ""}</div>` +
              `</div>${btns}</div>`
            );
          })
          .join("");

  const misc = msg.misc ?? [];
  const miscHtml =
    misc.length === 0
      ? ""
      : `<h2 class="section">Прочее</h2>` +
        misc.map((m) => `<div class="misc">${escapeHtml(m.name)} × ${m.count}</div>`).join("");

  if (modalId && !animating) renderModal();
  const xpPct = Math.floor((msg.xpFrac ?? 0) * 1000) / 10;
  const xpHtml =
    msg.xpFrac !== undefined
      ? `<div class="xp"><div class="xp-head"><span>Опыт до ${(msg.level ?? 0) + 1} ур.</span><b>${xpPct.toFixed(1)}%</b></div>` +
        `<div class="xp-bar"><div style="width:${xpPct}%"></div></div></div>`
      : "";
  listEl.innerHTML = `${authHtml}${xpHtml}${statsHtml}${attrsHtml(msg)}${walletHtml(msg)}${handsHtml}<h2 class="section">Склад оружия</h2>${weaponsHtml}${miscHtml}`;
}

listEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.act");
  if (!b) {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".pickable");
    if (card?.dataset.ench) openModal(card.dataset.ench);
    return;
  }
  if (!room) return;
  const act = b.dataset.act;
  const id = b.dataset.id ?? "";
  if (act === "respec") {
    if (armedScrap !== "respec") {
      armedScrap = "respec";
      if (last) renderInv(last);
      return;
    }
    armedScrap = "";
    room.send("act", { act: "respec", id: "respec" });
    return;
  }
  if (act === "scrap" && armedScrap !== id) {
    // Лом — навсегда: первый клик только взводит кнопку.
    armedScrap = id;
    if (last) renderInv(last);
    return;
  }
  armedScrap = "";
  if (act === "stat") {
    room.send("act", { act, id, idx: Number(b.dataset.n) || 1 });
    return;
  }
  room.send("act", { act, id });
});

/**
 * WS на слабом VPS изредка обрывается прямо на джойне — тихо пробуем ещё
 * пару раз. Сокет держим открытым: сервер сам присылает новую версию после
 * кода в чате и после каждого действия.
 */
const MAX_ATTEMPTS = 3;
function connect(attempt = 0): void {
  let joined = false;
  const client = new Client();
  const fail = (): void => {
    if (joined) return;
    joined = true;
    if (attempt + 1 < MAX_ATTEMPTS) setTimeout(() => connect(attempt + 1), 500);
    else renderError("Не получилось связаться с сервером — попробуй перезагрузить страницу.");
  };
  const opts = legacyToken ? { viewToken: legacyToken } : { nick: nickArg, sid: loadSid() };
  client
    .joinOrCreate<never>("inventory_room", opts)
    .then((r) => {
      joined = true;
      room = r;
      r.onMessage("sid", (sid: string) => saveSid(sid));
      r.onMessage("toast", (m: { ok: boolean; text: string }) => toast(m.text, m.ok));
      r.onMessage("enchant", (m: EnchResult) => (pcInv ? pcInv.onResult(m as never) : onEnchantResult(m)));
      r.onMessage("inv", (msg: InvMsg) => {
        if (msg.redirect) {
          location.replace(`/inv?${encodeURIComponent(msg.redirect)}`);
          return;
        }
        renderInv(msg);
      });
      r.onLeave(() => {
        room = null;
        // Рестарт сервера/обрыв — переподключаемся, сессия в localStorage.
        setTimeout(() => connect(), 3000);
      });
    })
    .catch(fail);
}

if (!legacyToken && !nickArg) {
  renderError("В адресе нет ника — открой ссылку из команды !inv в чате.");
} else {
  connect();
  // Лут в игре подбирается без нас — раз в 20 с подтягиваем свежий склад.
  setInterval(() => {
    if (room && !armedScrap && !animating && document.visibilityState === "visible") room.send("refresh");
  }, 20_000);
}

// ---- окно заточки ----

const modalEl = document.getElementById("ench")!;
let modalId = "";
let animating = false;
/** Идёт анимация наковальни; ответ сервера ждёт её конца. */
let pendingResult: EnchResult | null = null;
let hammerDone = false;

type Picked = { name: string; tier: string; ench: EnchRow[] };
function findItem(id: string): Picked | null {
  if (!last) return null;
  const w = (last.weapons ?? []).find((x) => x.id === id);
  if (w) return w;
  for (const h of [last.hands?.left, last.hands?.right]) if (h && h.id === id) return h;
  return null;
}

function openModal(id: string): void {
  if (!last?.authed) {
    toast("Сначала подтверди вход кодом в чате", false);
    return;
  }
  modalId = id;
  renderModal();
  modalEl.classList.add("open");
}

function closeModal(): void {
  if (animating) return;
  modalId = "";
  modalEl.classList.remove("open");
}

function renderModal(): void {
  const it = findItem(modalId);
  if (!it) {
    closeModal();
    return;
  }
  const have = last?.scrapHave ?? 0;
  const rows = it.ench
    .map((a, i) => {
      const pct = Math.round((a.points / 33) * 100);
      const right = a.max
        ? `<span class="maxb">MAX</span>`
        : `<button class="ebtn" data-idx="${i}" ${have < a.cost ? "disabled" : ""}>⚒ ${a.cost} лома<br><small>шанс ${Math.round(a.chance * 100)}%</small></button>`;
      return (
        `<div class="erow${a.max ? " ismax" : ""}" data-row="${i}">` +
        `<div class="elabel">${escapeHtml(a.label)}<span class="epts">${a.points}/33</span></div>` +
        `<div class="ebar"><div class="efill" style="width:${pct}%"></div></div>` +
        `<div class="eright">${right}</div></div>`
      );
    })
    .join("");
  modalEl.innerHTML =
    `<div class="ebox ${it.tier}"><button class="eclose">✕</button>` +
    `<div class="etitle">⚒ Заточка — <span class="ename">${escapeHtml(it.name)}</span></div>` +
    `<div class="ehave">Лом: <b>${have}</b></div>` +
    `<div class="erows">${rows}</div>` +
    `<div class="eanvil"><div class="ehammer">🔨</div></div>` +
    `<div class="ebanner"></div>` +
    `<div class="enote">Чем ближе аффикс к максимуму и чем лучше предмет — тем дороже и тем меньше шанс. При неудаче лом сгорает.</div></div>`;
}

modalEl.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t === modalEl || t.closest(".eclose")) {
    closeModal();
    return;
  }
  const b = t.closest<HTMLButtonElement>(".ebtn");
  if (!b || b.disabled || animating || !room) return;
  const idx = Number(b.dataset.idx);
  animating = true;
  hammerDone = false;
  pendingResult = null;
  modalEl.querySelectorAll<HTMLButtonElement>(".ebtn").forEach((x) => (x.disabled = true));
  modalEl.querySelector(".ebox")!.classList.add("forging");
  modalEl.querySelector(`[data-row="${idx}"]`)?.classList.add("target");
  room.send("act", { act: "enchant", id: modalId, idx });
  // Три удара молотом — даём напряжению настояться, потом показываем итог.
  setTimeout(() => {
    hammerDone = true;
    if (pendingResult) reveal(pendingResult);
  }, 1100);
});

function onEnchantResult(m: EnchResult): void {
  if (!animating) {
    toast(m.text, m.ok);
    return;
  }
  pendingResult = m;
  if (hammerDone) reveal(m);
}

function burst(host: HTMLElement, kind: "spark" | "smoke", n: number): void {
  const r = host.getBoundingClientRect();
  const box = modalEl.querySelector<HTMLElement>(".ebox")!.getBoundingClientRect();
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = kind;
    const a = Math.random() * Math.PI * 2;
    const dist = kind === "spark" ? 50 + Math.random() * 110 : 20 + Math.random() * 40;
    d.style.left = `${r.left - box.left + r.width * (0.3 + Math.random() * 0.4)}px`;
    d.style.top = `${r.top - box.top + r.height / 2}px`;
    d.style.setProperty("--dx", `${Math.cos(a) * dist}px`);
    d.style.setProperty("--dy", `${Math.sin(a) * dist - (kind === "smoke" ? 40 : 20)}px`);
    d.style.animationDelay = `${Math.random() * 120}ms`;
    modalEl.querySelector(".ebox")!.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }
}

function reveal(m: EnchResult): void {
  pendingResult = null;
  const box = modalEl.querySelector<HTMLElement>(".ebox");
  box?.classList.remove("forging");
  const e = m.enchant;
  const banner = modalEl.querySelector<HTMLElement>(".ebanner");
  if (!box || !e || !banner) {
    animating = false;
    toast(m.text, m.ok);
    if (last) renderInv(last);
    return;
  }
  const row = modalEl.querySelector<HTMLElement>(`[data-row="${e.idx}"]`);
  if (e.up) {
    box.classList.add("win");
    row?.classList.add("win");
    if (row) {
      burst(row, "spark", 26);
      const it = findItem(e.id);
      const cur = it?.ench[e.idx];
      const fill = row.querySelector<HTMLElement>(".efill");
      // last уже новый (сервер шлёт inv раньше итога заточки).
      if (cur && fill) fill.style.width = `${Math.round((cur.points / 33) * 100)}%`;
      const lab = row.querySelector<HTMLElement>(".elabel");
      if (lab) lab.firstChild!.textContent = e.label;
      const f = document.createElement("div");
      f.className = "floaty";
      f.textContent = `+${e.gain} ${e.gain === 1 ? "очко" : "очка"}`;
      row.appendChild(f);
    }
    banner.innerHTML = `✨ УСПЕХ! ${escapeHtml(e.label)} <small>−${e.cost} лома</small>`;
    banner.className = "ebanner show good";
  } else {
    box.classList.add("lose");
    row?.classList.add("lose");
    if (row) burst(row, "smoke", 10);
    banner.innerHTML = `💨 Не вышло… аффикс не изменился <small>−${e.cost} лома</small>`;
    banner.className = "ebanner show bad";
  }
  setTimeout(() => {
    box.classList.remove("win", "lose");
    animating = false;
    // Свежие данные уже пришли по notify — перерисуем окно под новые цены/шансы,
    // баннер оставляем видимым ещё немного.
    const keep = banner.outerHTML;
    if (last) renderInv(last);
    renderModal();
    const nb = modalEl.querySelector(".ebanner");
    if (nb) nb.outerHTML = keep;
    setTimeout(() => modalEl.querySelector(".ebanner")?.classList.remove("show"), 1800);
  }, 1500);
}

// ---- статичный раздел "Механики игры" ----

const MECH_HTML = `
<h2>Атрибуты</h2>
<p>Основа — от <b>уровня</b> (здоровье, урон, темп атаки, бег, мана растут сами). Атрибуты — множители поверх. Каждое вложенное очко даёт:</p>
<p><span class="str">Сила (str)</span></p>
<ul>
<li>+5.5% максимального здоровья;</li>
<li>+5% урона мечом и кулаками (на стрелы сила не влияет);</li>
<li>броня: −1.4% входящего урона от мобов и игроков (потолок 35%). Магические удары (Костяные призраки) броня не гасит.</li>
</ul>
<p><span class="agi">Ловкость (dex)</span></p>
<ul>
<li>+1% темпа атаки (у меча прирост вдвое мягче, у лука и посоха — полный);</li>
<li>+1.5% урона мечом и кулаками;</li>
<li>+3% урона стрел — у лука урон растёт только от ловкости;</li>
<li>+1.8% скорости бега;</li>
<li>+1.2% шанса увернуться от удара, а с одним предметом в руках без щита (лук, посох, один меч) — ×5, потолок 30%.</li>
</ul>
<p><span class="int">Интеллект (int)</span></p>
<ul>
<li>+6% силы магии: урон огнешара и сила массового лечения;</li>
<li>+5% запаса маны и +0.5 восстановления маны в секунду (база — 2 в секунду);</li>
<li>−4.5% урона от снарядов и магии, в том числе магических ударов призраков (потолок 70%);</li>
<li>+3% к лечению зельями.</li>
</ul>
<p><b>Затухание:</b> первые 5 вложенных очков в атрибут дают полную отдачу, каждое следующее — 40% от неё. Поэтому выгоднее не всё в один атрибут.</p>
<p>Очки дают за каждый уровень. Сброс всех очков — <b>1 жетон ◈</b> (<code>!respec</code> или кнопка на вкладке «Атрибуты»).</p>

<h2>Классы и руки</h2>
<p><span class="cls-warrior">Воин</span> — меч (можно два) и щит, умение «Оглушающий удар». Щит — шанс полностью заблокировать удар (10%, у Эгиды 15%).</p>
<p><span class="cls-archer">Лучник</span> — лук на обе руки, криты, умение «Град стрел» по области. С одним предметом в руках без щита — уворот в 5 раз выше.</p>
<p><span class="cls-mage">Маг</span> — посох: огнешар с зарядом и массовое лечение союзников.</p>

<h2>Оружие, оценка и заточка</h2>
<p><b>Обычное</b> — стартовое. <span class="tier-gold">Золотое</span> — урон выше. <span class="tier-legendary">Уникальное</span> — свой эффект: меч вампира, лук охотника (криты), эгида (блок), посох бури.</p>
<p>На золотом и уникальном 1–3 случайных <span class="roll">ролла</span> (урон, скорость атаки, крит). <b>Оценка</b> — сумма их силы (до 99): чем выше, тем лучше предмет.</p>
<p>Ненужное — <b>на лом</b> (больше лома за высокую оценку). Лом тратится на <b>заточку</b> роллов: чем ближе ролл к максимуму, тем дороже и тем меньше шанс; при неудаче лом сгорает.</p>

<h2>Лут</h2>
<p>Оружие падает с мобов лагерей; у <b>вожаков лагерей</b> (крупнее, «Вожак — …» над головой) шанс в 3 раза выше. Мировой босс Багровый слизень — щедрее всех. Трофей 25 секунд принадлежит тому, кто добил, на земле лежит час.</p>

<h2>Лагерь</h2>
<p>Безопасная зона: мобы не нападают. Там быстро восстанавливается здоровье и даётся бафф <b>«Тепло костра»</b> — −20% входящего урона на 10 минут.</p>
<p>У выхода из лагеря — <b>доска заданий</b> и <b>Охотник</b>, у торговых лавок — <b>трактирщик</b>.</p>

<h2>Задания и жетоны ◈</h2>
<p><b>Задания дня</b> (обновляются в 00:00 МСК): 3 простых берутся у доски, ещё 2 — на выбор из 5 (есть усложнённые). Охота на мобов своей зоны, вожаки лагерей, рыбалка, рейд на Багрового.</p>
<p><b>Охотник</b>: история лагеря для новичков (6 глав, в финале — титул и уникальное оружие) и <b>контракт недели</b> с уникальным оружием оценки 80+.</p>
<p>Награда — опыт (на первых уровнях — сразу несколько уровней), лом и <b>жетоны ◈</b>.</p>
<p><b>Трактирщик</b> за жетоны: зелья, лом, свитки, сундук с уникальным оружием оценки 80+; обмен 20 рыб на 1 ◈.</p>
<p><b>Свитки</b> (15 минут): мудрости — ×2 опыта (с благословением ×3), ветра — +20% скорости бега. Пока свиток действует, второй такой же не читается.</p>

<h2>Рыбалка</h2>
<p>У озера: <b>авторыбалка</b> (герой ловит сам, около минуты на рыбу) или <b>вручную</b> — быстрее, мини-игра: подсекай, когда метка в зелёной зоне. Боты рыбачат по <code>!fish</code>.</p>

<h2>Зоны мобов</h2>
<p>Слабые — у лагеря, сильнее — дальше. 26 ур. — големы (раскалываются), 33 ур. — Грибной колосс (споры), Небесный спрут (хват щупальцами, можно вырваться), Костяной призрак (телепорт, вампиризм, магические удары), 36 ур. — Адский демон (таран), Ледяной демон (заморозка), Костяной вождь (шипы с оглушением, лечит своих).</p>

<h2>События</h2>
<p>Раз в несколько минут: <b>нашествие</b> (35%), <b>охота на элиту</b> — Огнекрылый дракон (40%), <b>Охотничья башня</b> (25%). Победа даёт «Благословение победы» — ×2 опыта и урона. В башне — соло-забег по этажам с дропом оружия своего класса.</p>
<p><b>Квест чата</b> — раз в пару часов общая задача для ботов: пиши <code>!квест</code>, чтобы участвовать; награда — опыт, свиток мудрости и жетоны.</p>

<h2>Титулы</h2>
<p>Только за большие заслуги: Легенда (1-е место по уровню), Царь башни (быстрее 3:00), Драконоборец, Гроза Багрового, Мастер-рыболов, Ветеран контрактов, Защитник лагеря. Виден над героем перед уровнем; выбрать — <code>!title</code> или на вкладке «Снаряжение».</p>

<h2>Бот-режим</h2>
<p>Пока хозяин не в чате, его герой — бот: сам ходит, дерётся, лутается и лечится. Уходит из мира, если хозяин долго не пишет.</p>

<h2>Команды в чате</h2>
<p><code>!play</code>/<code>!stop</code> — герой в мир/из мира · <code>!stats</code> — прогресс · <code>!str</code>/<code>!dex</code>/<code>!int</code> — атрибуты · <code>!respec</code> — сброс за 1 ◈ · <code>!inv</code> — эта страница · <code>!equip &lt;номер&gt;</code> / <code>!scrap &lt;номер|all&gt;</code> · <code>!camp &lt;моб&gt;</code> — где качаться · <code>!fish</code> — рыбалка · <code>!follow &lt;ник&gt;</code> (<code>!следовать</code>) — рядом и защищает · <code>!raid</code> — поход на босса · <code>!event</code> — на ивент · <code>!квест</code> — квест чата · <code>!title</code> — титулы · <code>!focus</code> — показать героя в эфире · <code>!top</code> — лидеры.</p>
`;

document.getElementById("mechBtn")!.addEventListener("click", () => {
  const el = document.getElementById("mech")!;
  const open = el.style.display === "block";
  el.style.display = open ? "none" : "block";
  if (!open) el.innerHTML = MECH_HTML;
  document.getElementById("upd")!.style.display = "none";
});

// Обновления игры — дата/время выкладки и что изменилось (src/shared/updates.ts).
document.getElementById("updBtn")!.addEventListener("click", () => {
  const el = document.getElementById("upd")!;
  const open = el.style.display === "block";
  el.style.display = open ? "none" : "block";
  document.getElementById("mech")!.style.display = "none";
  if (!open) {
    el.innerHTML = UPDATES.map(
      (u) => `<div class="u"><b>${escapeHtml(u.at)}</b><ul>${u.items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>`,
    ).join("");
  }
});

// Вид инвентаря: новый (как в игре) / старый (список) — запоминается в браузере.
const viewBtn = document.getElementById("viewBtn")!;
const paintViewBtn = (): void => {
  viewBtn.textContent = viewMode === "new" ? "Старый вид" : "Новый вид";
};
paintViewBtn();
viewBtn.addEventListener("click", () => {
  viewMode = viewMode === "new" ? "old" : "new";
  try {
    localStorage.setItem("zep.invView", viewMode);
  } catch {
    /* приватный режим */
  }
  paintViewBtn();
  if (last) renderInv(last);
});
