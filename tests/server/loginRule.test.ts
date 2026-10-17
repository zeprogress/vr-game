import { test } from "node:test";
import assert from "node:assert/strict";
import { loginVerdict } from "../../src/server/loginRule";

test("вход: героя нет — закрыто", () => {
  assert.deepEqual(loginVerdict(undefined, true), { ok: false, reason: "closed" });
});

test("вход: герой не создан через !play — закрыто, даже если браузер подтверждён", () => {
  assert.deepEqual(loginVerdict({}, true), { ok: false, reason: "closed" });
  assert.deepEqual(loginVerdict({ viaPlay: false }, true), { ok: false, reason: "closed" });
});

test("вход: герой через !play, браузер не подтверждал ник — нужен код", () => {
  assert.deepEqual(loginVerdict({ viaPlay: true }, false), { ok: false, reason: "code" });
});

test("вход: герой через !play и подтверждённый браузер — пускаем", () => {
  assert.deepEqual(loginVerdict({ viaPlay: true }, true), { ok: true });
});
