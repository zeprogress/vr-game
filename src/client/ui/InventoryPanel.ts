import { BAG, ITEMS, type Inventory, type ItemId } from "../player/Inventory";
import { weaponDef, type WeaponClass, type WeaponTier } from "#shared/items";

/** Что сейчас в руках и за спиной — рисуем строкой «Снаряжение». */
export interface Equipped {
  left: { cls: WeaponClass; tier: WeaponTier } | null;
  right: { cls: WeaponClass; tier: WeaponTier } | null;
  stowed: { cls: WeaponClass; tier: WeaponTier; side: "left" | "right" }[];
}

/** Иконка оружия в руках — по классу и тиру (у базового тира картинки нет). */
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

/**
 * Инвентарь: сетка ячеек с иконками + строка снаряжения + описание выбранного.
 *
 * Раньше сумка была списком строк «цветная точка — название — ×N», по которому
 * нельзя было понять ни сколько всего места, ни что вообще на тебе надето.
 * Здесь: видны ВСЕ ячейки (в том числе пустые — сразу ясен объём сумки),
 * предметы с настоящими иконками, а сверху — что в руках и за спиной.
 */
export class InventoryPanel {
  /** Какая ячейка выбрана (показываем её описание). -1 — ничего. */
  private picked = -1;

  constructor(private readonly touch: boolean) {}

  /** Перерисовать целиком в `host`. Зовётся при каждом открытии/изменении. */
  render(host: HTMLElement, inv: Inventory, eq: Equipped | null): void {
    const t = this.touch;
    const cell = t ? 46 : 56;

    if (eq) host.appendChild(this.equipRow(eq, cell));

    const grid = el(
      "div",
      `display:grid;grid-template-columns:repeat(4,${cell}px);gap:${t ? 5 : 7}px;` +
        `margin-top:${t ? 5 : 8}px;justify-content:start;`,
    );

    for (let i = 0; i < BAG.slots; i++) {
      const slot = inv.slots[i];
      const item = slot?.item ?? null;
      const box = this.cellBox(cell, item !== null, i === this.picked);

      if (item) {
        box.appendChild(this.iconEl(item, cell));
        if (slot.count > 1) {
          const n = el(
            "span",
            "position:absolute;right:2px;bottom:1px;font:bold 12px system-ui;" +
              "color:#fff;text-shadow:0 1px 3px #000,0 0 3px #000;pointer-events:none;",
          );
          n.textContent = String(slot.count);
          box.appendChild(n);
        }
        box.title = `${ITEMS[item].name} — ${ITEMS[item].hint}`;
        box.addEventListener("click", () => {
          // Повторный тап по выбранной ячейке — использовать (зелье).
          if (this.picked === i && inv.usable(i)) inv.use(i);
          else this.picked = i;
          this.rerender(host, inv, eq);
        });
      }
      grid.appendChild(box);
    }
    host.appendChild(grid);
    host.appendChild(this.infoRow(inv));
  }

  /** Перерисовка на месте: чистим только наш блок, не всю панель персонажа. */
  private rerender(host: HTMLElement, inv: Inventory, eq: Equipped | null): void {
    host.replaceChildren();
    this.render(host, inv, eq);
  }

  private cellBox(size: number, filled: boolean, active: boolean): HTMLElement {
    return el(
      "div",
      `position:relative;width:${size}px;height:${size}px;border-radius:8px;` +
        `border:1px solid ${active ? "#8fb4ff" : filled ? "#5a6480" : "#333a4d"};` +
        `background:${filled ? "#232839" : "#191d29"};` +
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
    const img = document.createElement("img");
    img.src = `/icons/${def.icon}`;
    img.alt = def.name;
    img.draggable = false;
    img.style.cssText = `width:${Math.round(size * 0.78)}px;height:${Math.round(
      size * 0.78,
    )}px;object-fit:contain;pointer-events:none;`;
    return img;
  }

  /** Строка «Снаряжение»: правая рука, левая рука, за спиной. */
  private equipRow(eq: Equipped, cell: number): HTMLElement {
    const wrap = el("div", "margin-top:6px;");
    const cap = el("div", "font-size:11px;opacity:.55;margin-bottom:4px;");
    cap.textContent = "СНАРЯЖЕНИЕ";
    wrap.appendChild(cap);

    const row = el("div", "display:flex;gap:6px;flex-wrap:wrap;align-items:center;");
    const one = (
      label: string,
      w: { cls: WeaponClass; tier: WeaponTier } | null,
    ): HTMLElement => {
      const s = Math.round(cell * 0.82);
      const box = this.cellBox(s, !!w, false);
      if (w) {
        const icon = weaponIcon(w.cls, w.tier);
        if (icon) {
          const img = document.createElement("img");
          img.src = `/icons/${icon}`;
          img.draggable = false;
          img.style.cssText = `width:${Math.round(s * 0.78)}px;height:${Math.round(
            s * 0.78,
          )}px;object-fit:contain;pointer-events:none;`;
          box.appendChild(img);
        } else {
          const d = weaponDef(w.cls, w.tier);
          const c = d.tint.map((v) => Math.round(v * 255)).join(",");
          box.appendChild(el("div", `width:58%;height:58%;border-radius:5px;background:rgb(${c});`));
        }
        box.title = weaponDef(w.cls, w.tier).name;
      }
      const cellWrap = el("div", "display:flex;flex-direction:column;align-items:center;gap:2px;");
      const cap2 = el("div", "font-size:10px;opacity:.5;");
      cap2.textContent = label;
      cellWrap.append(box, cap2);
      return cellWrap;
    };

    row.append(one("прав.", eq.right), one("лев.", eq.left));
    for (const st of eq.stowed) row.appendChild(one("спина", st));
    if (!eq.right && !eq.left && eq.stowed.length === 0) {
      const none = el("div", "font-size:12px;opacity:.5;align-self:center;");
      none.textContent = "руки пусты — возьми оружие на стойках в лагере";
      row.appendChild(none);
    }
    wrap.appendChild(row);
    return wrap;
  }

  /** Описание выбранного предмета + подсказка по горячим клавишам. */
  private infoRow(inv: Inventory): HTMLElement {
    const box = el(
      "div",
      "margin-top:8px;min-height:34px;padding:6px 8px;border-radius:8px;" +
        "background:#171b26;border:1px solid #2b3143;font-size:12px;line-height:1.35;",
    );
    const slot = this.picked >= 0 ? inv.slots[this.picked] : null;
    if (!slot?.item) {
      box.style.opacity = "0.55";
      box.textContent = inv.isEmpty
        ? "Сумка пуста. Зелья и золотое оружие падают с мобов и босса."
        : "Нажми на предмет — покажу, что это. Ещё раз — использовать.";
      return box;
    }
    const def = ITEMS[slot.item];
    const title = el("div", "font-weight:600;margin-bottom:2px;");
    title.textContent = `${def.name}${slot.count > 1 ? ` ×${slot.count}` : ""}`;
    const desc = el("div", "opacity:.75;");
    desc.textContent =
      def.heal > 0 ? `${def.hint} · +${def.heal} HP · клавиши X / 1 / F` : def.hint;
    box.append(title, desc);
    return box;
  }
}
