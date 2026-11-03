/**
 * Визуальный сценарий умения героя — ОДИН на лабораторию (веб и Unity) и, в будущем,
 * на сервер. Раньше лаборатория повторяла числа и порядок эффектов у себя: поменяли
 * SKILLS2 — лаборатория показывала старый радиус. Здесь только раскладка событий
 * (что, где и через сколько секунд), а все числа берутся из shared/classes2.ts и
 * shared/drawIn.ts. Поэтому правка константы сразу меняет и игру, и полигон.
 *
 * `skillShow` возвращает null только для умения, у которого ещё нет визуального
 * сценария — лаборатория подсвечивает это красным, а тест падает.
 */
import type { ActKind } from "./net/messages";
import {
  ABYSS,
  ARROW_STORM,
  ASSASSIN_FAN_HOP,
  ASSASSIN_LEAP,
  BARRIER_ARROW,
  BLAST_ARROW,
  CHAIN,
  CHAIN_HAMMER,
  CLASSES2,
  CLASS_IDS,
  CLEAVE,
  FAN,
  GHOST_ARROW,
  HAMMER_FIELD,
  HEAL_AURA,
  JUMP_BEHIND,
  MARK,
  PLAGUE,
  SEAL,
  SKILLS2,
  SMOKE,
  SOUL_STEAL,
  SPEAR_FLURRY,
  SPEAR_HOP_TRAP,
  SPEAR_RAIN,
  STEEL_AURA,
  SWARM_ARROW,
  THUNDER_SPIN,
  WARCRY,
  WEB_ARROW,
  WHIRL,
  skillArrowTime,
  skillAttrMul,
  type ClassId,
  type SkillAttrs,
  type SkillId,
} from "./classes2";
import { DRAW_IN, drawInPlan, type DrawMode } from "./drawIn";
import { SKILL } from "./constants";

/** Манекен на полигоне: ноги на земле, `h` — высота тела (куда бьют снаряды). */
export interface ShowMob {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Радиус тела, м. */
  r?: number;
  /** Высота тела от земли, м. */
  h?: number;
}

export interface ShowStage {
  /** Ноги героя. */
  x: number;
  y: number;
  z: number;
  /** Куда целится игрок (точка на земле). Без неё — вперёд по yaw. */
  tx?: number;
  tz?: number;
  yaw?: number;
  mobs?: readonly ShowMob[];
  /** Выбранный манекен: умения с целью бьют именно в него. */
  targetId?: string;
  /** Атрибуты героя (для умений с собственным атрибутом). */
  attrs?: SkillAttrs;
  /** Прибавки дерева/колец: радиус и длительность, как на сервере. */
  rad?: number;
  dur?: number;
  /** Режим оружия для «Ауры стали» и «Стягивания»: 0 щит, 1 один меч, 2 дуалы. */
  mode?: DrawMode;
  /** Готовая точка прицела (сервер уже выбрал центр) — важнее выбора по манекенам. */
  aim?: { x: number; z: number };
  /** Готовая точка конца рывка/прыжка (сервер уже выбрал, куда встанет герой). */
  end?: { x: number; z: number };
  /** Упорядоченные цели для цепи: id манекенов в том порядке, в каком бьёт сервер. */
  targets?: readonly string[];
  /** Куда уходит «Кража душ» (самый раненый союзник); без неё — на себя. */
  to?: { x: number; z: number; y?: number };
  /** Сколько ударов/волн/стрел (дерево и кольца могут прибавить к данным умения). */
  count?: number;
}

export interface ShowAct {
  /** Секунды от начала каста. */
  at: number;
  k: ActKind;
  x: number;
  y: number;
  z: number;
  d?: number;
  x2?: number;
  z2?: number;
  v?: number;
  r?: number;
  mobId?: string;
  /** Динамическое событие: сервер шлёт его сам (тик ауры, взрыв яда, стягивание),
   *  лаборатория рисует его для предпросмотра. `playShow` на сервере такие пропускает. */
  dyn?: boolean;
}

type Extra = Omit<ShowAct, "at" | "k" | "x" | "y" | "z">;
interface P {
  x: number;
  y: number;
  z: number;
}

const BODY_H = 1.6;

/** Индекс класса — сервер шлёт его в `v` для клипов и цвета эффектов. */
export function classIndex(cls: ClassId): number {
  return CLASS_IDS.indexOf(cls);
}

export function hasSkillShow(id: SkillId): boolean {
  return skillShow(id, "warrior", { x: 0, y: 0, z: 0, mobs: [{ id: "target", x: 0, y: 0, z: 4 }] }) !== null;
}

/** Сколько пар «класс × умение» покрыто визуальным сценарием. */
export function skillShowCoverage(): { total: number; covered: number; missing: string[] } {
  const missing: string[] = [];
  let total = 0;
  for (const cls of CLASS_IDS) {
    for (const id of CLASSES2[cls].skills) {
      total++;
      if (!hasSkillShow(id)) missing.push(`${cls}/${id}`);
    }
  }
  return { total, covered: total - missing.length, missing };
}

export function skillShow(id: SkillId, cls: ClassId, s: ShowStage): ShowAct[] | null {
  const sk = SKILLS2[id];
  if (!sk) return null;
  const R = s.rad ?? 1;
  const D = s.dur ?? 1;
  const yaw = s.yaw ?? (s.tx !== undefined && s.tz !== undefined ? Math.atan2(s.tx - s.x, s.tz - s.z) : 0);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const feet: P = { x: s.x, y: s.y, z: s.z };
  const mobs = [...(s.mobs ?? [])];
  const acts: ShowAct[] = [];
  const add = (at: number, k: ActKind, p: P, e: Extra = {}): void => {
    acts.push({ at, k, x: p.x, y: p.y, z: p.z, ...e });
  };
  const fwd = (dist: number): P => ({ x: s.x + fx * dist, y: s.y, z: s.z + fz * dist });
  const bodyH = (m: ShowMob): number => m.h ?? BODY_H;
  /** Ближайший манекен в направлении взгляда (или заданный targetId). */
  const target = (reach = Infinity): ShowMob | null => {
    if (s.targetId) {
      const m = mobs.find((o) => o.id === s.targetId);
      if (m) return m;
    }
    let best: ShowMob | null = null;
    let bd = reach;
    for (const m of mobs) {
      const dx = m.x - s.x;
      const dz = m.z - s.z;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if (d > 0.2 && (dx * fx + dz * fz) / d < 0.15) continue;
      bd = d;
      best = m;
    }
    return best;
  };
  const aim = (reach: number): P => {
    if (s.aim) return { x: s.aim.x, y: s.y, z: s.aim.z };
    const m = target(reach);
    if (m) return { x: m.x, y: m.y, z: m.z };
    return fwd(Math.min(reach, 9));
  };
  const behind = (m: ShowMob, dist: number): P => {
    const dx = m.x - s.x;
    const dz = m.z - s.z;
    const d = Math.hypot(dx, dz) || 1;
    return { x: m.x + (dx / d) * dist, y: s.y, z: m.z + (dz / d) * dist };
  };
  const v = classIndex(cls);

  switch (id) {
    case "stunBash": {
      if (cls === "assassin") {
        const m = target(ASSASSIN_LEAP.range);
        if (!m) {
          add(0, "stunBash", feet, { d: sk.castTime, r: sk.radius * R });
          add(sk.castTime, "stunHit", feet, { r: sk.radius * R });
          return acts;
        }
        const end = s.end ?? behind(m, (m.r ?? 0.6) + JUMP_BEHIND);
        add(0, "leap", feet, { x2: end.x, z2: end.z, d: ASSASSIN_LEAP.time });
        add(ASSASSIN_LEAP.time, "stunHit", { x: m.x, y: m.y, z: m.z }, { r: m.r });
        add(ASSASSIN_LEAP.time, "crit", { x: m.x, y: m.y + bodyH(m), z: m.z }, { dyn: true });
        return acts;
      }
      add(0, "stunBash", feet, { d: sk.castTime, r: sk.radius * R });
      add(sk.castTime, "stunHit", feet, { r: sk.radius * R });
      if (cls === "battlemage") {
        // Громовой удар: молнии ещё по 3 мобам подальше.
        const far = mobs.filter((m) => Math.hypot(m.x - s.x, m.z - s.z) > sk.radius * 0.6).slice(0, 3);
        for (const m of far) {
          add(sk.castTime, "chainHit", { x: s.x, y: s.y + 1.2, z: s.z }, {
            x2: m.x, z2: m.z, d: m.y + bodyH(m), r: 0, v,
          });
        }
      }
      return acts;
    }

    case "arrowRain": {
      if (cls === "assassin") {
        const start = feet;
        const back = fwd(-ASSASSIN_FAN_HOP);
        add(0, "shadowStep", start, { x2: back.x, z2: back.z, v });
        add(0.1, "fanKnives", start, { x2: s.x + fx * FAN.range, z2: s.z + fz * FAN.range, d: FAN.volleys });
        return acts;
      }
      const at = aim(SKILL.arrowRain.range);
      const radius = cls === "spearman" ? 5 * R : sk.radius * R;
      add(0, "arrowRain", at, { d: sk.castTime, r: radius });
      // Залпы — теми же шагами, что у сервера (arrowRainAt / skillRainAt / ливень копий).
      const hits = s.count ?? (cls === "archer" ? SKILL.arrowRain.bowHits : cls === "spearman" ? SPEAR_RAIN.count : sk.hits);
      const first = cls === "archer" ? 0.5 : cls === "spearman" ? 0.4 : 0.3;
      const gap = cls === "archer" ? 1 : cls === "spearman" ? 0.8 : 0.6;
      for (let i = 0; i < hits; i++) {
        add(sk.castTime + first + i * gap, "rainTick", at, { r: radius });
      }
      return acts;
    }

    case "massHeal": {
      add(0, "healAura", feet, { d: HEAL_AURA.duration * D, r: sk.radius * R, v });
      return acts;
    }

    case "shadowStep": {
      const m = target(11);
      const hop = cls === "archer" ? 7 : cls === "spearman" ? 4 : 0;
      let end: P;
      if (s.end) end = { x: s.end.x, y: s.y, z: s.end.z };
      else if (m && cls === "assassin") end = behind(m, (m.r ?? 0.6) + JUMP_BEHIND);
      else if (m) end = { x: m.x - fx * hop, y: s.y, z: m.z - fz * hop };
      else end = fwd(-hop || -8);
      add(0, "shadowStep", feet, { x2: end.x, z2: end.z, v });
      if (cls === "archer") add(0.05, "seal", feet, { d: 4 * D, r: 2.5 * R, v });
      else if (cls === "spearman") {
        add(0.05, "seal", feet, { d: SPEAR_HOP_TRAP.seconds * D, r: SPEAR_HOP_TRAP.radius * R, v });
      } else if (m) {
        add(0.3, "stunHit", { x: m.x, y: m.y, z: m.z }, { r: m.r });
      }
      return acts;
    }

    case "crush": {
      const at = aim(8);
      add(0, "crushMark", at, { d: sk.castTime, r: sk.radius * R });
      add(sk.castTime, "crushHit", at, { r: sk.radius * R });
      if (cls === "battlemage") {
        add(sk.castTime, "healZone", at, { d: 1.5, r: sk.radius * R });
      }
      return acts;
    }

    case "seal": {
      const hammer = cls === "battlemage";
      const dur = (hammer ? HAMMER_FIELD.duration : SEAL.duration) * D;
      const radius = (hammer ? HAMMER_FIELD.radius : sk.radius) * R;
      add(0, "seal", feet, { d: dur, r: radius, v });
      return acts;
    }

    case "whirlwind": {
      if (cls === "spearman") {
        const F = { ...SPEAR_FLURRY, duration: SPEAR_FLURRY.duration * D, range: SPEAR_FLURRY.range * R, thrusts: s.count ?? SPEAR_FLURRY.thrusts };
        add(0, "spearFlurry", feet, { d: F.duration, r: F.range });
        for (let i = 0; i < F.thrusts; i++) {
          const t = (F.duration / F.thrusts) * (i + 0.5);
          add(t, "spearPierce", feet, { x2: s.x + fx * F.range, z2: s.z + fz * F.range, r: F.cone });
        }
        return acts;
      }
      const hits = s.count ?? sk.hits;
      add(0, "whirl", feet, { d: WHIRL.duration * D, r: sk.radius * R, v: hits });
      if (cls === "battlemage") {
        const out = mobs
          .filter((m) => Math.hypot(m.x - s.x, m.z - s.z) > sk.radius && Math.hypot(m.x - s.x, m.z - s.z) < THUNDER_SPIN.range * R)
          .sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0];
        if (out) {
          add(WHIRL.duration * D, "chainHit", { x: s.x, y: s.y + 1.2, z: s.z }, {
            x2: out.x, z2: out.z, d: out.y + bodyH(out), r: 1,
          });
        }
      }
      return acts;
    }

    case "warcry": {
      const dur = (cls === "support" ? WARCRY.blessDuration : WARCRY.duration) * D;
      add(0, "warcry", feet, { d: dur, r: sk.radius * R, v });
      return acts;
    }

    case "mark": {
      const m = target(sk.radius);
      const at = m ? { x: m.x, y: m.y, z: m.z } : aim(sk.radius);
      add(0, "markOn", at, m ? { d: MARK.duration * D, mobId: m.id } : { d: MARK.duration * D });
      return acts;
    }

    case "chain": {
      const hops = s.count ?? (cls === "battlemage" ? CHAIN_HAMMER.hops : sk.hits);
      const used = new Set<string>();
      const order = s.targets?.map((id) => mobs.find((m) => m.id === id)).filter((m): m is ShowMob => !!m) ?? [];
      const ordered = order.length > 0;
      let from: P = { x: s.x, y: s.y + 1.2, z: s.z };
      let cur = ordered ? order[0] : target(sk.radius);
      if (!cur) {
        add(0, "chainHit", from, { x2: aim(sk.radius).x, z2: aim(sk.radius).z, d: s.y + 1.2, r: 0, v });
        return acts;
      }
      for (let i = 0; i < hops && cur; i++) {
        used.add(cur.id);
        add(0, "chainHit", from, { x2: cur.x, z2: cur.z, d: cur.y + bodyH(cur), r: i, v });
        from = { x: cur.x, y: cur.y + bodyH(cur), z: cur.z };
        let next: ShowMob | null = null;
        if (ordered) next = order[i + 1] ?? null;
        else {
          let bd = CHAIN.jump * R;
          for (const o of mobs) {
            if (used.has(o.id)) continue;
            const d = Math.hypot(o.x - cur.x, o.z - cur.z);
            if (d < bd) {
              bd = d;
              next = o;
            }
          }
        }
        cur = next;
        if (!cur) break;
      }
      return acts;
    }

    case "plague": {
      add(0, "plagueOn", feet, { d: PLAGUE.duration * D });
      const m = target(3);
      if (m) add(0.8, "plagueBurst", { x: m.x, y: m.y, z: m.z }, { r: PLAGUE.burstRadius * R, d: m.y + bodyH(m), dyn: true });
      return acts;
    }

    case "smoke": {
      const k = skillAttrMul("smoke", s.attrs ?? {});
      const at = aim(SMOKE.range);
      add(0, "smoke", at, { d: SMOKE.duration * k * D, r: sk.radius * R });
      return acts;
    }

    case "soulSteal": {
      const m = target(SOUL_STEAL.reach);
      const at = m ? { x: m.x, y: m.y + bodyH(m), z: m.z } : { ...aim(SOUL_STEAL.reach), y: s.y + 1.2 };
      const to = s.to ?? { x: s.x, z: s.z };
      add(0, "soulSteal", at, { x2: to.x, z2: to.z, d: to.y ?? s.y + 1.5 });
      add(0.15, "healHit", { x: s.x, y: s.y + 1.2, z: s.z }, { dyn: true });
      return acts;
    }

    case "abyss": {
      add(0, "abyss", feet, { d: ABYSS.duration * D });
      return acts;
    }

    case "steelAura": {
      const mode = s.mode ?? 0;
      add(0, "steelAura", feet, { d: STEEL_AURA.duration * D, r: sk.radius * R, v: mode });
      if (mode !== 2) {
        const inR = mobs.filter((m) => Math.hypot(m.x - s.x, m.z - s.z) <= sk.radius * R + (m.r ?? 0));
        for (let t = 1; t <= Math.floor(STEEL_AURA.duration * D); t++) {
          for (const m of inR) add(t, "steelBurn", { x: m.x, y: m.y + 0.6, z: m.z }, { v: mode, dyn: true });
        }
      }
      return acts;
    }

    case "drawIn": {
      const mode = (s.mode ?? 0) as DrawMode;
      const plan = drawInPlan(mode, fx, fz, s.x, s.z, mobs);
      add(0, "drawIn", feet, { d: DRAW_IN.sec * D, r: DRAW_IN.radius * R, v: mode });
      mobs.forEach((m, i) => {
        add(0, "drawPull", { x: m.x, y: m.y, z: m.z }, { x2: plan[i].x, z2: plan[i].z, d: DRAW_IN.sec * D, v: mode });
      });
      for (let i = 0; i < plan.length; i += 3) add(DRAW_IN.sec * D + i * 0.03, "drawImpact", { x: plan[i].x, y: s.y, z: plan[i].z }, { v: mode });
      return acts;
    }

    case "lifeArrow": {
      const m = target(sk.radius);
      const at = m ? { x: m.x, y: m.y + bodyH(m), z: m.z } : { ...aim(sk.radius), y: s.y + 1.2 };
      add(0, "skillShot", feet, { d: 0, r: 1, dyn: true });
      add(0.05, "lifeArrow", { x: s.x, y: s.y + 1.2, z: s.z }, { x2: at.x, z2: at.z, d: at.y });
      return acts;
    }

    case "cleave": {
      add(0, "spearPierce", { x: s.x, y: s.y + 1.2, z: s.z }, { x2: s.x + fx * sk.radius, z2: s.z + fz * sk.radius, r: CLEAVE.halfAngle });
      add(sk.castTime, "stunHit", { x: s.x + fx * sk.radius * 0.5, y: s.y, z: s.z + fz * sk.radius * 0.5 }, { r: sk.radius * 0.5 });
      return acts;
    }

    case "blastArrow": {
      const m = target(BLAST_ARROW.range);
      const at = m ? { x: m.x, y: m.y + bodyH(m), z: m.z } : { ...aim(BLAST_ARROW.range), y: s.y + 1.2 };
      add(0, "skillShot", feet, { d: 0, r: 1, dyn: true });
      add(0.05, "blastArrow", { x: s.x, y: s.y + 1.2, z: s.z }, {
        x2: at.x, z2: at.z, d: at.y, r: BLAST_ARROW.radius * R,
      });
      return acts;
    }

    case "arrowStorm": {
      const A = { ...ARROW_STORM, radius: ARROW_STORM.radius * R, waves: s.count ?? ARROW_STORM.waves };
      add(0, "stormWave", feet, { d: 0, r: A.radius });
      for (let w = 0; w < A.waves; w++) {
        add(A.first - A.fall + w * A.gap, "stormWave", feet, { d: w + 1, r: A.radius });
      }
      return acts;
    }

    case "ghostArrow": {
      const k = skillAttrMul("ghostArrow", s.attrs ?? {});
      add(0, "ghostOn", feet, { d: GHOST_ARROW.duration * k * D });
      return acts;
    }

    case "swarmArrow": {
      const S = { ...SWARM_ARROW, range: SWARM_ARROW.range * R, blastR: SWARM_ARROW.blastR * R, arrows: s.count ?? SWARM_ARROW.arrows };
      const yaw0 = Math.atan2(fx, fz);
      for (let volley = 0; volley < S.volleys; volley++) {
        const at0 = volley * S.volleyGap;
        add(at0, "skillShot", feet, { d: volley, r: S.arrows, dyn: true });
        for (let i = 0; i < S.arrows; i++) {
          const a = yaw0 + (S.arrows > 1 ? (i / (S.arrows - 1) - 0.5) * 2 * S.halfAngle : 0);
          const ax = Math.sin(a);
          const az = Math.cos(a);
          let hitM: ShowMob | null = null;
          let best = S.range;
          for (const m of mobs) {
            const vx = m.x - s.x;
            const vz = m.z - s.z;
            const along = vx * ax + vz * az;
            if (along <= 0 || along > S.range + 8) continue;
            if (Math.abs(vx * az - vz * ax) > S.lane + (m.r ?? 0.6)) continue;
            const t = Math.max(0, along - (m.r ?? 0.6));
            if (t < best) {
              best = t;
              hitM = m;
            }
          }
          const to = hitM ? { x: hitM.x, y: hitM.y + bodyH(hitM), z: hitM.z } : { x: s.x + ax * S.range, y: s.y + 0.4, z: s.z + az * S.range };
          add(at0 + 0.02, "swarmArrow", { x: s.x, y: s.y + 1.2, z: s.z }, {
            x2: to.x, z2: to.z, d: to.y, r: hitM ? S.blastR : 0,
          });
        }
      }
      return acts;
    }

    case "barrierArrow": {
      add(0, "skillShot", feet, { d: 0, r: 12, dyn: true });
      add(0.02, "arrowBarrier", feet, { d: BARRIER_ARROW.duration * D, r: sk.radius * R });
      return acts;
    }

    case "webArrow": {
      const k = skillAttrMul("webArrow", s.attrs ?? {});
      const m = target(WEB_ARROW.range);
      const at = m ? { x: m.x, y: m.y, z: m.z } : aim(WEB_ARROW.range);
      const r = sk.radius * k * R;
      const sec = WEB_ARROW.duration * k * D;
      add(0, "skillShot", feet, { d: 0, r: 1, dyn: true });
      add(0.02, "webShot", { x: s.x, y: s.y + 1.2, z: s.z }, { x2: at.x, z2: at.z, d: at.y });
      add(skillArrowTime(Math.hypot(at.x - s.x, at.z - s.z)), "webZone", at, { d: sec, r });
      return acts;
    }

    default:
      return null;
  }
}
