import { ATTRS as A2, ATTR_INFO, attrEffect, CLASSES2, costRule, skillCooldownFor, skillDesc, skillName, stepCost, type ClassId } from "#shared/classes2";
import { armorIconKey, glyph, skillIcon, weaponIcon } from "#shared/icons";
import { ARMOR_PART_NAME, ARMOR_PARTS, type ArmorPart } from "#shared/armor";
import { ATTR_LOOK, TIER_LOOK } from "#shared/look";
import { attackLabel } from "#shared/heroStats";
import { ensureIconCss, iconHtml, setIconEl } from "../ui/icons";
import type { IconKey } from "#shared/icons";
import { AEGIS_NAME, AFFIX_NAME, craftPow, isCraftRare, weaponName, ATTACK_CLASSES, WEAPON_NOUN, attackPointBonus, attackPointEligible, attackPointNext, attackPoints, bothHandsCls, bothHandsNote, fmtPct, qualityStarsShort, sharpPctOf, weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import type { PcEnchRow, PcInvActMsg, PcInvArmor, PcInvData, PcInvResult, PcInvWeapon, TradeItemView } from "#shared/net/messages";
import { SKIN_LABELS, skinPicture } from "#shared/skins";
import { ATTR_SHORT, gemName, parseGem, pcJewelBonus, RING, ringBonusText, ringLabel, ringName, ringResist, type PcInvJewels, type RingTier } from "#shared/jewels";
import { skillDamageText } from "#shared/skillDamage";
import { BAG_SORTS, bagPickItem, nextBagSort, sortBag, type BagSort } from "#shared/bagSort";
import { gemHtml, RING_SLOT_SVG, ringHtml } from "#shared/jewelIcons";
import {
  CRAFT,
  CRAFT_CATS,
  CRAFT_ITEMS,
  CRAFT_MATS,
  CRAFT_METHOD_IDS,
  CRAFT_METHODS,
  CRAFT_OUTCOMES,
  CRAFT_RECIPES,
  CRAFT_SMELT,
  craftCode,
  craftOdds,
  matchRecipe,
  matRoll,
  plannedRolls,
  plannedCaps,
  capTag,
  isCraftItem,
  recipeText,
  rollsFor,
  smithLevel,
  type CraftInput,
  type CraftItemId,
  type CraftMatId,
} from "#shared/craft";

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
export type InvTab = "gear" | "attrs" | "skills" | "craft" | "trade";

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
    // Крафт — свой итог во вкладке (исход крупно, кнопка «Посмотреть»).
    if (r.craft) {
      this.craftRes = { ...r.craft, text: r.text, at: Date.now() };
      if (this.isOpen) this.render();
      // Вспышка итога на наковальне гаснет сама — снять класс следующей перерисовкой.
      window.setTimeout(() => this.isOpen && this.tab === "craft" && this.render(), 1550);
      return;
    }
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
    // Бесконечные анимации (свечение рамки редкого мастерского) — с фазой от часов: перерисовка их не дёргает.
    this.root.style.setProperty("--now", `${-Math.round(performance.now() % 2200)}ms`);
    const top = this.win.scrollTop;
    // Списки выбора прокручиваются сами — их позицию тоже сохраняем (иначе после нажатия сбрасывались наверх).
    const lists = [...this.win.querySelectorAll<HTMLElement>(".pcinv-tpick")].map((e) => e.scrollTop);
    // Сумка, ряд ★ и карточка прокручиваются сами — после перерисовки остаются на месте.
    const keep = new Map([...this.root.querySelectorAll<HTMLElement>("[data-keep]")].map((e) => [e.dataset.keep ?? "", [e.scrollLeft, e.scrollTop]] as const));
    this.renderInner();
    this.root.classList.toggle("tab-gear", this.tab === "gear");
    // «Крафт»: фон — кузница на весь экран (в игре — всё окно, на странице !inv — фон страницы).
    this.root.classList.toggle("tab-craft", this.tab === "craft");
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
      ["craft", "Крафт", 0],
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
    else if (this.tab === "craft") this.renderCraft(d);
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
    // Материалы и особые катализаторы крафта — стопками, как камни.
    for (const [id, n] of d.craft?.stock ?? []) out.push({ code: `m:${id}`, label: CRAFT_ITEMS[id].name, max: n, stack: true, view: { k: "mat", name: CRAFT_ITEMS[id].name, n, mat: id } });
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
    else if (it.k === "mat") box.innerHTML = iconHtml(`m.${it.mat ?? "alloy"}` as IconKey);
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
    st.append(div("pcinv-heroshadow"), img, this.skinPick());
    return st;
  }

  /** Выбор облика под куклой (страница !inv): то же, что «Внешность» в игре, — 1..BOT.skins. */
  private skinPick(): HTMLDivElement {
    const box = div("pcinv-skinpick");
    const sel = document.createElement("select");
    sel.className = "pcinv-skinsel";
    SKIN_LABELS.forEach((label, i) => {
      const o = document.createElement("option");
      o.value = String(i + 1);
      o.textContent = label;
      sel.append(o);
    });
    sel.value = String(Math.max(1, this.hero.skin));
    sel.onchange = () => this.hooks.act({ act: "skin", id: sel.value, idx: 0 });
    box.append(sel);
    return box;
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
    // Уровень и опыт до следующего.
    this.xpLv = div("pcinv-ci-lv");
    // Длинная полоса опыта во всю ширину, подпись — внутри неё.
    const xp = div("pcinv-xp");
    this.xpFill = div("pcinv-xp-fill");
    this.xpText = div("pcinv-xp-text");
    xp.append(this.xpFill, this.xpText);
    // Титул — напротив уровня, в одной строке.
    const lvRow = div("pcinv-ci-lvrow");
    lvRow.append(this.xpLv, sel);
    box.append(lvRow, xp);
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
    // Материалы и особые катализаторы крафта — стопками, в «Прочем» (и во «Всех»).
    if (f === "all" || f === "misc") for (const [id, n] of d.craft?.stock ?? []) cells.push(this.matCell(id, n));
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
      // Разобрать всё, кроме избранного ★, рубиновых, редких мастерских и надетого — с подтверждением (они — только поштучно, как на сервере).
      // Вкладка «Оружие» — только оружие, «Броня» — только броня, «Все» — и то и другое.
      const ws = f === "armor" ? [] : bagW.filter((w) => w.tier !== "ruby" && !isCraftRare(w));
      const as = f === "weapon" || !this.hooks.armorAct ? [] : bag.flatMap((e) => ("a" in e && !e.a.fav ? [e.a] : []));
      // Вкладка «Все» — и кольца тоже (как «Разобрать все кольца»: надетые и ★ остаются).
      const rs = f === "all" ? bagR : [];
      const n = ws.length + as.length + rs.length;
      const scrapSum = ws.reduce((k, w) => k + w.scrap, 0) + as.reduce((k, x) => k + x.scrap, 0) + rs.reduce((k, r) => k + r.scrap, 0);
      const what = f === "weapon" ? "оружие" : f === "armor" ? "броню" : "оружие, броню и кольца";
      const all = button(f === "all" ? `Разобрать всё, кроме ${glyph("ui.fav")}` : `Разобрать ${what}, кроме ${glyph("ui.fav")}`, () =>
        this.askConfirm(
          `Разобрать ${what} — ${n} шт. на ${scrapSum} лома? Избранное ${glyph("ui.fav")}, рубиновое, редкое мастерское и надетое останутся.${rs.length ? " Камни из колец вернутся в сумку." : ""}`,
          "Разобрать",
          () => this.hooks.act({ act: "scrapAll", id: f, idx: 0 }),
        ),
      );
      all.className = "pcinv-btn";
      all.disabled = n === 0;
      all.title = `${what[0].toUpperCase()}${what.slice(1)} из сумки в лом (${n} шт., +${scrapSum}). Избранное, рубиновое, редкое мастерское и надетое останутся`;
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

  /** Материал или особый катализатор крафта в сумке: сколько, что даёт; нажатие — меню (в крафт, подарить). */
  private matCell(id: CraftItemId, n: number): HTMLDivElement {
    const def = CRAFT_ITEMS[id];
    const c = countCell(iconHtml(`m.${id}` as IconKey), n);
    c.classList.add("click", "pcinv-mat");
    const what = def.kind === "cat" ? `Особый катализатор: ролл «${AFFIX_NAME[id === "frost" ? "chill" : "venom"]}» (возвращается после крафта).` : `Материал крафта: ролл «${AFFIX_NAME[matRoll(id as CraftMatId, "sword")]}»${id === "bone" ? " (на луке — Пронзание, на посохе — Поджог)" : ""}.`;
    const body = `${what} Откуда: ${def.src}. Нажми — в крафт или подарить.`;
    c.addEventListener("mouseenter", () => this.textTip(c, `${def.name} ×${n}`, body));
    c.addEventListener("mouseleave", () => this.hideTip());
    c.onclick = () => {
      const sel = this.craftSel;
      const used = sel.mats.filter((m) => m === id).length;
      const acts: [string, () => void, boolean?][] = [];
      if (def.kind === "cat") {
        acts.push([`⚒ В крафт — катализатором`, () => this.toCraft(() => (sel.cat = id))]);
      } else if (sel.mats.length < CRAFT.maxMats && used < n) {
        acts.push([`⚒ В крафт — материалом (${sel.mats.length + 1} из ${CRAFT.maxMats})`, () => this.toCraft(() => sel.mats.push(id as CraftMatId))]);
      } else acts.push(["⚒ Открыть крафт", () => this.toCraft(() => undefined)]);
      acts.push(["🎁 Подарить…", () => this.askGift(def.name, `m:${id}`, n)]);
      this.menu(c, `${def.name} ×${n}`, acts);
    };
    return c;
  }

  /** Перейти во вкладку «Крафт», положив предмет в цепочку. */
  private toCraft(put: () => void): void {
    put();
    this.craftRes = null;
    this.craftPick = null;
    this.tab = "craft";
    this.card = null;
    this.render();
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
      if (isCraftRare(w)) cell.classList.add("craft-rare");
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
    const c = div(`pcinv-cell t-${w.tier}${isCraftRare(w) ? " craft-rare" : ""}${this.card?.kind === "bag" && this.card.id === w.id ? " sel" : ""}`);
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
      if (a.capNote) lab.title = `Потолок ролла (крафт): ${a.capNote} — заточка доводит до него.`;
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
    const ico = div(`pcinv-cell huge t-${tier}${isCraftRare(w) ? " craft-rare" : ""}`);
    setIcon(ico, cls, name, tier);
    if (w && attackPoints(w) > 0) ico.append(div("pcinv-sb", `+${attackPoints(w)}`));
    const q = w?.affixes.length ? qualityStarsShort(w.quality, w.affixes.length) : "";
    const extra: HTMLElement[] = [];
    const atk = attackLabel(cls, tier, w ? sharpPctOf(w) : 0, w ? craftPow(w) * 100 : 0);
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
      // Точка атаки — тот же молот и итог, что у заточки аффиксов (forge с sharpen).
      bt.onclick = () => this.forge(w.id, 0, true);
      box.append(bt);
    }
    return box;
  }

  private forge(id: string, idx: number, sharpen = false): void {
    if (this.forging) return;
    this.forging = true;
    this.hammerDone = false;
    this.pendingResult = null;
    this.lastResult = null;
    this.render();
    this.hooks.act(
      sharpen ? { act: "sharpen", id, idx: 0 }
        : this.data?.armor?.some((x) => x.id === id) ? { act: "armorEnchant", id, idx } : { act: "enchant", id, idx },
    );
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
      // Точка атаки отвечает без e (только текст и ok) — успех берём из ok.
      this.lastResult = {
        up: e ? !!e.up : r.ok,
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

  // ---------------- крафт (shared/craft.ts): кузница по концепту «Кузница берсерка» ----------------

  /** Собираемый крафт: класс, материалы, катализатор, метод (живёт между перерисовками). */
  private craftSel: CraftInput = { cls: "sword", mats: [], cat: null, method: "forge" };
  /** Итог последнего крафта (исход крупно; есть оружие — «Посмотреть»); at — когда пришёл (вспышка на наковальне). */
  private craftRes: { outcome: number; id?: string; found?: string; text: string; at?: number } | null = null;
  /** Нажали «Создать» — удар молота по наковальне, пока не пришёл итог. */
  private craftHitAt = 0;
  /** Открытый выбор на сцене по нажатию ячейки цепочки (основа, материал, катализатор, метод). */
  private craftPick: "base" | "mat" | "cat" | "meth" | null = null;

  private renderCraft(d: PcInvData): void {
    const c = d.craft ?? { stock: [], book: [], xp: 0 };
    const stock = new Map<CraftItemId, number>(c.stock);
    // Камни для катализатора — старшие уровни первыми.
    const gems = [...(d.jewels?.gems ?? [])].sort((a, b) => (parseGem(b[0])?.lv ?? 0) - (parseGem(a[0])?.lv ?? 0));
    const sel = this.craftSel;
    const smith = smithLevel(c.xp);
    // Метод, ещё не открытый уровнем (или пропавший катализатор/материал) — сбрасываем на доступное.
    if (CRAFT_METHODS[sel.method].lv > smith.lv) sel.method = "forge";
    if (sel.cat && !(stock.get(sel.cat as CraftItemId) ?? 0) && !gems.some(([k]) => k === sel.cat)) sel.cat = null;
    const used = (m: CraftMatId): number => sel.mats.filter((x) => x === m).length;
    while (sel.mats.some((m) => used(m) > (stock.get(m) ?? 0))) sel.mats.splice(sel.mats.findIndex((m) => used(m) > (stock.get(m) ?? 0)), 1);
    const redraw = (): void => {
      this.craftRes = null;
      this.render();
    };
    /** Открыть/закрыть выбор на сцене. */
    const pickOpen = (k: typeof this.craftPick): void => {
      this.craftPick = this.craftPick === k ? null : k;
      redraw();
    };
    const DEF_HINT = "Основа → материалы → катализатор → метод: нажми ячейку или возьми с полки — и «Создать».";
    // Текст — во внутреннем элементе: обрезка по двум строкам не залезает в поля плашки.
    const hintEl = div("pcinv-fg-hint");
    const hintTx = div("pcinv-fg-hintt", DEF_HINT);
    hintEl.append(hintTx);
    /** Подсказка при наведении (на ПК) — без перерисовки окна. */
    const hint = (el: HTMLElement, text: string): void => {
      el.title = text;
      el.addEventListener("mouseenter", () => (hintTx.textContent = text));
      el.addEventListener("mouseleave", () => (hintTx.textContent = DEF_HINT));
    };
    const catHtml = (k: string): string => (isCraftItem(k) ? iconHtml(`m.${k}` as IconKey) : gemHtml(k));
    const catName = (k: string): string => (isCraftItem(k) ? CRAFT_ITEMS[k].name : gemName(k));
    const catNote = (k: string): string => {
      if (isCraftItem(k)) return `особый ролл: ${AFFIX_NAME[k === "frost" ? "chill" : "venom"]}`;
      const lv = Math.min(CRAFT.gemLvCap, parseGem(k)?.lv ?? 1);
      return `провал −${CRAFT.gemFail * lv}, отличный и редкий +${CRAFT.gemUp * lv}`;
    };
    const root = div("pcinv-smithy");
    const item = (row: HTMLElement, html: string, label: string, count: string, state: "" | "on" | "off", help: string, onClick: () => void): void => {
      const it = div(`pcinv-fg-it${state ? ` ${state}` : ""}`);
      const ic = div("pcinv-fg-itic");
      ic.innerHTML = html;
      if (count) ic.append(div("pcinv-fg-cnt", count));
      it.append(ic, div("pcinv-fg-itl", label));
      it.onclick = () => state !== "off" && onClick();
      hint(it, help);
      row.append(it);
    };
    const full = (): boolean => sel.mats.length >= CRAFT.maxMats;
    /** Материалы: нажатие кладёт в ячейку (пока есть место и запас). `after` — что сделать после (закрыть выбор). */
    const fillMats = (row: HTMLElement, after?: () => void): void => {
      for (const m of CRAFT_MATS) {
        const have = stock.get(m) ?? 0;
        item(row, iconHtml(`m.${m}` as IconKey), CRAFT_ITEMS[m].name, String(have), have - used(m) > 0 && !full() ? (used(m) ? "on" : "") : "off",
          `${CRAFT_ITEMS[m].name} → ${AFFIX_NAME[matRoll(m, sel.cls)]}. Есть ${have}. Откуда: ${CRAFT_ITEMS[m].src}.${m === "alloy" ? " Сплав делается из лома — «Переплавка лома» слева." : ""}${full() ? " Ячейки полны — убери материал." : ""}`,
          () => {
            sel.mats.push(m);
            after?.();
            redraw();
          });
      }
    };
    /** Катализаторы: «без катализатора», особые и камни (старшие первыми). */
    const fillCats = (row: HTMLElement, after?: () => void): void => {
      const set = (k: string | null): void => {
        sel.cat = k;
        after?.();
        redraw();
      };
      item(row, `<span class="pcinv-fg-none">—</span>`, "Без катализатора", "", sel.cat === null ? "on" : "", "Без катализатора — шансы метода.", () => set(null));
      for (const k of CRAFT_CATS) {
        const have = stock.get(k) ?? 0;
        if (have <= 0) continue;
        item(row, catHtml(k), CRAFT_ITEMS[k].name, String(have), sel.cat === k ? "on" : "", `${CRAFT_ITEMS[k].name}: ${catNote(k)}. Возвращается. Откуда: ${CRAFT_ITEMS[k].src}.`, () => set(k));
      }
      for (const [k, n] of gems) {
        const g = parseGem(k);
        if (!g) continue;
        item(row, gemHtml(k), `${ATTR_SHORT[g.attr]} ${g.lv}`, String(n), sel.cat === k ? "on" : "", `${gemName(k)}: ${catNote(k)}. Возвращается.`, () => set(k));
      }
      if (!CRAFT_CATS.some((k) => (stock.get(k) ?? 0) > 0) && !gems.length) row.append(div("pcinv-small pcinv-fg-empty", "Нет камней и особых катализаторов: камни падают с мобов, особые — с Ледяного демона и пауков."));
    };
    const fillMeths = (row: HTMLElement, after?: () => void): void => {
      for (const k of CRAFT_METHOD_IDS) {
        const m = CRAFT_METHODS[k];
        const locked = m.lv > smith.lv;
        item(row, iconHtml(`cm.${k}` as IconKey), m.name, locked ? `🔒${m.lv}` : String(m.cost), locked ? "off" : sel.method === k ? "on" : "", locked ? `${m.name} откроется на ${m.lv} уровне кузнеца.` : `${m.name} · ${m.cost} лома: ${m.note}.`, () => {
          sel.method = k;
          after?.();
          redraw();
        });
      }
    };
    const fillBases = (row: HTMLElement, after?: () => void): void => {
      for (const cls of ATTACK_CLASSES) {
        const ic = div("");
        setIcon(ic, cls, undefined, "craft");
        item(row, ic.innerHTML, WEAPON_NOUN[cls].name, "", sel.cls === cls ? "on" : "", `${WEAPON_NOUN[cls].name}: основа задаёт класс; роллы дают материалы (кость: ${AFFIX_NAME[matRoll("bone", cls)]}).`, () => {
          sel.cls = cls;
          after?.();
          redraw();
        });
      }
    };
    const closePick = (): void => {
      this.craftPick = null;
    };

    // ---- слева: кузнец, основа, найденные рецепты ----
    const left = div("pcinv-fg-side pcinv-fg-left");
    left.append(div("pcinv-fg-title", "Кузница"));
    const sm = div("pcinv-fg-smith");
    const bar = div("pcinv-cbar");
    const fill = div("pcinv-cbar-f");
    fill.style.width = `${smith.maxed ? 100 : Math.round((smith.have / smith.need) * 100)}%`;
    bar.append(fill);
    const next = CRAFT_METHOD_IDS.map((k) => CRAFT_METHODS[k]).find((m) => m.lv > smith.lv);
    sm.append(div("pcinv-fg-smlv", `⚒ Кузнец ${smith.lv} ур.`), bar, div("pcinv-small", smith.maxed ? "мастерство на максимуме" : `${smith.have} / ${smith.need} опыта${next ? ` · ${next.name} — с ${next.lv} ур.` : ""}`));
    hint(sm, "Опыт кузнеца — за каждый крафт. С уровнем реже провал, чаще отличный и редкий исход, открываются новые методы.");
    // Основа выбирается в ячейке цепочки на сцене — слева только кузнец и найденные рецепты.
    left.append(sm);
    // Скрытые рецепты не показываем — только найденные (их можно повторить одним нажатием).
    const found = CRAFT_RECIPES.filter((r) => c.book.includes(r.id));
    left.append(div("pcinv-fg-sub", "Найденные рецепты"));
    if (!found.length) left.append(div("pcinv-small pcinv-fg-empty", "Пока ни одного. Скрытые рецепты находятся только опытом — пробуй сочетания."));
    for (const rc of found) {
      const row = div("pcinv-fg-row rec");
      const ic = div("pcinv-fg-ic");
      setIcon(ic, rc.cls, undefined, "craft");
      const t = div("pcinv-fg-rtxt");
      t.append(div("pcinv-fg-rname", rc.name), div("pcinv-small", "Открыт"));
      row.append(ic, t);
      row.onclick = () => {
        // Положить рецепт целиком: камень вида — старший из сумки.
        const gem = rc.cat?.startsWith("gem:") ? gems.find(([k]) => parseGem(k)?.attr === rc.cat!.slice(4))?.[0] ?? null : rc.cat;
        this.craftSel = { cls: rc.cls, mats: [...rc.mats], cat: gem, method: rc.method };
        redraw();
      };
      hint(row, `${rc.name}: ${recipeText(rc)}`);
      left.append(row);
    }

    // ---- центр: кузница — цепочка «Основа → Материал → Катализатор → Метод» и наковальня ----
    const stage = div("pcinv-fg-stage");
    // Анимации идут с отрицательной задержкой «сколько уже прошло»: перерисовка (итог, данные с сервера, таймеры)
    // продолжает их с того же места, а не запускает заново — иначе итог мигал несколько раз.
    const since = performance.now() - this.craftHitAt;
    if (since < 700) {
      stage.classList.add("hit");
      stage.style.setProperty("--th", `${-Math.round(since)}ms`);
    }
    const res = this.craftRes;
    const resAge = res?.at ? Date.now() - res.at : Infinity;
    if (res && resAge < 1500) {
      stage.classList.add(res.outcome > 0 ? "done" : "fail");
      stage.style.setProperty("--t", `${-Math.round(resAge)}ms`);
      stage.style.setProperty("--oc", (CRAFT_OUTCOMES[res.outcome] ?? CRAFT_OUTCOMES[0]).color);
    }
    const chain = div("pcinv-fg-chain");
    const slot = (head: string, box: HTMLElement, name: string, sub: string, help: string, filled: boolean, onClick?: () => void): HTMLDivElement => {
      const s = div(`pcinv-fg-slot${filled ? " full" : ""}`);
      const b = div("pcinv-fg-sbox");
      b.append(box);
      s.append(div("pcinv-fg-shead", head), b, div("pcinv-fg-sname", name), div("pcinv-fg-ssub", sub));
      if (onClick) {
        s.classList.add("click");
        s.onclick = onClick;
      }
      hint(s, help);
      return s;
    };
    const arrow = (): HTMLDivElement => div("pcinv-fg-arrow", "›");
    const baseIc = div("pcinv-fg-big");
    setIcon(baseIc, sel.cls, undefined, "craft");
    chain.append(slot("Основа", baseIc, WEAPON_NOUN[sel.cls].name, "мастерское", "Основа — какое оружие куём. Нажми — выбрать.", true, () => pickOpen("base")), arrow());
    const matBox = div("pcinv-fg-mats");
    for (let i = 0; i < CRAFT.maxMats; i++) {
      const m = sel.mats[i];
      const cell = div(`pcinv-fg-mcell${m ? " full" : ""}`);
      if (m) {
        cell.innerHTML = iconHtml(`m.${m}` as IconKey);
        cell.onclick = (e) => {
          e.stopPropagation();
          sel.mats.splice(i, 1);
          redraw();
        };
        hint(cell, `${CRAFT_ITEMS[m].name} — нажми, чтобы убрать`);
      } else {
        cell.textContent = "+";
        cell.onclick = (e) => {
          e.stopPropagation();
          this.craftPick = "mat";
          redraw();
        };
        hint(cell, "Добавить материал");
      }
      matBox.append(cell);
    }
    const plan = plannedRolls(sel);
    const matRolls = plan.filter((r) => !(sel.cat && isCraftItem(sel.cat) && r.from === CRAFT_ITEMS[sel.cat].name));
    chain.append(
      slot(
        "Материал",
        matBox,
        sel.mats.length ? `${sel.mats.length} из ${CRAFT.maxMats}` : "пусто",
        matRolls.length ? matRolls.map((r) => `${AFFIX_NAME[r.sub]}${r.copies > 1 ? ` ×${r.copies}` : ""}`).join(", ") : "нажми «+»",
        "Материалы задают роллы: разные — разные роллы; одинаковые — потолок их ролла выше (+15% за копию), а у остальных роллов ниже. Тратятся. «+» — добавить, нажми на материал — убрать.",
        sel.mats.length > 0,
        () => pickOpen("mat"),
      ),
      arrow(),
    );
    const catBox = sel.cat ? div("pcinv-fg-big") : div("pcinv-fg-big empty", "—");
    if (sel.cat) catBox.innerHTML = catHtml(sel.cat);
    chain.append(
      slot("Катализатор", catBox, sel.cat ? catName(sel.cat) : "без катализатора", sel.cat ? (isCraftItem(sel.cat) ? `→ ${AFFIX_NAME[sel.cat === "frost" ? "chill" : "venom"]}` : "шансы лучше") : "необязательно", "Катализатор возвращается. Камень улучшает шансы (сильнее с уровнем), особый даёт особый ролл. Нажми — выбрать.", !!sel.cat, () => pickOpen("cat")),
      arrow(),
    );
    const meth = CRAFT_METHODS[sel.method];
    const methIc = div("pcinv-fg-big");
    methIc.innerHTML = iconHtml(`cm.${sel.method}` as IconKey);
    chain.append(slot("Метод", methIc, meth.name, `${meth.cost} лома`, `${meth.name}: ${meth.note}. Нажми — выбрать.`, true, () => pickOpen("meth")));
    stage.append(chain);
    // Выбор прямо на сцене (по нажатию ячейки цепочки): основа, материалы, катализатор, метод.
    if (this.craftPick && !(res && res.outcome >= 0 && res.at)) {
      const k = this.craftPick;
      const pk = div("pcinv-fg-pick");
      const ph = div("pcinv-fg-pickh");
      const titles = { base: "Основа — какое оружие", mat: `Материалы — ${sel.mats.length} из ${CRAFT.maxMats}`, cat: "Катализатор (вернётся)", meth: "Метод обработки" } as const;
      const x = button("✕", () => {
        closePick();
        redraw();
      });
      x.className = "pcinv-fg-pickx";
      ph.append(span(titles[k]), x);
      const row = div("pcinv-fg-items wrap");
      if (k === "base") fillBases(row, closePick);
      else if (k === "mat") fillMats(row, () => sel.mats.length >= CRAFT.maxMats && closePick());
      else if (k === "cat") fillCats(row, closePick);
      else fillMeths(row, closePick);
      pk.append(ph, row);
      if (k === "mat") {
        const done = button("Готово", () => {
          closePick();
          redraw();
        });
        done.className = "pcinv-btn sm gold";
        pk.append(done);
      }
      stage.append(pk);
    }

    // Проверка запасов: что есть и чего не хватает.
    const need = new Map<CraftMatId, number>();
    for (const m of sel.mats) need.set(m, (need.get(m) ?? 0) + 1);
    const lacks: string[] = [];
    for (const [m, n] of need) if ((stock.get(m) ?? 0) < n) lacks.push(CRAFT_ITEMS[m].name);
    if (d.scrap < meth.cost) lacks.push("лома");
    const ready = sel.mats.length > 0 && !lacks.length;
    const go = document.createElement("button");
    go.className = `pcinv-fg-go${since < 700 ? " busy" : ""}`;
    go.innerHTML = `<span class="pcinv-fg-goic">${iconHtml("cm.forge")}</span><span>Создать</span>`;
    go.disabled = !ready;
    go.onclick = () => {
      this.craftHitAt = performance.now();
      this.craftRes = null;
      this.craftPick = null;
      this.hooks.act({ act: "craft", id: craftCode(sel), idx: 0 });
      this.render();
      // Вспышка удара гаснет сама (итог перерисует окно раньше, если придёт быстрее).
      window.setTimeout(() => this.isOpen && this.tab === "craft" && this.render(), 720);
    };
    hint(go, ready ? `Создать: −${meth.cost} лома, материалы тратятся, катализатор вернётся.` : sel.mats.length ? `Не хватает: ${lacks.join(", ")}` : "Положи хотя бы один материал.");
    stage.append(go);
    if (res) stage.append(this.craftReveal(d, res));

    // ---- справа: что получится (или итог) и необходимые материалы ----
    const right = div("pcinv-fg-side pcinv-fg-right");
    const card = div("pcinv-fg-card");
    {
      const recipe = sel.mats.length ? matchRecipe(sel) : null;
      const known = recipe && c.book.includes(recipe.id) ? recipe : null;
      card.append(div("pcinv-fg-cname", known ? known.name : weaponName(sel.cls, "craft")));
      const rar = div("pcinv-fg-rar", known ? "Рецепт: не ниже хорошего" : "Исход решит удача");
      rar.style.color = known ? "#ffd38a" : "var(--tier-craft)";
      card.append(rar);
      const body = div("pcinv-fg-cbody");
      const big = div("pcinv-fg-cimg");
      setIcon(big, sel.cls, undefined, "craft");
      const rows = div("pcinv-fg-rows");
      // Потолки — при 3 роллах (хороший/отличный исход); при 2 остальные платят больше, при 4 — меньше.
      const pc = plannedCaps(sel, 3);
      const capsAt = (n: number): string => plannedCaps(sel, n).caps.map((cp, k) => `${AFFIX_NAME[plan[k].sub]} ×${cp.toFixed(2)}`).join(", ");
      plan.slice(0, CRAFT.maxRolls).forEach((r, k) => {
        const st = div("pcinv-fg-stat");
        const tag = k < pc.caps.length ? capTag(pc.caps[k]) : "";
        st.append(span(`${AFFIX_NAME[r.sub]}${r.copies > 1 ? ` ×${r.copies}` : ""}`), span(tag));
        if (tag) st.classList.add(tag.startsWith("▲") ? "up" : "down");
        st.title = `${r.from}. Потолок ролла (максимум при заточке): при 2 роллах — ${capsAt(2)}; при 3 — ${capsAt(3)}; при 4 — ${capsAt(4)}.`;
        rows.append(st);
      });
      if (pc.other < 0.9995 && plan.length < 3) {
        const st = div("pcinv-fg-stat down");
        st.append(span("случайные роллы"), span(capTag(pc.other)));
        rows.append(st);
      }
      if (known) rows.append(div("pcinv-fg-stat eff", `★ ${AFFIX_NAME[known.star]} сверх предела`));
      const lo = rollsFor(1, sel.method);
      const hi = rollsFor(CRAFT_OUTCOMES.length - 1, sel.method);
      rows.append(div("pcinv-fg-stat dim", `Роллов ${lo}–${hi} · Мастерство до +${Math.round(CRAFT_OUTCOMES[CRAFT_OUTCOMES.length - 1].pow * 100)}%`));
      body.append(big, rows);
      card.append(body);
      card.append(div("pcinv-fg-lore", known ? known.lore : "Сила — как у уникального; хороший, отличный и редкий исход добавляют «Мастерство» и роллы."));
      // Шансы исходов полосой.
      const odds = craftOdds(sel, smith.lv, !!known);
      const ob = div("pcinv-codds");
      const legend = div("pcinv-clegend");
      CRAFT_OUTCOMES.forEach((o, i) => {
        const cell = div("pcinv-codd");
        cell.style.flexGrow = String(Math.max(0.0001, odds[i]));
        cell.style.background = o.color;
        ob.append(cell);
        const l = div("pcinv-cleg");
        l.innerHTML = `<i style="background:${o.color}"></i>${o.name} ${odds[i] < 10 ? odds[i].toFixed(1) : Math.round(odds[i])}%`;
        hint(l, i === 0 ? "Провал: материалы сгорают, половина лома возвращается, катализатор цел." : `${o.name}: ${rollsFor(i, sel.method)} ролла${o.pow > 0 ? `, Мастерство +${Math.round(o.pow * 100)}% к урону` : ", сила уникального"}`);
        legend.append(l);
      });
      card.append(ob, legend);
    }
    right.append(card);
    // Необходимые материалы: есть / нужно.
    const req = div("pcinv-fg-card");
    req.append(div("pcinv-fg-sub2", "Необходимые материалы"));
    const cells = div("pcinv-fg-req");
    const reqCell = (html: string, have: number, n: number, label: string, help: string): void => {
      const cell = div(`pcinv-fg-rq${have >= n ? "" : " lack"}`);
      const ic = div("pcinv-fg-rqic");
      ic.innerHTML = html;
      // Как в концепте: «есть/нужно», есть — не больше нужного (у лома — только цена).
      ic.append(div("pcinv-fg-rqn", n >= 100 ? `${n}` : `${Math.min(have, n)}/${n}`));
      cell.append(ic, div("pcinv-fg-rql", label));
      hint(cell, help);
      cells.append(cell);
    };
    for (const [m, n] of need) reqCell(iconHtml(`m.${m}` as IconKey), stock.get(m) ?? 0, n, CRAFT_ITEMS[m].name, `${CRAFT_ITEMS[m].name}: нужно ${n}, есть ${stock.get(m) ?? 0}. Откуда: ${CRAFT_ITEMS[m].src}.`);
    if (sel.cat) reqCell(catHtml(sel.cat), 1, 1, catName(sel.cat), "Катализатор вернётся после крафта.");
    reqCell(iconHtml("i.scrap"), d.scrap, meth.cost, "Лом", `${meth.name}: ${meth.cost} лома, у тебя ${d.scrap.toLocaleString("ru-RU")}.`);
    req.append(cells);
    const status = div(`pcinv-fg-status${ready ? " ok" : ""}`, ready ? "✓ Готово к созданию" : sel.mats.length ? `Не хватает: ${lacks.join(", ")}` : "Добавь материал — с полки или «+» в ячейке");
    req.append(status);
    right.append(req);

    // Переплавка лома в сплав — отдельная карточка в левой колонке (под «Кузницей»): формула «лом → сплав» и кнопки количества.
    const sg = div("pcinv-fg-side pcinv-fg-smelt");
    sg.append(div("pcinv-fg-sub2", "Переплавка лома"));
    const eq = div("pcinv-fg-eq");
    const eqIc = (k: IconKey, n: string): HTMLDivElement => {
      const b = div("pcinv-fg-itic");
      b.innerHTML = iconHtml(k);
      b.append(div("pcinv-fg-cnt", n));
      return b;
    };
    eq.append(eqIc("i.scrap", String(CRAFT_SMELT)), div("pcinv-fg-eqar", "→"), eqIc("m.alloy", "1"));
    const btns = div("pcinv-fg-smb");
    for (const n of [1, 5, 10]) {
      const b = button(`×${n}`, () => this.hooks.act({ act: "smelt", id: "alloy", idx: n }));
      b.disabled = d.scrap < n * CRAFT_SMELT;
      b.title = `Переплавить ${n * CRAFT_SMELT} лома → ${CRAFT_ITEMS.alloy.name} ×${n}`;
      hint(b, b.title + (b.disabled ? ` — не хватает лома (есть ${d.scrap.toLocaleString("ru-RU")})` : ""));
      btns.append(b);
    }
    eq.append(btns);
    sg.append(eq, div("pcinv-small", `${CRAFT_ITEMS.alloy.name} — материал на ролл «Урон». Лома: ${d.scrap.toLocaleString("ru-RU")}`));
    // Итог переплавки (в игре — сюда же, на странице !inv — всплывашкой).
    if (this.lastResult?.text.startsWith("Переплавлено")) sg.append(div(`pcinv-fg-smres${this.lastResult.up ? "" : " bad"}`, this.lastResult.text));
    // ---- внизу: полки — материалы, катализаторы, методы (то же, что выбор в ячейках цепочки) ----
    const shelf = div("pcinv-fg-shelf");
    const group = (title: string, cls = ""): HTMLDivElement => {
      const g = div(`pcinv-fg-grp${cls ? ` ${cls}` : ""}`);
      g.append(div("pcinv-fg-gt", title));
      const row = div("pcinv-fg-items");
      g.append(row);
      shelf.append(g);
      return row;
    };
    fillMats(group("Материалы"));
    fillCats(group("Катализаторы", "cats"));
    fillMeths(group("Методы обработки"));

    const lcol = div("pcinv-fg-lcol");
    lcol.append(left, sg);
    // Подсказки — внутри кузницы, внизу под наковальней.
    stage.append(hintEl);
    root.append(lcol, stage, right, shelf);
    this.body.append(root);
  }

  /** Итог крафта — окном посередине кузницы: исход, оружие подробно (роллы с очками, «Мастерство», атака) и «Закрыть». */
  /**
   * Эффекты итога крафта — по исходу, по нарастающей: провал — дым; обычный — белые искры; хороший — зелёный
   * всплеск и кольца; отличный — синие лучи; редкий — золотая вспышка, лучи и две волны искр.
   * Разброс искр — от времени итога (seed), чтобы перерисовка не меняла картинку.
   */
  private craftFx(outcome: number, seed: number): HTMLDivElement {
    let x = seed >>> 0 || 1;
    const rnd = (): number => {
      x = (x + 0x6d2b79f5) >>> 0;
      let t = Math.imul(x ^ (x >>> 15), x | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const fx = div("pcinv-fg-fx");
    const el = (cls: string, vars: Record<string, string>): void => {
      const e = document.createElement("i");
      e.className = cls;
      for (const [k, v] of Object.entries(vars)) e.style.setProperty(k, v);
      fx.append(e);
    };
    if (outcome <= 0) {
      for (let i = 0; i < 10; i++) el("puff", { "--x": `${Math.round((rnd() - 0.5) * 170)}px`, "--s": `${Math.round(60 + rnd() * 70)}px`, "--d": `${Math.round(rnd() * 420)}ms` });
      return fx;
    }
    if (outcome >= 4) el("flash", {});
    if (outcome >= 3) el("rays", {});
    el("ring", {});
    if (outcome >= 2) el("ring", { "--d": "180ms" });
    if (outcome >= 4) el("ring", { "--d": "360ms" });
    const n = [0, 12, 18, 28, 42][Math.min(4, outcome)];
    const reach = 90 + outcome * 35;
    for (let i = 0; i < n; i++) {
      const wave = outcome >= 4 && i >= n / 2 ? 420 : 0;
      el("spark", {
        "--a": `${Math.round(rnd() * 360)}deg`,
        "--r": `${Math.round(reach * (0.55 + rnd() * 0.6))}px`,
        "--s": `${(2.5 + rnd() * (2 + outcome)).toFixed(1)}px`,
        "--d": `${Math.round(wave + rnd() * 160)}ms`,
        "--l": `${Math.round(650 + rnd() * 500)}ms`,
      });
    }
    return fx;
  }

  private craftReveal(d: PcInvData, res: NonNullable<typeof this.craftRes>): HTMLDivElement {
    const o = CRAFT_OUTCOMES[res.outcome] ?? CRAFT_OUTCOMES[0];
    const w = res.id ? d.weapons.find((x) => x.id === res.id) : undefined;
    const rc = res.found ? CRAFT_RECIPES.find((r) => r.id === res.found) : undefined;
    // Исход — класс o0…o4: чем лучше, тем ярче (дым → искры → кольца → лучи → золотая вспышка).
    const wrap = div(`pcinv-fg-reveal o${res.outcome}${res.outcome > 0 ? "" : " fail"}${rc ? " found" : ""}`);
    // Сколько уже идёт анимация — перерисовка продолжает её с этого места (без мигания).
    wrap.style.setProperty("--t", `${-Math.round(Math.max(0, Date.now() - (res.at ?? Date.now())))}ms`);
    wrap.style.setProperty("--oc", o.color);
    wrap.append(this.craftFx(res.outcome, res.at ?? 1));
    const card = div("pcinv-fg-rcard");
    const head = div("pcinv-fg-rhead", res.outcome > 0 ? `${o.name} исход!` : "Провал");
    head.style.color = o.color;
    card.append(head);
    if (rc) card.append(div("pcinv-fg-rfound", `📜 Найден скрытый рецепт «${rc.name}»`));
    if (w) {
      const top = div("pcinv-fg-rtop");
      const ico = div(`pcinv-cell huge t-${w.tier}${isCraftRare(w) ? " craft-rare" : ""} pcinv-fg-rico`);
      setIcon(ico, w.cls, w.name, w.tier);
      const info = div("pcinv-fg-rinfo");
      info.append(div(`pcinv-card-name t-${w.tier}`, w.name));
      const q = w.affixes.length ? qualityStarsShort(w.quality, w.affixes.length) : "";
      const sub = div("pcinv-small");
      sub.innerHTML = `${cap(TIER_LOOK[w.tier].name)}${q ? ` · оценка <b>${q}</b>` : ""}`;
      info.append(sub);
      const atk = attackLabel(w.cls, w.tier, sharpPctOf(w), craftPow(w) * 100);
      if (atk) info.append(div("pcinv-tipatk", atk));
      top.append(ico, info);
      card.append(top);
      // Роллы с очками — как строки заточки, только без кнопок.
      w.affixes.forEach((label, i) => {
        const e = w.ench[i];
        const row = div("pcinv-fg-rroll");
        const lab = div("pcinv-elabel");
        lab.append(span(label), span(e ? `${e.points} / ${e.of}` : ""));
        if (e?.capNote) lab.append(div("pcinv-fg-capnote", e.capNote));
        const bar = div("pcinv-ebar");
        const fill = div("pcinv-efill");
        fill.style.width = e ? `${Math.round((e.points / e.of) * 100)}%` : "0";
        bar.append(fill);
        row.append(lab, bar);
        card.append(row);
      });
      for (const e of w.effects ?? []) card.append(div("pcinv-tipeff", e));
      if (rc) card.append(div("pcinv-fg-lore", rc.lore));
    } else card.append(div("pcinv-fg-rtext", res.text));
    const acts = div("pcinv-fg-acts");
    const close = button("Закрыть", () => {
      this.craftRes = null;
      this.render();
    });
    close.className = "pcinv-btn gold";
    acts.append(close);
    if (w) {
      const see = button("В сумке", () => {
        this.tab = "gear";
        this.craftRes = null;
        this.openCard({ kind: "bag", id: w.id });
      });
      see.className = "pcinv-btn";
      acts.append(see);
    }
    card.append(acts);
    wrap.append(card);
    return wrap;
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
    const atk = attackLabel(cls, tier, w ? sharpPctOf(w) : 0, w ? craftPow(w) * 100 : 0);
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
.pcinv-tabs { display:flex; gap:2px; flex:1; min-width:0; overflow-x:auto; overflow-y:hidden; scrollbar-width:none; }
.pcinv-tabs::-webkit-scrollbar { display:none; }
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
${["gold", "legendary", "ruby", "craft"].map(tier).join("\n")}
/* Редкое мастерское (исход крафта «редкий»): цвет тира тот же, рамка толще, светится и пульсирует. */
/* Рамка — как у тира (цвет и градиент те же), чуть толще; свечение заметно пульсирует. */
.pcinv-cell.craft-rare { --bw:1.8px; animation:pcinvRareGlow 2.2s ease-in-out infinite; animation-delay:var(--now,0ms); }
@keyframes pcinvRareGlow { 0%,100% { filter:drop-shadow(0 0 3px var(--tier-craft)); } 50% { filter:drop-shadow(0 0 10px var(--tier-craft)); } }
/* Само оружие на значке слегка светится цветом тира. */
.pcinv-cell.craft-rare > .gico { filter:drop-shadow(0 0 3px var(--tier-craft)) drop-shadow(0 0 7px color-mix(in srgb,var(--tier-craft) 65%,transparent)) brightness(1.08); }
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
.pcinv-ci-nick { position:relative; width:100%; box-sizing:border-box; text-align:center; font:700 24px/1.1 "Iowan Old Style",Georgia,serif; color:#f3ead7; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  padding:6px 26px; letter-spacing:.05em; text-shadow:0 1px 0 #000,0 0 8px rgba(201,168,106,.2);
  border-top:1px solid rgba(201,168,106,.3); border-bottom:1px solid rgba(201,168,106,.3);
  background:linear-gradient(90deg,transparent,rgba(201,168,106,.06) 30%,rgba(201,168,106,.06) 70%,transparent); }
.pcinv-ci-nick::before, .pcinv-ci-nick::after { content:"◆"; position:absolute; top:50%; transform:translateY(-50%); color:rgba(201,168,106,.55); font-size:9px; }
.pcinv-ci-nick::before { left:8px; } .pcinv-ci-nick::after { right:8px; }
.pcinv-ci-lvrow { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:2px; }
.pcinv-ci-title { max-width:60%; flex:0 1 auto; min-width:0; margin:0; }
.pcinv-ci-lv { margin-top:2px; font-size:14px; color:#e5ecf4; white-space:nowrap; }
.pcinv-xp { position:relative; width:100%; height:18px; border-radius:9px; background:#0d1a2b; border:1px solid #2a3b52; box-shadow:inset 0 1px 3px rgba(0,0,0,.6); overflow:hidden; }
.pcinv-xp-fill { position:absolute; left:0; top:0; bottom:0; width:0; background:linear-gradient(90deg,#14467d,#2a6fb0); box-shadow:0 0 5px rgba(40,110,190,.55); }
.pcinv-xp-text { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; padding:0 6px;
  font-size:11.5px; color:#f2f6fb; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-shadow:0 1px 2px #000, 0 0 3px #000; }
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
.pcinv-card-name.t-gold { color:var(--tier-gold); } .pcinv-card-name.t-legendary { color:var(--tier-legendary); } .pcinv-card-name.t-ruby { color:var(--tier-ruby); } .pcinv-card-name.t-craft { color:var(--tier-craft); }
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
.pcinv-name.t-gold { color:var(--tier-gold); } .pcinv-name.t-legendary { color:var(--tier-legendary); } .pcinv-name.t-ruby { color:var(--tier-ruby); } .pcinv-name.t-craft { color:var(--tier-craft); } .pcinv-name.t-base { color:#dedede; }
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
/* ---------- «Крафт»: кузница (концепт «Кузница берсерка») ---------- */
.pcinv-smithy { display:grid; grid-template-columns:270px minmax(0,1fr) 270px; grid-template-areas:"left stage right" "shelf shelf shelf"; gap:10px; align-items:start; }
.pcinv-fg-side { position:relative; display:flex; flex-direction:column; gap:6px; padding:12px; border:1px solid #2f4664; background:linear-gradient(180deg,rgba(9,19,34,.92),rgba(5,11,21,.92)); box-shadow:inset 0 0 0 1px rgba(0,0,0,.6); clip-path:${CUT("9px")}; }
.pcinv-fg-lcol { grid-area:left; display:flex; flex-direction:column; gap:10px; align-self:stretch; }
.pcinv-fg-left { flex:1; }
.pcinv-fg-right { grid-area:right; padding:0; gap:10px; border:none; background:none; box-shadow:none; clip-path:none; }
.pcinv-fg-title { font:700 22px/1.1 "Iowan Old Style",Georgia,serif; color:#dbe8f6; padding-bottom:6px; border-bottom:1px solid #1d2d43; }
.pcinv-fg-sub { margin-top:8px; font:600 14px "Iowan Old Style",Georgia,serif; color:#b9c8da; }
.pcinv-fg-sub2 { font:600 16px "Iowan Old Style",Georgia,serif; color:#dbe8f6; margin-bottom:8px; }
.pcinv-fg-smith { display:flex; flex-direction:column; gap:4px; padding:8px 10px; border:1px solid #6b3a12; background:rgba(46,26,12,.6); }
.pcinv-fg-smlv { font:800 14px system-ui; color:var(--tier-craft); }
.pcinv-cbar { height:7px; background:#1a120a; border:1px solid #5a3410; }
.pcinv-cbar-f { height:100%; background:linear-gradient(90deg,#b84f00,#f0832a); }
.pcinv-fg-row { display:flex; align-items:center; gap:10px; min-height:40px; padding:4px 10px; cursor:pointer; border:1px solid #22354f; background:rgba(10,22,38,.7); color:#dbe6f2; font-size:13.5px; }
.pcinv-fg-row:hover { border-color:#4f6f96; }
.pcinv-fg-row.on { border-color:#d9a95a; background:linear-gradient(90deg,rgba(60,70,95,.85),rgba(20,32,52,.85)); box-shadow:0 0 0 1px rgba(217,169,90,.35),0 0 12px rgba(217,169,90,.18); color:#fff; }
.pcinv-fg-row.rec { min-height:46px; }
.pcinv-fg-rtxt { display:flex; flex-direction:column; }
.pcinv-fg-rname { font-weight:700; color:var(--tier-craft); }
.pcinv-fg-empty { padding:4px 2px; line-height:1.4; }
.pcinv-fg-ic { width:30px; height:30px; flex:none; display:flex; align-items:center; justify-content:center; }
.pcinv-fg-ic .gico { width:30px; height:30px; }
/* сцена: кузница с наковальней, цепочка ячеек над ней, «Создать» — на наковальне */
/* Высота вкладки — по экрану: кузница (квадрат) не выше окна минус шапка и полки, колонки по бокам — не выше кузницы. */
.pcinv-smithy { --fg-h:min(620px, calc(94vh - 234px)); }
.pcinv-root.page .pcinv-smithy { --fg-h:min(620px, calc(100vh - 234px)); }
.pcinv-fg-lcol, .pcinv-fg-right { max-height:var(--fg-h); overflow-y:auto; scrollbar-width:thin; scrollbar-color:#2c3e57 transparent; }
/* Фон — кузница у горного замка (концепт) на весь экран: в игре — всё окно, на странице !inv — фон страницы
   (inv/main.ts placeBg ставит наковальню под «Создать»); наковальня — по центру, под цепочкой. */
.pcinv-smithy { padding:10px; }
.pcinv-root.tab-craft:not(.page) .pcinv-win { background:#120a05 url(/icons/craft/forge_hall.jpg) center 64%/cover no-repeat; }
.pcinv-fg-stage { grid-area:stage; position:relative; aspect-ratio:1/1; width:100%; max-width:var(--fg-h); justify-self:center; overflow:hidden; }
.pcinv-fg-stage::after { content:""; position:absolute; left:50%; top:74%; width:70%; height:40%; transform:translate(-50%,-50%); pointer-events:none; opacity:0; background:radial-gradient(ellipse at center,rgba(255,170,60,.85),rgba(255,90,10,.35) 40%,transparent 70%); mix-blend-mode:screen; }
/* Вспышки на наковальне идут с отрицательной задержкой (--th/--t = сколько прошло): перерисовка их не перезапускает. */
.pcinv-fg-stage.hit::after { animation:pcinvFgHit .7s ease-out both; animation-delay:var(--th,0ms); }
.pcinv-fg-stage.done::after { background:radial-gradient(ellipse at center,color-mix(in srgb,var(--oc,#ffaa3c) 85%,#fff),color-mix(in srgb,var(--oc,#ff5a0a) 40%,transparent) 40%,transparent 70%); animation:pcinvFgDone 1.4s ease-out both; animation-delay:var(--t,0ms); }
.pcinv-fg-stage.fail::after { background:radial-gradient(ellipse at center,rgba(180,180,190,.6),rgba(60,60,70,.3) 45%,transparent 70%); mix-blend-mode:normal; animation:pcinvFgDone 1.4s ease-out both; animation-delay:var(--t,0ms); }
@keyframes pcinvFgHit { 0% { opacity:0; } 12% { opacity:1; transform:translate(-50%,-50%) scale(.6); } 100% { opacity:0; transform:translate(-50%,-50%) scale(1.3); } }
@keyframes pcinvFgDone { 0% { opacity:1; transform:translate(-50%,-50%) scale(.8); } 100% { opacity:0; transform:translate(-50%,-50%) scale(1.6); } }
.pcinv-fg-chain { position:absolute; left:3%; right:3%; top:27%; display:flex; align-items:center; gap:1.2%; }
.pcinv-fg-arrow { flex:none; color:#e8c27a; font:700 26px system-ui; text-shadow:0 0 8px rgba(255,160,60,.6); }
.pcinv-fg-slot { flex:1 1 0; min-width:0; display:flex; flex-direction:column; align-items:stretch; background:linear-gradient(180deg,rgba(8,14,24,.92),rgba(6,10,18,.88)); border:1px solid #5d4a2c; box-shadow:0 6px 18px rgba(0,0,0,.55); }
.pcinv-fg-slot.click { cursor:pointer; }
.pcinv-fg-slot.full .pcinv-fg-sbox { border-color:#c8a35e; box-shadow:inset 0 0 18px rgba(240,160,70,.18); }
.pcinv-fg-shead { padding:4px 4px; text-align:center; font:600 13px "Iowan Old Style",Georgia,serif; color:#eadcc2; background:linear-gradient(180deg,#2a2f3c,#161a24); border-bottom:1px solid #5d4a2c; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pcinv-fg-sbox { position:relative; margin:6px; aspect-ratio:1/1; display:flex; align-items:center; justify-content:center; border:2px solid #7a6440; background:radial-gradient(ellipse at 50% 40%,#1c2a40,#070d18 80%); }
.pcinv-fg-big { width:78%; height:78%; display:flex; align-items:center; justify-content:center; }
.pcinv-fg-big .gico { width:100%; height:100%; }
.pcinv-fg-big.empty { color:#5d6f88; font:700 26px system-ui; }
.pcinv-fg-mats { position:absolute; inset:6%; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:minmax(0,1.3fr) minmax(0,1fr); gap:4px; }
.pcinv-fg-mcell { min-width:0; min-height:0; overflow:hidden; border:1px dashed #3a4f6b; display:flex; align-items:center; justify-content:center; }
.pcinv-fg-mcell:first-child { grid-column:1 / span 2; }
.pcinv-fg-mcell.full { border:1px solid #8a6a3a; cursor:pointer; background:rgba(60,36,12,.35); }
.pcinv-fg-mcell .gico { max-width:86%; max-height:86%; width:auto; height:86%; aspect-ratio:1/1; object-fit:contain; }
.pcinv-fg-sname { padding:0 4px; text-align:center; font-weight:700; font-size:12.5px; color:#f2e7d2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pcinv-fg-ssub { padding:0 4px 6px; text-align:center; font-size:11px; color:#a8b4c4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pcinv-fg-go { position:absolute; left:50%; top:78%; transform:translate(-50%,-50%); display:flex; align-items:center; gap:10px; padding:10px 34px; min-height:52px; cursor:pointer; border:none; color:#fbe9c6;
  font:700 22px "Iowan Old Style",Georgia,serif; letter-spacing:.02em; background:linear-gradient(180deg,#3b3020,#17110a); clip-path:${HEX("18px")};
  filter:drop-shadow(0 0 10px rgba(255,150,50,.45)); }
.pcinv-fg-go::before { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(180deg,#f1d08c,#8a6326); clip-path:${HEX("18px")}; }
.pcinv-fg-go { isolation:isolate; }
.pcinv-fg-go::after { content:""; position:absolute; inset:2px; z-index:-1; background:linear-gradient(180deg,#2b2418,#110c07); clip-path:${HEX("17px")}; }
.pcinv-fg-go:hover:not(:disabled) { filter:drop-shadow(0 0 16px rgba(255,170,70,.75)); color:#fff; }
.pcinv-fg-go:disabled { opacity:.55; cursor:default; filter:grayscale(.6); }
.pcinv-fg-go.busy { animation:pcinvFgShake .35s ease-out; animation-delay:var(--th,0ms); }
@keyframes pcinvFgShake { 0%,100% { transform:translate(-50%,-50%); } 30% { transform:translate(-50%,-46%); } 60% { transform:translate(-50%,-52%); } }
.pcinv-fg-goic { width:28px; height:28px; display:flex; }
.pcinv-fg-goic .gico { width:28px; height:28px; }
/* справа: карточка оружия и необходимые материалы */
/* Без анимации появления: окно перерисовывается при каждом изменении — анимация запускалась бы заново (мигание). */
.pcinv-fg-card { position:relative; display:flex; flex-direction:column; gap:6px; padding:12px 14px; border:1px solid #2f4664; background:linear-gradient(180deg,rgba(9,19,34,.94),rgba(5,11,21,.94)); clip-path:${CUT("9px")}; }
.pcinv-fg-cname { font:700 19px/1.15 "Iowan Old Style",Georgia,serif; color:#eef3f9; }
.pcinv-fg-rar { font-weight:700; font-size:13px; }
.pcinv-fg-cbody { display:flex; gap:8px; align-items:flex-start; }
.pcinv-fg-cimg { width:58px; height:58px; flex:none; display:flex; align-items:center; justify-content:center; border:1px solid #7a6440; background:radial-gradient(ellipse at 50% 40%,#2a1a10,#0b0806 80%); font-size:26px; }
.pcinv-fg-cimg .gico { width:52px; height:52px; }
.pcinv-fg-rows { flex:1; min-width:0; display:flex; flex-direction:column; }
.pcinv-fg-stat { display:flex; justify-content:space-between; align-items:baseline; gap:4px; padding:4px 0; border-bottom:1px solid #1d2d43; font-size:12.5px; color:#dbe6f2; }
/* Имя ролла может сократиться многоточием, а метка потолка («▲ +30%») — никогда. */
.pcinv-fg-stat > span:first-child { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pcinv-fg-stat > span:last-child { flex:none; color:#9aa8ba; text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
.pcinv-fg-stat.up > span:last-child { color:#7fe08a; }
.pcinv-fg-capnote { flex-basis:100%; font-size:11px; color:#9aa8ba; }
.pcinv-fg-stat.down > span:last-child { color:#ff9a7a; }
.pcinv-fg-stat.eff { color:#ffd38a; }
.pcinv-fg-stat.dim { color:#9aa8ba; border-bottom:none; }
.pcinv-fg-lore { font-size:12px; color:#b7c2d0; font-style:italic; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.pcinv-fg-rcard .pcinv-fg-lore { -webkit-line-clamp:unset; }
.pcinv-fg-acts { display:flex; gap:8px; flex-wrap:wrap; }
.pcinv-codds { display:flex; height:10px; border:1px solid #2d405a; overflow:hidden; }
.pcinv-codd { flex-basis:0; min-width:0; }
.pcinv-clegend { display:flex; flex-wrap:wrap; gap:3px 10px; font-size:11.5px; color:#c9d5e3; }
.pcinv-cleg i { display:inline-block; width:8px; height:8px; margin-right:4px; vertical-align:middle; }
.pcinv-fg-req { display:flex; flex-wrap:wrap; gap:8px; }
.pcinv-fg-rq { width:56px; display:flex; flex-direction:column; align-items:center; gap:3px; }
.pcinv-fg-rqic { position:relative; width:52px; height:52px; display:flex; align-items:center; justify-content:center; border:1px solid #7a6440; background:radial-gradient(ellipse at 50% 40%,#1c2a40,#070d18 80%); }
.pcinv-fg-rqic .gico, .pcinv-fg-rqic > span { width:40px !important; height:40px !important; }
.pcinv-fg-rqn { position:absolute; left:0; right:0; bottom:1px; text-align:center; font:700 11px system-ui; color:#e8eef6; text-shadow:0 1px 2px #000,0 0 3px #000; }
.pcinv-fg-rq.lack .pcinv-fg-rqic { border-color:#a8433a; }
.pcinv-fg-rq.lack .pcinv-fg-rqn { color:#ff8f84; }
.pcinv-fg-rql { font-size:10.5px; color:#a8b4c4; text-align:center; line-height:1.15; max-width:60px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pcinv-fg-status { margin-top:6px; padding:9px 12px; text-align:center; font:600 14px "Iowan Old Style",Georgia,serif; color:#ffb0a6; border:1px solid #6a2a24; background:rgba(40,14,12,.6); clip-path:${HEX("14px")}; }
.pcinv-fg-status.ok { color:#b9f5d0; border-color:#2f7a5a; background:linear-gradient(180deg,rgba(14,52,44,.85),rgba(8,30,26,.85)); }
/* внизу: полки */
.pcinv-fg-shelf { grid-area:shelf; display:flex; gap:10px; padding:8px 10px; border:1px solid #2f4664; background:linear-gradient(180deg,rgba(9,19,34,.92),rgba(5,11,21,.92)); }
.pcinv-fg-grp { flex:none; display:flex; flex-direction:column; gap:4px; min-width:0; }
.pcinv-fg-grp.cats { flex:1 1 0; }
.pcinv-fg-grp + .pcinv-fg-grp { padding-left:10px; border-left:1px solid #1d2d43; }
.pcinv-fg-gt { font-size:12.5px; color:#7fb2e6; }
/* плитки предметов (полки, выбор на сцене, переплавка) */
.pcinv-fg-items { display:flex; gap:6px; overflow-x:auto; scrollbar-width:thin; scrollbar-color:#2c3e57 transparent; padding-bottom:2px; }
.pcinv-fg-it { flex:none; width:64px; display:flex; flex-direction:column; align-items:center; gap:2px; cursor:pointer; padding:3px 0; border:1px solid transparent; }
.pcinv-fg-it:hover { border-color:#3a5576; background:rgba(20,40,66,.4); }
.pcinv-fg-it.on { border-color:var(--tier-craft); background:rgba(70,36,8,.55); box-shadow:0 0 10px rgba(240,131,42,.25); }
.pcinv-fg-it.off { opacity:.4; cursor:default; }
.pcinv-fg-itic { position:relative; width:48px; height:48px; display:flex; align-items:center; justify-content:center; }
.pcinv-fg-itic .gico { width:46px; height:46px; }
.pcinv-fg-itic > span { width:44px !important; height:44px !important; }
.pcinv-fg-cnt { position:absolute; right:-2px; bottom:-2px; padding:0 3px; font:700 11px system-ui; color:#fff; background:rgba(0,0,0,.65); border-radius:3px; }
.pcinv-fg-itl { font-size:11px; color:#c3cedb; text-align:center; line-height:1.15; max-width:64px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.pcinv-fg-smelt { flex:none; }
.pcinv-fg-eq { display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; }
.pcinv-fg-eqar { color:#e8c27a; font:700 22px system-ui; text-shadow:0 0 8px rgba(255,160,60,.5); }
.pcinv-fg-smb { display:flex; gap:6px; width:100%; }
.pcinv-fg-smb .pcinv-ebtn { flex:1; min-height:32px; padding:4px 8px; font-size:12.5px; }
.pcinv-fg-smres { font-size:12px; color:#a9f0b4; }
.pcinv-fg-smres.bad { color:#ffb0a6; }
/* выбор на сцене по нажатию ячейки цепочки */
.pcinv-fg-slot.click:hover { border-color:#e8c27a; box-shadow:0 0 14px rgba(232,194,122,.35),0 6px 18px rgba(0,0,0,.55); }
.pcinv-fg-mcell:not(.full) { color:#6f86a6; font:700 20px system-ui; cursor:pointer; }
.pcinv-fg-mcell:not(.full):hover { color:#e8c27a; border-color:#e8c27a; }
.pcinv-fg-pick { position:absolute; left:4%; right:4%; top:59%; bottom:3%; z-index:3; display:flex; flex-direction:column; gap:6px; padding:8px 10px; overflow:hidden;
  border:1px solid #c8a35e; background:linear-gradient(180deg,#0a1220,#060a12); box-shadow:0 10px 30px rgba(0,0,0,.6); }
.pcinv-fg-pickh { display:flex; align-items:center; justify-content:space-between; gap:8px; font:600 14px "Iowan Old Style",Georgia,serif; color:#eadcc2; }
.pcinv-fg-pickx { min-height:26px !important; padding:2px 10px !important; }
.pcinv-fg-items.wrap { flex-wrap:wrap; overflow-x:hidden; overflow-y:auto; min-height:0; flex:1; align-content:flex-start; }
.pcinv-fg-pick > .pcinv-btn { align-self:flex-end; }
.pcinv-fg-none { color:#7f8ea4; font:700 24px system-ui; }
/* итог крафта — окном посередине кузницы */
/* Все анимации итога — с задержкой calc(--t + --d): --t отрицательная «сколько уже прошло», поэтому перерисовка
   окна продолжает их с того же места. Сила эффектов — по исходу (o0 провал … o4 редкий), цвет — --oc исхода. */
.pcinv-fg-reveal { position:absolute; inset:0; z-index:5; display:flex; align-items:center; justify-content:center; padding:4%; overflow:hidden;
  background:radial-gradient(ellipse at 50% 50%,color-mix(in srgb,var(--oc) 22%,rgba(4,6,10,.55)),rgba(4,6,10,.78) 70%);
  animation:pcinvFgFade .3s ease-out both; animation-delay:var(--t,0ms); }
.pcinv-fg-reveal.fail { background:rgba(8,8,10,.72); }
/* !important — правила ниже задают animation сокращённо (оно сбросило бы задержку). Псевдоэлементы сюда не попадают. */
.pcinv-fg-reveal * { animation-delay:calc(var(--t,0ms) + var(--d,0ms)) !important; }
@keyframes pcinvFgFade { from { opacity:0; } to { opacity:1; } }
.pcinv-fg-fx { position:absolute; left:50%; top:50%; width:0; height:0; pointer-events:none; }
.pcinv-fg-fx > i { position:absolute; left:0; top:0; display:block; }
/* искры: летят из центра по лучу --a на --r */
.pcinv-fg-fx .spark { width:var(--s); height:var(--s); margin:calc(var(--s) / -2); border-radius:50%; background:#fff;
  box-shadow:0 0 6px 2px var(--oc),0 0 14px 4px color-mix(in srgb,var(--oc) 60%,transparent); opacity:0;
  animation:pcinvFgSpark var(--l,900ms) cubic-bezier(.1,.7,.3,1) both; }
@keyframes pcinvFgSpark { 0% { opacity:1; transform:rotate(var(--a)) translateX(0) scale(1.3); } 70% { opacity:.9; } 100% { opacity:0; transform:rotate(var(--a)) translateX(var(--r)) scale(.3); } }
/* кольцо-волна */
.pcinv-fg-fx .ring { width:40px; height:40px; margin:-20px; border-radius:50%; border:3px solid var(--oc); box-shadow:0 0 18px var(--oc),inset 0 0 12px var(--oc); opacity:0;
  animation:pcinvFgRing .9s ease-out both; }
@keyframes pcinvFgRing { 0% { opacity:.95; transform:scale(.3); } 100% { opacity:0; transform:scale(9); } }
/* лучи (отличный, редкий): вращаются за карточкой */
.pcinv-fg-fx .rays { width:900px; height:900px; margin:-450px; border-radius:50%; opacity:0;
  background:repeating-conic-gradient(from 0deg,color-mix(in srgb,var(--oc) 38%,transparent) 0deg 7deg,transparent 7deg 22deg);
  -webkit-mask-image:radial-gradient(circle,#000 8%,transparent 62%); mask-image:radial-gradient(circle,#000 8%,transparent 62%);
  animation:pcinvFgRaysIn .8s ease-out both,pcinvFgSpin 14s linear infinite; }
.pcinv-fg-reveal.o4 .pcinv-fg-fx .rays { background:repeating-conic-gradient(from 0deg,rgba(255,214,120,.45) 0deg 6deg,transparent 6deg 16deg); }
@keyframes pcinvFgRaysIn { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:none; } }
@keyframes pcinvFgSpin { from { rotate:0deg; } to { rotate:360deg; } }
/* вспышка (редкий): весь экран кузницы */
.pcinv-fg-fx .flash { left:-2000px; top:-2000px; width:4000px; height:4000px; background:radial-gradient(circle,rgba(255,236,190,.95),rgba(255,170,60,.5) 25%,transparent 55%);
  opacity:0; animation:pcinvFgFlash .9s ease-out both; }
@keyframes pcinvFgFlash { 0% { opacity:0; } 15% { opacity:1; } 100% { opacity:0; } }
/* дым (провал) */
.pcinv-fg-fx .puff { width:var(--s); height:var(--s); margin:calc(var(--s) / -2); left:var(--x); border-radius:50%; opacity:0;
  background:radial-gradient(circle,rgba(170,170,180,.55),rgba(90,90,100,.25) 55%,transparent 70%); animation:pcinvFgPuff 1.6s ease-out both; }
@keyframes pcinvFgPuff { 0% { opacity:.8; transform:translateY(30px) scale(.4); } 100% { opacity:0; transform:translateY(-150px) scale(1.8); } }
/* карточка: появляется после вспышки, по исходу — сила свечения */
.pcinv-fg-rcard { position:relative; width:min(100%,430px); max-height:100%; overflow-y:auto; display:flex; flex-direction:column; gap:8px; padding:14px 16px; border:1px solid var(--oc);
  background:linear-gradient(180deg,rgba(28,18,10,.97),rgba(10,8,6,.97)); box-shadow:0 0 30px color-mix(in srgb,var(--oc) 45%,transparent),0 14px 40px rgba(0,0,0,.7);
  animation:pcinvFgPop .45s cubic-bezier(.2,1.4,.4,1) both; --d:120ms; scrollbar-width:thin; }
.pcinv-fg-reveal.o3 .pcinv-fg-rcard { box-shadow:0 0 44px color-mix(in srgb,var(--oc) 60%,transparent),0 14px 40px rgba(0,0,0,.7); }
.pcinv-fg-reveal.o4 .pcinv-fg-rcard { border-color:#ffd27a; box-shadow:0 0 60px rgba(255,190,90,.7),0 0 0 1px rgba(255,220,150,.6),0 14px 40px rgba(0,0,0,.7); --d:260ms; }
.pcinv-fg-reveal.fail .pcinv-fg-rcard { border-color:#8a4038; box-shadow:0 14px 40px rgba(0,0,0,.7); animation:pcinvFgPop .4s ease-out both,pcinvFgShakeX .5s ease-in-out both; --d:200ms; }
@keyframes pcinvFgPop { from { opacity:0; transform:scale(.8); } to { opacity:1; transform:none; } }
@keyframes pcinvFgShakeX { 0%,100% { translate:0; } 20% { translate:-9px; } 40% { translate:8px; } 60% { translate:-5px; } 80% { translate:3px; } }
/* блик по карточке (отличный, редкий) */
.pcinv-fg-reveal.o3 .pcinv-fg-rcard::after, .pcinv-fg-reveal.o4 .pcinv-fg-rcard::after { content:""; position:absolute; inset:0; pointer-events:none;
  background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.22) 50%,transparent 65%); background-size:250% 100%;
  animation:pcinvFgSheen 1.1s ease-out both; animation-delay:calc(var(--t,0ms) + 500ms); }
@keyframes pcinvFgSheen { from { background-position:120% 0; } to { background-position:-120% 0; } }
.pcinv-fg-rhead { text-align:center; font:700 26px/1.1 "Iowan Old Style",Georgia,serif; text-shadow:0 0 14px currentColor; }
.pcinv-fg-reveal.o3 .pcinv-fg-rhead { font-size:29px; }
/* редкий: переливающееся золотом название */
.pcinv-fg-reveal.o4 .pcinv-fg-rhead { font-size:32px; color:transparent !important; text-shadow:none; filter:drop-shadow(0 0 10px rgba(255,190,90,.8));
  background:linear-gradient(90deg,#ffb347,#fff3c4,#ffb347,#ffe08a,#ffb347); background-size:300% 100%; -webkit-background-clip:text; background-clip:text;
  animation:pcinvFgGold 2.4s linear infinite; }
@keyframes pcinvFgGold { from { background-position:0% 0; } to { background-position:300% 0; } }
/* оружие в карточке: свечение по исходу, у редкого — пульс */
.pcinv-fg-reveal .pcinv-fg-rico { box-shadow:0 0 calc(8px + var(--glow,1) * 8px) color-mix(in srgb,var(--oc) 70%,transparent) !important; }
.pcinv-fg-reveal.o2 { --glow:1.5; } .pcinv-fg-reveal.o3 { --glow:2.2; } .pcinv-fg-reveal.o4 { --glow:3; }
.pcinv-fg-reveal.o4 .pcinv-fg-rico { animation:pcinvFgPulse 1.6s ease-in-out infinite; }
@keyframes pcinvFgPulse { 0%,100% { filter:brightness(1); } 50% { filter:brightness(1.35) drop-shadow(0 0 10px rgba(255,200,100,.8)); } }
.pcinv-fg-reveal.found .pcinv-fg-rfound { animation:pcinvFgPop .5s cubic-bezier(.2,1.4,.4,1) both; --d:700ms; text-shadow:0 0 12px rgba(255,200,100,.7); }
.pcinv-fg-rfound { text-align:center; color:#ffd38a; font-weight:700; }
.pcinv-fg-rtop { display:flex; align-items:center; gap:12px; }
.pcinv-fg-rtop .pcinv-cell.huge { flex:none; box-shadow:0 0 18px rgba(240,131,42,.45); }
.pcinv-fg-rinfo { display:flex; flex-direction:column; gap:3px; min-width:0; }
.pcinv-fg-rroll { padding:4px 0; border-bottom:1px solid #2a1e12; }
.pcinv-fg-rroll .pcinv-ebar { margin-top:4px; }
.pcinv-fg-rtext { color:#e8d6c4; }
.pcinv-fg-rcard .pcinv-fg-acts { justify-content:center; margin-top:4px; }
/* строка подсказок — внутри кузницы, внизу; тёмная плашка, чтобы не сливалась с фоном; не больше двух строк */
.pcinv-fg-hint { position:absolute; left:3%; right:3%; bottom:2%; z-index:2; padding:6px 11px; font-size:12.5px; line-height:1.35; color:#f3e6c8;
  background:linear-gradient(180deg,rgba(9,16,28,.92),rgba(5,10,18,.92)); border:1px solid #3a4f6b; border-left:3px solid #d9a95a; text-shadow:0 1px 2px #000; pointer-events:none; }
.pcinv-fg-hintt { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
/* узкое окно и телефон: одна колонка — кузница, итог, полки, кузнец и переплавка */
@media (max-width: 900px) {
  .pcinv-smithy { grid-template-columns:minmax(0,1fr); grid-template-areas:"stage" "right" "shelf" "left"; padding:0; background:none; box-shadow:none; }
  .pcinv-fg-stage { max-width:560px; background:#120a05 url(/icons/craft/forge_hall.jpg) 50% 70%/cover no-repeat; border:1px solid #3a2a1a; }
  .pcinv-fg-lcol, .pcinv-fg-right { max-height:none; overflow:visible; }
  .pcinv-fg-shelf { flex-direction:column; }
  .pcinv-fg-grp + .pcinv-fg-grp { padding-left:0; border-left:none; padding-top:6px; border-top:1px solid #1d2d43; }
  .pcinv-fg-grp.cats { flex:none; }
}
.pcinv-root.touch .pcinv-smithy { grid-template-columns:minmax(0,1fr); grid-template-areas:"stage" "right" "shelf" "left"; }
.pcinv-root.touch .pcinv-smithy { padding:0; background:none; box-shadow:none; }
.pcinv-root.touch .pcinv-fg-stage { max-width:560px; background:#120a05 url(/icons/craft/forge_hall.jpg) 50% 70%/cover no-repeat; border:1px solid #3a2a1a; }
.pcinv-root.touch .pcinv-fg-lcol, .pcinv-root.touch .pcinv-fg-right { max-height:none; overflow:visible; }
.pcinv-root.touch .pcinv-fg-shelf { flex-direction:column; }
.pcinv-root.touch .pcinv-fg-grp + .pcinv-fg-grp { padding-left:0; border-left:none; padding-top:6px; border-top:1px solid #1d2d43; }
.pcinv-root.touch .pcinv-fg-grp.cats { flex:none; }
@media (max-width: 460px) {
  .pcinv-fg-hint { font-size:11.5px; padding:4px 9px; }
  .pcinv-fg-shead { font-size:11px; }
  .pcinv-fg-sname { font-size:11px; }
  .pcinv-fg-ssub { display:none; }
  .pcinv-fg-arrow { font-size:18px; }
  .pcinv-fg-go { font-size:18px; padding:8px 24px; min-height:44px; }
}
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
/* Герой стоит над полоской 44 px: выбор облика — внутри панели героя, под куклой (не на кнопках страницы). */
.pcinv-stage { position:absolute; inset:0 0 44px 0; pointer-events:none; }
.pcinv-skinpick { position:absolute; left:50%; bottom:-40px; transform:translateX(-50%); pointer-events:auto; }
.pcinv-skinsel { font:inherit; font-size:14px; padding:6px 10px; border-radius:8px; background:#16202e; color:#e8eef8; border:1px solid #2c3e57; max-width:70vw; }
.pcinv-heroimg { position:absolute; left:50%; bottom:var(--feet,4%); height:96%; transform:translateX(-50%); filter:drop-shadow(0 8px 14px rgba(0,0,0,.5)); }
.pcinv-heroshadow { position:absolute; left:50%; bottom:calc(var(--feet,4%) - 10px); width:46%; height:22px; transform:translateX(-50%); border-radius:50%;
  background:radial-gradient(ellipse at center,rgba(0,0,0,.6),rgba(0,0,0,0) 70%); }
@media (max-width: 1199px) {
  .pcinv-root.page .pcinv-gear { grid-template-columns:minmax(0,1fr) 410px; grid-template-areas:"hero bag" "char char"; }
  .pcinv-root.page .pcinv-charpnl .pcinv-stats { display:grid; grid-template-columns:1fr 1fr; column-gap:24px; }
}
@media (max-width: 979px) {
  /* Пять вкладок и валюты не помещаются в шапку: вкладки плотнее, ник — в заголовке страницы. */
  .pcinv-root.page .pcinv-tab { padding:0 11px; }
  .pcinv-root.page .pcinv-curnick { display:none; }
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
