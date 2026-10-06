import { describe, expect, it } from "vitest";
import { apiErrorText } from "@/lib/api-error-text";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status });

describe("apiErrorText", () => {
  it("lee el mensaje con la forma que SIEMPRE manda la API: { error: { message } }", async () => {
    const res = json({ error: { code: "meta_error", message: "Todavía no se pueden enviar adjuntos por Messenger; manda el texto" } }, 422);
    expect(await apiErrorText(res)).toBe("Todavía no se pueden enviar adjuntos por Messenger; manda el texto");
  });
  it("acepta también un { message } plano", async () => {
    expect(await apiErrorText(json({ message: "plano" }, 400))).toBe("plano");
  });
  it("sin cuerpo legible cae al código HTTP", async () => {
    expect(await apiErrorText(new Response("<html>", { status: 502 }))).toBe("Error 502");
  });
  it("cuerpo JSON sin mensaje cae al código HTTP", async () => {
    expect(await apiErrorText(json({ error: {} }, 500))).toBe("Error 500");
  });
});
