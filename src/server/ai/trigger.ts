import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scheduleAgentTurn, runAgentTurn } from "@/server/ai/pipeline";
import { getEnv, isAiConfigured } from "@/lib/env";

/**
 * Punto de enganche del turno del agente tras la ingesta de un mensaje
 * entrante REAL (las conversaciones del Laboratorio invocan el pipeline
 * directamente, sin debounce).
 *
 * Vercel: no hay proceso que viva entre requests ni mapa de coalesce
 * compartido. El turno corre DENTRO del `after()` del webhook que ingiere el
 * mensaje: espera la ventana de coalesce y solo sigue si ese mensaje sigue
 * siendo el último entrante de la conversación (si llegó otro, el webhook de
 * ese otro se encarga: así se mantiene "una respuesta por ráfaga").
 */
export async function maybeRunAgentTurn(
  conversationId: string,
  messageId?: string
): Promise<void> {
  if (!isAiConfigured()) return;
  if (!process.env.VERCEL) {
    scheduleAgentTurn(conversationId);
    return;
  }
  try {
    await new Promise((r) => setTimeout(r, getEnv().AGENT_COALESCE_MS));
    if (messageId) {
      const last = await getDb()
        .select({ id: schema.message.id })
        .from(schema.message)
        .where(
          and(
            eq(schema.message.conversationId, conversationId),
            eq(schema.message.direction, "in")
          )
        )
        .orderBy(desc(schema.message.createdAt))
        .limit(1);
      if (last[0] && last[0].id !== messageId) return;
    }
    await runAgentTurn(conversationId);
  } catch (err) {
    console.error("[agente] turno falló:", err);
  }
}
