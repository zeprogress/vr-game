import type { IncomingMessage } from "node:http";

/**
 * IP клиента для журнала (кто и откуда зашёл / что сделал с инвентарём). За nginx адрес сокета —
 * 127.0.0.1, поэтому сначала берём X-Real-IP / X-Forwarded-For, которые ставит прокси.
 */
export function ipOfRequest(req: IncomingMessage | undefined): string {
  if (!req) return "?";
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real) return real;
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "?";
}
