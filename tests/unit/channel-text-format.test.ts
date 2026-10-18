import { describe, expect, it } from "vitest";
import { capabilitiesFor, outboundTextFor } from "@/server/channels/capabilities";

describe("formato del texto de la IA por canal", () => {
  it("WhatsApp dibuja el formato; Instagram y Messenger no", () => {
    expect(capabilitiesFor("whatsapp").textFormat).toBe("whatsapp");
    expect(capabilitiesFor("instagram").textFormat).toBe("plain");
    expect(capabilitiesFor("messenger").textFormat).toBe("plain");
  });

  it("el texto de la IA sale plano en Instagram y Messenger", () => {
    for (const ch of ["instagram", "messenger"] as const) {
      expect(outboundTextFor(ch, "*Precio:* $120\n- Martillo", true)).toBe(
        "Precio: $120\n• Martillo"
      );
    }
  });

  it("en WhatsApp el texto de la IA no cambia", () => {
    expect(outboundTextFor("whatsapp", "*Precio:* $120", true)).toBe("*Precio:* $120");
  });

  it("lo que escribe una persona nunca se toca, en ningún canal", () => {
    expect(outboundTextFor("instagram", "*Hola* _tú_", false)).toBe("*Hola* _tú_");
  });
});
