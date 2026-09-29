import type { Room } from "colyseus.js";

import type { ZoneState } from "#shared/net/schema";
import type { SpecCmd, OverlayPatch } from "#shared/net/messages";
import { TTS_VOICES } from "#shared/tts";
import { NetClient } from "../net/NetClient";
import { CINE_PATHS } from "../spectator/cine";

const LS_KEY = "zepDashKey";
const LS_OVERLAY = "zepOverlayCfg";

interface OverlayToggle {
  key: "wm" | "clock" | "online" | "watching" | "hp" | "feed" | "top" | "ticker";
  label: string;
}

const OVERLAY_TOGGLES: OverlayToggle[] = [
  { key: "ticker", label: "Строка событий (сверху)" },
  { key: "wm", label: "Вотермарк" },
  { key: "clock", label: "Часы (МСК)" },
  { key: "online", label: "Список онлайн" },
  { key: "watching", label: "«Смотрим»" },
  { key: "hp", label: "HP цели" },
  { key: "feed", label: "Находки оружия" },
  { key: "top", label: "Топ героев" },
];

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
  /** Текущий раздел пульта (сворачиваемый) — туда кладут элементы. */
  private box!: HTMLElement;
  private auto = true;
  private readonly autoBtn: HTMLButtonElement;
  private botsOnly = false;
  private readonly botsBtn: HTMLButtonElement;
  // null — ещё не пришло состояние с сервера (см. refreshList): пока не
  // сравнить с чем-то заведомо другим, кнопка держит плейсхолдер «—».
  private mobsOn: boolean | null = null;
  private mobsBtn!: HTMLButtonElement;
  private specVisible: boolean | null = null;
  private specBtn!: HTMLButtonElement;
  private specRaysVisible: boolean | null = null;
  private specRaysBtn!: HTMLButtonElement;
  private specVoice: boolean | null = null;
  private specVoiceBtn!: HTMLButtonElement;
  private dmgNumbers: boolean | null = null;
  private dmgNumbersBtn!: HTMLButtonElement;
  private ttsOn: boolean | null = null;
  private ttsBtn!: HTMLButtonElement;
  private ttsSel!: HTMLSelectElement;
  private musicVolInp!: HTMLInputElement;
  private musicVolLbl!: HTMLSpanElement;
  private sfxVolInp!: HTMLInputElement;
  private sfxVolLbl!: HTMLSpanElement;
  private eventVolInp!: HTMLInputElement;
  private eventVolLbl!: HTMLSpanElement;
  private dayAutoBtn!: HTMLButtonElement;
  private hourInp!: HTMLInputElement;
  private hourLbl!: HTMLSpanElement;
  private dayAuto: number | null = null;
  private lastListSig = "";

  /** Локальная копия конфигурации оверлея — переживает перезагрузку спектатора. */
  private ov: Required<OverlayPatch> = {
    watermark: "ZEP GAME",
    wm: 1,
    clock: 1,
    online: 1,
    watching: 1,
    hp: 1,
    feed: 1,
    top: 1,
    ticker: 1,
  };
  private readonly ovBtns = new Map<string, HTMLButtonElement>();

  constructor(keyFromUrl: string | null) {
    // index.html ставит html/body {overflow:hidden} под игру (полноэкранный
    // canvas) — пульту это ломает скролл, снимаем на его странице явно.
    // И touch-action:none оттуда же — из-за него пульт не листался пальцем на телефоне.
    document.documentElement.style.cssText =
      "overflow-y:auto;height:auto;touch-action:pan-y;overscroll-behavior:auto;user-select:auto;-webkit-user-select:auto";
    document.body.innerHTML = "";
    document.body.style.cssText =
      "margin:0;background:#0f1016;color:#e8ecf8;font:15px/1.4 system-ui,sans-serif;" +
      "-webkit-tap-highlight-color:transparent;padding:12px 12px 40px;max-width:560px;" +
      "margin:0 auto;overflow-y:auto;height:auto;min-height:100vh;box-sizing:border-box;" +
      "touch-action:pan-y;overscroll-behavior:auto;user-select:auto;-webkit-user-select:auto";

    this.root = el("div", "");
    document.body.appendChild(this.root);

    this.loadOverlay();

    const key = this.resolveKey(keyFromUrl);
    if (!key) {
      this.askKey();
      this.nowEl = el("div", "");
      this.listEl = el("div", "");
      this.autoBtn = document.createElement("button");
      this.botsBtn = document.createElement("button");
      return;
    }

    // --- шапка ---
    const h = el("div", "");
    h.style.cssText = "display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px";
    h.append(strong("ZEP GAME — пульт"), (this.nowEl = el("div", "подключаюсь…")));
    this.nowEl.style.cssText = "font:12px/1.2 ui-monospace,monospace;color:#8c96ad;text-align:right";
    this.root.appendChild(h);

    // --- режиссёр: две кнопки в ряд ---
    const dir = el("div", "");
    dir.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";
    this.autoBtn = this.bigBtn("Авто-режиссёр: ВКЛ", () => this.toggleAuto());
    this.autoBtn.style.background = "#1c3a24";
    // Режим «только боты»: камера ходит лишь по ботам зрителей.
    this.botsBtn = this.bigBtn("Только боты: ВЫКЛ", () => this.toggleBots());
    this.setBotsUi(false);
    dir.append(this.autoBtn, this.botsBtn);
    this.root.appendChild(dir);

    // --- живой список игроков (главное — открыт) ---
    this.section("Игроки онлайн", true);
    this.listEl = el("div", "");
    this.box.appendChild(this.listEl);

    // --- кадры и кинопути ---
    this.section("Кадры и кинопути", false);
    const fixed = el("div", "");
    fixed.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px";
    fixed.append(
      this.cmdBtn("Обзор зоны", { t: "cam", shot: "overview" }, true),
      this.cmdBtn("Орбита босса", { t: "cam", shot: "orbitBoss" }, true),
      this.cmdBtn("Группа сверху", { t: "cam", shot: "crowd" }, true),
    );
    CINE_PATHS.forEach((p, i) => fixed.appendChild(this.cmdBtn(p.name, { t: "cam", shot: `path:${i}` }, true)));
    this.box.appendChild(fixed);

    // --- звук эфира (часто) ---
    this.section("Звук эфира", true);
    const sndGrid = el("div", "");
    sndGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";
    this.specVoiceBtn = this.bigBtn("Голос игроков: —", () => this.toggleSpecVoice());
    this.dmgNumbersBtn = this.bigBtn("Числа урона: —", () => this.toggleDmgNumbers());
    sndGrid.append(this.specVoiceBtn, this.dmgNumbersBtn);
    this.box.appendChild(sndGrid);
    // Громкость музыки/эффектов — только у рендерящего спектатора (стрим).
    const musicRow = this.volSlider("Музыка", 100, (v) => {
      this.musicVolLbl.textContent = `${v}%`;
      this.send({ t: "musicVol", v });
    });
    this.musicVolInp = musicRow.input;
    this.musicVolLbl = musicRow.label;
    const sfxRow = this.volSlider("Эффекты", 100, (v) => {
      this.sfxVolLbl.textContent = `${v}%`;
      this.send({ t: "sfxVol", v });
    });
    this.sfxVolInp = sfxRow.input;
    this.sfxVolLbl = sfxRow.label;
    const eventRow = this.volSlider("Ивенты (рог/фанфары)", 100, (v) => {
      this.eventVolLbl.textContent = `${v}%`;
      this.send({ t: "eventVol", v });
    });
    this.eventVolInp = eventRow.input;
    this.eventVolLbl = eventRow.label;
    this.box.append(musicRow.row, sfxRow.row, eventRow.row);
    const ttsRow = el("div", "");
    ttsRow.style.cssText = "display:flex;gap:8px;align-items:center";
    this.ttsBtn = this.bigBtn("Озвучка чата: —", () => this.toggleTts());
    this.ttsBtn.style.flex = "1";
    this.ttsSel = document.createElement("select");
    this.ttsSel.style.cssText =
      "flex:1;min-width:0;padding:12px 8px;border:1px solid #4a5570;border-radius:8px;" +
      "background:#1d1f2b;color:#e8ecf8;font:14px system-ui";
    for (const v of TTS_VOICES) {
      const o = document.createElement("option");
      o.value = v.ref;
      o.textContent = v.name;
      this.ttsSel.appendChild(o);
    }
    this.ttsSel.addEventListener("change", () => this.send({ t: "ttsVoice", ref: this.ttsSel.value }));
    ttsRow.append(this.ttsBtn, this.ttsSel);
    this.box.appendChild(ttsRow);

    // --- время суток: авто + слайдер часа ---
    this.section("Время суток", false);
    this.dayAutoBtn = this.bigBtn("Авто-ход суток: —", () => this.toggleDayAuto());
    this.box.appendChild(this.dayAutoBtn);
    // Применяется сразу на каждом шаге ползунка (час меняется только при
    // смене значения — сервер не заваливаем).
    const hourRow = this.volSlider("Час", 12, (v) => {
      this.hourLbl.textContent = `${String(v).padStart(2, "0")}:00`;
      this.send({ t: "time", hour: v });
    });
    this.hourInp = hourRow.input;
    this.hourLbl = hourRow.label;
    this.hourInp.max = "23";
    this.hourLbl.textContent = "12:00";
    this.box.appendChild(hourRow.row);

    // --- заставка: компактно ---
    this.section("Заставка на экран", false);
    const cardIn = this.textInput("Заголовок");
    const cardSub = this.textInput("Подпись (необязательно)");
    const cardRow = el("div", "");
    cardRow.style.cssText = "display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px";
    const showBtn = this.cmdLike("Показать", "#1c3a24", () => {
      const t = cardIn.value.trim();
      if (t) this.send({ t: "card", title: t, sub: cardSub.value.trim() || undefined, secs: 0 });
    });
    const hideBtn = this.cmdLike("Убрать", "#3a2020", () => this.send({ t: "card", title: "" }));
    const inputs = el("div", "");
    inputs.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px";
    inputs.append(cardIn, cardSub);
    cardRow.append(showBtn, hideBtn);
    cardRow.style.gridTemplateColumns = "1fr 1fr";
    this.box.append(inputs, cardRow);

    // --- оверлей: что показывать в эфире ---
    this.section("Оверлей", false);
    const wmRow = el("div", "");
    wmRow.style.cssText = "display:flex;gap:8px;margin-bottom:8px";
    const wmIn = this.textInput("Текст вотермарка");
    wmIn.value = this.ov.watermark;
    wmIn.style.flex = "1";
    const wmApply = this.cmdLike("✓", "#1d1f2b", () => {
      this.ov.watermark = wmIn.value.trim() || "ZEP GAME";
      this.saveOverlay();
      this.send({ t: "overlay", patch: { watermark: this.ov.watermark } });
    });
    wmApply.style.padding = "0 18px";
    wmRow.append(wmIn, wmApply);
    this.box.appendChild(wmRow);
    const ovGrid = el("div", "");
    ovGrid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:6px";
    for (const t of OVERLAY_TOGGLES) {
      const b = this.bigBtn("", () => this.toggleOverlay(t.key));
      b.style.cssText += ";padding:10px;margin:0;font-size:13px";
      this.ovBtns.set(t.key, b);
      ovGrid.appendChild(b);
    }
    this.box.appendChild(ovGrid);
    this.refreshOverlayUi();

    // --- админ-панель: редкие и необратимые действия ---
    this.section("Админ-панель", false);
    const admin = el("div", "");
    admin.style.cssText =
      "border:1px solid #6a3030;border-radius:10px;padding:8px;background:#241417";
    this.mobsBtn = this.bigBtn("Мобы: —", () => this.toggleMobs());
    this.specBtn = this.bigBtn("Камера стрима игрокам: —", () => this.toggleSpecVisible());
    this.specRaysBtn = this.bigBtn("Лучи направления камеры: —", () => this.toggleSpecRays());
    const clearBtn = this.bigBtn("Очистить лут с земли", () => {
      if (!confirm("Убрать весь лежащий лут во всём мире? Действие необратимо.")) return;
      this.send({ t: "clearLoot" });
    });
    clearBtn.style.borderColor = "#8a3a3a";
    admin.append(this.mobsBtn, this.specBtn, this.specRaysBtn, clearBtn);
    this.box.appendChild(admin);

    void this.connect(key);
  }

  // ---- сеть ----

  private async connect(key: string): Promise<void> {
    this.net.onSpecCmd = (cmd) => {
      if (cmd.t === "nowShot") this.nowEl.textContent = `в эфире: ${cmd.shot}`;
      else if (cmd.t === "auto") this.setAutoUi(cmd.on !== 0);
      else if (cmd.t === "bots") this.setBotsUi(cmd.on !== 0);
      else if (cmd.t === "overlay") {
        // Сервер теперь сам источник правды (переживает рестарт) — шлёт это
        // сразу по подключению. Разошёл кто-то другой патч руками — тоже
        // сюда, синхронизируем UI и локальный кэш вместо того, чтобы тихо
        // разойтись с тем, что реально в эфире.
        Object.assign(this.ov, cmd.patch);
        this.saveOverlay();
        this.refreshOverlayUi();
      }
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
    if ((st.mobsOn !== 0) !== this.mobsOn) this.setMobsUi(st.mobsOn !== 0);
    if ((st.specVisible !== 0) !== this.specVisible) this.setSpecUi(st.specVisible !== 0);
    if ((st.specRaysVisible !== 0) !== this.specRaysVisible) {
      this.setSpecRaysUi(st.specRaysVisible !== 0);
    }
    if ((st.specVoice !== 0) !== this.specVoice) this.setSpecVoiceUi(st.specVoice !== 0);
    if ((st.dmgNumbers !== 0) !== this.dmgNumbers) this.setDmgNumbersUi(st.dmgNumbers !== 0);
    if (Number(this.musicVolInp.value) !== st.specMusicVol && document.activeElement !== this.musicVolInp) {
      this.musicVolInp.value = String(st.specMusicVol);
      this.musicVolLbl.textContent = `${st.specMusicVol}%`;
    }
    if (Number(this.sfxVolInp.value) !== st.specSfxVol && document.activeElement !== this.sfxVolInp) {
      this.sfxVolInp.value = String(st.specSfxVol);
      this.sfxVolLbl.textContent = `${st.specSfxVol}%`;
    }
    if (Number(this.eventVolInp.value) !== st.specEventVol && document.activeElement !== this.eventVolInp) {
      this.eventVolInp.value = String(st.specEventVol);
      this.eventVolLbl.textContent = `${st.specEventVol}%`;
    }
    if ((st.ttsOn !== 0) !== this.ttsOn) this.setTtsUi(st.ttsOn !== 0);
    if (st.ttsVoice && this.ttsSel.value !== st.ttsVoice) this.ttsSel.value = st.ttsVoice;
    const players = [...st.players.entries()].map(([id, p]) => ({ id, nick: p.nick }));
    // Живые игроки сверху, боты ниже.
    players.sort((a, b) => Number(a.id.startsWith("bot:")) - Number(b.id.startsWith("bot:")));
    const sig = players.map((p) => p.id).join();
    if (sig === this.lastListSig) return;
    this.lastListSig = sig;

    this.listEl.innerHTML = "";
    if (players.length === 0) {
      this.listEl.appendChild(el("div", "игроков нет — режиссёр крутит обзор и пути"));
    }
    for (const p of players) {
      const bot = p.id.startsWith("bot:");
      // Ракурсов стало девять — в одну строку с ником они не влезали на
      // телефоне. Ник отдельной строкой, кнопки — сеткой с переносом.
      const block = el("div", "");
      block.style.cssText =
        "margin:6px 0;padding:6px 8px;border:1px solid #2a2f40;border-radius:10px";
      const name = el("div", `${bot ? "\u{1F916}" : "\u{1F3AE}"} ${p.nick}`);
      name.style.cssText =
        "font-weight:600;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      const grid = el("div", "");
      grid.style.cssText =
        "display:grid;grid-template-columns:repeat(4,1fr);gap:4px";
      const cams: [string, string][] = [
        ["орбита", "orbitPlayer"],
        ["из глаз", "eyePlayer"],
        ["напротив", "frontPlayer"],
        ["сбоку", "sidePlayer"],
        ["дрон", "dronePlayer"],
        ["снизу", "heroLow"],
        ["дуэль", "duelPlayer"],
      ];
      for (const [label, shot] of cams) {
        grid.appendChild(this.cmdBtn(label, { t: "cam", shot: `${shot}:${p.id}` }, true));
      }
      block.append(name, grid);
      this.listEl.appendChild(block);
    }

  }

  // ---- ui-хелперы ----

  private toggleAuto(): void {
    this.setAutoUi(!this.auto);
    this.send({ t: "auto", on: this.auto ? 1 : 0 });
  }

  private toggleBots(): void {
    this.setBotsUi(!this.botsOnly);
    this.send({ t: "bots", on: this.botsOnly ? 1 : 0 });
    // Режим осмыслен только с включённой авто-ротацией.
    if (this.botsOnly && !this.auto) this.setAutoUi(true);
  }

  private toggleDayAuto(): void {
    const next = this.dayAuto ? 0 : 1;
    this.setDayAutoUi(next);
    this.send({ t: "dayAuto", on: next });
  }

  private toggleMobs(): void {
    this.setMobsUi(!this.mobsOn);
    this.send({ t: "mobsOn", on: this.mobsOn ? 1 : 0 });
  }

  private toggleSpecVisible(): void {
    this.setSpecUi(!this.specVisible);
    this.send({ t: "specVisible", on: this.specVisible ? 1 : 0 });
  }

  private toggleSpecRays(): void {
    this.setSpecRaysUi(!this.specRaysVisible);
    this.send({ t: "specRaysVisible", on: this.specRaysVisible ? 1 : 0 });
  }

  private toggleSpecVoice(): void {
    this.setSpecVoiceUi(!this.specVoice);
    this.send({ t: "specVoice", on: this.specVoice ? 1 : 0 });
  }

  private toggleDmgNumbers(): void {
    this.setDmgNumbersUi(!this.dmgNumbers);
    this.send({ t: "dmgNumbers", on: this.dmgNumbers ? 1 : 0 });
  }

  private toggleTts(): void {
    this.setTtsUi(!this.ttsOn);
    this.send({ t: "tts", on: this.ttsOn ? 1 : 0 });
  }

  private toggleOverlay(key: OverlayToggle["key"]): void {
    this.ov[key] = this.ov[key] ? 0 : 1;
    this.saveOverlay();
    this.refreshOverlayUi();
    this.send({ t: "overlay", patch: { [key]: this.ov[key] } });
  }

  private refreshOverlayUi(): void {
    for (const t of OVERLAY_TOGGLES) {
      const b = this.ovBtns.get(t.key);
      if (!b) continue;
      const on = this.ov[t.key] !== 0;
      b.textContent = `${t.label}: ${on ? "ВКЛ" : "ВЫКЛ"}`;
      b.style.background = on ? "#1c3a24" : "#3a2020";
    }
  }

  private loadOverlay(): void {
    try {
      const raw = localStorage.getItem(LS_OVERLAY);
      if (raw) Object.assign(this.ov, JSON.parse(raw));
    } catch {
      /* мусор в сторадже — остаёмся на дефолте */
    }
  }

  private saveOverlay(): void {
    try {
      localStorage.setItem(LS_OVERLAY, JSON.stringify(this.ov));
    } catch {
      /* приватный режим — переживём без сохранения */
    }
  }

  private setDayAutoUi(on: number): void {
    this.dayAuto = on;
    this.dayAutoBtn.textContent = `Авто-ход суток: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.dayAutoBtn.style.background = on ? "#1c3a24" : "#3a2020";
  }

  private setBotsUi(on: boolean): void {
    this.botsOnly = on;
    this.botsBtn.textContent = `Только боты: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.botsBtn.style.background = on ? "#1c3a24" : "#1d1f2b";
  }

  private setMobsUi(on: boolean): void {
    this.mobsOn = on;
    this.mobsBtn.textContent = `Мобы: ${on ? "ВКЛ (дерутся)" : "ВЫКЛ (замерли)"}`;
    this.mobsBtn.style.background = on ? "#1d1f2b" : "#3a2020";
  }

  private setSpecUi(on: boolean): void {
    this.specVisible = on;
    this.specBtn.textContent = `Камера стрима игрокам: ${on ? "ВКЛ (видна)" : "ВЫКЛ (скрыта)"}`;
    this.specBtn.style.background = on ? "#1d1f2b" : "#3a2020";
  }

  private setSpecRaysUi(on: boolean): void {
    this.specRaysVisible = on;
    this.specRaysBtn.textContent = `Лучи направления камеры: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.specRaysBtn.style.background = on ? "#1d1f2b" : "#3a2020";
  }

  private setTtsUi(on: boolean): void {
    this.ttsOn = on;
    this.ttsBtn.textContent = `Озвучка чата: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.ttsBtn.style.background = on ? "#1c3a24" : "#3a2020";
    this.ttsSel.disabled = !on;
    this.ttsSel.style.opacity = on ? "1" : ".5";
  }

  private setSpecVoiceUi(on: boolean): void {
    this.specVoice = on;
    this.specVoiceBtn.textContent = `Голос игроков: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.specVoiceBtn.style.background = on ? "#1c3a24" : "#3a2020";
  }

  private setDmgNumbersUi(on: boolean): void {
    this.dmgNumbers = on;
    this.dmgNumbersBtn.textContent = `Числа урона: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.dmgNumbersBtn.style.background = on ? "#1c3a24" : "#3a2020";
  }

  private setAutoUi(on: boolean): void {
    this.auto = on;
    this.autoBtn.textContent = `Авто-режиссёр: ${on ? "ВКЛ" : "ВЫКЛ"}`;
    this.autoBtn.style.background = on ? "#1c3a24" : "#3a2020";
  }

  /** Сворачиваемый раздел; `open` — развёрнут по умолчанию (запоминается). */
  private section(title: string, open: boolean): void {
    const d = document.createElement("details");
    const lsKey = `zepDashSec:${title}`;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(lsKey);
    } catch {
      /* без стораджа — дефолт */
    }
    d.open = saved === null ? open : saved === "1";
    d.addEventListener("toggle", () => {
      try {
        localStorage.setItem(lsKey, d.open ? "1" : "0");
      } catch {
        /* приватный режим */
      }
    });
    d.style.cssText = "margin:10px 0;border-top:1px solid #23273a;padding-top:6px";
    const sum = document.createElement("summary");
    sum.textContent = title;
    sum.style.cssText =
      "cursor:pointer;padding:8px 0;font:600 12px/1 ui-monospace,monospace;letter-spacing:.08em;" +
      "text-transform:uppercase;color:#aab3c8";
    d.appendChild(sum);
    this.root.appendChild(d);
    this.box = d;
  }

  private textInput(placeholder: string): HTMLInputElement {
    const i = document.createElement("input");
    i.placeholder = placeholder;
    i.style.cssText =
      "width:100%;min-width:0;padding:10px;border:1px solid #4a5570;border-radius:8px;" +
      "background:#1d1f2b;color:#e8ecf8;font:14px system-ui;box-sizing:border-box";
    return i;
  }

  private cmdLike(text: string, bg: string, on: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      `padding:10px;border:1px solid #4a5570;border-radius:8px;background:${bg};` +
      "color:#e8ecf8;font:600 14px system-ui;cursor:pointer";
    b.addEventListener("click", on);
    return b;
  }

  private bigBtn(text: string, on: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      "width:100%;padding:11px 8px;margin:3px 0;border:1px solid #5a6480;border-radius:8px;" +
      "background:#1d1f2b;color:#e8ecf8;font:600 14px system-ui;cursor:pointer";
    b.addEventListener("click", on);
    return b;
  }

  /** Слайдер громкости 0..100 с подписью — для музыки/эффектов рендерящего спектатора. */
  private volSlider(
    label: string,
    init: number,
    onInput: (v: number) => void,
  ): { row: HTMLDivElement; input: HTMLInputElement; label: HTMLSpanElement } {
    const row = document.createElement("div");
    row.style.cssText = "margin:6px 0 10px";
    const head = document.createElement("div");
    head.style.cssText = "display:flex;justify-content:space-between;font:14px system-ui;margin-bottom:4px";
    const nameEl = document.createElement("span");
    nameEl.textContent = label;
    const valEl = document.createElement("span");
    valEl.textContent = `${init}%`;
    valEl.style.color = "#8c96ad";
    head.append(nameEl, valEl);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.value = String(init);
    input.style.cssText = "width:100%;accent-color:#3a7a4a";
    input.addEventListener("input", () => onInput(Number(input.value)));
    row.append(head, input);
    return { row, input, label: valEl };
  }

  private cmdBtn(text: string, cmd: SpecCmd, small = false): HTMLButtonElement {
    const b = document.createElement("button");
    b.textContent = text;
    b.style.cssText =
      `padding:${small ? "8px 12px" : "14px 10px"};border:1px solid #4a5570;border-radius:8px;` +
      `background:#1d1f2b;color:#e8ecf8;font:${small ? "13px" : "600 14px"} system-ui;cursor:pointer;` +
      "min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
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
