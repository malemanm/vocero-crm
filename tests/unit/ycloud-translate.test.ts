import { describe, expect, it } from "vitest";
import { translateYCloudEvent } from "@/server/ycloud/translate";

// Fixtures con la forma DOCUMENTADA por YCloud (docs.ycloud.com, webhooks).
// Se confirman contra una cuenta real en la tarea 11 (spec: «Pendiente»).
type Ev = { whatsappInboundMessage: Record<string, unknown> } & Record<string, unknown>;
const inboundText: Ev = {
  id: "evt_1",
  type: "whatsapp.inbound_message.received",
  whatsappInboundMessage: {
    id: "ym_1", wamid: "wamid.AAA", wabaId: "WABA1",
    from: "+5215598765432", to: "+5215512345678",
    sendTime: "2026-10-04T12:00:00.000Z",
    customerProfile: { name: "Ana" },
    type: "text", text: { body: "hola" },
  },
};

describe("translateYCloudEvent · entrantes", () => {
  it("texto → mensaje interno con wamid como id", () => {
    const r = translateYCloudEvent(inboundText);
    expect(r.kind).toBe("inbound");
    if (r.kind !== "inbound") return;
    expect(r.businessPhone).toBe("+5215512345678");
    const m = r.value.messages![0]!;
    expect(m.id).toBe("wamid.AAA");
    expect(m.from).toBe("5215598765432");
    expect(m.type).toBe("text");
    expect(m.text?.body).toBe("hola");
    expect(m.timestamp).toBe(String(Math.floor(Date.parse("2026-10-04T12:00:00.000Z") / 1000)));
    expect(r.value.contacts![0]!.profile?.name).toBe("Ana");
  });

  it("sin teléfono pero con fromUserId → identidad BSUID", () => {
    const ev = structuredClone(inboundText);
    delete ev.whatsappInboundMessage.from;
    ev.whatsappInboundMessage.fromUserId = "US.123";
    const r = translateYCloudEvent(ev);
    if (r.kind !== "inbound") throw new Error("esperaba inbound");
    const m = r.value.messages![0]!;
    expect(m.from).toBeUndefined();
    expect(m.from_user_id).toBe("US.123");
  });

  it("imagen conserva id, mime, caption y link", () => {
    const ev = structuredClone(inboundText);
    ev.whatsappInboundMessage.type = "image";
    delete ev.whatsappInboundMessage.text;
    ev.whatsappInboundMessage.image = { id: "mid1", link: "https://x/y.jpg", mime_type: "image/jpeg", caption: "foto" };
    const r = translateYCloudEvent(ev);
    if (r.kind !== "inbound") throw new Error("esperaba inbound");
    expect(r.value.messages![0]!.image).toMatchObject({ id: "mid1", link: "https://x/y.jpg", mime_type: "image/jpeg", caption: "foto" });
  });

  it("referral de anuncio pasa con la forma de Meta", () => {
    const ev = structuredClone(inboundText);
    ev.whatsappInboundMessage.referral = { source_url: "https://fb.me/ad", source_id: "123", source_type: "ad", headline: "Oferta", ctwa_clid: "CLID" };
    const r = translateYCloudEvent(ev);
    if (r.kind !== "inbound") throw new Error("esperaba inbound");
    expect(r.value.messages![0]!.referral?.ctwa_clid).toBe("CLID");
  });

  it("evento desconocido o basura → ignored, sin lanzar", () => {
    expect(translateYCloudEvent({ type: "otra.cosa" }).kind).toBe("ignored");
    expect(translateYCloudEvent(null).kind).toBe("ignored");
    expect(translateYCloudEvent("x").kind).toBe("ignored");
  });
});

describe("translateYCloudEvent · estados y plantillas", () => {
  const upd = (status: string, extra: object = {}) => ({
    id: "evt_2", type: "whatsapp.message.updated",
    whatsappMessage: { id: "ym_9", wamid: "wamid.OUT", status, from: "+5215512345678", to: "+5215598765432", ...extra },
  });

  it("delivered/read/sent/failed se traducen a statuses", () => {
    for (const s of ["sent", "delivered", "read", "failed"]) {
      const r = translateYCloudEvent(upd(s));
      if (r.kind !== "status") throw new Error("esperaba status");
      expect(r.value.statuses![0]).toMatchObject({ id: "wamid.OUT", status: s });
    }
  });
  it("`accepted` se ignora (aún no salió)", () => {
    expect(translateYCloudEvent(upd("accepted")).kind).toBe("ignored");
  });
  it("failed lleva el motivo", () => {
    const r = translateYCloudEvent(upd("failed", { errorCode: "131047", errorMessage: "Re-engagement" }));
    if (r.kind !== "status") throw new Error("esperaba status");
    expect(r.value.statuses![0]!.errors![0]).toMatchObject({ code: 131047, message: "Re-engagement" });
  });
  it("evento de plantilla", () => {
    const r = translateYCloudEvent({
      id: "evt_3", type: "whatsapp.template.reviewed",
      whatsappTemplate: { wabaId: "WABA1", name: "aviso", language: "es_MX", status: "REJECTED", reason: "INVALID_FORMAT" },
    });
    expect(r).toMatchObject({ kind: "template", name: "aviso", language: "es_MX", event: "REJECTED", reason: "INVALID_FORMAT" });
  });
});
