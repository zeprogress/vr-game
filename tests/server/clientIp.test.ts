import { test } from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { ipOfRequest } from "../../src/server/clientIp";

const req = (headers: Record<string, string>, remote?: string): IncomingMessage =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as IncomingMessage;

test("ip: X-Real-IP от nginx важнее адреса сокета (127.0.0.1)", () => {
  assert.equal(ipOfRequest(req({ "x-real-ip": "203.0.113.7" }, "127.0.0.1")), "203.0.113.7");
});

test("ip: без X-Real-IP — первый адрес из X-Forwarded-For", () => {
  assert.equal(ipOfRequest(req({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }, "127.0.0.1")), "198.51.100.2");
});

test("ip: без заголовков — адрес сокета; без запроса — «?»", () => {
  assert.equal(ipOfRequest(req({}, "192.0.2.9")), "192.0.2.9");
  assert.equal(ipOfRequest(undefined), "?");
});
