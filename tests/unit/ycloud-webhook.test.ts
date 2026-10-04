import { beforeEach, describe, expect, it, vi } from "vitest";
import { signYCloudBody } from "@/server/ycloud/signature";

const getByPhone = vi.fn();
const getByWaba = vi.fn();
const processMessagesForOrg = vi.fn();
const applyStatusUpdate = vi.fn();
const applyTemplateStatusForOrg = vi.fn();

vi.mock("@/server/ycloud/credentials", () => ({
  getYCloudCredentialsByPhone: getByPhone,
  getYCloudCredentialsByWabaId: getByWaba,
}));
vi.mock("@/server/inbox/ingest", () => ({ processMessagesForOrg }));
vi.mock("@/server/inbox/status", () => ({ applyStatusUpdate }));
vi.mock("@/server/whatsapp/templates", () => ({ applyTemplateStatusForOrg }));

const SECRET = "whsec";
const creds = { organizationId: "org_1", phone: "+5215512345678", webhookSecret: SECRET };
const ev = {
  id: "e1",
  type: "whatsapp.inbound_message.received",
  whatsappInboundMessage: {
    id: "y", wamid: "w1", from: "+5215598765432", to: "+5215512345678",
    sendTime: "2026-10-04T12:00:00.000Z", type: "text", text: { body: "hola" },
  },
};
const raw = JSON.stringify(ev);
const now = () => Math.floor(Date.now() / 1000);

beforeEach(() => vi.resetAllMocks());

describe("processYCloudWebhook", () => {
  it("firma válida → ingiere para la organización del número", async () => {
    getByPhone.mockResolvedValue(creds);
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    const r = await processYCloudWebhook(raw, signYCloudBody(raw, SECRET, now()));
    expect(r).toBe("ok");
    expect(processMessagesForOrg).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ messages: expect.any(Array) })
    );
  });
  it("firma inválida → bad_signature y cero efectos", async () => {
    getByPhone.mockResolvedValue(creds);
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    expect(await processYCloudWebhook(raw, "t=1,s=00")).toBe("bad_signature");
    expect(processMessagesForOrg).not.toHaveBeenCalled();
  });
  it("organización sin secreto de webhook → bad_signature (la firma es obligatoria)", async () => {
    getByPhone.mockResolvedValue({ ...creds, webhookSecret: null });
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    expect(await processYCloudWebhook(raw, signYCloudBody(raw, SECRET, now()))).toBe("bad_signature");
    expect(processMessagesForOrg).not.toHaveBeenCalled();
  });
  it("número desconocido → ignored", async () => {
    getByPhone.mockResolvedValue(null);
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    expect(await processYCloudWebhook(raw, "t=1,s=00")).toBe("ignored");
    expect(processMessagesForOrg).not.toHaveBeenCalled();
  });
  it("plantilla: se enruta por WABA y exige firma válida", async () => {
    getByWaba.mockResolvedValue(creds);
    const tpl = JSON.stringify({
      id: "e2", type: "whatsapp.template.reviewed",
      whatsappTemplate: { wabaId: "WABA1", name: "aviso", language: "es_MX", status: "APPROVED" },
    });
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    expect(await processYCloudWebhook(tpl, "t=1,s=00")).toBe("bad_signature");
    expect(applyTemplateStatusForOrg).not.toHaveBeenCalled();
    const ok = await processYCloudWebhook(tpl, signYCloudBody(tpl, SECRET, now()));
    expect(ok).toBe("ok");
    expect(applyTemplateStatusForOrg).toHaveBeenCalledWith("org_1", {
      event: "APPROVED", name: "aviso", language: "es_MX", reason: null,
    });
  });
  it("estado de mensaje: aplica el status para la organización", async () => {
    getByPhone.mockResolvedValue(creds);
    const upd = JSON.stringify({
      id: "e3", type: "whatsapp.message.updated",
      whatsappMessage: { wamid: "w9", status: "delivered", from: "+5215512345678", to: "+5215598765432" },
    });
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    const r = await processYCloudWebhook(upd, signYCloudBody(upd, SECRET, now()));
    expect(r).toBe("ok");
    expect(applyStatusUpdate).toHaveBeenCalledWith(
      "org_1",
      expect.objectContaining({ id: "w9", status: "delivered" })
    );
  });
  it("JSON roto → ignored, sin lanzar", async () => {
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    expect(await processYCloudWebhook("{no", null)).toBe("ignored");
  });
});
