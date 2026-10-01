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
import { ELITE_MOBS, MOB, SHIELD } from "../src/shared/constants.ts";
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
}

// Против мобов — на уровне самого моба.
console.log("\n=== Дуэль с мобом своего уровня: TTK (с) / TTD (с) · запас = TTD/TTK ===");
const mobs = Object.values(ELITE_MOBS).filter((m) => m.hp >= 60 && m.hp < 20000);
console.log(pad("моб (ур.)", 26) + CLASS_IDS.map((c) => lpad(CLASSES2[c].name.slice(0, 11), 18)).join(""));
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
  console.log(row);
}
console.log("\n✦ — моб бьёт магией вблизи (защищает МДР). Ассасин в дуэлях — с двумя кинжалами.\n");
