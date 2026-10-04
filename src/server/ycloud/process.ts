import { applyStatusUpdate } from "@/server/inbox/status";
import { processMessagesForOrg } from "@/server/inbox/ingest";
import { applyTemplateStatusForOrg } from "@/server/whatsapp/templates";
import {
  getYCloudCredentialsByPhone,
  getYCloudCredentialsByWabaId,
} from "@/server/ycloud/credentials";
import { verifyYCloudSignature } from "@/server/ycloud/signature";
import { translateYCloudEvent } from "@/server/ycloud/translate";

/**
 * 020 — Orden deliberado: se lee el JSON SIN confiar en él solo para saber a qué
 * organización pertenece el número; no se procesa nada hasta verificar la firma
 * con el secreto de ESA organización. La firma es obligatoria: sin secreto
 * guardado no hay forma de autenticar al remitente, así que se rechaza.
 */
export async function processYCloudWebhook(
  rawBody: string,
  signatureHeader: string | null
): Promise<"ok" | "bad_signature" | "ignored"> {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return "ignored";
  }
  const parsed = translateYCloudEvent(event);
  if (parsed.kind === "ignored") return "ignored";

  // Mensajes y estados se enrutan por el número del negocio; las plantillas, que
  // llegan a nivel WABA, por el WABA.
  const creds =
    parsed.kind === "template"
      ? parsed.wabaId
        ? await getYCloudCredentialsByWabaId(parsed.wabaId)
        : null
      : await getYCloudCredentialsByPhone(parsed.businessPhone);
  if (!creds) return "ignored";
  if (
    !creds.webhookSecret ||
    !verifyYCloudSignature(rawBody, signatureHeader, creds.webhookSecret)
  ) {
    return "bad_signature";
  }

  if (parsed.kind === "inbound") {
    await processMessagesForOrg(creds.organizationId, parsed.value);
  } else if (parsed.kind === "status") {
    for (const s of parsed.value.statuses ?? []) {
      await applyStatusUpdate(creds.organizationId, s);
    }
  } else if (parsed.kind === "template") {
    await applyTemplateStatusForOrg(creds.organizationId, {
      event: parsed.event,
      name: parsed.name,
      language: parsed.language,
      reason: parsed.reason,
    });
  }
  return "ok";
}
