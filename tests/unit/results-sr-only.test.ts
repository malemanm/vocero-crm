import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimeBars } from "@/components/results/time-bars";

/**
 * Un `<table class="sr-only">` NO se oculta: `.sr-only` pone `height: 1px` y
 * `overflow: hidden`, pero una tabla (`display: table`) ignora las dos cosas y
 * mide lo que midan sus filas. Como además es `position: absolute` y ningún
 * ancestro suyo está posicionado, su bloque contenedor es el documento: el
 * `overflow-hidden` del cascarón de la app no la recorta, y una tabla de 830 px
 * le daba a la página entera una SEGUNDA barra de scroll (la del documento) que
 * dejaba la app subida y un hueco blanco debajo.
 *
 * La tabla accesible va DENTRO de un `<div class="sr-only">`: el div sí mide 1 px
 * y sí recorta lo que lleva dentro.
 */

const puntos = Array.from({ length: 31 }, (_, i) => ({
  bucket: `2026-09-${String(i + 1).padStart(2, "0")}`,
  value: i * 3,
}));

describe("TimeBars · tabla accesible", () => {
  const html = renderToStaticMarkup(
    createElement(TimeBars, {
      title: "Conversaciones",
      points: puntos,
      format: (v: number) => String(v),
      unit: "Conversaciones",
    })
  );

  it("la tabla para lectores de pantalla sigue existiendo", () => {
    expect(html).toContain("<table");
    expect(html).toContain("<caption>Conversaciones</caption>");
  });
  it("pero NO es ella la que lleva sr-only", () => {
    expect(html).not.toMatch(/<table[^>]*class="[^"]*sr-only/);
  });
  it("va dentro de un contenedor sr-only que la recorta", () => {
    expect(html).toMatch(/<div class="sr-only"><table/);
  });
});

describe("ninguna tabla del código se oculta con sr-only directamente", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
  function archivos(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...archivos(full));
      else if (/\.tsx$/.test(entry)) out.push(full);
    }
    return out;
  }
  it("no hay `<table className=\"…sr-only…\">` en src/", () => {
    const culpables = archivos(SRC).filter((f) =>
      /<table[^>]*className="[^"]*sr-only/.test(readFileSync(f, "utf8"))
    );
    expect(culpables.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
