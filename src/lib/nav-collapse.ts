/**
 * Menú lateral colapsable: lo que NO depende de React, para poder probarlo.
 *
 * La elección se recuerda en `localStorage`. Ese almacenamiento puede faltar o
 * lanzar (modo privado, datos bloqueados, cuota llena): nada de lo de aquí puede
 * romper el menú por eso. Sin almacenamiento, el menú arranca expandido y
 * funciona igual; solo no recuerda.
 */
export const NAV_COLLAPSED_KEY = "vocero.nav.collapsed";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // acceder a `localStorage` también puede lanzar
  }
}

export function readNavCollapsed(
  storage: StorageLike | null = defaultStorage()
): boolean {
  try {
    return storage?.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeNavCollapsed(
  collapsed: boolean,
  storage: StorageLike | null = defaultStorage()
): void {
  try {
    storage?.setItem(NAV_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // no recordar es aceptable; romper el menú no
  }
}

/**
 * Cmd/Ctrl + B alterna el menú. Con Shift o Alt no (Cmd+Shift+B es de los
 * navegadores), y dentro de un editor de texto enriquecido se deja pasar:
 * ahí es «negritas».
 */
export function isNavToggleShortcut(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target?: unknown;
}): boolean {
  if (e.key.toLowerCase() !== "b") return false;
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (e.altKey || e.shiftKey) return false;
  const editable = (e.target as { isContentEditable?: boolean } | null | undefined)
    ?.isContentEditable;
  return editable !== true;
}
