import {
  CAT_HALLS,
  CAT_PHASE,
  CAT_PORTAL,
  CATACOMBS,
  catBossSpot,
  catEntry,
  catGates,
  type CatBoss,
  type CatWave,
} from "#shared/catacombs";
import type { CatacombMsg, LootItem } from "#shared/net/messages";

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
  setState(s: { phase: number; lo: number; hi: number; left: number; party: number; stage: number; final: boolean }): void;
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
  /** Моб катакомб: тип (ключ ELITE_MOBS или slime/spitter), точка и множители. Возвращает id. */
  spawn(type: string, x: number, z: number, o: { hpMul: number; dmgMul: number; scaleMul?: number; name?: string; partyLevel: number }): string;
  /** Жив ли моб. */
  alive(id: string): boolean;
  /** Убрать всех мобов катакомб. */
  clearMobs(ids: Iterable<string>): void;
  /** Финальный босс: включить атаки (волна/дыхание/дождь), тик атак и призыв свиты. */
  finalStart(id: string): void;
  finalTick(id: string): void;
  finalStop(): void;
  /** Награды: сундук стадии / суперприз — в склад героя. Возвращает выпавшее (для баннера). */
  chest(id: string, kind: "gold" | "final"): LootItem[];
  /** Сундук на полу (эффект) и зелья россыпью. */
  chestFx(x: number, z: number, final: boolean): void;
  /** Землетрясение/вспышка перед боссом (эффект в точке). */
  bossFx(x: number, z: number, final: boolean): void;
}

type Step = "intro" | "waves" | "bossIntro" | "boss" | "move";

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
  /** Кто уже получил награду в этом забеге (чтобы ушедший и вернувшийся не брал дважды). */
  private readonly rewarded = new Set<string>();

  constructor(private readonly host: CatHost) {}

  /** Идёт сбор или забег — мировые события ждут. */
  get busy(): boolean {
    return this.phase !== CAT_PHASE.none;
  }

  /** Герой в пати текущего забега. */
  inRun(id: string): boolean {
    return this.phase >= CAT_PHASE.run && this.party.has(id);
  }

  /** Где возрождается герой пати — у входа в текущий зал. */
  respawnPoint(id: string): { x: number; z: number } | null {
    if (!this.inRun(id)) return null;
    return catEntry(this.lo, Math.floor(Math.random() * 6));
  }

  /** Босс текущей стадии ("" — нет). */
  get bossMob(): string {
    return this.bossId;
  }
  /** Зал, куда сейчас тянется отряд (во время перехода — следующий). */
  get anchorHall(): number {
    return this.step === "move" ? this.hi : this.lo;
  }

  /** Куда идти боту пати — центр текущего зала (или следующего, когда проход открыт). */
  botAnchor(id: string): { x: number; z: number } | null {
    if (!this.inRun(id)) return null;
    const h = CAT_HALLS[this.step === "move" ? this.hi : this.lo];
    return { x: h.x, z: h.z };
  }

  /**
   * Записаться (чат: !катакомбы; портал в лагере). Сбора нет — откроет его
   * (если откат прошёл). Возвращает ответ для чата.
   */
  join(id: string, nick: string, open: boolean): string {
    const now = this.host.now();
    if (this.phase === CAT_PHASE.none) {
      if (!open) return "";
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
      if (now >= this.nextAuto && now >= this.cooldownUntil) {
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
    const st = CATACOMBS.stages[this.stage];
    switch (this.step) {
      case "intro":
      case "waves": {
        if (this.step === "intro" && now < this.stepAt) break;
        this.step = "waves";
        if (this.mobs.size > 0) break;
        if (this.wave < st.waves.length) {
          if (this.waveAt === 0) this.waveAt = now + (this.wave === 0 ? 1500 : CATACOMBS.waveGap * 1000);
          else if (now >= this.waveAt) {
            this.spawnGroup(st.waves[this.wave], catGates(st.hall));
            this.wave++;
            this.waveAt = 0;
            this.host.announce({
              kind: "wave", title: `${CAT_HALLS[st.hall].name} · волна ${this.wave}/${st.waves.length}`,
              sub: this.waveSub(), secs: 4,
            });
          }
        } else if (st.boss) {
          this.step = "bossIntro";
          this.stepAt = now + CATACOMBS.bossIntroSec * 1000;
          const at = catBossSpot(st.hall);
          this.host.bossFx(at.x, at.z, !!st.boss.final);
          this.host.announce({ kind: "boss", title: st.boss.name, sub: st.boss.title, secs: 6 });
        } else this.stageClear();
        break;
      }
      case "bossIntro": {
        if (now < this.stepAt || !st.boss) break;
        this.spawnBoss(st.boss, st.hall);
        this.step = "boss";
        break;
      }
      case "boss": {
        if (this.finalOn) this.host.finalTick(this.bossId);
        if (this.host.alive(this.bossId)) break;
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
        const next = CAT_HALLS[this.hi];
        const party = heroes.filter((h) => this.party.has(h.id) && !h.dead);
        const arrived = party.every((h) => Math.hypot(h.x - next.x, h.z - next.z) < next.r);
        if (!arrived && now < this.stepAt) break;
        let i = 0;
        for (const h of party) {
          if (Math.hypot(h.x - next.x, h.z - next.z) < next.r) continue;
          const p = catEntry(this.hi, i++);
          this.host.warp(h.id, p.x, p.z, next.x, next.z);
        }
        this.stage++;
        this.lo = this.hi;
        this.wave = 0;
        this.waveAt = 0;
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
    this.phaseEnd = now + CATACOMBS.runSec * 1000;
    this.stage = 0;
    this.lo = 0;
    this.hi = 0;
    this.wave = 0;
    this.waveAt = 0;
    this.step = "intro";
    this.stepAt = now + CATACOMBS.introSec * 1000;
    const heroes = this.host.heroes().filter((h) => this.party.has(h.id));
    const avg = heroes.reduce((s, h) => s + h.level, 0) / Math.max(1, heroes.length);
    this.partyLevel = avg;
    const hall = CAT_HALLS[0];
    heroes.forEach((h, i) => {
      const p = catEntry(0, i);
      this.host.warp(h.id, p.x, p.z, hall.x, hall.z);
    });
    const names = heroes.map((h) => h.nick).join(", ");
    this.host.chat(`☠ Отряд спускается в катакомбы: ${names}. Удачи — у вас ${Math.round(CATACOMBS.runSec / 60)} минут.`);
    this.host.announce({ kind: "start", title: "Катакомбы", sub: `${CAT_HALLS[0].name} · ${heroes.length} героев · ${Math.round(CATACOMBS.runSec / 60)} мин`, secs: 7 });
    this.pushState();
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
        this.mobs.add(
          this.host.spawn(w.type, s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, { hpMul: this.threat("hp"), dmgMul: this.threat("dmg"), scaleMul: scale, partyLevel: this.partyLevel }),
        );
      }
    }
  }

  private spawnBoss(b: CatBoss, hall: number): void {
    const at = catBossSpot(hall);
    const n = this.heroCount();
    this.bossId = this.host.spawn(b.key, at.x, at.z, {
      hpMul: b.hpMul * (1 + CATACOMBS.bossPerHero * (n - 1)) * this.threat("hp"),
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

  /** Нарастание угрозы от зала к залу. */
  private threat(what: "hp" | "dmg"): number {
    return 1 + (what === "hp" ? CATACOMBS.threatHp : CATACOMBS.threatDmg) * this.stage;
  }

  private stageClear(): void {
    const st = CATACOMBS.stages[this.stage];
    const h = CAT_HALLS[st.hall];
    if (st.chest) {
      const final = st.chest === "final";
      this.host.chestFx(h.x, h.z, final);
      const loot: LootItem[] = [];
      for (const id of this.party) {
        const key = `${this.stage}:${id}`;
        if (this.rewarded.has(key)) continue;
        this.rewarded.add(key);
        for (const it of this.host.chest(id, st.chest)) {
          const same = loot.find((l) => l.id === it.id && !!l.aegis === !!it.aegis);
          if (same) same.count += it.count;
          else loot.push({ ...it });
        }
      }
      if (!final) {
        this.host.announce({ kind: "chest", title: "Сундук стража", sub: "каждому в отряде — золотое оружие в склад", loot, secs: 7 });
      } else {
        this.phase = CAT_PHASE.outro;
        this.phaseEnd = this.host.now() + CATACOMBS.outroSec * 1000;
        this.host.announce({
          kind: "win", title: "Владыка Бездны повержен!",
          sub: `каждому — уникальное оружие, свиток и ${CATACOMBS.finalTokens} ◈ · ×2 опыт и урон ${CATACOMBS.buffMinutes} мин`,
          loot, secs: 12,
        });
        this.host.chat(`☠ Катакомбы пройдены! Владыка Бездны повержен. Отряду — уникальное оружие, свитки и жетоны. Слава героям!`);
        this.pushState();
        return;
      }
    }
    if (this.stage >= CATACOMBS.stages.length - 1) {
      this.finish(true, "");
      return;
    }
    // Проход в следующий зал.
    this.hi = this.stage + 1;
    this.step = "move";
    this.stepAt = this.host.now() + CATACOMBS.moveSec * 1000;
    this.host.announce({ kind: "door", title: "Решётка поднялась", sub: `вперёд — ${CAT_HALLS[this.hi].name}`, secs: 5 });
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
    if (wasRun) for (const id of this.party) this.host.sendHome(id);
    if (!win && why) {
      if (!quiet || this.party.size > 0) this.host.chat(`☠ ${why}.`);
      this.host.announce({ kind: "fail", title: why, sub: wasRun ? "отряд вернулся в лагерь" : "", secs: 7 });
    }
    this.phase = CAT_PHASE.none;
    this.party.clear();
    this.lo = 0;
    this.hi = 0;
    this.stage = 0;
    // Не набрали отряд — короткий откат; был забег — полный.
    this.cooldownUntil = this.host.now() + (wasRun ? CATACOMBS.cooldownSec : 5 * 60) * 1000;
    this.nextAuto = this.host.now() + this.autoGap();
    this.pushState();
  }

  private pushState(): void {
    const left = this.phase === CAT_PHASE.none ? 0 : Math.max(0, Math.ceil((this.phaseEnd - this.host.now()) / 1000));
    this.host.setState({
      phase: this.phase, lo: this.lo, hi: this.hi, left, party: this.party.size, stage: this.stage, final: this.finalOn,
    });
  }
}
