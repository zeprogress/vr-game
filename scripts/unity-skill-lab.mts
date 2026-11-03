#!/usr/bin/env -S npx tsx
/**
 * Данные для Unity-полигона умений: тот же shared/skillShow.ts, что играет веб-лаборатория.
 * Пишет unity/Assets/Resources/skillLab.json — Unity читает его через Resources.Load.
 *
 * Запуск: npm run lab:unity (или npx tsx scripts/unity-skill-lab.mts).
 * Меняется SKILLS2/CLASSES2/skillShow — перезапустить, и Unity-полигон покажет новое.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLASSES2,
  CLASS_IDS,
  WEAPONS2,
  autoBuild,
  plagueAtk,
  skillCooldownFor,
  skillDesc,
  skillName,
  type ClassId,
  type SkillId,
} from "../src/shared/classes2.ts";
import { skillDamageText } from "../src/shared/skillDamage.ts";
import { hammerPhysStrike, skillStrike } from "../src/shared/strike.ts";
import { skillShow, type ShowAct, type ShowMob } from "../src/shared/skillShow.ts";

const LEVEL = 33;
const TIER = 1 as const; // золото — как в веб-полигоне по умолчанию
const TIER_NAME = "gold";

const mobs: ShowMob[] = [
  { id: "front", x: 0, y: 0, z: 4.5, r: 0.6, h: 1.6 },
  { id: "left", x: -3.5, y: 0, z: 3.2, r: 0.6, h: 1.6 },
  { id: "right", x: 3.5, y: 0, z: 3.2, r: 0.6, h: 1.6 },
  { id: "far", x: 0, y: 0, z: 8.5, r: 0.6, h: 1.6 },
];

interface ActRow extends ShowAct {
  hx2: boolean;
  hz2: boolean;
  hd: boolean;
  hr: boolean;
  hv: boolean;
}

function actRow(a: ShowAct): ActRow {
  return {
    ...a,
    hx2: a.x2 !== undefined,
    hz2: a.z2 !== undefined,
    hd: a.d !== undefined,
    hr: a.r !== undefined,
    hv: a.v !== undefined,
  };
}

const classes = CLASS_IDS.map((cls: ClassId) => {
  const def = CLASSES2[cls];
  const attrs = autoBuild(cls, LEVEL);
  const hand = { mult: WEAPONS2[def.main].tiers[TIER], tier: TIER_NAME, roll: 1 };
  const strike = skillStrike(cls, LEVEL, attrs, hand).dmg;
  const phys = cls === "battlemage" ? hammerPhysStrike(LEVEL, attrs, hand) : cls === "assassin" ? plagueAtk({ mult: hand.mult, roll: 1 }, 1) : undefined;
  const skills = def.skills.map((id: SkillId) => {
    const acts = skillShow(id, cls, {
      x: 0, y: 0, z: 0, targetId: "front", mobs, attrs, mode: 0,
    });
    if (!acts) throw new Error(`нет сценария ${cls}/${id}`);
    return {
      id,
      name: skillName(id, cls),
      desc: skillDesc(id, cls, attrs),
      damage: skillDamageText(id, cls, strike, attrs, phys) ?? "",
      cooldown: skillCooldownFor(id, cls, attrs),
      acts: acts.map(actRow),
    };
  });
  return { id: cls, name: def.name, role: def.role, skills };
});

const out = {
  level: LEVEL,
  note: "Сгенерировано scripts/unity-skill-lab.mts из shared/classes2.ts и shared/skillShow.ts. Не править руками.",
  classes,
};

const file = resolve("unity/Assets/Resources/skillLab.json");
mkdirSync(resolve("unity/Assets/Resources"), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1) + "\n", "utf8");
const total = classes.reduce((n, c) => n + c.skills.length, 0);
console.log(`[lab] ${file}: ${classes.length} классов, ${total} умений`);
