import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conn: null as unknown,
  local: [] as unknown[],
  updates: [] as unknown[],
}));
const ycloudRequest = vi.fn();

vi.mock("@/lib/ycloud/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ycloud/client")>()),
  ycloudRequest,
}));
vi.mock("@/server/whatsapp/connection", () => ({
  getWhatsAppConnection: async () => state.conn,
  sendWhatsAppPayload: vi.fn(),
  markConnectionReconnectRequired: vi.fn(),
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => null,
  getCredentialsByWabaId: async () => null,
  markReconnectRequired: vi.fn(),
}));
vi.mock("@/server/ycloud/credentials", () => ({
  markYCloudReconnectRequired: vi.fn(),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: () => "scoped" }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: async () => state.local }) }),
    update: () => ({
      set: (v: unknown) => ({
        where: async () => void state.updates.push(v),
      }),
    }),
  }),
  schema: {
    template: { organizationId: "o", id: "id", name: "n", language: "l" },
  },
}));
vi.mock("@/server/inbox/send", () => ({ SendError: class extends Error {} }));
vi.mock("@/server/inbox/ingest", () => ({ serializeMessage: vi.fn() }));
vi.mock("@/server/events/bus", () => ({ publish: vi.fn() }));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});
beforeEach(() => {
  vi.resetAllMocks();
  state.updates = [];
  state.local = [];
  state.conn = {
    provider: "ycloud",
    creds: { organizationId: "org_1", phone: "+5215512345678", wabaId: "W1", apiKey: "K", status: "connected" },
  };
});

describe("plantillas por YCloud", () => {
  it("syncTemplates lista de YCloud y actualiza el estado local", async () => {
    state.local = [
      { id: "tpl_1", name: "aviso", language: "es_MX", category: "UTILITY", status: "pending", waTemplateId: null },
    ];
    ycloudRequest.mockResolvedValue({
      items: [{ name: "aviso", language: "es_MX", status: "APPROVED", category: "MARKETING" }],
    });
    const { syncTemplates } = await import("@/server/whatsapp/templates");
    expect(await syncTemplates("org_1")).toBe(1);
    expect(ycloudRequest.mock.calls[0]![0]).toContain("/whatsapp/templates");
    expect(state.updates[0]).toMatchObject({ status: "approved", category: "MARKETING" });
  });

  it("syncTemplates: YCloud caído → TemplateError meta_unavailable, sin lanzar otra cosa", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    ycloudRequest.mockRejectedValue(new YCloudApiError("x", { status: 503 }));
    const { syncTemplates } = await import("@/server/whatsapp/templates");
    await expect(syncTemplates("org_1")).rejects.toMatchObject({ code: "meta_unavailable" });
  });

  it("createTemplate degrada con un mensaje claro (la creación va en el panel de YCloud)", async () => {
    const { createTemplate } = await import("@/server/whatsapp/templates");
    await expect(
      createTemplate("org_1", { name: "x", language: "es", category: "UTILITY", body: "hola" })
    ).rejects.toMatchObject({ code: "provider_unsupported" });
  });
});
