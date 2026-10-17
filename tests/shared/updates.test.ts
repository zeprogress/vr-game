import { test } from "node:test";
import assert from "node:assert/strict";
import { UPDATES } from "../../src/shared/updates";

test("журнал: дата каждой записи в формате «ГГГГ-ММ-ДД ЧЧ:ММ»", () => {
  for (const u of UPDATES) assert.match(u.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, u.at);
});

test("журнал: новые записи сверху (даты не растут вниз по списку)", () => {
  for (let i = 1; i < UPDATES.length; i++) {
    assert.ok(UPDATES[i].at <= UPDATES[i - 1].at, `запись ${i} (${UPDATES[i].at}) лежит ниже более старой ${UPDATES[i - 1].at}`);
  }
});

test("журнал: в каждой записи есть хотя бы одна строка", () => {
  for (const u of UPDATES) assert.ok(u.items.length > 0, u.at);
});
