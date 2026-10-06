import { angDiff, inRaidGap, RAID, RAID_FIGHT, RAID_PHASES, raidAngle, raidCarry, raidPhaseOf } from "#shared/raid";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Что режиссёру боя нужно от комнаты (ZoneRoom). */
export interface RaidHost {
  /** Сим-время, с. */
  now(): number;
  /** Рейд-босс: id и HP; null — нет в мире или повержен. */
  boss(): { id: string; hp: number; maxHp: number } | null;
  /** Герои мира (игроки и боты). */
  heroes(): { id: string; x: number; z: number; dead: boolean; bot: boolean }[];
  setState(s: RaidState): void;
  /** Гибель героя: упал за край арены / накрыл «Прилив». */
  kill(id: string, why: "fall" | "tide"): void;
  /** «Лунная слеза»: круг-предупреждение в точке, через delay — удар (доля макс. HP) героям арены в круге. */
  tear(x: number, z: number, r: number, delay: number, dmgFrac: number): void;
  /** Арена несёт бота: сдвиг, м. */
  shiftBot(id: string, dx: number, dz: number): void;
  /** Титры всем (баннер игрокам, карточка зрителям). */
  announce(title: string, sub: string): void;
  /** Эффект: волна «Прилива» / падение героя в пустоту. */
  fx(k: "raidTide" | "raidFall", x: number, z: number): void;
  /** Сброс боя: босс снова целый. */
  healBoss(): void;
  /** Строка в чат стрима. */
  chat(text: string): void;
}

export interface RaidState {
  ph: number;
  ang: number;
  w: number;
  drift: number;
  edge: number;
  gap: number;
  on: number;
  o: readonly [number, number, number];
  vert: number;
  tide: number;
}

/**
 * Бой с рейд-боссом «Лунный аватар» (дизайн рейда, shared/raid.ts): арена вращается и сносит
 * стоящих к краю (за краем — пустота), вокруг босса орбиты с разрывами — ранить его можно
 * только из разрыва, фазы по HP (больше орбит, быстрее, край сужается), «Лунная слеза» и
 * «Прилив» (гибнут все на арене не в разрыве). Бой идёт, пока на арене есть герои.
 */
export class RaidFight {
  private active = false;
  private phase = 0;
  private ang = 0;
  private w = 0;
  private readonly orbits: [number, number, number] = [0, 0, 0];
  /** Снос к краю сейчас, м/с (в каст «Прилива» — 0). */
  private drift = 0;
  /** Кто стоит на арене (вошёл внутрь края) — его несёт, бьёт прилив, он может ранить босса. */
  private readonly onArena = new Set<string>();
  private startAt = 0;
  private emptySince = -1;
  private nextTear = 0;
  private nextTide = 0;
  private tideWarned = false;
  private bossId = "";

  constructor(private readonly host: RaidHost) {}

  get fighting(): boolean {
    return this.active;
  }

  /** Идёт каст «Прилива»: разрывы и арена замерли — все бегут в разрыв. */
  get tideCasting(): boolean {
    return this.active && this.tideWarned;
  }

  /** Герой на арене (в бою). */
  isOn(id: string): boolean {
    return this.onArena.has(id);
  }

  /** Край арены сейчас, м. */
  get edge(): number {
    return RAID.r * (this.active ? RAID_PHASES[this.phase].edge : 1);
  }

  private get halfGap(): number {
    return (RAID_PHASES[this.phase].gap * DEG) / 2;
  }

  /** Точка в разрыве орбит. */
  inGap(x: number, z: number): boolean {
    return this.active && inRaidGap(x, z, this.orbits, RAID_PHASES[this.phase].orbits, this.halfGap);
  }

  /** Может ли герой ранить босса: идёт бой, он на арене и стоит в разрыве. */
  canHit(id: string, x: number, z: number): boolean {
    return this.active && this.onArena.has(id) && this.inGap(x, z);
  }

  /**
   * Куда встать боту: ближайший разрыв на радиусе r от босса. slot −1..1 — место поперёк конуса
   * (боты встают по всей ширине, а не в одну точку — не выталкивают друг друга). null — боя нет.
   */
  gapPoint(x: number, z: number, r: number, slot = 0): { x: number; z: number } | null {
    if (!this.active) return null;
    const a = raidAngle(x, z);
    const n = RAID_PHASES[this.phase].orbits;
    let best = this.orbits[0];
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(angDiff(a, this.orbits[i]));
      if (d < bd) {
        bd = d;
        best = this.orbits[i];
      }
    }
    const rr = Math.min(r, this.edge - 2.5);
    const a2 = best + slot * this.halfGap * 0.6;
    return { x: RAID.x + Math.sin(a2) * rr, z: RAID.z + Math.cos(a2) * rr };
  }

  tick(dt: number): void {
    const boss = this.host.boss();
    const now = this.host.now();
    if (!boss) {
      if (this.active && this.bossId) {
        this.host.announce("Лунный аватар повержен!", "Рейд завершён — арена затихает");
        this.host.chat("🌙 Лунный аватар повержен! Рейд завершён.");
      }
      this.stop();
      return;
    }
    this.bossId = boss.id;
    const heroes = this.host.heroes();
    const byId = new Map(heroes.map((h) => [h.id, h]));
    for (const id of [...this.onArena]) {
      const h = byId.get(id);
      if (!h || h.dead) this.onArena.delete(id);
    }
    const edge = this.edge;
    for (const h of heroes) {
      if (h.dead || this.onArena.has(h.id)) continue;
      if (Math.hypot(h.x - RAID.x, h.z - RAID.z) < edge - 0.8) this.onArena.add(h.id);
    }
    if (!this.active) {
      if (this.onArena.size === 0) return this.pushIdle();
      this.start(now);
    }
    // Никого на арене — через resetSec бой сброшен (босс снова целый).
    if (this.onArena.size === 0) {
      if (this.emptySince < 0) this.emptySince = now;
      else if (now - this.emptySince > RAID_FIGHT.resetSec) {
        this.host.healBoss();
        this.stop();
        return;
      }
    } else this.emptySince = -1;

    const ph = Math.max(this.phase, raidPhaseOf(boss.hp / Math.max(1, boss.maxHp)));
    if (ph !== this.phase) this.setPhase(ph);
    const P = RAID_PHASES[this.phase];

    // Вращение арены (с рывками в фазе jerky — средняя скорость та же), орбиты — относительно неё.
    // Каст «Прилива»: всё замирает — разрывы стоят, арена не несёт, все успевают забежать.
    const casting = this.tideWarned;
    let w = casting ? 0 : P.arenaSpd * DEG;
    if (P.jerky && !casting) {
      const t = (now % RAID_FIGHT.jerkPeriod) / RAID_FIGHT.jerkPeriod;
      w = t < RAID_FIGHT.jerkOn ? w / RAID_FIGHT.jerkOn : 0;
    }
    this.w = w;
    this.drift = casting ? 0 : P.drift;
    this.ang = wrap(this.ang + w * dt);
    if (!casting) for (let i = 0; i < 3; i++) this.orbits[i] = wrap(this.orbits[i] + (w + (P.orbitRel[i] ?? 0) * DEG) * dt);

    // Арена несёт ботов (игроков — их клиенты, по raidW/raidDrift): поворот + снос к краю.
    const curEdge = this.edge;
    for (const id of this.onArena) {
      const h = byId.get(id);
      if (!h || !h.bot) continue;
      const mv = raidCarry(h.x, h.z, w, this.drift, curEdge, dt);
      if (mv) this.host.shiftBot(id, mv[0], mv[1]);
    }
    // За краем — пустота.
    for (const id of [...this.onArena]) {
      const h = byId.get(id);
      if (!h) continue;
      if (Math.hypot(h.x - RAID.x, h.z - RAID.z) <= curEdge + 0.3) continue;
      this.onArena.delete(id);
      this.host.fx("raidFall", h.x, h.z);
      this.host.kill(id, "fall");
    }

    // «Лунная слеза» — осколок на случайного героя арены.
    if (now >= this.nextTear) {
      this.nextTear = now + RAID_FIGHT.tear.every;
      const list = [...this.onArena].map((id) => byId.get(id)).filter((h): h is NonNullable<typeof h> => !!h && !h.dead);
      const t = list[Math.floor(Math.random() * list.length)];
      if (t) this.host.tear(t.x, t.z, RAID_FIGHT.tear.r, RAID_FIGHT.tear.delay, RAID_FIGHT.tear.dmg);
    }
    // «Прилив»: предупреждение, потом гибнут все на арене не в разрыве (в энрейдже — все).
    const enraged = now - this.startAt > RAID_FIGHT.enrageSec;
    if (!this.tideWarned && now >= this.nextTide - RAID_FIGHT.tide.warn) {
      this.tideWarned = true;
      this.host.announce(
        enraged ? "Прилив — ярость луны!" : "Прилив!",
        enraged ? "Время вышло: волна смоет всех на арене" : `Орбиты замерли — все в разрыв! Через ${RAID_FIGHT.tide.warn} с волна смоет остальных`,
      );
    }
    if (now >= this.nextTide) {
      this.nextTide = now + (enraged ? 6 : RAID_FIGHT.tide.every);
      this.tideWarned = false;
      this.host.fx("raidTide", RAID.x, RAID.z);
      for (const id of [...this.onArena]) {
        const h = byId.get(id);
        if (!h || h.dead) continue;
        if (!enraged && this.inGap(h.x, h.z)) continue;
        this.onArena.delete(id);
        this.host.kill(id, "tide");
      }
    }
    this.pushState(now);
  }

  private start(now: number): void {
    this.active = true;
    this.phase = 0;
    this.ang = 0;
    this.orbits[0] = 0;
    this.orbits[1] = TAU / 3;
    this.orbits[2] = (TAU * 2) / 3;
    this.startAt = now;
    this.emptySince = -1;
    this.nextTear = now + 4;
    this.nextTide = now + RAID_FIGHT.tide.every;
    this.tideWarned = false;
    this.host.announce("Лунный аватар пробудился", "Арена вращается — двигайся, бей только из разрыва орбиты");
    this.host.chat("🌙 Бой с Лунным аватаром начался! Бить можно только из разрыва орбиты, за краем арены — пустота. !raid — в бой.");
  }

  private setPhase(ph: number): void {
    this.phase = ph;
    const P = RAID_PHASES[ph];
    const what = [
      "",
      "Две орбиты в разные стороны, разрывы уже",
      "Три орбиты, арена дёргается рывками",
      "Последняя фаза: одна быстрая орбита, края почти нет",
    ][ph];
    this.host.announce(`Фаза ${ph + 1}`, `${what} · край арены ${Math.round(P.edge * 100)}%`);
  }

  private stop(): void {
    this.active = false;
    this.phase = 0;
    this.onArena.clear();
    this.w = 0;
    this.pushIdle();
  }

  private pushIdle(): void {
    this.host.setState({ ph: 0, ang: this.ang, w: 0, drift: 0, edge: RAID.r, gap: 0, on: 0, o: this.orbits, vert: -1, tide: 0 });
  }

  private pushState(now: number): void {
    const P = RAID_PHASES[this.phase];
    this.host.setState({
      ph: this.phase + 1,
      ang: this.ang,
      w: this.w,
      drift: this.drift,
      edge: this.edge,
      gap: this.halfGap,
      on: P.orbits,
      o: this.orbits,
      vert: P.vertical ?? -1,
      tide: Math.max(0, Math.min(255, Math.ceil(this.nextTide - now))),
    });
  }
}
