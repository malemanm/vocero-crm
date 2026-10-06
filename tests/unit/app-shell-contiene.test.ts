import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/results",
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
vi.mock("@/lib/auth/client", () => ({ signOut: async () => {} }));
vi.mock("@/components/use-events", () => ({ useEvents: () => {} }));

const branding = { name: "Vocero", accent: "#0d5bff", favicon: null } as never;

/**
 * Cualquier elemento `position: absolute` sin un ancestro posicionado toma el
 * DOCUMENTO como bloque contenedor, y entonces el `overflow-hidden` del
 * cascarón no lo recorta: si es más alto que la ventana, la página entera gana
 * una segunda barra de scroll (la del documento), el menú queda corrido hacia
 * arriba y debajo aparece un hueco blanco. Pasó con `<table class="sr-only">`
 * (830 px) y con los `<thead class="sr-only">` de Resultados.
 *
 * El cascarón es `relative`: así es EL bloque contenedor de todo lo absoluto
 * que haya dentro, y su `overflow-hidden` lo recorta, sea quien sea el que lo
 * ponga mañana.
 */
describe("AppShell · contiene lo posicionado de forma absoluta", () => {
  it("la raíz es relative, ocupa el alto de la ventana y recorta", async () => {
    const { AppShell } = await import("@/components/app-shell");
    const html = renderToStaticMarkup(
      // El tipo exige `children` como prop; en un archivo .ts no hay JSX.
      // eslint-disable-next-line react/no-children-prop
      createElement(AppShell, {
        branding,
        userName: "Miguel",
        role: "owner",
        theme: "light",
        children: createElement("div", null, "contenido"),
      })
    );
    const raiz = html.match(/^<div class="([^"]*)"/)?.[1] ?? "";
    expect(raiz.split(" ")).toEqual(
      expect.arrayContaining(["relative", "h-dvh", "overflow-hidden"])
    );
  });
});
