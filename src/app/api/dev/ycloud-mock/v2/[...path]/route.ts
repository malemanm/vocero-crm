import { mockGuard } from "@/lib/dev-guard";
import { ycNext, ycState } from "@/server/dev/ycloud-mock-state";

export const dynamic = "force-dynamic";

/**
 * 020 — Emula la API de YCloud (`YCLOUD_BASE_URL` apunta aquí en el E2E).
 * Solo existen las rutas que usa Vocero. Exige `X-API-Key` como la real.
 */
type Ctx = { params: Promise<{ path: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const guard = mockGuard();
  if (guard) return guard;
  const st = ycState();
  if (req.headers.get("x-api-key") !== st.apiKey) {
    return Response.json({ error: { code: "UNAUTHORIZED", message: "API key inválida" } }, { status: 401 });
  }
  const { path } = await ctx.params;
  const route = `${req.method} ${path.join("/")}`;

  if (route === "GET whatsapp/phoneNumbers") {
    return Response.json({ items: st.numbers });
  }
  if (route === "POST webhookEndpoints") {
    if (st.failWebhook) {
      return Response.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 });
    }
    const body = (await req.json().catch(() => ({}))) as { url?: string };
    const wh = { id: `wh_mock_${ycNext()}`, url: body.url ?? "", secret: `whsec_mock_${ycNext()}` };
    st.webhooks.push(wh);
    return Response.json({ id: wh.id, url: wh.url, secret: wh.secret, status: "active" });
  }
  if (req.method === "DELETE" && path[0] === "webhookEndpoints" && path[1]) {
    st.webhooks = st.webhooks.filter((w) => w.id !== path[1]);
    return Response.json({ id: path[1], deleted: true });
  }
  if (route === "POST whatsapp/messages/sendDirectly") {
    if (st.sendFail) {
      return Response.json({ error: { code: "MOCK_FAIL", message: "fallo simulado" } }, { status: st.sendFail });
    }
    const body = (await req.json()) as Record<string, unknown>;
    const n = ycNext();
    const wamid = `wamid.YCOUT${n}`;
    st.sent.push({ n, body, wamid, at: new Date().toISOString() });
    return Response.json({
      id: `ym_mock_${n}`, wamid, status: "accepted",
      from: body.from, to: body.to, type: body.type,
    });
  }
  if (req.method === "POST" && path[0] === "whatsapp" && path[1] === "media" && path[3] === "upload") {
    st.uploads += 1;
    return Response.json({ id: `ycmedia_mock_${ycNext()}` });
  }
  if (route === "GET whatsapp/templates") {
    return Response.json({ items: st.templates });
  }
  if (req.method === "POST" && path[0] === "whatsapp" && path[1] === "inboundMessages" && path[3] === "markAsRead") {
    st.markedRead.push(decodeURIComponent(path[2] ?? ""));
    return Response.json({});
  }
  return Response.json({ error: { code: "NOT_FOUND", message: route } }, { status: 404 });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
