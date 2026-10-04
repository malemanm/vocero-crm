import { describe, expect, it } from "vitest";
import { signYCloudBody, verifyYCloudSignature } from "@/server/ycloud/signature";

const SECRET = "whsec_test";
const BODY = '{"id":"evt_1","type":"whatsapp.inbound_message.received"}';
const NOW = 1_800_000_000;

describe("verifyYCloudSignature", () => {
  it("acepta una firma válida y reciente", () => {
    const h = signYCloudBody(BODY, SECRET, NOW);
    expect(verifyYCloudSignature(BODY, h, SECRET, NOW)).toBe(true);
  });
  it("rechaza el cuerpo alterado un byte", () => {
    const h = signYCloudBody(BODY, SECRET, NOW);
    expect(verifyYCloudSignature(BODY + " ", h, SECRET, NOW)).toBe(false);
  });
  it("rechaza otro secreto", () => {
    const h = signYCloudBody(BODY, "otro", NOW);
    expect(verifyYCloudSignature(BODY, h, SECRET, NOW)).toBe(false);
  });
  it("rechaza un timestamp fuera de los 5 minutos", () => {
    const h = signYCloudBody(BODY, SECRET, NOW - 301);
    expect(verifyYCloudSignature(BODY, h, SECRET, NOW)).toBe(false);
  });
  it("rechaza header ausente o mal formado", () => {
    expect(verifyYCloudSignature(BODY, null, SECRET, NOW)).toBe(false);
    expect(verifyYCloudSignature(BODY, "", SECRET, NOW)).toBe(false);
    expect(verifyYCloudSignature(BODY, "basura", SECRET, NOW)).toBe(false);
    expect(verifyYCloudSignature(BODY, "t=abc,s=00", SECRET, NOW)).toBe(false);
  });
});
