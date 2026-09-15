// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import colyseus from "colyseus";
import type { Client } from "colyseus";
import { Schema } from "@colyseus/schema";

import {
  affixLabel,
  isWeaponClass,
  isWeaponTier,
  ITEMS,
  weaponDef,
  type WeaponInstance,
} from "#shared/items";
import { store } from "../store";

interface InventoryJoinOptions {
  viewToken?: string;
}

/**
 * Пустая схема — Colyseus сериализует состояние комнаты клиенту сразу при
 * джойне, и без setState() (state === undefined) это падало с ошибкой
 * сервера (WS-код 4002, "закрыто с ошибкой") ДО того, как onJoin вообще
 * успевал что-то отправить. Данные шлём не через схему, а обычным
 * сообщением ("inv") — схема нужна только чтобы не было undefined.
 */
class InventoryState extends Schema {}

/** Название+роллы надетого в руке — null, если рука пуста/базовая. */
function handInfo(
  cls: string,
  tier: string,
  equippedId: string | null | undefined,
  weapons: WeaponInstance[],
): { name: string; affixes: string[] } | null {
  if (!isWeaponClass(cls) || !isWeaponTier(tier) || tier === "base") return null;
  const inst = equippedId ? weapons.find((w) => w.id === equippedId) : undefined;
  return { name: weaponDef(cls, tier).name, affixes: inst ? inst.affixes.map(affixLabel) : [] };
}

/**
 * Комната-однострелка для веб-страницы инвентаря (`!inv` в чате, `inv.html`).
 * Никакого HTTP API нет и не заводим — прод-nginx сейчас не проксирует ничего,
 * кроме /matchmake/ и WS-комнат (см. deploy/nginx-vrgame.conf), а SSH на VPS,
 * чтобы это поправить, недоступен. Зато matchmake/WS УЖЕ проксируются — тот же
 * путь, что и у обычного джойна в игру, только сюда шлём viewToken вместо
 * guestToken и сразу получаем данные ОДНИМ сообщением, без схемы/тика.
 */
export class InventoryRoom extends colyseus.Room<InventoryState> {
  override onCreate(): void {
    this.autoDispose = true;
    this.setState(new InventoryState());
  }

  override onJoin(client: Client, options: InventoryJoinOptions): void {
    const token = typeof options?.viewToken === "string" ? options.viewToken : "";
    const rec = token ? store.entries().find((r) => r.viewToken === token) : undefined;
    if (!rec) {
      client.send("inv", { ok: false });
      return;
    }
    const weaponsList = rec.weapons ?? [];
    const weapons = weaponsList.map((w) => ({
      id: w.id,
      tier: w.tier,
      name: weaponDef(w.cls, w.tier).name,
      affixes: w.affixes.map(affixLabel),
      equipped: rec.equippedWeaponId?.left === w.id || rec.equippedWeaponId?.right === w.id,
    }));
    const misc = (rec.bag ?? [])
      .filter((s) => s.item && s.count > 0)
      .map((s) => ({ name: ITEMS[s.item!].name, count: s.count }));
    client.send("inv", {
      ok: true,
      nick: rec.nick,
      hands: {
        left: handInfo(rec.held?.left?.cls ?? "", rec.held?.left?.tier ?? "", rec.equippedWeaponId?.left, weaponsList),
        right: handInfo(
          rec.held?.right?.cls ?? "",
          rec.held?.right?.tier ?? "",
          rec.equippedWeaponId?.right,
          weaponsList,
        ),
      },
      weapons,
      misc,
    });
    // Закрыть соединение должен сам клиент ПОСЛЕ того, как обработает
    // сообщение (см. src/client/inv/main.ts) — закрытие отсюда синхронно
    // с send() иногда обгоняло доставку и рвало сокет (code 4002) раньше,
    // чем colyseus.js успевал разобрать входящее.
  }
}
