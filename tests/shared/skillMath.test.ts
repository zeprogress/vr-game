import { test } from "node:test";
import assert from "node:assert/strict";
import { ASSASSIN_LEAP, CHAIN, CHAIN_HAMMER, FAN, HAMMER_FIELD, SKILLS2, SPEAR_RAIN, STORM_CRUSH, THUNDER_SPIN, WEAPONS2, WHIRL } from "../../src/shared/classes2";
import {
  assassinLeapDamage, chainHopDamage, chainHops, crushHealFrac, fanKnifeDamage, hammerWhirlHit, sealBoltDamage,
  sealBoltTicks, spearRainDamage, thunderSpinMul, warriorWhirlDamage,
} from "../../src/shared/skillMath";
import { skillDamageText } from "../../src/shared/skillDamage";

test("скилл-математика: лечение «Сокрушения бури» = база + МДР сверх старта", () => {
  assert.ok(Math.abs(crushHealFrac(0) - STORM_CRUSH.healBase) < 1e-12);
  assert.ok(Math.abs(crushHealFrac(10) - (STORM_CRUSH.healBase + 10 * STORM_CRUSH.healPerWis)) < 1e-12);
  // МДР ниже старта не отнимает лечение.
  assert.ok(Math.abs(crushHealFrac(-5) - STORM_CRUSH.healBase) < 1e-12);
});

test("скилл-математика: молния «Грозового поля» и число ударов", () => {
  assert.ok(Math.abs(sealBoltDamage(100) - HAMMER_FIELD.boltMul * 100) < 1e-12);
  // Поле длится duration секунд, удар раз в 0.5 с.
  assert.equal(sealBoltTicks(HAMMER_FIELD.duration), Math.round(HAMMER_FIELD.duration / 0.5));
});

test("скилл-математика: множитель молнии вихря зажат в min..max", () => {
  assert.ok(Math.abs(thunderSpinMul(0) - THUNDER_SPIN.minMul) < 1e-12);
  assert.ok(Math.abs(thunderSpinMul(THUNDER_SPIN.intFull) - THUNDER_SPIN.maxMul) < 1e-12);
  // Больше intFull — не выше max.
  assert.ok(Math.abs(thunderSpinMul(THUNDER_SPIN.intFull * 5) - THUNDER_SPIN.maxMul) < 1e-12);
  // Отрицательный вклад (МДР/ИНТ ниже старта) — не ниже min.
  assert.ok(Math.abs(thunderSpinMul(-10) - THUNDER_SPIN.minMul) < 1e-12);
});

test("скилл-математика: удар вихря молотом и скачки цепи", () => {
  assert.ok(Math.abs(hammerWhirlHit(1, 50) - 50 * THUNDER_SPIN.hitMul) < 1e-12);
  assert.ok(Math.abs(chainHopDamage(80, 0, CHAIN.falloff) - 80) < 1e-9);
  assert.ok(Math.abs(chainHopDamage(80, 2, CHAIN.falloff) - 80 * CHAIN.falloff ** 2) < 1e-9);
  assert.equal(chainHops(true, 3), CHAIN_HAMMER.hops);
  assert.equal(chainHops(false, 3), 3);
});

test("окна умений: у боевого мага цифры совпадают с формулами (не дублируют их)", () => {
  const attrs = { str: 40, agi: 10, int: 40, con: 20, luc: 10, wis: 15 };
  const strike = 120;
  const phys = 90;

  const crush = skillDamageText("crush", "battlemage", strike, attrs);
  assert.ok(crush?.includes(`Урон ${Math.round(SKILLS2.crush.dmgMult * strike)} в круге`), String(crush));
  const healPct = Math.round(crushHealFrac(attrs.wis - 1) * 1000) / 10;
  assert.ok(crush?.includes(`лечение ${healPct}% здоровья`), String(crush));

  const seal = skillDamageText("seal", "battlemage", strike, attrs);
  const bolt = Math.round(sealBoltDamage(strike));
  assert.ok(seal?.includes(`Урон ${bolt} за молнию`), String(seal));
  assert.ok(seal?.includes(`до ${Math.round(sealBoltDamage(strike) * sealBoltTicks(HAMMER_FIELD.duration))}`), String(seal));

  const whirl = skillDamageText("whirlwind", "battlemage", strike, attrs, phys);
  assert.ok(whirl?.includes(`Урон ${Math.round(hammerWhirlHit(SKILLS2.whirlwind.dmgMult, phys))} за удар`), String(whirl));
  assert.ok(whirl?.includes(`×${Math.round(thunderSpinMul(attrs.int - 1) * 100) / 100}`), String(whirl));
});

test("скилл-математика: ливень копий, веер, прыжок ассасина, вихрь воина", () => {
  assert.ok(Math.abs(spearRainDamage(100) - SPEAR_RAIN.dmg * 100) < 1e-9);
  assert.ok(Math.abs(fanKnifeDamage(100) - FAN.dmgMult * 100) < 1e-9);
  assert.ok(Math.abs(assassinLeapDamage(100) - ASSASSIN_LEAP.dmg * 100 * WEAPONS2.dagger.critMult) < 1e-9);
  assert.ok(Math.abs(warriorWhirlDamage(100) - WHIRL.warriorDmg * 100) < 1e-9);
});

test("окна умений: лучник, копейщик, ассасин и воин тоже считают по общим формулам", () => {
  const attrs = { str: 40, agi: 30, int: 10, con: 20, luc: 20, wis: 10 };
  const strike = 100;

  const spear = skillDamageText("arrowRain", "spearman", strike, attrs);
  assert.ok(spear?.includes(`Урон ${Math.round(spearRainDamage(strike))} за копьё × ${SPEAR_RAIN.count}`), String(spear));

  const fan = skillDamageText("arrowRain", "assassin", strike, attrs);
  assert.ok(fan?.includes(`Урон ${Math.round(fanKnifeDamage(strike))} за нож`), String(fan));

  const leap = skillDamageText("stunBash", "assassin", strike, attrs);
  assert.ok(leap?.includes(`Урон ${Math.round(assassinLeapDamage(strike))} (крит)`), String(leap));

  const whirl = skillDamageText("whirlwind", "warrior", strike, attrs);
  assert.ok(whirl?.includes(`Урон ${Math.round(warriorWhirlDamage(strike))} за удар`), String(whirl));

  const rain = skillDamageText("arrowRain", "archer", strike, attrs);
  assert.ok(rain?.includes(`Урон ${Math.round(strike)} за залп`), String(rain));
});
