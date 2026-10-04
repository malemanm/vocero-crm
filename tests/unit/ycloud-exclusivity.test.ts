import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flag: true,
  role: "owner",
  meta: null as unknown,
  yc: null as unknown,
  saved: [] as unknown[],
  deleted: 0,
  test: { ok: true, wabaId: "W1" } as unknown,
  reg: { ok: true, id: "wh_1", secret: "sec" } as unknown,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({
    userId: "u",
    organizationId: "org_1",
    role: state.role,
  }),
}));
vi.mock("@/server/whatsapp/providers-flag", () => ({
  ycloudEnabled: () => state.flag,
  ycloudDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg: async () => state.meta,
  saveCredentials: vi.fn(),
  tokenLast4: (t: string) => t.slice(-4),
}));
vi.mock("@/server/whatsapp/connect", () => ({
  testConnection: async () => ({ ok: true, displayPhoneNumber: "+1", verifiedName: null }),
  subscribeAppToWaba: vi.fn(),
}));
vi.mock("@/server/ycloud/credentials", () => ({
  getYCloudCredentialsByOrg: async () => state.yc,
  saveYCloudCredentials: async (v: unknown) => void state.saved.push(v),
  deleteYCloudCredentials: async () => void (state.deleted += 1),
  apiKeyLast4: (k: string) => k.slice(-4),
  normalizePhoneE164: (p: string) => `+${p.replace(/\D/g, "")}`,
}));
vi.mock("@/server/ycloud/connect", () => ({
  testYCloudConnection: async () => state.test,
  registerWebhook: async () => state.reg,
  unregisterWebhook: vi.fn(),
  webhookUrl: () => "https://crm.ejemplo.com/api/webhooks/yc/tok",
}));
vi.mock("@/server/whatsapp/templates", () => ({
  syncTemplates: vi.fn().mockResolvedValue(0),
  TemplateError: class extends Error {},
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test-token";
});
beforeEach(() => {
  state.flag = true;
  state.role = "owner";
  state.meta = null;
  state.yc = null;
  state.saved = [];
  state.deleted = 0;
  state.test = { ok: true, wabaId: "W1" };
  state.reg = { ok: true, id: "wh_1", secret: "sec" };
});

const put = (body: unknown) =>
  new Request("http://x", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const BODY = { apiKey: "yc-key-1234", phone: "+5215512345678" };

describe("/api/settings/ycloud", () => {
  it("bandera apagada → 404 en GET, PUT y DELETE", async () => {
    state.flag = false;
    const m = await import("@/app/api/settings/ycloud/route");
    expect((await m.GET()).status).toBe(404);
    expect((await m.PUT(put(BODY))).status).toBe(404);
    expect((await m.DELETE()).status).toBe(404);
  });
  it("solo el propietario conecta", async () => {
    state.role = "agent";
    const { PUT } = await import("@/app/api/settings/ycloud/route");
    expect((await PUT(put(BODY))).status).toBe(403);
  });
  it("con Meta conectado → 409 provider_conflict y no guarda", async () => {
    state.meta = { organizationId: "org_1", token: "t" };
    const { PUT } = await import("@/app/api/settings/ycloud/route");
    const res = await PUT(put(BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("provider_conflict");
    expect(state.saved).toHaveLength(0);
  });
  it("éxito: guarda con el webhook registrado y el secreto", async () => {
    const { PUT } = await import("@/app/api/settings/ycloud/route");
    const res = await PUT(put(BODY));
    expect(res.status).toBe(200);
    expect((await res.json()).webhook).toBe("registered");
    expect(state.saved[0]).toMatchObject({
      webhookStatus: "registered",
      webhookId: "wh_1",
      webhookSecret: "sec",
      wabaId: "W1",
    });
  });
  it("si el webhook no se puede registrar, guarda igual como `pending` y entrega la URL", async () => {
    state.reg = { ok: false, message: "falló" };
    const { PUT } = await import("@/app/api/settings/ycloud/route");
    const res = await PUT(put(BODY));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.webhook).toBe("pending");
    expect(json.webhookUrl).toContain("/api/webhooks/yc/");
    expect(state.saved[0]).toMatchObject({ webhookStatus: "pending", webhookSecret: null });
  });
  it("key inválida → 422 y no guarda", async () => {
    state.test = { ok: false, code: "invalid_key", message: "mala" };
    const { PUT } = await import("@/app/api/settings/ycloud/route");
    expect((await PUT(put(BODY))).status).toBe(422);
    expect(state.saved).toHaveLength(0);
  });
  it("YCloud caído → 503", async () => {
    state.test = { ok: false, code: "provider_unavailable", message: "caído" };
    const { PUT } = await import("@/app/api/settings/ycloud/route");
    expect((await PUT(put(BODY))).status).toBe(503);
  });
  it("DELETE borra las credenciales", async () => {
    state.yc = { organizationId: "org_1", webhookId: "wh_1", apiKey: "K" };
    const { DELETE } = await import("@/app/api/settings/ycloud/route");
    expect((await DELETE()).status).toBe(200);
    expect(state.deleted).toBe(1);
  });
});

describe("/api/settings/whatsapp (Meta) con YCloud conectado", () => {
  it("→ 409 provider_conflict", async () => {
    state.yc = { organizationId: "org_1" };
    const { PUT } = await import("@/app/api/settings/whatsapp/route");
    const res = await PUT(put({ wabaId: "w", phoneNumberId: "p", token: "t" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("provider_conflict");
  });
  it("sin YCloud conectado, Meta conecta como siempre", async () => {
    const { PUT } = await import("@/app/api/settings/whatsapp/route");
    expect((await PUT(put({ wabaId: "w", phoneNumberId: "p", token: "t" }))).status).toBe(200);
  });
});
