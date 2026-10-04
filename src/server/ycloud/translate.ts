import type {
  WebhookMessage,
  WebhookReferral,
  WebhookValue,
} from "@/server/inbox/webhook";

/**
 * 020 — Eventos de YCloud → formato interno (`WebhookValue`). Puro y tolerante:
 * lo desconocido se ignora, nada lanza. Así la ingesta, el agente y la
 * atribución no saben de qué proveedor llegó el mensaje.
 */
export type YCloudParsed =
  | { kind: "inbound"; businessPhone: string; wabaId: string | null; value: WebhookValue }
  | { kind: "status"; businessPhone: string; value: WebhookValue }
  | { kind: "template"; wabaId: string | null; event: string; name: string; language: string; reason: string | null }
  | { kind: "ignored" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;
const digits = (v: string | undefined): string | undefined => {
  const d = v?.replace(/\D/g, "");
  return d ? d : undefined;
};

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"] as const;
const PASSTHROUGH = new Set<string>([
  "text",
  ...MEDIA_TYPES,
  "location",
  "contacts",
]);

export function translateYCloudEvent(event: unknown): YCloudParsed {
  if (!isObj(event)) return { kind: "ignored" };
  switch (event.type) {
    case "whatsapp.inbound_message.received":
      return inbound(event.whatsappInboundMessage);
    case "whatsapp.message.updated":
      return status(event.whatsappMessage);
    case "whatsapp.template.reviewed":
      return template(event.whatsappTemplate);
    default:
      return { kind: "ignored" };
  }
}

function inbound(raw: unknown): YCloudParsed {
  if (!isObj(raw)) return { kind: "ignored" };
  const type = str(raw.type);
  const id = str(raw.wamid) ?? str(raw.id);
  const businessPhone = str(raw.to);
  if (!type || !id || !businessPhone || !PASSTHROUGH.has(type)) {
    return { kind: "ignored" };
  }
  const sendTime = str(raw.sendTime);
  const ms = sendTime ? Date.parse(sendTime) : NaN;
  const msg: WebhookMessage = {
    id,
    type,
    timestamp: String(
      Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)
    ),
  };
  const from = digits(str(raw.from));
  if (from) msg.from = from;
  const fromUserId = str(raw.fromUserId);
  if (fromUserId) msg.from_user_id = fromUserId;
  if (isObj(raw.text) && typeof raw.text.body === "string") {
    msg.text = { body: raw.text.body };
  }
  for (const k of MEDIA_TYPES) {
    if (isObj(raw[k])) (msg as Record<string, unknown>)[k] = raw[k];
  }
  if (isObj(raw.location)) {
    msg.location = raw.location as WebhookMessage["location"];
  }
  if (Array.isArray(raw.contacts)) msg.contacts = raw.contacts;
  if (isObj(raw.referral)) msg.referral = raw.referral as WebhookReferral;

  const profile = isObj(raw.customerProfile)
    ? str(raw.customerProfile.name)
    : undefined;
  const value: WebhookValue = {
    messaging_product: "whatsapp",
    metadata: {
      display_phone_number: businessPhone,
      phone_number_id: businessPhone,
    },
    contacts: [
      {
        ...(profile ? { profile: { name: profile } } : {}),
        ...(from ? { wa_id: from } : {}),
        ...(fromUserId ? { user_id: fromUserId } : {}),
      },
    ],
    messages: [msg],
  };
  return {
    kind: "inbound",
    businessPhone,
    wabaId: str(raw.wabaId) ?? null,
    value,
  };
}

function status(raw: unknown): YCloudParsed {
  if (!isObj(raw)) return { kind: "ignored" };
  const s = str(raw.status);
  const id = str(raw.wamid) ?? str(raw.id);
  const businessPhone = str(raw.from);
  if (!s || !id || !businessPhone) return { kind: "ignored" };
  if (!["sent", "delivered", "read", "failed"].includes(s)) {
    return { kind: "ignored" }; // `accepted`: aún no salió de YCloud
  }
  const code = Number(str(raw.errorCode));
  const recipient = digits(str(raw.to));
  const st: NonNullable<WebhookValue["statuses"]>[number] = {
    id,
    status: s,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(recipient ? { recipient_id: recipient } : {}),
    ...(s === "failed"
      ? {
          errors: [
            {
              code: Number.isFinite(code) ? code : 0,
              message: str(raw.errorMessage) ?? "Error de entrega",
            },
          ],
        }
      : {}),
  };
  return {
    kind: "status",
    businessPhone,
    value: { messaging_product: "whatsapp", statuses: [st] },
  };
}

function template(raw: unknown): YCloudParsed {
  if (!isObj(raw)) return { kind: "ignored" };
  const name = str(raw.name);
  const language = str(raw.language);
  const event = str(raw.status) ?? str(raw.statusUpdateEvent);
  if (!name || !language || !event) return { kind: "ignored" };
  return {
    kind: "template",
    wabaId: str(raw.wabaId) ?? null,
    event,
    name,
    language,
    reason: str(raw.reason) ?? null,
  };
}
