import { describe, expect, it } from "vitest";
import {
  NAV_COLLAPSED_KEY,
  isNavToggleShortcut,
  readNavCollapsed,
  writeNavCollapsed,
} from "@/lib/nav-collapse";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => void (data[k] = v),
  };
}

describe("readNavCollapsed", () => {
  it("sin nada guardado, arranca expandido", () => {
    expect(readNavCollapsed(fakeStorage())).toBe(false);
  });
  it("recuerda el colapsado", () => {
    expect(readNavCollapsed(fakeStorage({ [NAV_COLLAPSED_KEY]: "1" }))).toBe(true);
  });
  it("cualquier otro valor (corrupto) cuenta como expandido", () => {
    expect(readNavCollapsed(fakeStorage({ [NAV_COLLAPSED_KEY]: "true?" }))).toBe(false);
    expect(readNavCollapsed(fakeStorage({ [NAV_COLLAPSED_KEY]: "" }))).toBe(false);
  });
  it("si el almacenamiento lanza (modo privado, bloqueado), no revienta y arranca expandido", () => {
    const roto = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    expect(readNavCollapsed(roto)).toBe(false);
  });
  it("sin almacenamiento (null) tampoco revienta", () => {
    expect(readNavCollapsed(null)).toBe(false);
  });
});

describe("writeNavCollapsed", () => {
  it("guarda 1 al colapsar y borra la marca al expandir", () => {
    const s = fakeStorage();
    writeNavCollapsed(true, s);
    expect(s.data[NAV_COLLAPSED_KEY]).toBe("1");
    writeNavCollapsed(false, s);
    expect(s.data[NAV_COLLAPSED_KEY]).toBe("0");
  });
  it("si escribir lanza, no revienta: el menú sigue funcionando sin recordar", () => {
    const roto = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeNavCollapsed(true, roto)).not.toThrow();
  });
});

describe("isNavToggleShortcut · Cmd/Ctrl + B", () => {
  const base = { key: "b", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it("Cmd+B y Ctrl+B alternan", () => {
    expect(isNavToggleShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isNavToggleShortcut({ ...base, ctrlKey: true })).toBe(true);
  });
  it("con mayúscula (Caps Lock) también", () => {
    expect(isNavToggleShortcut({ ...base, key: "B", metaKey: true })).toBe(true);
  });
  it("la B sola no hace nada: escribir 'b' no debe plegar el menú", () => {
    expect(isNavToggleShortcut({ ...base })).toBe(false);
  });
  it("otras teclas no", () => {
    expect(isNavToggleShortcut({ ...base, key: "k", metaKey: true })).toBe(false);
  });
  it("con Shift o Alt no (Cmd+Shift+B es de los navegadores)", () => {
    expect(isNavToggleShortcut({ ...base, metaKey: true, shiftKey: true })).toBe(false);
    expect(isNavToggleShortcut({ ...base, metaKey: true, altKey: true })).toBe(false);
  });
  it("dentro de un editor de texto enriquecido (negritas) lo deja pasar", () => {
    expect(
      isNavToggleShortcut({ ...base, metaKey: true, target: { isContentEditable: true } })
    ).toBe(false);
  });
});
