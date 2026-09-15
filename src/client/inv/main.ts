import { Client } from "colyseus.js";

interface InvWeapon {
  id: string;
  tier: "base" | "gold" | "legendary";
  name: string;
  affixes: string[];
  equipped: boolean;
}

interface InvHand {
  name: string;
  affixes: string[];
}

interface InvMisc {
  name: string;
  count: number;
}

interface InvMsg {
  ok: boolean;
  nick?: string;
  hands?: { left: InvHand | null; right: InvHand | null };
  weapons?: InvWeapon[];
  misc?: InvMisc[];
  error?: string;
}

const titleEl = document.getElementById("title")!;
const subEl = document.getElementById("sub")!;
const listEl = document.getElementById("list")!;

const token = new URLSearchParams(location.search).get("t") ?? "";

function renderError(text: string): void {
  subEl.textContent = "";
  listEl.innerHTML = `<div class="error">${text}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function handHtml(label: string, h: InvHand | null): string {
  if (!h) return `<div class="hand empty-hand">${label}: пусто/базовое</div>`;
  const affixes = h.affixes.length ? h.affixes.join(", ") : "без роллов";
  return (
    `<div class="hand"><span class="hand-label">${label}:</span> <span class="hand-name">${escapeHtml(h.name)}</span>` +
    `<div class="affixes">${escapeHtml(affixes)}</div></div>`
  );
}

function renderInv(msg: InvMsg): void {
  if (!msg.ok) {
    renderError(
      msg.error
        ? `Ошибка сервера: ${escapeHtml(msg.error)}`
        : "Ссылка недействительна — попроси новую командой !inv в чате.",
    );
    return;
  }
  titleEl.textContent = `Инвентарь — ${msg.nick ?? "?"}`;
  subEl.textContent = "";

  const hands = msg.hands;
  const handsHtml = hands
    ? `<div class="hands">${handHtml("Правая рука", hands.right)}${handHtml("Левая рука", hands.left)}</div>`
    : "";

  const weapons = msg.weapons ?? [];
  const weaponsHtml =
    weapons.length === 0
      ? '<div class="empty">Склад пуст — золотое и легендарное оружие падает с боёв.</div>'
      : weapons
          .map((w, i) => {
            const affixes = w.affixes.length ? w.affixes.join(", ") : "без роллов";
            return (
              `<div class="weapon ${w.tier}">` +
              `<div><div class="name">${i + 1}) ${escapeHtml(w.name)}</div>` +
              `<div class="affixes">${escapeHtml(affixes)}</div>` +
              (w.equipped ? '<div class="badge">⚔️ в бою</div>' : "") +
              `</div><div class="meta">${w.tier}<br>id ${w.id}</div>` +
              `</div>`
            );
          })
          .join("");

  const misc = msg.misc ?? [];
  const miscHtml =
    misc.length === 0
      ? ""
      : `<h2 class="section">Прочее</h2>` +
        misc.map((m) => `<div class="misc">${escapeHtml(m.name)} × ${m.count}</div>`).join("");

  listEl.innerHTML = `${handsHtml}<h2 class="section">Склад оружия</h2>${weaponsHtml}${miscHtml}`;
}

if (!token) {
  renderError("Нет токена в ссылке — попроси актуальную командой !inv в чате.");
} else {
  const client = new Client();
  client
    .joinOrCreate<never>("inventory_room", { viewToken: token })
    .then((room) => {
      room.onMessage("inv", (msg: InvMsg) => {
        renderInv(msg);
        room.leave(); // сервер прислал всё одним сообщением — держать сокет незачем
      });
    })
    .catch(() => renderError("Не получилось связаться с сервером — попробуй перезагрузить страницу."));
}

// ---- статичный раздел "Механики игры" ----

const MECH_HTML = `
<h2>Атрибуты</h2>
<p><b>Сила (str)</b> — множитель физического урона, ключевой атрибут воина/мечника.</p>
<p><b>Ловкость (agi)</b> — множитель урона в ближнем и дальнем бою + скорость атаки, ключевой атрибут лучника (но и мечнику полезна).</p>
<p><b>Интеллект (int)</b> — сила магии: урон и радиус огнешара у мага.</p>
<p>Всё растёт от уровня, у самих атрибутов есть мягкий потолок — один стат не может стать абсолютно доминирующим.</p>

<h2>Классы</h2>
<p><b>Воин</b> — танк/мечник, ближний бой, умение «Оглушающий удар».</p>
<p><b>Лучник</b> — дальний бой, крит, умение «Град стрел».</p>
<p><b>Маг</b> — огнешар с накоплением заряда, зона лечения-баффа для союзников.</p>
<p>Левая и правая рука — независимые слоты, можно комбинировать разное снаряжение.</p>

<h2>Тиры оружия и аффиксы</h2>
<p><b>Base</b> — стартовое оружие, всегда доступно. <b>Gold</b> — золотой тир, множитель урона выше. <b>Legendary</b> — именное оружие с механическим эффектом класса (пламенный меч — горение, лук охотника — крит, эгида — усиленный блок, посох бури — сильнее АОЕ).</p>
<p>Поверх тира на gold/legendary дополнительно накатываются 1–3 случайных ролла: урон, скорость атаки или крит — они и делают два меча одного тира разными предметами.</p>

<h2>Лут и дроп</h2>
<p>Золото/легендарки может уронить любой моб (обычные — редко, элитные лагеря на карте — заметно чаще), мировой босс — щедрее всех. Трофей 25 секунд принадлежит только тому, кто добил моба.</p>
<p>Оружие на земле лежит час, если его не забрали, — потом тает.</p>

<h2>События</h2>
<p><code>!goevent</code> — админ стрима запускает ивент: «нашествие» (толпа мобов, победа даёт шанс на золото) или «охота на элиту» (именной элитный босс, победа даёт гарантированную легендарку).</p>

<h2>Бот-режим</h2>
<p>Пока хозяин не в чате, его герой становится ботом — сам ходит, дерётся, лутается и лечится. Бот переживает рестарт сервера и уходит из мира, если хозяин долго не пишет в чат.</p>

<h2>Башня</h2>
<p>Соло-забег по этажам с растущей сложностью — героя по вашим статам/экипировке ведёт бот. Боссы этажей дают «осколки» и (начиная с малого шанса, растущего к вершине) — оружие вашего класса. Последний этаж — гарантированный дроп.</p>

<h2>Команды в чате</h2>
<p><code>!play</code>/<code>!stop</code> — герой в мир/из мира · <code>!stats</code> — прогресс · <code>!str</code>/<code>!dex</code>/<code>!int</code> — атрибуты · <code>!inv</code> — эта страница · <code>!weapons</code> — список склада тут же в чате · <code>!equip &lt;номер&gt;</code> — надеть конкретное · <code>!scrap &lt;номер|all|1,2,3&gt;</code> — на лом · <code>!follow &lt;ник&gt;</code> — герой идёт рядом и защищает · <code>!raid</code> — общий поход на босса · <code>!top</code> — таблица лидеров.</p>
`;

document.getElementById("mechBtn")!.addEventListener("click", () => {
  const el = document.getElementById("mech")!;
  const open = el.style.display === "block";
  el.style.display = open ? "none" : "block";
  if (!open) el.innerHTML = MECH_HTML;
});
