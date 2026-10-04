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

  const check = await testYCloudConnection(body.data.apiKey, body.data.phone);
  if (!check.ok) {
    const status = check.code === "provider_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }

  const url = webhookUrl();
  const reg = await registerWebhook(body.data.apiKey, url);

  await saveYCloudCredentials({
    organizationId: session.organizationId,
    phone: body.data.phone,
    apiKey: body.data.apiKey,
    wabaId: check.wabaId,
    webhookId: reg.ok ? reg.id : null,
    webhookSecret: reg.ok ? reg.secret : null,
    webhookStatus: reg.ok ? "registered" : "pending",
  });

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
    webhook: reg.ok ? "registered" : "pending",
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
