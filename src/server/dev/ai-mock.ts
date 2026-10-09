import { JUDGE_MARKER } from "@/server/ai/prompts";
import { CABECERA_HUECOS } from "@/server/agenda/offers";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  const text = lastUser.toLowerCase();

  /**
   * 015 — La agenda, ejercitando el camino REAL.
   *
   * El mock reserva copiando el `startUtc` del mapa de huecos, igual que tiene
   * que hacer un modelo de verdad. Si ese mapa deja de llegar, aquí no hay de
   * dónde sacar el instante y la reserva falla — que es exactamente el fallo
   * que se vivió en producción (#50), en vez de un test que lo simula.
   *
   * Se buscan TODOS los mensajes `system`, no solo el primero: el mapa va al
   * final, después del historial.
   */
  const huecos = messages
    .filter((m) => m.role === "system" && m.content.includes(CABECERA_HUECOS))
    .flatMap((m) => m.content.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? []);

  /**
   * Solo ofrece horarios si el prompt le ENSEÑÓ `offer_slots`, como un modelo
   * real. Con la agenda apagada el prompt no la trae (ni el esquema del turno
   * la acepta), y el mock la contestaba igual: la conversación acababa en
   * "Error del proveedor de IA", algo que en producción no pasa (R11).
   */
  const agendaEnseñada = messages.some(
    (m) => m.role === "system" && m.content.includes('"action":"offer_slots"')
  );
  const quiereCita = /cita|agendar|agenda|horario|reserv|demo|videollamada|reuni/.test(text);
  if (agendaEnseñada && quiereCita && huecos.length === 0) {
    // Como un modelo de verdad: convierte «el lunes» / «mañana» en una fecha con
    // el «Hoy es …» que el prompt le enseñó. Sin ese dato no inventa nada.
    const hoy = messages
      .map((m) => (m.role === "system" ? m.content.match(/Hoy es \S+ (\d{4}-\d{2}-\d{2})/) : null))
      .find(Boolean)?.[1];
    const date = hoy ? fechaPedida(text, hoy) : null;
    return JSON.stringify({
      action: "offer_slots",
      ...(date ? { date } : {}),
      // Frase deliberadamente INCOMPATIBLE con cualquier día: si el sistema no
      // escribiera la suya, el self-test lo vería (viernes ≠ lunes).
      reply: "Claro, tengo estos horarios:",
    });
  }
  const eligeUno = /primero|segundo|ese|esa|confirmo|quiero|me sirve/.test(text);
  if (huecos.length > 0 && eligeUno) {
    return JSON.stringify({
      action: "book_slot",
      startUtc: huecos[0],
      reply: "¡Listo! Te agendé.",
    });
  }

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Intención de compra → mover a Interesado.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}

const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

/** La fecha (YYYY-MM-DD) que pide el texto, o null. «el viernes» dicho en viernes es el próximo. */
function fechaPedida(textoMinusculas: string, hoy: string): string | null {
  const t = textoMinusculas.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const base = new Date(`${hoy}T12:00:00Z`);
  const mas = (dias: number) =>
    new Date(base.getTime() + dias * 86_400_000).toISOString().slice(0, 10);
  if (/pasado manana/.test(t)) return mas(2);
  if (/\bmanana\b/.test(t)) return mas(1);
  const idx = DIAS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (idx === -1) return null;
  return mas(((idx - base.getUTCDay() + 6) % 7) + 1);
}
