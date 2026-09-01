import type { Room } from "colyseus.js";

import type { ZoneState } from "#shared/net/schema";
import type { SpecCmd } from "#shared/net/messages";
import { NetClient } from "../net/NetClient";
import { CINE_PATHS } from "../spectator/cine";

const LS_KEY = "zepDashKey";

/**
 * Пульт стрима (этап 17 Ф5). Открывается на телефоне: `/?dash=КЛЮЧ`
 * (ключ = SPECTATOR_KEY, запоминается в localStorage — потом хватает `?dash=1`).
 *
 * Подключается как спектатор и шлёт `MSG.specCmd`; сервер пересылает команды
 * рендерящему спектатору. Живые списки игроков/мобов — из состояния комнаты.
 */
export class Dashboard {
  private readonly net = new NetClient();
  private room: Room<ZoneState> | null = null;
  private readonly root: HTMLDivElement;
  private readonly nowEl: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private auto = true;
  private readonly autoBtn: HTMLButtonElement;
  private dayAutoBtn!: HTMLButtonElement;
  private dayAuto: number | null = null;
  private lastListSig = "";

  constructor(keyFromUrl: string | null) {
    document.body.innerHTML = "";
    document.body.style.cssText =
      "margin:0;background:#0f1016;color:#e8ecf8;font:15px/1.4 system-ui,sans-serif;" +
      "-webkit-tap-highlight-color:transparent;padding:12px;max-width:560px;margin:0 auto";

    this.root = el("div", "");
    document.body.appendChild(this.root);

    const key = this.resolveKey(keyFromUrl);
    if (!key) {
      this.askKey();
      this.nowEl = el("div", "");
      this.listEl = el("div", "");
      this.autoBtn = document.createElement("button");
      return;
    }

    // --- шапка ---
    const h = el("div", "");
    h.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px";
    h.append(strong("ZEP GAME — пульт"), (this.nowEl = el("div", "подключаюсь…")));
    this.nowEl.style.cssText = "font:12px/1.2 ui-monospace,monospace;color:#8c96ad;text-align:right";
    this.root.appendChild(h);

    // --- авто-режиссёр ---
    this.autoBtn = this.bigBtn("Авто-режиссёр: ВКЛ", () => this.toggleAuto());
    this.autoBtn.style.background = "#1c3a24";
    this.root.appendChild(this.autoBtn);

    // --- фиксированные кадры ---
    this.section("Кадры");
    const fixed = el("div", "");
    fixed.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";
    fixed.append(
      this.cmdBtn("Обзор зоны", { t: "cam", shot: "overview" }),
      this.cmdBtn("Орбита босса", { t: "cam", shot: "orbitBoss" }),
      this.cmdBtn("Из глаз босса", { t: "cam", shot: "eyeBoss" }),
      this.cmdBtn("Склейка (cut)", { t: "cut" }),
    );
    this.root.appendChild(fixed);

    // --- кинопути ---
    this.section("Кинопути");
    const paths = el("div", "");
    paths.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";
    CINE_PATHS.forEach((p, i) => paths.appendChild(this.cmdBtn(p.name, { t: "cam", shot: `path:${i}` })));
    this.root.appendChild(paths);

    // --- живой список игроков / мобов ---
    this.section("Игроки и мобы онлайн");
    this.listEl = el("div", "");
    this.root.appendChild(this.listEl);

    // --- заставки / нижняя треть ---
    this.section("Заставка на экран");
    const cardIn = document.createElement("input");
    cardIn.placeholder = "Заголовок";
    cardIn.style.cssText =
      "width:100%;padding:10px;margin-bottom:6px;border:1px solid #4a5570;border-radius:8px;" +
      "background:#1d1f2b;color:#e8ecf8;font:14px system-ui;box-sizing:border-box";
    const cardSub = document.createElement("input");
    cardSub.placeholder = "Подпись (необязательно)";
    cardSub.style.cssText = cardIn.style.cssText;
    this.root.append(cardIn, cardSub);
    const cardRow = el("div", "");
    cardRow.style.cssText = "display:flex;gap:8px";
    const showBtn = this.bigBtn("Показать 6 с", () => {
      const t = cardIn.value.trim();
      if (t) this.send({ t: "card", title: t, sub: cardSub.value.trim() || undefined, secs: 6 });
    });
    const holdBtn = this.bigBtn("Держать 60 с", () => {
      const t = cardIn.value.trim();
      if (t) this.send({ t: "card", title: t, sub: cardSub.value.trim() || undefined, secs: 60 });
    });
    cardRow.append(showBtn, holdBtn);
    this.root.appendChild(cardRow);

    // --- время суток ---
    this.section("Время суток");
    this.dayAutoBtn = this.bigBtn("Авто-ход суток: —", () => this.toggleDayAuto());
    this.root.appendChild(this.dayAutoBtn);
    const time = el("div", "");
    time.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    for (const hh of [6, 9, 12, 15, 18, 21, 0]) {
      time.appendChild(
        this.cmdBtn(`${String(hh).padStart(2, "0")}:00`, { t: "time", hour: hh }, true),
      );
    }
    this.root.appendChild(time);

    void this.connect(key);
  }

  // ---- сеть ----

  private async connect(key: string): Promise<void> {
    this.net.onSpecCmd = (cmd) => {
      if (cmd.t === "nowShot") this.nowEl.textContent = `в эфире: ${cmd.shot}`;
      else if (cmd.t === "auto") this.setAutoUi(cmd.on !== 0);
    };
    this.net.onReconnected = (room) => (this.room = room);
    const ok = await this.net.connectSpectator(key);
    if (!ok) {
      this.nowEl.textContent = "сервер недоступен";
      setTimeout(() => location.reload(), 20_000);
      return;
    }
    this.room = this.net.room;
    this.nowEl.textContent = "на связи";
    setInterval(() => this.refreshList(), 1500);
    this.refreshList();
  }

  private send(cmd: SpecCmd): void {
    this.net.sendSpecCmd(cmd);
    // Локальный отклик кнопок — чтобы было видно нажатие.
    if (cmd.t === "cam") {
      this.nowEl.textContent = `→ ${cmd.shot}`;
      // Ручной выбор кадра = авто-режиссёр выключен (спектатор делает так же).
      if (cmd.shot !== "auto" && this.auto) this.setAutoUi(false);
    }
  }

  // ---- живой список ----

  private refreshList(): void {
    const st = this.room?.state;
    if (!st) return;
    if (st.dayAuto !== this.dayAuto) this.setDayAutoUi(st.dayAuto);
    const players = [...st.players.entries()].map(([id, p]) => ({ id, nick: p.nick }));
    const mobs: { id: string; label: string }[] = [];
    st.mobs.forEach((m, id) => {
      if (m.dead || m.kind === "shard") return;
      const label = m.kind === "boss" ? "Босс" : m.kind === "spitter" ? "Плевун" : "Слизень";
      mobs.push({ id, label });
    });
    const sig = players.map((p) => p.id).join() + "|" + mobs.map((m) => m.id).join();
    if (sig === this.lastListSig) return;
    this.lastListSig = sig;

    this.listEl.innerHTML = "";
    if (players.length === 0 && mobs.length === 0) {
      this.listEl.appendChild(el("div", "никого нет — режиссёр крутит обзор и пути"));
      return;
    }
    for (const p of players) {
      const row = this.listRow(`🎮 ${p.nick}`);
      row.append(
        this.cmdBtn("орбита", { t: "cam", shot: `orbitPlayer:${p.id}` }, true),
        this.cmdBtn("из глаз", { t: "cam", shot: `eyePlayer:${p.id}` }, true),
      );
      this.listEl.appendChild(row);
    }
    for (const m of mobs) {
      const row = this.listRow(`👹 ${m.label}`);
      row.appendChild(this.cmdBtn("из глаз", { t: "cam", shot: `eyeMob:${m.id}` }, true));
      this.listEl.appendChild(row);
    }
  }

  // ---- ui-хелперы ----

  private toggleAuto(): void {
    this.setAutoUi(!this.auto);
    this.send({ t: "auto", on: this.auto ? 1 : 0 });
  }

  private toggleDayAuto(): void {
    const next = this.dayAuto ? 0 : 1;
    this.setDayAutoUi(next);
    this.send({ t: "dayAuto", on: next });
  }

  private setDayAutoUi(on: number): void {
    this.dayAuto = on;
    this.dayAutoBtn.textContent = `Авто-ход суток: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.dayAutoBtn.style.background = on ? "#1c3a24" : "#3a2020";
  }

  private setAutoUi(on: boolean): void {
    this.auto = on;
    this.autoBtn.textContent = `Авто-режиссёр: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.autoBtn.style.background = on ? "#1c3a24" : "#3a2020";
  }

  private section(title: string): void {
    const s = el("div", title);
    s.style.cssText = "margin:16px 0 8px;font:11px/1 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase;color:#8c96ad";
    this.root.appendChild(s);
  }

  private listRow(label: string): HTMLDivElement {
    const row = el("div", "");
    row.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0";
    const l = el("div", label);
    l.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
    row.appendChild(l);
    return row;
  }

  private bigBtn(text: string, on: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      "width:100%;padding:14px;margin:4px 0;border:1px solid #5a6480;border-radius:8px;" +
      "background:#1d1f2b;color:#e8ecf8;font:600 15px system-ui;cursor:pointer";
    b.addEventListener("click", on);
    return b;
  }

  private cmdBtn(text: string, cmd: SpecCmd, small = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      `padding:${small ? "8px 12px" : "14px 10px"};border:1px solid #4a5570;border-radius:8px;` +
      `background:#1d1f2b;color:#e8ecf8;font:${small ? "13px" : "600 14px"} system-ui;cursor:pointer`;
    b.addEventListener("click", () => {
      this.send(cmd);
      b.style.background = "#2a5a3a";
      setTimeout(() => (b.style.background = "#1d1f2b"), 250);
    });
    return b;
  }

  // ---- ключ ----

  private resolveKey(fromUrl: string | null): string | null {
    if (fromUrl && fromUrl !== "1") {
      localStorage.setItem(LS_KEY, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(LS_KEY);
  }

  private askKey(): void {
    this.root.appendChild(strong("ZEP GAME — пульт"));
    const p = el("div", "Вставь ключ спектатора (SPECTATOR_KEY):");
    p.style.margin = "12px 0 6px";
    this.root.appendChild(p);
    const inp = document.createElement("input");
    inp.style.cssText = "width:100%;padding:12px;border:1px solid #5a6480;border-radius:8px;background:#1d1f2b;color:#e8ecf8;font:14px ui-monospace,monospace;box-sizing:border-box";
    this.root.appendChild(inp);
    const go = this.bigBtn("Подключиться", () => {
      const k = inp.value.trim();
      if (k) {
        localStorage.setItem(LS_KEY, k);
        location.href = "/?dash=1";
      }
    });
    this.root.appendChild(go);
  }
}

function el(tag: string, text: string): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  e.textContent = text;
  return e;
}

function strong(text: string): HTMLElement {
  const e = document.createElement("strong");
  e.textContent = text;
  e.style.font = "700 16px system-ui";
  return e;
}
