import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/inbox",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({ signOut: async () => {} }));
vi.mock("@/components/use-events", () => ({ useEvents: () => {} }));

const branding = { name: "Vocero", accent: "#0d5bff", favicon: null } as never;

async function render(collapsed: boolean) {
  const { AppNav } = await import("@/components/app-nav");
  return renderToStaticMarkup(
    createElement(AppNav, {
      branding,
      userName: "Miguel",
      role: "owner",
      theme: "light",
      agenda: true,
      collapsed,
      onToggleCollapsed: () => {},
    })
  );
}

describe("AppNav · colapsable", () => {
  it("expandido: ancho completo y botón para colapsar", async () => {
    const html = await render(false);
    expect(html).toContain("lg:w-56");
    expect(html).not.toContain("lg:w-[4.5rem]");
    expect(html).toContain('aria-label="Colapsar el menú"');
    expect(html).not.toContain('aria-label="Expandir el menú"');
  });
  it("colapsado: barra de iconos y botón para expandir", async () => {
    const html = await render(true);
    expect(html).toContain("lg:w-[4.5rem]");
    expect(html).toContain('aria-label="Expandir el menú"');
    expect(html).not.toContain('aria-label="Colapsar el menú"');
  });
  it("colapsado, cada sección sigue siendo alcanzable con nombre accesible y tooltip", async () => {
    const html = await render(true);
    for (const label of ["Bandeja", "Pipeline", "Citas", "Contactos", "Resultados", "Agente", "Laboratorio", "Ajustes"]) {
      expect(html).toContain(`title="${label}"`);
      expect(html).toContain(`aria-label="${label}"`);
    }
  });
  it("el cajón de móvil conserva su botón de cerrar", async () => {
    expect(await render(true)).toContain('aria-label="Cerrar el menú"');
  });
  it("el cierre de sesión y el tema siguen accesibles colapsado", async () => {
    const html = await render(true);
    expect(html).toContain('aria-label="Cerrar sesión"');
    expect(html).toContain("Tema:");
  });
});
