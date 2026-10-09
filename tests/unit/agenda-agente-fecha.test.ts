import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El agente incluido ofrecía SIEMPRE los primeros tres huecos desde ahora, pidiera
 * el cliente el día que pidiera: `offer_slots` no llevaba fecha y el modelo, que
 * ni sabía qué día era hoy, escribía su propia frase de entrada («…para el lunes
 * 12:») encima de una lista de HOY viernes. La frase y la lista se contradecían.
 *
 * Ahora `offer_slots` lleva `date` (YYYY-MM-DD, en la zona del negocio) y, cuando
 * viene, la frase la escribe el SISTEMA con el día real: lo que se dice y lo que
 * se lista no pueden diferir.
 */

const TZ = "America/Mexico_City";
// Viernes 9 de octubre de 2026, 07:19 en CDMX (UTC-6).
const AHORA = new Date("2026-10-09T13:19:00.000Z");

const SETTINGS = {
  weeklyHours: {
    mon: [{ start: "09:00", end: "18:00" }],
    fri: [{ start: "09:00", end: "18:00" }],
  },
  slotMinutes: 30,
  bufferMinutes: 0,
  minNoticeHours: 0,
  maxDaysAhead: 14,
  timezone: TZ,
  connector: "enlace-fijo" as const,
  meetingLink: "https://meet.ejemplo.com/sala",
};

type Slot = { startUtc: string; endUtc: string; label: string };
/** Un hueco de 30 min a las `hora` (CDMX, UTC-6) del `dia`. */
function hueco(dia: string, hora: string): Slot {
  const start = new Date(`${dia}T${hora}:00-06:00`);
  return {
    startUtc: start.toISOString(),
    endUtc: new Date(start.getTime() + 30 * 60_000).toISOString(),
    label: `${dia} ${hora}`,
  };
}
const VIERNES = ["10:00", "10:30", "11:00", "11:30", "12:00"].map((h) => hueco("2026-10-09", h));
const LUNES = ["09:00", "10:00", "11:30", "13:00", "16:30", "17:30"].map((h) => hueco("2026-10-12", h));

const computeAvailability = vi.fn();
const replaceOffers = vi.fn();

vi.mock("@/server/agenda/availability", async (original) => ({
  ...(await original<typeof import("@/server/agenda/availability")>()),
  computeAvailability,
}));
vi.mock("@/server/agenda/settings", () => ({ getSettings: async () => SETTINGS }));
vi.mock("@/server/agenda/offers", () => ({ replaceOffers }));
vi.mock("@/server/agenda/service", () => ({
  BookingError: class extends Error {},
  createSessionBooking: vi.fn(),
}));

/** Disponibilidad simulada: con rango de un día devuelve ese día; sin él, el reparto. */
function disponibilidad(porDia: Record<string, Slot[]>) {
  computeAvailability.mockImplementation(
    async (_org: string, o: { fromISO?: string; toISO?: string }) => {
      if (o.fromISO && o.fromISO === o.toISO) return porDia[o.fromISO] ?? [];
      return Object.values(porDia).flat();
    }
  );
}

let offerSlots: typeof import("@/server/agenda/agent").offerSlots;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
  computeAvailability.mockReset();
  replaceOffers.mockReset();
  ({ offerSlots } = await import("@/server/agenda/agent"));
});
afterEach(() => vi.useRealTimers());

const base = { organizationId: "org_1", conversationId: "cv_1" };
const ofrecidos = () =>
  (replaceOffers.mock.calls[0]![2] as { startUtc: string; label: string }[]).map((o) => o.startUtc);

describe("offerSlots con fecha", () => {
  it("el lunes que pidió el cliente: ofrece SOLO horarios de ese lunes", async () => {
    disponibilidad({ "2026-10-09": VIERNES, "2026-10-12": LUNES });
    const r = await offerSlots({ ...base, date: "2026-10-12", intro: "Claro, estos son para el lunes 12:" });
    expect(r.ok).toBe(true);
    expect(ofrecidos()).toEqual(LUNES.map((s) => s.startUtc));
    expect(r.text).not.toMatch(/viernes/i);
    expect(r.text).toMatch(/lunes 12 de octubre/i);
  });

  it("la frase de entrada la escribe el SISTEMA: ignora la del modelo", async () => {
    disponibilidad({ "2026-10-12": LUNES });
    const r = await offerSlots({ ...base, date: "2026-10-12", intro: "FRASE-DEL-MODELO" });
    expect(r.text).not.toContain("FRASE-DEL-MODELO");
    expect(r.text.split("\n")[0]).toMatch(/horarios disponibles para .*lunes 12 de octubre/i);
  });

  it("enseña horas repartidas a lo largo del día, no solo las de la mañana", async () => {
    disponibilidad({ "2026-10-12": LUNES });
    const r = await offerSlots({ ...base, date: "2026-10-12" });
    expect(r.text).toContain("09:00");
    expect(r.text).toContain("17:30");
  });

  it("un día en que el negocio no abre lo dice y ofrece lo más próximo", async () => {
    disponibilidad({ "2026-10-09": VIERNES, "2026-10-12": LUNES });
    const r = await offerSlots({ ...base, date: "2026-10-11", intro: "para el domingo:" });
    expect(r.text).toMatch(/domingo 11 de octubre/i);
    expect(r.text).toMatch(/no abr/i);
    expect(ofrecidos()).toContain(VIERNES[0]!.startUtc);
  });

  it("un día que abre pero ya no tiene lugar lo dice distinto", async () => {
    disponibilidad({ "2026-10-09": VIERNES, "2026-10-12": [] });
    const r = await offerSlots({ ...base, date: "2026-10-12" });
    expect(r.text).toMatch(/lunes 12 de octubre/i);
    expect(r.text).toMatch(/no tengo horarios|ya no tengo|sin lugar|lleno/i);
    expect(r.text).not.toMatch(/no abr/i);
  });

  it("una fecha pasada no se ofrece: se dice y se da lo más próximo", async () => {
    disponibilidad({ "2026-10-09": VIERNES });
    const r = await offerSlots({ ...base, date: "2026-10-08" });
    expect(r.text).toMatch(/ya pas/i);
    expect(ofrecidos()).toContain(VIERNES[0]!.startUtc);
  });

  it("una fecha más allá del límite de la agenda se dice con claridad", async () => {
    disponibilidad({ "2026-10-09": VIERNES });
    const r = await offerSlots({ ...base, date: "2026-12-01" });
    expect(r.text).toMatch(/hasta el/i);
  });

  it("una fecha inventada (2026-02-31) no revienta y NO deja pasar la frase del modelo", async () => {
    disponibilidad({ "2026-10-09": VIERNES });
    const r = await offerSlots({ ...base, date: "2026-02-31", intro: "Claro, para el lunes 12:" });
    expect(r.ok).toBe(true);
    expect(r.text).not.toMatch(/lunes 12/i);
    expect(r.text).toMatch(/horarios disponibles/i);
  });

  it("el día pedido no pisa lo ofrecido antes cuando no encontró nada", async () => {
    // Igual que la API del cerebro externo: preguntar por un domingo cerrado no
    // borra el viernes que se le dio antes... pero aquí SÍ se ofrece lo más próximo,
    // que es lo que se registra.
    disponibilidad({ "2026-10-09": VIERNES });
    await offerSlots({ ...base, date: "2026-10-11" });
    expect(replaceOffers).toHaveBeenCalledTimes(1);
  });
});

describe("offerSlots sin fecha (como siempre)", () => {
  it("respeta la frase del modelo y reparte desde hoy", async () => {
    disponibilidad({ "2026-10-09": VIERNES, "2026-10-12": LUNES });
    const r = await offerSlots({ ...base, intro: "Tengo estos horarios:" });
    expect(r.text.startsWith("Tengo estos horarios:")).toBe(true);
    expect(ofrecidos()[0]).toBe(VIERNES[0]!.startUtc);
  });
  it("sin lugar en ningún día no es un error: es una respuesta", async () => {
    disponibilidad({});
    const r = await offerSlots({ ...base });
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/horarios libres/i);
  });
});

describe("contextoDeFecha · lo que el modelo necesita saber de HOY", () => {
  it("día de la semana, fecha y zona del negocio, y hasta cuándo se puede agendar", async () => {
    const { contextoDeFecha } = await import("@/server/agenda/agent");
    expect(contextoDeFecha(AHORA, { timezone: TZ, maxDaysAhead: 7 })).toEqual({
      today: "2026-10-09",
      weekday: "viernes",
      timezone: TZ,
      horizonEnd: "2026-10-16",
    });
  });
  it("usa la fecha del NEGOCIO, no la del servidor (23:30 en CDMX ya es mañana en UTC)", async () => {
    const { contextoDeFecha } = await import("@/server/agenda/agent");
    const tarde = new Date("2026-10-10T05:30:00.000Z"); // viernes 23:30 CDMX
    expect(contextoDeFecha(tarde, { timezone: TZ, maxDaysAhead: 7 }).today).toBe("2026-10-09");
  });
});
