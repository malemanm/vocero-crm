import { z } from "zod";
import { mockGuard } from "@/lib/dev-guard";
import { apiError, parseBody } from "@/lib/api";
import { getEnv } from "@/lib/env";
import { ycNext, ycState } from "@/server/dev/ycloud-mock-state";
import { signYCloudBody } from "@/server/ycloud/signature";

export const dynamic = "force-dynamic";

const schema = z.object({
  kind: z.enum(["inbound", "status", "template"]),
  /** Firmar con un secreto equivocado, para probar el camino infeliz. */
  badSignature: z.boolean().optional(),
  // inbound
  to: z.string().optional(),
  from: z.string().optional(),
  fromUserId: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  wamid: z.string().optional(),
  type: z.string().optional(),
  withImage: z.boolean().optional(),
  referral: z.record(z.unknown()).optional(),
  // status
  status: z.string().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  // template
  wabaId: z.string().optional(),
  templateName: z.string().optional(),
  language: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Construye un evento con la forma de YCloud, lo firma con el secreto del
 * webhook que el CRM registró y lo entrega al webhook público por loopback.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, schema);
  if (!body.ok) return body.response;
  const d = body.data;
  const st = ycState();
  const wh = st.webhooks[st.webhooks.length - 1];
  const secret = d.badSignature ? "secreto-equivocado" : (wh?.secret ?? "sin-webhook");

  let event: unknown;
  if (d.kind === "inbound") {
    const n = ycNext();
    const port = process.env.PORT ?? "3000";
    event = {
      id: `evt_${n}`,
      type: "whatsapp.inbound_message.received",
      whatsappInboundMessage: {
        id: `ymi_${n}`,
        wamid: d.wamid ?? `wamid.YCIN${n}`,
        wabaId: d.wabaId ?? "WABA-YC-E2E",
        ...(d.from ? { from: d.from } : {}),
        ...(d.fromUserId ? { fromUserId: d.fromUserId } : {}),
        to: d.to,
        sendTime: new Date().toISOString(),
        customerProfile: { name: d.name ?? "Cliente YCloud" },
        ...(d.withImage
          ? {
              type: "image",
              image: {
                id: `ycimg_${n}`,
                link: `http://127.0.0.1:${port}/api/dev/ycloud-mock/media-file/${n}`,
                mime_type: "image/png",
                caption: d.text,
              },
            }
          : { type: d.type ?? "text", text: { body: d.text ?? "hola" } }),
        ...(d.referral ? { referral: d.referral } : {}),
      },
    };
  } else if (d.kind === "status") {
    event = {
      id: `evt_${ycNext()}`,
      type: "whatsapp.message.updated",
      whatsappMessage: {
        id: `ymu_${ycNext()}`,
        wamid: d.wamid,
        status: d.status ?? "delivered",
        from: d.from,
        to: d.to,
        ...(d.errorCode ? { errorCode: d.errorCode } : {}),
        ...(d.errorMessage ? { errorMessage: d.errorMessage } : {}),
      },
    };
  } else {
    event = {
      id: `evt_${ycNext()}`,
      type: "whatsapp.template.reviewed",
      whatsappTemplate: {
        wabaId: d.wabaId ?? "WABA-YC-E2E",
        name: d.templateName,
        language: d.language ?? "es_MX",
        status: d.status ?? "APPROVED",
        ...(d.reason ? { reason: d.reason } : {}),
      },
    };
  }

  const raw = JSON.stringify(event);
  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/api/webhooks/yc/${getEnv().META_WEBHOOK_VERIFY_TOKEN}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ycloud-signature": signYCloudBody(raw, secret, Math.floor(Date.now() / 1000)),
    },
    body: raw,
  }).catch(() => null);
  if (!res) return apiError(502, "webhook_error", "No se pudo entregar al webhook");
  return Response.json({ delivered: true, webhookStatus: res.status });
}
