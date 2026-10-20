import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT, EVENT_BUFF_MINUTES } from "../../src/shared/constants";
import { CATACOMBS } from "../../src/shared/catacombs";

test("Благословение победы: одинаковые минуты на нашествии, охоте на элиту и в катакомбах", () => {
  assert.equal(EVENT_BUFF_MINUTES, 25);
  assert.equal(EVENT.invasion.buffMinutes, EVENT_BUFF_MINUTES);
  assert.equal(EVENT.eliteHunt.buffMinutes, EVENT_BUFF_MINUTES);
  assert.equal(CATACOMBS.buffMinutes, EVENT_BUFF_MINUTES);
});
