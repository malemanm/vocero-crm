import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt } from "@/server/ai/prompts";
import { agentActionSchema } from "@/server/ai/actions";

const profile = { id: "agp_1", organizationId: "o", enabled: true, name: "Eva", tone: null, instructions: null, escalationRules: null, greeting: null, createdAt: new Date(), updatedAt: new Date() } as never;
const ctx = { today: "2026-10-09", weekday: "viernes", timezone: "America/Mexico_City", horizonEnd: "2026-10-16" };
const prompt = (agenda: boolean, agendaContext?: typeof ctx) =>
  buildAgentSystemPrompt({ profile, kb: [], stages: [{ name: "Nuevo" }], agenda, agendaContext });

describe("prompt del agente con agenda", () => {
  it("le dice qué día es hoy, en la zona del negocio, y hasta cuándo se agenda", () => {
    const p = prompt(true, ctx);
    expect(p).toContain("Hoy es viernes 2026-10-09");
    expect(p).toContain("America/Mexico_City");
    expect(p).toContain("2026-10-16");
  });
  it("documenta `date` en offer_slots y cómo convertir «el lunes» en una fecha", () => {
    const p = prompt(true, ctx);
    expect(p).toMatch(/"action":"offer_slots","date":"YYYY-MM-DD"/);
    expect(p).toMatch(/el lunes|mañana|pasado mañana/i);
  });
  it("una demo, cita, reunión o videollamada se agenda: NO se escala ni cuenta como fuera del conocimiento", () => {
    const p = prompt(true, ctx);
    expect(p).toMatch(/demo/i);
    expect(p).toMatch(/offer_slots/);
    expect(p).toMatch(/NO escales|no escales/);
  });
  it("le prohíbe mencionar días u horas en la frase de offer_slots: los pone el sistema", () => {
    expect(prompt(true, ctx)).toMatch(/NO menciones (ning[uú]n )?d[ií]a/i);
  });
  it("no arrastra un día viejo ni ofrece horarios cuando solo se nombra un tema", () => {
    const p = prompt(true, ctx);
    expect(p).toMatch(/SU ÚLTIMO mensaje/);
    expect(p).toMatch(/no ofrezcas horarios todav[ií]a/);
    expect(p).toMatch(/para hoy/i);
  });
  it("none solo cuando no hay nada que contestar (con o sin agenda)", () => {
    for (const a of [true, false]) {
      expect(prompt(a, a ? ctx : undefined)).toMatch(/NUNCA uses none/);
    }
  });
  it("sin agenda no hay nada de esto: ni un token", () => {
    const p = prompt(false);
    expect(p).not.toMatch(/offer_slots|Hoy es|demo/i);
  });
});

describe("esquema de acciones", () => {
  it("offer_slots acepta una fecha, la omite o la trae nula", () => {
    const s = agentActionSchema(true);
    expect(s.safeParse({ action: "offer_slots", date: "2026-10-12" }).success).toBe(true);
    expect(s.safeParse({ action: "offer_slots" }).success).toBe(true);
    expect(s.safeParse({ action: "offer_slots", date: null }).success).toBe(true);
    expect(s.safeParse({ action: "offer_slots", date: "2026-10-12", reply: "x" }).success).toBe(true);
  });
  it("sin agenda, offer_slots sigue sin existir", () => {
    expect(agentActionSchema(false).safeParse({ action: "offer_slots", date: "2026-10-12" }).success).toBe(false);
  });
});
