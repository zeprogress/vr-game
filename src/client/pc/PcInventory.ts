import { ATTRS as A2, ATTR_INFO, attrEffect, CLASSES2, costRule, skillCooldownFor, skillDesc, skillName, stepCost, type ClassId } from "#shared/classes2";
import { armorIconKey, glyph, skillIcon, weaponIcon } from "#shared/icons";
import { ARMOR_PART_NAME, ARMOR_PARTS, type ArmorPart } from "#shared/armor";
import { ATTR_LOOK, TIER_LOOK } from "#shared/look";
import { attackLabel } from "#shared/heroStats";
import { ensureIconCss, iconHtml, setIconEl } from "../ui/icons";
import type { IconKey } from "#shared/icons";
import { AEGIS_NAME, attackPointBonus, attackPointEligible, attackPointNext, attackPoints, bothHandsCls, bothHandsNote, fmtPct, qualityStarsShort, sharpPctOf, weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import type { PcEnchRow, PcInvActMsg, PcInvArmor, PcInvData, PcInvResult, PcInvWeapon, TradeItemView } from "#shared/net/messages";
import { skinPicture } from "#shared/skins";
import { ATTR_SHORT, gemName, parseGem, pcJewelBonus, RING, ringBonusText, ringLabel, ringName, ringResist, type PcInvJewels, type RingTier } from "#shared/jewels";
import { skillDamageText } from "#shared/skillDamage";
import { BAG_SORTS, bagPickItem, nextBagSort, sortBag, type BagSort } from "#shared/bagSort";
import { gemHtml, RING_SLOT_SVG, ringHtml } from "#shared/jewelIcons";

/**
 * Окно снаряжения (как в WoW, одно окно с вкладками) — ПК в игре, телефон и страница !inv:
 *  - «Снаряжение»: слева броня, справа руки и кольца; между ними — сведения о герое
 *    (в игре) или сам герой на камне (страница !inv: картинка облика и фон с горами);
 *    под слотами — ряд ★ избранного, справа — сумка с фильтрами;
 *  - клик/тап по предмету — карточка: всё о предмете, заточка роллов и точки атаки
 *    прямо в ней, действия (надеть/снять, ★, подарить, в лом, выбросить);
 *  - «Атрибуты», «Умения», «Обмен».
 *
 * Перетаскивание: из сумки на слот — надеть; со слота в сумку — снять; на
 * наковальню — в лом (с подтверждением); за окно — выбросить на землю (с
 * подтверждением). ПКМ по предмету — надеть/снять. Действия выполняет Game (руки держит клиент).
 */

export type Side = "left" | "right";
export type InvTab = "gear" | "attrs" | "skills" | "trade";

export interface HeldInfo {
  cls: string;
  tier: string;
}

export interface PcInventoryHooks {
  /** Телефон: тап — меню действий, перетаскивание — пальцем (HTML drag на тач не работает). */
  touch?: boolean;
  /** Страница !inv: окно встроено в страницу — без крестика, перетаскивания и «выбросить за окно»; герой на камне. */
  page?: boolean;
  /** После каждой перерисовки (страница !inv подгоняет фон под героя). */
  afterRender?: () => void;
  request: () => void;
  /** Использовать предмет сумки (свиток) — по id предмета. */
  useItem?: (id: "scroll_xp" | "scroll_wind") => void;
  act: (m: PcInvActMsg) => void;
  /** Броня в сумке: надеть / снять / разобрать / выбросить. Без хука броня не показывается (страница !inv). */
  armorAct?: (id: string, act: "wear" | "unwear" | "scrap" | "drop" | "fav") => void;
  /** Что сейчас в руках (включая обычное, которого нет на складе). */
  hands: () => { left: HeldInfo | null; right: HeldInfo | null };
  equip: (w: PcInvWeapon, side: Side) => void;
  toBag: (side: Side) => void;
  scrap: (w: PcInvWeapon) => void;
  drop: (w: PcInvWeapon) => void;
}

/** Положить значок оружия в элемент (из общего реестра shared/icons.ts; Эгида — свой). */
export function setIcon(el: HTMLElement, cls: string, name?: string, tier?: string): void {
  // Картинка оружия и щита — своя для каждого грейда (тир в картинке уже нарисован).
  setIconEl(el, weaponIcon(cls, name === AEGIS_NAME, tier));
}
const ATTRS = A2.map((id) => ({ id, name: ATTR_INFO[id].name, hint: attrEffect(id) }));

type DragSrc = { kind: "bag"; id: string } | { kind: "hand"; side: Side } | { kind: "ring"; id: string } | { kind: "armor"; id: string };

/** Предмет сумки: оружие, кольцо или броня — в одной сетке. */
type BagEntry = { w: PcInvWeapon } | { r: PcInvJewels["rings"][number] } | { a: PcInvArmor };

/** Фильтры сумки (вкладки над сеткой). */
type BagFilter = "all" | "fav" | "weapon" | "armor" | "ring" | "gem" | "misc";
const BAG_FILTERS: readonly [BagFilter, string][] = [
  ["all", "Все"],
  ["fav", "★ Избранное"],
  ["weapon", "Оружие"],
  ["armor", "Броня"],
  ["ring", "Кольца"],
  ["gem", "Камни"],
  ["misc", "Прочее"],
];

/** Значок строки характеристик (подписи — shared/heroStats.ts). */
const STAT_ICON: Record<string, IconKey> = {
  Здоровье: "st.hp",
  Урон: "st.dmg",
  "Волна молота (магия)": "st.magic",
  "Удар конусом": "st.dmg",
  "Скорость атаки": "st.aspd",
  "Скорость бега": "st.move",
  "Шанс уворота": "st.dodge",
  "Шанс крита": "st.crit",
  "Сила крита": "st.critx",
  Вампиризм: "st.vamp",
  "Физ. защита": "st.pdef",
  "Маг. защита": "st.mdef",
  Регенерация: "st.regen",
  "Блок щитом": "st.block",
  "Отражение щитом": "st.block",
};

export class PcInventory {
  private readonly root: HTMLDivElement;
  private readonly win: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly dropCatcher: HTMLDivElement;
  private readonly cursEl: HTMLDivElement;
  private data: PcInvData | null = null;
  private tab: InvTab = "gear";
  /** Открытая карточка предмета (тот же адрес, что у перетаскивания); null — закрыта. */
  private card: DragSrc | null = null;
  private bagFilter: BagFilter = "all";
  /** Ник и облик героя (страница !inv — картинка героя; в игре — ник в сведениях). */
  private hero = { nick: "", skin: 0 };
  private drag: DragSrc | null = null;
  private confirmEl: HTMLDivElement | null = null;
  private forging = false;
  private pendingResult: PcInvResult | null = null;
  private hammerDone = false;
  private lastResult: { text: string; up: boolean } | null = null;
  /** Таймер, который убирает всплывашку итога в сумке (сама гаснет через RESULT_TOAST_MS). */
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private xpFill: HTMLDivElement | null = null;
  private xpText: HTMLDivElement | null = null;
  private xpLv: HTMLDivElement | null = null;
  private xpState = { level: 1, xp: 0, need: 0, pct: 0, maxed: false };

  constructor(private readonly hooks: PcInventoryHooks) {
    injectInvStyle();
    this.root = div("pcinv-root");
    this.dropCatcher = div("pcinv-catch");
    this.win = div("pcinv-win");
    const head = div("pcinv-head");
    this.tabsEl = div("pcinv-tabs");
    this.cursEl = div("pcinv-curs");
    const close = document.createElement("button");
    close.className = "pcinv-x";
    close.textContent = "✕";
    close.title = "Закрыть (Esc)";
    close.onclick = () => this.closeWindow();
    head.append(this.tabsEl, this.cursEl, close);
    this.body = div("pcinv-body");
    this.tip = div("pcinv-tip");
    this.win.append(head, this.body);
    this.root.append(this.dropCatcher, this.win, this.tip);
    this.root.style.display = "none";
    document.body.appendChild(this.root);
    // ПК в игре: клик мимо окна закрывает его. Кнопки HUD не в счёт — иначе кнопка открытия тут же переоткрыла бы окно.
    // Меню кольца/предмета (confirmEl) лежит в корне, а не в окне — его кнопки тоже не «мимо».
    if (!hooks.touch && !hooks.page) {
      document.addEventListener(
        "pointerdown",
        (e) => {
          if (!this.isOpen || this.drag) return;
          const t = e.target as Node;
          if (this.win.contains(t) || this.tip.contains(t) || this.confirmEl?.contains(t)) return;
          if ((t as Element).closest?.(".pc-hud")) return;
          this.closeWindow();
        },
        true,
      );
    }

    // Окно двигается за шапку.
    let dragWin: { x: number; y: number; l: number; t: number } | null = null;
    head.addEventListener("pointerdown", (e) => {
      if (hooks.page || hooks.touch) return; // на странице и на телефоне (на весь экран) окно не двигается
      // По вкладкам и кнопкам — клик, а не перетаскивание окна (иначе захват
      // указателя шапкой съедал клик по вкладке).
      if ((e.target as HTMLElement).closest("button, .pcinv-tab, .pcinv-cur")) return;
      const r = this.win.getBoundingClientRect();
      dragWin = { x: e.clientX, y: e.clientY, l: r.left, t: r.top };
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener("pointermove", (e) => {
      if (!dragWin) return;
      this.win.style.left = `${dragWin.l + e.clientX - dragWin.x}px`;
      this.win.style.top = `${dragWin.t + e.clientY - dragWin.y}px`;
      this.win.style.transform = "none";
    });
    head.addEventListener("pointerup", () => (dragWin = null));

    // Бросили предмет мимо окна — выбросить на землю.
    this.dropCatcher.addEventListener("dragover", (e) => e.preventDefault());
    this.dropCatcher.addEventListener("drop", (e) => {
      e.preventDefault();
      const w = this.dragWeapon();
      this.endDrag();
      if (w?.fav) this.textTipAt(this.win, `${glyph("ui.fav")} В избранном`, "Избранное не выбрасывается — сначала сними звёздочку.");
      else if (w) this.askConfirm(`Выбросить «${w.name}» на землю?`, "Выбросить", () => this.hooks.drop(w));
    });
    this.win.addEventListener("contextmenu", (e) => e.preventDefault());
    if (hooks.touch) {
      this.root.classList.add("touch");
      this.bindTouch();
    }
    if (hooks.page) {
      this.root.classList.add("page");
      // Узкая страница — карточка поверх экрана, широкая — между колонками слотов: перестроить при смене.
      let floats = this.cardFloats();
      window.addEventListener("resize", () => {
        if (this.cardFloats() === floats) return;
        floats = this.cardFloats();
        if (this.card && this.isOpen) this.render();
      });
    }
  }

  // ---- телефон: тап — меню действий, зажал и повёл — перетаскивание пальцем ----

  private readonly touchSrc = new WeakMap<HTMLElement, DragSrc>();

  private bindTouch(): void {
    let cand: { el: HTMLElement; src: DragSrc; x: number; y: number; id: number } | null = null;
    let ghost: HTMLDivElement | null = null;
    this.root.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      let el = e.target as HTMLElement | null;
      while (el && el !== this.root && !this.touchSrc.has(el)) el = el.parentElement;
      if (!el || !this.touchSrc.has(el)) return;
      cand = { el, src: this.touchSrc.get(el)!, x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    this.root.addEventListener("pointermove", (e) => {
      if (!cand || e.pointerId !== cand.id) return;
      if (!ghost && Math.hypot(e.clientX - cand.x, e.clientY - cand.y) > 12) {
        this.drag = cand.src;
        this.hideTip();
        this.dropCatcher.style.display = "block";
        ghost = div("pcinv-ghost");
        const ic = cand.el.querySelector("img, svg");
        if (ic) ghost.append(ic.cloneNode(true));
        document.body.appendChild(ghost);
      }
      if (ghost) {
        e.preventDefault();
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      }
    });
    const up = (e: PointerEvent): void => {
      if (!cand || e.pointerId !== cand.id) return;
      const c = cand;
      cand = null;
      if (ghost) {
        ghost.remove();
        ghost = null;
        // Бросок: синтетический drop на то, что под пальцем (те же обработчики, что у мыши).
        const under = document.elementFromPoint(e.clientX, e.clientY);
        if (under) under.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
        this.endDrag();
        return;
      }
      this.openCard(c.src);
    };
    this.root.addEventListener("pointerup", up);
    this.root.addEventListener("pointercancel", () => {
      ghost?.remove();
      ghost = null;
      cand = null;
      this.endDrag();
    });
  }

  /** Клик/тап по предмету — его карточка (повторно по тому же — закрыть). */
  private openCard(src: DragSrc): void {
    this.hideTip();
    this.confirmEl?.remove();
    this.confirmEl = null;
    const same = this.card && sameSrc(this.card, src);
    if (!same) this.lastResult = null;
    this.card = same ? null : src;
    this.render();
  }

  private closeCard(): void {
    this.card = null;
    this.lastResult = null;
    this.render();
  }

  /** Блок характеристик и последние «живые» строки (с баффами) — обновляются без полной перерисовки. */
  private statsBox: HTMLElement | null = null;
  private liveStats: { label: string; value: string }[] | null = null;
  private liveSig = "";
  private fillStats(rows: { label: string; value: string }[]): void {
    const box = this.statsBox;
    if (!box) return;
    box.replaceChildren();
    for (const r of rows) {
      const row = div("pcinv-row");
      const ic = div("pcinv-row-ic");
      const k = STAT_ICON[r.label];
      if (k) ic.innerHTML = iconHtml(k);
      row.append(ic, span(r.label), span(r.value));
      box.append(row);
    }
  }
  /** Характеристики с активными баффами (считает клиент из своего состояния раз в секунду). */
  setLiveStats(rows: { label: string; value: string }[]): void {
    const sig = rows.map((r) => r.value).join("|");
    if (sig === this.liveSig) return;
    this.liveSig = sig;
    this.liveStats = rows;
    if (this.isOpen) this.fillStats(rows);
  }

  get isOpen(): boolean {
    return this.root.style.display !== "none";
  }

  /** Корневой элемент (страница !inv встраивает окно в свою разметку). */
  get element(): HTMLDivElement {
    return this.root;
  }

  open(tab: InvTab = this.tab): void {
    this.tab = tab;
    this.root.style.display = "";
    this.hooks.request();
    this.render();
  }

  /** Esc: сначала закрывается карточка предмета, потом окно. */
  close(): boolean {
    if (!this.isOpen) return false;
    if (this.card) {
      this.closeCard();
      return true;
    }
    return this.closeWindow();
  }

  /** Закрыть окно целиком (крестик, клик мимо окна). */
  closeWindow(): boolean {
    if (!this.isOpen) return false;
    this.root.style.display = "none";
    this.card = null;
    for (const e of this.root.querySelectorAll(":scope > .pcinv-dim, :scope > .pcinv-card")) e.remove();
    this.hideTip();
    this.confirmEl?.remove();
    this.confirmEl = null;
    this.syncTradePoll();
    return true;
  }

  toggle(tab: InvTab = "gear"): void {
    if (this.isOpen && this.tab === tab) this.closeWindow();
    else this.open(tab);
  }

  /** Ник и облик героя (облик — картинка героя на странице !inv). */
  setHero(nick: string, skin: number): void {
    if (this.hero.nick === nick && this.hero.skin === skin) return;
    this.hero = { nick, skin };
    if (this.isOpen && !this.forging && !this.tradeTyping()) this.render();
  }

  setData(d: PcInvData): void {
    this.data = d;
    // Предмета открытой карточки больше нет (разобран, подарен, ушёл в обмен) — карточку закрываем.
    if (this.card && !this.srcExists(d, this.card)) {
      this.card = null;
      this.lastResult = null;
    }
    // Пока печатают ник или открыт выбор игрока — не перерисовываем (сбросило бы фокус); данные уже в this.data.
    if (this.isOpen && !this.forging && !this.tradeTyping()) this.render();
  }

  /** Есть ли ещё предмет, на который указывает адрес (руки есть всегда). */
  private srcExists(d: PcInvData, s: DragSrc): boolean {
    if (s.kind === "hand") return true;
    if (s.kind === "bag") return d.weapons.some((w) => w.id === s.id);
    if (s.kind === "armor") return (d.armor ?? []).some((a) => a.id === s.id);
    return (d.jewels?.rings ?? []).some((r) => r.id === s.id);
  }

  /** Открыта вкладка «Обмен»: список онлайна обновляем сами (раз в 5 с), пока окно открыто. */
  private tradePoll: number | null = null;

  private syncTradePoll(): void {
    const want = this.isOpen && this.tab === "trade";
    if (want && this.tradePoll === null) this.tradePoll = window.setInterval(() => this.hooks.request(), 5000);
    else if (!want && this.tradePoll !== null) {
      window.clearInterval(this.tradePoll);
      this.tradePoll = null;
    }
  }

  /** Фокус в поле вкладки «Обмен» (ник, выбор игрока, галочка) — перерисовку откладываем. */
  private tradeTyping(): boolean {
    const a = document.activeElement;
    return this.tab === "trade" && this.isOpen && this.win.contains(a) && (a instanceof HTMLInputElement || a instanceof HTMLSelectElement);
  }

  /** Опыт героя: сколько набрано и сколько нужно до следующего уровня (Game шлёт каждый кадр; перерисовка — только при изменении). */
  setXp(level: number, xp: number, need: number, maxed: boolean): void {
    const have = Math.max(0, Math.floor(xp));
    const req = Number.isFinite(need) ? Math.max(1, Math.round(need)) : 0;
    const pct = maxed || req <= 0 ? 100 : Math.floor(Math.min(1, have / req) * 1000) / 10;
    const x = this.xpState;
    if (x.level === level && x.xp === have && x.need === req && x.maxed === maxed) return;
    x.level = level;
    x.xp = have;
    x.need = req;
    x.pct = pct;
    x.maxed = maxed;
    this.paintXp();
  }

  private paintXp(): void {
    if (!this.xpFill || !this.xpText) return;
    const x = this.xpState;
    this.xpFill.style.width = `${x.pct}%`;
    // Набрано / нужно и доля, которая УЖЕ набрана (раньше подпись «N% до …» читалась как «осталось»).
    const n = (v: number): string => v.toLocaleString("ru-RU");
    this.xpText.textContent = x.maxed ? "максимум" : `${n(x.xp)} / ${n(x.need)} · ${x.pct.toFixed(1)}%`;
    this.xpText.title = x.maxed ? "" : `Опыт: набрано ${n(x.xp)} из ${n(x.need)} — до ${x.level + 1} уровня осталось ${n(Math.max(0, x.need - x.xp))}`;
    if (this.xpLv) this.xpLv.textContent = `Уровень ${x.level}`;
  }

  /** Склад поменялся (подобрал, разобрал…) — попросить свежие данные. */
  refresh(): void {
    if (this.isOpen) this.hooks.request();
  }

  onResult(r: PcInvResult): void {
    if (!r.text) return; // «Понятно» у подарков — без строки итога
    if (!this.forging) {
      const res = { text: r.text, up: r.ok };
      this.lastResult = res;
      this.armResultTimer(res);
      if (this.isOpen) this.render();
      return;
    }
    this.pendingResult = r;
    if (this.hammerDone) this.reveal();
  }

  /** Итог в сумке (соединение камней, разбор…) — всплывашка, гаснет сама; в открытой карточке итог остаётся. */
  private armResultTimer(res: { text: string; up: boolean }): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => {
      this.resultTimer = null;
      if (this.lastResult !== res || this.card) return;
      this.lastResult = null;
      if (this.isOpen) this.render();
    }, RESULT_TOAST_MS);
  }

  private dropBagResult(): void {
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = null;
    this.lastResult = null;
    if (this.isOpen) this.render();
  }

  // ---------------- отрисовка ----------------

  private render(): void {
    this.syncTradePoll();
    const top = this.win.scrollTop;
    // Списки выбора прокручиваются сами — их позицию тоже сохраняем (иначе после нажатия сбрасывались наверх).
    const lists = [...this.win.querySelectorAll<HTMLElement>(".pcinv-tpick")].map((e) => e.scrollTop);
    // Сумка, ряд ★ и карточка прокручиваются сами — после перерисовки остаются на месте.
    const keep = new Map([...this.root.querySelectorAll<HTMLElement>("[data-keep]")].map((e) => [e.dataset.keep ?? "", [e.scrollLeft, e.scrollTop]] as const));
    this.renderInner();
    this.root.classList.toggle("tab-gear", this.tab === "gear");
    this.win.scrollTop = top;
    [...this.win.querySelectorAll<HTMLElement>(".pcinv-tpick")].forEach((e, i) => {
      if (lists[i] !== undefined) e.scrollTop = lists[i];
    });
    for (const e of this.root.querySelectorAll<HTMLElement>("[data-keep]")) {
      const v = keep.get(e.dataset.keep ?? "");
      if (v) [e.scrollLeft, e.scrollTop] = v;
    }
    this.hooks.afterRender?.();
  }

  /** Валюты в шапке: лом, жетоны ◈, зелья — видно всегда, с любой вкладки. */
  private renderCurs(d: PcInvData | null): void {
    this.cursEl.innerHTML = "";
    // Страница !inv: ник героя — здесь, вместо шапки страницы.
    if (this.hooks.page && this.hero.nick) {
      const n = div("pcinv-curnick");
      n.innerHTML = iconHtml("ui.hero");
      n.append(span(this.hero.nick));
      this.cursEl.append(n);
    }
    if (!d) return;
    const cur = (ico: string, n: number, title: string): void => {
      const c = div("pcinv-cur");
      c.innerHTML = `${ico}<b>${n.toLocaleString("ru-RU")}</b>`;
      c.title = title;
      this.cursEl.append(c);
    };
    cur(iconHtml("i.scrap"), d.scrap, "Лом — на заточку (в карточке предмета)");
    cur(iconHtml("i.token"), d.tokens ?? 0, "Жетоны заданий — у трактирщика в лагере");
    cur(iconHtml("i.potion"), d.potions, "Зелья лечения");
  }

  private renderInner(): void {
    const d = this.data;
    for (const e of this.root.querySelectorAll(":scope > .pcinv-dim, :scope > .pcinv-card")) e.remove();
    this.tabsEl.innerHTML = "";
    const tabs: [InvTab, string, number][] = [
      ["gear", "Снаряжение", 0],
      ["attrs", "Атрибуты", d?.attrs.unspent ?? 0],
      ["skills", "Умения", 0],
      ["trade", "Обмен", d?.trade?.sessions.filter((x) => x.theirs.ok && !x.mine.ok).length ?? 0],
    ];
    for (const [id, label, n] of tabs) {
      const t = div(`pcinv-tab${this.tab === id ? " on" : ""}`, label);
      // Число на вкладке — свободные очки атрибутов / обмены, ждущие моего подтверждения.
      if (n > 0) t.append(div("pcinv-badge", String(n)));
      t.onclick = () => {
        this.tab = id;
        this.lastResult = null;
        this.card = null;
        this.render();
      };
      this.tabsEl.append(t);
    }
    this.renderCurs(d);
    this.body.innerHTML = "";
    if (!d) {
      this.body.append(div("pcinv-empty", "Загрузка…"));
      return;
    }
    // Непрочитанные подарки — плашкой над любой вкладкой, пока не нажмут «Понятно».
    if (d.giftNotes?.length) {
      const g = div("pcinv-gifts");
      g.append(div("pcinv-gifts-h", `🎁 Тебе подарили${d.giftNotes.length > 1 ? ` (${d.giftNotes.length})` : ""}`));
      for (const n of d.giftNotes.slice(-6).reverse()) g.append(div("pcinv-gifts-row", `${n.from}: ${n.text}`));
      const ok = button("Понятно", () => {
        if (this.data) this.data = { ...this.data, giftNotes: [] };
        this.hooks.act({ act: "giftSeen", id: "-", idx: 0 });
        this.render();
      });
      g.append(ok);
      this.body.append(g);
    }
    if (this.tab === "gear") this.renderGear(d);
    else if (this.tab === "skills") this.renderSkills(d);
    else if (this.tab === "trade") this.renderTrade(d);
    else this.renderAttrs(d);
  }

  // ---------------- обмен между героями ----------------

  /** Ник для нового обмена (сохраняется между перерисовками). */
  private tradeNick = "";
  /** Выбранное для обмена: код предмета → сколько (оружие и кольца — 1). */
  private tradePick = new Map<string, number>();
  /** Окно, где сейчас выбирают предметы: id обмена, или null. */
  private tradeEditId: string | null = null;
  /** Открыт ли выбор предметов для нового обмена. */
  private tradeOpenPick = false;

  /** Что можно отдать: оружие не в руках и не избранное, броня не надетая, кольца в сумке, камни, лом/зелья/рыба — с иконкой. */
  private tradeable(d: PcInvData): { code: string; label: string; max: number; stack: boolean; view: TradeItemView }[] {
    const out: { code: string; label: string; max: number; stack: boolean; view: TradeItemView }[] = [];
    const eq = new Set([d.equipped.left, d.equipped.right].filter(Boolean) as string[]);
    for (const w of d.weapons) {
      if (eq.has(w.id) || w.fav) continue;
      out.push({
        code: `w:${w.id}`,
        label: w.name,
        max: 1,
        stack: false,
        view: { k: "weapon", name: w.name, n: 1, cls: w.cls, tier: w.tier },
      });
    }
    for (const a of d.armor ?? []) {
      if (d.armorWorn?.[a.part] === a.id || a.fav) continue; // надетое и ★ в обмен не идут
      out.push({ code: `a:${a.id}`, label: a.label, max: 1, stack: false, view: { k: "armor", name: a.label, n: 1, part: a.part, tier: a.tier } });
    }
    const j = d.jewels;
    if (j) {
      for (const r of j.rings) {
        if (j.ringOn.includes(r.id) || r.fav) continue; // как у оружия: надетое и ★ в обмен не идут
        out.push({ code: `r:${r.id}`, label: ringName({ tier: r.tier }), max: 1, stack: false, view: { k: "ring", name: ringName({ tier: r.tier }), n: 1, tier: r.tier, gems: r.gems } });
      }
      for (const [gk, n] of j.gems) out.push({ code: `g:${gk}`, label: gemName(gk), max: n, stack: true, view: { k: "gem", name: gemName(gk), n, key: gk } });
    }
    if (d.scrap) out.push({ code: "b:scrap", label: "Лом", max: d.scrap, stack: true, view: { k: "bag", name: "Лом", n: d.scrap, item: "scrap" } });
    if (d.potions) out.push({ code: "b:potion", label: "Зелья лечения", max: d.potions, stack: true, view: { k: "bag", name: "Зелья лечения", n: d.potions, item: "potion" } });
    if (d.fish) out.push({ code: "b:fish", label: "Рыба", max: d.fish, stack: true, view: { k: "bag", name: "Рыба", n: d.fish, item: "fish" } });
    return out;
  }

  /** Выбранное — список для сервера, только то, что ещё есть в инвентаре. */
  private pickedJson(d: PcInvData): string {
    const ok = new Set(this.tradeable(d).map((t) => t.code));
    return JSON.stringify([...this.tradePick].filter(([c]) => ok.has(c)).map(([c, n]) => ({ c, n })));
  }

  /** Иконка предмета обмена — из того же реестра значков, что и в инвентаре. */
  private tradeIcon(it: TradeItemView): HTMLDivElement {
    const box = div("pcinv-tic");
    if (it.k === "weapon") setIconEl(box, weaponIcon(it.cls ?? "sword", false, it.tier ?? "base"));
    else if (it.k === "ring") box.innerHTML = ringHtml((it.tier ?? "base") as RingTier, it.gems ?? []);
    else if (it.k === "gem") box.innerHTML = gemHtml(it.key ?? "");
    else if (it.k === "armor" && it.part) setIconEl(box, armorIconKey(it.part, it.tier));
    else box.innerHTML = iconHtml(`i.${it.item ?? "scrap"}` as Parameters<typeof iconHtml>[0]);
    return box;
  }

  /** Плитка предмета: иконка, название, число (у единичного — ×1), по желанию — кнопка убрать. */
  private tradeTile(it: TradeItemView, onRemove?: () => void): HTMLDivElement {
    const t = div("pcinv-ttile");
    t.append(this.tradeIcon(it), div("pcinv-tname2", it.name), div("pcinv-tcnt", `×${it.n}`));
    if (onRemove) {
      const x = button("×", onRemove);
      x.className = "pcinv-tx";
      x.title = "Убрать из обмена";
      t.append(x);
    }
    return t;
  }

  /** Выбор своих предметов: галочка, у стопки — число. */
  private tradePicker(d: PcInvData): HTMLDivElement {
    const box = div("pcinv-tpick");
    const items = this.tradeable(d);
    if (!items.length) box.append(div("pcinv-small", "Нечего отдать — всё надето, в избранном или пусто."));
    for (const it of items) {
      const row = div("pcinv-trow");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "pcinv-tcb";
      cb.checked = this.tradePick.has(it.code);
      cb.onchange = () => {
        if (cb.checked) this.tradePick.set(it.code, 1);
        else this.tradePick.delete(it.code);
        this.render();
      };
      row.append(cb, this.tradeIcon(it.view), div("pcinv-tname2", it.stack ? `${it.label} · есть ${it.max}` : it.label));
      if (it.stack) {
        // Количество: «−», число, «+» и «все» — крупные кнопки, чтобы попадать и пальцем.
        const on = this.tradePick.has(it.code);
        const cur = this.tradePick.get(it.code) ?? 1;
        const set = (n: number): void => {
          this.tradePick.set(it.code, Math.max(1, Math.min(it.max, n)));
          this.render();
        };
        const qty = div("pcinv-tqty");
        const minus = button("−", () => set(cur - 1));
        const plus = button("+", () => set(cur + 1));
        const all = button("все", () => set(it.max));
        minus.className = "pcinv-qbtn";
        plus.className = "pcinv-qbtn";
        all.className = "pcinv-qbtn pcinv-qall";
        minus.disabled = !on || cur <= 1;
        plus.disabled = !on || cur >= it.max;
        all.disabled = !on || cur >= it.max;
        qty.append(minus, div("pcinv-qv", on ? String(cur) : "—"), plus, all);
        row.append(qty);
      } else {
        row.append(div("pcinv-tcnt", "×1"));
      }
      box.append(row);
    }
    return box;
  }

  /** Окно обмена: карточка на каждый обмен — два столбца (отдаю / получаю), подтверждения зелёным. */
  private renderTrade(d: PcInvData): void {
    const wrap = div("pcinv-trade");
    const sessions = d.trade?.sessions ?? [];
    wrap.append(div("pcinv-sub", `Обмены · ${sessions.length}`));
    if (!sessions.length) wrap.append(div("pcinv-small", "Открытых обменов нет. Открой обмен по нику: предметы будут видны обоим, меняются, когда подтвердят оба."));
    for (const s of sessions) {
      const card = div("pcinv-tsess");
      const head = div("pcinv-trow");
      head.append(div("pcinv-tname2 pcinv-thead", `Обмен с ${s.with}`));
      head.append(
        div(`pcinv-chip${s.mine.ok ? " ok" : ""}`, s.mine.ok ? "✓ ты подтвердил" : "ты не подтвердил"),
        div(`pcinv-chip${s.theirs.ok ? " ok" : ""}`, s.theirs.ok ? `✓ ${s.with} подтвердил` : `${s.with} не подтвердил`),
      );
      card.append(head);
      const cols = div("pcinv-tcols");
      const mineCol = div(`pcinv-tcol${s.mine.ok ? " ok" : ""}`);
      mineCol.append(div("pcinv-colh", "Ты отдаёшь"));
      if (!s.mine.items.length) mineCol.append(div("pcinv-small", "пока пусто"));
      s.mine.items.forEach((it, i) => mineCol.append(this.tradeTile(it, () => this.hooks.act({ act: "tradeRemove", id: s.id, idx: i }))));
      const theirCol = div(`pcinv-tcol${s.theirs.ok ? " ok" : ""}`);
      theirCol.append(div("pcinv-colh", `${s.with} отдаёт`));
      if (!s.theirs.items.length) theirCol.append(div("pcinv-small", "пока пусто"));
      for (const it of s.theirs.items) theirCol.append(this.tradeTile(it));
      cols.append(mineCol, theirCol);
      card.append(cols);
      if (this.tradeEditId === s.id) {
        card.append(this.tradePicker(d));
        const bts = div("pcinv-tbtns");
        bts.append(
          button("Добавить выбранное", () => {
            const j = this.pickedJson(d);
            if (j === "[]") {
              this.onResult({ ok: false, text: "Выбери, что добавить." });
              return;
            }
            this.hooks.act({ act: "tradeAdd", id: s.id, idx: 0, fuel: j });
            this.tradePick.clear();
            this.tradeEditId = null;
          }),
          button("Закрыть", () => {
            this.tradePick.clear();
            this.tradeEditId = null;
            this.render();
          }),
        );
        card.append(bts);
      }
      const acts = div("pcinv-tbtns");
      if (this.tradeEditId !== s.id) {
        acts.append(
          button("＋ Добавить предметы", () => {
            this.tradeEditId = s.id;
            this.tradeOpenPick = false;
            this.tradePick.clear();
            this.render();
          }),
        );
      }
      if (!s.mine.ok) acts.append(button("Подтвердить обмен", () => this.hooks.act({ act: "tradeConfirm", id: s.id, idx: 0 })));
      acts.append(button("Отменить обмен", () => this.askConfirm(`Отменить обмен с ${s.with}? Твои предметы вернутся тебе.`, "Отменить", () => this.hooks.act({ act: "tradeCancel", id: s.id, idx: 0 }))));
      card.append(acts);
      wrap.append(card);
    }
    // Новый обмен: ник и (по желанию) свои предметы сразу.
    wrap.append(div("pcinv-sub", "Открыть обмен"));
    // Кто сейчас в игре: выбрать из списка (с кем обмен уже открыт — не предлагаем).
    const busy = new Set(sessions.map((x) => x.with));
    const online = (d.partners ?? []).filter((n) => !busy.has(n));
    {
      // Список показываем всегда: если в мире никого нет — пусто и заблокировано (чтобы было видно, что он есть).
      const sel = document.createElement("select");
      sel.className = "pcinv-select pcinv-tonline";
      sel.disabled = online.length === 0;
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = online.length ? `Кто в игре или писал за час (${online.length}) — выбрать` : "Никого нет в игре и в чате за час";
      sel.append(ph);
      for (const n of online) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        sel.append(o);
      }
      sel.value = online.includes(this.tradeNick) ? this.tradeNick : "";
      sel.onchange = () => {
        this.tradeNick = sel.value;
        this.render();
      };
      wrap.append(sel);
    }
    const nick = document.createElement("input");
    nick.className = "pcinv-input";
    nick.placeholder = "Ник героя";
    nick.maxLength = 40;
    nick.value = this.tradeNick;
    nick.oninput = () => {
      this.tradeNick = nick.value;
    };
    wrap.append(nick);
    if (this.tradeEditId === null) {
      if (!this.tradeOpenPick) {
        wrap.append(
          button("Выбрать свои предметы…", () => {
            this.tradeOpenPick = true;
            this.tradePick.clear();
            this.render();
          }),
        );
      } else {
        wrap.append(this.tradePicker(d));
      }
      wrap.append(
        button("Открыть обмен", () => {
          const to = this.tradeNick.trim();
          if (!to) {
            nick.focus();
            return;
          }
          this.hooks.act({ act: "tradeOpen", id: to, idx: 0, fuel: this.pickedJson(d) });
          this.tradePick.clear();
          this.tradeOpenPick = false;
        }),
      );
    }
    this.body.append(tabPanel("Обмен", wrap));
  }

  private weaponById(id: string | null): PcInvWeapon | null {
    return (id && this.data?.weapons.find((w) => w.id === id)) || null;
  }

  private renderGear(d: PcInvData): void {
    const page = !!this.hooks.page;
    const wrap = div("pcinv-gear");
    const byId = new Map((d.armor ?? []).map((a) => [a.id, a] as const));
    const j = this.jewelsOf(d);

    // --- герой: слева броня, справа руки и кольца; между ними — сведения (игра) или сам герой на камне (страница) ---
    const heroP = panel("pcinv-heropnl");
    const colL = div("pcinv-scol");
    for (const part of ARMOR_PARTS) colL.append(this.armorSlot(part, d, byId));
    const colR = div("pcinv-scol");
    colR.append(this.handSlot("right", d), this.handSlot("left", d), div("pcinv-slot gap"), this.ringSlot(0, d), this.ringSlot(1, d));
    const center = div("pcinv-center");
    center.append(page ? this.stage() : this.charInfo(d));
    heroP.append(colL, center, colR);
    const cardEl = this.card ? this.renderCard(d) : null;
    if (cardEl && !cardEl.classList.contains("float")) heroP.append(cardEl);
    wrap.append(heroP);

    // --- сумка: оружие, кольца и броня вместе; ★ избранное — там же, со звёздочкой (вкладка «Избранное», сортировка «★ сначала») ---
    const eq = new Set([d.equipped.left, d.equipped.right].filter(Boolean) as string[]);
    // Броня: надетые — в слотах, остальные — в сумке. Без armorAct (нет хука) — не показываем.
    const bagEntries: BagEntry[] = [
      ...d.weapons.filter((w) => !eq.has(w.id)).map((w) => ({ w })),
      ...j.rings.filter((r) => !j.ringOn.includes(r.id)).map((r) => ({ r })),
      ...(!this.hooks.armorAct ? [] : (d.armor ?? []).filter((a) => d.armorWorn?.[a.part] !== a.id)).map((a) => ({ a })),
    ];
    wrap.append(this.bagPanel(d, sortBag(bagEntries, this.bagSort, bagPickItem)));
    // Страница: сведения о герое — своей панелью (в центре стоит сам герой).
    if (page) {
      const cp = panel("pcinv-charpnl");
      cp.append(this.charInfo(d));
      wrap.append(cp);
    }
    this.body.append(wrap);
    if (cardEl?.classList.contains("float")) {
      // Затемнение закрывает карточку только по своему нажатию: клик после тапа по вещи
      // (на телефоне он попадает уже на появившееся затемнение) не должен её сразу закрывать.
      const dim = div("pcinv-dim");
      let downOnDim = false;
      dim.addEventListener("pointerdown", () => (downOnDim = true));
      dim.addEventListener("pointerup", () => {
        if (downOnDim) this.closeCard();
        downOnDim = false;
      });
      dim.addEventListener("pointercancel", () => (downOnDim = false));
      this.root.append(dim, cardEl);
    }
  }

  /** Карточка поверх экрана (телефон, узкая страница), а не между колонками слотов. */
  private cardFloats(): boolean {
    return !!this.hooks.touch || (!!this.hooks.page && window.innerWidth < 980);
  }

  /** Страница !inv: герой в полный рост (картинка облика) — стоит на камне фона. */
  private stage(): HTMLDivElement {
    const st = div("pcinv-stage");
    const img = document.createElement("img");
    img.className = "pcinv-heroimg";
    img.src = skinPicture(this.hero.skin);
    img.alt = "";
    img.draggable = false;
    st.append(div("pcinv-heroshadow"), img);
    return st;
  }

  /** Сведения о герое: ник, титул, уровень, атрибуты, характеристики, кольца. */
  private charInfo(d: PcInvData): HTMLDivElement {
    const box = div("pcinv-ci");
    if (this.hero.nick) box.append(div("pcinv-ci-nick", this.hero.nick));
    // Титул под ником — выбор из полученных.
    const sel = document.createElement("select");
    sel.className = "pcinv-select pcinv-ci-title";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = d.titles?.length ? "— без титула —" : "Титул — за большие заслуги";
    sel.append(none);
    for (const t of d.titles ?? []) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = `«${t}»`;
      sel.append(o);
    }
    sel.value = d.title ?? "";
    sel.disabled = !d.titles?.length;
    sel.onchange = () => this.hooks.act({ act: "title", id: sel.value, idx: 0 });
    box.append(sel);
    // Уровень и опыт до следующего.
    this.xpLv = div("pcinv-ci-lv");
    const xpRow = div("pcinv-xprow");
    const xp = div("pcinv-xp");
    this.xpFill = div("pcinv-xp-fill");
    xp.append(this.xpFill);
    this.xpText = div("pcinv-xp-pill");
    xpRow.append(xp, this.xpText);
    box.append(this.xpLv, xpRow);
    this.paintXp();
    // Атрибуты (с прибавкой от колец и камней): клик — вкладка «Атрибуты».
    const gemB = pcJewelBonus(d.jewels);
    const at = div("pcinv-at6");
    for (const id of A2) {
      const v = d.attrs[id] ?? 1;
      const c = div("pcinv-atc");
      c.innerHTML = `${iconHtml(`a.${id}` as IconKey)}<b>${v + gemB[id]}</b><span>${ATTR_INFO[id].short}</span>`;
      c.title = `${ATTR_INFO[id].name}: ${v}${gemB[id] ? ` +${gemB[id]} от камней` : ""} — ${attrEffect(id)}`;
      c.onclick = () => {
        this.tab = "attrs";
        this.card = null;
        this.render();
      };
      at.append(c);
    }
    box.append(at);
    if (d.attrs.unspent > 0) {
      const up = button(`＋ Свободных очков: ${d.attrs.unspent}`, () => {
        this.tab = "attrs";
        this.card = null;
        this.render();
      });
      up.className = "pcinv-btn sm green pcinv-ci-up";
      box.append(up);
    }
    box.append(div("pcinv-hh", "Характеристики"));
    const stats = div("pcinv-stats");
    this.statsBox = stats;
    this.fillStats(this.liveStats ?? d.stats);
    box.append(stats);
    // Кольца: что дают надетые.
    const b = pcJewelBonus(d.jewels);
    const parts = [`Маг. защита +${Math.round(ringResist(b.rings) * 100)}%`];
    for (const k of A2) if (b[k] > 0) parts.push(`+${b[k]} ${ATTR_INFO[k].short}`);
    box.append(
      div("pcinv-hh", "Кольца"),
      div("pcinv-small", b.rings ? parts.join(" · ") : `Ничего не надето. Кольцо даёт маг. защиту ${Math.round(RING.mres * 100)}%, камни в нём — атрибуты.`),
    );
    return box;
  }

  /** Сумка: фильтры, сортировка, сетка (оружие, кольца, броня, камни, расходники), наковальня и «разобрать всё». */
  private bagPanel(d: PcInvData, bag: BagEntry[]): HTMLDivElement {
    const p = panel("pcinv-bagpnl");
    const j = this.jewelsOf(d);
    // Для «разобрать всё»: избранное ★ не разбирается — не считаем.
    const bagW = bag.flatMap((e) => ("w" in e && !e.w.fav ? [e.w] : []));
    const bagR = bag.flatMap((e) => ("r" in e && !e.r.fav ? [e.r] : []));
    const filters = BAG_FILTERS.filter(([f]) => f !== "armor" || !!this.hooks.armorAct);
    if (!filters.some(([f]) => f === this.bagFilter)) this.bagFilter = "all";
    const f = this.bagFilter;
    const gemCount = j.gems.reduce((n, [, k]) => n + k, 0);
    const hd = div("pcinv-bagh");
    hd.append(div("pcinv-bagt", "Сумка"));
    const tabs = div("pcinv-ftabs");
    for (const [id, label] of filters) {
      // Телефон в игре: «★ Избранное» — просто «★», чтобы вкладки влезли в строку.
      const t = div(`pcinv-ftab${id === f ? " on" : ""}`, id === "fav" && this.hooks.touch && !this.hooks.page ? glyph("ui.fav") : label);
      t.onclick = () => {
        this.bagFilter = id;
        this.render();
      };
      tabs.append(t);
    }
    p.append(hd, tabs);
    // Сортировка — для предметов (оружие, кольца, броня); повторный клик — выключить.
    if (f !== "gem" && f !== "misc") {
      const sortRow = div("pcinv-sortrow");
      sortRow.append(div("pcinv-small", "Сортировка"));
      for (const so of BAG_SORTS) {
        const bt = button(so.label, () => {
          this.bagSort = nextBagSort(this.bagSort, so.mode);
          this.render();
        });
        bt.className = `pcinv-sortbtn${this.bagSort === so.mode ? " on" : ""}`;
        bt.title = so.title;
        sortRow.append(bt);
      }
      p.append(sortRow);
    }
    const cells: HTMLElement[] = [];
    const favOf = (e: BagEntry): boolean => !!("w" in e ? e.w.fav : "r" in e ? e.r.fav : e.a.fav);
    const shown = bag.filter((e) => f === "all" || (f === "fav" && favOf(e)) || (f === "weapon" && "w" in e) || (f === "ring" && "r" in e) || (f === "armor" && "a" in e));
    if (f !== "gem" && f !== "misc") for (const e of shown) cells.push(this.entryCell(e));
    if (f === "all" || f === "gem") for (const [gk, n] of j.gems) cells.push(this.gemCell(gk, n, d));
    if (f === "all" || f === "misc") cells.push(...this.consCells(d));
    // Пустые ячейки — до полной сетки (минимум несколько рядов, всегда есть свободный ряд).
    const cols = this.hooks.page ? 6 : this.hooks.touch ? 8 : 7;
    const total = Math.max(cols * (this.hooks.page ? 5 : 4), Math.ceil((cells.length + 1) / cols) * cols);
    const grid = div("pcinv-grid pcinv-bagrid");
    grid.dataset.keep = "bag";
    grid.append(...cells);
    for (let i = cells.length; i < total; i++) grid.append(div("pcinv-cell empty"));
    if (!cells.length) {
      const msg = f === "gem" ? "Камней нет — падают с мобов (1 уровня)." : f === "fav" ? "Избранного нет — отметь предмет ★ в его карточке." : f === "misc" ? "Пусто." : "Пусто — лут падает с мобов.";
      grid.prepend(div("pcinv-bagempty", msg));
    }
    // С руки в сумку — снять.
    grid.addEventListener("dragover", (e) => {
      if (this.drag?.kind === "hand") e.preventDefault();
    });
    grid.addEventListener("drop", (e) => {
      e.preventDefault();
      const src = this.drag;
      this.endDrag();
      if (src?.kind === "hand") this.hooks.toBag(this.realSide(src.side));
    });
    // Прокрутка: внизу сетки — затухание и «▼ ещё», пока ниже есть предметы.
    const wrapG = div("pcinv-bagwrap");
    const more = div("pcinv-more", "▼ ещё — прокрути");
    more.onclick = () => grid.scrollBy({ top: grid.clientHeight * 0.8, behavior: "smooth" });
    // «Ещё» — только если ниже края есть настоящие предметы (пустые ячейки не в счёт).
    const lastReal = cells.length ? cells[cells.length - 1] : null;
    const sync = (): void => {
      const below = !!lastReal && lastReal.getBoundingClientRect().bottom > grid.getBoundingClientRect().bottom + 4;
      wrapG.classList.toggle("has-more", below);
    };
    grid.addEventListener("scroll", sync, { passive: true });
    requestAnimationFrame(() => {
      // Пустые ячейки — до низа видимой области (без пробела над кнопками), не больше 12 рядов сверху.
      for (let k = 0; k < 12 && grid.clientHeight > 0 && grid.scrollHeight <= grid.clientHeight + 2; k++) {
        for (let i = 0; i < cols; i++) grid.append(div("pcinv-cell empty"));
      }
      if (grid.scrollHeight > grid.clientHeight + 2 && grid.lastElementChild && !cells.includes(grid.lastElementChild as HTMLElement)) {
        // Перебор — последний добавленный ряд пустых убираем, если он целиком ниже края.
        const gb = grid.getBoundingClientRect().bottom;
        const row = [...grid.children].slice(-cols);
        if (row.every((c) => !cells.includes(c as HTMLElement) && c.getBoundingClientRect().top > gb - 2)) row.forEach((c) => c.remove());
      }
      sync();
    });
    wrapG.append(grid, more);
    p.append(wrapG);
    // Итог — всплывашкой поверх низа сумки (не раздвигает сетку); нажатие — закрыть, иначе гаснет сама.
    if (!this.card && this.lastResult) {
      const t = div(`pcinv-result toast ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text);
      t.title = this.lastResult.text;
      t.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        this.dropBagResult();
      });
      wrapG.append(t);
    }

    // Низ: наковальня (перетащи — в лом) и общие кнопки по фильтру.
    const foot = div("pcinv-bagf");
    const anvil = div("pcinv-anvil");
    anvil.innerHTML = `${iconHtml("i.scrap")}<span>${this.hooks.touch && !this.hooks.page ? "В лом" : "Сюда — в лом"}</span>`;
    anvil.addEventListener("dragover", (e) => {
      if (this.dragWeapon() || this.dragRing() || this.dragArmor()) {
        e.preventDefault();
        anvil.classList.add("hot");
      }
    });
    anvil.addEventListener("dragleave", () => anvil.classList.remove("hot"));
    anvil.addEventListener("drop", (e) => {
      e.preventDefault();
      anvil.classList.remove("hot");
      const w = this.dragWeapon();
      const r = this.dragRing();
      const ar = this.dragArmor();
      this.endDrag();
      if (w?.fav || r?.fav || ar?.fav) this.textTip(anvil, `${glyph("ui.fav")} В избранном`, "Избранное не разбирается и не выбрасывается — сначала сними звёздочку.");
      else if (w) this.askConfirm(`Разобрать «${w.name}» на ${w.scrap} лома?`, "Разобрать", () => this.hooks.scrap(w));
      else if (r) this.askRingScrap(r);
      else if (ar) {
        if (this.data?.armorWorn?.[ar.part] === ar.id) this.textTip(anvil, "Надето", "Надетое не разбирается — сначала сними.");
        else this.askConfirm(`Разобрать «${ar.label}» на ${ar.scrap} лома?`, "Разобрать", () => this.hooks.armorAct?.(ar.id, "scrap"));
      }
    });
    foot.append(anvil);
    if (f === "ring") {
      const ringSum = bagR.reduce((n, r) => n + r.scrap, 0);
      const rall = button(`Разобрать все кольца (${bagR.length})`, () =>
        this.askConfirm(
          `Разобрать ${bagR.length} колец на ${ringSum} лома? Надетые и ★ избранные останутся. Камни из них вернутся в сумку.`,
          "Разобрать все",
          () => this.hooks.act({ act: "ringScrapAll", id: "all", idx: 0 }),
        ),
      );
      rall.className = "pcinv-btn danger";
      rall.disabled = !bagR.length;
      rall.title = `Все кольца из сумки в лом: +${ringSum}. Надетые и ★ избранные останутся, камни вернутся в сумку`;
      foot.append(rall);
    } else if (f === "gem") {
      const all = button("⬆ Соединить все камни", () => this.hooks.act({ act: "gemMergeAll", id: "all", idx: 0 }));
      all.className = "pcinv-btn green";
      all.disabled = !j.gems.some(([, n]) => n >= RING.combine);
      all.title = `Все камни по ${RING.combine} одинаковых → уровнем выше, пока есть что соединять`;
      foot.append(all);
    } else if (f === "all" || f === "weapon" || f === "armor") {
      // Разобрать всё, кроме избранного ★, рубиновых и надетого — с подтверждением (рубиновые — только поштучно, как на сервере).
      // Вкладка «Оружие» — только оружие, «Броня» — только броня, «Все» — и то и другое.
      const ws = f === "armor" ? [] : bagW.filter((w) => w.tier !== "ruby");
      const as = f === "weapon" || !this.hooks.armorAct ? [] : bag.flatMap((e) => ("a" in e && !e.a.fav ? [e.a] : []));
      // Вкладка «Все» — и кольца тоже (как «Разобрать все кольца»: надетые и ★ остаются).
      const rs = f === "all" ? bagR : [];
      const n = ws.length + as.length + rs.length;
      const scrapSum = ws.reduce((k, w) => k + w.scrap, 0) + as.reduce((k, x) => k + x.scrap, 0) + rs.reduce((k, r) => k + r.scrap, 0);
      const what = f === "weapon" ? "оружие" : f === "armor" ? "броню" : "оружие, броню и кольца";
      const all = button(f === "all" ? `Разобрать всё, кроме ${glyph("ui.fav")}` : `Разобрать ${what}, кроме ${glyph("ui.fav")}`, () =>
        this.askConfirm(
          `Разобрать ${what} — ${n} шт. на ${scrapSum} лома? Избранное ${glyph("ui.fav")}, рубиновое и надетое останутся.${rs.length ? " Камни из колец вернутся в сумку." : ""}`,
          "Разобрать",
          () => this.hooks.act({ act: "scrapAll", id: f, idx: 0 }),
        ),
      );
      all.className = "pcinv-btn";
      all.disabled = n === 0;
      all.title = `${what[0].toUpperCase()}${what.slice(1)} из сумки в лом (${n} шт., +${scrapSum}). Избранное, рубиновое и надетое останутся`;
      foot.append(all);
    } else if (f === "fav") {
      const all = button(`${glyph("ui.fav")} Избранное не разбирается`, () => {});
      all.className = "pcinv-btn";
      all.disabled = true;
      foot.append(all);
    }
    p.append(foot);
    if (!this.hooks.touch && !this.hooks.page) {
      p.append(div("pcinv-hint", "Клик — карточка · ПКМ — надеть/снять · ★ — в избранное (не разбирается и не выбрасывается) · перетащи на слот — надеть, на наковальню — в лом, за окно — выбросить"));
    }
    if (gemCount && f === "gem") p.append(div("pcinv-hint", `Соедини ${RING.combine} одинаковых — получишь камень уровнем выше. Вставить — в карточке кольца.`));
    return p;
  }

  /** Разобрать кольцо (с подтверждением; камни возвращаются в сумку). */
  private askRingScrap(r: PcInvJewels["rings"][number]): void {
    this.askConfirm(
      `Разобрать «${ringName(r)}» на ${r.scrap} лома?${r.gems.some(Boolean) ? " Камни вернутся в сумку." : ""}`,
      "Разобрать",
      () => this.hooks.act({ act: "ringScrap", id: r.id, idx: 0 }),
    );
  }

  /** Расходники в сумке: зелья, лом, рыба, жетоны, свитки. Нажатие — подарить (или прочитать свиток). */
  private consCells(d: PcInvData): HTMLDivElement[] {
    const out: HTMLDivElement[] = [];
    const info = (c: HTMLDivElement, title: string, body: string): HTMLDivElement => {
      c.addEventListener("mouseenter", () => this.textTip(c, title, body));
      c.addEventListener("mouseleave", () => this.hideTip());
      return c;
    };
    const gift = (c: HTMLDivElement, name: string, item: string, n: number): HTMLDivElement => {
      c.classList.add("click");
      c.addEventListener("click", () => this.askGift(name, `b:${item}`, n));
      return c;
    };
    if (d.potions) out.push(gift(info(countCell(iconHtml("i.potion"), d.potions), "Зелья лечения", "Пить — клавиша 3 / кнопка зелья. Лечат сразу. Нажми — подарить."), "Зелья лечения", "potion", d.potions));
    if (d.scrap) out.push(gift(info(countCell(iconHtml("i.scrap"), d.scrap), "Лом", "На заточку — в карточке предмета. Нажми — подарить."), "Лом", "scrap", d.scrap));
    if (d.fish) out.push(gift(info(countCell(iconHtml("i.fish"), d.fish), "Рыба", "Ловится на озере. Задания на рыбалку — на доске в лагере. Нажми — подарить."), "Рыба", "fish", d.fish));
    if (d.tokens) {
      const tip = "Дают за задания дня (доска и Охотник у выхода из лагеря). Тратятся у трактирщика в лагере: зелья, лом, свитки, сундук оружия.";
      const c = countCell(iconHtml("i.token"), d.tokens);
      c.classList.add("tokens", "click");
      info(c, `Жетоны заданий ${glyph("i.token")}`, tip);
      c.addEventListener("click", () => this.textTipAt(c, `Жетоны заданий ${glyph("i.token")}`, tip));
      out.push(c);
    }
    // Свитки — клик: прочитать (бафф на 15 мин).
    const scrolls: [number | undefined, "scroll_xp" | "scroll_wind", IconKey, string, string][] = [
      [d.scrollXp, "scroll_xp", "i.scroll_xp", "Свиток мудрости", "×2 опыта на 15 мин (с благословением ×3). Нажми — прочитать."],
      [d.scrollWind, "scroll_wind", "i.scroll_wind", "Свиток ветра", "+20% скорости бега на 15 мин. Нажми — прочитать."],
    ];
    for (const [n, id, ico, name, body] of scrolls) {
      if (!n) continue;
      const c = info(countCell(iconHtml(ico), n), name, body);
      c.classList.add("click");
      c.onclick = () => {
        this.hideTip();
        this.hooks.useItem?.(id);
        window.setTimeout(() => this.refresh(), 300);
      };
      out.push(c);
    }
    return out;
  }

  /** Камень в сумке: уровень и сколько; нажатие — меню (вставить в открытое кольцо, соединить, разделить, подарить). */
  private gemCell(gk: string, n: number, d: PcInvData): HTMLDivElement {
    const g = parseGem(gk)!;
    const c = div("pcinv-cell pcinv-jw");
    c.innerHTML = gemHtml(gk);
    this.gemTip(c, gk, n);
    c.append(div("pcinv-glv", String(g.lv)));
    const k = document.createElement("span");
    k.className = "pcinv-cnt";
    k.textContent = `×${n}`;
    c.append(k);
    c.onclick = () => {
      const ring = this.card?.kind === "ring" ? this.jewelsOf(d).rings.find((r) => r.id === (this.card as { id: string }).id) : undefined;
      const free = ring ? ring.gems.indexOf(null) : -1;
      const acts: [string, () => void, boolean?][] = [];
      if (ring && free >= 0) acts.push([`Вставить в ${ringName(ring).toLowerCase()}`, () => this.hooks.act({ act: "gemIn", id: ring.id, idx: free, fuel: gk })]);
      if (n >= RING.combine) acts.push([`Соединить ${RING.combine} → ${g.lv + 1} ур.`, () => this.hooks.act({ act: "gemMerge", id: gk, idx: 0 })]);
      if (g.lv > 1) acts.push([`Разделить → ${RING.combine} × ур. ${g.lv - 1}`, () => this.hooks.act({ act: "gemSplit", id: gk, idx: 0 })]);
      acts.push(["🎁 Подарить…", () => this.askGift(gemName(gk), `g:${gk}`, n)]);
      this.menu(c, `${gemName(gk)} ×${n}`, acts);
    };
    return c;
  }

  /** Слот на схеме: ячейка и подпись внутри рамки снизу. */
  private slot(cell: HTMLElement, label: string): HTMLDivElement {
    const box = div("pcinv-slot");
    box.append(cell, div("pcinv-slab", label));
    return box;
  }

  /** Что держит рука: лук/копьё/молот/посох держат обе — показываем в правом слоте, левый — «занята». */
  private handHeld(side: Side): { held: HeldInfo | null; both: HeldInfo | null } {
    const h = this.hooks.hands();
    const both = bothHandsCls(h.left?.cls) ? h.left : bothHandsCls(h.right?.cls) ? h.right : null;
    if (both) return { held: side === "right" ? both : null, both };
    return { held: h[side], both: null };
  }

  /** Рука, которая на самом деле держит то, что показано в слоте (двуручное лежит в одной из рук, а показано справа). */
  private realSide(side: Side): Side {
    const h = this.hooks.hands();
    if (bothHandsCls(h.right?.cls)) return "right";
    if (bothHandsCls(h.left?.cls)) return "left";
    return side;
  }

  /** Экземпляр со склада в руке (обычное со стойки не на складе — null). */
  private handWeapon(side: Side, d: PcInvData): PcInvWeapon | null {
    const { both } = this.handHeld(side);
    if (both) return this.weaponById(d.equipped.right ?? d.equipped.left);
    return this.weaponById(d.equipped[side]);
  }

  private handSlot(side: Side, d: PcInvData): HTMLDivElement {
    const { held, both } = this.handHeld(side);
    // Телефон в игре: слоты маленькие — подписи короче.
    const short = !!this.hooks.touch && !this.hooks.page;
    const label = side === "left" ? (short ? "Левая" : "Левая рука") : short ? "Правая" : "Правая рука";
    // Двуручное (лук, посох, копьё, молот) — в правом слоте; левый — тусклой копией с пометкой.
    if (both && side === "left") {
      const c = div("pcinv-cell big locked");
      setIcon(c, both.cls, undefined, both.tier);
      c.title = bothHandsNote(both.cls);
      // И сюда можно бросить оружие из сумки — наденется по своим правилам.
      c.addEventListener("dragover", (e) => {
        if (this.drag?.kind === "bag") e.preventDefault();
      });
      c.addEventListener("drop", (e) => {
        e.preventDefault();
        const src = this.drag;
        this.endDrag();
        const bw = src?.kind === "bag" ? this.weaponById(src.id) : null;
        if (bw) this.hooks.equip(bw, "left");
      });
      return this.slot(c, short ? "Занята" : "Левая · занята");
    }
    const w = this.handWeapon(side, d);
    const cell = div("pcinv-cell big");
    if (held && held.cls) {
      const tier = (w?.tier ?? held.tier) as WeaponTier;
      cell.classList.add(`t-${tier}`);
      if (this.card?.kind === "hand" && this.card.side === side) cell.classList.add("sel");
      setIcon(cell, held.cls, w?.name, tier);
      if (w?.affixes.length) cell.append(div("pcinv-q", qualityStarsShort(w.quality, w.affixes.length)));
      if (w && attackPoints(w) > 0) cell.append(div("pcinv-sb", `+${attackPoints(w)}`));
      if (w?.fav) cell.append(div("pcinv-fav on", glyph("ui.fav")));
      cell.draggable = true;
      cell.addEventListener("dragstart", (e) => this.startDrag(e, { kind: "hand", side }));
      this.touchSrc.set(cell, { kind: "hand", side });
      if (!this.hooks.touch) cell.addEventListener("click", () => this.openCard({ kind: "hand", side }));
      cell.addEventListener("dragend", () => this.endDrag());
      cell.addEventListener("mouseenter", () => this.showTip(cell, w, held));
      cell.addEventListener("mouseleave", () => this.hideTip());
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.hideTip();
        this.hooks.toBag(this.realSide(side));
      });
    } else {
      cell.classList.add("empty");
      cell.addEventListener("mouseenter", () => this.textTip(cell, label, "Пусто — перетащи оружие из сумки или нажми на него и «Надеть»"));
      cell.addEventListener("mouseleave", () => this.hideTip());
    }
    // Из сумки на руку — надеть.
    cell.addEventListener("dragover", (e) => {
      if (this.drag?.kind === "bag") {
        e.preventDefault();
        cell.classList.add("hot");
      }
    });
    cell.addEventListener("dragleave", () => cell.classList.remove("hot"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("hot");
      const src = this.drag;
      this.endDrag();
      const bw = src?.kind === "bag" ? this.weaponById(src.id) : null;
      if (bw) this.hooks.equip(bw, side);
    });
    return this.slot(cell, label);
  }

  /** Слот кольца: надетое кольцо (клик — карточка с гнёздами) или пусто; сюда же бросают кольцо из сумки. */
  private ringSlot(slot: 0 | 1, d: PcInvData): HTMLDivElement {
    const j = this.jewelsOf(d);
    const id = j.ringOn[slot];
    const r = id ? j.rings.find((x) => x.id === id) ?? null : null;
    const c = div(`pcinv-cell big pcinv-jw${r ? ` t-${r.tier}` : " empty"}${r && this.card?.kind === "ring" && this.card.id === r.id ? " sel" : ""}`);
    c.innerHTML = r ? ringHtml(r.tier, r.gems) : RING_SLOT_SVG;
    if (r) {
      this.ringTip(c, r);
      if (r.fav) c.append(div("pcinv-fav on", glyph("ui.fav")));
      this.touchSrc.set(c, { kind: "ring", id: r.id });
      if (!this.hooks.touch) c.addEventListener("click", () => this.openCard({ kind: "ring", id: r.id }));
      // ПКМ по надетому кольцу — снять.
      c.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.hideTip();
        this.hooks.act({ act: "ringOff", id: "-", idx: slot });
      });
    } else {
      c.addEventListener("click", () => this.textTipAt(c, `Слот кольца ${slot + 1}`, "Пусто — надень кольцо из сумки (перетащи сюда или нажми на кольцо)."));
    }
    // Кольцо из сумки — надеть в этот слот.
    c.addEventListener("dragover", (e) => {
      if (this.dragRing()) {
        e.preventDefault();
        c.classList.add("hot");
      }
    });
    c.addEventListener("dragleave", () => c.classList.remove("hot"));
    c.addEventListener("drop", (e) => {
      e.preventDefault();
      c.classList.remove("hot");
      const rr = this.dragRing();
      this.endDrag();
      if (rr && !j.ringOn.includes(rr.id)) this.hooks.act({ act: "ringOn", id: rr.id, idx: slot });
    });
    return this.slot(c, "Кольцо");
  }

  /** Звёздочка «избранное» в углу ячейки: ★ — в избранном; пустая ☆ — при наведении (ПК), клик — переключить. */
  private favStar(fav: boolean, toggle: () => void): HTMLDivElement {
    const s = div(`pcinv-fav${fav ? " on" : ""}`, glyph(fav ? "ui.fav" : "ui.favOff"));
    s.title = fav ? "В избранном (не разбирается) — убрать" : "В избранное";
    if (this.hooks.touch) {
      s.style.pointerEvents = "none";
      return s;
    }
    s.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggle();
    });
    // Не начинать перетаскивание/меню с самой звёздочки.
    s.addEventListener("mousedown", (e) => e.stopPropagation());
    return s;
  }

  private toggleFav(w: PcInvWeapon): void {
    this.hideTip();
    this.hooks.act({ act: "fav", id: w.id, idx: 0 });
  }

  /** ★ у брони: тот же общий лимит (FAV_MAX), не разбирается и не передаётся. */
  private toggleArmorFav(id: string): void {
    this.hideTip();
    this.hooks.armorAct?.(id, "fav");
  }

  /** ★ у кольца: тот же общий лимит, что у оружия (FAV_MAX), не разбирается. */
  private toggleRingFav(id: string): void {
    this.hideTip();
    this.hooks.act({ act: "ringFav", id, idx: 0 });
  }

  private itemCell(w: PcInvWeapon): HTMLDivElement {
    const c = div(`pcinv-cell t-${w.tier}${this.card?.kind === "bag" && this.card.id === w.id ? " sel" : ""}`);
    setIcon(c, w.cls, w.name, w.tier);
    c.style.position = "relative";
    if (w.affixes.length) c.append(div("pcinv-q", qualityStarsShort(w.quality, w.affixes.length)));
    if (attackPoints(w) > 0) c.append(div("pcinv-sb", `+${attackPoints(w)}`));
    // Телефон: невидимая пустая звёздочка ловила бы случайные тапы — там только ★ у избранного, переключение — в меню.
    if (!this.hooks.touch || w.fav) c.append(this.favStar(!!w.fav, () => this.toggleFav(w)));
    // ПК (страница и игра): клик — карточка, как тап на телефоне; правый клик — надеть.
    if (!this.hooks.touch) c.addEventListener("click", () => this.openCard({ kind: "bag", id: w.id }));
    c.draggable = true;
    c.addEventListener("dragstart", (e) => this.startDrag(e, { kind: "bag", id: w.id }));
    this.touchSrc.set(c, { kind: "bag", id: w.id });
    c.addEventListener("dragend", () => this.endDrag());
    c.addEventListener("mouseenter", () => this.showTip(c, w, null));
    c.addEventListener("mouseleave", () => this.hideTip());
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.hideTip();
      this.hooks.equip(w, this.smartSide(w));
    });
    return c;
  }

  /** Карточка предмета: голова (значок, имя, тир, атака), заточка роллов и точки атаки, действия. */
  private renderCard(d: PcInvData): HTMLDivElement | null {
    const src = this.card;
    if (!src) return null;
    const el = panel(`pcinv-card${this.cardFloats() ? " float" : ""}`);
    const head = div("pcinv-card-head");
    const body = div("pcinv-card-body");
    body.dataset.keep = "card";
    const acts = div("pcinv-card-acts");
    const ok =
      src.kind === "ring"
        ? this.ringCard(d, src.id, head, body, acts)
        : src.kind === "armor"
          ? this.armorCard(d, src.id, head, body, acts)
          : this.weaponCard(d, src, head, body, acts);
    if (!ok) return null;
    const x = button("✕", () => this.closeCard());
    x.className = "pcinv-card-x";
    x.title = "Закрыть (Esc)";
    el.append(div("pcinv-grab"), x, head, body, acts);
    return el;
  }

  /** Голова карточки: значок в рамке тира, имя, подпись (HTML из чисел и констант), метка и строки ниже. */
  private cardHead(head: HTMLElement, ico: HTMLElement, name: string, nameCls: string, subHtml: string, tag: string, extra: HTMLElement[] = []): void {
    const info = div("pcinv-card-info");
    const sub = div("pcinv-card-sub");
    sub.innerHTML = subHtml;
    if (tag) sub.append(div("pcinv-tag", tag));
    info.append(div(`pcinv-card-name ${nameCls}`, name), sub, ...extra);
    // Молот — три удара, пока ждём итог заточки.
    if (this.forging) ico.append(div("pcinv-hammer forging", glyph("ui.forge")));
    head.append(ico, info);
  }

  /** Строки заточки: ролл, очки из максимума, полоса и кнопка «лом · шанс» (или MAX). */
  private enchRows(body: HTMLElement, id: string, rows: readonly PcEnchRow[], texts: readonly string[], scrap: number): void {
    rows.forEach((a, i) => {
      const row = div("pcinv-erow");
      const lab = div("pcinv-elabel");
      lab.append(span(texts[i] ?? a.label), span(`${a.points} / ${a.of}`));
      const bar = div("pcinv-ebar");
      const fill = div("pcinv-efill");
      fill.style.width = `${Math.round((a.points / a.of) * 100)}%`;
      bar.append(fill);
      const b = document.createElement("button");
      b.className = "pcinv-btn sm pcinv-forge";
      if (a.max) {
        b.textContent = "MAX";
        b.disabled = true;
        b.classList.add("max");
      } else {
        const ch = Math.round(a.chance * 100);
        b.innerHTML = `${iconHtml("i.scrap")}<span>${a.cost} · ${ch}%</span>`;
        b.title = `Заточить: ${a.cost} лома, шанс ${ch}%. При неудаче лом сгорает`;
        b.disabled = scrap < a.cost || this.forging;
        b.onclick = () => this.forge(id, i);
      }
      row.append(lab, b, bar);
      body.append(row);
    });
  }

  /** Итог последнего действия (заточка, камни…) — строкой в карточке. */
  private resultLine(body: HTMLElement): void {
    if (this.lastResult) body.append(div(`pcinv-result ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text));
  }

  /** Кнопка действия карточки; close — сначала закрыть карточку (предмет уходит из этого места). */
  private cardBtn(acts: HTMLElement, label: string, fn: () => void, cls = "", close = false): void {
    const b = button(label, () => {
      if (close) this.closeCard();
      fn();
    });
    b.className = `pcinv-btn sm${cls ? ` ${cls}` : ""}`;
    acts.append(b);
  }

  private weaponCard(d: PcInvData, src: DragSrc, head: HTMLElement, body: HTMLElement, acts: HTMLElement): boolean {
    const side = src.kind === "hand" ? src.side : null;
    const held = side ? this.handHeld(side).held : null;
    const w = src.kind === "bag" ? this.weaponById(src.id) : side ? this.handWeapon(side, d) : null;
    if (!w && !held?.cls) return false;
    const cls = (w?.cls ?? held?.cls ?? "sword") as WeaponClass;
    const tier = (w?.tier ?? held?.tier ?? "base") as WeaponTier;
    const name = w?.name ?? weaponDef(cls, tier).name;
    const inHand = !!side || (!!w && (d.equipped.left === w.id || d.equipped.right === w.id));
    const ico = div(`pcinv-cell huge t-${tier}`);
    setIcon(ico, cls, name, tier);
    if (w && attackPoints(w) > 0) ico.append(div("pcinv-sb", `+${attackPoints(w)}`));
    const q = w?.affixes.length ? qualityStarsShort(w.quality, w.affixes.length) : "";
    const extra: HTMLElement[] = [];
    const atk = attackLabel(cls, tier, w ? sharpPctOf(w) : 0);
    if (atk) extra.push(div("pcinv-tipatk", atk));
    for (const e of w?.effects ?? []) extra.push(div("pcinv-tipeff", e));
    this.cardHead(head, ico, name, `t-${tier}`, `${cap(TIER_LOOK[tier].name)}${q ? ` · оценка <b>${q}</b>` : ""}`, inHand ? "в руке" : "", extra);

    if (w?.ench.length) this.enchRows(body, w.id, w.ench, w.affixes, d.scrap);
    else body.append(div("pcinv-small", w ? "Роллов нет — точить нечего." : "Обычное оружие со стойки — без роллов, точить нечего."));
    this.resultLine(body);
    if (w && attackPointEligible(w)) body.append(this.sharpBlock(w, d));
    if (w?.ench.length) {
      body.append(
        div(
          "pcinv-hint",
          "Чем ближе ролл к максимуму и чем лучше предмет — тем дороже и меньше шанс. При неудаче лом сгорает." + (w.tier === "ruby" ? " Рубиновое — цена в ломе ×100." : ""),
        ),
      );
    }

    if (src.kind === "bag" && w) {
      // Меч/кинжал — парное оружие: можно выбрать руку (второй — к такому же в правой).
      const pair = (w.cls === "sword" || w.cls === "dagger") && this.hooks.hands().right?.cls === w.cls;
      if (pair) {
        this.cardBtn(acts, "В правую руку", () => this.hooks.equip(w, "right"), "gold", true);
        this.cardBtn(acts, "В левую руку", () => this.hooks.equip(w, "left"), "gold", true);
      } else this.cardBtn(acts, "Надеть", () => this.hooks.equip(w, naturalSide(w.cls)), "gold", true);
    }
    if (side) this.cardBtn(acts, "Снять", () => this.hooks.toBag(this.realSide(side)), "gold", true);
    if (w) this.cardBtn(acts, w.fav ? `${glyph("ui.favOff")} Из избранного` : `${glyph("ui.fav")} В избранное`, () => this.toggleFav(w));
    if (w && src.kind === "bag") this.cardBtn(acts, "Подарить", () => this.askGift(w.name, `w:${w.id}`, 1));
    if (w && !w.fav) this.cardBtn(acts, `В лом +${w.scrap}`, () => this.askConfirm(`Разобрать «${w.name}» на ${w.scrap} лома?`, "Разобрать", () => this.hooks.scrap(w)), "danger");
    if (w && !w.fav) this.cardBtn(acts, "Выбросить", () => this.askConfirm(`Выбросить «${w.name}» на землю?`, "Выбросить", () => this.hooks.drop(w)), "danger");
    return true;
  }

  private armorCard(d: PcInvData, id: string, head: HTMLElement, body: HTMLElement, acts: HTMLElement): boolean {
    const a = (d.armor ?? []).find((x) => x.id === id);
    if (!a) return false;
    const worn = d.armorWorn?.[a.part] === a.id;
    const ico = div(`pcinv-cell huge t-${a.tier}`);
    setIconEl(ico, armorIconKey(a.part, a.tier));
    this.cardHead(head, ico, ARMOR_PART_NAME[a.part], `t-${a.tier}`, `Броня · оценка <b>${qualityStarsShort(a.pts, a.rolls)}</b>`, worn ? "надета" : "", [div("pcinv-tipaff", a.label)]);
    this.enchRows(body, a.id, a.ench, a.ench.map((r) => r.label), d.scrap);
    this.resultLine(body);
    body.append(div("pcinv-hint", "Чем ближе стат к максимуму — тем дороже и меньше шанс. При неудаче лом сгорает. Надетую броню можно точить на месте."));
    if (!this.hooks.armorAct) return true;
    const act = (x: "wear" | "unwear" | "scrap" | "drop" | "fav"): void => this.hooks.armorAct?.(a.id, x);
    if (worn) {
      this.cardBtn(acts, "Снять", () => act("unwear"), "gold", true);
      this.cardBtn(acts, a.fav ? `${glyph("ui.favOff")} Из избранного` : `${glyph("ui.fav")} В избранное`, () => this.toggleArmorFav(a.id));
    } else {
      this.cardBtn(acts, "Надеть", () => act("wear"), "gold", true);
      this.cardBtn(acts, a.fav ? `${glyph("ui.favOff")} Из избранного` : `${glyph("ui.fav")} В избранное`, () => this.toggleArmorFav(a.id));
      this.cardBtn(acts, "Подарить", () => this.askGift(a.label, `a:${a.id}`, 1));
      if (!a.fav) this.cardBtn(acts, `В лом +${a.scrap}`, () => this.askConfirm(`Разобрать «${a.label}» на ${a.scrap} лома?`, "Разобрать", () => act("scrap")), "danger");
      if (!a.fav) this.cardBtn(acts, "Выбросить", () => this.askConfirm(`Выбросить «${a.label}» на землю?`, "Выбросить", () => act("drop")), "danger");
    }
    return true;
  }

  /** Кольцо: что даёт, гнёзда (вынуть камень за лом, вставить — нажатием на камень), надеть/снять. */
  private ringCard(d: PcInvData, id: string, head: HTMLElement, body: HTMLElement, acts: HTMLElement): boolean {
    const j = this.jewelsOf(d);
    const r = j.rings.find((x) => x.id === id);
    if (!r) return false;
    const slot = j.ringOn.indexOf(r.id);
    const ico = div(`pcinv-cell huge pcinv-jw t-${r.tier}`);
    ico.innerHTML = ringHtml(r.tier, r.gems);
    const bonus = [...ringBonusText({ id: "", tier: r.tier, gems: r.gems })].map((t) => div("pcinv-tipaff", t));
    this.cardHead(head, ico, ringName(r), `t-${r.tier}`, r.gems.length ? `Кольцо · гнёзд ${r.gems.length}` : "Кольцо без гнёзд", slot >= 0 ? `надето · слот ${slot + 1}` : "", bonus);

    if (r.gems.length) {
      body.append(div("pcinv-hh", `Гнёзда · ${r.gems.filter(Boolean).length} / ${r.gems.length}`));
      r.gems.forEach((gk, i) => {
        const row = div("pcinv-sock");
        const gi = div(`pcinv-cell pcinv-jw${gk ? "" : " empty"}`);
        if (gk) {
          gi.innerHTML = gemHtml(gk);
          this.gemTip(gi, gk);
        }
        row.append(gi);
        if (gk) {
          const g = parseGem(gk)!;
          const cost = RING.unsocketPerLv * g.lv;
          row.append(div("pcinv-sock-t", `${gemName(gk)} · +${g.lv} ${ATTR_INFO[g.attr].short}`));
          const bt = button(`Вынуть −${cost}`, () => this.hooks.act({ act: "gemOut", id: r.id, idx: i }));
          bt.className = "pcinv-btn sm";
          bt.title = `Вынуть камень в сумку: ${cost} лома`;
          bt.disabled = d.scrap < cost;
          row.append(bt);
        } else row.append(div("pcinv-sock-t dim", `Гнездо ${i + 1} пусто`));
        body.append(row);
      });
      const free = r.gems.indexOf(null);
      if (free >= 0 && j.gems.length) {
        body.append(div("pcinv-small", "Вставить камень — нажми на него:"));
        const pick = div("pcinv-gempick");
        for (const [gk, n] of j.gems) {
          const c = div("pcinv-cell pcinv-jw click");
          c.innerHTML = gemHtml(gk);
          c.append(div("pcinv-glv", String(parseGem(gk)?.lv ?? "")));
          const k = document.createElement("span");
          k.className = "pcinv-cnt";
          k.textContent = `×${n}`;
          c.append(k);
          this.gemTip(c, gk, n);
          c.onclick = () => this.hooks.act({ act: "gemIn", id: r.id, idx: free, fuel: gk });
          pick.append(c);
        }
        body.append(pick);
      } else if (free >= 0) body.append(div("pcinv-small", "Камней нет — падают с мобов (1 уровня)."));
    } else body.append(div("pcinv-small", "Без гнёзд — камни в него не вставляются."));
    this.resultLine(body);

    if (slot >= 0) this.cardBtn(acts, "Снять", () => this.hooks.act({ act: "ringOff", id: "-", idx: slot }), "gold", true);
    else {
      const freeSlot = j.ringOn.findIndex((x) => !x);
      if (freeSlot >= 0) this.cardBtn(acts, "Надеть", () => this.hooks.act({ act: "ringOn", id: r.id, idx: freeSlot }), "gold", true);
      else {
        this.cardBtn(acts, "Вместо кольца 1", () => this.hooks.act({ act: "ringOn", id: r.id, idx: 0 }), "gold", true);
        this.cardBtn(acts, "Вместо кольца 2", () => this.hooks.act({ act: "ringOn", id: r.id, idx: 1 }), "gold", true);
      }
    }
    this.cardBtn(acts, r.fav ? `${glyph("ui.favOff")} Из избранного` : `${glyph("ui.fav")} В избранное`, () => this.toggleRingFav(r.id));
    if (slot < 0) {
      this.cardBtn(acts, "Подарить", () => this.askGift(ringLabelOf(r), `r:${r.id}`, 1));
      if (!r.fav) this.cardBtn(acts, `В лом +${r.scrap}`, () => this.askRingScrap(r), "danger");
    }
    return true;
  }

  /** Точка атаки за лом (уникальное и рубиновое): сколько уже даёт и что будет дальше. */
  private sharpBlock(w: PcInvWeapon, d: PcInvData): HTMLDivElement {
    const box = div("pcinv-ap");
    const n = attackPoints(w);
    const next = attackPointNext(w);
    const txt = div("pcinv-ap-t");
    txt.append(div("pcinv-ap-name", `Точка атаки · ${n}`), div("pcinv-small", `+${fmtPct(attackPointBonus(n) * 100)}% урона${next ? ` · след. +${fmtPct(next.gain * 100, 2)}%` : ""}`));
    box.append(txt);
    if (next) {
      const bt = document.createElement("button");
      bt.className = "pcinv-btn sm pcinv-forge";
      bt.innerHTML = `${iconHtml("i.scrap")}<span>${next.cost} · ${fmtPct(next.chance * 100)}%</span>`;
      bt.title = `Точить: ${next.cost} лома, шанс ${fmtPct(next.chance * 100)}%`;
      bt.disabled = d.scrap < next.cost || this.forging;
      bt.onclick = () => {
        this.hooks.act({ act: "sharpen", id: w.id, idx: 0 });
        window.setTimeout(() => this.refresh(), 300);
      };
      box.append(bt);
    }
    return box;
  }

  private forge(id: string, idx: number): void {
    if (this.forging) return;
    this.forging = true;
    this.hammerDone = false;
    this.pendingResult = null;
    this.lastResult = null;
    this.render();
    this.hooks.act(this.data?.armor?.some((x) => x.id === id) ? { act: "armorEnchant", id, idx } : { act: "enchant", id, idx });
    // Три удара молотом — пусть напряжение настоится, потом итог.
    window.setTimeout(() => {
      this.hammerDone = true;
      if (this.pendingResult) this.reveal();
    }, 1100);
  }

  private reveal(): void {
    const r = this.pendingResult;
    this.pendingResult = null;
    this.forging = false;
    if (r) {
      const e = r.enchant;
      this.lastResult = {
        up: !!e?.up,
        text: e ? (e.up ? `Успех! ${e.label}: +${e.gain} очк.` : `Неудача — ${e.cost} лома сгорело`) : r.text,
      };
    }
    this.render();
  }

  /** Вкладка «Умения»: класс по оружию в руках и выбор любых двух из разрешённых. */
  private renderSkills(d: PcInvData): void {
    const wrap = div("pcinv-attrs");
    const cls = (d.skills?.cls ?? "") as ClassId | "";
    if (!cls) {
      wrap.append(div("pcinv-tabtop", "Возьми оружие — умения зависят от класса"));
      this.body.append(tabPanel("Умения", wrap));
      return;
    }
    const def = CLASSES2[cls];
    const head = div("pcinv-tabtop");
    head.append(
      div("pcinv-pts on", `${def.icon} ${def.name} — ${def.role}`),
      div("pcinv-small", `Оружие: ${def.weapons}. Выбери любые два умения — клавиши 2 и 3 (телефон — кнопки ✦, VR — стики).`),
    );
    if (d.strike !== undefined) head.append(div("pcinv-small", `Сила удара: ${d.strike} — от оружия в руке, статов и роллов урона`));
    wrap.append(head);
    const chosen = new Set(d.skills?.chosen ?? []);
    // Откат и бонусы — как у сервера: атрибуты героя + прибавка от колец и камней.
    const live = { ...d.attrs, gb: d.gb };
    for (const id of def.skills) {
      const on = chosen.has(id);
      const row = div(`pcinv-arow pcinv-skill${on ? " on" : ""}`);
      const ic = div("pcinv-aic");
      ic.innerHTML = iconHtml(skillIcon(id));
      const txt = div("pcinv-atxt");
      const nm = div("pcinv-aname", skillName(id, cls));
      nm.append(div("pcinv-chip", `откат ${skillCooldownFor(id, cls, live)} с`));
      if (on) nm.append(div("pcinv-chip ok", "✓ выбрано"));
      txt.append(
        nm,
        div("pcinv-small", skillDesc(id, cls, live)),
        // Урон умения — уже посчитанный от силы удара героя (те же формулы, что у сервера).
        ...(() => {
          const t = d.strike !== undefined ? skillDamageText(id, cls, d.strike, live) : null;
          return t ? [div("pcinv-small dim", t)] : [];
        })(),
      );
      const b = document.createElement("button");
      b.className = "pcinv-abtn";
      b.textContent = on ? "✓" : "Выбрать";
      b.title = on ? "Выбрано" : "Выбрать (заменит более старое)";
      b.disabled = on;
      b.onclick = () => {
        if (on) return;
        // Новое — вместо первого из выбранных (держим ровно два).
        const next = [...(d.skills?.chosen ?? []), id].slice(-2);
        this.hooks.act({ act: "skills", id: next.join(","), idx: 0 });
      };
      row.append(ic, txt, b);
      wrap.append(row);
    }
    if (this.lastResult) wrap.append(div(`pcinv-result ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text));
    this.body.append(tabPanel("Умения", wrap));
  }

  // ---------------- кольца и камни (shared/jewels.ts) ----------------

  /** Сортировка сумки (оружие, кольца, броня): none — как пришло. */
  private bagSort: BagSort = "none";

  /** Подсказка при наведении на кольцо: тир, гнёзда, что даёт, лом за разбор. */
  private ringTip(c: HTMLElement, r: { tier: RingTier; gems: (string | null)[]; scrap?: number; fav?: boolean }): void {
    const inst = { id: "", tier: r.tier, gems: r.gems };
    const lines = [...ringBonusText(inst)];
    lines.push(r.gems.length ? `Гнёзд: ${r.gems.length} (занято ${r.gems.filter(Boolean).length})` : "Без гнёзд");
    if (r.fav) lines.push(`${glyph("ui.fav")} В избранном — не разбирается`);
    else if (r.scrap) lines.push(`В лом: +${r.scrap}`);
    c.addEventListener("mouseenter", () => this.textTip(c, ringLabelOf(r), lines.join(" · ")));
    c.addEventListener("mouseleave", () => this.hideTip());
  }

  /** Кольцо в сумке или в ряду ★: клик/тап — карточка, тащить — на слот, в лом или в избранное, звёздочка переключает. */
  private bagRingCell(r: PcInvJewels["rings"][number]): HTMLDivElement {
    const c = div(`pcinv-cell pcinv-jw t-${r.tier}${this.card?.kind === "ring" && this.card.id === r.id ? " sel" : ""}`);
    c.innerHTML = ringHtml(r.tier, r.gems);
    this.ringTip(c, r);
    // Как у оружия: телефон — пустую ☆ не показываем (ловила бы тапы), ★ у избранного видна.
    if (!this.hooks.touch || r.fav) c.append(this.favStar(!!r.fav, () => this.toggleRingFav(r.id)));
    c.draggable = true;
    c.addEventListener("dragstart", (e) => this.startDrag(e, { kind: "ring", id: r.id }));
    c.addEventListener("dragend", () => this.endDrag());
    this.touchSrc.set(c, { kind: "ring", id: r.id });
    // ПКМ — надеть в первый свободный слот; оба заняты — карточка (там выбор, какое заменить).
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.hideTip();
      const on: (string | null)[] = this.data ? this.jewelsOf(this.data).ringOn : [null, null];
      const free = on.findIndex((x) => !x);
      if (free >= 0) this.hooks.act({ act: "ringOn", id: r.id, idx: free });
      else this.openCard({ kind: "ring", id: r.id });
    });
    if (!this.hooks.touch) c.addEventListener("click", () => this.openCard({ kind: "ring", id: r.id }));
    return c;
  }

  /** Подсказка при наведении на камень: что даёт, сколько есть, как соединить. */
  private gemTip(c: HTMLElement, gk: string, n = 0): void {
    const g = parseGem(gk);
    if (!g) return;
    const lines = [`+${g.lv} ${ATTR_SHORT[g.attr]} — в надетом кольце`];
    if (n) lines.push(`В мешочке: ${n}`, n >= RING.combine ? `Можно соединить ${RING.combine} → ${g.lv + 1} ур.` : `Соединить: нужно ${RING.combine} одинаковых`);
    else lines.push(`Вынуть: −${RING.unsocketPerLv * g.lv} лома`);
    c.addEventListener("mouseenter", () => this.textTip(c, gemName(gk), lines.join(" · ")));
    c.addEventListener("mouseleave", () => this.hideTip());
  }

  /** Меню действий у ячейки (кольца/камни): заголовок и кнопки; danger — красная. */
  private menu(anchor: HTMLElement, title: string, items: readonly (readonly [string, () => void, boolean?])[]): void {
    void anchor;
    this.hideTip();
    this.confirmEl?.remove();
    const box = div("pcinv-confirm pcinv-actions");
    box.append(div("pcinv-confirm-text", title));
    const row = div("pcinv-confirm-row col");
    const close = (): void => {
      box.remove();
      this.confirmEl = null;
    };
    for (const [label, fn, danger] of items) {
      const b = button(label, () => {
        close();
        fn();
      });
      if (danger) b.classList.add("danger");
      row.append(b);
    }
    row.append(button("Отмена", close));
    box.append(row);
    this.root.append(box);
    this.confirmEl = box;
  }

  private textTipAt(anchor: HTMLElement, title: string, body: string): void {
    this.tipAllowed = true;
    this.textTip(anchor, title, body);
    this.tipAllowed = false;
  }

  private renderAttrs(d: PcInvData): void {
    const a = d.attrs;
    const gemB = pcJewelBonus(d.jewels);
    const wrap = div("pcinv-attrs");
    const head = div("pcinv-tabtop");
    head.append(div(`pcinv-pts${a.unspent > 0 ? " on" : ""}`, a.unspent > 0 ? `Свободных очков: ${a.unspent}` : "Свободных очков нет — их дают за уровень"), div("pcinv-small", costRule()));
    wrap.append(head);
    for (const at of ATTRS) {
      const row = div("pcinv-arow");
      const v = a[at.id] ?? 1;
      const cost = stepCost(v);
      // Сколько стоят следующие 5 подъёмов (цена может вырасти на середине).
      let cost5 = 0;
      for (let i = 0; i < 5; i++) cost5 += stepCost(v + i);
      const gemAdd = gemB[at.id];
      const ic = div("pcinv-aic");
      ic.innerHTML = iconHtml(`a.${at.id}` as IconKey);
      const txt = div("pcinv-atxt");
      const nameEl = div("pcinv-aname", at.name);
      nameEl.style.color = ATTR_LOOK[at.id].c; // цвет атрибута — один на всю игру (look.ts)
      txt.append(nameEl, div("pcinv-small", `${at.hint} · следующий подъём — ${cost} оч.`));
      const val = div("pcinv-aval");
      val.append(span(String(v)));
      if (gemAdd > 0) {
        const g = div("pcinv-gemadd", `+${gemAdd}`);
        g.title = "от камней в кольцах";
        val.append(g);
      }
      const b1 = document.createElement("button");
      b1.className = "pcinv-abtn";
      b1.textContent = "+1";
      b1.title = `${cost} оч.`;
      b1.disabled = a.unspent < cost;
      b1.onclick = () => this.hooks.act({ act: "stat", id: at.id, idx: 1 });
      const b5 = document.createElement("button");
      b5.className = "pcinv-abtn";
      b5.textContent = "+5";
      b5.title = `${cost5} оч.`;
      b5.disabled = a.unspent < cost5;
      b5.onclick = () => this.hooks.act({ act: "stat", id: at.id, idx: 5 });
      row.append(ic, txt, val, b1, b5);
      wrap.append(row);
    }
    const cost = d.respecCost;
    // cost < 0 — сброс атрибутов выключен на сервере.
    if (cost >= 0) {
      const rb = document.createElement("button");
      rb.className = "pcinv-respec";
      rb.textContent = cost === 0 ? "Сбросить атрибуты — бесплатно" : `Сбросить атрибуты — ${cost} ◈ (у тебя ${d.tokens ?? 0})`;
      rb.disabled = cost > (d.tokens ?? 0);
      rb.onclick = () =>
        this.askConfirm("Сбросить все вложенные очки атрибутов? Их можно будет распределить заново.", "Сбросить", () =>
          this.hooks.act({ act: "respec", id: "respec", idx: 0 }),
        );
      wrap.append(rb);
    }
    if (this.lastResult) wrap.append(div(`pcinv-result ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text));
    this.body.append(tabPanel("Атрибуты", wrap));
  }

  // ---------------- перетаскивание / подсказки / подтверждение ----------------

  private startDrag(e: DragEvent, src: DragSrc): void {
    this.drag = src;
    this.hideTip();
    e.dataTransfer?.setData("text/plain", "pcinv");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    // Ловушку «бросили мимо окна» показываем тиком позже: правка DOM прямо в
    // dragstart иногда отменяет перетаскивание в Chrome.
    window.setTimeout(() => {
      if (this.drag && !this.hooks.page) this.dropCatcher.style.display = "block";
    }, 0);
  }

  private endDrag(): void {
    this.drag = null;
    this.dropCatcher.style.display = "none";
  }

  /** Перетаскиваемое кольцо (из сумки или из ★) — иначе null. */
  /** Перетаскиваемая броня из данных окна (нет — null). */
  private dragArmor(): PcInvArmor | null {
    const s = this.drag;
    if (s?.kind !== "armor") return null;
    return this.data?.armor?.find((a) => a.id === s.id) ?? null;
  }

  private dragRing(): PcInvJewels["rings"][number] | null {
    const s = this.drag;
    if (s?.kind !== "ring") return null;
    return this.data?.jewels?.rings.find((r) => r.id === s.id) ?? null;
  }

  /** Кольца и камни из данных окна (без них — пусто). */
  private jewelsOf(d: PcInvData): PcInvJewels {
    return d.jewels ?? { rings: [], ringOn: [null, null], gems: [] };
  }

  /** Ячейка предмета сумки: оружие или кольцо. */
  private entryCell(e: BagEntry): HTMLDivElement {
    if ("a" in e) return this.armorCell(e.a);
    return "w" in e ? this.itemCell(e.w) : this.bagRingCell(e.r);
  }

  /** Броня в сумке: значок части и значение стата. Клик — меню, перетащить — на слот, ПКМ — надеть. */
  private armorCell(a: PcInvArmor): HTMLDivElement {
    const c = div(`pcinv-cell t-${a.tier}${this.card?.kind === "armor" && this.card.id === a.id ? " sel" : ""}`);
    setIconEl(c, armorIconKey(a.part, a.tier));
    c.append(div("pcinv-q", qualityStarsShort(a.pts, a.rolls)));
    // Как у оружия и колец: ★ видна у избранного; на телефоне пустую не показываем.
    if (!this.hooks.touch || a.fav) c.append(this.favStar(!!a.fav, () => this.toggleArmorFav(a.id)));
    if (!this.hooks.touch) c.addEventListener("click", () => this.openCard({ kind: "armor", id: a.id }));
    c.draggable = true;
    c.addEventListener("dragstart", (e) => this.startDrag(e, { kind: "armor", id: a.id }));
    this.touchSrc.set(c, { kind: "armor", id: a.id });
    c.addEventListener("dragend", () => this.endDrag());
    c.addEventListener("mouseenter", () => this.textTip(c, a.label, `Надевается в слот: ${ARMOR_PART_NAME[a.part]}`, a.tier));
    c.addEventListener("mouseleave", () => this.hideTip());
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.hideTip();
      this.hooks.armorAct?.(a.id, "wear");
    });
    return c;
  }

  /**
   * Слот брони на схеме: надетая часть или пустой слот этой части (пустой — тусклая иконка части).
   * Клик/тап — действия, перетащить, ПКМ — надеть или снять. На странице !inv — то же (armorAct подключён в inv/main.ts).
   */
  private armorSlot(part: ArmorPart, d: PcInvData, byId: Map<string, PcInvArmor>): HTMLDivElement {
    const interactive = !!this.hooks.armorAct;
    const id = d.armorWorn?.[part];
    const a = id ? byId.get(id) : undefined;
    const c = div(a ? `pcinv-cell big t-${a.tier}${this.card?.kind === "armor" && this.card.id === a.id ? " sel" : ""}` : "pcinv-cell big locked");
    setIconEl(c, armorIconKey(part, a?.tier));
    if (a) {
      c.append(div("pcinv-q", qualityStarsShort(a.pts, a.rolls)));
      if (a.fav) c.append(div("pcinv-fav on", glyph("ui.fav")));
      c.addEventListener("mouseenter", () =>
        this.textTip(c, a.label, interactive ? `Надета: ${ARMOR_PART_NAME[part]}. Клик — карточка (заточка, снять)` : `Надета: ${ARMOR_PART_NAME[part]}`, a.tier),
      );
      c.addEventListener("mouseleave", () => this.hideTip());
      if (interactive) {
        c.draggable = true;
        c.addEventListener("dragstart", (e) => this.startDrag(e, { kind: "armor", id: a.id }));
        this.touchSrc.set(c, { kind: "armor", id: a.id });
        c.addEventListener("dragend", () => this.endDrag());
        if (!this.hooks.touch) c.addEventListener("click", () => this.openCard({ kind: "armor", id: a.id }));
        c.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          this.hideTip();
          this.hooks.armorAct?.(a.id, "unwear");
        });
      }
    } else if (interactive) {
      c.addEventListener("mouseenter", () => this.textTip(c, ARMOR_PART_NAME[part], "Пусто — перетащи сюда часть этой же части из сумки"));
      c.addEventListener("mouseleave", () => this.hideTip());
    }
    if (interactive) {
      // Из сумки — надеть: только предмет этой части.
      c.addEventListener("dragover", (e) => {
        if (this.drag?.kind === "armor" && byId.get(this.drag.id)?.part === part) {
          e.preventDefault();
          c.classList.add("hot");
        }
      });
      c.addEventListener("dragleave", () => c.classList.remove("hot"));
      c.addEventListener("drop", (e) => {
        e.preventDefault();
        c.classList.remove("hot");
        const src = this.drag;
        this.endDrag();
        if (src?.kind === "armor" && byId.get(src.id)?.part === part) this.hooks.armorAct?.(src.id, "wear");
      });
    }
    return this.slot(c, ARMOR_PART_NAME[part]);
  }

  /** Перетаскиваемое оружие со склада (обычное с руки на склад не попадает — null). */
  private dragWeapon(): PcInvWeapon | null {
    const s = this.drag;
    if (!s || !this.data || s.kind === "ring" || s.kind === "armor") return null;
    if (s.kind === "bag") return this.weaponById(s.id);
    const eq = this.data.equipped;
    const other = this.weaponById(eq[s.side === "left" ? "right" : "left"]);
    return this.weaponById(eq[s.side]) ?? (bothHandsCls(other?.cls) ? other : null);
  }

  /**
   * Рука для «надеть одним действием» (ПКМ): второй меч/кинжал — в левую, если
   * в правой уже такой же, а в левой нет; иначе — естественная рука вида.
   */
  private smartSide(w: PcInvWeapon): Side {
    const h = this.hooks.hands();
    if ((w.cls === "sword" || w.cls === "dagger") && h.right?.cls === w.cls && h.left?.cls !== w.cls) return "left";
    return naturalSide(w.cls);
  }

  /** Телефон: подсказка оружия только из меню действий (иначе тап по ячейке закрывал экран всплывашкой). */
  private tipAllowed = false;

  private showTip(anchor: HTMLElement, w: PcInvWeapon | null, held: HeldInfo | null): void {
    if (this.hooks.touch && !this.tipAllowed) return;
    const cls = (w?.cls ?? held?.cls ?? "") as WeaponClass;
    const tier = (w?.tier ?? held?.tier ?? "base") as WeaponTier;
    if (!cls) return;
    const name = w?.name ?? weaponDef(cls, tier).name;
    this.tip.innerHTML = "";
    this.tip.append(div(`pcinv-name t-${tier}`, name));
    this.tip.append(div("pcinv-small", TIER_LOOK[tier]?.name ?? tier));
    const atk = attackLabel(cls, tier, w ? sharpPctOf(w) : 0);
    if (atk) this.tip.append(div("pcinv-tipatk", atk));
    if (w && w.affixes.length) {
      const sc = div("pcinv-score");
      sc.innerHTML = `<small>оценка </small>${qualityStarsShort(w.quality, w.affixes.length)}`;
      this.tip.append(sc);
    }
    for (const e of w?.effects ?? []) this.tip.append(div("pcinv-tipeff", e));
    for (const a of w?.affixes ?? []) this.tip.append(div("pcinv-tipaff", a));
    if (w) this.tip.append(div("pcinv-small", w.fav ? `${glyph("ui.fav")} В избранном — не разбирается` : `В лом: ${w.scrap}`));
    this.tip.append(div("pcinv-small dim", held ? "ПКМ — снять в сумку" : "ПКМ — надеть · перетащи — действия"));
    const r = anchor.getBoundingClientRect();
    this.tip.style.display = "block";
    const tw = this.tip.offsetWidth;
    const left = r.right + 8 + tw > window.innerWidth ? r.left - tw - 8 : r.right + 8;
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${Math.max(4, Math.min(window.innerHeight - this.tip.offsetHeight - 4, r.top))}px`;
  }

  /** Простая подсказка (название + текст) у ячейки — сразу, без задержки браузерного title. */
  /** Подсказка с заголовком; `tier` — цвет заголовка по тиру (как у оружия). */
  private textTip(anchor: HTMLElement, title: string, body: string, tier?: string): void {
    this.tip.innerHTML = "";
    this.tip.append(div(`pcinv-name${tier ? ` t-${tier}` : ""}`, title), div("pcinv-small", body));
    const r = anchor.getBoundingClientRect();
    this.tip.style.display = "block";
    const tw = this.tip.offsetWidth;
    const left = r.right + 8 + tw > window.innerWidth ? r.left - tw - 8 : r.right + 8;
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${Math.max(4, Math.min(window.innerHeight - this.tip.offsetHeight - 4, r.top))}px`;
  }

  private hideTip(): void {
    this.tip.style.display = "none";
  }

  /** Подарок: ник получателя (и сколько — для камней/лома/зелий), предмет уходит сразу. */
  private askGift(name: string, code: string, max: number): void {
    this.hideTip();
    this.confirmEl?.remove();
    const box = div("pcinv-confirm");
    box.append(div("pcinv-confirm-text", `🎁 Подарить: ${name}`));
    const nick = document.createElement("input");
    nick.className = "pcinv-input";
    nick.placeholder = "Ник получателя";
    nick.maxLength = 40;
    box.append(nick);
    let cnt: HTMLInputElement | null = null;
    if (max > 1) {
      cnt = document.createElement("input");
      cnt.className = "pcinv-input";
      cnt.type = "number";
      cnt.min = "1";
      cnt.max = String(max);
      cnt.value = "1";
      box.append(div("pcinv-small", `Сколько (есть ${max})`), cnt);
    }
    box.append(div("pcinv-small", "Предмет сразу уйдёт получателю — даже если его нет в игре. Вернуть нельзя."));
    const row = div("pcinv-confirm-row");
    const close = (): void => {
      box.remove();
      this.confirmEl = null;
    };
    const send = button("Подарить", () => {
      const to = nick.value.trim();
      if (!to) {
        nick.focus();
        return;
      }
      const n = cnt ? Math.max(1, Math.min(max, Math.floor(Number(cnt.value) || 1))) : 1;
      close();
      this.hooks.act({ act: "gift", id: code, idx: n, fuel: to });
    });
    send.classList.add("danger");
    row.append(send, button("Отмена", close));
    box.append(row);
    // Клавиши игры (WASD и т.п.) не должны срабатывать, пока печатаешь ник.
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") send.click();
      if (e.key === "Escape") close();
    });
    // В корень, как у подтверждения: окно под transform центрировало бы подарок по себе, а не по экрану.
    this.root.append(box);
    this.confirmEl = box;
    setTimeout(() => nick.focus(), 0);
  }

  private askConfirm(text: string, yes: string, fn: () => void): void {
    this.confirmEl?.remove();
    const box = div("pcinv-confirm");
    box.append(div("pcinv-confirm-text", text));
    const row = div("pcinv-confirm-row");
    const y = document.createElement("button");
    y.className = "pcinv-ebtn danger";
    y.textContent = yes;
    y.onclick = () => {
      box.remove();
      this.confirmEl = null;
      fn();
    };
    const n = document.createElement("button");
    n.className = "pcinv-ebtn";
    n.textContent = "Отмена";
    n.onclick = () => {
      box.remove();
      this.confirmEl = null;
    };
    row.append(y, n);
    box.append(row);
    // В корень, а не в окно: у .pcinv-win есть transform, и fixed-подтверждение центровалось бы по окну, а не по экрану.
    this.root.append(box);
    this.confirmEl = box;
  }

  dispose(): void {
    this.root.remove();
  }
}

function naturalSide(cls: string): Side {
  return cls === "shield" ? "left" : "right";
}

function div(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  if (text) d.textContent = text;
  return d;
}

function button(label: string, fn: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "pcinv-ebtn";
  b.textContent = label;
  b.onclick = fn;
  return b;
}

/** Кольцо одной строкой (тир и камни) — для заголовков меню. */
function ringLabelOf(r: { tier: RingTier; gems: (string | null)[] }): string {
  return ringLabel({ id: "", tier: r.tier, gems: r.gems });
}

function span(text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

/** Ячейка расходника: значок (HTML) и сколько. */
function countCell(icoHtml: string, n: number): HTMLDivElement {
  const c = div("pcinv-cell t-base");
  c.innerHTML = icoHtml;
  const k = document.createElement("span");
  k.className = "pcinv-cnt";
  k.textContent = String(n);
  c.append(k);
  return c;
}

/** Панель в стиле окна: срезанные углы и филигрань (рамка и заливка — ::before/::after в CSS). */
function panel(cls: string): HTMLDivElement {
  const p = div(`pcinv-pnl ${cls}`);
  for (const k of ["tl", "tr", "bl", "br"]) p.append(div(`pcinv-orn ${k}`));
  return p;
}

/** Вкладка (атрибуты, умения, обмен) — в панели окна с заголовком. */
function tabPanel(title: string, content: HTMLElement): HTMLDivElement {
  const p = panel("pcinv-tabpnl");
  p.append(div("pcinv-tabh", title), content);
  return p;
}

/** Один и тот же предмет (карточка ↔ ячейка). */
function sameSrc(a: DragSrc, b: DragSrc): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "hand" ? a.side === (b as { side: Side }).side : a.id === (b as { id: string }).id;
}

/** «уникальное» → «Уникальное». */
function cap(t: string): string {
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Срезанные углы (рамки панелей, ячеек, слотов): k — размер среза. */
const CUT = (k: string): string =>
  `polygon(${k} 0,calc(100% - ${k}) 0,100% ${k},100% calc(100% - ${k}),calc(100% - ${k}) 100%,${k} 100%,0 calc(100% - ${k}),0 ${k})`;
/** Кнопка с острыми боками. */
const HEX = (k: string): string => `polygon(${k} 0,calc(100% - ${k}) 0,100% 50%,calc(100% - ${k}) 100%,${k} 100%,0 50%)`;
/** Филигрань угла панели (левый верхний; остальные — отражением). */
/** Сколько висит всплывашка итога в сумке, мс. */
const RESULT_TOAST_MS = 4000;

const ORN_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26" fill="none" stroke-linecap="round">` +
  // тонкая вторая линия вдоль среза угла (внутри рамки) и маленький завиток — как в референсе, без навязчивости
  `<path d="M4.5 18.5 L18.5 4.5" stroke="#c3d0e0" stroke-width=".85" opacity=".55"/>` +
  `<path d="M9 21 C9.3 17.2 11.6 13.4 16.2 11.6 C18 11 19.3 11.9 18.9 13 C18.6 13.9 17.5 13.9 17.3 13.2" stroke="#a9bbd0" stroke-width=".75" opacity=".5"/></svg>`;

let styled = false;
function injectInvStyle(): void {
  if (styled) return;
  styled = true;
  ensureIconCss();
  const orn = `url("data:image/svg+xml,${encodeURIComponent(ORN_SVG)}")`;
  // Рамка тира ячейки: светлая кромка сверху → цвет тира (look.ts), заливка — фон тира к тёмному.
  const tier = (t: string): string =>
    `.pcinv-cell.t-${t} { --e:linear-gradient(180deg,color-mix(in srgb,var(--tier-${t}-edge) 55%,#fff),var(--tier-${t}-edge));` +
    ` --f:radial-gradient(ellipse 80% 75% at 50% 40%,var(--tier-${t}-bg) 0%,color-mix(in srgb,var(--tier-${t}-bg) 35%,#000) 85%); }`;
  const s = document.createElement("style");
  s.textContent = `
.pcinv-root { position:fixed; inset:0; z-index:40; pointer-events:none; font:500 13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif; color:#e8eef6;
  --line:#22354f; --muted:#9eabbb; --text2:#b8c3cf; --blue:#3cb2f2; -webkit-font-smoothing:antialiased; }
.pcinv-root * { box-sizing:border-box; }
.pcinv-catch { position:absolute; inset:0; display:none; pointer-events:auto; }

/* ---------- окно ---------- */
.pcinv-win { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(1064px,98vw); max-height:94vh; overflow:auto;
  pointer-events:auto; background:linear-gradient(180deg,rgba(6,14,26,.8),rgba(3,8,16,.84)); border:1px solid #33465f;
  box-shadow:0 0 0 1px rgba(0,0,0,.6),0 18px 60px rgba(0,0,0,.6); user-select:none; -webkit-user-select:none; scrollbar-width:thin; scrollbar-color:#2c3e57 transparent; }
.pcinv-head { position:sticky; top:0; z-index:6; display:flex; align-items:stretch; gap:6px; height:46px; padding:0 4px 0 12px; cursor:move;
  background:linear-gradient(180deg,rgba(14,28,46,.98),rgba(8,18,32,.98)); border-bottom:1px solid var(--line); }
.pcinv-tabs { display:flex; gap:2px; flex:1; min-width:0; }
.pcinv-tab { position:relative; display:flex; align-items:center; gap:7px; padding:0 18px; font-size:14.5px; color:#a7b3c3; cursor:pointer; white-space:nowrap; }
.pcinv-tab:hover { color:#dbe6f2; }
.pcinv-tab.on { color:#fff; font-weight:600;
  background:radial-gradient(ellipse 58% 95% at 50% 100%,rgba(28,150,230,.62) 0%,rgba(16,104,180,.32) 38%,rgba(8,60,110,.08) 70%,transparent 82%); }
.pcinv-tab.on::after { content:""; position:absolute; left:4px; right:4px; bottom:-1px; height:2.5px; border-radius:2px;
  background:linear-gradient(90deg,rgba(60,170,240,0),#3cb2f2 16%,#bff3ff 44%,#fff 50%,#bff3ff 56%,#3cb2f2 84%,rgba(60,170,240,0));
  box-shadow:0 0 6px #39b0f5,0 0 14px rgba(57,176,245,.7); }
.pcinv-tab.on::before { content:""; position:absolute; left:50%; bottom:0; width:12px; height:5px; transform:translateX(-50%);
  background:radial-gradient(ellipse at 50% 100%,#fff 0%,rgba(255,255,255,.6) 35%,transparent 70%); }
.pcinv-badge { display:inline-grid; place-items:center; min-width:18px; height:18px; padding:0 5px; border-radius:9px; background:#2b6b3b; color:#d2f7d6; font:700 11px/1 system-ui; }
.pcinv-curs { display:flex; align-items:center; gap:16px; padding:0 10px; }
.pcinv-curnick { display:flex; align-items:center; gap:8px; margin-right:6px; font:700 17px/1 "Iowan Old Style",Georgia,serif; color:#dbe8f6; white-space:nowrap; max-width:240px; }
.pcinv-curnick > span { overflow:hidden; text-overflow:ellipsis; }
.pcinv-curnick .gico { width:22px; height:22px; padding:3px; color:#9fc3ea; border:1px solid #3b5272; border-radius:50%; background:#0a1626; box-sizing:border-box; }
.pcinv-cur { display:flex; align-items:center; gap:6px; font:600 13px/1 system-ui; color:#e8eef6; font-variant-numeric:tabular-nums; cursor:default; }
.pcinv-cur .gico { width:18px; height:18px; vertical-align:middle; }
.pcinv-cur .gico-e { width:auto; height:auto; font-size:15px; color:#e8c26a; }
.pcinv-x { width:44px; flex:none; background:none; border:none; border-left:1px solid var(--line); color:#c9d5e3; font-size:16px; cursor:pointer; }
.pcinv-x:hover { color:#fff; }
.pcinv-body { padding:12px; }
.pcinv-empty { padding:24px; text-align:center; color:var(--muted); }

/* ---------- панели: срезанные углы и филигрань ---------- */
.pcinv-pnl { position:relative; isolation:isolate; --c:14px; padding:16px 18px; min-width:0; }
.pcinv-pnl::before, .pcinv-pnl::after { content:""; position:absolute; z-index:-1; pointer-events:none; clip-path:${CUT("var(--c)")}; }
.pcinv-pnl::before { inset:0; background:linear-gradient(180deg,#6e8098,#3b4a5e 40%,#2c394a); }
.pcinv-pnl::after { inset:1.2px; background:linear-gradient(180deg,rgba(7,19,34,.8),rgba(3,11,21,.84)); }
.pcinv-pnl.hot::before { background:linear-gradient(180deg,#ffe29a,#c99a2e); }
.pcinv-orn { position:absolute; width:26px; height:26px; pointer-events:none; background:${orn} no-repeat center/contain; z-index:2; }
.pcinv-orn.tl { left:-1px; top:-1px; } .pcinv-orn.tr { right:-1px; top:-1px; transform:scaleX(-1); }
.pcinv-orn.bl { left:-1px; bottom:-1px; transform:scaleY(-1); } .pcinv-orn.br { right:-1px; bottom:-1px; transform:scale(-1,-1); }

/* ---------- ячейки: рамка тира со срезанными углами (::before — кромка, ::after — заливка) ---------- */
.pcinv-cell { position:relative; isolation:isolate; width:var(--cw,50px); height:var(--cw,50px); flex:none; display:flex; align-items:center; justify-content:center;
  font-size:calc(var(--cw,50px) * .5); --k:6px; --e:linear-gradient(180deg,#56677d,#2f3c4d); --f:radial-gradient(ellipse 80% 75% at 50% 40%,#15233a 0%,#0a1322 75%); }
.pcinv-cell::before, .pcinv-cell::after { content:""; position:absolute; z-index:-1; pointer-events:none; clip-path:${CUT("var(--k)")}; }
.pcinv-cell::before { inset:0; background:var(--e); }
.pcinv-cell::after { inset:var(--bw,1.2px); background:var(--f); }
.pcinv-cell > .gico { width:84%; height:84%; filter:drop-shadow(0 2px 3px rgba(0,0,0,.7)); }
.pcinv-cell > img.gico-gear { width:96%; height:96%; }
.pcinv-cell > .gico-e { width:auto; height:auto; }
.pcinv-cell[draggable="true"], .pcinv-cell.click, .pcinv-cell.pcinv-jw { cursor:pointer; }
.pcinv-cell.t-base { --e:linear-gradient(180deg,#7a8ca3,#3e4c60); }
${["gold", "legendary", "ruby"].map(tier).join("\n")}
.pcinv-cell.empty { --e:#1c2a3c; --f:linear-gradient(180deg,#08111e,#060d18); color:#2b3e58; }
.pcinv-cell.locked > * { opacity:.16; filter:grayscale(1) brightness(1.6); }
.pcinv-cell.sel { --e:linear-gradient(180deg,#e8fbff,#7fd2ff 40%,#2f8fe0); --bw:2px; filter:drop-shadow(0 0 4px rgba(70,180,255,.95)) drop-shadow(0 0 10px rgba(40,140,240,.5)); }
.pcinv-cell.hot { --e:linear-gradient(180deg,#d9ffd6,#58c46a); --bw:2px; }
.pcinv-cell.big { --k:8px; }
.pcinv-cell.huge { width:88px; height:88px; --k:10px; --bw:1.5px; }
.pcinv-cell.huge > .gico { width:86%; height:86%; }
.pcinv-jw { padding:5px; }
.pcinv-jw > svg { width:100%; height:100%; display:block; }
/* Значок кольца/камня — квадрат по ширине ячейки: у ячеек с aspect-ratio высота 100% не считается, и картинка сплющивалась. */
.pcinv-jw > span[style*="display:block"] { width:100% !important; height:auto !important; aspect-ratio:1 / 1; }
.pcinv-q { position:absolute; left:7px; top:5px; font:800 10.5px/1 system-ui; color:var(--quality); text-shadow:0 1px 2px #000,0 0 3px #000; pointer-events:none; z-index:1; }
.pcinv-sb { position:absolute; right:7px; top:5px; font:800 10.5px/1 system-ui; color:#fff; text-shadow:0 1px 2px #000,0 0 3px #000; pointer-events:none; z-index:1; }
.pcinv-cnt { position:absolute; right:5px; bottom:3px; font:700 11px/1 system-ui; color:#f3f6fa; text-shadow:0 1px 2px #000,0 0 3px #000; pointer-events:none; z-index:1; }
.pcinv-glv { position:absolute; left:5px; top:3px; font:800 10.5px/1 system-ui; color:#fff; text-shadow:0 1px 2px #000; z-index:1; }
.pcinv-fav { position:absolute; right:4px; bottom:2px; font:700 12px/1 system-ui; color:#ffd166; text-shadow:0 1px 2px #000; cursor:pointer; opacity:0; z-index:1; }
.pcinv-fav.on { opacity:1; }
.pcinv-cell:hover .pcinv-fav { opacity:1; }
.pcinv-cell.big .pcinv-fav { pointer-events:none; }
.pcinv-cell.tokens .gico-e { font-size:22px; color:#e8c26a; }

/* ---------- «Снаряжение»: раскладка ---------- */
.pcinv-gear { display:grid; gap:12px; align-items:start; grid-template-columns:auto minmax(0,1fr); grid-template-areas:"hero bag"; }
.pcinv-heropnl { grid-area:hero; } .pcinv-bagpnl { grid-area:bag; } .pcinv-charpnl { grid-area:char; }
.pcinv-heropnl { --sw:78px; --sh:88px; --gap:8px; --cwid:330px; display:flex; gap:12px; padding:16px; }
.pcinv-scol { display:flex; flex-direction:column; gap:var(--gap); flex:none; }
.pcinv-slot { position:relative; width:var(--sw); height:var(--sh); flex:none; }
.pcinv-slot.gap { visibility:hidden; }
.pcinv-slot > .pcinv-cell { width:100%; height:100%; align-items:flex-start; padding-top:5%; font-size:calc(var(--sw) * .5); }
.pcinv-slot > .pcinv-cell > .gico { width:70%; height:70%; }
.pcinv-slot > .pcinv-cell > img.gico-gear { width:80%; height:76%; }
.pcinv-slot > .pcinv-jw { padding:8% 14% 26%; }
.pcinv-slab { position:absolute; left:1.2px; right:1.2px; bottom:1.2px; height:22px; display:grid; place-items:center; font-size:12px; color:#cfd9e5;
  background:linear-gradient(180deg,rgba(4,10,19,.55),rgba(4,10,19,.95)); border-top:1px solid rgba(110,135,170,.25); pointer-events:none;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,7px 100%,0 calc(100% - 7px)); white-space:nowrap; overflow:hidden; }
.pcinv-center { position:relative; width:var(--cwid); flex:none; height:calc(var(--sh) * 5 + var(--gap) * 4); overflow-y:auto; scrollbar-width:thin; scrollbar-color:#2c3e57 transparent; }

/* сведения о герое */
.pcinv-ci { display:flex; flex-direction:column; gap:6px; padding:2px 4px; }
.pcinv-ci-nick { font:700 24px/1.1 "Iowan Old Style",Georgia,serif; color:#dbe8f6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pcinv-ci-title { align-self:flex-start; max-width:100%; }
.pcinv-ci-lv { margin-top:2px; font-size:14px; color:#e5ecf4; }
.pcinv-xprow { position:relative; display:flex; align-items:center; height:20px; }
.pcinv-xp { position:relative; flex:1; min-width:40px; height:6px; border-radius:4px; background:#0d1a2b; box-shadow:inset 0 1px 2px rgba(0,0,0,.6); margin-right:-10px; overflow:hidden; }
.pcinv-xp-fill { position:absolute; left:0; top:0; bottom:0; width:0; border-radius:4px; background:linear-gradient(90deg,#1f7fe0,#47b3ff); box-shadow:0 0 8px rgba(60,160,255,.8); }
.pcinv-xp-pill { position:relative; z-index:1; height:20px; padding:0 9px; border-radius:10px; background:#08121f; border:1px solid #2a3b52; display:flex; align-items:center;
  font-size:11.5px; color:#e5ecf4; font-variant-numeric:tabular-nums; white-space:nowrap; }
.pcinv-at6 { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; margin-top:4px; }
.pcinv-atc { position:relative; isolation:isolate; display:flex; align-items:center; gap:5px; height:30px; padding:0 7px; cursor:pointer; }
.pcinv-atc::before { content:""; position:absolute; inset:0; z-index:-1; background:#0a1626; border:1px solid #233650; clip-path:${CUT("5px")}; }
.pcinv-atc:hover::before { border-color:#3d7fc0; }
.pcinv-atc .gico { width:18px; height:18px; flex:none; }
.pcinv-atc b { font:700 13px/1 system-ui; color:#f1f5fa; }
.pcinv-atc span { font:600 9.5px/1 system-ui; color:#8796aa; letter-spacing:.05em; }
.pcinv-ci-up { align-self:stretch; }
.pcinv-hh { margin-top:6px; font:700 14.5px/1.2 system-ui; color:#eaf0f7; }
.pcinv-stats { display:flex; flex-direction:column; }
.pcinv-row { display:flex; align-items:center; gap:8px; min-height:21px; font-size:12.5px; color:var(--text2); }
.pcinv-row > span:last-child { margin-left:auto; color:#f2f6fa; text-align:right; font-variant-numeric:tabular-nums; }
.pcinv-row-ic { width:15px; height:15px; flex:none; color:#c7d5e6; display:flex; }
.pcinv-row-ic .gico { width:15px; height:15px; }

/* избранное */

/* сумка */
.pcinv-bagpnl { --cw:50px; display:flex; flex-direction:column; align-self:stretch; contain:size; } /* высота — по левой колонке, сетка прокручивается */
.pcinv-bagh { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.pcinv-bagt { font:600 20px/1 system-ui; color:#eef3f8; }
.pcinv-ftabs { display:flex; height:36px; margin:0 0 9px; border-bottom:1px solid #1d2d43; }
.pcinv-ftab { position:relative; flex:1 1 auto; display:flex; align-items:center; justify-content:center; padding:0 3px; font-size:13px; color:#a7b3c3; cursor:pointer; white-space:nowrap; }
.pcinv-ftab:hover { color:#dbe6f2; }
.pcinv-ftab.on { color:#fff; font-weight:600; background:radial-gradient(ellipse 75% 120% at 50% 100%,rgba(28,150,230,.6) 0%,rgba(16,104,180,.3) 42%,transparent 85%); }
.pcinv-ftab.on::after { content:""; position:absolute; left:10%; right:10%; bottom:-1px; height:2px; border-radius:2px;
  background:linear-gradient(90deg,rgba(60,170,240,0),#3cb2f2 20%,#fff 50%,#3cb2f2 80%,rgba(60,170,240,0)); box-shadow:0 0 6px #39b0f5; }
.pcinv-sortrow { display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:9px; }
.pcinv-sortrow > .pcinv-small { margin-right:2px; }
.pcinv-sortbtn { padding:4px 10px; border:1px solid #26384f; border-radius:3px; color:#b6c2d1; background:rgba(9,20,35,.8); font:600 12px system-ui; cursor:pointer; white-space:nowrap; }
.pcinv-sortbtn.on { border-color:#3d7fc0; color:#e8f3ff; background:rgba(20,52,90,.7); }
.pcinv-grid { display:grid; grid-template-columns:repeat(var(--cols,7),var(--cw)); gap:6px; justify-content:space-between; }
.pcinv-bagrid { position:relative; flex:1 1 0; min-height:0; align-content:start; overflow-y:auto; padding:1px; scrollbar-width:thin; scrollbar-color:#2c3e57 transparent; }
/* Ячейки растягиваются на ширину колонки — без широких зазоров между значками. */
.pcinv-bagrid { grid-template-columns:repeat(var(--cols,7),minmax(0,1fr)); justify-content:stretch; }
.pcinv-bagrid > .pcinv-cell { width:100%; height:auto; aspect-ratio:1 / 1; }
.pcinv-slot .pcinv-q { left:10px; top:7px; } .pcinv-slot .pcinv-sb { right:10px; top:7px; }
/* ★ у надетого — справа внизу над подписью слота. */
.pcinv-slot .pcinv-fav { right:7px; bottom:calc(var(--labh,22px) + 4px); font-size:13px; }
.pcinv-btn:disabled, .pcinv-ebtn:disabled { opacity:.32; filter:grayscale(1); }
.pcinv-bagwrap { position:relative; flex:1 1 0; min-height:0; display:flex; flex-direction:column; }
.pcinv-bagwrap > .pcinv-bagrid { flex:1 1 0; min-height:0; max-height:none; }
.pcinv-bagwrap.has-more > .pcinv-bagrid { -webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 46px),rgba(0,0,0,.25)); mask-image:linear-gradient(180deg,#000 calc(100% - 46px),rgba(0,0,0,.25)); }
.pcinv-more { position:absolute; left:50%; bottom:4px; transform:translateX(-50%); display:none; padding:3px 12px; font:600 11.5px/1.3 system-ui; color:#dff2ff;
  background:rgba(20,52,90,.92); border:1px solid #3d7fc0; border-radius:10px; cursor:pointer; z-index:3; white-space:nowrap; box-shadow:0 0 10px rgba(40,140,240,.35); }
.pcinv-bagwrap.has-more > .pcinv-more { display:block; }
.pcinv-bagrid { scrollbar-color:#4a6a92 transparent; }
.pcinv-bagempty { position:absolute; left:0; right:0; top:14px; text-align:center; color:var(--muted); font-size:12.5px; pointer-events:none; z-index:2; }
.pcinv-bagf { display:flex; gap:10px; margin-top:12px; }
.pcinv-anvil { flex:0 0 132px; min-height:36px; display:flex; align-items:center; justify-content:center; gap:8px; border:1px dashed #33465f; color:#97a6b9;
  font-size:12.5px; background:rgba(6,14,26,.5); }
.pcinv-anvil .gico { width:17px; height:17px; }
.pcinv-anvil.hot { border-color:#ff7a5a; color:#ffb49a; background:rgba(255,122,90,.08); }
.pcinv-bagf .pcinv-btn { flex:1; }
.pcinv-hint { color:#6f7f95; font-size:11.5px; margin-top:9px; line-height:1.4; }
.pcinv-result { margin-top:9px; padding:7px 10px; font-size:12.5px; border:1px solid; }
.pcinv-result.up { color:#a9f0b4; background:rgba(40,110,60,.18); border-color:rgba(90,190,120,.3); }
.pcinv-result.down { color:#ffb0a6; background:rgba(140,40,40,.18); border-color:rgba(220,90,80,.3); }
.pcinv-result.toast { position:absolute; left:8px; right:8px; bottom:8px; margin:0; z-index:6; cursor:pointer; line-height:1.35; max-height:calc(3 * 1.35em + 14px); overflow:hidden; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; box-shadow:0 4px 14px rgba(0,0,0,.45); animation:pcinvToast .18s ease-out; }
.pcinv-result.toast.up { background:rgba(22,46,30,.96); }
.pcinv-result.toast.down { background:rgba(54,22,22,.96); }
@keyframes pcinvToast { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }

/* ---------- карточка предмета ---------- */
.pcinv-card { position:absolute; z-index:5; top:12px; bottom:12px; left:calc(16px + var(--sw) + 6px); right:calc(16px + var(--sw) + 6px);
  display:grid; grid-template-rows:auto minmax(0,1fr) auto; grid-template-areas:"head" "body" "acts"; padding:16px 16px 14px; pointer-events:auto;
  filter:drop-shadow(0 10px 24px rgba(0,0,0,.55)); }
.pcinv-card-x { position:absolute; right:18px; top:12px; width:26px; height:26px; display:grid; place-items:center; color:#9fb0c4; font-size:13px; background:rgba(4,10,19,.7);
  border:1px solid #2d405a; border-radius:3px; cursor:pointer; z-index:3; }
.pcinv-card-x:hover { color:#fff; border-color:#4a6a92; }
.pcinv-grab { display:none; }
.pcinv-card-head { grid-area:head; display:flex; align-items:center; gap:12px; padding:0 30px 10px 0; border-bottom:1px solid #1a2b42; }
.pcinv-card-head > .pcinv-cell.huge { width:72px; height:72px; }
.pcinv-card-info { display:flex; flex-direction:column; align-items:flex-start; gap:3px; min-width:0; }
.pcinv-card-name { font:700 20px/1.15 "Iowan Old Style",Georgia,serif; color:#e6edf6; }
.pcinv-card-name.t-gold { color:var(--tier-gold); } .pcinv-card-name.t-legendary { color:var(--tier-legendary); } .pcinv-card-name.t-ruby { color:var(--tier-ruby); }
.pcinv-card-sub { font-size:12.5px; color:#9aa8ba; display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; }
.pcinv-card-sub b { color:var(--quality); }
.pcinv-tag { display:inline-block; font:700 10.5px/1 system-ui; color:#0e1a10; background:#8fd18f; border-radius:3px; padding:3px 6px; }
.pcinv-card-body { grid-area:body; overflow-y:auto; padding:2px 2px 4px; scrollbar-width:thin; scrollbar-color:#2c3e57 transparent; }
.pcinv-card-acts { grid-area:acts; display:grid; grid-template-columns:1fr 1fr; gap:7px 10px; padding-top:10px; }
.pcinv-card-acts .pcinv-btn { letter-spacing:.03em; white-space:nowrap; padding:5px 10px; }
.pcinv-tipatk { color:var(--attack); font:700 13px system-ui; }
.pcinv-tipeff { color:#f0d68a; font-size:12.5px; }
.pcinv-tipaff { color:#9fe39a; font-size:12.5px; }
.pcinv-erow { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:10px; align-items:center; padding:7px 0; border-bottom:1px solid #15243a; }
.pcinv-elabel { display:flex; justify-content:space-between; gap:8px; font-size:12.5px; color:#d6dfea; min-width:0; }
.pcinv-elabel > span:first-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pcinv-elabel > span:last-child { color:#8b9aae; font-size:11.5px; font-variant-numeric:tabular-nums; flex:none; }
.pcinv-ebar { grid-column:1; height:5px; margin-top:6px; background:#0d1a2b; border-radius:3px; overflow:hidden; }
.pcinv-efill { height:100%; border-radius:3px; background:linear-gradient(90deg,#7c4ee6,#c79bff); }
.pcinv-forge { grid-column:2; grid-row:1 / span 2; min-width:92px; }
.pcinv-forge .gico { width:15px; height:15px; }
.pcinv-forge.max { color:#7e8da1; letter-spacing:.1em; }
.pcinv-ap { margin-top:10px; padding:9px 11px; border:1px solid #233650; background:rgba(10,22,38,.7); display:flex; align-items:center; gap:10px; }
.pcinv-ap-t { flex:1; min-width:0; }
.pcinv-ap-name { font-size:13px; color:#ffb48f; font-weight:600; }
.pcinv-sock { display:flex; gap:8px; align-items:center; padding:5px 0; --cw:40px; }
.pcinv-sock-t { flex:1; font-size:12.5px; } .pcinv-sock-t.dim { color:#7d8b9e; }
.pcinv-gempick { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; --cw:42px; }
.pcinv-hammer { position:absolute; right:-8px; bottom:-8px; font-size:26px; transform-origin:80% 80%; z-index:2; }
.pcinv-hammer.forging { animation:pcinvHammer .36s ease-in-out 3; }
@keyframes pcinvHammer { 0%{transform:rotate(0)} 45%{transform:rotate(-45deg)} 70%{transform:rotate(12deg)} 100%{transform:rotate(0)} }
.pcinv-dim { position:fixed; inset:0; z-index:58; background:rgba(1,4,9,.6); pointer-events:auto; }
.pcinv-card.float { position:fixed; z-index:59; left:50%; top:50%; right:auto; bottom:auto; transform:translate(-50%,-50%); width:min(680px,96vw); max-height:92vh;
  grid-template-columns:230px minmax(0,1fr); grid-template-rows:auto minmax(0,1fr); grid-template-areas:"head body" "acts body"; column-gap:18px; }
.pcinv-card.float .pcinv-card-head { flex-direction:column; text-align:center; padding:4px 0 0; border-bottom:none; }
.pcinv-card.float .pcinv-card-head > .pcinv-cell.huge { width:88px; height:88px; }
.pcinv-card.float .pcinv-card-info { align-items:center; }
.pcinv-card.float .pcinv-card-sub { justify-content:center; }
.pcinv-card.float .pcinv-card-acts { align-content:end; }
.pcinv-card.float .pcinv-card-x { left:26px; right:auto; }

/* ---------- кнопки ---------- */
.pcinv-btn, .pcinv-ebtn, .pcinv-abtn, .pcinv-respec { position:relative; isolation:isolate; min-height:34px; padding:6px 14px; display:inline-flex; align-items:center; justify-content:center; gap:6px;
  background:none; border:none; font:600 11.5px/1.15 system-ui; letter-spacing:.05em; text-transform:uppercase; color:#d7e1ee; cursor:pointer; text-align:center; }
.pcinv-btn::before, .pcinv-btn::after, .pcinv-ebtn::before, .pcinv-ebtn::after, .pcinv-abtn::before, .pcinv-abtn::after, .pcinv-respec::before, .pcinv-respec::after {
  content:""; position:absolute; z-index:-1; pointer-events:none; clip-path:${HEX("8px")}; }
.pcinv-btn::before, .pcinv-ebtn::before, .pcinv-abtn::before, .pcinv-respec::before { inset:0; background:linear-gradient(180deg,#5f7189,#33425a); }
.pcinv-btn::after, .pcinv-ebtn::after, .pcinv-abtn::after, .pcinv-respec::after { inset:1px; background:linear-gradient(180deg,#0f1f35,#091527); clip-path:${HEX("7.5px")}; }
.pcinv-btn:hover:not(:disabled)::before, .pcinv-ebtn:hover:not(:disabled)::before, .pcinv-abtn:hover:not(:disabled)::before, .pcinv-respec:hover:not(:disabled)::before { background:linear-gradient(180deg,#8fb4dc,#4a6688); }
.pcinv-btn:disabled, .pcinv-ebtn:disabled, .pcinv-abtn:disabled, .pcinv-respec:disabled { opacity:.42; cursor:default; }
.pcinv-btn.sm { min-height:30px; padding:5px 12px; font-size:11px; }
.pcinv-btn.gold { color:#ffe1a0; } .pcinv-btn.gold::before { background:linear-gradient(180deg,#f3cf7c,#a9792a); } .pcinv-btn.gold::after { background:linear-gradient(180deg,#2c220f,#1a1408); }
.pcinv-btn.green { color:#b9f5c2; } .pcinv-btn.green::before { background:linear-gradient(180deg,#8fe0a0,#2f7a44); } .pcinv-btn.green::after { background:linear-gradient(180deg,#10261a,#0a1a11); }
.pcinv-btn.danger, .pcinv-ebtn.danger { color:#ffc2b8; } .pcinv-btn.danger::before, .pcinv-ebtn.danger::before { background:linear-gradient(180deg,#e0887c,#8a3328); }
.pcinv-btn.danger::after, .pcinv-ebtn.danger::after { background:linear-gradient(180deg,#2a1414,#1a0c0c); }
.pcinv-btn .gico, .pcinv-ebtn .gico { width:15px; height:15px; }

/* ---------- подсказка, меню, подтверждение ---------- */
.pcinv-tip { position:fixed; display:none; max-width:250px; padding:9px 11px; pointer-events:none; z-index:61; background:rgba(5,12,22,.97); border:1px solid #3b4d66;
  box-shadow:0 8px 24px rgba(0,0,0,.6); }
.pcinv-name { font-weight:700; margin-bottom:5px; color:#eaf0f7; }
.pcinv-name.t-gold { color:var(--tier-gold); } .pcinv-name.t-legendary { color:var(--tier-legendary); } .pcinv-name.t-ruby { color:var(--tier-ruby); } .pcinv-name.t-base { color:#dedede; }
.pcinv-small { color:#9aa8ba; font-size:11.5px; }
.pcinv-small.dim { color:#6f7f95; margin-top:4px; }
.pcinv-score { display:inline-block; margin:3px 0 2px; font:800 15px system-ui; color:var(--quality); }
.pcinv-score small { font:600 11px system-ui; color:#9aa8ba; margin-right:4px; }
.pcinv-sub { color:var(--muted); font-size:12px; margin:2px 0 6px; }
.pcinv-confirm { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(340px,92vw); z-index:62; pointer-events:auto; padding:16px;
  background:linear-gradient(180deg,rgba(9,21,37,.99),rgba(4,11,21,.99)); border:1px solid #4a5d77; box-shadow:0 0 0 1px #000,0 14px 40px rgba(0,0,0,.65); }
.pcinv-confirm-text { margin-bottom:12px; font-size:13.5px; color:#e8eef6; }
.pcinv-confirm-row { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }
.pcinv-confirm-row.col { flex-direction:column; align-items:stretch; }
.pcinv-actions .pcinv-ebtn { min-height:38px; font-size:12px; }
.pcinv-input, .pcinv-select { width:100%; margin:6px 0; padding:7px 9px; border:1px solid #2d405a; background:#07111e; color:#e8eef6; font:13.5px system-ui; border-radius:2px; }
.pcinv-select { width:auto; margin:0; padding:4px 8px; color:#e0b866; font-weight:600; font-size:12.5px; }
.pcinv-ghost { position:fixed; z-index:80; width:52px; height:52px; margin:-26px 0 0 -26px; display:flex; align-items:center; justify-content:center; pointer-events:none;
  background:rgba(10,22,38,.92); border:1px solid #7fd2ff; }
.pcinv-ghost > * { width:80%; height:80%; }
.pcinv-gifts { margin-bottom:12px; padding:10px 12px; display:flex; flex-direction:column; gap:4px; border:1px solid #d9a21b; background:rgba(40,30,10,.85); }
.pcinv-gifts-h { font-weight:800; color:#ffd166; }
.pcinv-gifts-row { font-size:13px; }
.pcinv-gifts .pcinv-ebtn { align-self:flex-start; margin-top:4px; }

/* ---------- «Атрибуты», «Умения», «Обмен»: панель с заголовком ---------- */
.pcinv-tabpnl { max-width:860px; margin:0 auto; padding:18px 26px 22px; }
.pcinv-tabh { font:700 24px/1.1 "Iowan Old Style",Georgia,serif; color:#dbe8f6; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #1d2d43; }
.pcinv-tabtop { display:flex; flex-direction:column; gap:4px; margin-bottom:6px; }
.pcinv-pts { align-self:flex-start; padding:5px 12px; font:700 14px/1.2 system-ui; color:#c9d5e3; background:rgba(10,22,38,.8); border:1px solid #2d405a; }
.pcinv-pts.on { color:#b9f5c2; border-color:#3f9a58; background:rgba(16,40,26,.75); box-shadow:0 0 10px rgba(80,200,110,.15); }
.pcinv-attrs { display:flex; flex-direction:column; gap:8px; }
.pcinv-arow { position:relative; isolation:isolate; display:flex; align-items:center; gap:12px; padding:10px 14px; }
.pcinv-arow::before { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(180deg,rgba(12,26,44,.85),rgba(7,16,29,.85)); border:1px solid #233650; clip-path:${CUT("8px")}; }
.pcinv-arow:hover::before { border-color:#35537a; }
.pcinv-skill.on::before { border-color:#3f9a58; background:linear-gradient(180deg,rgba(18,46,30,.85),rgba(10,28,18,.85)); }
.pcinv-aic { position:relative; isolation:isolate; width:46px; height:46px; flex:none; display:grid; place-items:center; font-size:26px; }
.pcinv-aic::before { content:""; position:absolute; inset:0; z-index:-1; background:radial-gradient(ellipse at 50% 40%,#1a2d48,#08111e 80%); border:1px solid #3b4d66; clip-path:${CUT("7px")}; }
.pcinv-aic .gico { width:30px; height:30px; }
.pcinv-atxt { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
.pcinv-aname { display:flex; align-items:center; flex-wrap:wrap; gap:6px 8px; font:700 15px/1.2 system-ui; color:#eaf0f7; }
.pcinv-aval { display:flex; align-items:baseline; gap:4px; min-width:58px; justify-content:flex-end; font:800 22px/1 system-ui; color:#f1f5fa; font-variant-numeric:tabular-nums; }
.pcinv-gemadd { font:700 13px/1 system-ui; color:#9fe39a; }
.pcinv-abtn { min-width:54px; color:#b9f5c2; font-size:13px; letter-spacing:0; }
.pcinv-skill .pcinv-abtn { min-width:92px; font-size:11.5px; letter-spacing:.04em; }
.pcinv-respec { margin-top:8px; color:#ffcfae; }

/* ---------- «Обмен» ---------- */
.pcinv-trade { display:flex; flex-direction:column; gap:8px; }
.pcinv-trade > .pcinv-sub { margin:10px 0 0; font:700 15px/1.2 system-ui; color:#eaf0f7; }
.pcinv-trade > .pcinv-sub:first-child { margin-top:0; }
.pcinv-trow { display:flex; align-items:center; gap:8px; padding:5px 0; border-bottom:1px solid #15243a; flex-wrap:wrap; }
.pcinv-tname { flex:1; min-width:0; font-size:13px; }
.pcinv-tbtns { display:flex; gap:8px; flex-wrap:wrap; }
.pcinv-tpick { display:flex; flex-direction:column; max-height:240px; overflow:auto; border:1px solid #22354f; padding:4px 8px; background:rgba(5,12,22,.6); }
.pcinv-tsess { padding:10px 12px; display:flex; flex-direction:column; gap:6px; border:1px solid #2d405a; background:rgba(9,20,35,.8); }
.pcinv-tcols { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.pcinv-tcol { display:flex; flex-direction:column; gap:3px; min-width:0; }
.pcinv-tname2.pcinv-thead { font-weight:800; font-size:14px; flex:0 0 auto; white-space:nowrap; }
.pcinv-chip { font:700 11px system-ui; padding:2px 8px; border-radius:999px; border:1px solid #2d405a; color:var(--muted); white-space:nowrap; }
.pcinv-chip.ok { color:#7ee081; border-color:#3f7a48; background:rgba(126,224,129,.08); }
.pcinv-colh { font:800 12px system-ui; color:#c9d5e3; margin-bottom:2px; }
.pcinv-tcol.ok .pcinv-colh { color:#7ee081; }
.pcinv-tcol.ok .pcinv-ttile { border-color:#3f7a48; }
.pcinv-ttile { display:flex; align-items:center; gap:6px; padding:4px 6px; border:1px solid #22354f; background:rgba(7,16,29,.9); min-width:0; }
.pcinv-tic { width:40px; height:40px; flex:none; display:flex; align-items:center; justify-content:center; background:#08111e; border:1px solid #2d405a; overflow:hidden; }
.pcinv-tic > * { width:34px !important; height:34px !important; }
.pcinv-tic img, .pcinv-tic svg { width:34px; height:34px; }
.pcinv-tic > .gico-e { width:auto !important; height:auto !important; font-size:30px; line-height:1; display:flex; align-items:center; justify-content:center; }
.pcinv-tname2 { flex:1; min-width:0; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pcinv-tcnt { font:800 12px system-ui; color:#e8c26a; flex:none; min-width:26px; text-align:right; }
.pcinv-tx { background:none; border:none; color:#c9a0a0; cursor:pointer; font-size:15px; padding:0 4px; line-height:1; }
.pcinv-tx:hover { color:#ff9a9a; }
.pcinv-tcb { width:16px; height:16px; flex:none; accent-color:#3cb2f2; }
.pcinv-tonline { width:100%; margin:6px 0; padding:7px 9px; font-size:14px; color:#e8eef6; }
.pcinv-tqty { display:flex; align-items:center; gap:4px; flex:none; }
.pcinv-qbtn { min-width:34px; height:30px; padding:0 8px; border:1px solid #2d405a; background:#0b1828; color:#e8eef6; font:800 16px system-ui; cursor:pointer; }
.pcinv-qbtn:hover:not(:disabled) { border-color:#3d7fc0; }
.pcinv-qbtn:disabled { opacity:.35; cursor:default; }
.pcinv-qall { font-size:12px; min-width:0; }
.pcinv-qv { min-width:34px; text-align:center; font:800 15px system-ui; color:#e8c26a; }

/* ---------- телефон в игре: окно на весь экран, сумка рядом со слотами ---------- */
.pcinv-root.touch:not(.page) .pcinv-win { inset:0; transform:none; width:auto; max-height:none; border:none; box-shadow:none;
  padding:0 env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); background:linear-gradient(180deg,rgba(5,12,22,.94),rgba(3,8,16,.96)); }
.pcinv-root.touch:not(.page) .pcinv-head { cursor:default; }
/* Телефон в игре: всё помещается без прокрутки — сведения шире, характеристики в два столбца, атрибуты и умения в две колонки. */
.pcinv-root.touch:not(.page) .pcinv-body { padding:6px 8px; }
.pcinv-root.touch:not(.page) .pcinv-tabpnl { max-width:none; padding:10px 12px; }
.pcinv-root.touch:not(.page) .pcinv-tabh { display:none; }
.pcinv-root.touch:not(.page) .pcinv-attrs { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
.pcinv-root.touch:not(.page) .pcinv-attrs > .pcinv-tabtop, .pcinv-root.touch:not(.page) .pcinv-attrs > .pcinv-respec, .pcinv-root.touch:not(.page) .pcinv-attrs > .pcinv-result { grid-column:1 / -1; }
.pcinv-root.touch:not(.page) .pcinv-tabtop { flex-direction:row; flex-wrap:wrap; align-items:center; gap:4px 10px; margin-bottom:0; }
.pcinv-root.touch:not(.page) .pcinv-pts { padding:3px 8px; font-size:12px; }
.pcinv-root.touch:not(.page) .pcinv-arow { padding:6px 8px; gap:6px; }
.pcinv-root.touch:not(.page) .pcinv-aic { width:32px; height:32px; }
.pcinv-root.touch:not(.page) .pcinv-aic .gico { width:20px; height:20px; }
.pcinv-root.touch:not(.page) .pcinv-aname { font-size:12.5px; gap:4px; }
.pcinv-root.touch:not(.page) .pcinv-arow .pcinv-small { font-size:10px; line-height:1.25; }
.pcinv-root.touch:not(.page) .pcinv-aval { min-width:30px; font-size:16px; }
.pcinv-root.touch:not(.page) .pcinv-abtn { min-width:38px; min-height:30px; padding:4px 8px; font-size:12px; }
.pcinv-root.touch:not(.page) .pcinv-skill .pcinv-abtn { min-width:62px; font-size:10px; }
.pcinv-root.touch:not(.page) .pcinv-chip { font-size:9.5px; padding:1px 6px; }
.pcinv-root.touch:not(.page) .pcinv-respec { min-height:30px; margin-top:0; }
.pcinv-root.touch .pcinv-head { height:38px; padding-left:6px; }
.pcinv-root.touch .pcinv-tab { padding:0 12px; font-size:13.5px; }
.pcinv-root.touch .pcinv-curs { gap:12px; padding:0 6px; }
.pcinv-root.touch .pcinv-cur { font-size:12px; }
.pcinv-root.touch .pcinv-body { padding:8px; }
/* Телефон: палец на вещи или в сетке сумки — прокручивает сумку (pan-y). Тап открывает карточку; перетаскивание вертикально отключено, надеть — кнопкой в карточке. */
.pcinv-root.touch .pcinv-cell, .pcinv-root.touch .pcinv-bagrid, .pcinv-root.touch .pcinv-center, .pcinv-root.touch .pcinv-card-body { touch-action:pan-y; }
.pcinv-bagrid, .pcinv-card-body, .pcinv-center { overscroll-behavior:contain; -webkit-overflow-scrolling:touch; }
.pcinv-root.touch .pcinv-tabpnl { padding:14px 14px 16px; }
.pcinv-root.touch .pcinv-tabh { font-size:19px; margin-bottom:8px; padding-bottom:6px; }
.pcinv-root.touch .pcinv-arow { gap:8px; padding:8px 10px; }
.pcinv-root.touch .pcinv-aic { width:38px; height:38px; }
.pcinv-root.touch .pcinv-aic .gico { width:24px; height:24px; }
.pcinv-root.touch .pcinv-aval { min-width:40px; font-size:18px; }
.pcinv-root.touch .pcinv-abtn { min-width:44px; }
.pcinv-root.touch .pcinv-confirm { width:min(340px,92vw); }
.pcinv-root.touch:not(.page) .pcinv-gear { gap:8px; }
.pcinv-root.touch:not(.page) .pcinv-atc span { display:none; }
.pcinv-root.touch:not(.page) .pcinv-atc { justify-content:center; }
.pcinv-root.touch:not(.page) .pcinv-heropnl { --sw:54px; --sh:54px; --gap:6px; --cwid:196px; gap:8px; padding:10px; }
.pcinv-root.touch:not(.page) .pcinv-slab { height:13px; font-size:8.5px; }
.pcinv-root.touch:not(.page) .pcinv-heropnl { --labh:13px; }
.pcinv-root.touch:not(.page) .pcinv-slot .pcinv-q { left:7px; top:5px; } .pcinv-root.touch:not(.page) .pcinv-slot .pcinv-sb { right:7px; top:5px; }
.pcinv-root.touch:not(.page) .pcinv-slot > .pcinv-cell { padding-top:2%; }
.pcinv-root.touch:not(.page) .pcinv-slot > .pcinv-cell > .gico { width:66%; height:66%; }
.pcinv-root.touch:not(.page) .pcinv-ci-nick { font-size:18px; }
.pcinv-root.touch:not(.page) .pcinv-row { font-size:11px; min-height:18px; }
.pcinv-root.touch:not(.page) .pcinv-atc { height:26px; }
.pcinv-root.touch:not(.page) .pcinv-bagt { font-size:16px; }
.pcinv-root.touch:not(.page) .pcinv-ftabs { height:30px; margin-bottom:6px; }
.pcinv-root.touch:not(.page) .pcinv-ftab { font-size:11.5px; padding:0 2px; }
.pcinv-root.touch:not(.page) .pcinv-bagh { display:none; }
.pcinv-root.touch:not(.page) .pcinv-sortrow { margin-bottom:6px; gap:3px; flex-wrap:nowrap; }
.pcinv-root.touch:not(.page) .pcinv-sortrow > .pcinv-small { display:none; }
.pcinv-root.touch:not(.page) .pcinv-sortbtn { flex:1 1 auto; padding:3px 3px; font-size:10.5px; }
.pcinv-root.touch:not(.page) .pcinv-anvil { min-height:30px; flex-basis:110px; font-size:11.5px; }
.pcinv-root.touch:not(.page) .pcinv-bagf .pcinv-btn { min-height:30px; padding:4px 8px; font-size:9.5px; letter-spacing:.02em; white-space:nowrap; }
.pcinv-root.touch:not(.page) .pcinv-anvil { flex-basis:96px; }
.pcinv-root.touch:not(.page) .pcinv-bagpnl { --cw:40px; --cols:8; padding:8px 10px; }
.pcinv-root.touch:not(.page) .pcinv-bagrid { gap:4px; }
.pcinv-root.touch:not(.page) .pcinv-bagf { margin-top:8px; }

/* ---------- страница !inv: окно — часть страницы, герой на камне ---------- */
.pcinv-root.page { position:relative; inset:auto; z-index:1; pointer-events:auto; }
.pcinv-root.page .pcinv-win { position:relative; left:auto; top:auto; transform:none; width:100%; max-width:1280px; margin:0 auto; max-height:none; overflow:visible;
  background:none; border:none; box-shadow:none; }
.pcinv-root.page .pcinv-head { position:relative; cursor:default; background:linear-gradient(180deg,rgba(14,28,46,.92),rgba(8,18,32,.92)); border:1px solid var(--line); }
.pcinv-root.page .pcinv-x { display:none; }
.pcinv-root.page .pcinv-body { padding:14px 0 0; }
.pcinv-root.page .pcinv-cell { cursor:pointer; }
.pcinv-root.page .pcinv-gear { grid-template-columns:300px minmax(0,1fr) 410px; grid-template-areas:"char hero bag"; }
.pcinv-root.page .pcinv-heropnl { --sw:86px; --sh:104px; --cwid:auto; background:none; }
.pcinv-root.page .pcinv-heropnl::before, .pcinv-root.page .pcinv-heropnl::after, .pcinv-root.page .pcinv-heropnl > .pcinv-orn { display:none; }
.pcinv-root.page .pcinv-heropnl { padding:0; justify-content:space-between; }
.pcinv-root.page .pcinv-center { flex:1; min-width:180px; overflow:visible; }
.pcinv-root.page .pcinv-card:not(.float) { left:calc(var(--sw) + 12px); right:calc(var(--sw) + 12px); top:0; bottom:0; }
.pcinv-root.page .pcinv-bagpnl { --cw:56px; --cols:6; }
.pcinv-root.page .pcinv-ftab { font-size:12.5px; padding:0 2px; }
/* Страница: сортировка в одну строку. */
.pcinv-root.page .pcinv-sortrow { flex-wrap:nowrap; gap:4px; }
.pcinv-root.page .pcinv-sortrow > .pcinv-small { font-size:11px; margin-right:0; white-space:nowrap; }
.pcinv-root.page .pcinv-sortbtn { padding:3px 6px; font-size:11px; }
/* Страница: сведения о герое и сумка — до одной нижней линии; низ сумки (наковальня, «разобрать») прижат к низу. */
.pcinv-root.page .pcinv-gear { align-items:stretch; }
/* Широкая страница: сумка по высоте ряда (характеристики/герой), сетка занимает всё место до кнопок и прокручивается. */
.pcinv-root.page .pcinv-bagpnl { contain:size; align-self:stretch; }
/* Страница: много вещей — сетка прокручивается внутри сумки (видно 7 рядов). */
.pcinv-root.page .pcinv-bagrid { padding-right:4px; }
.pcinv-root.page .pcinv-charpnl .pcinv-ci-nick { font-size:30px; }
.pcinv-root.page .pcinv-charpnl .pcinv-at6 { grid-template-columns:repeat(6,minmax(0,1fr)); }
.pcinv-root.page .pcinv-charpnl .pcinv-atc { flex-direction:column; justify-content:center; height:52px; gap:2px; padding:0; }
.pcinv-root.page .pcinv-charpnl .pcinv-atc .gico { width:22px; height:22px; }
.pcinv-root.page .pcinv-charpnl .pcinv-row { font-size:13.5px; min-height:23px; }
.pcinv-stage { position:absolute; inset:0; pointer-events:none; }
.pcinv-heroimg { position:absolute; left:50%; bottom:var(--feet,4%); height:96%; transform:translateX(-50%); filter:drop-shadow(0 8px 14px rgba(0,0,0,.5)); }
.pcinv-heroshadow { position:absolute; left:50%; bottom:calc(var(--feet,4%) - 10px); width:46%; height:22px; transform:translateX(-50%); border-radius:50%;
  background:radial-gradient(ellipse at center,rgba(0,0,0,.6),rgba(0,0,0,0) 70%); }
@media (max-width: 1199px) {
  .pcinv-root.page .pcinv-gear { grid-template-columns:minmax(0,1fr) 410px; grid-template-areas:"hero bag" "char char"; }
  .pcinv-root.page .pcinv-charpnl .pcinv-stats { display:grid; grid-template-columns:1fr 1fr; column-gap:24px; }
}
@media (max-width: 979px) {
  .pcinv-root.page .pcinv-gear { grid-template-columns:minmax(0,1fr); grid-template-areas:"hero" "bag" "char"; }
  .pcinv-root.page .pcinv-bagpnl { --cols:6; }
  .pcinv-root.page .pcinv-bagpnl .pcinv-grid { grid-template-columns:repeat(6,minmax(0,1fr)); }
  .pcinv-root.page .pcinv-bagpnl .pcinv-cell { width:100%; height:auto; aspect-ratio:1 / 1; }
  .pcinv-root.page .pcinv-bagpnl { contain:none; }
  .pcinv-root.page .pcinv-bagwrap { flex:none; }
  .pcinv-root.page .pcinv-bagwrap > .pcinv-bagrid { flex:none; max-height:min(520px,62vh); overflow-y:auto; }
}
@media (max-width: 620px) {
  .pcinv-root.page .pcinv-head { height:42px; padding:0 2px; }
  .pcinv-root.page .pcinv-tabs { justify-content:space-around; }
  .pcinv-root.page .pcinv-tab { padding:0 8px; font-size:13.5px; }
  .pcinv-root.page .pcinv-cur { display:none; }
  .pcinv-root.page .pcinv-curnick { display:none; }
  .pcinv-root.page .pcinv-heropnl { --sw:62px; --sh:66px; --gap:7px; }
  .pcinv-root.page .pcinv-slab { height:15px; font-size:9.5px; }
  .pcinv-root.page .pcinv-heropnl { --labh:15px; }
  .pcinv-root.page .pcinv-sortrow > .pcinv-small { display:none; }
  .pcinv-root.page .pcinv-sortbtn { flex:1 1 auto; padding:3px 4px; }
  .pcinv-root.page .pcinv-slot > .pcinv-cell > .gico { width:64%; height:64%; }
  .pcinv-root.page .pcinv-bagpnl, .pcinv-root.page .pcinv-charpnl { padding:14px; }
  .pcinv-root.page .pcinv-charpnl .pcinv-stats { display:flex; }
  .pcinv-root.page .pcinv-ci-nick { font-size:22px; }
  .pcinv-card.float { left:0; right:0; top:auto; bottom:0; transform:none; width:100%; max-height:86vh; padding:22px 18px calc(16px + env(safe-area-inset-bottom));
    grid-template-columns:1fr; grid-template-rows:auto minmax(0,1fr) auto; grid-template-areas:"head" "body" "acts"; --c:16px; }
  .pcinv-card.float .pcinv-card-head { flex-direction:row; text-align:left; align-items:center; padding:0 30px 10px 0; border-bottom:1px solid #1a2b42; }
  .pcinv-card.float .pcinv-card-info { align-items:flex-start; }
  .pcinv-card.float .pcinv-card-sub { justify-content:flex-start; }
  .pcinv-card.float .pcinv-cell.huge { width:76px; height:76px; }
  .pcinv-card.float .pcinv-card-x { left:auto; right:18px; top:14px; }
  .pcinv-card.float .pcinv-grab { display:block; position:absolute; left:50%; top:7px; width:42px; height:4px; border-radius:2px; background:#3a4d66; transform:translateX(-50%); }
  .pcinv-card.float .pcinv-orn.bl, .pcinv-card.float .pcinv-orn.br { display:none; }
}
`;
  document.head.appendChild(s);
}
