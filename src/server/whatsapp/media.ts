import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isMockEnabled } from "@/lib/env";
import { graphRequest, MetaApiError } from "@/lib/meta/client";
import { getWhatsAppConnection } from "@/server/whatsapp/connection";
import { isForbiddenUploadMime } from "@/server/whatsapp/media-headers";
import type { YCloudCredentials } from "@/server/ycloud/credentials";

/**
 * 008 — Única frontera de media con la Graph API (constitución II: todo el
 * tráfico a Meta pasa por adaptadores dedicados) + persistencia en el volumen
 * local `MEDIA_DIR`. Meta expira sus archivos (~30 días, URLs de minutos):
 * el disco propio es la copia durable que la UI previsualiza.
 */

export type MediaKind = (typeof schema.mediaAsset.$inferSelect)["kind"];

/** Límites de la Cloud API por tipo (validados ANTES de tocar red, FR-007). */
export const MEDIA_LIMITS: Record<
  Exclude<MediaKind, "location" | "contacts">,
  { maxBytes: number; mimes: RegExp; label: string }
> = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    mimes: /^image\/(jpeg|png|webp)$/,
    label: "imagen (jpeg/png/webp, máx. 5 MB)",
  },
  sticker: {
    maxBytes: 100 * 1024,
    mimes: /^image\/webp$/,
    label: "sticker (webp, máx. 100 KB)",
  },
  audio: {
    maxBytes: 16 * 1024 * 1024,
    mimes: /^audio\/(aac|mp4|mpeg|amr|ogg|opus)/,
    label: "audio (aac/mp4/mpeg/amr/ogg, máx. 16 MB)",
  },
  video: {
    maxBytes: 16 * 1024 * 1024,
    mimes: /^video\/(mp4|3gpp)$/,
    label: "video (mp4/3gpp, máx. 16 MB)",
  },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimes: /^[\w.-]+\/[\w.+-]+$/,
    label: "documento (máx. 100 MB)",
  },
};

/** Clasifica un MIME de archivo saliente al tipo de mensaje de la Cloud API. */
export function kindFromMime(mime: string): "image" | "audio" | "video" | "document" {
  if (MEDIA_LIMITS.image.mimes.test(mime)) return "image";
  if (MEDIA_LIMITS.audio.mimes.test(mime)) return "audio";
  if (MEDIA_LIMITS.video.mimes.test(mime)) return "video";
  return "document";
}

export class MediaValidationError extends Error {
  code: "too_large" | "unsupported_type";
  constructor(code: MediaValidationError["code"], message: string) {
    super(message);
    this.name = "MediaValidationError";
    this.code = code;
  }
}

/**
 * Valida MIME y tamaño para envío; devuelve el kind resuelto. Los formatos
 * que WhatsApp no acepta como su tipo nativo (p. ej. image/bmp) van como
 * documento — igual que hace la app de WhatsApp. HTML y SVG no van ni como
 * documento (#78): el navegador de quien los abra los trataría como una
 * página, y se servirían desde el origen del CRM.
 */
export function validateOutgoing(mime: string, sizeBytes: number) {
  if (!/^[\w.-]+\/[\w.+-]+$/.test(mime)) {
    throw new MediaValidationError("unsupported_type", "Tipo de archivo no reconocido");
  }
  if (isForbiddenUploadMime(mime)) {
    throw new MediaValidationError(
      "unsupported_type",
      "Los archivos HTML y SVG no se pueden enviar como adjunto: un navegador los abriría como página. Conviértelo a PDF o a imagen"
    );
  }
  const kind = kindFromMime(mime);
  const limit = MEDIA_LIMITS[kind];
  if (sizeBytes > limit.maxBytes) {
    throw new MediaValidationError(
      "too_large",
      `El archivo excede el límite de ${limit.label}`
    );
  }
  return kind;
}

/* ---------- Almacenamiento (Postgres: Vercel no tiene disco persistente) ---------- */

function assertSafeSegment(s: string): void {
  if (!/^[\w.-]+$/.test(s)) throw new Error(`segmento de ruta inválido: ${s}`);
}

export async function saveMediaFile(
  organizationId: string,
  assetId: string,
  data: Buffer | Uint8Array
): Promise<string> {
  assertSafeSegment(organizationId);
  assertSafeSegment(assetId);
  const buf = Buffer.from(data);
  await getDb()
    .insert(schema.mediaBlob)
    .values({ organizationId, name: assetId, data: buf })
    .onConflictDoUpdate({
      target: [schema.mediaBlob.organizationId, schema.mediaBlob.name],
      set: { data: buf },
    });
  return `${organizationId}/${assetId}`; // referencia persistida en BD
}

export async function readMediaFile(
  organizationId: string,
  assetId: string
): Promise<Buffer> {
  assertSafeSegment(organizationId);
  assertSafeSegment(assetId);
  const rows = await getDb()
    .select({ data: schema.mediaBlob.data })
    .from(schema.mediaBlob)
    .where(
      and(
        eq(schema.mediaBlob.organizationId, organizationId),
        eq(schema.mediaBlob.name, assetId)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw Object.assign(new Error("archivo no encontrado"), { code: "ENOENT" });
  }
  return Buffer.from(row.data);
}

/**
 * 018 — Borra el archivo de un asset. Sin error si ya no estaba: quien lo
 * llama está deshaciendo una copia que sobró, y un archivo que no existe es
 * justo el estado al que quiere llegar.
 */
export async function deleteMediaFile(
  organizationId: string,
  assetId: string
): Promise<void> {
  assertSafeSegment(organizationId);
  assertSafeSegment(assetId);
  await getDb()
    .delete(schema.mediaBlob)
    .where(
      and(
        eq(schema.mediaBlob.organizationId, organizationId),
        eq(schema.mediaBlob.name, assetId)
      )
    );
}

/* ---------- Descarga desde Graph (entrantes y echoes) ---------- */

type GraphMediaMeta = { url?: string; mime_type?: string; file_size?: number };

export class MediaFetchError extends Error {
  /** true si Meta ya no tiene el archivo (expirado/borrado) — no reintentar. */
  gone: boolean;
  constructor(message: string, gone = false) {
    super(message);
    this.name = "MediaFetchError";
    this.gone = gone;
  }
}

/**
 * Descarga un media de Graph: GET {mediaId} → url efímera → GET con Bearer.
 * El token JAMÁS sale del servidor.
 */
export async function downloadGraphMedia(
  token: string,
  waMediaId: string,
  maxBytes: number = MEDIA_LIMITS.document.maxBytes
): Promise<{ data: Buffer; mimeType: string | null; fileSize: number }> {
  let meta: GraphMediaMeta;
  try {
    meta = await graphRequest<GraphMediaMeta>(waMediaId, { token });
  } catch (err) {
    const gone = err instanceof MetaApiError && err.status === 404;
    throw new MediaFetchError("Meta no entregó la metadata del adjunto", gone);
  }
  if (!meta.url) throw new MediaFetchError("Meta no entregó URL del adjunto");
  if (meta.file_size && meta.file_size > maxBytes) {
    throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  }

  let res: Response;
  try {
    res = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new MediaFetchError("No se pudo descargar el adjunto");
  }
  if (!res.ok) {
    throw new MediaFetchError(
      `La descarga devolvió ${res.status}`,
      res.status === 404 || res.status === 410
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  }
  return {
    data: buf,
    mimeType: meta.mime_type ?? res.headers.get("content-type"),
    fileSize: buf.byteLength,
  };
}

/** Host de YCloud: el propio dominio o un subdominio, NUNCA un sufijo suelto. */
function isYCloudHost(host: string): boolean {
  return host === "ycloud.com" || host.endsWith(".ycloud.com");
}

/** Loopback, redes privadas, link-local y nombres internos: no son un adjunto. */
function isPrivateHost(rawHost: string): boolean {
  const h = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }
  if (h.includes(":")) {
    return (
      h === "::1" ||
      h === "::" ||
      /^f[cd]/.test(h) ||
      h.startsWith("fe80") ||
      h.startsWith("::ffff:")
    );
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

const MAX_MEDIA_REDIRECTS = 3;

/**
 * 020 — Descarga un adjunto entrante de YCloud desde la URL que trajo el
 * webhook (guardada en `payload.link`).
 *
 * - La API key solo viaja a `ycloud.com` y sus subdominios, por https, y se
 *   re-evalúa en CADA salto: una redirección a un CDN de terceros se sigue sin
 *   la key (el fetch por defecto la reenviaría).
 * - Una URL que apunta a una red privada se rechaza (SSRF). La excepción es el
 *   loopback del self-test, y solo con los mocks encendidos fuera de producción.
 */
export async function downloadYCloudMedia(
  creds: YCloudCredentials,
  asset: { payload: unknown },
  maxBytes: number = MEDIA_LIMITS.document.maxBytes
): Promise<{ data: Buffer; mimeType: string | null; fileSize: number }> {
  const link = (asset.payload as { link?: string } | null)?.link;
  if (!link) throw new MediaFetchError("YCloud no entregó URL del adjunto");

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new MediaFetchError("La URL del adjunto no es válida");
  }

  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_MEDIA_REDIRECTS; hop++) {
    const loopbackOk =
      isMockEnabled() &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    if (!loopbackOk) {
      if (url.protocol !== "https:") {
        throw new MediaFetchError("La URL del adjunto no es https");
      }
      if (isPrivateHost(url.hostname)) {
        throw new MediaFetchError("La URL del adjunto apunta a una red privada");
      }
    }
    const trusted = url.protocol === "https:" && isYCloudHost(url.hostname);
    try {
      res = await fetch(url, {
        headers: trusted ? { "X-API-Key": creds.apiKey } : {},
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new MediaFetchError("No se pudo descargar el adjunto");
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      try {
        url = new URL(location, url);
      } catch {
        throw new MediaFetchError("Redirección inválida del adjunto");
      }
      res = null;
      continue;
    }
    break;
  }
  if (!res) throw new MediaFetchError("Demasiadas redirecciones al descargar el adjunto");

  if (!res.ok) {
    throw new MediaFetchError(
      `La descarga devolvió ${res.status}`,
      res.status === 404 || res.status === 410
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  }
  return {
    data: buf,
    mimeType: res.headers.get("content-type"),
    fileSize: buf.byteLength,
  };
}

/**
 * Garantiza que el asset esté en disco (`fetchStatus=available`).
 * Se usa en la descarga in-process post-ingesta Y on-demand desde la ruta de
 * media. Nunca lanza hacia el webhook: el que llama decide qué hacer con el
 * resultado. Devuelve el asset actualizado o null si no se pudo.
 */
export async function ensureAssetAvailable(
  organizationId: string,
  assetId: string
): Promise<typeof schema.mediaAsset.$inferSelect | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.id, assetId))
    .limit(1);
  const asset = rows[0];
  if (!asset || asset.organizationId !== organizationId) return null;
  if (asset.fetchStatus === "available") return asset;
  if (!asset.waMediaId) return null; // location/contacts no tienen binario

  const conn = await getWhatsAppConnection(organizationId);
  if (!conn) return null;

  try {
    const { data, mimeType, fileSize } =
      conn.provider === "meta"
        ? await downloadGraphMedia(conn.creds.token, asset.waMediaId)
        : await downloadYCloudMedia(conn.creds, asset);
    const storagePath = await saveMediaFile(organizationId, assetId, data);
    const updated = await db
      .update(schema.mediaAsset)
      .set({
        storagePath,
        mimeType: asset.mimeType ?? mimeType,
        fileSize,
        fetchStatus: "available",
        fetchError: null,
        // La URL de descarga de YCloud ya cumplió: no se conserva.
        payload: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.mediaAsset.id, assetId))
      .returning();
    return updated[0] ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.mediaAsset)
      .set({ fetchStatus: "failed", fetchError: message, updatedAt: new Date() })
      .where(eq(schema.mediaAsset.id, assetId));
    console.warn(`[media] descarga del asset ${assetId} falló: ${message}`);
    return null;
  }
}

// Movido a graph-send.ts (transporte Graph) para no crear un ciclo con connection.ts.
export { uploadGraphMedia } from "@/server/whatsapp/graph-send";
