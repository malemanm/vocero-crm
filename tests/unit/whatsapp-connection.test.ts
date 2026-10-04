import { beforeEach, describe, expect, it, vi } from "vitest";

const getCredentialsByOrg = vi.fn();
const getYCloudCredentialsByOrg = vi.fn();
const ycloudRequest = vi.fn();
let flag = false;

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg,
  markReconnectRequired: vi.fn(),
}));
vi.mock("@/server/ycloud/credentials", () => ({
  getYCloudCredentialsByOrg,
  markYCloudReconnectRequired: vi.fn(),
}));
vi.mock("@/server/whatsapp/providers-flag", () => ({
  ycloudEnabled: () => flag,
}));
vi.mock("@/lib/ycloud/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ycloud/client")>()),
  ycloudRequest,
}));

const yc = {
  organizationId: "o",
  phone: "+5215512345678",
  apiKey: "K",
  status: "connected",
};

beforeEach(() => {
  vi.resetAllMocks();
  flag = false;
});

describe("getWhatsAppConnection", () => {
  it("Meta tiene prioridad y no consulta YCloud", async () => {
    getCredentialsByOrg.mockResolvedValue({ organizationId: "o", token: "t" });
    const { getWhatsAppConnection } = await import("@/server/whatsapp/connection");
    expect((await getWhatsAppConnection("o"))?.provider).toBe("meta");
    expect(getYCloudCredentialsByOrg).not.toHaveBeenCalled();
  });
  it("con la bandera apagada, credenciales de YCloud NO se usan", async () => {
    getCredentialsByOrg.mockResolvedValue(null);
    getYCloudCredentialsByOrg.mockResolvedValue(yc);
    const { getWhatsAppConnection } = await import("@/server/whatsapp/connection");
    expect(await getWhatsAppConnection("o")).toBeNull();
  });
  it("con la bandera encendida resuelve ycloud", async () => {
    flag = true;
    getCredentialsByOrg.mockResolvedValue(null);
    getYCloudCredentialsByOrg.mockResolvedValue(yc);
    const { getWhatsAppConnection } = await import("@/server/whatsapp/connection");
    expect((await getWhatsAppConnection("o"))?.provider).toBe("ycloud");
  });
});

describe("sendWhatsAppPayload · ycloud", () => {
  const conn = { provider: "ycloud", creds: yc } as never;
  const payload = {
    messaging_product: "whatsapp",
    to: "5215598765432",
    type: "text",
    text: { body: "hi" },
  };

  it("devuelve el wamid y manda el cuerpo traducido", async () => {
    ycloudRequest.mockResolvedValue({ id: "ym", wamid: "wamid.X", status: "accepted" });
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    expect(await sendWhatsAppPayload(conn, payload)).toBe("wamid.X");
    expect(ycloudRequest.mock.calls[0]![0]).toBe("/whatsapp/messages/sendDirectly");
    expect(ycloudRequest.mock.calls[0]![1].body).toMatchObject({
      from: "+5215512345678",
      to: "+5215598765432",
    });
  });
  it("200 sin wamid ni id → SendError meta_error", async () => {
    ycloudRequest.mockResolvedValue({});
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    await expect(sendWhatsAppPayload(conn, payload)).rejects.toMatchObject({
      code: "meta_error",
    });
  });
  it("401 → reconnect_required", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    ycloudRequest.mockRejectedValue(new YCloudApiError("bad", { status: 401 }));
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    await expect(sendWhatsAppPayload(conn, payload)).rejects.toMatchObject({
      code: "reconnect_required",
    });
  });
  it("5xx y red → meta_unavailable", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    for (const status of [0, 503]) {
      ycloudRequest.mockRejectedValue(new YCloudApiError("x", { status }));
      await expect(sendWhatsAppPayload(conn, payload)).rejects.toMatchObject({
        code: "meta_unavailable",
      });
    }
  });
});
