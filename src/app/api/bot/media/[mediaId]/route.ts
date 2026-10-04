import { apiError } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { getWhatsAppConnection } from "@/server/whatsapp/connection";
import { downloadGraphMedia, MediaFetchError } from "@/server/whatsapp/media";

export const dynamic = "force-dynamic";

/** Límite para el bot (transcribe audio/imagen; nunca documentos de 100 MB). */
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/**
 * 006 (amendment 002) — Descarga de un adjunto de Meta para el bot.
 * GET /api/bot/media/{mediaId} → binario + content-type.
 *
 * El token de WhatsApp NO sale del CRM: el bot pide aquí, jamás a Meta.
 * Flujo Graph delegado al helper compartido (008): src/server/whatsapp/media.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ mediaId: string }> }
) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  const conn = await getWhatsAppConnection(organizationId);
  if (!conn) {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }
  if (conn.provider === "ycloud") {
    // 020: con YCloud el adjunto llega con su URL en el webhook y Vocero ya lo
    // descargó; no hay un mediaId de Graph que pedir por aquí.
    return apiError(
      501,
      "not_supported_by_provider",
      "Con YCloud este endpoint no está disponible: Vocero ya descargó el adjunto"
    );
  }
  const creds = conn.creds;

  const { mediaId } = await ctx.params;
  if (!/^[\w.-]{1,64}$/.test(mediaId)) {
    return apiError(422, "invalid", "mediaId inválido");
  }

  try {
    const { data, mimeType } = await downloadGraphMedia(
      creds.token,
      mediaId,
      MAX_MEDIA_BYTES
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": mimeType ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof MediaFetchError) {
      if (err.message.includes("límite")) {
        return apiError(413, "too_large", "El adjunto excede el límite de 16 MB");
      }
      return apiError(
        err.gone ? 404 : 502,
        "media_download_failed",
        err.message
      );
    }
    return apiError(502, "media_download_failed", "No se pudo descargar el adjunto");
  }
}
