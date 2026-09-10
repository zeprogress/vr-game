import { BAG, ITEMS, type Inventory, type ItemId } from "../player/Inventory";
import { weaponDef, type WeaponClass, type WeaponDef, type WeaponTier } from "#shared/items";
import { EQUIP_SLOTS, type EquipSlot } from "#shared/equipment";
import { weaponDamage } from "#shared/combat";
import { attackSpeedFor } from "#shared/progression";
import { fireboltDamage } from "#shared/magic";
import { AFFIX, BOW, COMBAT, SHIELD } from "#shared/constants";

export interface WornWeapon {
  cls: WeaponClass;
  tier: WeaponTier;
}

/** Характеристики героя — от них считаем цифры оружия в подсказке. */
export interface HeroStats {
  level: number;
  str: number;
  agi: number;
  int: number;
}

/** Что надето и чем считать урон. */
export interface Equipped {
  left: WornWeapon | null;
  right: WornWeapon | null;
  stowed: (WornWeapon & { side: "left" | "right" })[];
  stats: HeroStats;
}

/** Иконка оружия — по классу и тиру (у базового тира картинки нет). */
function weaponIcon(cls: WeaponClass, tier: WeaponTier): string {
  if (tier !== "gold") return "";
  if (cls === "sword") return "gold_sword.png";
  if (cls === "bow") return "gold_bow.png";
  if (cls === "staff") return "gold_staff.png";
  return "";
}

function el(tag: string, css: string): HTMLElement {
  const d = document.createElement(tag);
  d.style.cssText = css;
  return d;
}

const n1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);

/**
 * Характеристики предмета в руке — строками «название: значение».
 * Считаем ровно теми же формулами, что и бой, чтобы цифра в подсказке
 * совпадала с уроном в игре.
 */
function weaponStats(w: WornWeapon, s: HeroStats): [string, string][] {
  const d = weaponDef(w.cls, w.tier);
  const spd = attackSpeedFor(s.level, s.agi);
  const out: [string, string][] = [];

  if (w.cls === "sword") {
    const dmg = weaponDamage("sword", s.level, s.str, d.mult, s.agi);
    out.push(["Урон", n1(dmg)]);
    out.push(["Темп атаки", `×${n1(spd)}`]);
    out.push(["Урон в секунду", n1(dmg * spd)]);
    out.push(["По площади", `${COMBAT.swordSplashRadius} м · ${Math.round(COMBAT.swordSplashFraction * 100)}%`]);
    out.push(["Растёт от", "силы + ловкости"]);
  } else if (w.cls === "bow") {
    const dmg = weaponDamage("arrow", s.level, s.str, d.mult, s.agi);
    out.push(["Урон стрелы", n1(dmg)]);
    out.push(["Крит", `${Math.round(BOW.critChance * 100)}% · ×${BOW.critMult}`]);
    out.push(["Натяг", `${n1(BOW.drawTimeFlat / spd)} с`]);
    out.push(["Растёт от", "ловкости"]);
  } else if (w.cls === "staff") {
    out.push(["Магия (полный заряд)", n1(fireboltDamage(s.level, s.int, 1))]);
    out.push(["Удар посохом", n1(weaponDamage("sword", s.level, s.str, d.mult, s.agi))]);
    out.push(["Растёт от", "интеллекта (магия), силы+ловкости (удар)"]);
  } else {
    const blocked = d.affix === "guard" ? AFFIX.guard.blockedDamage : SHIELD.blockedDamage;
    const cone = SHIELD.blockCone + (d.affix === "guard" ? AFFIX.guard.coneBonus : 0);
    out.push(["Блок", `гасит ${Math.round((1 - blocked) * 100)}% урона`]);
    out.push(["Сектор", `±${Math.round((cone * 180) / Math.PI)}°`]);
  }
  if (d.affix) out.push(["Эффект", AFFIX_TEXT[d.affix]]);
  return out;
}

const AFFIX_TEXT: Record<NonNullable<WeaponDef["affix"]>, string> = {
  fire: `Горение: ${AFFIX.fire.burnSec} с урона по времени`,
  crit: `Крит +${Math.round(AFFIX.crit.chanceBonus * 100)}%`,
  guard: `Блок ${Math.round((1 - AFFIX.guard.blockedDamage) * 100)}% · шире сектор`,
  storm: `АОЕ огнешара ×${AFFIX.storm.splashRadiusMul}`,
};

type Picked =
  | { where: "bag"; i: number }
  | { where: "equip"; slot: EquipSlot }
  | null;

/**
 * Инвентарь: кукла снаряжения + сетка сумки + описание выбранного.
 *
 * Слотов снаряжения восемь (две руки, шлем, тело, перчатки, ботинки, два
 * кольца). Живые пока только руки — броня появится позже, но её место видно
 * уже сейчас. При наведении (на ПК) или тапе (на телефоне) показываем
 * характеристики предмета, посчитанные боевыми формулами.
 */
export class InventoryPanel {
  private picked: Picked = null;
  private tip: HTMLElement | null = null;
  /** Последний контекст отрисовки — чтобы перерисовать себя по клику. */
  private hostRef: HTMLElement | null = null;
  private invRef: Inventory | null = null;
  private eqRef: Equipped | null = null;

  constructor(private readonly touch: boolean) {}

  render(host: HTMLElement, inv: Inventory, eq: Equipped | null): void {
    this.hostRef = host;
    this.invRef = inv;
    this.eqRef = eq;
    const t = this.touch;
    const cell = t ? 46 : 54;

    if (eq) host.appendChild(this.equipGrid(eq, cell));

    host.appendChild(this.caption("СУМКА"));
    const grid = el(
      "div",
      `display:grid;grid-template-columns:repeat(4,${cell}px);gap:${t ? 5 : 7}px;` +
        "justify-content:start;",
    );

    for (let i = 0; i < BAG.slots; i++) {
      const slot = inv.slots[i];
      const item = slot?.item ?? null;
      const active = this.picked?.where === "bag" && this.picked.i === i;
      const box = this.cellBox(cell, item !== null, active);

      if (item) {
        box.appendChild(this.iconEl(item, cell));
        if (slot.count > 1) box.appendChild(this.badge(slot.count));
        this.hoverTip(box, () => this.itemTipHtml(item, slot.count));
        box.addEventListener("click", () => {
          // Повторный тап по выбранной ячейке — использовать (зелье).
          if (active && inv.usable(i)) inv.use(i);
          else this.picked = { where: "bag", i };
          this.refresh();
        });
      }
      grid.appendChild(box);
    }
    host.appendChild(grid);
    host.appendChild(this.infoRow(inv, eq));
  }

  /** Перерисовка на месте: чистим только наш блок, не всю панель персонажа. */
  private refresh(): void {
    const host = this.hostRef;
    if (!host) return;
    this.hideTip();
    host.replaceChildren();
    this.render(host, this.invRef!, this.eqRef);
  }

  private caption(text: string): HTMLElement {
    const c = el("div", "font-size:11px;opacity:.55;margin:8px 0 4px;letter-spacing:.5px;");
    c.textContent = text;
    return c;
  }

  private badge(count: number): HTMLElement {
    const n = el(
      "span",
      "position:absolute;right:2px;bottom:1px;font:bold 12px system-ui;" +
        "color:#fff;text-shadow:0 1px 3px #000,0 0 3px #000;pointer-events:none;",
    );
    n.textContent = String(count);
    return n;
  }

  // ---- кукла снаряжения ----

  /** Сетка 4×2 из всех слотов снаряжения. Пустые подписаны, чем их занять. */
  private equipGrid(eq: Equipped, cell: number): HTMLElement {
    const wrap = el("div", "");
    wrap.appendChild(this.caption("СНАРЯЖЕНИЕ"));

    const grid = el(
      "div",
      `display:grid;grid-template-columns:repeat(4,${cell}px);gap:${this.touch ? 5 : 7}px;` +
        "justify-content:start;",
    );

    for (const def of EQUIP_SLOTS) {
      const w =
        def.id === "rightHand" ? eq.right : def.id === "leftHand" ? eq.left : null;
      const active = this.picked?.where === "equip" && this.picked.slot === def.id;
      const box = this.cellBox(cell, !!w, active, !def.live && !w);

      if (w) {
        box.appendChild(this.weaponIconEl(w, cell));
        this.hoverTip(box, () => this.weaponTipHtml(w, eq.stats));
        box.style.cursor = "pointer";
        box.addEventListener("click", () => {
          this.picked = { where: "equip", slot: def.id };
          this.refresh();
        });
      } else {
        const cap = el(
          "div",
          `font-size:${this.touch ? 9 : 10}px;opacity:.4;text-align:center;` +
            "line-height:1.15;padding:2px;pointer-events:none;",
        );
        cap.textContent = def.label;
        box.appendChild(cap);
        box.title = def.live
          ? `${def.label} — ${def.hint}`
          : `${def.label} — ${def.hint} (появится позже)`;
      }
      grid.appendChild(box);
    }
    wrap.appendChild(grid);

    if (eq.stowed.length > 0) {
      const back = el("div", "display:flex;gap:6px;align-items:center;margin-top:6px;");
      const cap = el("div", "font-size:11px;opacity:.5;");
      cap.textContent = "за спиной:";
      back.appendChild(cap);
      for (const st of eq.stowed) {
        const s = Math.round(cell * 0.7);
        const b = this.cellBox(s, true, false);
        b.appendChild(this.weaponIconEl(st, s));
        this.hoverTip(b, () => this.weaponTipHtml(st, eq.stats));
        back.appendChild(b);
      }
      wrap.appendChild(back);
    }
    return wrap;
  }

  private weaponIconEl(w: WornWeapon, size: number): HTMLElement {
    const icon = weaponIcon(w.cls, w.tier);
    if (icon) return this.img(icon, size, weaponDef(w.cls, w.tier).name);
    const d = weaponDef(w.cls, w.tier);
    const c = d.tint.map((v) => Math.round(v * 255)).join(",");
    return el(
      "div",
      `width:56%;height:56%;border-radius:5px;background:rgb(${c});` +
        "box-shadow:0 1px 4px #000a;pointer-events:none;",
    );
  }

  private img(file: string, size: number, alt: string): HTMLElement {
    const img = document.createElement("img");
    img.src = `/icons/${file}`;
    img.alt = alt;
    img.draggable = false;
    const s = Math.round(size * 0.78);
    img.style.cssText = `width:${s}px;height:${s}px;object-fit:contain;pointer-events:none;`;
    return img;
  }

  private cellBox(size: number, filled: boolean, active: boolean, ghost = false): HTMLElement {
    const border = active ? "#8fb4ff" : filled ? "#5a6480" : ghost ? "#2a3040" : "#333a4d";
    return el(
      "div",
      `position:relative;width:${size}px;height:${size}px;border-radius:8px;` +
        `border:1px ${ghost ? "dashed" : "solid"} ${border};` +
        `background:${filled ? "#232839" : ghost ? "#15181f" : "#191d29"};` +
        `box-shadow:${active ? "0 0 0 1px #8fb4ff inset" : "none"};` +
        `cursor:${filled ? "pointer" : "default"};display:flex;` +
        "align-items:center;justify-content:center;",
    );
  }

  private iconEl(item: ItemId, size: number): HTMLElement {
    const def = ITEMS[item];
    if (!def.icon) {
      const c = def.tint.map((v) => Math.round(v * 255)).join(",");
      return el("div", `width:60%;height:60%;border-radius:5px;background:rgb(${c});`);
    }
    return this.img(def.icon, size, def.name);
  }

  // ---- подсказка при наведении ----

  private hoverTip(box: HTMLElement, html: () => string): void {
    if (this.touch) return; // на телефоне вместо подсказки работает строка описания
    box.addEventListener("pointerenter", () => this.showTip(box, html()));
    box.addEventListener("pointerleave", () => this.hideTip());
  }

  private showTip(anchor: HTMLElement, html: string): void {
    this.hideTip();
    const tip = el(
      "div",
      "position:fixed;z-index:60;max-width:260px;padding:8px 10px;border-radius:8px;" +
        "background:#11141c;border:1px solid #39415a;box-shadow:0 6px 20px #000a;" +
        "font:12px/1.4 system-ui;color:#dfe4f0;pointer-events:none;",
    );
    tip.innerHTML = html;
    document.body.appendChild(tip);
    const r = anchor.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, r.left - w - 10))}px`;
    tip.style.top = `${Math.max(6, Math.min(window.innerHeight - h - 6, r.top - 4))}px`;
    this.tip = tip;
  }

  private hideTip(): void {
    this.tip?.remove();
    this.tip = null;
  }

  private statsHtml(rows: [string, string][]): string {
    return rows
      .map(
        ([k, v]) =>
          `<div style="display:flex;justify-content:space-between;gap:14px">` +
          `<span style="opacity:.6">${k}</span><span style="font-weight:600">${v}</span></div>`,
      )
      .join("");
  }

  private weaponTipHtml(w: WornWeapon, s: HeroStats): string {
    const d = weaponDef(w.cls, w.tier);
    const color =
      w.tier === "legendary" ? "#c77dff" : w.tier === "gold" ? "#ffd24a" : "#dfe4f0";
    return (
      `<div style="font-weight:700;color:${color};margin-bottom:4px">${d.name}</div>` +
      this.statsHtml(weaponStats(w, s))
    );
  }

  private itemTipHtml(item: ItemId, count: number): string {
    const def = ITEMS[item];
    const rows: [string, string][] = [];
    if (def.healFrac > 0) rows.push(["Лечит", `${Math.round(def.healFrac * 100)}% недостающего HP`]);
    else if (def.heal > 0) rows.push(["Лечит", `+${def.heal} HP`]);
    rows.push(["В стопке", `${count} / ${def.stack}`]);
    if (def.heal > 0) rows.push(["Клавиши", "X · 1 · F"]);
    return (
      `<div style="font-weight:700;margin-bottom:4px">${def.name}</div>` +
      `<div style="opacity:.6;margin-bottom:4px">${def.hint}</div>` +
      this.statsHtml(rows)
    );
  }

  // ---- строка описания ----

  private infoRow(inv: Inventory, eq: Equipped | null): HTMLElement {
    const box = el(
      "div",
      "margin-top:8px;min-height:34px;padding:6px 8px;border-radius:8px;" +
        "background:#171b26;border:1px solid #2b3143;font-size:12px;line-height:1.35;",
    );

    if (this.picked?.where === "equip" && eq) {
      const w = this.picked.slot === "rightHand" ? eq.right : eq.left;
      if (w) {
        box.innerHTML = this.weaponTipHtml(w, eq.stats);
        return box;
      }
    }
    const slot = this.picked?.where === "bag" ? inv.slots[this.picked.i] : null;
    if (!slot?.item) {
      box.style.opacity = "0.55";
      box.textContent = inv.isEmpty
        ? "Сумка пуста. Зелья и золотое оружие падают с мобов и босса."
        : this.touch
          ? "Нажми на предмет — покажу характеристики. Ещё раз — использовать."
          : "Наведи на предмет — покажу характеристики. Клик — выбрать, ещё раз — использовать.";
      return box;
    }
    box.innerHTML = this.itemTipHtml(slot.item, slot.count);
    return box;
  }
}
