import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  conn: null as unknown,
  conv: { id: "cv_1", isTest: false, aiEnabled: true, handoffAt: null } as unknown,
  inbound: [{ waMessageId: "wamid.IN1" }] as unknown[],
}));
const ycloudRequest = vi.fn();
const graphRequest = vi.fn();

vi.mock("@/lib/ycloud/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ycloud/client")>()),
  ycloudRequest,
}));
vi.mock("@/lib/meta/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/meta/client")>()),
  graphRequest,
}));
vi.mock("@/server/bot/auth", () => ({
  requireBotKey: () => null,
  resolveInstanceOrg: async () => "org_1",
}));
vi.mock("@/server/whatsapp/connection", () => ({
  getWhatsAppConnection: async () => state.conn,
}));
let call = 0;
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => {
      const rows = () => (call++ % 2 === 0 ? [state.conv] : state.inbound);
      const chain: Record<string, unknown> = {};
      for (const m of ["from", "where", "orderBy"]) chain[m] = () => chain;
      chain.limit = async () => rows();
      return chain;
    },
  }),
  schema: {
    conversation: { organizationId: "o", id: "id" },
    message: { organizationId: "o", conversationId: "c", direction: "d", waMessageId: "w", createdAt: "t" },
  },
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});
beforeEach(() => {
  vi.resetAllMocks();
  call = 0;
  state.conv = { id: "cv_1", isTest: false, aiEnabled: true, handoffAt: null };
  state.inbound = [{ waMessageId: "wamid.IN1" }];
});

const post = async () => {
  const { POST } = await import("@/app/api/bot/typing/route");
  return POST(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: "cv_1" }),
    })
  );
};

describe("POST /api/bot/typing", () => {
  it("YCloud: marca leído el último entrante y responde ok", async () => {
    state.conn = { provider: "ycloud", creds: { apiKey: "K", organizationId: "org_1" } };
    ycloudRequest.mockResolvedValue({});
    const res = await post();
    expect(await res.json()).toMatchObject({ ok: true });
    expect(ycloudRequest.mock.calls[0]![0]).toBe("/whatsapp/inboundMessages/wamid.IN1/markAsRead");
    expect(graphRequest).not.toHaveBeenCalled();
  });
  it("YCloud falla → 200 con ok:false (best-effort por contrato)", async () => {
    state.conn = { provider: "ycloud", creds: { apiKey: "K", organizationId: "org_1" } };
    ycloudRequest.mockRejectedValue(new Error("boom"));
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: "provider_error" });
  });
  it("Meta sigue igual: manda read + typing_indicator por Graph", async () => {
    state.conn = { provider: "meta", creds: { phoneNumberId: "PN", token: "T" } };
    graphRequest.mockResolvedValue({});
    const res = await post();
    expect(await res.json()).toMatchObject({ ok: true });
    expect(graphRequest.mock.calls[0]![0]).toBe("PN/messages");
    expect(graphRequest.mock.calls[0]![1].body.typing_indicator).toEqual({ type: "text" });
  });
  it("sin conexión → 409", async () => {
    state.conn = null;
    expect((await post()).status).toBe(409);
  });
});
