import { describe, expect, it } from "vitest";
import { agentActionSchema } from "@/server/ai/actions";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { aiMockCompletion } from "@/server/dev/ai-mock";

/**
 * R11 — El ai-mock refleja lo que el prompt le enseña. Con la agenda apagada
 * contestaba `offer_slots` a "quiero una cita", el esquema del turno lo
 * rechazaba y el self-test terminaba en "Error del proveedor de IA": probaba
 * algo que en producción no pasa.
 */

type Profile = Parameters<typeof buildAgentSystemPrompt>[0]["profile"];
const profile = {
  name: "Nea",
  tone: null,
  instructions: null,
  escalationRules: null,
  greeting: null,
} as unknown as Profile;

const HOY = { today: "2026-10-09", weekday: "viernes", timezone: "America/Mexico_City", horizonEnd: "2026-10-16" };

function turno(agenda: boolean, texto: string, conHoy = false) {
  const system = buildAgentSystemPrompt({
    profile,
    kb: [],
    stages: [{ name: "Nuevo" }],
    agenda,
    agendaContext: conHoy ? HOY : undefined,
  });
  const raw = aiMockCompletion([
    { role: "system", content: system },
    { role: "user", content: texto },
  ]);
  return agentActionSchema(agenda).safeParse(JSON.parse(raw));
}

describe("ai-mock y la bandera AGENDA", () => {
  it("apagada: pedir cita NO produce offer_slots y el turno es válido", () => {
    const r = turno(false, "Hola, ¿dan citas el sábado?");
    expect(r.success).toBe(true);
    expect(r.data?.action).not.toBe("offer_slots");
  });

  it("encendida: pedir cita sigue ofreciendo horarios", () => {
    const r = turno(true, "Hola, ¿dan citas el sábado?");
    expect(r.success).toBe(true);
    expect(r.data?.action).toBe("offer_slots");
  });
});

describe("ai-mock: el día que pide el cliente llega como `date` (hoy: viernes 2026-10-09)", () => {
  const fecha = (texto: string) => {
    const r = turno(true, texto, true);
    expect(r.success).toBe(true);
    expect(r.data?.action).toBe("offer_slots");
    return (r.data as { date?: string | null }).date ?? null;
  };
  it.each([
    ["quiero una demo el lunes", "2026-10-12"],
    ["quiero agendar para el lunes 12", "2026-10-12"],
    ["¿puedo agendar mañana?", "2026-10-10"],
    ["una cita pasado mañana", "2026-10-11"],
    ["quiero agendar el martes", "2026-10-13"],
    // «el viernes» dicho en viernes es el de la semana que viene, no hoy.
    ["una cita el viernes", "2026-10-16"],
  ])("«%s» → %s", (texto, esperado) => {
    expect(fecha(texto)).toBe(esperado);
  });
  it("sin día no hay fecha: el reparto de siempre", () => {
    expect(fecha("quiero agendar una cita")).toBeNull();
  });
  it("una demo o una videollamada también se agenda, sin escalar", () => {
    expect(turno(true, "Quiero una demo", true).data?.action).toBe("offer_slots");
    expect(turno(true, "¿hacen videollamada?", true).data?.action).toBe("offer_slots");
  });
  it("sin el «Hoy es» del prompt el mock no inventa fecha", () => {
    const r = turno(true, "quiero agendar el lunes", false);
    expect((r.data as { date?: string | null }).date ?? null).toBeNull();
  });
});
