import { JEWEL_ACTS, jewelBonus, jewelsOf, pcInvJewels } from "#shared/jewels";
import { TRADE_ACTS, tradeViewOf } from "../trade";
// colyseus 0.15 — CJS-пакет без ESM-exports, поэтому default-импорт (как в index.ts/ZoneRoom.ts).
import { CLASSES2, classOf2, type SkillId, type Weapon2 } from "#shared/classes2";
import { atMaxLevel, xpToNext } from "#shared/progression";
import colyseus from "colyseus";
import type { Client } from "colyseus";

import {
  affixLabel,
  instanceLabels,
  heldAffixText,
  instanceEffects,
  instanceName,
  scrapValue,
  bagCount,
  enchantInfo,
  isRubyFuel,
  weaponQuality,
  bestWeaponInstance,
  handsRoll,
  isWeaponClass,
  isWeaponTier,
  weaponDef,
  type WeaponInstance,
  type WeaponTier,
} from "#shared/items";
import { skillStrike, strikeKindOf } from "#shared/strike";
import { heroStatRows } from "#shared/heroStats";
import type { PcInvData, PcInvWeapon } from "#shared/net/messages";
import { FEEDBACK_COOLDOWN_MS, FEEDBACK_TEXT_MAX, isFeedbackKind, isFeedbackMark, type FeedbackKind } from "#shared/feedback";
import { feedback, store } from "../store";
import { invHub, type InvActKind } from "../invHub";
import { isAdminNick, respecCostFor, RESPEC_ENABLED } from "#shared/constants";

interface InventoryJoinOptions {
  /** Ник из адреса `/inv?ник`. */
  nick?: string;
  /** Сессия этого браузера (localStorage), см. invHub. */
  sid?: string;
  /** Старые ссылки `inv.html?t=…` — отвечаем ником, страница перейдёт на /inv?ник. */
  viewToken?: string;
}

type InvAct = { act?: unknown; id?: unknown; idx?: unknown; fuel?: unknown };

/** Для окна заточки: по каждому аффиксу — очки, max, шанс и цена. */
function enchDetails(w: WeaponInstance): PcInvWeapon["ench"] {
  return w.affixes.map((a, i) => ({ label: affixLabel(a), ...enchantInfo(w, i)! }));
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
        m?.act === "equip" || m?.act === "unequip" || m?.act === "scrap" || m?.act === "enchant" || m?.act === "stat" || m?.act === "respec" || m?.act === "scroll" || m?.act === "title" || m?.act === "skills" || m?.act === "fav" || m?.act === "scrapAll" || m?.act === "gift" || m?.act === "giftSeen" || (JEWEL_ACTS as readonly unknown[]).includes(m?.act) || (TRADE_ACTS as readonly unknown[]).includes(m?.act)
          ? m.act
          : null;
      const id = typeof m?.id === "string" ? m.id : act === "respec" ? "-" : "";
      const idx = typeof m?.idx === "number" && Number.isInteger(m.idx) ? m.idx : 0;
      if (!act || !id) return;
      // Не чаще 4 раз в секунду — заточку не закликать скриптом быстрее анимации.
      const now = Date.now();
      if (now - (this.lastAct.get(client.sessionId) ?? 0) < 250) return;
      this.lastAct.set(client.sessionId, now);
      const r = invHub.act(w.norm, act as InvActKind, id, idx, typeof m?.fuel === "string" ? m.fuel : undefined);
      client.send(r.enchant ? "enchant" : "toast", r);
    });
    this.onMessage("refresh", (client) => this.sendInv(client));
    // «Помощь в разработке»: список видят все, писать — только с подтверждённым входом, пометки — только админ.
    this.onMessage("feedbackList", (client, m: { kind?: unknown }) => {
      const w = this.who.get(client.sessionId);
      if (!w || !isFeedbackKind(m?.kind)) return;
      client.send("feedback", feedbackReply(w, m.kind));
    });
    this.onMessage("feedbackAdd", (client, m: { kind?: unknown; text?: unknown }) => {
      const w = this.who.get(client.sessionId);
      if (!w || !isFeedbackKind(m?.kind)) return;
      if (!invHub.isAuthed(w.sid, w.norm)) return client.send("toast", { ok: false, text: "Писать могут те, кто подтвердил вход кодом в чате." });
      const text = typeof m.text === "string" ? m.text.trim() : "";
      if (!text) return client.send("toast", { ok: false, text: "Напиши текст." });
      if (text.length > FEEDBACK_TEXT_MAX) return client.send("toast", { ok: false, text: `Не больше ${FEEDBACK_TEXT_MAX} символов.` });
      const now = Date.now();
      const wait = FEEDBACK_COOLDOWN_MS - (now - (feedbackAt.get(w.norm) ?? 0));
      if (wait > 0) return client.send("toast", { ok: false, text: `Подожди ${Math.ceil(wait / 1000)} с перед следующей отправкой.` });
      feedbackAt.set(w.norm, now);
      feedback.add(m.kind, nickOf(w.norm), text);
      client.send("toast", { ok: true, text: "Спасибо! Записано — видно всем на этой вкладке." });
      client.send("feedback", { ...feedbackReply(w, m.kind), added: true });
    });
    this.onMessage("feedbackMark", (client, m: { id?: unknown; mark?: unknown }) => {
      const w = this.who.get(client.sessionId);
      if (!w || !invHub.isAuthed(w.sid, w.norm)) return;
      if (!isAdminNick(nickOf(w.norm))) return client.send("toast", { ok: false, text: "Пометки ставит только админ." });
      const mark = m?.mark === null ? null : isFeedbackMark(m?.mark) ? m.mark : undefined;
      if (mark === undefined || typeof m?.id !== "string") return;
      const it = feedback.setMark(m.id, mark, nickOf(w.norm));
      if (!it) return client.send("toast", { ok: false, text: "Такой записи уже нет — обнови список." });
      client.send("toast", { ok: true, text: mark ? "Пометка поставлена" : "Пометка снята" });
      client.send("feedback", feedbackReply(w, it.kind));
    });
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

/** Когда последний раз писали в «Помощь» (по нику) — пауза между отправками. */
const feedbackAt = new Map<string, number>();

/** Ник героя как записан (с заглавными), без записи — логин. */
function nickOf(norm: string): string {
  return store.get(`nick:${norm}`)?.nick || norm;
}

/** Список вида для страницы; admin — можно ставить пометки (только с подтверждённым входом). */
function feedbackReply(w: { norm: string; sid: string }, kind: FeedbackKind) {
  return { kind, items: feedback.list(kind), admin: invHub.isAuthed(w.sid, w.norm) && isAdminNick(nickOf(w.norm)) };
}

function buildInv(norm: string, sid: string): Record<string, unknown> {
  if (!norm) return { ok: false, error: "В адресе нет ника — открой ссылку из !inv в чате." };
  invHub.sync(norm);
  const rec = store.get(`nick:${norm}`);
  if (!rec) return { ok: false, error: `У «${norm}» ещё нет героя — напиши !play в чате.` };
  const authed = invHub.isAuthed(sid, norm);
  const weaponsList = rec.weapons ?? [];
  // Экземпляр в руке: закреплённый, иначе лучший того же вида/тира (как считает игра).
  const instIn = (side: "left" | "right"): WeaponInstance | undefined => {
    const h = rec.held?.[side];
    if (!h?.cls) return undefined;
    const pinned = weaponsList.find((w) => w.id === rec.equippedWeaponId?.[side]);
    if (pinned && pinned.cls === h.cls && pinned.tier === h.tier) return pinned;
    return bestWeaponInstance(weaponsList, h.cls as WeaponInstance["cls"], h.tier as WeaponTier) ?? undefined;
  };
  const leftInst = instIn("left");
  const rightInst = instIn("right");
  const jewels = jewelsOf(rec);
  // Сила удара умений — как у сервера (ZoneRoom.strikeOfLive): рука класса, её тир и роллы урона (лучший из двух рук).
  let strike: number | undefined;
  const strikeCls = classOf2((rec.held?.left?.cls ?? "") as Weapon2 | "", (rec.held?.right?.cls ?? "") as Weapon2 | "");
  if (strikeCls) {
    const side: "left" | "right" = rec.held?.right?.cls === strikeKindOf(strikeCls) ? "right" : "left";
    const other = side === "left" ? "right" : "left";
    const held = rec.held?.[side];
    const main = instIn(side);
    const off = rec.held?.[other] ? instIn(other) : undefined;
    const shield = off && off.id !== main?.id ? off : undefined;
    const mult = isWeaponClass(held?.cls) && isWeaponTier(held?.tier) ? weaponDef(held.cls, held.tier).mult : 1;
    const roll = 1 + handsRoll(main?.affixes, shield?.affixes, "dmgFlat", "dmgPct");
    const attrs = { str: rec.str, agi: rec.agi, int: rec.int, con: rec.con ?? 1, luc: rec.luc ?? 1, wis: rec.wis ?? 1, gb: jewelBonus(jewels) };
    strike = Math.round(skillStrike(strikeCls, rec.level, attrs, { mult, tier: held?.tier ?? "", roll }).dmg * 10) / 10;
  }
  const stats = heroStatRows({
    gb: jewelBonus(jewels),
    level: rec.level,
    str: rec.str,
    agi: rec.agi,
    int: rec.int,
    con: rec.con ?? 1,
    luc: rec.luc ?? 1,
    wis: rec.wis ?? 1,
    rightCls: rec.held?.right?.cls ?? "",
    rightTier: rec.held?.right?.tier ?? "",
    leftCls: rec.held?.left?.cls ?? "",
    leftTier: rec.held?.left?.tier ?? "",
    rightAffix: heldAffixText(rightInst),
    leftAffix: heldAffixText(leftInst),
  });
  // Окно как в игре (PcInventory): живой герой — из мира, иначе — из сохранения.
  const pcLive = invHub.pcInv(norm);
  const pc: PcInvData = pcLive ?? {
    weapons: weaponsList.map((w) => ({
      id: w.id,
      cls: w.cls,
      tier: w.tier,
      name: instanceName(w),
      affixes: instanceLabels(w),
      effects: instanceEffects(w),
      quality: weaponQuality(w),
      scrap: scrapValue(w),
      ench: enchDetails(w),
      fav: !!w.fav,
      fuel: isRubyFuel(w),
    })),
    equipped: { left: leftInst && leftInst !== rightInst ? leftInst.id : null, right: rightInst?.id ?? null },
    potions: bagCount(rec.bag ?? [], "potion"),
    scrap: bagCount(rec.bag ?? [], "scrap"),
    fish: bagCount(rec.bag ?? [], "fish"),
    scrollXp: bagCount(rec.bag ?? [], "scroll_xp"),
    scrollWind: bagCount(rec.bag ?? [], "scroll_wind"),
    titles: rec.titles ?? [],
    title: rec.title ?? "",
    tokens: rec.tokens ?? 0,
    attrs: { unspent: rec.unspent ?? 0, str: rec.str, agi: rec.agi, int: rec.int, con: rec.con ?? 1, luc: rec.luc ?? 1, wis: rec.wis ?? 1 },
    gb: jewelBonus(jewels),
    strike,
    respecCost: RESPEC_ENABLED ? respecCostFor(rec.respecCount ?? 0) : -1,
    stats,
    skills: skillsOf(rec),
    jewels: pcInvJewels(jewels),
    giftNotes: rec.giftNotes ?? [],
    trade: tradeViewOf(rec, rec.token),
  };
  const heldOf = (h: { cls: string; tier: string } | null | undefined) =>
    h && h.cls ? { cls: h.cls, tier: h.tier } : null;
  pc.partners = invHub.partners(norm);
  return {
    ok: true,
    pc,
    heldHands: { left: heldOf(rec.held?.left), right: heldOf(rec.held?.right) },
    nick: rec.nick || norm,
    authed,
    code: authed ? undefined : invHub.code(sid, norm),
    level: rec.level,
    // Опыт к следующему уровню: доля 0..1 (на максимальном уровне — 1).
    xpFrac: atMaxLevel(rec.level) ? 1 : Math.max(0, Math.min(1, (rec.xp ?? 0) / xpToNext(rec.level))),
  };
}

/** Умения героя по сохранённому снаряжению: класс и выбранные (или по умолчанию). */
function skillsOf(rec: { held?: { left?: { cls: string } | null; right?: { cls: string } | null }; skills?: Record<string, string[]> }): { cls: string; chosen: string[] } {
  const cls = classOf2((rec.held?.left?.cls ?? "") as Weapon2 | "", (rec.held?.right?.cls ?? "") as Weapon2 | "");
  if (!cls) return { cls: "", chosen: [] };
  const def = CLASSES2[cls];
  const saved = (rec.skills?.[cls] ?? []).filter((k: string) => def.skills.includes(k as SkillId));
  return { cls, chosen: saved.length ? saved : [...def.defaultSkills] };
}
