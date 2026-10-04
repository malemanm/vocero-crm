import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { isValidWebhookToken } from "@/server/inbox/webhook";
import { processYCloudWebhook } from "@/server/ycloud/process";
import {
  ycloudDisabledResponse,
  ycloudEnabled,
} from "@/server/whatsapp/providers-flag";

/**
 * 020 — Webhook público de WhatsApp por YCloud.
 * Capa 1: el segmento [webhookToken] debe coincidir (si no → 404 sin efectos).
 * Capa 2: firma `YCloud-Signature` con el secreto de la organización,
 * obligatoria. Apagado por bandera → 404.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!ycloudEnabled()) return ycloudDisabledResponse();
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, getEnv().META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  const rawBody = await req.text();
  const signature = req.headers.get("ycloud-signature");

  // YCloud pide respuesta en < 6 s: se espera el procesamiento hasta 4 s; si
  // tarda más, sigue en after() y el 200 sale igual.
  const result: {
    verdict: "ok" | "bad_signature" | "ignored";
    failed: boolean;
  } = { verdict: "ignored", failed: false };
  const work = (async () => {
    try {
      result.verdict = await processYCloudWebhook(rawBody, signature);
    } catch (err) {
      result.failed = true;
      console.error("[webhook-yc] error procesando evento:", err);
    }
  })();
  after(() => work);
  await Promise.race([work, new Promise((r) => setTimeout(r, 4_000))]);
  if (result.verdict === "bad_signature") return new Response(null, { status: 401 });
  // Si falló ANTES de responder (BD caída, etc.) se avisa con 500: YCloud
  // reintenta hasta 7 veces y el procesamiento es idempotente. Con 200 el
  // mensaje se perdería para siempre.
  if (result.failed) return new Response(null, { status: 500 });
  return Response.json({ received: true });
}
