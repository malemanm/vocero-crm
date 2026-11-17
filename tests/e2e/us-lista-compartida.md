# Guion E2E — Lista de conversaciones rápida (064)

> Automatizado en `scripts/e2e-lista-compartida.mjs` (`pnpm test:e2e:lista`).
> Portado del 064 del proyecto original, sin lo de Ctrl+K.

## Por qué

Cada mensaje recargaba la lista de conversaciones cuatro veces por pestaña (la
Bandeja y el menú, por `message.new` y por `conversation.updated`), y la vista
previa de cada renglón no usaba el índice de `message`: con decenas de miles de
mensajes la Bandeja tardaba segundos y la base se saturaba.

## Camino verificado

1. Se abre la Bandeja con su número de pruebas.
2. Llegan diez mensajes de diez clientes: la lista los enseña, la insignia del
   menú sube 10 y la pestaña pidió la lista a lo más 6 veces (antes, ~40).
3. En Pipeline llegan cinco más: la insignia sube a 15 con a lo más 4
   peticiones (antes, ~10).
4. De vuelta en la Bandeja hay quince renglones, la insignia sigue en 15 y no
   hay errores de página.
