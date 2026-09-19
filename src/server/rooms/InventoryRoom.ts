// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import colyseus from "colyseus";
import type { Client } from "colyseus";

import {
  affixLabel,
  isWeaponClass,
  isWeaponTier,
  ITEMS,
  weaponDef,
  weaponQuality,
  type WeaponInstance,
  type WeaponTier,
} from "#shared/items";
import { store } from "../store";

interface InventoryJoinOptions {
  viewToken?: string;
}

/** Название+тир+роллы надетого в руке — null, если рука пуста/базовая. */
function handInfo(
  cls: string,
  tier: string,
  equippedId: string | null | undefined,
  weapons: WeaponInstance[],
): { name: string; tier: WeaponTier; affixes: string[]; quality: number } | null {
  if (!isWeaponClass(cls) || !isWeaponTier(tier) || tier === "base") return null;
  const inst = equippedId ? weapons.find((w) => w.id === equippedId) : undefined;
  return {
    name: weaponDef(cls, tier).name,
    tier,
    affixes: inst ? inst.affixes.map(affixLabel) : [],
    quality: inst ? weaponQuality(inst) : 0,
  };
}

/**
 * Комната-однострелка для веб-страницы инвентаря (`!inv` в чате, `inv.html`).
 * Никакого HTTP API нет и не заводим — прод-nginx сейчас не проксирует ничего,
 * кроме /matchmake/ и WS-комнат (см. deploy/nginx-vrgame.conf), а SSH на VPS,
 * чтобы это поправить, недоступен. Зато matchmake/WS УЖЕ проксируются — тот же
 * путь, что и у обычного джойна в игру, только сюда шлём viewToken вместо
 * guestToken и сразу получаем данные ОДНИМ сообщением, без схемы/тика.
 */
export class InventoryRoom extends colyseus.Room {
  override onCreate(): void {
    this.autoDispose = true;
    // Сознательно НЕ зовём setState(): пустая Schema ("class X extends Schema {}",
    // без единого @type-поля) у @colyseus/schema в этой версии ломает рефлексию
    // на клиенте ("v is not a constructor" при decode) — хуже, чем без неё.
    // Без setState() комната остаётся на дефолтном NoneSerializer (id "none",
    // getFullState()===null) — он и на клиенте, и на сервере уже зарегистрирован
    // из коробки, посылать вообще нечего. Данные — только через client.send().
  }

  override onJoin(client: Client, options: InventoryJoinOptions): void {
    try {
      const token = typeof options?.viewToken === "string" ? options.viewToken : "";
      const rec = token ? store.entries().find((r) => r.viewToken === token) : undefined;
      if (!rec) {
        client.send("inv", { ok: false });
        return;
      }
      const weaponsList = rec.weapons ?? [];
      // Надетое показываем отдельно (см. hands ниже), а не в общем списке —
      // и номер тут даём ПОДРЯД только по видимой (ненадетой) части, ровно
      // как считает resolveWeaponArg на сервере ("!equip"/"!scrap" в чате).
      // Раньше номер был честной позицией в rt.weapons: если надетый предмет
      // сидел в середине склада, у остальных номера съезжали с дырой.
      const equippedIds = new Set(
        [rec.equippedWeaponId?.left, rec.equippedWeaponId?.right].filter((id): id is string => !!id),
      );
      const weapons = weaponsList
        .filter((w) => !equippedIds.has(w.id))
        .map((w, i) => ({
          num: i + 1,
          id: w.id,
          tier: w.tier,
          name: weaponDef(w.cls, w.tier).name,
          affixes: w.affixes.map(affixLabel),
          quality: weaponQuality(w),
        }));
      const misc = (rec.bag ?? [])
        .filter((s) => s.item && s.count > 0)
        .map((s) => ({ name: ITEMS[s.item!].name, count: s.count }));
      client.send("inv", {
        ok: true,
        nick: rec.nick,
        hands: {
          left: handInfo(
            rec.held?.left?.cls ?? "",
            rec.held?.left?.tier ?? "",
            rec.equippedWeaponId?.left,
            weaponsList,
          ),
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
    } catch (e) {
      // Пока не восстановлен SSH на прод — единственный способ увидеть причину
      // падения на сервере: прислать её же клиенту, а не гадать по коду закрытия.
      console.error("[inv] onJoin упал:", e);
      try {
        client.send("inv", { ok: false, error: String(e) });
      } catch {
        /* сокет уже мёртв — ничего не поделать */
      }
    }
  }
}
