import { beforeEach, describe, expect, it, vi } from "vitest";

let on = false;
vi.mock("@/server/channels/enabled", () => ({
  isChannelEnabled: (c: string) => (c === "instagram" ? on : false),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  usePathname: () => "/settings/whatsapp",
}));
vi.mock("@/components/settings/instagram-client", () => ({ InstagramClient: () => null }));

beforeEach(() => {
  on = false;
});

describe("pantalla de Instagram", () => {
  it("canal apagado → 404 (la pantalla no existe en esta instancia)", async () => {
    const { default: Page } = await import("@/app/(app)/settings/instagram/page");
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
  });
  it("canal encendido → renderiza el cliente", async () => {
    on = true;
    const { default: Page } = await import("@/app/(app)/settings/instagram/page");
    expect(() => Page()).not.toThrow();
  });
});

describe("pestañas de Configuración · Instagram", () => {
  it("sin el canal no hay pestaña", async () => {
    const { settingsTabs } = await import("@/components/settings/settings-nav");
    expect(settingsTabs({ messenger: true }).map((t) => t.label)).not.toContain("Instagram");
  });
  it("con el canal aparece junto a Messenger", async () => {
    const { settingsTabs } = await import("@/components/settings/settings-nav");
    const labels = settingsTabs({ messenger: true, instagram: true }).map((t) => t.label);
    expect(labels.indexOf("Instagram")).toBe(labels.indexOf("Messenger") + 1);
  });
  it("Instagram solo (sin Messenger) va después de WhatsApp", async () => {
    const { settingsTabs } = await import("@/components/settings/settings-nav");
    const labels = settingsTabs({ instagram: true }).map((t) => t.label);
    expect(labels.indexOf("Instagram")).toBe(labels.indexOf("WhatsApp") + 1);
  });
});
