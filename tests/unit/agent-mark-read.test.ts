import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El agente marca como leído el mensaje del cliente en cuanto empieza a
 * procesarlo (antes de llamar al modelo), para que el cliente vea las palomitas
 * azules al instante en vez de esperar los ~8 s de la respuesta.
 *
 * Es un detalle de cortesía: JAMÁS puede frenar ni tumbar el turno, ni tocar la
 * API real desde una conversación del Laboratorio ni de otro canal.
 */

const eventos: string[] = [];
const chatJson = vi.fn();
const sendText = vi.fn();
const getWhatsAppConnection = vi.fn();
const markInboundRead = vi.fn();

vi.mock("@/lib/ai", () => ({ chatJson }));
vi.mock("@/server/inbox/send", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/inbox/send")>();
  return { ...original, sendText };
});
vi.mock("@/server/whatsapp/connection", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/whatsapp/connection")>();
  return { ...original, getWhatsAppConnection, markInboundRead };
});

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

function conversacion(extra: Record<string, unknown> = {}) {
  return {
    id: "cv_1", organizationId: "org_1", contactId: "ct_1", channel: "whatsapp",
    isTest: false, aiEnabled: true, handoffAt: null, handoffReason: null,
    lastInboundAt: new Date(), ...extra,
  };
}
const perfil = { id: "agp_1", organizationId: "org_1", enabled: true, name: "A", tone: null, instructions: null, escalationRules: null, greeting: null };
const historial = (waMessageId: string | null = "wamid.IN1") => [
  { id: "msg_1", direction: "in", text: "cuánto cuesta", waMessageId, createdAt: new Date() },
];
function turno(conv = conversacion(), wamid: string | null = "wamid.IN1") {
  // conversación, perfil, historial, y luego conocimiento y etapas del turno
  selectQueue.push([conv], [perfil], historial(wamid), [], []);
}

let runAgentTurn: (id: string) => Promise<void>;
beforeAll(async () => {
  ({ runAgentTurn } = await import("@/server/ai/pipeline"));
}, 60_000);

beforeEach(() => {
  eventos.length = 0;
  selectQueue.length = 0;
  chatJson.mockReset();
  chatJson.mockImplementation(async () => {
    eventos.push("modelo");
    return { ok: true, data: { action: "none" }, raw: "{}" };
  });
  sendText.mockReset();
  getWhatsAppConnection.mockReset();
  getWhatsAppConnection.mockResolvedValue({ provider: "ycloud", creds: { organizationId: "org_1" } });
  markInboundRead.mockReset();
  markInboundRead.mockImplementation(async () => {
    eventos.push("leido");
    return true;
  });
  vi.stubEnv("OPENROUTER_API_TOKEN", "token-test");
});

describe("el agente marca como leído antes de pensar", () => {
  it("conversación real de WhatsApp: marca el último entrante ANTES de llamar al modelo", async () => {
    turno();
    await runAgentTurn("cv_1");
    expect(markInboundRead).toHaveBeenCalledWith(expect.objectContaining({ provider: "ycloud" }), "wamid.IN1");
    expect(eventos).toEqual(["leido", "modelo"]);
  });
  it("conversación del Laboratorio: jamás toca el proveedor", async () => {
    turno(conversacion({ isTest: true }));
    await runAgentTurn("cv_1");
    expect(getWhatsAppConnection).not.toHaveBeenCalled();
    expect(markInboundRead).not.toHaveBeenCalled();
    expect(eventos).toEqual(["modelo"]);
  });
  it("conversación de Instagram o Messenger: no usa la conexión de WhatsApp", async () => {
    turno(conversacion({ channel: "instagram" }), "ig_abc");
    await runAgentTurn("cv_1");
    expect(markInboundRead).not.toHaveBeenCalled();
    expect(eventos).toEqual(["modelo"]);
  });
  it("sin conexión de WhatsApp, el turno sigue sin marcar nada", async () => {
    getWhatsAppConnection.mockResolvedValue(null);
    turno();
    await runAgentTurn("cv_1");
    expect(markInboundRead).not.toHaveBeenCalled();
    expect(eventos).toEqual(["modelo"]);
  });
  it("si marcar leído falla, el turno NO se cae", async () => {
    markInboundRead.mockResolvedValue(false);
    turno();
    await runAgentTurn("cv_1");
    expect(chatJson).toHaveBeenCalledTimes(1);
  });
  it("si hasta resolver la conexión lanza, el turno NO se cae", async () => {
    getWhatsAppConnection.mockRejectedValue(new Error("BD caída"));
    turno();
    await runAgentTurn("cv_1");
    expect(chatJson).toHaveBeenCalledTimes(1);
  });
  it("un mensaje sin id de WhatsApp no se marca", async () => {
    turno(conversacion(), null);
    await runAgentTurn("cv_1");
    expect(markInboundRead).not.toHaveBeenCalled();
  });
  it("con la IA apagada en la conversación o traspaso activo, no se marca (el agente no responde)", async () => {
    turno(conversacion({ aiEnabled: false }));
    await runAgentTurn("cv_1");
    selectQueue.length = 0;
    turno(conversacion({ handoffAt: new Date() }));
    await runAgentTurn("cv_1");
    expect(markInboundRead).not.toHaveBeenCalled();
    expect(chatJson).not.toHaveBeenCalled();
  });
});
