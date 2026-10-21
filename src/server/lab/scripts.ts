import { eq } from "drizzle-orm";
import { z } from "zod";
import { chatJson } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import { renderKb, buildLabScriptsPrompt } from "@/server/ai/prompts";
import { PERSONAS, SCRIPT_LIMITS } from "@/server/lab/personas";

const scriptSchema = z
  .array(z.string().trim().min(1).max(SCRIPT_LIMITS.maxChars))
  .min(SCRIPT_LIMITS.minLines)
  .max(SCRIPT_LIMITS.maxLines);

const ScriptsOut = z.object({
  guiones: z.object(
    Object.fromEntries(PERSONAS.map((p) => [p.key, scriptSchema])) as Record<
      string,
      typeof scriptSchema
    >
  ),
});

export type GenerateScriptsResult =
  | { ok: true; scripts: Record<string, string[]> }
  | { ok: false; error: "not_configured" | "no_profile" | "provider_error"; detail: string };

/**
 * Escribe, con el mismo LLM del agente, los mensajes que cada cliente simulado
 * le manda A ESTE NEGOCIO (su prompt y su conocimiento), y los guarda. Las
 * seis personas no cambian: solo lo que dicen, para que el juez siga evaluando
 * lo mismo (escalar, no inventar, aguantar modismos).
 */
export async function generateLabScripts(
  organizationId: string
): Promise<GenerateScriptsResult> {
  const db = getDb();
  const profileRows = await db
    .select()
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, organizationId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return { ok: false, error: "no_profile", detail: "Sin perfil" };
  const kb = await db
    .select()
    .from(schema.kbEntry)
    .where(eq(schema.kbEntry.organizationId, organizationId));

  const { system, user } = buildLabScriptsPrompt({
    profile,
    kbText: renderKb(kb),
    personas: PERSONAS.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      ejemplo: p.script,
    })),
    limits: SCRIPT_LIMITS,
  });
  const result = await chatJson(ScriptsOut, [
    { role: "system", content: system },
    { role: "user", content: user },
  ]);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "not_configured" ? "not_configured" : "provider_error",
      detail: result.detail,
    };
  }

  await db
    .update(schema.agentProfile)
    .set({ labScripts: result.data.guiones, updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, organizationId));
  return { ok: true, scripts: result.data.guiones };
}

/** Vuelve a los guiones de ejemplo. */
export async function resetLabScripts(organizationId: string): Promise<void> {
  await getDb()
    .update(schema.agentProfile)
    .set({ labScripts: null, updatedAt: new Date() })
    .where(eq(schema.agentProfile.organizationId, organizationId));
}
