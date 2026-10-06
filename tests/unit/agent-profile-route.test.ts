import { beforeAll, describe, expect, it, vi } from "vitest";
import { PROFILE_LIMITS } from "@/lib/agent-profile-form";

const updates: unknown[] = [];
vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => ({ userId: "u", organizationId: "org_1", role: "owner" }),
}));
vi.mock("@/lib/db/tenant", () => ({ scoped: () => "scoped" }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    update: () => ({
      set: (v: unknown) => ({
        where: () => ({ returning: async () => (updates.push(v), [{ id: "agp_1" }]) }),
      }),
    }),
  }),
  schema: { agentProfile: { organizationId: "organization_id" } },
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

const put = async (body: unknown) => {
  const { PUT } = await import("@/app/api/agent/profile/route");
  return PUT(new Request("http://x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
};

describe("PUT /api/agent/profile · límites", () => {
  it("justo en el límite guarda", async () => {
    const res = await put({ instructions: "a".repeat(PROFILE_LIMITS.instructions) });
    expect(res.status).toBe(200);
  });
  it("un carácter de más → 422 y el mensaje dice QUÉ campo", async () => {
    const res = await put({ instructions: "a".repeat(PROFILE_LIMITS.instructions + 1) });
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain("instructions");
  });
  it("un campo pasado impide guardar los demás (todo o nada), por eso la pantalla los vigila", async () => {
    updates.length = 0;
    const res = await put({ name: "Eva", greeting: "g".repeat(PROFILE_LIMITS.greeting + 1) });
    expect(res.status).toBe(422);
    expect(updates).toHaveLength(0);
  });
});
