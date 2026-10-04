import { beforeAll, describe, expect, it, vi } from "vitest";

const insertedRows: Record<string, unknown>[] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedRows.push(v);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  }),
  schema: { ycloudCredentials: { organizationId: "organization_id" } },
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

describe("credenciales de YCloud", () => {
  it("cifra la API key y el secreto: la fila no trae texto plano", async () => {
    const { saveYCloudCredentials } = await import("@/server/ycloud/credentials");
    await saveYCloudCredentials({
      organizationId: "org_1",
      phone: "+5215512345678",
      apiKey: "yc-key-secreta-9999",
      webhookSecret: "whsec-secreto-abc",
      webhookStatus: "registered",
    });
    const row = insertedRows[0]!;
    const s = JSON.stringify(row);
    expect(s).not.toContain("yc-key-secreta-9999");
    expect(s).not.toContain("whsec-secreto-abc");
    expect(row.apiKeyCipher).toBeTruthy();
    expect(row.webhookSecretCipher).toBeTruthy();
  });

  it("sin secreto de webhook, sus columnas quedan null", async () => {
    const { saveYCloudCredentials } = await import("@/server/ycloud/credentials");
    await saveYCloudCredentials({
      organizationId: "org_2",
      phone: "+5215512345679",
      apiKey: "otra-key-0000",
      webhookStatus: "pending",
    });
    const row = insertedRows[1]!;
    expect(row.webhookSecretCipher).toBeNull();
    expect(row.webhookStatus).toBe("pending");
  });

  it("apiKeyLast4 solo enseña la cola", async () => {
    const { apiKeyLast4 } = await import("@/server/ycloud/credentials");
    expect(apiKeyLast4("yc-key-secreta-9999")).toBe("9999");
  });

  it("normalizePhoneE164 deja `+` y solo dígitos", async () => {
    const { normalizePhoneE164 } = await import("@/server/ycloud/credentials");
    expect(normalizePhoneE164("+52 1 55 1234 5678")).toBe("+5215512345678");
    expect(normalizePhoneE164("5215512345678")).toBe("+5215512345678");
  });
});
