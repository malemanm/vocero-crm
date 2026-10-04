import { getEnv } from "@/lib/env";
import { YCloudApiError, ycloudRequest } from "@/lib/ycloud/client";
import { normalizePhoneE164 } from "@/server/ycloud/credentials";

type PhoneNumber = { phoneNumber?: string; wabaId?: string };

export type YCloudCheck =
  | { ok: true; wabaId: string | null }
  | {
      ok: false;
      code:
        | "invalid_key"
        | "provider_unavailable"
        | "number_not_found"
        | "provider_error";
      message: string;
    };

/**
 * Valida API key y número contra YCloud SIN persistir nada: la key debe poder
 * listar los números de la cuenta y el número a conectar debe estar entre ellos.
 */
export async function testYCloudConnection(
  apiKey: string,
  phone: string
): Promise<YCloudCheck> {
  try {
    const res = await ycloudRequest<{ items?: PhoneNumber[] } | null>(
      "/whatsapp/phoneNumbers?limit=100",
      { apiKey }
    );
    const wanted = normalizePhoneE164(phone);
    const hit = (res?.items ?? []).find(
      (p) => p.phoneNumber && normalizePhoneE164(p.phoneNumber) === wanted
    );
    if (!hit) {
      return {
        ok: false,
        code: "number_not_found",
        message:
          "Ese número no aparece en tu cuenta de YCloud. Verifica que esté registrado ahí.",
      };
    }
    return { ok: true, wabaId: hit.wabaId ?? null };
  } catch (err) {
    if (err instanceof YCloudApiError) {
      // Al conectar, 403 también es una key sin permisos para listar los números.
      if (err.isAuthError || err.status === 403) {
        return {
          ok: false,
          code: "invalid_key",
          message: "La API key de YCloud no es válida o no tiene permisos.",
        };
      }
      if (err.status === 0 || err.status >= 500) {
        return {
          ok: false,
          code: "provider_unavailable",
          message: "YCloud no está disponible en este momento; intenta de nuevo",
        };
      }
      return { ok: false, code: "provider_error", message: err.message };
    }
    throw err;
  }
}

/** La URL que YCloud debe llamar: lleva el segmento secreto de la instancia. */
export function webhookUrl(): string {
  const env = getEnv();
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/yc/${env.META_WEBHOOK_VERIFY_TOKEN}`;
}

export async function registerWebhook(
  apiKey: string,
  url: string
): Promise<{ ok: true; id: string; secret: string } | { ok: false; message: string }> {
  try {
    const res = await ycloudRequest<{ id?: string; secret?: string } | null>(
      "/webhookEndpoints",
      {
        method: "POST",
        apiKey,
        body: {
          url,
          description: "Vocero CRM",
          status: "active",
          enabledEvents: [
            "whatsapp.inbound_message.received",
            "whatsapp.message.updated",
            "whatsapp.template.reviewed",
          ],
        },
      }
    );
    if (!res?.id || !res.secret) {
      return { ok: false, message: "YCloud no devolvió el secreto del webhook" };
    }
    return { ok: true, id: res.id, secret: res.secret };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "No se pudo registrar el webhook",
    };
  }
}

/** Mejor esfuerzo: borrar el webhook jamás debe impedir desconectar. */
export async function unregisterWebhook(
  apiKey: string,
  webhookId: string
): Promise<void> {
  try {
    await ycloudRequest(`/webhookEndpoints/${encodeURIComponent(webhookId)}`, {
      method: "DELETE",
      apiKey,
    });
  } catch (err) {
    console.warn(
      "[ycloud] no se pudo borrar el webhook (mejor esfuerzo):",
      err instanceof Error ? err.message : err
    );
  }
}
