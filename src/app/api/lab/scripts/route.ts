import { eq } from "drizzle-orm";
import { apiError, withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { isAiConfigured } from "@/lib/env";
import { canConfigure } from "@/lib/auth/roles";
import { PERSONAS, resolvePersonas } from "@/server/lab/personas";
import { generateLabScripts, resetLabScripts } from "@/server/lab/scripts";

export const dynamic = "force-dynamic";
// Una llamada al LLM con el prompt y el conocimiento completos.
export const maxDuration = 120;

/** Lo que dirá cada cliente simulado en la próxima corrida. */
export const GET = withAuth(async (session) => {
  const rows = await getDb()
    .select({ labScripts: schema.agentProfile.labScripts })
    .from(schema.agentProfile)
    .where(eq(schema.agentProfile.organizationId, session.organizationId))
    .limit(1);
  const custom = rows[0]?.labScripts ?? null;
  const personas = resolvePersonas(custom).map((p) => ({
    key: p.key,
    label: p.label,
    description: p.description,
    script: p.script,
    // «Propio» = el guion guardado se está usando (no el de ejemplo).
    custom: p.script !== PERSONAS.find((d) => d.key === p.key)?.script,
  }));
  return Response.json({ personas });
});

/** Reescribe los guiones a partir del prompt y el conocimiento guardados. */
export const POST = withAuth(async (session) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo el dueño o un admin puede cambiar el Laboratorio");
  }
  if (!isAiConfigured()) {
    return apiError(
      409,
      "ai_not_configured",
      "Configura tu proveedor de IA para adaptar las preguntas"
    );
  }
  const result = await generateLabScripts(session.organizationId);
  if (!result.ok) {
    console.error(`[lab] no se pudieron escribir los guiones: ${result.error} — ${result.detail}`);
    return apiError(
      result.error === "no_profile" ? 404 : 502,
      result.error,
      "No se pudieron generar las preguntas; inténtalo de nuevo"
    );
  }
  return Response.json({ ok: true });
});

/** Vuelve a las preguntas de ejemplo. */
export const DELETE = withAuth(async (session) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo el dueño o un admin puede cambiar el Laboratorio");
  }
  await resetLabScripts(session.organizationId);
  return Response.json({ ok: true });
});
