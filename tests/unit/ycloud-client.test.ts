import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});
afterEach(() => vi.unstubAllGlobals());

describe("ycloudRequest", () => {
  it("manda X-API-Key y devuelve el JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    const out = await ycloudRequest<{ id: string }>("/whatsapp/templates", { apiKey: "K" });
    expect(out.id).toBe("x");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.ycloud.com/v2/whatsapp/templates");
    expect((init as RequestInit).headers).toMatchObject({ "X-API-Key": "K" });
  });

  it("401 es error de autenticación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "AUTH", message: "bad key" } }), { status: 401 })));
    const { ycloudRequest, YCloudApiError } = await import("@/lib/ycloud/client");
    const err = (await ycloudRequest("/x", { apiKey: "K" }).catch((e) => e)) as InstanceType<typeof import("@/lib/ycloud/client").YCloudApiError>;
    expect(err).toBeInstanceOf(YCloudApiError);
    expect(err.isAuthError).toBe(true);
  });

  it("5xx jamás es error de autenticación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 503 })));
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    const err = (await ycloudRequest("/x", { apiKey: "K" }).catch((e) => e)) as InstanceType<typeof import("@/lib/ycloud/client").YCloudApiError>;
    expect(err.isAuthError).toBe(false);
    expect(err.status).toBe(503);
  });

  it("falla de red → status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    const err = (await ycloudRequest("/x", { apiKey: "K" }).catch((e) => e)) as InstanceType<typeof import("@/lib/ycloud/client").YCloudApiError>;
    expect(err.status).toBe(0);
  });

  it("cuerpo no-JSON con 200 no revienta: devuelve null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    expect(await ycloudRequest("/x", { apiKey: "K" })).toBeNull();
  });
});
