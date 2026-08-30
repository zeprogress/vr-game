import { BAG, emptyBag, isItemId, ITEMS, type ItemId, type Slot } from "#shared/items";

export type { ItemId, Slot };
export { ITEMS, BAG };

/**
 * Сумка игрока — ВИД серверного состояния (этап 8).
 * Содержимое приезжает в схеме, `use()` только шлёт заявку.
 */
export class Inventory {
  readonly slots: Slot[] = emptyBag();
  private readonly listeners = new Set<() => void>();

  /** Онлайн: заявка «выпить зелье из ячейки». Офлайн — null. */
  onUseRequest: ((slot: number) => void) | null = null;

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get isEmpty(): boolean {
    return this.slots.every((s) => s.item === null);
  }

  /** Ячейка пригодна к использованию (зелье). */
  usable(index: number): boolean {
    const s = this.slots[index];
    return !!s?.item && ITEMS[s.item].heal > 0;
  }

  use(index: number): boolean {
    if (!this.usable(index)) return false;
    this.onUseRequest?.(index);
    return true;
  }

  /** Применить сумку с сервера. Ничего не делает, если не изменилась. */
  applyRemote(bag: ArrayLike<{ item: string; count: number } | undefined>): void {
    let changed = false;
    for (let i = 0; i < this.slots.length; i++) {
      const src = bag[i];
      const filled = !!src && isItemId(src.item) && src.count > 0;
      const item = filled ? (src.item as ItemId) : null;
      const count = filled ? src.count : 0;
      const dst = this.slots[i];
      if (dst.item !== item || dst.count !== count) {
        dst.item = item;
        dst.count = count;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  clear(): void {
    let changed = false;
    for (const s of this.slots) {
      if (s.item === null && s.count === 0) continue;
      s.item = null;
      s.count = 0;
      changed = true;
    }
    if (changed) this.emit();
  }
}
