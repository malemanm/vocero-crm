import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ conn: null as unknown }));
const downloadYCloudMedia = vi.fn();
const downloadGraphMedia = vi.fn();

vi.mock("@/server/bot/auth", () => ({
  requireBotKey: () => null,
  resolveInstanceOrg: async () => "org_1",
}));
vi.mock("@/server/whatsapp/connection", () => ({
  getWhatsAppConnection: async () => state.conn,
}));
vi.mock("@/server/whatsapp/media", async (orig) => ({
  ...(await orig<typeof import("@/server/whatsapp/media")>()),
  downloadGraphMedia,
  downloadYCloudMedia,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});
beforeEach(() => vi.resetAllMocks());

const get = async () => {
  const { GET } = await import("@/app/api/bot/media/[mediaId]/route");
  return GET(new Request("http://x/api/bot/media/m1"), { params: Promise.resolve({ mediaId: "m1" }) });
};

describe("GET /api/bot/media/{mediaId}", () => {
  it("Meta: igual que siempre", async () => {
    state.conn = { provider: "meta", creds: { token: "T" } };
    downloadGraphMedia.mockResolvedValue({ data: Buffer.from([1]), mimeType: "image/png" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(downloadGraphMedia).toHaveBeenCalledWith("T", "m1", expect.any(Number));
  });
  it("YCloud: no responde 409 'no conectado' — el cerebro externo recibe una respuesta honesta", async () => {
    state.conn = { provider: "ycloud", creds: { apiKey: "K" } };
    const res = await get();
    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe("not_supported_by_provider");
  });
  it("sin conexión → 409", async () => {
    state.conn = null;
    expect((await get()).status).toBe(409);
  });
});
