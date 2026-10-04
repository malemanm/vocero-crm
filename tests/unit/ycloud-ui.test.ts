import { beforeEach, describe, expect, it, vi } from "vitest";

let flag = false;
vi.mock("@/server/whatsapp/providers-flag", () => ({
  ycloudEnabled: () => flag,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/settings/whatsapp",
}));
vi.mock("@/components/settings/ycloud-client", () => ({
  YCloudClient: () => null,
}));

beforeEach(() => {
  flag = false;
});

describe("pantalla de YCloud", () => {
  it("apagado → 404 (la pantalla no existe en esta instancia)", async () => {
    const { default: Page } = await import("@/app/(app)/settings/ycloud/page");
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
  });
  it("encendido → renderiza el cliente", async () => {
    flag = true;
    const { default: Page } = await import("@/app/(app)/settings/ycloud/page");
    expect(() => Page()).not.toThrow();
  });
});

describe("pestañas de Configuración", () => {
  it("sin la bandera no hay pestaña de YCloud", async () => {
    const { settingsTabs } = await import("@/components/settings/settings-nav");
    expect(settingsTabs({}).map((t) => t.label)).not.toContain("YCloud");
  });
  it("con la bandera aparece justo después de WhatsApp", async () => {
    const { settingsTabs } = await import("@/components/settings/settings-nav");
    const labels = settingsTabs({ ycloud: true }).map((t) => t.label);
    expect(labels.indexOf("YCloud")).toBe(labels.indexOf("WhatsApp") + 1);
  });
});
