import type { IconKey } from "#shared/icons";
import { ATTR_LOOK } from "#shared/look";
import { ensureIconCss, iconHtml } from "../ui/icons";
import { ATTR2, ATTRS as A2, ATTR_INFO, attrEffect, CLASSES2, CLASS_IDS, costRule, skillCooldownFor, skillDesc, SKILLS2, skillName, SPEAR_PIERCE_DMG, WEAPONS2, type SkillId } from "#shared/classes2";
import { Client } from "colyseus.js";
import { PcInventory, type PcInventoryHooks } from "../pc/PcInventory";
import { injectPcStyle } from "../pc/pcStyle";
import type { PcInvData } from "#shared/net/messages";
import { UPDATES } from "#shared/updates";
import { respecCostFor } from "#shared/constants";
import { ELITE_MOBS, MOB_CAMPS } from "#shared/mobs";
import { BAG, RUBY } from "#shared/items";
import { QUEST } from "#shared/quests";

// Переменные общего вида (цвета тиров, оценки) — до первой отрисовки страницы.
ensureIconCss();

/**
 * «Зоны мобов» для справки — из таблицы лагерей (MOB_CAMPS) и описаний мобов
 * (ELITE_MOBS.blurb): новые мобы попадают сюда сами, без правки текста.
 */
function mobZonesText(): string {
  const types = [...new Set(MOB_CAMPS.map((c) => c.type))].map((t) => ELITE_MOBS[t]).filter((d) => !!d);
  const byLevel = new Map<number, string[]>();
  for (const d of types.sort((a, b) => a.level - b.level)) {
    const list = byLevel.get(d.level) ?? [];
    list.push(d.blurb ? `${d.name} (${d.blurb})` : d.name);
    byLevel.set(d.level, list);
  }
  return [...byLevel].map(([lvl, names]) => `${lvl} ур. — ${names.join(", ")}`).join("; ") + ".";
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
  /** Данные окна снаряжения (как в игре) и что в руках (вид/тир). */
  pc?: PcInvData;
  heldHands?: { left: { cls: string; tier: string } | null; right: { cls: string; tier: string } | null };
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

let toastTimer = 0;
function toast(text: string, ok: boolean): void {
  toastEl.textContent = text;
  toastEl.className = ok ? "show" : "show bad";
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.className = ""), 3000);
}

let room: { send(type: string, msg?: unknown): void; leave(): void } | null = null;
let last: InvMsg | null = null;

let pcInv: PcInventory | null = null;
let heldHands: NonNullable<InvMsg["heldHands"]> = { left: null, right: null };

/** Окно снаряжения из игры, встроенное в страницу. Действия идут на сервер как раньше. */
function pageInv(): PcInventory {
  if (pcInv) return pcInv;
  injectPcStyle();
  /** fuel — огранка рубинового: какое уникальное 99 сжечь (раньше терялось — сервер отвечал «Выбери…»). */
  const act = (a: string, id: string, idx = 0, fuel?: string): void => {
    if (!last?.authed) {
      toast("Сначала подтверди вход кодом в чате", false);
      return;
    }
    room?.send("act", { act: a, id, idx, ...(fuel ? { fuel } : {}) });
  };
  pcInv = new PcInventory({
    page: true,
    touch: matchMedia("(pointer: coarse)").matches,
    request: () => room?.send("refresh"),
    act: (m) => act(m.act, m.id || (m.act === "title" ? "-" : m.id), m.idx, m.fuel),
    hands: () => heldHands as ReturnType<PcInventoryHooks["hands"]>,
    // idx 1 — в левую руку (второй меч/кинжал к такому же в правой).
    equip: (w, side) => act("equip", w.id, side === "left" ? 1 : 0),
    toBag: (side) => act("unequip", "-", side === "left" ? 1 : 0),
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
  subEl.textContent = msg.authed ? "✓ вход подтверждён — можно менять снаряжение" : "";
  listEl.innerHTML = msg.authed
    ? ""
    : `<div class="auth">Чтобы надевать и разбирать предметы, напиши в чат Twitch с ника <b>${escapeHtml(msg.nick ?? "")}</b> код:` +
      `<div class="code">${escapeHtml(msg.code ?? "----")}</div>` +
      `<div class="auth-note">Страница откроется сама. Код действует 10 минут, вход запоминается в этом браузере.</div></div>`;
  // Окно как в игре (то же PcInventory): снаряжение, атрибуты, заточка — с иконками и подсказками.
  if (!msg.pc) return;
  const inv = pageInv();
  heldHands = msg.heldHands ?? { left: null, right: null };
  inv.setData(msg.pc);
  inv.setXp(msg.level ?? 1, msg.xpFrac ?? 0, (msg.xpFrac ?? 0) >= 1);
  if (!inv.isOpen) inv.open("gear");
}

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
      r.onMessage("toast", (m: { ok: boolean; text: string }) => m.text && toast(m.text, m.ok));
      r.onMessage("enchant", (m: unknown) => pcInv?.onResult(m as never));
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
    if (room && document.visibilityState === "visible") room.send("refresh");
  }, 20_000);
}

// ---- статичный раздел "Механики игры" ----

/** Атрибуты, классы и умения — из тех же данных, что считает игра (classes2.ts). */
const MECH_CLASSES_HTML = (() => {
  const attrs = A2.map((k) => `<li><b style="color:${ATTR_LOOK[k].c}">${iconHtml(`a.${k}` as IconKey)} ${ATTR_INFO[k].name}</b> (!${k === "agi" ? "dex" : k}) — ${attrEffect(k)}.</li>`).join("");
  const classes = CLASS_IDS.map((c) => {
    const d = CLASSES2[c];
    const sk = d.skills.map((id) => skillName(id, c)).join(", ");
    return `<p><b>${d.icon} ${d.name}</b> — ${d.weapons}. ${d.role}. Умения на выбор: ${sk}.</p>`;
  }).join("");
  const skills = CLASS_IDS.map((c) => {
    const d = CLASSES2[c];
    const items = d.skills
      .map((id: SkillId) => {
        const sk = SKILLS2[id];
        return `<li>${sk.icon} <b>${skillName(id, c)}</b> (откат ${skillCooldownFor(id, c)} с при МДР 1) — ${skillDesc(id, c)}.</li>`;
      })
      .join("");
    return `<p><b>${d.icon} ${d.name}</b></p><ul>${items}</ul>`;
  }).join("");
  return `
<h2>Атрибуты</h2>
<p>Основа — от <b>уровня</b> (здоровье, урон, темп атаки, бег растут сами). Атрибуты — множители поверх. ${costRule()}. Каждый подъём даёт:</p>
<ul>${attrs}</ul>
<p>Уворот с одним оружием в руках (пустая вторая рука, лук, посох, копьё, молот) — в ${ATTR2.luc.dodgeOneItem} раза выше, потолок ${Math.round(ATTR2.luc.dodgeCap * 100)}%. Сброс всех очков — ${respecCostFor(0) === 0 ? "<b>бесплатно</b>" : `<b>${respecCostFor(0)} жетон ◈</b>`} (<code>!respec</code> или кнопка на вкладке «Атрибуты»). Бот зрителя раскидывает новые очки сам, пока хозяин не вложит их вручную или не сбросит (<code>!autostats</code> — вернуть авто).</p>

<h2>Классы</h2>
<p>Класс — это оружие в руках: взял кинжалы — ассасин, копьё — копейщик и т.д. У каждого класса свои умения, любые два можно выбрать на вкладке «Умения» (ПК — клавиши 2 и 3, телефон — кнопки ✦, VR — стики правой и левой руки). Ботам — <code>!class</code> и <code>!skills</code>.</p>
${classes}
<p>Щит у воина — шанс полностью заблокировать удар — только от ролла Блок (врождённого блока у щитов нет); у щитов ещё роллы Физ. и Маг. защита, у Эгиды — Отражение, и она лечит при блоке. Молот боевого мага каждым ударом пускает магическую волну (урон от интеллекта). Копьё бьёт конусом перед собой — до ${WEAPONS2.spear.pierce} целей (за первой — ${Math.round(SPEAR_PIERCE_DMG * 100)}% урона). Два кинжала бьют по очереди чаще, один кинжал — крит и уворот выше.</p>

<h2>Умения классов</h2>
${skills}
<p>У магов (посох, молот) мудрость ускоряет откат умений.</p>`;
})();

const MECH_HTML = `
${MECH_CLASSES_HTML}

<h2>Оружие, роллы и заточка</h2>
<p><b>Обычное</b> — стартовое (всё есть на стойке в лагере). <span class="tier-gold">Золотое</span> — сильнее, 1–2 ролла. <span class="tier-legendary">Уникальное</span> — ещё сильнее, 2–3 ролла. <span class="tier-ruby">Рубиновое</span> — сильнее уникального на ${Math.round((RUBY.powerMul - 1) * 100)}%, 3–4 ролла; выпадает редко, только с супербосса катакомб.</p>
<p><span class="roll">Роллы</span> — 5 видов, на предмете не повторяются:</p>
<ul><li><b>Урон</b> +5–15%</li><li><b>Скорость атаки</b> +5–15%</li><li><b>Крит</b> +5–15% к шансу, и сильнее сам крит (до +0.5 к множителю)</li><li><b>Вампиризм</b> +2–10% урона в здоровье — только меч, кинжал, копьё, молот; от урона по соседним целям (сплэш меча, выпад копья, волна молота) — вполовину</li><li><b>Щит:</b> <b>Блок</b> до +20%, <b>Физ. защита</b> до 20%, <b>Маг. защита</b> до 20%, <b>Регенерация</b> до 1% здоровья в секунду (и в бою); у Эгиды: Блок до 20%, Физ. защита до 15%, <b>Отражение</b> до 10%, Регенерация</li></ul>
<p>Роллы обоих предметов в руках идут в удар, но не складываются: от каждого вида (урон, скорость, крит, вампиризм) берётся лучший из двух. Разные виды на двух клинках дают все сразу.</p>
<p>Щит блокирует удар целиком с шансом от ролла Блок (врождённого блока нет). У щита роллы <b>Физ. защита</b> (−урон от ударов) и <b>Маг. защита</b> (−урон магии и снарядов); их можно точить за лом. <b>Эгида</b> вместо Маг. защиты имеет <b>Отражение</b> (часть урона уходит обратно атакующему) и врождённый «Оплот»: каждый блок лечит 10% здоровья.</p>
<p><b>Оценка</b> («оценка 47») — сумма силы роллов, до 99: чем больше, тем лучше предмет. Ненужное — <b>на лом</b> (больше за оценку). Лом тратится на <b>заточку</b> ролла: чем он ближе к максимуму, тем дороже и меньше шанс; при неудаче лом сгорает.</p>
<p><b>Огранка рубинового</b> — не за лом: на каждую попытку сгорает одно <span class="tier-legendary">уникальное</span> оружие с оценкой ${RUBY.fuelQuality} (выбираешь сам какое). Внизу шанс ${Math.round(RUBY.chanceLo * 100)}% и +${RUBY.gainLo} очков, у максимума — ${Math.round(RUBY.chanceHi * 100)}% и +${RUBY.gainHi}.</p>

<h2>Лут</h2>
<p>Оружие падает с мобов лагерей; у <b>вожаков лагерей</b> (крупнее, «Вожак — …» над головой) шанс в ${QUEST.champ.dropMul} раза выше. Мировой босс Багровый слизень — щедрее всех. Трофей ${BAG.lootOwnerSec} секунд принадлежит тому, кто добил, на земле лежит ${Math.round(BAG.weaponDropLife / 60)} минут.</p>

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
<p>Слабые — у лагеря, сильнее — дальше. ${mobZonesText()}</p>

<h2>События</h2>
<p>Раз в несколько минут: <b>нашествие</b> (35%), <b>охота на элиту</b> — Огнекрылый дракон (40%), <b>Охотничья башня</b> (25%). Победа даёт «Благословение победы» — ×2 опыта и урона. В башне — соло-забег по этажам с дропом оружия своего класса.</p>
<p><b>Квест чата</b> — раз в пару часов общая задача для ботов: пиши <code>!квест</code>, чтобы участвовать; награда — опыт, свиток мудрости и жетоны.</p>

<h2>Титулы</h2>
<p>Только за большие заслуги: Легенда (1-е место по уровню), Царь башни (быстрее 3:00), Драконоборец, Гроза Багрового, Мастер-рыболов, Ветеран контрактов, Защитник лагеря. Виден над героем перед уровнем; выбрать — <code>!title</code> или на вкладке «Снаряжение».</p>

<h2>Бот-режим</h2>
<p>Пока хозяин не в чате, его герой — бот: сам ходит, дерётся, лутается и лечится. Уходит из мира, если хозяин долго не пишет.</p>

<h2>Команды в чате</h2>
<p><code>!play</code>/<code>!stop</code> — герой в мир/из мира · <code>!stats</code> — прогресс · <code>!class</code> — класс · <code>!skills</code> — умения · <code>!str</code> <code>!dex</code> <code>!int</code> <code>!con</code> <code>!luc</code> <code>!wis</code> — атрибуты · <code>!respec</code> — сброс за 1 ◈ · <code>!inv</code> — эта страница · <code>!camp &lt;моб&gt;</code> — где качаться · <code>!fish</code> — рыбалка · <code>!follow &lt;ник&gt;</code> (<code>!следовать</code>) — рядом и защищает · <code>!raid</code> — поход на босса · <code>!event</code> — на ивент · <code>!квест</code> — квест чата · <code>!title</code> — титулы · <code>!focus</code> — показать героя в эфире · <code>!top</code> — лидеры.</p>
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
    // Свежие сверху — по времени выкладки, а не по месту записи в файле.
    el.innerHTML = [...UPDATES].sort((a, b) => b.at.localeCompare(a.at)).map(
      (u) => `<div class="u"><b>${escapeHtml(u.at)}</b><ul>${u.items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul></div>`,
    ).join("");
  }
});
