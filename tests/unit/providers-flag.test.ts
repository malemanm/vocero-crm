import { describe, expect, it } from "vitest";
import { parseWhatsAppProviders } from "@/server/whatsapp/providers-flag";

describe("parseWhatsAppProviders", () => {
  it("sin variable, solo meta", () => {
    expect([...parseWhatsAppProviders(undefined)]).toEqual(["meta"]);
    expect([...parseWhatsAppProviders("")]).toEqual(["meta"]);
  });
  it("meta está siempre encendido, aunque no se liste", () => {
    expect(parseWhatsAppProviders("ycloud").has("meta")).toBe(true);
  });
  it("enciende ycloud con espacios y mayúsculas", () => {
    expect(parseWhatsAppProviders(" Meta , YCloud ").has("ycloud")).toBe(true);
  });
  it("un typo no enciende nada", () => {
    expect(parseWhatsAppProviders("ycloudd").has("ycloud")).toBe(false);
  });
});
