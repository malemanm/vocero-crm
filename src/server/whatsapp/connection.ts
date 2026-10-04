import { callGraphSend, uploadGraphMedia } from "@/server/whatsapp/graph-send";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import {
  getYCloudCredentialsByOrg,
  markYCloudReconnectRequired,
  type YCloudCredentials,
} from "@/server/ycloud/credentials";
import { ycloudEnabled } from "@/server/whatsapp/providers-flag";
import { SendError } from "@/server/whatsapp/send-error";
import { toYCloudSendBody } from "@/lib/ycloud/send-body";
import { YCloudApiError, ycloudRequest } from "@/lib/ycloud/client";

/**
 * 020 — Qué conexión de WhatsApp usa una organización. Meta tiene prioridad;
 * YCloud solo existe si la bandera está encendida (con ella apagada, unas
 * credenciales de YCloud que hayan quedado en la base NO se usan: el envío
 * falla claro como «sin número conectado», no por otro proveedor).
 */
export type WhatsAppConnection =
  | { provider: "meta"; creds: Credentials }
  | { provider: "ycloud"; creds: YCloudCredentials };

export async function getWhatsAppConnection(
  organizationId: string
): Promise<WhatsAppConnection | null> {
  const meta = await getCredentialsByOrg(organizationId);
  if (meta) return { provider: "meta", creds: meta };
  if (!ycloudEnabled()) return null;
  const yc = await getYCloudCredentialsByOrg(organizationId);
  return yc ? { provider: "ycloud", creds: yc } : null;
}

/** WABA de la conexión activa, sea cual sea el proveedor (la CAPI lo necesita). */
export async function wabaIdForOrg(
  organizationId: string
): Promise<string | null> {
  const conn = await getWhatsAppConnection(organizationId);
  return conn?.creds.wabaId ?? null;
}

export async function markConnectionReconnectRequired(
  conn: WhatsAppConnection
): Promise<void> {
  if (conn.provider === "meta") {
    await markReconnectRequired(conn.creds.organizationId);
  } else {
    await markYCloudReconnectRequired(conn.creds.organizationId);
  }
}

async function ycloudSendError(err: unknown, orgId: string): Promise<never> {
  if (err instanceof YCloudApiError) {
    if (err.isAuthError) {
      await markYCloudReconnectRequired(orgId);
      throw new SendError(
        "reconnect_required",
        "La API key de YCloud no es válida o fue revocada: reconecta el número en Configuración"
      );
    }
    if (err.status === 0 || err.status >= 500) {
      throw new SendError("meta_unavailable", "YCloud no está disponible ahora");
    }
    throw new SendError("meta_error", err.message);
  }
  throw err;
}

/** Envía un payload interno (forma Graph) por el proveedor de la conexión. */
export async function sendWhatsAppPayload(
  conn: WhatsAppConnection,
  payload: Record<string, unknown>
): Promise<string> {
  if (conn.provider === "meta") return callGraphSend(conn.creds, payload);
  try {
    const res = await ycloudRequest<{ id?: string; wamid?: string } | null>(
      "/whatsapp/messages/sendDirectly",
      {
        method: "POST",
        apiKey: conn.creds.apiKey,
        body: toYCloudSendBody(payload, conn.creds.phone),
      }
    );
    // Solo el wamid: es el id con el que luego llegan los estados. Guardar el
    // id interno de YCloud dejaría el mensaje "enviado" para siempre.
    if (!res?.wamid) {
      throw new SendError(
        "meta_error",
        "YCloud no devolvió el ID de WhatsApp del mensaje"
      );
    }
    return res.wamid;
  } catch (err) {
    if (err instanceof SendError) throw err;
    return ycloudSendError(err, conn.creds.organizationId);
  }
}

/** Sube un adjunto y devuelve el id de medio para usarlo en el envío. */
export async function uploadWhatsAppMedia(
  conn: WhatsAppConnection,
  file: { data: Buffer | Uint8Array; mimeType: string; fileName?: string }
): Promise<string> {
  if (conn.provider === "meta") return uploadGraphMedia(conn.creds, file);
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
    file.fileName ?? "adjunto"
  );
  try {
    const res = await ycloudRequest<{ id?: string } | null>(
      `/whatsapp/media/${encodeURIComponent(conn.creds.phone)}/upload`,
      { method: "POST", apiKey: conn.creds.apiKey, form, timeoutMs: 60_000 }
    );
    if (!res?.id) {
      throw new SendError("upload_failed", "YCloud no devolvió ID del adjunto");
    }
    return res.id;
  } catch (err) {
    if (err instanceof SendError) throw err;
    return ycloudSendError(err, conn.creds.organizationId);
  }
}
