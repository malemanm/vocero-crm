import { describe, expect, it } from "vitest";
import { canSaveInstagram, instagramPutBody } from "@/lib/instagram-form";

const empty = { source: "zernio" as const, igUserId: "", accountRef: "", token: "", webhookSecret: "" };

describe("canSaveInstagram", () => {
  it("Zernio pide accountId y API key (el IG ID no hace falta: Zernio enruta por accountId)", () => {
    expect(canSaveInstagram({ ...empty })).toBe(false);
    expect(canSaveInstagram({ ...empty, accountRef: "acc1", token: "sk_x" })).toBe(true);
    expect(canSaveInstagram({ ...empty, accountRef: "acc1", igUserId: "17841", token: "sk_x" })).toBe(true);
    expect(canSaveInstagram({ ...empty, igUserId: "17841", token: "sk_x" })).toBe(false);
    expect(canSaveInstagram({ ...empty, accountRef: "acc1" })).toBe(false);
  });
  it("Meta pide solo igUserId y token (no accountId)", () => {
    expect(canSaveInstagram({ ...empty, source: "meta", igUserId: "17841", token: "IGQ" })).toBe(true);
    expect(canSaveInstagram({ ...empty, source: "meta", igUserId: "17841" })).toBe(false);
  });
  it("los espacios no cuentan como dato", () => {
    expect(canSaveInstagram({ ...empty, accountRef: "  ", igUserId: " ", token: " " })).toBe(false);
  });
});

describe("instagramPutBody", () => {
  it("recorta espacios y manda null en lo vacío (la API usa nullish)", () => {
    expect(
      instagramPutBody({ source: "zernio", igUserId: " 17841 ", accountRef: " acc1 ", token: " sk_x ", webhookSecret: "" })
    ).toEqual({ source: "zernio", igUserId: "17841", accountRef: "acc1", token: "sk_x", webhookSecret: null });
  });
  it("Zernio sin IG ID: la API lo exige no vacío, así que se usa el accountId", () => {
    expect(
      instagramPutBody({ source: "zernio", igUserId: "", accountRef: "acc1", token: "sk_x", webhookSecret: "" }).igUserId
    ).toBe("acc1");
  });
  it("en modo Meta no manda accountId aunque haya quedado escrito de antes", () => {
    expect(
      instagramPutBody({ source: "meta", igUserId: "17841", accountRef: "restos", token: "IGQ", webhookSecret: "" })
    ).toMatchObject({ source: "meta", accountRef: null });
  });
  it("el secreto del webhook solo viaja en modo Zernio", () => {
    expect(instagramPutBody({ source: "meta", igUserId: "1", accountRef: "", token: "t", webhookSecret: "s" }).webhookSecret).toBeNull();
    expect(instagramPutBody({ source: "zernio", igUserId: "1", accountRef: "a", token: "t", webhookSecret: "s" }).webhookSecret).toBe("s");
  });
});
