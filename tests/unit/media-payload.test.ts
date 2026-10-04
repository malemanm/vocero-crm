import { describe, expect, it } from "vitest";
import { serializeMessage } from "@/server/inbox/ingest";

const msg = {
  id: "m1", conversationId: "c1", direction: "in", type: "image", text: null,
  status: "delivered", error: null, aiGenerated: false, origin: null,
  waTimestamp: new Date("2026-10-04T12:00:00Z"), createdAt: new Date("2026-10-04T12:00:00Z"),
} as never;
const asset = (kind: string, payload: unknown) =>
  ({ id: "ma1", kind, mimeType: null, fileName: null, fileSize: null, caption: null, fetchStatus: "pending", payload }) as never;

describe("serializeMessage · el payload de un adjunto", () => {
  it("un adjunto binario NO expone su payload (la URL de descarga es una capacidad)", () => {
    const dto = serializeMessage(msg, asset("image", { link: "https://media.ycloud.com/secreto" }));
    expect(JSON.stringify(dto)).not.toContain("secreto");
    expect(dto.media?.payload ?? null).toBeNull();
  });
  it("ubicación y contactos sí viajan: son el contenido del mensaje", () => {
    const loc = { latitude: 1, longitude: 2 };
    expect(serializeMessage(msg, asset("location", loc)).media?.payload).toEqual(loc);
    expect(serializeMessage(msg, asset("contacts", [{ name: "x" }])).media?.payload).toEqual([{ name: "x" }]);
  });
});
