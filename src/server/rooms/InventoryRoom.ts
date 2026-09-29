// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import { atMaxLevel, xpToNext } from "#shared/progression";
import colyseus from "colyseus";
import type { Client } from "colyseus";

import {
  affixLabel,
  isWeaponClass,
  isWeaponTier,
  ITEMS,
  scrapValue,
  bagCount,
  enchantInfo,
  weaponDef,
  weaponQuality,
  type WeaponInstance,
  type WeaponTier,
} from "#shared/items";
import { heroStatRows } from "#shared/heroStats";
import { store } from "../store";
import { invHub } from "../invHub";
import { respecCostFor, RESPEC_ENABLED } from "#shared/constants";

interface InventoryJoinOptions {
  /** Ник из адреса `/inv?ник`. */
  nick?: string;
  /** Сессия этого браузера (localStorage), см. invHub. */
  sid?: string;
  /** Старые ссылки `inv.html?t=…` — отвечаем ником, страница перейдёт на /inv?ник. */
  viewToken?: string;
}

type InvAct = { act?: unknown; id?: unknown; idx?: unknown };

/** Название+тир+роллы надетого в руке — null, если рука пуста/базовая. */
/** Для окна заточки: по каждому аффиксу — очки, max, шанс и цена. */
function enchDetails(w: WeaponInstance): { label: string; points: number; max: boolean; chance: number; cost: number }[] {
  return w.affixes.map((a, i) => ({ label: affixLabel(a), ...enchantInfo(w, i)! }));
}

function handInfo(
  cls: string,
  tier: string,
  equippedId: string | null | undefined,
  weapons: WeaponInstance[],
): {
  cls: string;
  name: string;
  tier: WeaponTier;
  affixes: string[];
  quality: number;
  id: string;
  ench: ReturnType<typeof enchDetails>;
} | null {
  if (!isWeaponClass(cls) || !isWeaponTier(tier) || tier === "base") return null;
  const inst = equippedId ? weapons.find((w) => w.id === equippedId) : undefined;
  return {
    cls,
    name: weaponDef(cls, tier).name,
    tier,
    affixes: inst ? inst.affixes.map(affixLabel) : [],
    quality: inst ? weaponQuality(inst) : 0,
    id: inst?.id ?? "",
    ench: inst ? enchDetails(inst) : [],
  };
}

/**
 * Комната веб-страницы инвентаря (`/inv?ник`, inv.html). Данные — через
 * client.send() без схемы (см. комментарий в onCreate). Сокет живёт, пока
 * открыта страница: после кода в чате / действия / смены склада в игре
 * страница перерисовывается сама (invHub.notify).
 */
export class InventoryRoom extends colyseus.Room {
  private readonly who = new Map<string, { norm: string; sid: string }>();
  private unlisten: (() => void) | null = null;
  private readonly lastAct = new Map<string, number>();

  override onCreate(): void {
    this.autoDispose = true;
    // Сознательно НЕ зовём setState(): пустая Schema у @colyseus/schema в этой
    // версии ломает рефлексию на клиенте ("v is not a constructor" при decode).
    // Без setState() комната на дефолтном NoneSerializer — данные только через send().
    this.unlisten = invHub.listen((norm) => {
      for (const c of this.clients) if (this.who.get(c.sessionId)?.norm === norm) this.sendInv(c);
    });
    this.onMessage("act", (client, m: InvAct) => {
      const w = this.who.get(client.sessionId);
      if (!w || !invHub.isAuthed(w.sid, w.norm)) {
        client.send("toast", { ok: false, text: "Сначала подтверди вход кодом в чате." });
        return;
      }
      const act =
        m?.act === "equip" || m?.act === "scrap" || m?.act === "enchant" || m?.act === "stat" || m?.act === "respec"
          ? m.act
          : null;
      const id = typeof m?.id === "string" ? m.id : act === "respec" ? "-" : "";
      const idx = typeof m?.idx === "number" && Number.isInteger(m.idx) ? m.idx : 0;
      if (!act || !id) return;
      // Не чаще 4 раз в секунду — заточку не закликать скриптом быстрее анимации.
      const now = Date.now();
      if (now - (this.lastAct.get(client.sessionId) ?? 0) < 250) return;
      this.lastAct.set(client.sessionId, now);
      const r = invHub.act(w.norm, act, id, idx);
      client.send(r.enchant ? "enchant" : "toast", r);
    });
    this.onMessage("refresh", (client) => this.sendInv(client));
  }

  override onDispose(): void {
    this.unlisten?.();
  }

  override onLeave(client: Client): void {
    this.who.delete(client.sessionId);
  }

  override onJoin(client: Client, options: InventoryJoinOptions): void {
    const vt = typeof options?.viewToken === "string" ? options.viewToken : "";
    if (vt) {
      const rec = store.entries().find((r) => r.viewToken === vt);
      client.send("inv", rec ? { ok: true, redirect: rec.token.replace(/^nick:/, "") } : { ok: false });
      return;
    }
    const norm = normNick(typeof options?.nick === "string" ? options.nick : "");
    const sid = invHub.sid(options?.sid);
    client.send("sid", sid);
    this.who.set(client.sessionId, { norm, sid });
    this.sendInv(client);
  }

  private sendInv(client: Client): void {
    const w = this.who.get(client.sessionId);
    if (!w) return;
    try {
      client.send("inv", buildInv(w.norm, w.sid));
    } catch (e) {
      console.error("[inv] сборка страницы упала:", e);
      try {
        client.send("inv", { ok: false, error: String(e) });
      } catch {
        /* сокет уже мёртв */
      }
    }
  }
}

function normNick(n: string): string {
  return decodeURIComponent(n).trim().replace(/^@/, "").toLowerCase().slice(0, 24);
}

function buildInv(norm: string, sid: string): Record<string, unknown> {
  if (!norm) return { ok: false, error: "В адресе нет ника — открой ссылку из !inv в чате." };
  invHub.sync(norm);
  const rec = store.get(`nick:${norm}`);
  if (!rec) return { ok: false, error: `У «${norm}» ещё нет героя — напиши !play в чате.` };
  const authed = invHub.isAuthed(sid, norm);
  const weaponsList = rec.weapons ?? [];
  const equippedIds = new Set(
    [rec.equippedWeaponId?.left, rec.equippedWeaponId?.right].filter((id): id is string => !!id),
  );
  const weapons = weaponsList
    .filter((w) => !equippedIds.has(w.id))
    .map((w, i) => ({
      num: i + 1,
      id: w.id,
      cls: w.cls,
      tier: w.tier,
      name: weaponDef(w.cls, w.tier).name,
      affixes: w.affixes.map(affixLabel),
      quality: weaponQuality(w),
      scrap: scrapValue(w),
      ench: enchDetails(w),
    }));
  const misc = (rec.bag ?? [])
    .filter((s) => s.item && s.count > 0)
    .map((s) => ({ name: ITEMS[s.item!].name, count: s.count }));
  const leftInst = rec.equippedWeaponId?.left
    ? weaponsList.find((w) => w.id === rec.equippedWeaponId!.left)
    : undefined;
  const rightInst = rec.equippedWeaponId?.right
    ? weaponsList.find((w) => w.id === rec.equippedWeaponId!.right)
    : undefined;
  const stats = heroStatRows({
    level: rec.level,
    str: rec.str,
    agi: rec.agi,
    int: rec.int,
    rightCls: rec.held?.right?.cls ?? "",
    rightTier: rec.held?.right?.tier ?? "",
    leftCls: rec.held?.left?.cls ?? "",
    leftTier: rec.held?.left?.tier ?? "",
    rightAffix: rightInst ? rightInst.affixes.map(affixLabel).join(", ") : "",
    leftAffix: leftInst ? leftInst.affixes.map(affixLabel).join(", ") : "",
  });
  return {
    ok: true,
    nick: rec.nick || norm,
    authed,
    code: authed ? undefined : invHub.code(sid, norm),
    level: rec.level,
    // Опыт к следующему уровню: доля 0..1 (на максимальном уровне — 1).
    xpFrac: atMaxLevel(rec.level) ? 1 : Math.max(0, Math.min(1, (rec.xp ?? 0) / xpToNext(rec.level))),
    stats,
    hands: {
      left: handInfo(rec.held?.left?.cls ?? "", rec.held?.left?.tier ?? "", rec.equippedWeaponId?.left, weaponsList),
      right: handInfo(rec.held?.right?.cls ?? "", rec.held?.right?.tier ?? "", rec.equippedWeaponId?.right, weaponsList),
    },
    weapons,
    misc,
    scrapHave: bagCount(rec.bag ?? [], "scrap"),
    attrs: { unspent: rec.unspent ?? 0, str: rec.str, agi: rec.agi, int: rec.int },
    fish: bagCount(rec.bag ?? [], "fish"),
    respecCost: RESPEC_ENABLED ? respecCostFor(rec.respecCount ?? 0) : -1,
  };
}
