import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  ycloudDisabledResponse,
  ycloudEnabled,
} from "@/server/whatsapp/providers-flag";
import { getCredentialsByOrg } from "@/server/whatsapp/credentials";
import {
  apiKeyLast4,
  deleteYCloudCredentials,
  getYCloudCredentialsByOrg,
  getYCloudCredentialsByPhone,
  saveYCloudCredentials,
} from "@/server/ycloud/credentials";
import {
  registerWebhook,
  testYCloudConnection,
  unregisterWebhook,
  webhookUrl,
} from "@/server/ycloud/connect";
import { syncTemplates } from "@/server/whatsapp/templates";

export const dynamic = "force-dynamic";

/** 020 — Estado de la conexión de YCloud (la key nunca sale entera). */
export const GET = withAuth(async (session) => {
  if (!ycloudEnabled()) return ycloudDisabledResponse();
  const creds = await getYCloudCredentialsByOrg(session.organizationId);
  return Response.json({
    webhookUrl: webhookUrl(),
    connection: creds
      ? {
          phone: creds.phone,
          wabaId: creds.wabaId,
          status: creds.status,
          webhookStatus: creds.webhookStatus,
          apiKeyLast4: apiKeyLast4(creds.apiKey),
        }
      : null,
  });
});

const putSchema = z.object({
  apiKey: z.string().trim().min(1),
  phone: z.string().trim().min(5),
});

/**
 * Conecta el número: valida la key y el número ANTES de guardar, registra el
 * webhook por API y guarda su secreto cifrado. Si el webhook no se puede
 * registrar, la conexión se guarda igual (`pending`) y se entrega la URL para
 * pegarla a mano: jamás queda a medias.
 */
export const PUT = withAuth(async (session, req: Request) => {
  if (!ycloudEnabled()) return ycloudDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede conectar el número");
  }
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  if (await getCredentialsByOrg(session.organizationId)) {
    return apiError(
      409,
      "provider_conflict",
      "Ya hay un número conectado directo por Meta. Desconéctalo primero para usar YCloud."
    );
  }

  // El número es único en la instancia: otra organización que ya lo tenga
  // haría fallar el guardado DESPUÉS de registrar un webhook en YCloud.
  const owner = await getYCloudCredentialsByPhone(body.data.phone);
  if (owner && owner.organizationId !== session.organizationId) {
    return apiError(
      409,
      "phone_in_use",
      "Ese número ya está conectado en otra organización de esta instancia."
    );
  }

  const check = await testYCloudConnection(body.data.apiKey, body.data.phone);
  if (!check.ok) {
    const status = check.code === "provider_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }

  // Orden deliberado al reconectar: registrar el webhook NUEVO, guardar, y solo
  // entonces borrar el viejo. Si algo falla en medio, el viejo (que funcionaba)
  // sigue en pie y no queda un endpoint huérfano en YCloud.
  const previous = await getYCloudCredentialsByOrg(session.organizationId);
  const url = webhookUrl();
  const reg = await registerWebhook(body.data.apiKey, url);

  // Si el registro falla pero ya había un webhook sano, se conserva.
  const keep =
    !reg.ok && previous?.webhookId && previous.webhookSecret ? previous : null;
  const webhookId = reg.ok ? reg.id : (keep?.webhookId ?? null);
  const webhookSecret = reg.ok ? reg.secret : (keep?.webhookSecret ?? null);
  const webhookStatus: "registered" | "pending" =
    reg.ok || keep ? "registered" : "pending";

  try {
    await saveYCloudCredentials({
      organizationId: session.organizationId,
      phone: body.data.phone,
      apiKey: body.data.apiKey,
      wabaId: check.wabaId,
      webhookId,
      webhookSecret,
      webhookStatus,
    });
  } catch (err) {
    console.error("[ycloud] no se pudo guardar la conexión:", err);
    if (reg.ok) await unregisterWebhook(body.data.apiKey, reg.id);
    return apiError(500, "save_failed", "No se pudo guardar la conexión; intenta de nuevo");
  }

  if (reg.ok && previous?.webhookId) {
    await unregisterWebhook(previous.apiKey, previous.webhookId);
  }

  // Mejor esfuerzo: las plantillas del negocio no condicionan la conexión.
  try {
    await syncTemplates(session.organizationId);
  } catch (err) {
    console.warn(
      "[ycloud] no se pudieron sincronizar las plantillas al conectar:",
      err instanceof Error ? err.message : err
    );
  }

  return Response.json({
    ok: true,
    webhook: webhookStatus,
    webhookUrl: url,
    ...(reg.ok ? {} : { webhookError: reg.message }),
  });
});

const patchSchema = z.object({ webhookSecret: z.string().trim().min(1) });

/** Completa a mano el secreto cuando el webhook no se pudo registrar solo. */
export const PATCH = withAuth(async (session, req: Request) => {
  if (!ycloudEnabled()) return ycloudDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede cambiar la conexión");
  }
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;
  const creds = await getYCloudCredentialsByOrg(session.organizationId);
  if (!creds) return apiError(409, "not_connected", "YCloud no está conectado");
  await saveYCloudCredentials({
    organizationId: session.organizationId,
    phone: creds.phone,
    apiKey: creds.apiKey,
    wabaId: creds.wabaId,
    webhookId: creds.webhookId,
    webhookSecret: body.data.webhookSecret,
    webhookStatus: "registered",
  });
  return Response.json({ ok: true });
});

export const DELETE = withAuth(async (session) => {
  if (!ycloudEnabled()) return ycloudDisabledResponse();
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede desconectar el número");
  }
  const creds = await getYCloudCredentialsByOrg(session.organizationId);
  if (creds?.webhookId) await unregisterWebhook(creds.apiKey, creds.webhookId);
  await deleteYCloudCredentials(session.organizationId);
  return Response.json({ ok: true });
});
