import { describe, expect, it } from "vitest";
import { toYCloudSendBody } from "@/lib/ycloud/send-body";

const FROM = "+5215512345678";

describe("toYCloudSendBody", () => {
  it("texto a teléfono: quita messaging_product y agrega from", () => {
    expect(
      toYCloudSendBody(
        { messaging_product: "whatsapp", to: "5215598765432", type: "text", text: { body: "hola" } },
        FROM
      )
    ).toEqual({
      from: FROM,
      to: "+5215598765432",
      type: "text",
      text: { body: "hola" },
    });
  });

  it("BSUID va en `recipient` y no en `to`", () => {
    const body = toYCloudSendBody(
      { messaging_product: "whatsapp", recipient_type: "individual", recipient: "US.13491208655302741918", type: "text", text: { body: "x" } },
      FROM
    );
    expect(body.recipient).toBe("US.13491208655302741918");
    expect(body).not.toHaveProperty("to");
    expect(body).not.toHaveProperty("recipient_type");
  });

  it("adjunto por media id se conserva", () => {
    const body = toYCloudSendBody(
      { messaging_product: "whatsapp", to: "5215598765432", type: "image", image: { id: "m1", caption: "foto" } },
      FROM
    );
    expect(body.image).toEqual({ id: "m1", caption: "foto" });
  });

  it("plantilla conserva nombre, idioma y parámetros", () => {
    const tpl = { name: "aviso", language: { code: "es_MX" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }] };
    const body = toYCloudSendBody(
      { messaging_product: "whatsapp", to: "5215598765432", type: "template", template: tpl },
      FROM
    );
    expect(body.template).toEqual(tpl);
  });
});
