import { ATTRS as A2, ATTR_INFO, attrEffect, CLASSES2, costRule, skillCooldownOf, SKILLS2, stepCost, type ClassId } from "#shared/classes2";
import { POTION_IMG } from "../ui/potionIcon";
import { bothHandsCls, bothHandsNote, qualityStarsShort, weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";
import type { PcInvActMsg, PcInvData, PcInvResult, PcInvWeapon } from "#shared/net/messages";

/**
 * ПК-окно снаряжения (как в WoW, одно окно с вкладками):
 *  - «Снаряжение»: кукла (руки + будущие слоты брони), характеристики, сумка
 *    с оружием, расходники, наковальня для лома;
 *  - «Заточка»: выбранный предмет, по аффиксу — очки/цена/шанс, молот;
 *  - «Атрибуты»: сила/ловкость/интеллект, свободные очки, сброс за жетон ◈.
 *
 * Перетаскивание: из сумки на руку — надеть; с руки в сумку — снять; на
 * наковальню — в лом (с подтверждением); за окно — выбросить на землю (с
 * подтверждением); на вкладку/слот заточки — выбрать для заточки. ПКМ по
 * предмету — надеть/снять. Действия выполняет Game (руки держит клиент).
 */

export type Side = "left" | "right";
export type InvTab = "gear" | "enchant" | "attrs" | "skills";

export interface HeldInfo {
  cls: string;
  tier: string;
}

export interface PcInventoryHooks {
  /** Телефон: тап — меню действий, перетаскивание — пальцем (HTML drag на тач не работает). */
  touch?: boolean;
  /** Страница !inv: окно встроено в страницу — без крестика, перетаскивания и «выбросить за окно». */
  page?: boolean;
  request: () => void;
  /** Использовать предмет сумки (свиток) — по id предмета. */
  useItem?: (id: "scroll_xp" | "scroll_wind") => void;
  act: (m: PcInvActMsg) => void;
  /** Что сейчас в руках (включая обычное, которого нет на складе). */
  hands: () => { left: HeldInfo | null; right: HeldInfo | null };
  equip: (w: PcInvWeapon, side: Side) => void;
  toBag: (side: Side) => void;
  scrap: (w: PcInvWeapon) => void;
  drop: (w: PcInvWeapon) => void;
}

export const ICON: Record<string, string> = { sword: "🗡️", bow: "🏹", staff: "🪄", shield: "🛡", dagger: "🔪", spear: "🦯", hammer: "🔨" };
const TIER_RU: Record<string, string> = { base: "обычное", gold: "золотое", legendary: "уникальное" };
const ATTRS = A2.map((id) => ({ id, name: `${ATTR_INFO[id].icon} ${ATTR_INFO[id].name}`, hint: attrEffect(id) }));

type DragSrc = { kind: "bag"; id: string } | { kind: "hand"; side: Side };

export class PcInventory {
  private readonly root: HTMLDivElement;
  private readonly win: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly tabsEl: HTMLDivElement;
  private readonly tip: HTMLDivElement;
  private readonly dropCatcher: HTMLDivElement;
  private data: PcInvData | null = null;
  private tab: InvTab = "gear";
  private enchId: string | null = null;
  private drag: DragSrc | null = null;
  private confirmEl: HTMLDivElement | null = null;
  private forging = false;
  private pendingResult: PcInvResult | null = null;
  private hammerDone = false;
  private lastResult: { text: string; up: boolean } | null = null;
  private xpFill: HTMLDivElement | null = null;
  private xpText: HTMLDivElement | null = null;
  private xpState = { level: 1, pct: 0, maxed: false };

  constructor(private readonly hooks: PcInventoryHooks) {
    injectInvStyle();
    this.root = div("pcinv-root");
    this.dropCatcher = div("pcinv-catch");
    this.win = div("pcinv-win");
    const head = div("pcinv-head");
    this.tabsEl = div("pcinv-tabs");
    const close = document.createElement("button");
    close.className = "pcinv-x";
    close.textContent = "✕";
    close.title = "Закрыть (Esc)";
    close.onclick = () => this.close();
    head.append(this.tabsEl, close);
    this.body = div("pcinv-body");
    this.tip = div("pcinv-tip");
    this.win.append(head, this.body);
    this.root.append(this.dropCatcher, this.win, this.tip);
    this.root.style.display = "none";
    document.body.appendChild(this.root);

    // Окно двигается за шапку.
    let dragWin: { x: number; y: number; l: number; t: number } | null = null;
    head.addEventListener("pointerdown", (e) => {
      if (hooks.page) return; // на странице окно не двигается
      // По вкладкам и кнопкам — клик, а не перетаскивание окна (иначе захват
      // указателя шапкой съедал клик по вкладке).
      if ((e.target as HTMLElement).closest("button, .pcinv-tab")) return;
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
      if (w) this.askConfirm(`Выбросить «${w.name}» на землю?`, "Выбросить", () => this.hooks.drop(w));
    });
    this.win.addEventListener("contextmenu", (e) => e.preventDefault());
    if (hooks.touch) {
      this.root.classList.add("touch");
      this.bindTouch();
    }
    if (hooks.page) this.root.classList.add("page");
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
        ghost = div("pcinv-ghost", cand.el.textContent?.slice(0, 2) ?? "");
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
      this.openActions(c.el, c.src);
    };
    this.root.addEventListener("pointerup", up);
    this.root.addEventListener("pointercancel", () => {
      ghost?.remove();
      ghost = null;
      cand = null;
      this.endDrag();
    });
  }

  /** Тап по предмету (телефон): что можно с ним сделать. */
  private openActions(anchor: HTMLElement, src: DragSrc): void {
    this.drag = src;
    const w = this.dragWeapon();
    const held = src.kind === "hand" ? this.hooks.hands()[src.side] : null;
    this.drag = null;
    this.tipAllowed = true;
    this.showTip(anchor, w, held);
    this.tipAllowed = false;
    this.confirmEl?.remove();
    const box = div("pcinv-confirm pcinv-actions");
    box.append(div("pcinv-confirm-text", w?.name ?? (held ? "В руке" : "")));
    const row = div("pcinv-confirm-row col");
    const btn = (label: string, fn: () => void, danger = false): void => {
      const b = document.createElement("button");
      b.className = `pcinv-ebtn${danger ? " danger" : ""}`;
      b.textContent = label;
      b.onclick = () => {
        box.remove();
        this.confirmEl = null;
        this.hideTip();
        fn();
      };
      row.append(b);
    };
    if (src.kind === "bag" && w) {
      // Меч/кинжал — парное оружие: можно выбрать руку (второй — к такому же в правой).
      const pair = (w.cls === "sword" || w.cls === "dagger") && this.hooks.hands().right?.cls === w.cls;
      if (pair) {
        btn("В правую руку", () => this.hooks.equip(w, "right"));
        btn("В левую руку", () => this.hooks.equip(w, "left"));
      } else btn("Надеть", () => this.hooks.equip(w, naturalSide(w.cls)));
    }
    if (src.kind === "hand") btn("Снять в сумку", () => this.hooks.toBag(src.side));
    if (w?.ench.length) {
      btn("Заточить", () => {
        this.enchId = w.id;
        this.tab = "enchant";
        this.render();
      });
    }
    if (w) btn(`В лом (+${w.scrap})`, () => this.askConfirm(`Разобрать «${w.name}» на ${w.scrap} лома?`, "Разобрать", () => this.hooks.scrap(w)), true);
    if (w) btn("Выбросить", () => this.askConfirm(`Выбросить «${w.name}» на землю?`, "Выбросить", () => this.hooks.drop(w)), true);
    btn("Отмена", () => {});
    box.append(row);
    this.root.append(box);
    this.confirmEl = box;
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

  close(): boolean {
    if (!this.isOpen) return false;
    this.root.style.display = "none";
    this.hideTip();
    this.confirmEl?.remove();
    this.confirmEl = null;
    return true;
  }

  toggle(tab: InvTab = "gear"): void {
    if (this.isOpen && this.tab === tab) this.close();
    else this.open(tab);
  }

  setData(d: PcInvData): void {
    this.data = d;
    if (this.enchId && !d.weapons.some((w) => w.id === this.enchId)) this.enchId = null;
    if (this.isOpen && !this.forging) this.render();
  }

  /** Опыт героя (Game шлёт каждый кадр; перерисовка — только при изменении). */
  setXp(level: number, frac: number, maxed: boolean): void {
    const pct = maxed ? 100 : Math.floor(Math.max(0, Math.min(1, frac)) * 1000) / 10;
    const x = this.xpState;
    if (x.level === level && x.pct === pct && x.maxed === maxed) return;
    x.level = level;
    x.pct = pct;
    x.maxed = maxed;
    this.paintXp();
  }

  private paintXp(): void {
    if (!this.xpFill || !this.xpText) return;
    const x = this.xpState;
    this.xpFill.style.width = `${x.pct}%`;
    this.xpText.textContent = x.maxed ? `${x.level} ур. · опыт максимум` : `${x.level} ур. · опыт ${x.pct.toFixed(1)}%`;
  }

  /** Склад поменялся (подобрал, разобрал…) — попросить свежие данные. */
  refresh(): void {
    if (this.isOpen) this.hooks.request();
  }

  onResult(r: PcInvResult): void {
    if (!this.forging) {
      this.lastResult = { text: r.text, up: r.ok };
      if (this.isOpen) this.render();
      return;
    }
    this.pendingResult = r;
    if (this.hammerDone) this.reveal();
  }

  // ---------------- отрисовка ----------------

  private render(): void {
    const d = this.data;
    this.tabsEl.innerHTML = "";
    const tabs: [InvTab, string][] = [
      ["gear", "Снаряжение"],
      ["enchant", "Заточка"],
      ["attrs", d && d.attrs.unspent > 0 ? `Атрибуты · ${d.attrs.unspent}` : "Атрибуты"],
      ["skills", "Умения"],
    ];
    for (const [id, label] of tabs) {
      const t = div(`pcinv-tab${this.tab === id ? " on" : ""}${id === "attrs" && d && d.attrs.unspent > 0 ? " glow" : ""}`, label);
      t.onclick = () => {
        this.tab = id;
        this.lastResult = null;
        this.render();
      };
      // Бросили предмет на вкладку «Заточка» — выбрать его для заточки.
      if (id === "enchant") {
        t.addEventListener("dragover", (e) => e.preventDefault());
        t.addEventListener("drop", (e) => {
          e.preventDefault();
          const w = this.dragWeapon();
          this.endDrag();
          if (w) {
            this.enchId = w.id;
            this.tab = "enchant";
            this.render();
          }
        });
      }
      this.tabsEl.append(t);
    }
    this.body.innerHTML = "";
    if (!d) {
      this.body.append(div("pcinv-empty", "Загрузка…"));
      return;
    }
    if (this.tab === "gear") this.renderGear(d);
    else if (this.tab === "enchant") this.renderEnchant(d);
    else if (this.tab === "skills") this.renderSkills(d);
    else this.renderAttrs(d);
  }

  private weaponById(id: string | null): PcInvWeapon | null {
    return (id && this.data?.weapons.find((w) => w.id === id)) || null;
  }

  private renderGear(d: PcInvData): void {
    const wrap = div("pcinv-gear");
    // --- кукла ---
    const left = div("pcinv-col");
    // Слоты брони/колец спрятаны, пока этих предметов нет в игре (вернуть —
    // ячейки .pcinv-cell.locked в колонки по бокам фигуры).
    const doll = div("pcinv-doll solo");
    const figure = div("pcinv-figure", "🧍");
    doll.append(figure);
    // Опыт до следующего уровня — как в рамке героя.
    const xp = div("pcinv-xp");
    this.xpFill = div("pcinv-xp-fill");
    this.xpText = div("pcinv-xp-text");
    xp.append(this.xpFill, this.xpText);
    this.paintXp();
    const hands = div("pcinv-hands");
    hands.append(this.handSlot("left", d), this.handSlot("right", d));
    const stats = div("pcinv-stats");
    for (const r of d.stats) {
      const row = div("pcinv-row");
      row.append(span(r.label), span(r.value));
      stats.append(row);
    }
    // Титул под ником — выбор из полученных.
    const titleRow = div("pcinv-row pcinv-title");
    titleRow.append(span("Титул"));
    const sel = document.createElement("select");
    sel.className = "pcinv-select";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = d.titles?.length ? "— без титула —" : "нет — за большие заслуги";
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
    titleRow.append(sel);
    left.append(doll, xp, hands, titleRow, stats);

    // --- сумка ---
    const right = div("pcinv-col");
    const eq = new Set([d.equipped.left, d.equipped.right].filter(Boolean) as string[]);
    const bag = d.weapons.filter((w) => !eq.has(w.id));
    // Склад на сервере без лимита — ячеек минимум 64, дальше растёт рядами по 8 (всегда есть свободный ряд).
    const row = this.hooks.touch && !this.hooks.page ? 10 : 8;
    const slots = Math.max(this.hooks.page ? 48 : this.hooks.touch ? 40 : 64, Math.ceil((bag.length + 1) / row) * row);
    right.append(div("pcinv-sub", `Сумка · оружие ${bag.length}`));
    const grid = div("pcinv-grid");
    for (let i = 0; i < slots; i++) {
      const w = bag[i];
      grid.append(w ? this.itemCell(w, i + 1) : div("pcinv-cell"));
    }
    // С руки в сумку — снять.
    grid.addEventListener("dragover", (e) => {
      if (this.drag?.kind === "hand") e.preventDefault();
    });
    grid.addEventListener("drop", (e) => {
      e.preventDefault();
      const src = this.drag;
      this.endDrag();
      if (src?.kind === "hand") this.hooks.toBag(src.side);
    });
    right.append(grid);
    right.append(div("pcinv-sub", "Прочее"));
    const cons = div("pcinv-cons");
    const info = (c: HTMLDivElement, title: string, body: string): HTMLDivElement => {
      c.removeAttribute("title");
      c.addEventListener("mouseenter", () => this.textTip(c, title, body));
      c.addEventListener("mouseleave", () => this.hideTip());
      return c;
    };
    cons.append(
      info(countCell(POTION_IMG, d.potions, "", true), "Зелья лечения", "Пить — клавиша 3 / кнопка зелья. Лечат сразу."),
      info(countCell(SCRAP_SVG, d.scrap, "", true), "Лом", "Для заточки роллов оружия (вкладка «Заточка»)."),
      info(countCell("🐟", d.fish, ""), "Рыба", "Ловится на озере. Задания на рыбалку — на доске в лагере."),
    );
    // Жетоны заданий — подсказка сразу при наведении и по нажатию.
    {
      const tip = "Дают за задания дня (доска и Охотник у выхода из лагеря). Тратятся у трактирщика в лагере: зелья, лом, свитки, сундук оружия.";
      const c = info(countCell("◈", d.tokens ?? 0, ""), "Жетоны заданий ◈", tip);
      c.classList.add("tokens");
      cons.append(c);
    }
    // Свитки — клик: прочитать (бафф на 15 мин).
    const scrolls: [number | undefined, "scroll_xp" | "scroll_wind", string, string, string][] = [
      [d.scrollXp, "scroll_xp", "📜", "Свиток мудрости", "×2 опыта на 15 мин (с благословением ×3). Клик — прочитать."],
      [d.scrollWind, "scroll_wind", "🪶", "Свиток ветра", "+20% скорости бега на 15 мин. Клик — прочитать."],
    ];
    for (const [n, id, ico, name, body] of scrolls) {
      if (!n) continue;
      const c = info(countCell(ico, n, ""), name, body);
      c.style.cursor = "pointer";
      c.onclick = () => {
        this.hideTip();
        this.hooks.useItem?.(id);
        window.setTimeout(() => this.refresh(), 300);
      };
      cons.append(c);
    }
    const anvil = div("pcinv-anvil", "⚒ Перетащи сюда — в лом");
    anvil.addEventListener("dragover", (e) => {
      if (this.dragWeapon()) {
        e.preventDefault();
        anvil.classList.add("hot");
      }
    });
    anvil.addEventListener("dragleave", () => anvil.classList.remove("hot"));
    anvil.addEventListener("drop", (e) => {
      e.preventDefault();
      anvil.classList.remove("hot");
      const w = this.dragWeapon();
      this.endDrag();
      if (w) this.askConfirm(`Разобрать «${w.name}» на ${w.scrap} лома?`, "Разобрать", () => this.hooks.scrap(w));
    });
    cons.append(anvil);
    right.append(cons);
    right.append(
      div(
        "pcinv-hint",
        "Перетащи на руку — надеть · ПКМ — надеть/снять · на наковальню — в лом · за окно — выбросить · на «Заточку» — заточить",
      ),
    );
    wrap.append(left, right);
    this.body.append(wrap);
  }

  private handSlot(side: Side, d: PcInvData): HTMLDivElement {
    const box = div("pcinv-handbox");
    const both = this.hooks.hands();
    // Лук/копьё/молот держат обе руки — показываем в левом слоте, правый — пометкой.
    const twoH = bothHandsCls(both.left?.cls) ? both.left : bothHandsCls(both.right?.cls) ? both.right : null;
    const bowBoth = !!twoH;
    const held = bowBoth ? (side === "left" ? twoH : null) : both[side];
    if (twoH && side === "right") {
      const c = div("pcinv-cell big locked", ICON[twoH.cls] ?? "🏹");
      c.title = bothHandsNote(twoH.cls);
      // И сюда можно бросить оружие из сумки — наденется по своим правилам.
      c.addEventListener("dragover", (e) => {
        if (this.drag?.kind === "bag") e.preventDefault();
      });
      c.addEventListener("drop", (e) => {
        e.preventDefault();
        const src = this.drag;
        this.endDrag();
        const bw = src?.kind === "bag" ? this.weaponById(src.id) : null;
        if (bw) this.hooks.equip(bw, "right");
      });
      box.append(c, div("pcinv-small", "Правая рука · занята"));
      return box;
    }
    const w = this.weaponById(d.equipped[side]) ?? (bowBoth ? this.weaponById(d.equipped.left ?? d.equipped.right) : null);
    const cell = div("pcinv-cell big");
    if (held && held.cls) {
      const tier = (w?.tier ?? held.tier) as WeaponTier;
      cell.classList.add(`t-${tier}`);
      cell.textContent = ICON[held.cls] ?? "?";
      if (w?.affixes.length) {
        cell.style.position = "relative";
        cell.append(div("pcinv-q", qualityStarsShort(w.quality, w.affixes.length)));
      }
      cell.draggable = true;
      cell.addEventListener("dragstart", (e) => this.startDrag(e, { kind: "hand", side }));
      this.touchSrc.set(cell, { kind: "hand", side });
      if (this.hooks.page && !this.hooks.touch) {
        cell.style.cursor = "pointer";
        cell.addEventListener("click", () => this.openActions(cell, { kind: "hand", side }));
      }
      cell.addEventListener("dragend", () => this.endDrag());
      cell.addEventListener("mouseenter", () => this.showTip(cell, w, held));
      cell.addEventListener("mouseleave", () => this.hideTip());
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.hideTip();
        this.hooks.toBag(side);
      });
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
    box.append(cell, div("pcinv-small", side === "left" ? "Левая рука" : "Правая рука"));
    return box;
  }

  private itemCell(w: PcInvWeapon, num = 0): HTMLDivElement {
    const c = div(`pcinv-cell t-${w.tier}`, ICON[w.cls] ?? "?");
    c.style.position = "relative";
    if (w.affixes.length) c.append(div("pcinv-q", qualityStarsShort(w.quality, w.affixes.length)));
    // Страница !inv: номер предмета (как в старом виде и в !equip / !scrap <номер>).
    if (this.hooks.page && num) c.append(div("pcinv-num", String(num)));
    // Страница на ПК: клик — меню действий, как тап на телефоне.
    if (this.hooks.page && !this.hooks.touch) c.addEventListener("click", () => this.openActions(c, { kind: "bag", id: w.id }));
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

  private renderEnchant(d: PcInvData): void {
    const wrap = div("pcinv-ench");
    const inHand = new Set([d.equipped.left, d.equipped.right].filter(Boolean) as string[]);
    const w =
      this.weaponById(this.enchId) ??
      this.weaponById(d.equipped.right) ??
      this.weaponById(d.equipped.left) ??
      d.weapons[0] ??
      null;
    if (w) this.enchId = w.id;
    const left = div("pcinv-ench-left");
    const slotEl = div(`pcinv-cell huge${w ? ` t-${w.tier}` : ""}`, w ? (ICON[w.cls] ?? "?") : "");
    slotEl.addEventListener("dragover", (e) => {
      if (this.dragWeapon()) e.preventDefault();
    });
    slotEl.addEventListener("drop", (e) => {
      e.preventDefault();
      const dw = this.dragWeapon();
      this.endDrag();
      if (dw) {
        this.enchId = dw.id;
        this.lastResult = null;
        this.render();
      }
    });
    left.append(slotEl);
    left.append(div("pcinv-small", w ? w.name : "Перетащи предмет сюда"));
    left.append(div("pcinv-have", `Лом: ${d.scrap}`));
    const anvil = div(`pcinv-hammer${this.forging ? " forging" : ""}`, "🔨");
    left.append(anvil);

    const right = div("pcinv-ench-right");
    if (!w) {
      right.append(div("pcinv-empty", "На складе нет оружия с роллами."));
    } else if (!w.ench.length) {
      right.append(div("pcinv-empty", "У этого предмета нет роллов — точить нечего."));
    } else {
      const hn = div(`pcinv-name t-${w.tier}`, `${w.name} · ${TIER_RU[w.tier]}`);
      if (inHand.has(w.id)) hn.append(div("pcinv-inhand-tag", "в руке"));
      right.append(hn);
      const sc = div("pcinv-score");
      sc.innerHTML = `<small>оценка </small>${qualityStarsShort(w.quality, w.affixes.length)}`;
      right.append(sc);
      w.ench.forEach((a, i) => {
        const row = div("pcinv-erow");
        const lab = div("pcinv-elabel");
        lab.append(span(a.label), span(`${a.points}/33`));
        const bar = div("pcinv-ebar");
        const fill = div("pcinv-efill");
        fill.style.width = `${Math.round((a.points / 33) * 100)}%`;
        bar.append(fill);
        const b = document.createElement("button");
        b.className = "pcinv-ebtn";
        if (a.max) {
          b.textContent = "MAX";
          b.disabled = true;
        } else {
          b.innerHTML = `⚒ ${a.cost} лома<br><small>шанс ${Math.round(a.chance * 100)}%</small>`;
          b.disabled = d.scrap < a.cost || this.forging;
          b.onclick = () => this.forge(w.id, i);
        }
        row.append(lab, bar, b);
        right.append(row);
      });
      if (this.lastResult) {
        right.append(div(`pcinv-result ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text));
      }
      right.append(
        div("pcinv-hint", "Чем ближе ролл к максимуму и чем лучше предмет — тем дороже и меньше шанс. При неудаче лом сгорает."),
      );
    }
    // Выбор предмета — мини-сетка всех предметов с роллами.
    const pick = div("pcinv-epick");
    for (const x of d.weapons) {
      if (!x.ench.length) continue;
      const c = div(`pcinv-cell small t-${x.tier}${x.id === this.enchId ? " sel" : ""}${inHand.has(x.id) ? " inhand" : ""}`, ICON[x.cls] ?? "?");
      c.onclick = () => {
        this.enchId = x.id;
        this.lastResult = null;
        this.render();
      };
      c.addEventListener("mouseenter", () => this.showTip(c, x, null));
      c.addEventListener("mouseleave", () => this.hideTip());
      pick.append(c);
    }
    wrap.append(left, right);
    this.body.append(wrap, div("pcinv-sub", "Все предметы с роллами"), pick);
  }

  private forge(id: string, idx: number): void {
    if (this.forging) return;
    this.forging = true;
    this.hammerDone = false;
    this.pendingResult = null;
    this.lastResult = null;
    this.render();
    this.hooks.act({ act: "enchant", id, idx });
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
      wrap.append(div("pcinv-name", "Возьми оружие — умения зависят от класса"));
      this.body.append(wrap);
      return;
    }
    const def = CLASSES2[cls];
    wrap.append(
      div("pcinv-name", `${def.icon} ${def.name} — ${def.role}`),
      div("pcinv-small", `Оружие: ${def.weapons}. Выбери любые два умения — клавиши 2 и 3 (телефон — кнопки ✦, VR — стики).`),
    );
    const chosen = new Set(d.skills?.chosen ?? []);
    for (const id of def.skills) {
      const sk = SKILLS2[id];
      const v = sk.variants?.[cls];
      const row = div(`pcinv-arow pcinv-skill${chosen.has(id) ? " on" : ""}`);
      const txt = div("pcinv-atxt");
      txt.append(
        div("pcinv-aname", `${sk.icon} ${v?.name ?? sk.name} · откат ${skillCooldownOf(id, cls)} с`),
        div("pcinv-small", v?.desc ?? sk.desc),
      );
      const b = document.createElement("button");
      b.className = "pcinv-abtn";
      b.textContent = chosen.has(id) ? "✓" : "+";
      b.title = chosen.has(id) ? "Выбрано" : "Выбрать (заменит более старое)";
      b.onclick = () => {
        if (chosen.has(id)) return;
        // Новое — вместо первого из выбранных (держим ровно два).
        const next = [...(d.skills?.chosen ?? []), id].slice(-2);
        this.hooks.act({ act: "skills", id: next.join(","), idx: 0 });
      };
      row.append(txt, b);
      wrap.append(row);
    }
    if (this.lastResult) wrap.append(div(`pcinv-result ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text));
    this.body.append(wrap);
  }

  private renderAttrs(d: PcInvData): void {
    const a = d.attrs;
    const wrap = div("pcinv-attrs");
    wrap.append(
      div("pcinv-name", a.unspent > 0 ? `Свободных очков: ${a.unspent}` : "Свободных очков нет — их дают за уровень"),
      div("pcinv-small", costRule()),
    );
    for (const at of ATTRS) {
      const row = div("pcinv-arow");
      const txt = div("pcinv-atxt");
      const v = a[at.id] ?? 1;
      const cost = stepCost(v);
      // Сколько стоят следующие 5 подъёмов (цена может вырасти на середине).
      let cost5 = 0;
      for (let i = 0; i < 5; i++) cost5 += stepCost(v + i);
      txt.append(div("pcinv-aname", `${at.name}: ${v}`), div("pcinv-small", `${at.hint} · следующий подъём — ${cost} оч.`));
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
      row.append(txt, b1, b5);
      wrap.append(row);
    }
    const cost = d.respecCost;
    // cost < 0 — сброс атрибутов выключен на сервере.
    if (cost < 0) {
      if (this.lastResult) wrap.append(div(`pcinv-result ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text));
      this.body.append(wrap);
      return;
    }
    const rb = document.createElement("button");
    rb.className = "pcinv-respec";
    rb.textContent = cost === 0 ? "Сбросить атрибуты — бесплатно" : `Сбросить атрибуты — ${cost} ◈ (у тебя ${d.tokens ?? 0})`;
    rb.disabled = cost > (d.tokens ?? 0);
    rb.onclick = () =>
      this.askConfirm("Сбросить все вложенные очки атрибутов? Их можно будет распределить заново.", "Сбросить", () =>
        this.hooks.act({ act: "respec", id: "respec", idx: 0 }),
      );
    wrap.append(rb);
    if (this.lastResult) wrap.append(div(`pcinv-result ${this.lastResult.up ? "up" : "down"}`, this.lastResult.text));
    this.body.append(wrap);
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

  /** Перетаскиваемое оружие со склада (обычное с руки на склад не попадает — null). */
  private dragWeapon(): PcInvWeapon | null {
    const s = this.drag;
    if (!s || !this.data) return null;
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
    this.tip.append(div("pcinv-small", TIER_RU[tier] ?? tier));
    if (w && w.affixes.length) {
      const sc = div("pcinv-score");
      sc.innerHTML = `<small>оценка </small>${qualityStarsShort(w.quality, w.affixes.length)}`;
      this.tip.append(sc);
    }
    for (const e of w?.effects ?? []) this.tip.append(div("pcinv-tipeff", e));
    for (const a of w?.affixes ?? []) this.tip.append(div("pcinv-tipaff", a));
    if (w) this.tip.append(div("pcinv-small", `В лом: ${w.scrap}`));
    this.tip.append(div("pcinv-small dim", held ? "ПКМ — снять в сумку" : "ПКМ — надеть · перетащи — действия"));
    const r = anchor.getBoundingClientRect();
    this.tip.style.display = "block";
    const tw = this.tip.offsetWidth;
    const left = r.right + 8 + tw > window.innerWidth ? r.left - tw - 8 : r.right + 8;
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${Math.max(4, Math.min(window.innerHeight - this.tip.offsetHeight - 4, r.top))}px`;
  }

  /** Простая подсказка (название + текст) у ячейки — сразу, без задержки браузерного title. */
  private textTip(anchor: HTMLElement, title: string, body: string): void {
    this.tip.innerHTML = "";
    this.tip.append(div("pcinv-name", title), div("pcinv-small", body));
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
    this.win.append(box);
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

function span(text: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.textContent = text;
  return s;
}

/** Лом — кусочки металла (шестерёнка путала). */
export const SCRAP_SVG =
  `<svg viewBox="0 0 28 28" width="30" height="30" stroke-linejoin="round">` +
  `<path d="M3 17l7-5 4 3-2 6-7 1z" fill="#8d939c" stroke="#d6dae0" stroke-width="1.1"/>` +
  `<path d="M12 9l6-4 5 3-1 6-6 1z" fill="#a4957e" stroke="#e2d6c2" stroke-width="1.1"/>` +
  `<path d="M15 18l6-2 4 4-3 5-6-1z" fill="#6f757e" stroke="#c9ced6" stroke-width="1.1"/>` +
  `<circle cx="18.5" cy="10" r="1.1" fill="#3a3e45"/><circle cx="8" cy="17.5" r="1" fill="#3a3e45"/>` +
  `</svg>`;

function countCell(ico: string, n: number, title: string, html = false): HTMLDivElement {
  const c = div("pcinv-cell t-base");
  if (html) c.innerHTML = ico;
  else c.textContent = ico;
  c.title = title;
  const k = document.createElement("span");
  k.className = "pcinv-cnt";
  k.textContent = String(n);
  c.append(k);
  return c;
}

let styled = false;
function injectInvStyle(): void {
  if (styled) return;
  styled = true;
  const s = document.createElement("style");
  s.textContent = `
.pcinv-root { position:fixed; inset:0; z-index:40; pointer-events:none; font:500 13px/1.35 system-ui,sans-serif; color:#e6e0d0; }
.pcinv-catch { position:absolute; inset:0; display:none; pointer-events:auto; }
.pcinv-win { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(760px,96vw);
  max-height:92vh; overflow:auto; pointer-events:auto; background:rgba(16,15,21,.95); border:none;
  border-radius:10px; box-shadow:0 10px 40px rgba(0,0,0,.55); user-select:none; -webkit-user-select:none; }
.pcinv-head { display:flex; align-items:flex-end; gap:6px; padding:8px 10px 0; cursor:move; border-bottom:1px solid #2c2f38; }
.pcinv-tabs { display:flex; gap:4px; flex:1; }
.pcinv-tab { padding:6px 14px; border:1px solid #33363f; border-bottom:none; border-radius:7px 7px 0 0; background:#1b1a21;
  color:#a9a498; cursor:pointer; }
.pcinv-tab.on { background:#26252e; color:#f1ead6; border-color:#4a4e5a; }
.pcinv-tab.glow { color:#9fe39a; }
.pcinv-x { background:none; border:none; color:#a9a498; font-size:16px; cursor:pointer; padding:4px 6px 8px; }
.pcinv-body { padding:12px; }
.pcinv-empty { padding:24px; text-align:center; color:#9a9588; }
.pcinv-gear { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.35fr); gap:14px; }
.pcinv-col { min-width:0; }
.pcinv-doll { display:grid; grid-template-columns:48px 1fr 48px; gap:8px; align-items:center; }
.pcinv-doll.solo { grid-template-columns:1fr; }
.pcinv-dollcol { display:flex; flex-direction:column; gap:6px; }
.pcinv-figure { height:160px; border-radius:8px; background:#1c1b22; display:flex; align-items:center; justify-content:center;
  font-size:74px; opacity:.55; }
.pcinv-xp { position:relative; height:12px; margin-top:8px; background:#1b1a20; border:1px solid #000; border-radius:3px; overflow:hidden; }
.pcinv-xp-fill { height:100%; width:0; background:#6b6f7a; }
.pcinv-xp-text { position:absolute; inset:0; text-align:center; font:600 9.5px/12px system-ui; color:#d9dbe0; text-shadow:0 1px 1px #000; }
.pcinv-hands { display:flex; justify-content:center; gap:18px; margin:10px 0 8px; }
.pcinv-handbox { text-align:center; }
.pcinv-stats { border-top:1px solid #2c2f38; padding-top:6px; }
.pcinv-row { display:flex; justify-content:space-between; gap:8px; padding:2px 0; border-bottom:1px solid #22242b; font-size:12.5px; }
.pcinv-row span:last-child { color:#f1ead6; text-align:right; }
.pcinv-sub { color:#9a9588; font-size:12px; margin:2px 0 5px; }
.pcinv-grid { display:grid; grid-template-columns:repeat(8,44px); gap:5px; }
.pcinv-cell { position:relative; width:44px; height:44px; border-radius:6px; background:#0f0e13; border:1px solid #2f323b;
  display:flex; align-items:center; justify-content:center; font-size:22px; }
.pcinv-cell[draggable="true"] { cursor:grab; }
.pcinv-cell.big { width:58px; height:58px; font-size:30px; }
.pcinv-cell.huge { width:84px; height:84px; font-size:42px; margin:0 auto; }
.pcinv-cell.small { width:36px; height:36px; font-size:18px; cursor:pointer; }
.pcinv-cell.sel { outline:2px solid #e6e0d0; }
.pcinv-cell.locked { opacity:.28; }
.pcinv-cell.hot { outline:2px dashed #9fe39a; }
.pcinv-cell.t-base { border-color:#6b6b6b; }
.pcinv-cell.t-gold { border-color:#d9a21b; box-shadow:inset 0 0 10px rgba(217,162,27,.25); }
.pcinv-cell.t-legendary { border-color:#9b5cf0; box-shadow:inset 0 0 12px rgba(155,92,240,.35); }
.pcinv-cnt { position:absolute; right:3px; bottom:1px; font-size:11px; color:#fff; text-shadow:0 1px 2px #000; }
.pcinv-cons { display:flex; gap:5px; align-items:stretch; }
.pcinv-anvil { flex:1; border:1px dashed #5a5e6a; border-radius:6px; display:flex; align-items:center; justify-content:center;
  color:#c9c3b3; font-size:12px; min-height:44px; }
.pcinv-anvil.hot { border-color:#ff7a5a; color:#ffb49a; background:rgba(255,122,90,.08); }
.pcinv-hint { color:#7f7a6e; font-size:11.5px; margin-top:8px; }
.pcinv-small { color:#a9a498; font-size:11.5px; }
.pcinv-small.dim { color:#7f7a6e; margin-top:4px; }
.pcinv-name { font-weight:700; margin-bottom:6px; }
.t-gold.pcinv-name, .pcinv-name.t-gold { color:#f5c542; }
.pcinv-name.t-legendary { color:#c79bff; }
.pcinv-name.t-base { color:#dedede; }
.pcinv-tip { position:fixed; display:none; max-width:240px; background:#0c0b10; border:none; border-radius:7px;
  padding:8px 10px; pointer-events:none; z-index:41; }
.pcinv-tipaff { color:#9fe39a; font-size:12.5px; }
.pcinv-tipeff { color:#f0d68a; font-size:12.5px; }
.pcinv-cell.tokens { color:#e8c26a; font-weight:800; }
/* Страница !inv: окно — обычный блок страницы. */
.pcinv-root.page { position:relative; inset:auto; pointer-events:auto; }
.pcinv-root.page .pcinv-win, .pcinv-root.page.touch .pcinv-win { position:relative; left:auto; top:auto; transform:none;
  margin:0 auto; width:min(680px,100%); max-width:100%; height:auto; max-height:none; overflow:visible; }
.pcinv-root.page .pcinv-x, .pcinv-root.page .pcinv-hint, .pcinv-root.page .pcinv-doll { display:none; }
.pcinv-root.page .pcinv-head { cursor:default; }
/* Сумка на странице — ячейки помельче, чтобы 8 в ряд влезали в колонку (окно 680 px). */
.pcinv-root.page .pcinv-body .pcinv-grid { grid-template-columns:repeat(8,minmax(0,1fr)); gap:4px; }
.pcinv-root.page .pcinv-body .pcinv-grid .pcinv-cell { width:100%; height:auto; aspect-ratio:1 / 1; font-size:26px; cursor:pointer; }
.pcinv-num { position:absolute; left:3px; bottom:1px; font:700 10px system-ui; color:#d8d0bb; text-shadow:0 1px 2px #000; pointer-events:none; }
.pcinv-root.page .pcinv-body .pcinv-cons { flex-wrap:wrap; }
/* Страница на телефоне: пустые ячейки и расходники листают страницу пальцем, перетаскиваются только предметы. */
.pcinv-root.page.touch .pcinv-cell { touch-action:pan-y; }
.pcinv-root.page.touch .pcinv-grid .pcinv-cell[class*="t-"], .pcinv-root.page.touch .pcinv-handbox .pcinv-cell[class*="t-"] { touch-action:none; }
.pcinv-root.page .pcinv-gear > .pcinv-col { min-width:0; overflow:hidden; }
.pcinv-ghost { position:fixed; z-index:80; width:48px; height:48px; margin:-24px 0 0 -24px; display:flex; align-items:center;
  justify-content:center; font-size:28px; background:rgba(30,28,38,.9); border-radius:8px; pointer-events:none; }
.pcinv-confirm-row.col { flex-direction:column; align-items:stretch; }
.pcinv-actions .pcinv-ebtn { padding:10px 14px; font-size:15px; }
.pcinv-root.touch .pcinv-win { width:86vw; max-width:86vw; height:84vh; max-height:84vh; border-radius:12px; left:50%; top:50%; transform:translate(-50%,-50%); }
.pcinv-root.touch .pcinv-cell { touch-action:none; }
.pcinv-root.touch .pcinv-hint { display:none; }
.pcinv-root.touch .pcinv-win { overflow:auto; }
.pcinv-root.touch .pcinv-confirm { position:fixed; z-index:81; width:min(320px,90vw); pointer-events:auto; }
.pcinv-root.touch .pcinv-tip { pointer-events:none; }
/* Телефон: снаряжение без куклы и без прокрутки — всё мельче и плотнее. */
.pcinv-root.touch .pcinv-doll { display:none; }
.pcinv-root.touch .pcinv-body { padding:6px 8px; }
.pcinv-root.touch .pcinv-head { padding:4px 8px 0; }
.pcinv-root.touch .pcinv-tab { padding:5px 10px; }
.pcinv-root.touch .pcinv-gear { grid-template-columns:minmax(0,.9fr) minmax(0,1.3fr); gap:10px; }
.pcinv-root.touch .pcinv-cell { width:34px; height:34px; font-size:18px; }
.pcinv-root.touch .pcinv-cell.big { width:46px; height:46px; font-size:24px; }
.pcinv-root.touch .pcinv-grid { grid-template-columns:repeat(10,34px); gap:3px; }
.pcinv-root.touch .pcinv-hands { margin:4px 0; gap:12px; }
.pcinv-root.touch .pcinv-xp { margin-top:0; }
.pcinv-root.touch .pcinv-stats { display:grid; grid-template-columns:1fr 1fr; column-gap:10px; padding-top:3px; }
.pcinv-root.touch .pcinv-row { font-size:11px; padding:1px 0; }
.pcinv-root.touch .pcinv-title { margin:3px 0; }
.pcinv-root.touch .pcinv-sub { margin:1px 0 3px; }
.pcinv-root.touch .pcinv-anvil { font-size:11px; }
@media (max-width: 520px) {
  .pcinv-root.touch .pcinv-gear, .pcinv-root.touch .pcinv-ench { grid-template-columns:minmax(0,1fr); }
  .pcinv-root.touch .pcinv-grid { grid-template-columns:repeat(auto-fill,44px); }
}
.pcinv-title { align-items:center; margin:6px 0; }
.pcinv-select { background:#1b1a21; color:#c79bff; border:1px solid #3a3e48; border-radius:6px; padding:3px 6px; font:600 12.5px system-ui; flex:1; min-width:0; }
.pcinv-title > span:first-child { flex:none; }
.pcinv-score { display:inline-block; margin:3px 0 2px; font:800 15px system-ui; color:#ffcf5a; }
.pcinv-score small { font:600 11px system-ui; color:#a9a498; margin-right:4px; }
.pcinv-cell.inhand { position:relative; box-shadow:inset 0 0 0 2px #6fbf6f; }
.pcinv-cell.inhand::after { content:"в руке"; position:absolute; left:50%; bottom:-6px; transform:translateX(-50%);
  font:700 8.5px system-ui; color:#0e1a10; background:#8fd18f; border-radius:3px; padding:0 3px; white-space:nowrap; }
.pcinv-inhand-tag { display:inline-block; font:700 11px system-ui; color:#0e1a10; background:#8fd18f; border-radius:4px; padding:1px 6px; margin-left:6px; vertical-align:2px; }
.pcinv-ench { display:grid; grid-template-columns:150px minmax(0,1fr); gap:14px; align-items:start; }
.pcinv-ench-left { text-align:center; display:flex; flex-direction:column; gap:6px; align-items:center; }
.pcinv-have { font-size:13px; } .pcinv-have::first-letter { }
.pcinv-hammer { font-size:34px; margin-top:6px; transform-origin:80% 80%; }
.pcinv-hammer.forging { animation:pcinvHammer .36s ease-in-out 3; }
@keyframes pcinvHammer { 0%{transform:rotate(0)} 45%{transform:rotate(-45deg)} 70%{transform:rotate(12deg)} 100%{transform:rotate(0)} }
.pcinv-erow { display:grid; grid-template-columns:minmax(0,1fr) 110px; gap:4px 10px; align-items:center; padding:6px 0;
  border-bottom:1px solid #22242b; }
.pcinv-elabel { display:flex; justify-content:space-between; gap:8px; }
.pcinv-ebar { grid-column:1; height:7px; background:#1e1d24; border-radius:4px; overflow:hidden; }
.pcinv-efill { height:100%; background:linear-gradient(90deg,#6a9bff,#9fe39a); }
.pcinv-ebtn { grid-column:2; grid-row:1 / span 2; padding:5px 6px; border-radius:6px; border:1px solid #4a4e5a; background:#23222b;
  color:#e6e0d0; cursor:pointer; font:600 12px/1.2 system-ui; }
.pcinv-ebtn:disabled { opacity:.45; cursor:default; }
.pcinv-ebtn.danger { border-color:#a8453a; color:#ffc2b8; }
.pcinv-epick { display:flex; flex-wrap:wrap; gap:12px 6px; padding-bottom:6px; }
.pcinv-q { position:absolute; right:2px; top:1px; font:800 10px system-ui; color:#ffcf5a; text-shadow:0 1px 2px #000; pointer-events:none; }
.pcinv-result { margin-top:8px; padding:6px 8px; border-radius:6px; }
.pcinv-result.up { background:rgba(80,200,110,.12); color:#9fe39a; }
.pcinv-result.down { background:rgba(220,80,70,.12); color:#ff9a8e; }
.pcinv-attrs { display:flex; flex-direction:column; gap:8px; max-width:520px; }
.pcinv-skill.on { outline:1px solid #7ee081; }
.pcinv-arow { display:flex; align-items:center; gap:8px; padding:6px 8px; background:#1b1a21; border-radius:7px; }
.pcinv-atxt { flex:1; } .pcinv-aname { font-weight:700; }
.pcinv-abtn { width:42px; padding:6px 0; border-radius:6px; border:1px solid #4a4e5a; background:#23222b; color:#9fe39a;
  cursor:pointer; font:700 13px system-ui; }
.pcinv-abtn:disabled { opacity:.35; cursor:default; color:#a9a498; }
.pcinv-respec { margin-top:6px; padding:9px; border-radius:7px; border:1px solid #6a4a3a; background:#2a1f1c; color:#ffcfae;
  cursor:pointer; font:600 13px system-ui; }
.pcinv-respec:disabled { opacity:.45; cursor:default; }
.pcinv-confirm { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:320px; background:#15141b;
  border:none; border-radius:9px; padding:14px; box-shadow:0 8px 30px rgba(0,0,0,.6); z-index:2; }
.pcinv-confirm-text { margin-bottom:12px; }
.pcinv-confirm-row { display:flex; gap:8px; justify-content:flex-end; }
.pcinv-confirm-row .pcinv-ebtn { grid-row:auto; padding:7px 14px; }
`;
  document.head.appendChild(s);
}
