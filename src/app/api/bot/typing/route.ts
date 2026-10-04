import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { getWhatsAppConnection } from "@/server/whatsapp/connection";
import { graphRequest } from "@/lib/meta/client";
import { ycloudRequest } from "@/lib/ycloud/client";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ conversationId: z.string().min(1) });

/**
 * Indicador "escribiendo…" + marcar leído el último inbound.
 * POST /api/bot/typing {conversationId}
 *
 * Best-effort por contrato: al bot JAMÁS le vale reintentar esto — si Meta
 * falla se responde 200 {ok:false} y la conversación sigue. El indicador
 * dura hasta ~25 s o hasta que llegue la respuesta real.
 */
export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const convs = await db
    .select()
    .from(schema.conversation)
    .where(
      and(
        eq(schema.conversation.organizationId, organizationId),
        eq(schema.conversation.id, body.data.conversationId)
      )
    )
    .limit(1);
  const conv = convs[0];
  if (!conv) return apiError(404, "not_found", "Conversación no encontrada");
  if (conv.isTest) {
    // Sandbox: jamás toca la API real (guardrail del Laboratorio).
    return Response.json({ ok: false, reason: "sandbox" });
  }
  if (!conv.aiEnabled || conv.handoffAt) {
    // Handoff/IA pausada: un humano atiende — "escribiendo…" aquí sería
    // mentirle al cliente. Se omite sin tocar Meta.
    return Response.json({ ok: false, reason: "ai_paused" });
  }

  const msgs = await db
    .select({ waMessageId: schema.message.waMessageId })
    .from(schema.message)
    .where(
      and(
        eq(schema.message.organizationId, organizationId),
        eq(schema.message.conversationId, conv.id),
        eq(schema.message.direction, "in"),
        isNotNull(schema.message.waMessageId)
      )
    )
    .orderBy(desc(schema.message.createdAt))
    .limit(1);
  const wamid = msgs[0]?.waMessageId;
  if (!wamid) return Response.json({ ok: false, reason: "no_inbound" });

  const conn = await getWhatsAppConnection(organizationId);
  if (!conn) {
    return apiError(409, "no_connection", "WhatsApp no está conectado");
  }

  if (conn.provider === "ycloud") {
    // 020: YCloud expone «marcar leído»; el indicador «escribiendo…» está
    // pendiente de confirmar con una cuenta real (spec 020), así que degrada
    // sin error: el bot recibe ok y `typing:false`.
    try {
      await ycloudRequest(
        `/whatsapp/inboundMessages/${encodeURIComponent(wamid)}/markAsRead`,
        { method: "POST", apiKey: conn.creds.apiKey }
      );
      return Response.json({ ok: true, typing: false });
    } catch {
      return Response.json({ ok: false, reason: "provider_error" });
    }
  }

  try {
    await graphRequest(`${conn.creds.phoneNumberId}/messages`, {
      method: "POST",
      token: conn.creds.token,
      body: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: wamid,
        typing_indicator: { type: "text" },
      },
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, reason: "meta_error" });
  }
}
