import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ycloudRequest = vi.fn();
vi.mock("@/lib/ycloud/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ycloud/client")>()),
  ycloudRequest,
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "https://crm.ejemplo.com/";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test-token";
});
beforeEach(() => vi.resetAllMocks());

describe("testYCloudConnection", () => {
  it("éxito: devuelve el wabaId del número", async () => {
    ycloudRequest.mockResolvedValue({
      items: [{ phoneNumber: "+52 1 55 1234 5678", wabaId: "WABA9" }],
    });
    const { testYCloudConnection } = await import("@/server/ycloud/connect");
    expect(await testYCloudConnection("K", "+5215512345678")).toEqual({
      ok: true,
      wabaId: "WABA9",
    });
  });
  it("número ausente → number_not_found", async () => {
    ycloudRequest.mockResolvedValue({ items: [{ phoneNumber: "+5215500000000" }] });
    const { testYCloudConnection } = await import("@/server/ycloud/connect");
    expect(await testYCloudConnection("K", "+5215512345678")).toMatchObject({
      ok: false,
      code: "number_not_found",
    });
  });
  it("401 → invalid_key", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    ycloudRequest.mockRejectedValue(new YCloudApiError("no", { status: 401 }));
    const { testYCloudConnection } = await import("@/server/ycloud/connect");
    expect(await testYCloudConnection("K", "+5215512345678")).toMatchObject({
      ok: false,
      code: "invalid_key",
    });
  });
  it("403 al conectar → invalid_key (la key no tiene permisos)", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    ycloudRequest.mockRejectedValue(new YCloudApiError("no", { status: 403 }));
    const { testYCloudConnection } = await import("@/server/ycloud/connect");
    expect(await testYCloudConnection("K", "+5215512345678")).toMatchObject({ ok: false, code: "invalid_key" });
  });
  it("red o 5xx → provider_unavailable", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    const { testYCloudConnection } = await import("@/server/ycloud/connect");
    for (const status of [0, 502]) {
      ycloudRequest.mockRejectedValue(new YCloudApiError("x", { status }));
      expect(await testYCloudConnection("K", "+5215512345678")).toMatchObject({
        ok: false,
        code: "provider_unavailable",
      });
    }
  });
});

describe("webhook automático", () => {
  it("webhookUrl usa APP_BASE_URL sin barra final y el segmento secreto", async () => {
    const { webhookUrl } = await import("@/server/ycloud/connect");
    expect(webhookUrl()).toBe("https://crm.ejemplo.com/api/webhooks/yc/verify-test-token");
  });
  it("registerWebhook: éxito devuelve id y secreto", async () => {
    ycloudRequest.mockResolvedValue({ id: "wh_1", secret: "whsec_abc" });
    const { registerWebhook } = await import("@/server/ycloud/connect");
    expect(await registerWebhook("K", "https://x/y")).toEqual({
      ok: true,
      id: "wh_1",
      secret: "whsec_abc",
    });
    expect(ycloudRequest.mock.calls[0]![0]).toBe("/webhookEndpoints");
    expect(ycloudRequest.mock.calls[0]![1].body.enabledEvents).toContain(
      "whatsapp.inbound_message.received"
    );
  });
  it("registerWebhook: respuesta sin secreto → ok:false, sin lanzar", async () => {
    ycloudRequest.mockResolvedValue({ id: "wh_1" });
    const { registerWebhook } = await import("@/server/ycloud/connect");
    expect((await registerWebhook("K", "https://x/y")).ok).toBe(false);
  });
  it("registerWebhook: error del proveedor → ok:false, sin lanzar", async () => {
    ycloudRequest.mockRejectedValue(new Error("boom"));
    const { registerWebhook } = await import("@/server/ycloud/connect");
    expect((await registerWebhook("K", "https://x/y")).ok).toBe(false);
  });
  it("unregisterWebhook nunca lanza", async () => {
    ycloudRequest.mockRejectedValue(new Error("red caída"));
    const { unregisterWebhook } = await import("@/server/ycloud/connect");
    await expect(unregisterWebhook("K", "wh_1")).resolves.toBeUndefined();
  });
});
