import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/server/whatsapp/connection", () => ({ getWhatsAppConnection: vi.fn() }));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const creds = { apiKey: "SECRET-KEY" } as never;
const png = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
const keyOf = (call: unknown[]) =>
  ((call[1] as RequestInit).headers as Record<string, string> | undefined)?.["X-API-Key"];

async function run(link: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  const { downloadYCloudMedia } = await import("@/server/whatsapp/media");
  return downloadYCloudMedia(creds, { payload: { link } });
}

describe("downloadYCloudMedia · la API key solo viaja a YCloud", () => {
  it("a un host de YCloud por https sí lleva la key", async () => {
    const f = vi.fn().mockResolvedValue(png());
    await run("https://media.ycloud.com/x.png", f);
    expect(keyOf(f.mock.calls[0]!)).toBe("SECRET-KEY");
  });
  it.each([
    "https://evilycloud.com/x.png",
    "https://ycloud.com.evil.com/x.png",
    "https://cdn.example.com/x.png",
  ])("a %s NO lleva la key", async (link) => {
    const f = vi.fn().mockResolvedValue(png());
    await run(link, f);
    expect(keyOf(f.mock.calls[0]!)).toBeUndefined();
  });
  it("por http NO lleva la key (y se rechaza)", async () => {
    const f = vi.fn().mockResolvedValue(png());
    await expect(run("http://media.ycloud.com/x.png", f)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("una redirección a otro host se sigue SIN la key", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://bucket.s3.amazonaws.com/x.png" } }))
      .mockResolvedValueOnce(png());
    await run("https://media.ycloud.com/x.png", f);
    expect((f.mock.calls[0]![1] as RequestInit).redirect).toBe("manual");
    expect(keyOf(f.mock.calls[0]!)).toBe("SECRET-KEY");
    expect(String(f.mock.calls[1]![0])).toBe("https://bucket.s3.amazonaws.com/x.png");
    expect(keyOf(f.mock.calls[1]!)).toBeUndefined();
  });
  it("demasiadas redirecciones se cortan", async () => {
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://a.example.com/x" } }));
    await expect(run("https://media.ycloud.com/x.png", f)).rejects.toThrow();
  });
});

describe("downloadYCloudMedia · no es un SSRF", () => {
  it.each([
    "https://169.254.169.254/latest/meta-data",
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://192.168.1.10/x",
    "https://172.16.0.1/x",
    "https://localhost/x",
    "https://[::1]/x",
  ])("rechaza %s sin llamar a fetch", async (link) => {
    const f = vi.fn().mockResolvedValue(png());
    await expect(run(link, f)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("una redirección a una IP privada también se rechaza", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://169.254.169.254/x" } }));
    await expect(run("https://media.ycloud.com/x.png", f)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("con los mocks encendidos (no producción) se permite el loopback del self-test", async () => {
    vi.stubEnv("WA_MOCK_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "test");
    const f = vi.fn().mockResolvedValue(png());
    await run("http://127.0.0.1:3000/api/dev/ycloud-mock/media-file/1", f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(keyOf(f.mock.calls[0]!)).toBeUndefined();
  });
});
