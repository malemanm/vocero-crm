import { CHANNEL_LABEL, type Channel } from "@/lib/channels";
import { plainSocialText } from "@/lib/social-text";

/**
 * 014 — Capacidades declaradas por canal.
 *
 * El núcleo NO debe saber las reglas de WhatsApp: debe preguntarlas. Antes,
 * la ventana de 24 h y el "usa una plantilla aprobada" vivían incrustados en
 * el camino genérico de envío, así que cada canal nuevo tenía que pelearse con
 * suposiciones que no eran suyas — Instagram no tiene plantillas, y su salida
 * fuera de ventana es una etiqueta.
 *
 * Agregar un canal debería ser: escribir su adaptador y declarar aquí lo que
 * puede y no puede hacer.
 */

export type OutsideWindowStrategy =
  /** Solo se puede reabrir con una plantilla aprobada (WhatsApp). */
  | "template"
  /** Se marca el mensaje como respuesta de agente humano (Instagram). */
  | "human_agent_tag"
  /** No hay forma: fuera de ventana no se envía. */
  | "none";

export type ChannelCapabilities = {
  /** Etiqueta legible, para mensajes de error dirigidos al operador. */
  label: string;
  /** Ventana de servicio en ms desde el último entrante; null = sin ventana. */
  windowMs: number | null;
  /** Qué se puede hacer cuando la ventana está cerrada. */
  outsideWindow: OutsideWindowStrategy;
  /** Límite de texto en BYTES (no caracteres); null = sin límite práctico. */
  maxTextBytes: number | null;
  /** ¿Se pueden mandar adjuntos por este canal hoy? */
  outboundMedia: boolean;
  /**
   * ¿El estado del mensaje avanza por webhook (entregado/leído)? Si no, la
   * aceptación de la plataforma es la confirmación y el mensaje nace `sent`
   * — sin esto se queda con el reloj puesto para siempre.
   */
  deliveryReceipts: boolean;
  /**
   * Cómo se ve el texto de la IA: `whatsapp` dibuja *negrita* y _cursiva_;
   * `plain` (Instagram, Messenger) enseñaría los asteriscos tal cual.
   */
  textFormat: "whatsapp" | "plain";
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const CHANNEL_CAPABILITIES: Record<Channel, ChannelCapabilities> = {
  whatsapp: {
    label: CHANNEL_LABEL.whatsapp,
    windowMs: DAY_MS,
    outsideWindow: "template",
    maxTextBytes: null,
    outboundMedia: true,
    deliveryReceipts: true,
    textFormat: "whatsapp",
  },
  instagram: {
    label: CHANNEL_LABEL.instagram,
    windowMs: DAY_MS,
    outsideWindow: "human_agent_tag",
    // Meta corta en 1000 bytes: con acentos y emojis el margen real es menor
    // de lo que aparenta al contar caracteres.
    maxTextBytes: 1000,
    outboundMedia: false,
    deliveryReceipts: false,
    textFormat: "plain",
  },
  // 017: Messenger comparte la plataforma de mensajería de Meta con Instagram
  // (misma ventana de 24 h, misma etiqueta HUMAN_AGENT fuera de ella, sin
  // plantillas), pero admite textos más largos: 2000 caracteres. Se declara
  // en bytes para no ser más generoso que la plataforma con acentos y emojis.
  messenger: {
    label: CHANNEL_LABEL.messenger,
    windowMs: DAY_MS,
    outsideWindow: "human_agent_tag",
    maxTextBytes: 2000,
    outboundMedia: false,
    deliveryReceipts: false,
    textFormat: "plain",
  },
};

export function capabilitiesFor(channel: Channel): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel] ?? CHANNEL_CAPABILITIES.whatsapp;
}

/** Mensaje para el operador cuando la ventana está cerrada, según el canal. */
export function windowClosedMessage(channel: Channel): string {
  const caps = capabilitiesFor(channel);
  switch (caps.outsideWindow) {
    case "template":
      return "La ventana de 24 horas está cerrada; usa una plantilla aprobada";
    case "human_agent_tag":
      // No se le pide nada al operador: el envío sale etiquetado solo.
      return "";
    case "none":
      return `La ventana de ${caps.label} está cerrada y este canal no permite reabrirla`;
  }
}

/** ¿Este texto cabe en el canal? */
export function textFits(channel: Channel, text: string): boolean {
  const max = capabilitiesFor(channel).maxTextBytes;
  if (max === null) return true;
  return Buffer.byteLength(text, "utf8") <= max;
}

/**
 * El texto tal como debe salir por ese canal. Solo el texto generado por IA se
 * transforma (escribe como si todo fuera WhatsApp); el de una persona sale tal
 * cual lo escribió.
 */
export function outboundTextFor(
  channel: Channel,
  text: string,
  aiGenerated: boolean
): string {
  return aiGenerated && capabilitiesFor(channel).textFormat === "plain"
    ? plainSocialText(text)
    : text;
}
