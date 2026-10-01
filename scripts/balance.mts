#!/usr/bin/env -S npx tsx
/**
 * Расчёт баланса «Классов 2.0»: npm run balance [-- --lvl 33] [-- --csv]
 *
 * 1. Сводка героя каждого класса по уровням (HP, защита, темп, урон, DPS)
 *    — рядом старые три класса по нынешним формулам, для сверки.
 * 2. Против каждого моба на его уровне: за сколько секунд герой убивает
 *    моба (TTK) и за сколько моб убивает героя (TTD). Запас = TTD/TTK:
 *    >1 — герой выигрывает дуэль, чем больше — тем легче.
 *
 * Модель упрощённая (стоят и бьются, без беготни/блока щитом/зелий), её
 * задача — сравнивать классы между собой, а не точно предсказывать бой.
 */
import { BOT, ELITE_MOBS, MOB, SHIELD, SWORD_CRIT_MULT, BOW, STAFF_CRIT_MULT } from "../src/shared/constants.ts";
import {
  armorFrac,
  attackSpeedFor,
  dodgeChance,
  maxHpFor,
  meleeSpeedFor,
} from "../src/shared/progression.ts";
import { weaponDamage } from "../src/shared/combat.ts";
import { fireboltDamage, magicResistFrac } from "../src/shared/magic.ts";
import {
  ATTRS,
  ATTR_INFO,
  CLASSES2,
  CLASS_IDS,
  SEAL,
  SKILLS2,
  autoBuild,
  pointsAt,
  spentOn,
  summarize2,
  type ClassId,
  type Hero2,
  type SkillId,
  type Summary2,
} from "../src/shared/classes2.ts";

const argv = process.argv.slice(2);
const onlyLvl = argv.includes("--lvl") ? Number(argv[argv.indexOf("--lvl") + 1]) : 0;
const LEVELS = onlyLvl ? [onlyLvl] : [1, 10, 20, 33, 36, 60, 100];

const tierFor = (lvl: number): 0 | 1 => (lvl < 15 ? 0 : 1);
const f = (n: number, d = 0): string => (Number.isFinite(n) ? n.toFixed(d) : "∞");
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));
const lpad = (s: string, n: number): string => (s.length >= n ? s : " ".repeat(n - s.length) + s);

// ---------------------------------------------------------------- старые классы

interface OldHero {
  name: string;
  hp: number;
  armor: number;
  resist: number;
  dodge: number;
  hit: number;
  rate: number;
  ranged: boolean;
  magic: boolean;
  splash: number;
}

/** Нынешняя система: 1 очко за уровень, softCap. Раскладка — как у ботов в среднем. */
function oldHero(kind: "sword" | "bow" | "staff", lvl: number): OldHero {
  const pts = lvl - 1;
  const split = { sword: [0.7, 0.3, 0], bow: [0.2, 0.8, 0], staff: [0.25, 0, 0.75] }[kind];
  const str = 1 + Math.round(pts * split[0]);
  const agi = 1 + Math.round(pts * split[1]);
  const int = 1 + (pts - Math.round(pts * split[0]) - Math.round(pts * split[1]));
  const tier = tierFor(lvl);
  if (kind === "sword") {
    const mult = tier ? 4 : 1;
    const base = weaponDamage("sword", lvl, str, mult, agi);
    return {
      name: "старый воин", hp: maxHpFor(lvl, str), armor: armorFrac(str), resist: magicResistFrac(int),
      dodge: dodgeChance(agi, false), hit: base * (1 + 0 * (SWORD_CRIT_MULT - 1)),
      rate: meleeSpeedFor(lvl, agi) / BOT.attackCooldown, ranged: false, magic: false, splash: 0,
    };
  }
  if (kind === "bow") {
    const mult = tier ? 3 : 1;
    const base = weaponDamage("arrow", lvl, str, mult, agi);
    return {
      name: "старый лучник", hp: maxHpFor(lvl, str), armor: armorFrac(str), resist: magicResistFrac(int),
      dodge: dodgeChance(agi, true), hit: base * (1 + BOW.critChance * (BOW.critMult - 1)),
      rate: attackSpeedFor(lvl, agi) / BOT.bowCooldown, ranged: true, magic: false, splash: 0,
    };
  }
  const hit = fireboltDamage(lvl, int, 0.7) * (1 + 0 * (STAFF_CRIT_MULT - 1));
  return {
    name: "старый маг", hp: maxHpFor(lvl, str), armor: armorFrac(str), resist: magicResistFrac(int),
    dodge: dodgeChance(agi, true), hit, rate: attackSpeedFor(lvl, agi) / BOT.staffCooldown,
    ranged: true, magic: true, splash: hit * 0.25,
  };
}

// ---------------------------------------------------------------- умения → DPS

/** Средний урон умений в секунду (одна цель / по толпе из `n`). */
function skillDps(cls: ClassId, s: Summary2, skills: SkillId[], n: number): number {
  let dps = 0;
  for (const id of skills) {
    const sk = SKILLS2[id];
    const cd = sk.cooldown * s.cdMul;
    switch (id) {
      case "stunBash": {
        const single = cls === "assassin";
        const mul = single ? 2 : 1;
        dps += (sk.dmgMult * mul * s.power * (single ? 1 : n)) / cd;
        break;
      }
      case "arrowRain":
      case "crush":
        dps += (sk.dmgMult * sk.hits * s.power * n) / cd;
        break;
      case "shadowStep": {
        // Гарантированный крит вместо обычного удара (+ выпад копейщика ×1.5 по линии).
        const extra = (s.hit / (1 + s.critChance * (s.critMult - 1))) * (s.critMult - 1) * (1 - s.critChance);
        const lunge = cls === "spearman" ? 1.5 * s.hit * Math.min(n, 3) : 0;
        dps += (extra + lunge) / cd;
        break;
      }
      case "seal":
        if (cls === "battlemage") dps += (SEAL.burnPerSec * SEAL.duration * s.power * n) / cd;
        break;
      case "massHeal":
        break;
    }
  }
  return dps;
}

interface Dps {
  single: number;
  aoe: number;
}

/** DPS по стоящей цели с учётом её защит. n — сколько мобов рядом. */
function heroDps2(cls: ClassId, s: Summary2, skills: SkillId[], mob?: (typeof ELITE_MOBS)[string]): Dps {
  const ranged = cls === "archer" || cls === "support";
  const physMul = (m?: typeof mob): number => (1 - (m?.physArmor ?? 0)) * (ranged ? 1 - (m?.rangedArmor ?? 0) : 1);
  const magMul = (m?: typeof mob): number => (m?.magicVulnMul ?? 1) * (ranged ? 1 - (m?.rangedArmor ?? 0) : 1);
  const hitMul = s.dmgType === "magic" ? magMul(mob) : physMul(mob);
  const miss = 1 - (mob?.dodge ?? 0);
  const auto = s.rate * s.hit * hitMul * miss;
  const splashMul = s.splashType === "magic" ? magMul(mob) : physMul(mob);
  const casterSkills = cls === "support" || cls === "battlemage";
  const skMul = casterSkills ? magMul(mob) : physMul(mob);
  const single = auto + s.rate * s.splash * splashMul * miss + skillDps(cls, s, skills, 1) * skMul;
  const n = 4;
  const aoe =
    auto * Math.min(n, s.pierce > 1 ? 2.2 : 1) +
    s.rate * s.splash * splashMul * miss * (cls === "battlemage" ? n : n - 1) +
    skillDps(cls, s, skills, n) * skMul;
  return { single, aoe };
}

/** Урон моба по герою в секунду (с бронёй/магзащитой/увортом). */
function mobDps(m: (typeof ELITE_MOBS)[string], armor: number, resist: number, dodge: number): number {
  const raw = (MOB.attackDamage * m.dmgMul) / (m.attackCooldown ?? MOB.attackCooldown);
  const prot = m.magicMelee ? resist : armor;
  return raw * (1 - prot) * (1 - dodge);
}

// ---------------------------------------------------------------- вывод

console.log("\n=== КЛАССЫ 2.0 · расчёт баланса ===");
console.log(
  `Атрибуты: ${ATTRS.map((a) => ATTR_INFO[a].short).join(" ")} · очков к 100 ур.: ${pointsAt(100)} · тир: <15 ур. обычное, дальше золото`,
);

for (const lvl of LEVELS) {
  console.log(`\n── Уровень ${lvl} (очков ${pointsAt(lvl)}) ─────────────────────────────────────────────`);
  console.log(
    pad("класс", 16) + pad("раскладка", 34) +
      ["HP", "брон", "магз", "увор", "бег", "атк/с", "удар", "крит", "DPS1", "DPS×4"].map((h) => lpad(h, 7)).join(""),
  );
  for (const c of CLASS_IDS) {
    for (const dual of c === "assassin" ? [false, true] : [false]) {
      const attrs = autoBuild(c, lvl);
      const h: Hero2 = { cls: c, level: lvl, attrs, tier: tierFor(lvl), dual };
      const s = summarize2(h);
      const d = heroDps2(c, s, CLASSES2[c].defaultSkills);
      const name = CLASSES2[c].name + (c === "assassin" ? (dual ? " ×2" : " ×1") : "");
      const build = ATTRS.filter((k) => attrs[k] > 1).map((k) => `${ATTR_INFO[k].short[0]}${attrs[k]}`).join(" ");
      console.log(
        pad(name, 16) + pad(`${build} (${spentOn(attrs)})`, 34) +
          [f(s.hp), pct(s.armor), pct(s.resist), pct(s.dodge), f(s.move, 1), f(s.rate, 2), f(s.hit, 1),
            pct(s.critChance), f(d.single, 1), f(d.aoe, 1)].map((v) => lpad(v, 7)).join(""),
      );
    }
  }
  for (const k of ["sword", "bow", "staff"] as const) {
    const o = oldHero(k, lvl);
    const single = o.rate * (o.hit + o.splash * 0);
    const aoe = o.rate * (o.hit + o.splash * 3);
    console.log(
      pad(o.name, 16) + pad("(сейчас в игре)", 34) +
        [f(o.hp), pct(o.armor), pct(o.resist), pct(o.dodge), "", f(o.rate, 2), f(o.hit, 1), "",
          f(single, 1), f(aoe, 1)].map((v) => lpad(v, 7)).join(""),
    );
  }
}

// Против мобов — на уровне самого моба.
console.log("\n=== Дуэль с мобом своего уровня: TTK (с) / TTD (с) · запас = TTD/TTK ===");
const mobs = Object.values(ELITE_MOBS).filter((m) => m.hp >= 60 && m.hp < 20000);
console.log(pad("моб (ур.)", 26) + CLASS_IDS.map((c) => lpad(CLASSES2[c].name.slice(0, 11), 18)).join("") + lpad("стар.воин", 14) + lpad("стар.маг", 14));
for (const m of mobs) {
  const lvl = m.level;
  let row = pad(`${m.name} (${lvl})${m.magicMelee ? "✦" : ""}`, 26);
  for (const c of CLASS_IDS) {
    const attrs = autoBuild(c, lvl);
    const s = summarize2({ cls: c, level: lvl, attrs, tier: tierFor(lvl), dual: true });
    const d = heroDps2(c, s, CLASSES2[c].defaultSkills, m);
    const ttk = m.hp / d.single;
    const ranged = c === "archer" || c === "support";
    // Дальнобойщик часть времени не получает урона (держит дистанцию) — грубо ×1.6 к TTD.
    // Воин со щитом: шанс полного блока (SHIELD.blockChance) — как ещё один уворот.
    const avoid = c === "warrior" ? 1 - (1 - s.dodge) * (1 - SHIELD.blockChance) : s.dodge;
    const ttd = (s.hp / mobDps(m, s.armor, s.resist, avoid)) * (ranged ? 1.6 : 1);
    row += lpad(`${f(ttk)}/${f(ttd)} ×${f(ttd / ttk, 1)}`, 18);
  }
  for (const k of ["sword", "staff"] as const) {
    const o = oldHero(k, lvl);
    const prot = o.magic ? (m.magicVulnMul ?? 1) : 1 - (m.physArmor ?? 0);
    const ttk = m.hp / (o.rate * o.hit * prot * (o.ranged ? 1 - (m.rangedArmor ?? 0) : 1));
    const ttd = (o.hp / mobDps(m, o.armor, o.resist, o.dodge)) * (o.ranged ? 1.6 : 1);
    row += lpad(`${f(ttk)}/${f(ttd)} ×${f(ttd / ttk, 1)}`, 14);
  }
  console.log(row);
}
console.log("\n✦ — моб бьёт магией вблизи (защищает МДР). Ассасин в дуэлях — с двумя кинжалами.\n");
