import {
  CAT_AFFIXES,
  CAT_SHRINE,
  CAT_SHRINES,
  CAT_THEMES,
  CAT_FINAL,
  CAT_CURSES,
  CAT_HAZARD,
  CAT_HALLS,
  catCorridor,
  catLinkIndex,
  catNext,
  catOpen,
  CAT_PHASE,
  CAT_PORTAL,
  CATACOMBS,
  catBossSpot,
  catEntry,
  catGates,
  type CatAffix,
  type CatBoss,
  type CatShrine,
  type CatCurse,
  type CatHazardKind,
  type CatMech,
  type CatWave,
  type CatChampion,
} from "#shared/catacombs";
import { CAT_CHAMPIONS, CAT_MECH_POOL } from "#shared/mobs";
import type { CatacombMsg, CatReportMsg, LootItem } from "#shared/net/messages";

/**
 * Что режиссёру катакомб нужно от комнаты. Сам забег идёт в ТОМ ЖЕ мире
 * (ZoneRoom/ZoneSim): мобы — обычные мобы симуляции, удары и лут — общие.
 */
export interface CatHost {
  /** Секунды и миллисекунды «сейчас». */
  now(): number;
  /** Живые герои: id → позиция/уровень/бот ли. */
  heroes(): { id: string; x: number; z: number; level: number; dead: boolean; bot: boolean; nick: string }[];
  /** Состояние для клиентов (поля catPhase…). */
  setState(s: { phase: number; lo: number; hi: number; route: string; lives: number; left: number; party: number; stage: number; final: boolean; boss: string }): void;
  /** Титры: всем (игрокам — баннер, зрителям — карточка). */
  announce(m: CatacombMsg): void;
  /** Сообщение в чат Twitch. */
  chat(text: string): void;
  /** Можно ли сейчас открыть сбор (нет другого события и т.п.). */
  canOpen(): boolean;
  /** Перенести героя (игрок — сообщение warp, бот — сервер сам). */
  warp(id: string, x: number, z: number, faceX?: number, faceZ?: number): void;
  /** Вернуть героя в лагерь. */
  sendHome(id: string): void;
  /** Поднять павшего героя (у входа в текущий зал). */
  revive(id: string): void;
  /** Итог победы: комната дополнит строки (ник, класс, урон, убийства) и разошлёт таблицу. */
  report(r: Omit<CatReportMsg, "rows">, heroes: { id: string; deaths: number; loot: LootItem[] }[]): void;
  /** Моб катакомб: тип (ключ ELITE_MOBS или slime/spitter), точка и множители. Возвращает id. */
  spawn(type: string, x: number, z: number, o: { hpMul: number; dmgMul: number; scaleMul?: number; name?: string; partyLevel: number; affix?: CatAffix | null }): string;
  /** Темы залов на заход (для клиентов). */
  setThemes(s: string): void;
  /** Святилище в зале (k −1 — убрать). */
  setShrine(x: number, z: number, k: number): void;
  /** Конец забега: рекорды урона, забеги и победы — в сейв героев (таблица у спектатора). */
  saveRecords(ids: string[], win: boolean): void;
  /** Катакомбы не выключены админом (!ивенты катакомбы выкл) — можно открывать сбор сами и по команде. */
  autoOn(): boolean;
  /** Опыт герою за стража/Владыку: share — часть награды за заход, level0 — его уровень на старте захода. */
  xpReward(id: string, share: number, level0: number): void;
  /** Урон/убийства героя переходят на новое id (смена ПК ↔ бот). */
  rekeyStats(from: string, to: string): void;
  /** Благословение святилища — всему отряду. */
  shrineBless(s: CatShrine, ids: string[]): void;
  /** Жив ли моб. */
  alive(id: string): boolean;
  /** Убрать всех мобов катакомб. */
  clearMobs(ids: Iterable<string>): void;
  /** Финальный босс: включить атаки (волна/дыхание/дождь), тик атак и призыв свиты. */
  finalStart(id: string): void;
  finalTick(id: string): void;
  finalStop(): void;
  /** Таблица забега: урон/убийства (из симуляции) — разослать зрителям; reset — обнулить к новому забегу. */
  stats(rows: { id: string; deaths: number }[], reset?: boolean): void;
  /** Пали вместе со стражем: убрать мобов (рассыпаются прахом, без лута). */
  dismissMobs(ids: string[]): void;
  /** Награды: сундук стадии / суперприз — в склад героя. Возвращает выпавшее (для баннера). */
  chest(id: string, kind: "gold" | "final"): LootItem[];
  /** Сундук на полу (эффект) и зелья россыпью (lootMul — проклятие «Щедрая гробница»). */
  chestFx(x: number, z: number, final: boolean, lootMul: number): void;
  /** Опасность зала: телеграф-круги в точках, через CAT_HAZARD.delay — удар (и боты от них уворачиваются). */
  hazard(kind: CatHazardKind, pts: { x: number; z: number }[], o?: { r?: number; dmg?: number; delay?: number; stun?: number; knock?: number }): void;
  /** Где моб и сколько у него HP (null — нет/мёртв). */
  mobInfo(id: string): { x: number; z: number; hp: number; maxHp: number } | null;
  /** Щит стадии: неуязвим (удары — «MISS») + эффект купола. */
  setImmune(id: string, on: boolean): void;
  /** Оглушить / перенести моба / разъярить. */
  stunMob(id: string, sec: number): void;
  moveMob(id: string, x: number, z: number): void;
  enrage(id: string): void;
  /** Ворота открываются (портал) — через ~1.3 с оттуда полезут мобы. */
  gateFx(pts: { x: number; z: number }[]): void;
  /** Землетрясение/вспышка перед боссом (эффект в точке). */
  bossFx(x: number, z: number, final: boolean): void;
}

type Step = "intro" | "waves" | "bossIntro" | "boss" | "move";

/** План зала на этот заход: состав волн, страж, проклятие и опасности — случайные. */
interface StagePlan {
  waves: CatWave[][];
  /** Аффикс каждой волны (или null). */
  affixes: (CatAffix | null)[];
  shrine: CatShrine | null;
  boss?: CatBoss;
  /** Чемпион (мини-босс) каждой волны или null. */
  champs: (CatChampion | null)[];
  curse: CatCurse;
  hazard: CatHazardKind;
}

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];

/** Страж на этот заход: свои приёмы + 1 случайный из общего пула (без повторов по имени) — бой каждый раз другой. */
function withRandomMechs(b: CatBoss): CatBoss {
  const own = b.mech ?? [];
  const extra = CAT_MECH_POOL.filter((m) => !own.some((o) => o.name === m.name) && !own.some((o) => o.kind === m.kind && o.fx === m.fx))
    .sort(() => Math.random() - 0.5)
    .slice(0, 1);
  return { ...b, mech: [...own, ...extra] };
}

/** Режиссёр катакомб: сбор, забег по залам, награды, возврат. */
export class CatacombDirector {
  phase: number = CAT_PHASE.none;
  readonly party = new Set<string>();
  /** Открытые залы (стоять можно в lo..hi). */
  lo = 0;
  hi = 0;
  private stage = 0;
  private step: Step = "intro";
  private stepAt = 0;
  private wave = 0;
  private waveAt = 0;
  private phaseEnd = 0;
  private nextAuto = 0;
  private cooldownUntil = 0;
  private readonly mobs = new Set<string>();
  private bossId = "";
  private finalOn = false;
  /** Средний уровень пати — по нему комната подгоняет силу мобов. */
  private partyLevel = 1;
  /** Мозг стража: когда следующий приём каждого вида, свита, ярость, стадия Владыки. */
  private mechAt = new Map<string, number>();
  private addsAt = 0;
  private bossRage = false;
  /** Стадия Владыки: 1 Пламя, 2 Печать (щит), 2.5 печать разбита, 3 Ярость Бездны. */
  private finalPhase: number = 1;
  private readonly guardians = new Set<string>();
  private meteorAt = 0;
  private shieldFxAt = 0;
  private ringAt = 0;
  /** Свита «на подходе» (ворота открылись). */
  private pendingAdds: { group: CatWave[]; gates: { x: number; z: number }[]; at: number }[] = [];
  /** Имя зала с темой захода: «Зал костей · Огненная яма». */
  /** Жизни отряда (CATACOMBS.livesPerHero): сколько воскрешений осталось; кончились — объявили ли. */
  private lives = 0;
  private livesMax = 0;
  private livesOutSaid = false;
  /** Добыча каждого героя за забег (сундуки стражей и финальный) — для итоговой таблицы. */
  private readonly lootBy = new Map<string, LootItem[]>();
  private runStart = 0;
  /**
   * Павший из отряда хочет встать (вышло reviveSec): тратит жизнь отряда. Нет жизней — false,
   * лежит до перехода в следующий зал.
   */
  takeLife(id: string): boolean {
    if (!this.inRun(id)) return true;
    if (this.lives <= 0) {
      if (!this.livesOutSaid) {
        this.livesOutSaid = true;
        this.host.announce({ kind: "fail", title: "Жизни отряда кончились", sub: "павшие встанут только в следующем зале — берегите друг друга", secs: 5 });
      }
      return false;
    }
    this.lives--;
    this.pushState();
    return true;
  }
  /** Маршрут захода: зал на каждом шаге (развилки выбираются при зачистке). */
  route: number[] = [0];
  /** Открытые залы (шаги lo..hi маршрута) — стены для героев и мобов. */
  get open(): number[] {
    return catOpen(this.route, this.lo, this.hi);
  }
  /** Зал шага. */
  private node(step: number): number {
    return this.route[step] ?? 0;
  }
  private hallTitle(i: number): string {
    const t = CAT_THEMES[this.themes[i] ?? -1];
    return t ? `${CAT_HALLS[i].name} · ${t.name}` : CAT_HALLS[i].name;
  }

  /** «Взрывные» мобы: где были (взрыв на месте гибели). */
  private readonly explosive = new Map<string, { x: number; z: number }>();
  private shrineAt: { x: number; z: number } | null = null;
  private shrineDone = false;
  /** С какого момента кто-то из отряда стоит в круге святилища (0 — никто). */
  private shrineHold = 0;
  /** Аффикс волны, которая сейчас спавнится. */
  private spawnAffix: CatAffix | null = null;
  /** Смерти по героям за забег и кто был мёртв в прошлый тик. */
  private readonly deaths = new Map<string, number>();
  private readonly wasDead = new Set<string>();
  private statsAt = 0;
  /** План каждого зала на этот заход. */
  private plan: StagePlan[] = [];
  /** Волна «на подходе»: ворота уже открылись, мобы выйдут в `at`. */
  private pending: { group: CatWave[]; gates: { x: number; z: number }[]; at: number; champ?: CatChampion | null } | null = null;
  /** Переход: когда подтянуть отставших к решётке (CATACOMBS.pullSec после подъёма) и сделано ли. */
  private gatherAt = 0;
  private gathered = true;
  private nextHazardAt = 0;
  private pendingAffix: CatAffix | null = null;
  /** Темы залов на этот заход (индексы CAT_THEMES). */
  private themes: number[] = [];
  /** Кто уже получил награду в этом забеге (чтобы ушедший и вернувшийся не брал дважды). */
  private readonly rewarded = new Set<string>();
  /** Уровень героев на старте захода — опыт считается от него (поднялся после стража — награда та же). */
  private readonly startLevel = new Map<string, number>();

  constructor(private readonly host: CatHost) {}

  /** Идёт сбор или забег — мировые события ждут. */
  get busy(): boolean {
    return this.phase !== CAT_PHASE.none;
  }

  /** Герой в пати текущего забега. */
  /** Добыча забега вне сундуков (кольца/камни с мобов) — в итоговую таблицу героя. */
  noteLoot(id: string, it: LootItem): void {
    if (!this.inRun(id)) return;
    const mine = this.lootBy.get(id) ?? [];
    this.lootBy.set(id, mine);
    const same = mine.find((l) => l.jw === it.jw && l.id === it.id && !!l.aegis === !!it.aegis);
    if (same) same.count += it.count;
    else mine.push({ ...it });
  }

  inRun(id: string): boolean {
    return this.phase >= CAT_PHASE.run && this.party.has(id);
  }

  /**
   * Тот же герой сменил тело (ПК ↔ бот): новое id — в отряд вместо старого, с его
   * смертями, наградами и строкой урона. Вернёт точку у входа в текущий зал (или null — не в забеге).
   */
  rekey(from: string, to: string): { x: number; z: number } | null {
    if (from === to || !this.party.has(from)) return null;
    this.party.delete(from);
    this.party.add(to);
    const d = this.deaths.get(from);
    this.deaths.delete(from);
    if (d !== undefined) this.deaths.set(to, d);
    this.wasDead.delete(from);
    const lv = this.startLevel.get(from);
    this.startLevel.delete(from);
    if (lv !== undefined) this.startLevel.set(to, lv);
    const lb = this.lootBy.get(from);
    this.lootBy.delete(from);
    if (lb) this.lootBy.set(to, lb);
    for (const k of [...this.rewarded]) {
      if (!k.endsWith(`:${from}`)) continue;
      this.rewarded.delete(k);
      this.rewarded.add(k.slice(0, k.length - from.length) + to);
    }
    this.host.rekeyStats(from, to);
    this.pushState();
    return this.inRun(to) ? this.respawnPoint(to) : null;
  }

  /** Где возрождается герой пати — у входа в текущий зал. */
  respawnPoint(id: string): { x: number; z: number } | null {
    if (!this.inRun(id)) return null;
    return catEntry(this.node(this.lo), Math.floor(Math.random() * 6), this.lo > 0 ? this.node(this.lo - 1) : -1);
  }

  /** Босс текущей стадии ("" — нет). */
  get bossMob(): string {
    return this.bossId;
  }
  /** Зал, куда сейчас тянется отряд (во время перехода — следующий). */
  get anchorHall(): number {
    return this.node(this.step === "move" ? this.hi : this.lo);
  }

  /** Куда идти боту пати — центр текущего зала (или следующего, когда проход открыт). */
  botAnchor(id: string): { x: number; z: number } | null {
    if (!this.inRun(id)) return null;
    const h = CAT_HALLS[this.node(this.step === "move" ? this.hi : this.lo)];
    return { x: h.x, z: h.z };
  }

  /**
   * Записаться (чат: !катакомбы; портал в лагере). Сбора нет — откроет его
   * (если откат прошёл). Возвращает ответ для чата.
   */
  /**
   * Записаться. `open` — можно открыть сбор, если его нет (только админы: раньше расписания
   * катакомбы не открывает никто, кроме них); остальным — когда откроются сами.
   */
  join(id: string, nick: string, open: boolean): string {
    const now = this.host.now();
    if (this.phase === CAT_PHASE.none) {
      if (!this.host.autoOn()) return "катакомбы сейчас выключены.";
      if (!open) {
        const at = Math.max(this.nextAuto, this.cooldownUntil);
        const wait = Math.max(1, Math.ceil((at - now) / 60000));
        return `катакомбы откроются сами примерно через ${wait} мин — тогда пиши !катакомбы или заходи в портал в лагере.`;
      }
      const wait = Math.ceil((this.cooldownUntil - now) / 60000);
      if (wait > 0) return `катакомбы ещё запечатаны — откроются через ~${wait} мин.`;
      if (!this.host.canOpen()) return "сейчас идёт другое событие — катакомбы откроются после него.";
      this.openGather(nick);
    }
    if (this.phase !== CAT_PHASE.gather) return "отряд уже спустился в катакомбы — жди следующего сбора.";
    if (this.party.has(id)) return `ты уже в отряде (${this.party.size}).`;
    if (this.party.size >= CATACOMBS.maxParty) return "отряд полон.";
    this.party.add(id);
    this.pushState();
    const left = Math.ceil((this.phaseEnd - now) / 1000);
    return `в отряде катакомб: ${this.party.size} (нужно от ${CATACOMBS.minParty}) · спуск через ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  /** Покинул мир (вышел/бот снят) — из пати. */
  leave(id: string): void {
    if (this.party.delete(id)) this.pushState();
  }

  /** Админ: открыть сбор / начать сразу / прервать. */
  force(what: "open" | "go" | "stop"): void {
    if (what === "open" && this.phase === CAT_PHASE.none) this.openGather("");
    else if (what === "go" && this.phase === CAT_PHASE.gather) this.phaseEnd = 0;
    else if (what === "stop" && this.phase !== CAT_PHASE.none) this.finish(false, "Катакомбы закрыты");
  }

  private openGather(by: string): void {
    const now = this.host.now();
    this.phase = CAT_PHASE.gather;
    this.party.clear();
    this.rewarded.clear();
    this.phaseEnd = now + CATACOMBS.gatherSec * 1000;
    this.lo = 0;
    this.hi = 0;
    this.stage = 0;
    this.pushState();
    const min = Math.round(CATACOMBS.gatherSec / 60);
    this.host.chat(
      `☠ Катакомбы открыты${by ? ` (позвал ${by})` : ""}! Отряд от ${CATACOMBS.minParty} героев: пиши !катакомбы ` +
        `или войди в портал в лагере. Спуск через ${min} мин — волны мертвецов, стражи и Владыка Бездны. Награда — уникальное оружие.`,
    );
    this.host.announce({
      kind: "gather", title: "Катакомбы открыты",
      sub: `Сбор отряда ${min} мин · !катакомбы или портал в лагере · от ${CATACOMBS.minParty} героев`, secs: 10,
    });
  }

  tick(): void {
    const now = this.host.now();
    if (this.phase === CAT_PHASE.none) {
      if (this.nextAuto === 0) this.nextAuto = now + this.autoGap();
      if (now >= this.nextAuto && now >= this.cooldownUntil && this.host.autoOn()) {
        this.nextAuto = now + this.autoGap();
        if (this.host.canOpen() && this.host.heroes().length >= CATACOMBS.minParty) this.openGather("");
      }
      return;
    }
    // Пати — только те, кто ещё в мире.
    const heroes = this.host.heroes();
    const ids = new Set(heroes.map((h) => h.id));
    for (const id of [...this.party]) if (!ids.has(id)) this.party.delete(id);

    if (this.phase === CAT_PHASE.gather) {
      // Портал в лагере: зашёл в круг — в отряде.
      for (const h of heroes) {
        if (h.dead || this.party.has(h.id) || this.party.size >= CATACOMBS.maxParty) continue;
        if (Math.hypot(h.x - CAT_PORTAL.x, h.z - CAT_PORTAL.z) <= CATACOMBS.portalR) {
          this.party.add(h.id);
          this.host.chat(`${h.nick} вошёл в портал катакомб — в отряде ${this.party.size}.`);
        }
      }
      if (now >= this.phaseEnd) {
        if (this.party.size >= CATACOMBS.minParty) this.startRun();
        else this.finish(false, `Катакомбы не открылись — в отряде ${this.party.size} из ${CATACOMBS.minParty}`, true);
        return;
      }
      this.pushState();
      return;
    }

    if (this.phase === CAT_PHASE.outro) {
      if (now >= this.phaseEnd) this.finish(true, "");
      else this.pushState();
      return;
    }

    // ---- забег ----
    if (this.party.size === 0) {
      this.finish(false, "Отряд покинул катакомбы");
      return;
    }
    if (now >= this.phaseEnd) {
      this.finish(false, "Время вышло — Бездна сомкнулась");
      return;
    }
    for (const id of [...this.mobs]) if (!this.host.alive(id)) this.mobs.delete(id);
    // Смерти и «пали все».
    const partyHeroes = heroes.filter((h) => this.party.has(h.id));
    for (const h of partyHeroes) {
      if (h.dead && !this.wasDead.has(h.id)) {
        this.wasDead.add(h.id);
        this.deaths.set(h.id, (this.deaths.get(h.id) ?? 0) + 1);
      } else if (!h.dead) this.wasDead.delete(h.id);
    }
    if (partyHeroes.length > 0 && partyHeroes.every((h) => h.dead)) {
      this.finish(false, "Отряд пал в катакомбах");
      return;
    }
    if (now >= this.statsAt) {
      this.statsAt = now + 2000;
      this.host.stats([...this.party].map((id) => ({ id, deaths: this.deaths.get(id) ?? 0 })));
    }
    const plan = this.plan[this.stage];
    // «Взрывные»: погиб — огненный взрыв на месте (успей отбежать).
    if (this.explosive.size) {
      const blasts: { x: number; z: number }[] = [];
      for (const [id, pos] of this.explosive) {
        const info = this.host.mobInfo(id);
        if (info) {
          pos.x = info.x;
          pos.z = info.z;
        } else {
          blasts.push(pos);
          this.explosive.delete(id);
        }
      }
      if (blasts.length) this.host.hazard("flames", blasts, { r: 2.8, dmg: 0.18, delay: 0.9 });
    }
    // Святилище: кто из отряда подошёл — бафф всем.
    if (this.shrineAt && plan.shrine) {
      const near = partyHeroes.some((h) => !h.dead && Math.hypot(h.x - this.shrineAt!.x, h.z - this.shrineAt!.z) < CAT_SHRINE.reach);
      if (!near) this.shrineHold = 0;
      else if (!this.shrineHold) this.shrineHold = now;
      if (near && now - this.shrineHold >= CAT_SHRINE.holdSec * 1000) {
        this.shrineHold = 0;
        this.host.shrineBless(plan.shrine, [...this.party]);
        this.host.announce({ kind: "chest", title: plan.shrine.name, sub: plan.shrine.desc, secs: 5 });
        this.shrineAt = null;
        this.shrineDone = true;
        this.host.setShrine(0, 0, -1);
      }
    }
    // Опасности зала: залпы по героям, пока идёт бой (не на переходе и не во вступлении).
    if ((this.step === "waves" || this.step === "boss") && now >= this.nextHazardAt) this.fireHazard(heroes, plan, now);
    switch (this.step) {
      case "intro":
      case "waves": {
        if (this.step === "intro" && now < this.stepAt) break;
        if (this.step === "intro") this.nextHazardAt = now + 6000;
        this.step = "waves";
        if (!this.shrineAt && !this.shrineDone && plan.shrine) {
          const h = CAT_HALLS[this.node(this.stage)];
          const a = Math.random() * Math.PI * 2;
          const r = h.r * (0.25 + Math.random() * 0.3);
          this.shrineAt = { x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r };
          this.host.setShrine(this.shrineAt.x, this.shrineAt.z, CAT_SHRINES.indexOf(plan.shrine));
        }
        // Ворота открылись — мобы выходят.
        if (this.pending) {
          if (now >= this.pending.at) {
            this.spawnAffix = this.pendingAffix;
            this.spawnGroup(this.pending.group, this.pending.gates);
            if (this.pending.champ) this.spawnChampion(this.pending.champ, this.pending.gates[0]);
            this.spawnAffix = null;
            this.pending = null;
          }
          break;
        }
        if (this.mobs.size > 0) break;
        if (this.wave < plan.waves.length) {
          if (this.waveAt === 0) this.waveAt = now + (this.wave === 0 ? 1500 : CATACOMBS.waveGap * 1000);
          else if (now >= this.waveAt) {
            // 2–3 случайных ворот, иногда засада со спины.
            const all = catGates(this.node(this.stage));
            const front = all.filter((g) => !g.back).sort(() => Math.random() - 0.5);
            const back = all.filter((g) => g.back).sort(() => Math.random() - 0.5);
            const gates = front.slice(0, 2 + (Math.random() < 0.4 ? 1 : 0));
            const ambush = Math.random() < 0.35 && this.wave > 0;
            if (ambush) gates.push(back[0]);
            this.host.gateFx(gates);
            this.pending = { group: plan.waves[this.wave], gates, at: now + 1300, champ: plan.champs[this.wave] ?? null };
            const affix = plan.affixes[this.wave] ?? null;
            this.pendingAffix = affix;
            this.wave++;
            this.waveAt = 0;
            const first = this.wave === 1;
            this.host.announce({
              kind: "wave", title: `${CAT_HALLS[this.node(this.stage)].name} · волна ${this.wave}/${plan.waves.length}${ambush ? " · засада!" : ""}${affix ? ` · ${affix.name}` : ""}`,
              sub: first ? `проклятие: ${plan.curse.name} — ${plan.curse.desc} · ${CAT_HAZARD.names[plan.hazard]}` : this.waveSub(),
              secs: first ? 6 : 4,
            });
          }
        } else if (plan.boss) {
          this.step = "bossIntro";
          this.stepAt = now + CATACOMBS.bossIntroSec * 1000;
          const at = catBossSpot(this.node(this.stage));
          this.host.bossFx(at.x, at.z, !!plan.boss.final);
          this.host.announce({ kind: "boss", title: plan.boss.name, sub: plan.boss.title, secs: 6 });
        } else this.stageClear();
        break;
      }
      case "bossIntro": {
        if (now < this.stepAt || !plan.boss) break;
        this.spawnBoss(plan.boss, this.node(this.stage));
        this.step = "boss";
        break;
      }
      case "boss": {
        this.bossBrain(now, this.node(this.stage), plan.boss!, heroes);
        if (this.host.alive(this.bossId)) break;
        // Страж пал — его свита рассыпается прахом (и ждавшие у ворот не выходят).
        this.pendingAdds = [];
        this.host.dismissMobs([...this.mobs].filter((id) => id !== this.bossId));
        this.mobs.clear();
        this.guardians.clear();
        if (this.finalOn) {
          this.host.finalStop();
          this.finalOn = false;
        }
        this.bossId = "";
        this.stageClear();
        break;
      }
      case "move": {
        // Проход открыт: ждём, пока живые дойдут до следующего зала (или время), отставших переносим.
        const nextI = this.node(this.hi);
        const next = CAT_HALLS[nextI];
        const cor = catCorridor(catLinkIndex(this.node(this.lo), nextI));
        const party = heroes.filter((h) => this.party.has(h.id) && !h.dead);
        // Отставшие (далеко позади решётки) — к воротам, к остальным: отряд проходит вместе (камера снимает проход).
        if (!this.gathered && now >= this.gatherAt) {
          this.gathered = true;
          // Решётка — в 2.2 м от начала коридора; s — сколько прошёл герой вдоль оси коридора.
          const gs = 2.2;
          let j = 0;
          for (const h of party) {
            const s = (h.x - cor.ax) * cor.dx + (h.z - cor.az) * cor.dz;
            if (s > gs - CATACOMBS.pullBehind) continue;
            const side = j % 2 === 0 ? 1 : -1;
            const t = side * (1 + Math.floor(j / 2) * 1.4);
            j++;
            const bx = cor.ax + cor.dx * (gs - 2.5);
            const bz = cor.az + cor.dz * (gs - 2.5);
            this.host.warp(h.id, bx + cor.dz * t, bz - cor.dx * t, next.x, next.z);
          }
        }
        const arrived = party.every((h) => Math.hypot(h.x - next.x, h.z - next.z) < next.r);
        if (!arrived && now < this.stepAt) break;
        let i = 0;
        for (const h of party) {
          if (Math.hypot(h.x - next.x, h.z - next.z) < next.r) continue;
          const p = catEntry(nextI, i++, this.node(this.lo));
          this.host.warp(h.id, p.x, p.z, next.x, next.z);
        }
        this.stage++;
        this.lo = this.hi;
        // Новый зал — павшие встают у входа (и без жизней отряда).
        if (CATACOMBS.hallRevive) for (const h of heroes) if (this.party.has(h.id) && h.dead) this.host.revive(h.id);
        this.livesOutSaid = false;
        this.wave = 0;
        this.waveAt = 0;
        this.pending = null;
        this.nextHazardAt = now + 7000;
        this.shrineAt = null;
        this.shrineDone = false;
        this.host.setShrine(0, 0, -1);
        this.step = "waves";
        break;
      }
    }
    this.pushState();
  }

  private autoGap(): number {
    return (CATACOMBS.autoMin + Math.random() * (CATACOMBS.autoMax - CATACOMBS.autoMin)) * 1000;
  }

  private startRun(): void {
    const now = this.host.now();
    this.phase = CAT_PHASE.run;
    // Отсчёт до следующих катакомб — с НАЧАЛА забега (2026-10-07: раньше с конца).
    this.nextAuto = this.host.now() + this.autoGap();
    this.cooldownUntil = this.host.now() + CATACOMBS.cooldownSec * 1000;
    this.phaseEnd = now + CATACOMBS.runSec * 1000;
    this.stage = 0;
    this.lo = 0;
    this.hi = 0;
    this.wave = 0;
    this.waveAt = 0;
    this.step = "intro";
    this.stepAt = now + CATACOMBS.introSec * 1000;
    const heroes = this.host.heroes().filter((h) => this.party.has(h.id));
    this.startLevel.clear();
    for (const h of heroes) this.startLevel.set(h.id, h.level);
    // Уровень отряда для силы мобов — степенное среднее (сила героя растёт ~ как уровень^levelPow):
    // низкоуровневый «твинк» в отряде больше не ослабляет мобов для всех (было простое среднее).
    const pw = CATACOMBS.levelPow;
    const avg = (heroes.reduce((s, h) => s + Math.max(1, h.level) ** pw, 0) / Math.max(1, heroes.length)) ** (1 / pw);
    this.partyLevel = avg;
    this.pending = null;
    this.deaths.clear();
    this.wasDead.clear();
    this.statsAt = 0;
    this.host.stats([], true);
    this.explosive.clear();
    this.shrineAt = null;
    this.shrineDone = false;
    this.host.setShrine(0, 0, -1);
    // Темы залов на этот заход — каждый зал выглядит иначе, чем в прошлый раз.
    const themes = CAT_THEMES.map((_, i) => i).sort(() => Math.random() - 0.5);
    this.themes = CAT_HALLS.map((_, i) => themes[i % themes.length]);
    this.host.setThemes(this.themes.join(","));
    this.route = [0];
    this.lives = Math.max(1, Math.round(CATACOMBS.livesPerHero * heroes.length));
    this.livesMax = this.lives;
    this.livesOutSaid = false;
    this.lootBy.clear();
    this.runStart = now;
    this.plan = CATACOMBS.stages.map((st, i) => this.makePlan(st, i === CATACOMBS.stages.length - 1, heroes.length));
    const hall = CAT_HALLS[0];
    heroes.forEach((h, i) => {
      const p = catEntry(0, i);
      this.host.warp(h.id, p.x, p.z, hall.x, hall.z);
    });
    const names = heroes.map((h) => h.nick).join(", ");
    this.host.chat(`☠ Отряд спускается в катакомбы: ${names}. Удачи — у вас ${Math.round(CATACOMBS.runSec / 60)} минут.`);
    this.host.announce({ kind: "start", title: "Катакомбы", sub: `${this.hallTitle(0)} · ${heroes.length} героев · ${Math.round(CATACOMBS.runSec / 60)} мин`, secs: 7 });
    this.pushState();
  }

  /** Случайный план зала: волны из пула (по 2 вида), страж из вариантов, проклятие, опасности. */
  private makePlan(st: (typeof CATACOMBS.stages)[number], last: boolean, n: number): StagePlan {
    let waves: CatWave[][] = st.waves;
    if (st.pool && st.waveCount) {
      waves = [];
      for (let w = 0; w < st.waveCount; w++) {
        const pool = [...st.pool].sort(() => Math.random() - 0.5);
        // Волна от волны крупнее: +15% за номер.
        const total = Math.max(3, Math.round(((st.waveBase ?? 3) + (st.wavePerHero ?? 1) * (n - 1)) * (1 + 0.15 * w)));
        // Три вида в волне (случайные доли), каждый хотя бы по одному.
        const ka = 0.25 + Math.random() * 0.25;
        const kb = 0.2 + Math.random() * 0.25;
        const a = Math.max(1, Math.round(total * ka));
        const b = Math.max(1, Math.round(total * kb));
        waves.push([
          { type: pool[0], count: a, perHero: 0 },
          { type: pool[1], count: b, perHero: 0 },
          { type: pool[2 % pool.length], count: Math.max(1, total - a - b), perHero: 0 },
        ]);
      }
    }
    // Аффиксы волн: первая волна первого зала — без, дальше ~половина волн с аффиксом.
    const affixes = waves.map((_, w) => (st.hall === 0 && w === 0) || Math.random() > 0.5 ? null : pick(CAT_AFFIXES));
    // Чемпионы — на случайных волнах зала (в первой волне первого зала — нет).
    const champs: (CatChampion | null)[] = waves.map(() => null);
    const pool = CAT_CHAMPIONS[st.hall] ?? [];
    const slots = waves.map((_, w) => w).filter((w) => !(st.hall === 0 && w === 0)).sort(() => Math.random() - 0.5);
    for (let c = 0; c < Math.min(st.champions ?? 0, slots.length) && pool.length; c++) champs[slots[c]] = pick(pool);
    const base = st.bosses ? pick(st.bosses) : st.boss;
    return {
      waves,
      affixes,
      champs,
      shrine: !last && Math.random() < CAT_SHRINE.chance ? pick(CAT_SHRINES) : null,
      boss: base ? withRandomMechs(base) : undefined,
      curse: last ? { name: "Трон Бездны", desc: "Владыка ждёт", hpMul: 1, dmgMul: 1, hazardRate: 0.6, lootMul: 1 } : pick(CAT_CURSES),
      hazard: pick(CAT_HAZARD.kinds),
    };
  }

  /** Залп опасности: круги под частью героев (с разбросом) — телеграф, потом удар. */
  private fireHazard(heroes: ReturnType<CatHost["heroes"]>, plan: StagePlan, now: number): void {
    const gap = CAT_HAZARD.gapMin + Math.random() * (CAT_HAZARD.gapMax - CAT_HAZARD.gapMin);
    this.nextHazardAt = now + (gap / Math.max(0.1, plan.curse.hazardRate)) * 1000;
    const party = heroes.filter((h) => this.party.has(h.id) && !h.dead).sort(() => Math.random() - 0.5);
    if (!party.length) return;
    const count = Math.max(1, Math.round(party.length * CAT_HAZARD.perHero + Math.random()));
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i < count; i++) {
      const h = party[i % party.length];
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 2.5;
      pts.push({ x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r });
    }
    this.host.hazard(plan.hazard, pts);
  }

  /** Множители мобов: уровень пати (по уровню моба считает host через partyLevel) и размер пати. */
  private heroCount(): number {
    return Math.max(1, this.party.size);
  }

  private spawnGroup(group: CatWave[], spots: { x: number; z: number }[], mul = 1, scale?: number): void {
    const n = this.heroCount();
    let k = 0;
    for (const w of group) {
      const count = Math.max(1, Math.round((w.count + w.perHero * (n - 1)) * mul));
      for (let i = 0; i < count; i++) {
        const s = spots[k++ % spots.length];
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 1.5;
        const id = this.host.spawn(w.type, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, {
          hpMul: this.threat("hp"), dmgMul: this.threat("dmg"), scaleMul: scale, partyLevel: this.partyLevel, affix: this.spawnAffix,
        });
        this.mobs.add(id);
        if (this.spawnAffix?.explode) this.explosive.set(id, { x: s.x, z: s.z });
      }
    }
  }

  /** Чемпион — мини-босс волны: увеличенный элитный моб со своими механиками, толще с каждым героем. */
  private spawnChampion(c: CatChampion, at: { x: number; z: number }): void {
    const n = this.heroCount();
    const id = this.host.spawn(c.key, at.x, at.z, {
      hpMul: c.hpMul * CATACOMBS.guardHpMul * (1 + CATACOMBS.champPerHero * (n - 1)) * this.threat("hp"),
      dmgMul: c.dmgMul * this.threat("dmg"),
      scaleMul: CATACOMBS.champScale,
      name: c.name,
      partyLevel: this.partyLevel,
      affix: this.spawnAffix,
    });
    this.mobs.add(id);
    this.host.announce({ kind: "boss", title: `Чемпион: ${c.name}`, sub: "мини-босс волны", secs: 3 });
  }

  private spawnBoss(b: CatBoss, hall: number): void {
    this.mechAt.clear();
    this.addsAt = this.host.now() + (b.adds?.every ?? 10) * 1000;
    this.bossRage = false;
    this.finalPhase = 1;
    this.guardians.clear();
    this.pendingAdds = [];
    const at = catBossSpot(hall);
    const n = this.heroCount();
    this.bossId = this.host.spawn(b.key, at.x, at.z, {
      hpMul: b.hpMul * (b.final ? 1 : CATACOMBS.guardHpMul) * (1 + CATACOMBS.bossPerHero * (n - 1)) * this.threat("hp"),
      dmgMul: b.dmgMul * this.threat("dmg"),
      scaleMul: b.scale,
      name: b.name,
      partyLevel: this.partyLevel,
    });
    this.mobs.add(this.bossId);
    const ring = [0, 1, 2, 3, 4, 5].map((i) => ({ x: at.x + Math.cos(i * 1.05) * 3.5, z: at.z + Math.sin(i * 1.05) * 3.5 }));
    this.spawnGroup(b.retinue, ring);
    if (b.final) {
      this.finalOn = true;
      this.host.finalStart(this.bossId);
    }
  }

  /**
   * Мозг стража: постоянная свита из ворот, приёмы с телеграфами, ярость ниже 30%;
   * у Владыки — три стадии (Пламя → Печать со щитом и хранителями → Ярость Бездны).
   */
  private bossBrain(now: number, hall: number, b: CatBoss, heroes: ReturnType<CatHost["heroes"]>): void {
    const info = this.host.mobInfo(this.bossId);
    if (!info) return;
    const frac = info.hp / Math.max(1, info.maxHp);
    // Свита, вышедшая из ворот.
    for (let i = this.pendingAdds.length - 1; i >= 0; i--) {
      const pa = this.pendingAdds[i];
      if (now < pa.at) continue;
      this.spawnGroup(pa.group, pa.gates);
      this.pendingAdds.splice(i, 1);
    }
    const party = heroes.filter((h) => this.party.has(h.id) && !h.dead);
    const rage = this.bossRage || (b.final ? this.finalPhase === 3 : false);
    const k = rage ? 0.65 : 1;
    // Постоянная свита.
    if (b.adds && now >= this.addsAt && this.finalPhase !== 2) {
      this.addsAt = now + b.adds.every * k * 1000;
      if (this.mobs.size < 4 + this.party.size * 1.5) {
        const gates = catGates(hall).sort(() => Math.random() - 0.5).slice(0, 2);
        const n = Math.max(1, Math.round(b.adds.count + b.adds.perHero * (this.party.size - 1)));
        const group: CatWave[] = [];
        for (let i = 0; i < n; i++) group.push({ type: pick(b.adds.types), count: 1, perHero: 0 });
        this.host.gateFx(gates);
        this.pendingAdds.push({ group, gates, at: now + 1300 });
      }
    }
    // Приёмы стража.
    for (const m of b.mech ?? []) {
      const at = this.mechAt.get(m.name) ?? now + 4000;
      if (!this.mechAt.has(m.name)) this.mechAt.set(m.name, at);
      if (now < at || this.finalPhase === 2) continue;
      this.mechAt.set(m.name, now + m.every * k * 1000);
      this.castMech(m, info, party);
    }
    if (!b.final) {
      if (!this.bossRage && frac < 0.3) {
        this.bossRage = true;
        this.host.enrage(this.bossId);
        this.host.announce({ kind: "boss", title: `${b.name} в ярости!`, sub: "приёмы чаще, свита злее", secs: 4 });
      }
      return;
    }
    // ---- Владыка Бездны: три стадии ----
    const F = CAT_FINAL;
    const H = CAT_HALLS[hall];
    if (this.finalPhase === 1) {
      this.host.finalTick(this.bossId);
      if (frac < F.sealAt) {
        // Стадия 2 — Печать: на трон под щит, хранители печати, метеоры.
        this.finalPhase = 2;
        const dais = catBossSpot(hall);
        this.host.moveMob(this.bossId, dais.x, dais.z);
        this.host.setImmune(this.bossId, true);
        this.host.bossFx(dais.x, dais.z, true);
        this.guardians.clear();
        for (let i = 0; i < F.guardians; i++) {
          const a = (i / F.guardians) * Math.PI * 2 + Math.PI / 2;
          const gx = H.x + Math.cos(a) * H.r * 0.55;
          const gz = H.z + Math.sin(a) * H.r * 0.55;
          const id = this.host.spawn(b.seal?.key ?? "boneChief", gx, gz, {
            hpMul: F.guardianHp * (1 + 0.35 * (this.party.size - 1)) * this.threat("hp"), dmgMul: this.threat("dmg"), scaleMul: 1.3,
            name: b.seal?.name ?? "Хранитель печати", partyLevel: this.partyLevel,
          });
          this.guardians.add(id);
          this.mobs.add(id);
        }
        this.meteorAt = now + 2500;
        this.host.announce({ kind: "boss", title: b.seal?.sealTitle ?? "Печать Бездны", sub: `${b.name} под щитом — разбейте ${F.guardians} хранителей!`, secs: 6 });
      }
    } else if (this.finalPhase === 2) {
      for (const g of [...this.guardians]) if (!this.host.alive(g)) this.guardians.delete(g);
      if (now >= this.shieldFxAt && this.guardians.size > 0) {
        this.shieldFxAt = now + 5000;
        this.host.setImmune(this.bossId, true); // купол виден непрерывно (эффект живёт ~6 с)
      }
      if (now >= this.meteorAt) {
        this.meteorAt = now + F.meteorEvery * 1000;
        const pts: { x: number; z: number }[] = [];
        const n = 3 + this.party.size;
        for (let i = 0; i < n; i++) {
          const h = party[i % Math.max(1, party.length)];
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 4;
          pts.push(h ? { x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r } : { x: H.x + Math.cos(a) * H.r * 0.5, z: H.z + Math.sin(a) * H.r * 0.5 });
        }
        this.host.hazard(CAT_HAZARD.kinds[b.seal?.fx ?? 1], pts, { r: 3, dmg: 0.22 });
      }
      if (this.guardians.size === 0) {
        this.host.setImmune(this.bossId, false);
        this.host.stunMob(this.bossId, F.stunAfterSeal);
        this.finalPhase = 2.5;
        this.host.announce({ kind: "boss", title: "Печать разбита!", sub: `${b.name} оглушён на ${F.stunAfterSeal} с — бейте!`, secs: 5 });
      }
    } else if (this.finalPhase === 2.5) {
      this.host.finalTick(this.bossId);
      if (frac < F.rageAt) this.enterRage(now, hall, b);
    } else {
      // Стадия 3 — Ярость Бездны: кольца пламени от Владыки, всё чаще.
      this.host.finalTick(this.bossId);
      if (now >= this.ringAt) {
        this.ringAt = now + F.ringEvery * 1000;
        this.host.hazard(CAT_HAZARD.kinds[b.seal?.fx ?? 1], [{ x: info.x, z: info.z }], { r: F.ringR, dmg: 0.3, knock: 7, delay: 1.8 });
      }
    }
    if (this.finalPhase === 1 && frac < F.rageAt) this.enterRage(now, hall, b);
  }

  private enterRage(now: number, hall: number, b: CatBoss): void {
    this.finalPhase = 3;
    this.host.enrage(this.bossId);
    const at = catBossSpot(hall);
    this.host.bossFx(at.x, at.z, true);
    this.ringAt = now + 3000;
    this.addsAt = now + 2000;
    this.host.announce({ kind: "boss", title: b.seal?.rageTitle ?? "Ярость Бездны", sub: b.seal?.rageSub ?? "кольца пламени — отбегайте!", secs: 6 });
  }

  /** Приём стража: телеграф → удар (через опасности зала, боты уворачиваются). */
  private castMech(m: CatMech, info: { x: number; z: number }, party: ReturnType<CatHost["heroes"]>): void {
    const kind = CAT_HAZARD.kinds[m.fx];
    if (m.kind === "slam" && party.length) {
      const h = party[Math.floor(Math.random() * party.length)];
      this.host.hazard(kind, [{ x: h.x, z: h.z }], { r: m.r, dmg: m.dmg, stun: 1.2, delay: 1.5 });
    } else if (m.kind === "ring") {
      this.host.hazard(kind, [{ x: info.x, z: info.z }], { r: m.r, dmg: m.dmg, knock: 7, delay: 1.7 });
    } else if (m.kind === "barrage") {
      const pts: { x: number; z: number }[] = [];
      const n = 3 + Math.min(5, this.party.size);
      for (let i = 0; i < n; i++) {
        const h = party[i % Math.max(1, party.length)];
        const a = Math.random() * Math.PI * 2;
        const r = 1 + Math.random() * 4;
        pts.push(h ? { x: h.x + Math.cos(a) * r, z: h.z + Math.sin(a) * r } : { x: info.x + Math.cos(a) * 6, z: info.z + Math.sin(a) * 6 });
      }
      this.host.hazard(kind, pts, { r: m.r, dmg: m.dmg, delay: 1.6 });
    }
    this.host.announce({ kind: "boss", title: m.name, sub: "", secs: 2 });
  }

  /** Нарастание угрозы от зала к залу. */
  private threat(what: "hp" | "dmg"): number {
    const curse = this.plan[this.stage]?.curse;
    const c = curse ? (what === "hp" ? curse.hpMul : curse.dmgMul) : 1;
    return (1 + (what === "hp" ? CATACOMBS.threatHp : CATACOMBS.threatDmg) * this.stage) * c * (what === "dmg" ? this.sizeDmg : 1);
  }

  /** Урон мобов и опасностей от размера отряда: (n / sizeRef)^sizeDmgPow, n не больше sizeMaxN (см. CATACOMBS). */
  get sizeDmg(): number {
    const n = Math.min(CATACOMBS.sizeMaxN, Math.max(1, this.party.size));
    return (n / CATACOMBS.sizeRef) ** CATACOMBS.sizeDmgPow;
  }

  private stageClear(): void {
    const st = CATACOMBS.stages[this.stage];
    const h = CAT_HALLS[this.node(this.stage)];
    if (st.chest) {
      const final = st.chest === "final";
      this.host.chestFx(h.x, h.z, final, this.plan[this.stage]?.curse.lootMul ?? 1);
      const loot: LootItem[] = [];
      for (const id of this.party) {
        const key = `${this.stage}:${id}`;
        if (this.rewarded.has(key)) continue;
        this.rewarded.add(key);
        // Опыт — до сундука (иначе финальный ×2 бафф из сундука удвоил бы и его).
        const lv = this.startLevel.get(id) ?? this.host.heroes().find((h) => h.id === id)?.level ?? 1;
        this.host.xpReward(id, final ? CATACOMBS.finalShare : CATACOMBS.guardShare, lv);
        const mine = this.lootBy.get(id) ?? [];
        this.lootBy.set(id, mine);
        for (const it of this.host.chest(id, st.chest)) {
          for (const list of [loot, mine]) {
            const same = list.find((l) => l.id === it.id && !!l.aegis === !!it.aegis);
            if (same) same.count += it.count;
            else list.push({ ...it });
          }
        }
      }
      if (!final) {
        this.host.announce({ kind: "chest", title: "Сундук стража", sub: "каждому в отряде — золотое оружие в склад и опыт (чем ниже уровень — тем больше)", loot, secs: 7 });
      } else {
        this.phase = CAT_PHASE.outro;
        this.phaseEnd = this.host.now() + CATACOMBS.outroSec * 1000;
        this.host.announce({
          kind: "win", title: `${this.plan[this.stage]?.boss?.name ?? "Владыка Бездны"} повержен!`,
          sub: `каждому — уникальное оружие, свиток, ${CATACOMBS.finalTokens} ◈ и опыт · ×2 опыт и урон ${CATACOMBS.buffMinutes} мин`,
          loot, secs: 12,
        });
        this.host.chat(`☠ Катакомбы пройдены! ${this.plan[this.stage]?.boss?.name ?? "Владыка Бездны"} повержен. Отряду — уникальное оружие, свитки и жетоны. Слава героям!`);
        // Итоговая таблица: урон и добыча каждого (клиенты покажут после карточки победы).
        this.host.report(
          {
            boss: this.plan[this.stage]?.boss?.name ?? "Владыка Бездны",
            secs: Math.round((this.host.now() - this.runStart) / 1000),
            halls: this.route.map((h, i) => this.hallTitle(h) || String(i)),
            lives: this.lives,
            livesMax: this.livesMax,
          },
          [...this.party].map((id) => ({ id, deaths: this.deaths.get(id) ?? 0, loot: this.lootBy.get(id) ?? [] })),
        );
        this.pushState();
        return;
      }
    }
    if (this.stage >= CATACOMBS.stages.length - 1) {
      this.finish(true, "");
      return;
    }
    // Проход в следующий зал.
    // Развилка: из зачищенного зала открывается случайный из соседних залов следующего шага.
    const ways = catNext(this.node(this.stage));
    this.route[this.stage + 1] = ways[Math.floor(Math.random() * ways.length)] ?? 0;
    this.route.length = this.stage + 2;
    this.hi = this.stage + 1;
    this.step = "move";
    this.stepAt = this.host.now() + CATACOMBS.moveSec * 1000;
    this.gatherAt = this.host.now() + CATACOMBS.pullSec * 1000;
    this.gathered = false;
    this.host.announce({ kind: "door", title: "Решётка поднялась", sub: `вперёд — ${this.hallTitle(this.node(this.hi))}`, secs: 5 });
  }

  private waveSub(): string {
    const left = Math.max(0, Math.ceil((this.phaseEnd - this.host.now()) / 1000));
    return `осталось ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }

  /** Конец: всех в лагерь, мобов прочь, откат. */
  private finish(win: boolean, why: string, quiet = false): void {
    const wasRun = this.phase >= CAT_PHASE.run;
    if (this.finalOn) this.host.finalStop();
    this.finalOn = false;
    this.host.clearMobs(this.mobs);
    this.mobs.clear();
    this.bossId = "";
    if (wasRun) {
      this.host.saveRecords([...this.party], win);
      for (const id of this.party) this.host.sendHome(id);
    }
    if (!win && why) {
      if (!quiet || this.party.size > 0) this.host.chat(`☠ ${why}.`);
      this.host.announce({ kind: "fail", title: why, sub: wasRun ? "отряд вернулся в лагерь" : "", secs: 7 });
    }
    this.host.setShrine(0, 0, -1);
    this.explosive.clear();
    this.phase = CAT_PHASE.none;
    this.party.clear();
    this.lo = 0;
    this.hi = 0;
    this.stage = 0;
    this.route = [0];
    // Был забег — отсчёт уже идёт с его начала; не набрали отряд — новый отсчёт отсюда и короткий откат.
    if (!wasRun) {
      this.cooldownUntil = this.host.now() + 5 * 60 * 1000;
      this.nextAuto = this.host.now() + this.autoGap();
    }
    this.pushState();
  }

  private pushState(): void {
    const left = this.phase === CAT_PHASE.none ? 0 : Math.max(0, Math.ceil((this.phaseEnd - this.host.now()) / 1000));
    this.host.setState({
      phase: this.phase, lo: this.lo, hi: this.hi, route: this.route.join(","), lives: this.phase >= CAT_PHASE.run ? this.lives : 0, left, party: this.party.size, stage: this.stage, final: this.finalOn, boss: this.bossId,
    });
  }
}
