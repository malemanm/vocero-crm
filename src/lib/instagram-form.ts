/**
 * Formulario de conexión de Instagram, sin dependencias de React para poder
 * probarlo. Las reglas siguen a la API (`PUT /api/settings/instagram`):
 *
 * - Zernio enruta los mensajes por el `accountId`, así que el ID de Instagram no
 *   hace falta; la API lo exige no vacío y se rellena con el `accountId`.
 * - Con app propia de Meta el webhook trae el IG_ID y se enruta por él: es
 *   obligatorio, y no se manda `accountId`.
 */
export type InstagramSource = "zernio" | "meta";

export type InstagramForm = {
  source: InstagramSource;
  igUserId: string;
  accountRef: string;
  token: string;
  webhookSecret: string;
};

export function canSaveInstagram(f: InstagramForm): boolean {
  if (!f.token.trim()) return false;
  return f.source === "zernio"
    ? f.accountRef.trim().length > 0
    : f.igUserId.trim().length > 0;
}

export function instagramPutBody(f: InstagramForm) {
  const zernio = f.source === "zernio";
  const accountRef = zernio ? f.accountRef.trim() : "";
  return {
    source: f.source,
    igUserId: f.igUserId.trim() || (zernio ? accountRef : ""),
    accountRef: accountRef || null,
    token: f.token.trim(),
    webhookSecret: zernio ? f.webhookSecret.trim() || null : null,
  };
}
