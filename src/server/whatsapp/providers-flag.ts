/**
 * 020 — Qué proveedores de WhatsApp existen en esta instancia.
 *
 * Mismo patrón que `CHANNELS` y `AGENDA` (ADR-001): el código de YCloud viaja
 * siempre en main; lo que decide si EXISTE para el usuario es una variable de
 * despliegue. Meta no se puede apagar: es la conexión por la que nació el
 * producto. Se lee de `process.env` y no de `getEnv()` para que preguntar si
 * existe no dependa de que TODO el entorno valide.
 */
export type WhatsAppProviderName = "meta" | "ycloud";

const KNOWN: readonly WhatsAppProviderName[] = ["meta", "ycloud"];

export function parseWhatsAppProviders(
  raw: string | undefined
): Set<WhatsAppProviderName> {
  const enabled = new Set<WhatsAppProviderName>(["meta"]);
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if ((KNOWN as readonly string[]).includes(name)) {
      enabled.add(name as WhatsAppProviderName);
    }
  }
  return enabled;
}

export function ycloudEnabled(): boolean {
  return parseWhatsAppProviders(process.env.WHATSAPP_PROVIDERS).has("ycloud");
}

/** 404 y no 403: apagado, ese endpoint no existe en esta instancia. */
export function ycloudDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
