import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const processYCloudWebhook = vi.fn();
let flag = true;

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
vi.mock("@/server/ycloud/process", () => ({ processYCloudWebhook }));
vi.mock("@/server/whatsapp/providers-flag", () => ({
  ycloudEnabled: () => flag,
  ycloudDisabledResponse: () => new Response(null, { status: 404 }),
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test-token";
});
beforeEach(() => {
  vi.resetAllMocks();
  flag = true;
});

const call = async (token: string) => {
  const { POST } = await import("@/app/api/webhooks/yc/[webhookToken]/route");
  return POST(
    new Request("http://x/api/webhooks/yc/" + token, {
      method: "POST",
      body: "{}",
      headers: { "ycloud-signature": "t=1,s=00" },
    }),
    { params: Promise.resolve({ webhookToken: token }) }
  );
};

describe("POST /api/webhooks/yc/[token]", () => {
  it("bandera apagada → 404 y no procesa", async () => {
    flag = false;
    expect((await call("verify-test-token")).status).toBe(404);
    expect(processYCloudWebhook).not.toHaveBeenCalled();
  });
  it("token incorrecto → 404 y no procesa", async () => {
    expect((await call("otro")).status).toBe(404);
    expect(processYCloudWebhook).not.toHaveBeenCalled();
  });
  it("firma inválida → 401", async () => {
    processYCloudWebhook.mockResolvedValue("bad_signature");
    expect((await call("verify-test-token")).status).toBe(401);
  });
  it("evento válido → 200", async () => {
    processYCloudWebhook.mockResolvedValue("ok");
    expect((await call("verify-test-token")).status).toBe(200);
  });
  it("un error al procesar responde 500 para que YCloud reintente (no se pierde el mensaje)", async () => {
    processYCloudWebhook.mockRejectedValue(new Error("boom"));
    expect((await call("verify-test-token")).status).toBe(500);
  });
  it("si la ingesta tarda más que la espera, responde 200 y sigue en segundo plano", async () => {
    vi.useFakeTimers();
    processYCloudWebhook.mockReturnValue(new Promise(() => {}));
    const p = call("verify-test-token");
    await vi.advanceTimersByTimeAsync(4_500);
    expect((await p).status).toBe(200);
    vi.useRealTimers();
  });
});
