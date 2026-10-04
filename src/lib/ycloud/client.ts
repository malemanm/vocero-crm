import { getEnv } from "@/lib/env";

/**
 * 020 — Única frontera de salida hacia la API de YCloud (Constitución II).
 * Todo request pasa por ycloudRequest: la API key viaja en `X-API-Key` y
 * jamás sale del servidor. En self-test, YCLOUD_BASE_URL apunta al ycloud-mock.
 */
export class YCloudApiError extends Error {
  status: number;
  code: string | null;
  details: unknown;

  constructor(
    message: string,
    opts: { status: number; code?: string | null; details?: unknown }
  ) {
    super(message);
    this.name = "YCloudApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.details = opts.details;
  }

  /**
   * Key inválida o revocada: SOLO 401. Un 403 puede ser un permiso de una
   * operación o de un destinatario, y tratarlo como key muerta apagaría todo el
   * canal por un envío (mismo criterio que Meta, fix 2026-08-04). Un 5xx nunca
   * cuenta: es el proveedor, no la key.
   */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

export async function ycloudRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE" | "PATCH";
    apiKey: string;
    body?: unknown;
    form?: FormData;
    timeoutMs?: number;
  }
): Promise<T> {
  const base = getEnv().YCLOUD_BASE_URL.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = { "X-API-Key": opts.apiKey };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body:
        opts.form ??
        (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    });
  } catch (cause) {
    throw new YCloudApiError("No se pudo contactar la API de YCloud", {
      status: 0,
      details: cause,
    });
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // no-JSON: se conserva el texto crudo en details si hubo error
  }

  if (!res.ok) {
    const e = json as {
      error?: { code?: string; message?: string };
      code?: string;
      message?: string;
    } | null;
    const message =
      e?.error?.message ?? e?.message ?? `YCloud respondió ${res.status}`;
    throw new YCloudApiError(message, {
      status: res.status,
      code: e?.error?.code ?? e?.code ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}
