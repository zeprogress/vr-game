import { Client } from "colyseus.js";

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
  error?: string;
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
  // Сброс атрибутов — за рыбу; второе нажатие подтверждает (как «На лом»).
  const cost = msg.respecCost ?? 0;
  const fish = msg.fish ?? 0;
  const invested = a.str + a.agi + a.int - 3 > 0;
  const armed = armedScrap === "respec";
  // cost < 0 — сброс выключен на сервере: кнопку не показываем.
  const respec = msg.authed && cost >= 0
    ? `<div class="respec"><button class="act respecbtn${armed ? " armed" : ""}" data-act="respec" data-id="respec" ${
        fish < cost || !invested ? "disabled" : ""
      }>${armed ? "Точно сбросить?" : "↺ Сбросить атрибуты"} — ${cost === 0 ? "бесплатно" : `${cost} 🐟`}</button>` +
      `<span class="fishhave">у тебя ${fish} 🐟${!invested ? " · сбрасывать нечего" : fish < cost ? " · не хватает" : ""}</span></div>`
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
  subEl.textContent = msg.authed ? "✓ вход подтверждён — можно менять снаряжение" : "";

  const authHtml = msg.authed
    ? ""
    : `<div class="auth">Чтобы надевать и разбирать предметы, напиши в чат Twitch с ника <b>${escapeHtml(msg.nick ?? "")}</b> код:` +
      `<div class="code">${escapeHtml(msg.code ?? "----")}</div>` +
      `<div class="auth-note">Страница откроется сама. Код действует 10 минут, вход запоминается в этом браузере.</div></div>`;

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
  listEl.innerHTML = `${authHtml}${xpHtml}${statsHtml}${attrsHtml(msg)}${handsHtml}<h2 class="section">Склад оружия</h2>${weaponsHtml}${miscHtml}`;
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
      r.onMessage("enchant", (m: EnchResult) => onEnchantResult(m));
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
<p><span class="str">Сила (str)</span> — множитель физического урона, ключевой атрибут <span class="cls-warrior">воина</span>/мечника.</p>
<p><span class="agi">Ловкость (dex)</span> — множитель урона в ближнем и дальнем бою + скорость атаки, ключевой атрибут <span class="cls-archer">лучника</span> (но и мечнику полезна).</p>
<p><span class="int">Интеллект (int)</span> — сила магии: урон и радиус огнешара у <span class="cls-mage">мага</span>.</p>
<p>Всё растёт от уровня, у самих атрибутов есть мягкий потолок — один стат не может стать абсолютно доминирующим.</p>

<h2>Классы</h2>
<p><span class="cls-warrior">Воин</span> — танк/мечник, ближний бой, умение «Оглушающий удар».</p>
<p><span class="cls-archer">Лучник</span> — дальний бой, крит, умение «Град стрел».</p>
<p><span class="cls-mage">Маг</span> — огнешар с накоплением заряда, зона лечения-баффа для союзников.</p>
<p>Левая и правая рука — независимые слоты, можно комбинировать разное снаряжение.</p>

<h2>Тиры оружия и аффиксы</h2>
<p><b>Base</b> — стартовое оружие, всегда доступно. <span class="tier-gold">Gold</span> — золотой тир, множитель урона выше. <span class="tier-legendary">Unique</span> — именное оружие с механическим эффектом класса (меч вампира — вампиризм, лук охотника — крит, эгида — усиленный блок, посох бури — сильнее АОЕ).</p>
<p>Поверх тира на <span class="tier-gold">gold</span>/<span class="tier-legendary">unique</span> дополнительно накатываются 1–3 случайных ролла: <span class="roll">урон</span>, <span class="roll">скорость атаки</span> или <span class="roll">крит</span> — они и делают два меча одного тира разными предметами.</p>

<h2>Лут и дроп</h2>
<p><span class="tier-gold">Золото</span>/<span class="tier-legendary">уникальные</span> может уронить любой моб (обычные — редко, элитные лагеря на карте — заметно чаще), мировой босс — щедрее всех. Трофей <b>25 секунд</b> принадлежит только тому, кто добил моба.</p>
<p>Оружие на земле лежит <b>час</b>, если его не забрали, — потом тает.</p>

<h2>События</h2>
<p><code>!goevent</code> — админ стрима запускает ивент: «нашествие» (толпа мобов, победа даёт шанс на <span class="tier-legendary">уникальную вещь</span>) или «охота на элиту» (именной элитный босс, победа даёт гарантированную <span class="tier-legendary">уникальную вещь</span>).</p>

<h2>Бот-режим</h2>
<p>Пока хозяин не в чате, его герой становится ботом — сам ходит, дерётся, лутается и лечится. Бот переживает рестарт сервера и уходит из мира, если хозяин долго не пишет в чат.</p>

<h2>Башня</h2>
<p>Соло-забег по этажам с растущей сложностью — героя по вашим статам/экипировке ведёт бот. Боссы этажей дают «осколки» и (начиная с малого шанса, растущего к вершине) — оружие вашего класса. Последний этаж — гарантированный дроп.</p>

<h2>Команды в чате</h2>
<p><code>!play</code>/<code>!stop</code> — герой в мир/из мира · <code>!stats</code> — прогресс · <code>!str</code>/<code>!dex</code>/<code>!int</code> — атрибуты · <code>!inv</code> (или <code>!инв</code>, <code>!оружие</code>, <code>!склад</code>, <code>!weapons</code>…) — эта страница (надеть/на лом/заточка — после кода из чата) · <code>!equip &lt;номер&gt;</code> — надеть конкретное · <code>!scrap &lt;номер|all|1,2,3&gt;</code> — на лом · <code>!follow &lt;ник&gt;</code> — герой идёт рядом и защищает · <code>!raid</code> — общий поход на босса · <code>!top</code> — таблица лидеров.</p>
`;

document.getElementById("mechBtn")!.addEventListener("click", () => {
  const el = document.getElementById("mech")!;
  const open = el.style.display === "block";
  el.style.display = open ? "none" : "block";
  if (!open) el.innerHTML = MECH_HTML;
});
