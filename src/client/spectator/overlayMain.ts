import { NetClient } from "../net/NetClient";
import { Overlay, type OverlayCtx } from "./Overlay";
import { CHANGELOG, CHANGELOG_SHOWN, CHANGELOG_HOLD_SEC } from "#shared/changelog";
import type { OvlCam, SpecCmd } from "#shared/net/messages";

/**
 * Оверлей стрима отдельной страницей (`/overlay.html?spectator=КЛЮЧ`) — второй
 * Browser Source в OBS поверх основного (`/?spectator=КЛЮЧ&obs=1&overlay=ext`).
 * Без Babylon: только DOM. Своё соединение с комнатой как спектатор; события
 * (килфид, баннеры, топы) приходят от сервера напрямую, а то, что зависит от
 * камеры (кого смотрим, HP цели, кто говорит), присылает рендерящая страница
 * командой "ovl". Так перерисовка DOM не занимает главный поток сцены, а
 * перезагрузка сцены не мигает оверлеем.
 */

const params = new URLSearchParams(location.search);
const key = params.get("spectator");
const ov = new Overlay();
ov.setShown(false);

let cam: OvlCam | null = null;
let camAt = 0;
let live = false;

const net = new NetClient();
net.onSpecCmd = (cmd: SpecCmd) => {
  if (cmd.t === "ovl") {
    cam = cmd.d;
    camAt = performance.now();
  } else if (cmd.t === "card") ov.showCard(cmd.title, cmd.sub ?? "", cmd.secs ?? 0);
  else if (cmd.t === "overlay") ov.setConfig(cmd.patch);
};
net.onKillFeed = (by, victim) => ov.pushKill(by, victim);
net.onBossEvent = (kind, by, loot, lootItems) => ov.bossBanner(kind, by, loot, lootItems);
net.onLeaderboard = (rows) => ov.setLeaderboard(rows);
net.onTowerBoard = (rows) => ov.setTowerBoard(rows);
net.onWorldEvent = (phase, name, _x, _z, loot) => {
  const hunt = name === "Охота";
  const tower = name === "Башня";
  if (phase === "start") {
    ov.showCard(
      tower ? "Охотничья башня!" : hunt ? "Охота на элиту!" : `${name}!`,
      tower
        ? "герои по очереди штурмуют башню — !event, чтобы встать в очередь"
        : hunt
          ? "в мире объявился Грибной владыка — редкая добыча"
          : "мобы лезут волнами — герои сбегаются",
      9,
    );
  } else if (phase === "win") {
    if (tower) return;
    ov.showCard(
      hunt ? "Грибной владыка повержен" : `${name} отражено`,
      "участникам — ×2 опыт и урон" + (hunt ? "" : " на 15 мин"),
      10,
      loot,
    );
  } else {
    ov.showCard(
      tower ? "Охотничья башня закрылась" : hunt ? "Грибной владыка ушёл" : `${name} утихло`,
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

let changelogIdx = 0;
let changelogAt = 0;
function changelogLine(now: number): string {
  const items = CHANGELOG.slice(0, CHANGELOG_SHOWN);
  if (items.length === 0) return "";
  if (changelogAt === 0) changelogAt = now;
  if (now - changelogAt > CHANGELOG_HOLD_SEC * 1000) {
    changelogAt = now;
    changelogIdx = (changelogIdx + 1) % items.length;
  }
  return items[changelogIdx % items.length];
}

function tick(): void {
  const now = performance.now();
  const st = net.room?.state ?? null;
  // Рендерящая страница молчит дольше 8 с (перезагрузка/закрыта) — «смотрим» гасим.
  const c = cam && now - camAt < 8000 ? cam : null;
  const speaking = new Set(c?.sp ?? []);

  const online: { nick: string; speaking: boolean; bot: boolean }[] = [];
  let towerStatus: OverlayCtx["towerStatus"] = null;
  st?.players.forEach((p, id) => {
    online.push({ nick: p.nick, speaking: speaking.has(id), bot: id.startsWith("bot:") });
    if (p.towerFloor > 0) {
      towerStatus = {
        heroNick: p.nick,
        floor: p.towerFloor,
        mobsLeft: p.towerMobsLeft,
        mobsTotal: p.towerMobsTotal,
        bossActive: p.towerBossActive === 1,
      };
    }
  });

  if (st?.eventKind === 1) ov.setTicker("Идёт ивент — нашествие мобов (!event)", "event");
  else if (st?.eventKind === 2) ov.setTicker("Идёт ивент — охота на элиту (!event)", "event");
  else if (st?.eventKind === 3) ov.setTicker("Идёт ивент — Охотничья башня (!event)", "event");
  else ov.setTicker(changelogLine(now), "news");

  ov.update({
    watching: c?.w ?? null,
    watchStats: c?.ws ?? null,
    watchInv: c?.wi ?? null,
    shotLabel: c?.sl ?? "",
    targetHp: c?.hp
      ? { frac: c.hp.f, cur: c.hp.c, max: c.hp.m, name: c.hp.n, boss: c.hp.b }
      : null,
    online,
    towerStatus,
  });
}

// Оверлею хватает 4 кадров в секунду: анимации в нём — CSS.
setInterval(() => {
  if (live) tick();
}, 250);

// Новая сборка на сервере — перезагружаем страницу (как основной спектатор).
let knownBundle: string | null = null;
setInterval(async () => {
  try {
    const html = await fetch(`/?_=${Date.now()}`, { cache: "no-store" }).then((r) => r.text());
    const b = html.match(/assets\/main-[\w-]+\.js/)?.[0] ?? null;
    if (!b) return;
    if (knownBundle && b !== knownBundle) location.reload();
    knownBundle = b;
  } catch {
    /* сервер перезапускается — пробуем в следующий раз */
  }
}, 120_000);

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
