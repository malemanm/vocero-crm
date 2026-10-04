import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { parseBody } from "@/lib/api";
import { ycReset, ycState } from "@/server/dev/ycloud-mock-state";

export const dynamic = "force-dynamic";

const schema = z.object({
  reset: z.boolean().optional(),
  apiKey: z.string().optional(),
  numbers: z.array(z.object({ phoneNumber: z.string(), wabaId: z.string() })).optional(),
  failWebhook: z.boolean().optional(),
  sendFail: z.number().int().nullable().optional(),
  templates: z.array(z.record(z.unknown())).optional(),
});

/** Configura el mock: sembrar números y plantillas, o forzar fallos. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  if (body.data.reset) ycReset();
  const st = ycState();
  const d = body.data;
  if (d.apiKey !== undefined) st.apiKey = d.apiKey;
  if (d.numbers) st.numbers = d.numbers;
  if (d.failWebhook !== undefined) st.failWebhook = d.failWebhook;
  if (d.sendFail !== undefined) st.sendFail = d.sendFail;
  if (d.templates) st.templates = d.templates;
  return Response.json({ ok: true });
}
