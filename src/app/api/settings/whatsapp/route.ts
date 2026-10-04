import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import {
  getCredentialsByOrg,
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { subscribeAppToWaba, testConnection } from "@/server/whatsapp/connect";
import { ycloudEnabled } from "@/server/whatsapp/providers-flag";
import { getYCloudCredentialsByOrg } from "@/server/ycloud/credentials";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  if (!creds) return Response.json({ connection: null });
  return Response.json({
    connection: {
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId,
      displayPhoneNumber: creds.displayPhoneNumber,
      verifiedName: creds.verifiedName,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
  });
});

const putSchema = z.object({
  wabaId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  token: z.string().trim().min(1),
});

/** Guarda la conexión: re-valida contra Meta, cifra y suscribe (FR-040). */
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  // 020: una organización usa Meta o YCloud, no ambos a la vez.
  if (
    ycloudEnabled() &&
    (await getYCloudCredentialsByOrg(session.organizationId))
  ) {
    return apiError(
      409,
      "provider_conflict",
      "Ya hay un número conectado por YCloud. Desconéctalo primero para usar Meta directo."
    );
  }

  const check = await testConnection(body.data.phoneNumberId, body.data.token);
  if (!check.ok) {
    const status = check.code === "meta_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }

  await saveCredentials({
    organizationId: session.organizationId,
    wabaId: body.data.wabaId,
    phoneNumberId: body.data.phoneNumberId,
    token: body.data.token,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  });

  // Best-effort: necesaria en modo directo. Si la WABA ya enruta a un override
  // (backend de agencia o cerebro externo), se respeta: re-suscribir lo borraría.
  await subscribeAppToWaba(body.data.wabaId, body.data.token);

  return Response.json({
    ok: true,
    displayPhoneNumber: check.displayPhoneNumber,
  });
});
