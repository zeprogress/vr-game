import { angDiff, inRaidCrack, inRaidGap, packCracks, RAID, RAID_FIGHT, RAID_PHASES, raidAngle, raidCarry, type RaidCrack, raidPhaseOf } from "#shared/raid";

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
  /** Эффект: волна «Прилива» / падение героя в пустоту / «Последний вздох». */
  fx(k: "raidTide" | "raidFall" | "raidBreath", x: number, z: number): void;
  /** Сброс боя: босс снова целый. */
  healBoss(): void;
  /** Строка в чат стрима. */
  chat(text: string): void;
  /** Урон доли макс. HP магией без блока/уворота (жжение у центра, «Последний вздох»). */
  hurt(id: string, frac: number, why: string): void;
  /** «Зеркальный плач»: фантомы-копии босса в точках. */
  phantoms(pts: { x: number; z: number }[], o: { hp: number; dmg: number; scale: number }): void;
  /** Игрок в воздухе (прыгнул) — по высоте головы над землёй. */
  airborne(id: string): boolean;
  /** Боты прыгают (клип у модели). */
  jumpBots(ids: string[]): void;
  /** Опасная зона для ботов (пропасть) на sec с — убегают из неё. */
  danger(x: number, z: number, r: number, sec: number): void;
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
  tear: number;
  pull: number;
  breath: number;
  cracks: string;
  crackOn: number;
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
  // Фаза 3: «Притяжение» и «Зеркальный плач».
  private nextPull = 0;
  private pullUntil = 0;
  private burnAcc = 0;
  private nextMirror = 0;
  // Фаза 4: «Раскол диска» и «Последний вздох».
  private cracks: RaidCrack[] = [];
  private cracksStr = "";
  private crackOpenAt = 0;
  private readonly crackIn = new Map<string, number>();
  private crackDangerAt = 0;
  private nextBreath = 0;
  private breathWarned = false;
  private breathJumped = false;

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

  /** Доля урона героя по боссу: 0 — не ранит («MISS»: боя нет или он не на арене), в разрыве — 1, вне — RAID_FIGHT.outGap. */
  hitMul(id: string, x: number, z: number): number {
    if (!this.active || !this.onArena.has(id)) return 0;
    return this.inGap(x, z) ? 1 : RAID_FIGHT.outGap;
  }

  /**
   * Куда встать боту: ближайший разрыв на радиусе r от босса. slot −1..1 — место поперёк конуса
   * (боты встают по всей ширине, а не в одну точку — не выталкивают друг друга). null — боя нет.
   */
  gapPoint(x: number, z: number, r: number, slot = 0, avoid?: (x: number, z: number) => boolean): { x: number; z: number } | null {
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
    // «Притяжение»: у центра жжёт — встаём дальше; пропасть/трещина или чужая опасность (avoid: круг
    // «Слезы») на месте — ближе/дальше на шаг, потом другое место поперёк конуса.
    const rr = Math.min(this.pulling ? Math.max(r, RAID_FIGHT.pull.coreR + 2) : r, this.edge - 2.5);
    let first: { x: number; z: number } | null = null;
    for (const ds of [0, 0.8, -0.8, 1.6, -1.6]) {
      const a2 = best + Math.max(-1, Math.min(1, slot + ds)) * this.halfGap * 0.6;
      for (const dr of [0, 3.5, -3.5, 6]) {
        const r2 = Math.max(6.5, Math.min(this.edge - 2.5, rr + dr));
        const pt = { x: RAID.x + Math.sin(a2) * r2, z: RAID.z + Math.cos(a2) * r2 };
        first ??= pt;
        if (this.cracks.length && inRaidCrack(pt.x, pt.z, this.cracks, this.ang)) continue;
        if (avoid?.(pt.x, pt.z)) continue;
        return pt;
      }
    }
    return first;
  }

  /**
   * Следующая точка пути к разрыву `to` в обход босса: если разрыв далеко по углу — шаг по дуге
   * (на радиусе не меньше minR), а не напрямик через тушу (бот упирался в босса и не успевал к «Приливу»).
   */
  approach(x: number, z: number, to: { x: number; z: number }, minR: number): { x: number; z: number } {
    const a = raidAngle(x, z);
    const d = angDiff(raidAngle(to.x, to.z), a);
    if (Math.abs(d) < 0.5) return to;
    const r = Math.min(this.edge - 2.5, Math.max(minR, Math.hypot(x - RAID.x, z - RAID.z)));
    const a2 = a + Math.sign(d) * 0.5;
    return { x: RAID.x + Math.sin(a2) * r, z: RAID.z + Math.cos(a2) * r };
  }

  /** Идёт «Притяжение» (тянет к центру). */
  get pulling(): boolean {
    return this.active && this.host.now() < this.pullUntil;
  }

  private get cracksOpen(): boolean {
    return this.cracks.length > 0 && this.host.now() >= this.crackOpenAt;
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
    if (ph !== this.phase) this.setPhase(ph, now);
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
    // «Притяжение» (фаза 3): вместо сноса к краю — тяга к центру.
    const F = RAID_FIGHT;
    if (this.phase === 2 && !casting && now >= this.nextPull) {
      this.pullUntil = now + F.pull.sec;
      this.nextPull = now + F.pull.every;
      this.host.announce("Притяжение!", "Луна тянет к себе — отходи от центра, у босса жжёт");
    }
    const pulling = now < this.pullUntil;
    this.drift = casting ? 0 : pulling ? -F.pull.pull : P.drift;
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

    // «Притяжение»: у центра жжёт (раз в полсекунды).
    if (pulling) {
      this.burnAcc += dt;
      if (this.burnAcc >= 0.5) {
        for (const id of this.onArena) {
          const h = byId.get(id);
          if (h && !h.dead && Math.hypot(h.x - RAID.x, h.z - RAID.z) < F.pull.coreR) this.host.hurt(id, F.pull.dps * this.burnAcc, "Притяжение");
        }
        this.burnAcc = 0;
      }
    } else this.burnAcc = 0;
    // «Зеркальный плач» (фаза 3): фантомы-копии босса на арене.
    if (this.phase === 2 && now >= this.nextMirror) {
      this.nextMirror = now + F.mirror.every;
      const pts: { x: number; z: number }[] = [];
      const a0 = Math.random() * TAU;
      for (let i = 0; i < F.mirror.count; i++) {
        const a = a0 + (i / F.mirror.count) * TAU;
        const r = Math.min(curEdge - 3, 12 + Math.random() * 3);
        pts.push({ x: RAID.x + Math.sin(a) * r, z: RAID.z + Math.cos(a) * r });
      }
      this.host.phantoms(pts, { hp: F.mirror.hp, dmg: F.mirror.dmg, scale: F.mirror.scale });
      this.host.announce("Зеркальный плач", "Фантомы-копии на арене — собейте их");
    }
    // «Раскол диска» (фаза 4): в пропасти дольше grace — падение. Ботам — опасные зоны уже с трещин
    // (предупреждения): иначе бот стоит на трещине до раскола и за grace не успевает уйти.
    if (this.cracks.length && now >= this.crackDangerAt) {
      this.crackDangerAt = now + 0.4;
      for (const c of this.cracks) {
        const a = c.a + this.ang;
        this.host.danger(RAID.x + Math.sin(a) * c.r, RAID.z + Math.cos(a) * c.r, c.cr + 1.2, 0.6);
      }
    }
    if (this.cracksOpen) {
      for (const id of [...this.onArena]) {
        const h = byId.get(id);
        if (!h || h.dead) continue;
        if (!inRaidCrack(h.x, h.z, this.cracks, this.ang)) {
          this.crackIn.delete(id);
          continue;
        }
        const t0 = this.crackIn.get(id) ?? now;
        this.crackIn.set(id, t0);
        if (now - t0 < F.cracks.grace) continue;
        this.crackIn.delete(id);
        this.onArena.delete(id);
        this.host.fx("raidFall", h.x, h.z);
        this.host.kill(id, "fall");
      }
    }
    // «Последний вздох» (фаза 4): удар по всей арене — спасает прыжок (боты прыгают сами).
    if (this.phase === 3) {
      if (!this.breathWarned && now >= this.nextBreath - F.breath.warn) {
        this.breathWarned = true;
        this.host.announce("Последний вздох!", `Через ${F.breath.warn} с удар по всей арене — прыгай в момент удара!`);
      }
      if (!this.breathJumped && now >= this.nextBreath - 0.35) {
        this.breathJumped = true;
        this.host.jumpBots([...this.onArena].filter((id) => byId.get(id)?.bot));
      }
      if (now >= this.nextBreath) {
        this.nextBreath = now + F.breath.every;
        this.breathWarned = false;
        this.breathJumped = false;
        this.host.fx("raidBreath", RAID.x, RAID.z);
        for (const id of this.onArena) {
          const h = byId.get(id);
          if (!h || h.dead || h.bot || this.host.airborne(id)) continue;
          this.host.hurt(id, F.breath.dmg, "Последний вздох");
        }
      }
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
    this.host.announce("Лунный аватар пробудился", "Арена вращается — двигайся; из разрыва орбиты урон полный");
    this.host.chat("🌙 Бой с Лунным аватаром начался! Из разрыва орбиты урон полный, вне — вчетверо слабее; в «Прилив» — все в разрыв. За краем арены — пустота. !raid — в бой.");
  }

  private setPhase(ph: number, now: number): void {
    this.phase = ph;
    const P = RAID_PHASES[ph];
    const F = RAID_FIGHT;
    if (ph === 2) {
      this.nextPull = now + F.pull.first;
      this.nextMirror = now + F.mirror.first;
    }
    if (ph === 3) {
      // «Раскол диска»: пропасти в осях арены, не друг на друге; сперва трещины-предупреждение.
      this.pullUntil = 0;
      const outer = RAID.r * P.edge - 3;
      const list: RaidCrack[] = [];
      for (let tries = 0; list.length < F.cracks.count && tries < 200; tries++) {
        const c = { a: Math.random() * TAU, r: 7 + Math.random() * Math.max(0.5, outer - 7), cr: F.cracks.r };
        const ok = list.every((o) => {
          const dx = Math.sin(c.a) * c.r - Math.sin(o.a) * o.r;
          const dz = Math.cos(c.a) * c.r - Math.cos(o.a) * o.r;
          return Math.hypot(dx, dz) > c.cr + o.cr + 2;
        });
        if (ok) list.push(c);
      }
      this.cracks = list;
      this.cracksStr = packCracks(list);
      this.crackOpenAt = now + F.cracks.warn;
      this.crackIn.clear();
      this.nextBreath = now + F.breath.first;
      this.breathWarned = false;
      this.breathJumped = false;
      this.host.announce(`Фаза 4 — Раскол диска`, `Арена трескается: через ${F.cracks.warn} с пропасти, не стой на трещинах · край ${Math.round(P.edge * 100)}%`);
      return;
    }
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
    this.pullUntil = 0;
    this.cracks = [];
    this.cracksStr = "";
    this.crackIn.clear();
    this.pushIdle();
  }

  private pushIdle(): void {
    this.host.setState({ ph: 0, ang: this.ang, w: 0, drift: 0, edge: RAID.r, gap: 0, on: 0, o: this.orbits, vert: -1, tide: 0, tear: 0, pull: 0, breath: 0, cracks: "", crackOn: 0 });
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
      tear: Math.max(0, Math.min(255, Math.ceil(this.nextTear - now))),
      pull: now < this.pullUntil ? 1 : 0,
      breath: this.phase === 3 ? Math.max(1, Math.min(255, Math.ceil(this.nextBreath - now))) : 0,
      cracks: this.cracksStr,
      crackOn: this.cracksOpen ? 1 : 0,
    });
  }
}
