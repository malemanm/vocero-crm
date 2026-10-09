import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El turno del agente con la agenda encendida: la `date` que eligió el modelo
 * llega al motor, y al cliente le llega el texto del MOTOR (con el día real), no
 * la frase que escribió el modelo.
 */

const chatJson = vi.fn();
const sendText = vi.fn();
const offerSlots = vi.fn();
const bookSlot = vi.fn();

vi.mock("@/lib/ai", () => ({ chatJson }));
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...original, sendText };
});
vi.mock("@/server/agenda/agent", () => ({
  offerSlots,
  bookSlot,
  agendaContextoParaPrompt: async () => ({
    today: "2026-10-09",
    weekday: "viernes",
    timezone: "America/Mexico_City",
    horizonEnd: "2026-10-16",
  }),
}));
vi.mock("@/server/agenda/offers", async (original) => ({
  ...(await original<typeof import("@/server/agenda/offers")>()),
  getOffers: async () => [],
}));

const selectQueue: unknown[][] = [];
function thenableChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy", "limit"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    Promise.resolve(rows).then(resolve);
  return chain;
}
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => thenableChain(selectQueue.shift() ?? []),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        const chain = {
          onConflictDoNothing: () => chain,
          returning: () => Promise.resolve([v]),
          then: (resolve: (x: unknown) => void) => Promise.resolve([v]).then(resolve),
        };
        return chain;
      },
    }),
    update: () => ({
      set: () => ({
        where: () => {
          const chain = {
            returning: () => Promise.resolve([{ id: "cv_1" }]),
            then: (resolve: (x: unknown) => void) => Promise.resolve([{ id: "cv_1" }]).then(resolve),
          };
          return chain;
        },
      }),
    }),
  }),
  schema: new Proxy({}, { get: (_t, table) => new Proxy({}, { get: (_t2, col) => `${String(table)}.${String(col)}` }) }),
}));

const conversacion = {
  id: "cv_1", organizationId: "org_1", contactId: "ct_1", channel: "whatsapp",
  isTest: false, aiEnabled: true, handoffAt: null, handoffReason: null,
  lastInboundAt: new Date(),
};
const perfil = { id: "agp_1", organizationId: "org_1", enabled: true, name: "Eva", tone: null, instructions: null, escalationRules: null, greeting: null };

let runAgentTurn: (id: string) => Promise<void>;
beforeAll(async () => {
  ({ runAgentTurn } = await import("@/server/ai/pipeline"));
}, 60_000);

beforeEach(() => {
  selectQueue.length = 0;
  selectQueue.push(
    [conversacion],
    [perfil],
    [{ id: "msg_1", direction: "in", text: "Pra el lunes 12", waMessageId: null, createdAt: new Date() }],
    [],
    []
  );
  chatJson.mockReset();
  sendText.mockReset();
  sendText.mockResolvedValue({ messageId: "msg_out" });
  offerSlots.mockReset();
  offerSlots.mockResolvedValue({ ok: true, text: "Estos son los horarios disponibles para el lunes 12 de octubre:\n• 10:00" });
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
  vi.stubEnv("AGENDA", "on");
});

describe("turno con offer_slots y fecha", () => {
  it("pasa la fecha al motor y manda al cliente el texto del MOTOR, no el del modelo", async () => {
    chatJson.mockResolvedValue({
      ok: true,
      data: { action: "offer_slots", date: "2026-10-12", reply: "Claro, para el lunes 12:" },
      raw: "{}",
    });
    await runAgentTurn("cv_1");
    expect(offerSlots).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-10-12", intro: "Claro, para el lunes 12:" })
    );
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]![0].text).toContain("lunes 12 de octubre");
    expect(sendText.mock.calls[0]![0].text).not.toContain("Claro, para el lunes 12:");
  });
  it("el prompt que recibe el modelo trae la fecha de hoy y la regla de la demo", async () => {
    chatJson.mockResolvedValue({ ok: true, data: { action: "none" }, raw: "{}" });
    await runAgentTurn("cv_1");
    const sistema = (chatJson.mock.calls[0]![1] as { role: string; content: string }[])[0]!.content;
    expect(sistema).toContain("Hoy es viernes 2026-10-09");
    expect(sistema).toMatch(/demo/i);
  });
  it("sin fecha, el motor recibe la frase y ningún día", async () => {
    chatJson.mockResolvedValue({ ok: true, data: { action: "offer_slots", reply: "Tengo estos:" }, raw: "{}" });
    await runAgentTurn("cv_1");
    expect(offerSlots.mock.calls[0]![0].date ?? null).toBeNull();
  });
});
