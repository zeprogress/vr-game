// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import colyseus from "colyseus";
import type { Client } from "colyseus";

import { affixLabel, weaponDef } from "#shared/items";
import { store } from "../store";

interface InventoryJoinOptions {
  viewToken?: string;
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
  }

  override onJoin(client: Client, options: InventoryJoinOptions): void {
    const token = typeof options?.viewToken === "string" ? options.viewToken : "";
    const rec = token ? store.entries().find((r) => r.viewToken === token) : undefined;
    if (!rec) {
      client.send("inv", { ok: false });
      client.leave();
      return;
    }
    const weapons = (rec.weapons ?? []).map((w) => ({
      id: w.id,
      tier: w.tier,
      name: weaponDef(w.cls, w.tier).name,
      affixes: w.affixes.map(affixLabel),
      equipped: rec.equippedWeaponId?.left === w.id || rec.equippedWeaponId?.right === w.id,
    }));
    client.send("inv", { ok: true, nick: rec.nick, weapons });
    // Разовый запрос-ответ — держать соединение незачем, страница сама не
    // переоткрывает джойн (просто перезагрузка страницы шлёт новый).
    client.leave();
  }
}
