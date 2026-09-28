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
}

interface InvHand {
  cls?: string;
  name: string;
  tier: "gold" | "legendary";
  affixes: string[];
  quality: number;
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
  stats?: InvStatRow[];
  hands?: { left: InvHand | null; right: InvHand | null };
  weapons?: InvWeapon[];
  misc?: InvMisc[];
  error?: string;
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
  return count > 0 ? ` <span class="quality">(${q})</span>` : "";
}

function handHtml(label: string, h: InvHand | null): string {
  if (!h) return `<div class="hand empty-hand">${label}: пусто/базовое</div>`;
  const affixes = h.affixes.length ? h.affixes.join(", ") : "без роллов";
  return (
    `<div class="hand ${h.tier}"><span class="hand-label">${label}:</span> <span class="hand-name">${escapeHtml(h.name)}${qualityTag(h.quality, h.affixes.length)}</span>` +
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
              `<div class="weapon ${w.tier}">` +
              `<div class="winfo"><div class="name">${w.num}) ${escapeHtml(w.name)}${qualityTag(w.quality, w.affixes.length)}</div>` +
              `<div class="affixes">${escapeHtml(affixes)}</div>` +
              `<div class="meta">${TIER_RU[w.tier]}</div>` +
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

  listEl.innerHTML = `${authHtml}${statsHtml}${handsHtml}<h2 class="section">Склад оружия</h2>${weaponsHtml}${miscHtml}`;
}

listEl.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button.act");
  if (!b || !room) return;
  const act = b.dataset.act;
  const id = b.dataset.id ?? "";
  if (act === "scrap" && armedScrap !== id) {
    // Лом — навсегда: первый клик только взводит кнопку.
    armedScrap = id;
    if (last) renderInv(last);
    return;
  }
  armedScrap = "";
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
    if (room && !armedScrap && document.visibilityState === "visible") room.send("refresh");
  }, 20_000);
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
<p><code>!goevent</code> — админ стрима запускает ивент: «нашествие» (толпа мобов, победа даёт шанс на <span class="tier-gold">золото</span>) или «охота на элиту» (именной элитный босс, победа даёт гарантированную <span class="tier-legendary">уникальную вещь</span>).</p>

<h2>Бот-режим</h2>
<p>Пока хозяин не в чате, его герой становится ботом — сам ходит, дерётся, лутается и лечится. Бот переживает рестарт сервера и уходит из мира, если хозяин долго не пишет в чат.</p>

<h2>Башня</h2>
<p>Соло-забег по этажам с растущей сложностью — героя по вашим статам/экипировке ведёт бот. Боссы этажей дают «осколки» и (начиная с малого шанса, растущего к вершине) — оружие вашего класса. Последний этаж — гарантированный дроп.</p>

<h2>Команды в чате</h2>
<p><code>!play</code>/<code>!stop</code> — герой в мир/из мира · <code>!stats</code> — прогресс · <code>!str</code>/<code>!dex</code>/<code>!int</code> — атрибуты · <code>!inv</code> — эта страница (надеть/на лом — после кода из чата) · <code>!weapons</code> — список склада тут же в чате · <code>!equip &lt;номер&gt;</code> — надеть конкретное · <code>!scrap &lt;номер|all|1,2,3&gt;</code> — на лом · <code>!follow &lt;ник&gt;</code> — герой идёт рядом и защищает · <code>!raid</code> — общий поход на босса · <code>!top</code> — таблица лидеров.</p>
`;

document.getElementById("mechBtn")!.addEventListener("click", () => {
  const el = document.getElementById("mech")!;
  const open = el.style.display === "block";
  el.style.display = open ? "none" : "block";
  if (!open) el.innerHTML = MECH_HTML;
});
