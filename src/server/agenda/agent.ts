import {
  buildCandidateSlots,
  computeAvailability,
} from "@/server/agenda/availability";
import { getSettings } from "@/server/agenda/settings";
import {
  aLoLargoDelDia,
  armarHuecos,
  spreadByDay,
} from "@/server/agenda/spread";
import { addDaysISO, todayInTz, zonedWallClockToUtc } from "@/lib/time/slots";
import { replaceOffers } from "@/server/agenda/offers";
import { BookingError, createSessionBooking } from "@/server/agenda/service";

/**
 * 015 — Lo que el agente incluido puede hacer con la agenda.
 *
 * Vive aquí y no en el pipeline para que el pipeline no aprenda de agendas: el
 * turno pide "ofrece" o "reserva" y recibe el texto que hay que mandar.
 *
 * Regla que atraviesa las dos operaciones: el modelo NO redacta horarios. Pide
 * ofrecer, y el motor pega las etiquetas reales. Si el modelo inventa un
 * instante al reservar, el motor lo rechaza y se re-ofrece — nunca se agenda
 * algo que el cliente no eligió.
 */

/** Cuántos huecos se le enseñan al cliente en un mensaje. */
const SHOWN = 3;
/** Cuántos se guardan como reservables: el catálogo es más ancho que el menú. */
const OFFERED = 12;

export type AgendaTurn = {
  /** Lo que hay que enviarle al cliente. */
  text: string;
  /** false ⇒ el motor no pudo; el turno sigue, sin agendar. */
  ok: boolean;
};

/** Cuántas horas de UN día pedido se le enseñan al cliente (el resto queda reservable). */
const SHOWN_DATE = 6;

const FECHA_REAL = /^\d{4}-\d{2}-\d{2}$/;
function fechaReal(value: string): boolean {
  if (!FECHA_REAL.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** «lunes 12 de octubre» en la zona del negocio, sin «hoy»/«mañana» ni comas. */
function diaEnPalabras(dayISO: string, tz: string): string {
  const instante = zonedWallClockToUtc(dayISO, "12:00", tz) ?? new Date(`${dayISO}T18:00:00Z`);
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(instante)
    .replace(",", "");
}

/**
 * Lo que el modelo necesita saber de HOY para convertir «el lunes» o «mañana»
 * en una fecha: sin esto ni siquiera sabía qué día era. Pura y en la zona del
 * NEGOCIO (a las 23:30 de CDMX ya es mañana en UTC).
 */
export function contextoDeFecha(
  now: Date,
  settings: { timezone: string; maxDaysAhead: number }
): { today: string; weekday: string; timezone: string; horizonEnd: string } {
  const today = todayInTz(now, settings.timezone);
  return {
    today,
    weekday: diaEnPalabras(today, settings.timezone).split(" ")[0] ?? "",
    timezone: settings.timezone,
    horizonEnd: addDaysISO(today, settings.maxDaysAhead),
  };
}

export async function agendaContextoParaPrompt(organizationId: string) {
  return contextoDeFecha(new Date(), await getSettings(organizationId));
}

export async function offerSlots(input: {
  organizationId: string;
  conversationId: string;
  intro?: string;
  /** YYYY-MM-DD en la zona del negocio: el día que pidió el cliente. */
  date?: string | null;
}): Promise<AgendaTurn> {
  const settings = await getSettings(input.organizationId);
  const now = new Date();
  const tz = settings.timezone;
  const date = input.date?.trim() || null;

  // Una fecha que no existe (2026-02-31) no se ofrece a ciegas, pero tampoco se
  // deja pasar la frase del modelo: hablaría de un día que el sistema no usó.
  const fechaInvalida = date !== null && !fechaReal(date);

  if (date !== null && !fechaInvalida) {
    const hoy = todayInTz(now, tz);
    const dentro = date >= hoy && date <= addDaysISO(hoy, settings.maxDaysAhead);
    const delDia = dentro
      ? await computeAvailability(input.organizationId, {
          settings,
          now,
          fromISO: date,
          toISO: date,
        })
      : [];
    const { slots, query } = armarHuecos({
      todos: delDia,
      timezone: tz,
      now,
      maxDaysAhead: settings.maxDaysAhead,
      limit: OFFERED,
      perDay: 3,
      date,
      candidatosDelDia: dentro ? buildCandidateSlots(settings, date, date).length : 0,
    });

    if (query.status === "available") {
      // Todo el día queda reservable; se enseñan unas cuantas repartidas a lo
      // largo de la jornada (no solo las de la mañana).
      await replaceOffers(
        input.organizationId,
        input.conversationId,
        slots.map((s) => ({ startUtc: s.startUtc, label: s.label }))
      );
      const lista = aLoLargoDelDia(slots, SHOWN_DATE)
        .map((s) => `• ${s.time}`)
        .join("\n");
      return {
        ok: true,
        text: `Estos son los horarios disponibles para el ${diaEnPalabras(date, tz)}:\n${lista}`,
      };
    }

    const dia = diaEnPalabras(date, tz);
    const aviso =
      query.status === "closed"
        ? `El ${dia} no abrimos.`
        : query.status === "full"
          ? `Para el ${dia} ya no tengo horarios disponibles.`
          : query.status === "past"
            ? "Esa fecha ya pasó."
            : `Solo puedo agendar hasta el ${diaEnPalabras(query.horizonEnd, tz)}.`;
    return ofrecerLoMasProximo(input, settings, now, aviso);
  }

  return ofrecerLoMasProximo(
    input,
    settings,
    now,
    fechaInvalida
      ? "Tengo estos horarios disponibles:"
      : input.intro?.trim() || "Tengo estos horarios disponibles:",
    true
  );
}

/**
 * El reparto de siempre: los primeros huecos desde hoy, de varios días. Sirve
 * tanto sin fecha como cuando el día pedido no tiene lugar (y entonces `aviso`
 * explica por qué se ofrece otra cosa).
 */
async function ofrecerLoMasProximo(
  input: { organizationId: string; conversationId: string; intro?: string },
  settings: Awaited<ReturnType<typeof getSettings>>,
  now: Date,
  encabezado: string,
  esIntro = false
): Promise<AgendaTurn> {
  const all = await computeAvailability(input.organizationId, {
    settings,
    now,
  });
  const spread = spreadByDay(all, {
    timezone: settings.timezone,
    limit: OFFERED,
    perDay: 3,
    now,
  });

  if (spread.length === 0) {
    // Agenda llena no es un error: es una respuesta que el cliente entiende.
    return {
      ok: false,
      text: esIntro
        ? input.intro?.trim() ||
          "Por ahora no me quedan horarios libres. Déjame confirmarlo con el equipo y te aviso."
        : `${encabezado} Por ahora no me quedan horarios libres. Déjame confirmarlo con el equipo y te aviso.`,
    };
  }

  // Se REGISTRA todo el catálogo, no solo lo que se enseña: si el cliente pide
  // otro día, el agente tiene alternativas legítimas que aceptar.
  await replaceOffers(
    input.organizationId,
    input.conversationId,
    spread.map((s) => ({ startUtc: s.startUtc, label: s.label }))
  );

  const shown = spread.slice(0, SHOWN);
  const lista = shown.map((s) => `• ${s.dayLabel} a las ${s.time}`).join("\n");
  return {
    ok: true,
    text: esIntro
      ? `${encabezado}\n${lista}`
      : `${encabezado} Los más próximos son:\n${lista}`,
  };
}

export async function bookSlot(input: {
  organizationId: string;
  conversationId: string;
  startUtc: string;
  confirmation?: string;
}): Promise<AgendaTurn> {
  try {
    const result = await createSessionBooking({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      startUtc: input.startUtc,
      source: "ai",
      requireOffer: true,
    });

    const base =
      input.confirmation?.trim() || `¡Listo! Te agendé para ${result.label}.`;
    if (result.meetingLink) {
      return { ok: true, text: `${base}\nEnlace: ${result.meetingLink}` };
    }
    if (result.linkPending) {
      // La cita existe; el enlace no. No se promete lo que no se tiene.
      return {
        ok: true,
        text: `${base}\nEn un momento te comparto el enlace por aquí.`,
      };
    }
    return { ok: true, text: base };
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;

    // Se ocupó o el modelo inventó la hora: en ambos casos se re-ofrece con
    // datos reales en vez de discutir con el cliente.
    if (err.slots.length > 0) {
      const lista = err.slots
        .slice(0, SHOWN)
        .map((s) => `• ${s.label}`)
        .join("\n");
      const disculpa =
        err.code === "slot_taken"
          ? "Se me acaba de ocupar ese horario, ¡perdón!"
          : "Déjame confirmarte los horarios que tengo:";
      return { ok: false, text: `${disculpa}\n${lista}` };
    }
    return {
      ok: false,
      text: "No pude agendarlo en este momento. Lo reviso con el equipo y te confirmo.",
    };
  }
}
