import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRedeemRules, TwitchRedeem, type RedeemDeps, type RedeemRule } from "../../src/server/TwitchRedeem";

/** Награды без сети: часы — вручную, команда — по onCommand. */
function rig(rules: RedeemRule[], onCommand: () => boolean | void = () => true) {
  let now = 0;
  const deps = {
    now: () => now,
    setTimer: () => null,
    clearTimer: () => {},
    fetch: async () => {
      throw new Error("сети в тесте нет");
    },
    socket: () => {
      throw new Error("сокета в тесте нет");
    },
  } as unknown as RedeemDeps;
  const r = new TwitchRedeem(
    { channel: "test", clientId: "", clientSecret: "", seedRefresh: "", tokenFile: "/nonexistent/redeem-token.json", rules, onCommand },
    deps,
  );
  return { r, at: (ms: number) => (now = ms) };
}

const ULT = parseRedeemRules({ rewards: [{ title: "Ульта", command: "!ульта", cooldownSec: 120, perViewer: true }] }).rules;
const SHARED = parseRedeemRules({ rewards: [{ title: "Режим", command: "!режим агрессивно", cooldownSec: 120 }] }).rules;

test("личный кулдаун: один зритель не блокирует другого", () => {
  const { r, at } = rig(ULT);
  at(0);
  assert.equal(r.handle("alpha", "", "Ульта"), "ok");
  assert.equal(r.handle("beta", "", "Ульта"), "ok");
});

test("личный кулдаун: тот же зритель ждёт свои 120 с, потом снова может", () => {
  const { r, at } = rig(ULT);
  at(0);
  assert.equal(r.handle("alpha", "", "Ульта"), "ok");
  at(10_000);
  assert.equal(r.handle("alpha", "", "Ульта"), "cooldown");
  at(120_000);
  assert.equal(r.handle("alpha", "", "Ульта"), "ok");
});

test("общий кулдаун (без perViewer): одна активация блокирует всех", () => {
  const { r, at } = rig(SHARED);
  at(0);
  assert.equal(r.handle("alpha", "", "Режим"), "ok");
  assert.equal(r.handle("beta", "", "Режим"), "cooldown");
});

test("возврат баллов (refund): команда не выполнилась — кулдаун не запускается", () => {
  const refundRule = parseRedeemRules({ rewards: [{ title: "Ульта", command: "!ульта", cooldownSec: 120, perViewer: true, refund: true }] }).rules;
  const { r, at } = rig(refundRule, () => false);
  at(0);
  assert.equal(r.handle("alpha", "", "Ульта"), "ok");
  assert.equal(r.handle("alpha", "", "Ульта"), "ok", "отказ не должен ставить кулдаун");
});

test("правила: флаги perViewer и refund читаются, по умолчанию — выключены", () => {
  const { rules } = parseRedeemRules({
    rewards: [
      { title: "A", command: "!a", cooldownSec: 5 },
      { title: "B", command: "!b", cooldownSec: 5, perViewer: true, refund: true },
    ],
  });
  assert.equal(rules[0].perViewer, false);
  assert.equal(rules[0].refund, false);
  assert.equal(rules[1].perViewer, true);
  assert.equal(rules[1].refund, true);
});
