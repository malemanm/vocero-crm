import { createHmac } from "node:crypto";
import { safeEqual } from "@/server/inbox/webhook";

/** `YCloud-Signature: t=<ts>,s=<hex>` — HMAC-SHA256 de `<ts>.<cuerpo crudo>`. */
export function signYCloudBody(
  rawBody: string,
  secret: string,
  ts: number
): string {
  const s = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${ts},s=${s}`;
}

export function verifyYCloudSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec = 300
): boolean {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const p of header.split(",")) {
    const i = p.indexOf("=");
    if (i === -1) continue;
    parts[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  const ts = Number(parts.t);
  const sig = parts.s;
  if (!parts.t || !Number.isFinite(ts) || !sig) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`, "utf8")
    .digest("hex");
  return safeEqual(sig, expected);
}
