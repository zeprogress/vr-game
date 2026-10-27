import { showCatReport } from "../ui/CatReport";
import { EVENT_BUFF_MINUTES } from "#shared/constants";
import { NetClient } from "../net/NetClient";
import { Overlay } from "./Overlay";
import { catacombsOf, chatQuestOf, onlineOf, shotLabel, tickerOf, watchPanels } from "./overlayState";
import type { SpecCmd } from "#shared/net/messages";
import type { OverlayFrame } from "#shared/net/overlayFrame";

/**
 * Оверлей стрима отдельной страницей (`/overlay.html?spectator=КЛЮЧ`) — второй
 * Browser Source в OBS поверх основного (`/?spectator=КЛЮЧ&overlay=ext`).
 * Без Babylon: только DOM. Своё соединение с комнатой как спектатор; события
 * (килфид, баннеры, топы) приходят от сервера напрямую, а то, что зависит от
 * камеры (кого смотрим, HP цели, кто говорит), присылает рендерящая страница
 * кадром "frame" (готовые панели из спектатора). Так перерисовка DOM не занимает главный поток сцены, а
 * перезагрузка сцены не мигает оверлеем.
 */

const params = new URLSearchParams(location.search);
const key = params.get("spectator");
const ov = new Overlay();
ov.setShown(false);

/**
 * Какую часть оверлея рисовать — чтобы HP боссов можно было ставить отдельным источником OBS:
 * `part=boss` — только полоска HP босса/супербосса (без событий, часов, онлайна и т.д.);
 * `part=main` — всё, кроме неё; без параметра — как раньше, всё вместе.
 */
const part = params.get("part") === "boss" ? "boss" : params.get("part") === "main" ? "main" : "all";
const bossOnly = part === "boss";
if (bossOnly) {
  // Отдельный источник — только HP: остальные блоки и настройки с пульта её не трогают.
  ov.setConfig({ wm: 0, clock: 0, online: 0, watching: 0, feed: 0, top: 0, ticker: 0, hp: 1 });
}

/** Последний кадр из рендерящего спектатора (контекст панелей и строка сверху). */
let frame: OverlayFrame | null = null;
let frameAt = 0;
/** Цель кадра от Unity-спектатора (он не собирает панели сам). */
let subj: { type: string; id: string; shot: string } | null = null;
let subjAt = 0;
let live = false;

const net = new NetClient();
net.onSpecCmd = (cmd: SpecCmd) => {
  if (cmd.t === "frame") {
    frame = cmd.d;
    frameAt = performance.now();
  } else if (cmd.t === "subj") {
    // Unity-спектатор: только цель кадра — панели «смотрим» соберём сами (tick).
    subj = { type: cmd.type, id: cmd.id, shot: cmd.shot };
    subjAt = performance.now();
  } else if (bossOnly) return; // отдельный источник HP: карточки и настройки с пульта не нужны
  else if (cmd.t === "card") ov.showCard(cmd.title, cmd.sub ?? "", cmd.secs ?? 0);
  else if (cmd.t === "overlay") ov.setConfig(cmd.patch);
};
// Событийные блоки — только в полном оверлее (в отдельном источнике HP босса их нет).
net.onPickupFeed = (m) => { if (!bossOnly) ov.pushPickup(m.nick, m.item, m.tier); };
net.onBossEvent = (kind, by, loot, lootItems) => { if (!bossOnly) ov.bossBanner(kind, by, loot, lootItems); };
net.onLeaderboard = (rows) => { if (!bossOnly) ov.setLeaderboard(rows); };
net.onCatBoard = (rows) => { if (!bossOnly) ov.setCatBoard(rows); };
// Таблица урона в катакомбах и карточки катакомб — как в спектраторе.
net.onCatStats = (m) => { if (!bossOnly) ov.setCatTop(m.rows); };
net.onCatacomb = (m) => { if (!bossOnly) ov.showCard(m.title, m.sub, m.secs ?? 7, m.loot); };
net.onCatReport = (m) => { if (!bossOnly) showCatReport(m, { delayMs: 3500, holdSec: 25 }); };
net.onWorldEvent = (phase, name, _x, _z, loot) => {
  if (bossOnly) return;
  const hunt = name === "Охота";
  const tower = name === "Башня";
  if (phase === "start") {
    ov.showCard(
      tower ? "Охотничья башня!" : hunt ? "Охота на элиту!" : `${name}!`,
      tower
        ? "герои по очереди штурмуют башню — !event, чтобы встать в очередь"
        : hunt
          ? "в мире объявился Огнекрылый дракон — редкая добыча"
          : "мобы лезут волнами — герои сбегаются",
      9,
    );
  } else if (phase === "win") {
    if (tower) return;
    ov.showCard(
      hunt ? "Огнекрылый дракон повержен" : `${name} отражено`,
      `участникам — ×2 опыт и урон на ${EVENT_BUFF_MINUTES} мин`,
      10,
      loot,
    );
  } else {
    ov.showCard(
      tower ? "Охотничья башня закрылась" : hunt ? "Огнекрылый дракон улетел" : `${name} утихло`,
      "",
      6,
    );
  }
};
net.onConnectionLost = () => {
  live = false;
  ov.setShown(false);
};
net.onReconnected = () => {
  live = true;
  ov.setShown(true);
};

// Пустой кадр — когда рендерящая страница молчит: панели гаснут, а не застывают.
const EMPTY_FRAME: OverlayFrame = {
  watching: null,
  shotLabel: "",
  targetHp: null,
  watchStats: null,
  watchTitle: null,
  watchLevel: null,
  watchBuffs: null,
  watchInv: null,
  online: [],
  chatQuest: null,
  catacombs: null,
  towerStatus: null,
  ticker: "",
  tickerKind: "news",
};

function tick(): void {
  // Рендерящая страница молчит дольше 8 с (перезагрузка/закрыта) — гасим то, что она считала.
  const st = net.room?.state;
  const now = performance.now();
  // Кадр веб-спектатора — целиком; нет его — панели «смотрим» по цели кадра Unity-спектатора, из состояния комнаты.
  const f: OverlayFrame = frame && now - frameAt < 8000
    ? frame
    : subj && now - subjAt < 8000
      ? { ...EMPTY_FRAME, ...watchPanels(st, subj), shotLabel: shotLabel(subj.shot) }
      : EMPTY_FRAME;
  const isBoss = !!f.targetHp?.boss;
  if (bossOnly) {
    ov.setTicker("", "news");
    ov.update({ ...EMPTY_FRAME, targetHp: isBoss ? f.targetHp : null });
    return;
  }
  // Строка сверху и онлайн — из состояния комнаты: кадр рендерящей страницы для них не нужен
  // (Unity-спектатор кадров не шлёт). Говорящих берём из последнего кадра, если он свежий.
  const speakingNicks = new Set(f.online.filter((p) => p.speaking).map((p) => p.nick));
  const { ticker, tickerKind } = tickerOf(st);
  const fromRoom = {
    ...f, ticker, tickerKind,
    online: onlineOf(st, (_id, nick) => speakingNicks.has(nick)),
    chatQuest: chatQuestOf(st),
    catacombs: catacombsOf(st),
  };
  // В полном оверлее босса показывает отдельный источник (part=boss) — здесь его не дублируем.
  const view = part === "main" && isBoss ? { ...fromRoom, targetHp: null } : fromRoom;
  ov.setTicker(view.ticker, view.tickerKind);
  ov.update(view);
}

// Оверлею хватает 4 кадров в секунду: анимации в нём — CSS.
setInterval(() => {
  if (live) tick();
}, 250);

// Новая сборка на сервере — перезагружаем страницу. Сравниваем с файлами, которые загружены в ЭТОЙ вкладке
// (а не с первой проверкой через 2 мин): иначе вкладка, открытая до выкладки, не обновлялась никогда.
const assetsOf = (doc: Document): string =>
  [...doc.querySelectorAll('script[src], link[rel="modulepreload"][href]')]
    .map((el) => el.getAttribute("src") ?? el.getAttribute("href") ?? "")
    .filter((u) => /\/assets\/.+\.js$/.test(u))
    .sort()
    .join(",");
const ownAssets = assetsOf(document);
setInterval(async () => {
  try {
    const html = await fetch(`/overlay.html?_=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
    const fresh = assetsOf(new DOMParser().parseFromString(html, "text/html"));
    if (ownAssets && fresh && fresh !== ownAssets) location.reload();
  } catch {
    /* сервер перезапускается — пробуем в следующий раз */
  }
}, 60_000);

if (!key) {
  console.error("[overlay] нужен ?spectator=КЛЮЧ");
} else {
  void net.connectSpectator(key).then((ok) => {
    if (!ok) console.error("[overlay] не удалось подключиться к серверу");
    else {
      live = true;
      ov.setShown(true);
    }
  });
}
