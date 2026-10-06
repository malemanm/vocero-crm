import { describe, expect, it } from "vitest";
import {
  PROFILE_LIMITS,
  profileOverLimits,
  saveErrorMessage,
} from "@/lib/agent-profile-form";

const ok = { name: "Eva", tone: "cercano", instructions: "x", escalationRules: "y", greeting: "hola" };

describe("profileOverLimits", () => {
  it("un perfil dentro de los límites no tiene excesos", () => {
    expect(profileOverLimits(ok)).toEqual([]);
  });
  it("nulos y vacíos cuentan como cero", () => {
    expect(profileOverLimits({ name: "Eva", tone: null, instructions: null, escalationRules: null, greeting: null })).toEqual([]);
  });
  it("justo en el límite pasa; un carácter más no", () => {
    expect(profileOverLimits({ ...ok, instructions: "a".repeat(PROFILE_LIMITS.instructions) })).toEqual([]);
    const r = profileOverLimits({ ...ok, instructions: "a".repeat(PROFILE_LIMITS.instructions + 1) });
    expect(r).toEqual([{ field: "instructions", label: "Instrucciones", length: PROFILE_LIMITS.instructions + 1, max: PROFILE_LIMITS.instructions }]);
  });
  it("avisa de TODOS los campos pasados, no solo del primero", () => {
    const r = profileOverLimits({
      name: "n".repeat(61), tone: "t".repeat(501), instructions: "i", escalationRules: "e".repeat(4001), greeting: "g",
    });
    expect(r.map((x) => x.field)).toEqual(["name", "tone", "escalationRules"]);
  });
  it("los límites son los que impone la API", () => {
    expect(PROFILE_LIMITS).toEqual({ name: 60, tone: 500, instructions: 8000, escalationRules: 4000, greeting: 1000 });
  });
});

describe("saveErrorMessage", () => {
  it("una respuesta buena no es error", async () => {
    expect(await saveErrorMessage(new Response("{}", { status: 200 }))).toBeNull();
  });
  it("devuelve el mensaje que mandó el servidor", async () => {
    const res = new Response(JSON.stringify({ error: { code: "invalid_body", message: "instructions: String must contain at most 8000 character(s)" } }), { status: 422 });
    expect(await saveErrorMessage(res)).toContain("instructions");
  });
  it("sin red (null) lo dice", async () => {
    expect(await saveErrorMessage(null)).toMatch(/conexi[oó]n/i);
  });
  it("un error sin cuerpo legible igual da un mensaje con el código HTTP", async () => {
    expect(await saveErrorMessage(new Response("<html>", { status: 500 }))).toContain("500");
  });
  it("401 (sesión vencida) lo dice claro", async () => {
    expect(await saveErrorMessage(new Response("{}", { status: 401 }))).toMatch(/sesi[oó]n/i);
  });
});
