import { describe, expect, it } from "vitest";
import { PERSONAS, resolvePersonas, isValidScript } from "@/server/lab/personas";
import { buildLabScriptsPrompt, LAB_SCRIPTS_MARKER } from "@/server/ai/prompts";
import type { schema } from "@/lib/db";

const ok3 = ["Hola, ¿tienen ortodoncia?", "¿Cuánto cuesta?", "Gracias"];

describe("resolvePersonas", () => {
  it("sin guiones propios devuelve los de ejemplo", () => {
    expect(resolvePersonas(null)).toEqual(PERSONAS);
    expect(resolvePersonas({})).toEqual(PERSONAS);
  });

  it("aplica el guion propio solo a la persona que lo trae", () => {
    const out = resolvePersonas({ cliente_enojado: ok3 });
    expect(out.find((p) => p.key === "cliente_enojado")?.script).toEqual(ok3);
    expect(out.find((p) => p.key === "pide_humano")?.script).toEqual(
      PERSONAS.find((p) => p.key === "pide_humano")?.script
    );
  });

  it("ignora guiones inválidos (muy cortos, vacíos o de una clave que no existe)", () => {
    const out = resolvePersonas({
      cliente_enojado: ["solo uno"],
      comprador_decidido: ["a", "", "c"],
      inventada: ok3,
    });
    expect(out).toEqual(PERSONAS);
  });

  it("mantiene clave, etiqueta y teléfono: solo cambia lo que dice", () => {
    const [orig] = PERSONAS;
    const [nuevo] = resolvePersonas({ [orig!.key]: ok3 });
    expect({ ...nuevo, script: 0 }).toEqual({ ...orig, script: 0 });
  });
});

describe("isValidScript", () => {
  it("exige entre 3 y 6 mensajes no vacíos de máximo 300 caracteres", () => {
    expect(isValidScript(ok3)).toBe(true);
    expect(isValidScript(ok3.slice(0, 2))).toBe(false);
    expect(isValidScript([...ok3, ...ok3, "x"])).toBe(false);
    expect(isValidScript([...ok3.slice(0, 2), "x".repeat(301)])).toBe(false);
  });
});

describe("buildLabScriptsPrompt", () => {
  const profile = {
    name: "Sofi",
    tone: "cálido",
    instructions: "Vendemos ortodoncia.",
    escalationRules: null,
  } as unknown as typeof schema.agentProfile.$inferSelect;

  it("lleva el prompt del negocio, su conocimiento y las seis claves", () => {
    const { system, user } = buildLabScriptsPrompt({
      profile,
      kbText: "P: ¿Horario?\nR: 9 a 6",
      personas: PERSONAS.map((p) => ({
        key: p.key,
        label: p.label,
        description: p.description,
        ejemplo: p.script,
      })),
      limits: { minLines: 3, maxLines: 6, maxChars: 300 },
    });
    expect(system).toContain(LAB_SCRIPTS_MARKER);
    expect(user).toContain("Vendemos ortodoncia.");
    expect(user).toContain("P: ¿Horario?");
    for (const p of PERSONAS) expect(user).toContain(`${p.key} — `);
  });
});
