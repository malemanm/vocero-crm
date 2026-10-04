# 020 — WhatsApp por YCloud · Plan de implementación

> **Para quien ejecute:** usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans`. Los pasos usan casillas
> `- [ ]`. Gate técnico de cada tarea: `pnpm typecheck && pnpm lint && pnpm test`.
> Gate final (CLAUDE.md, Definición de Hecho reforzada): además `pnpm build` y
> el E2E de comportamiento con mocks (tarea 10).

**Goal:** que un negocio conecte su número de WhatsApp a Vocero con una API key
de YCloud, con paridad respecto a la conexión directa por Meta.

**Architecture:** YCloud es un proveedor alterno *dentro* del canal WhatsApp.
Un resolvedor `getWhatsAppConnection(org)` devuelve `meta` o `ycloud`; el envío
sale por un único punto (`sendWhatsAppPayload`) que, para YCloud, traduce el
payload interno (forma Graph) al cuerpo de `sendDirectly`. El webhook de YCloud
se traduce al formato interno (`WebhookValue`) y entra por la misma ingesta.
Todo tras la bandera `WHATSAPP_PROVIDERS` (default `meta`), migración siempre
aplicada, superficie en 404 si está apagada (ADR-001).

**Tech Stack:** Next.js 15 (App Router), TypeScript estricto
(`noUncheckedIndexedAccess`), Drizzle + Postgres, Zod, Vitest, AES-256-GCM
(`lib/crypto`).

**Spec:** [spec.md](./spec.md)

## Global Constraints

- Constitución II (1.4.0): conector opcional, apagado por defecto, tras
  adaptador, credenciales cifradas, su fallo jamás bloquea la operación core.
- `organization_id` NOT NULL en toda tabla de dominio; toda query por
  `scoped()` (`src/lib/db/tenant.ts`).
- Secretos cifrados con `encryptSecret`/`decryptSecret`; hacia fuera solo los
  últimos 4; nunca a logs ni al cliente.
- Webhook: responder 200 en < 6 s y procesar en `after()`; idempotente por
  `wamid` (UNIQUE `message.wa_message_id`); estados monotónicos.
- Firma `YCloud-Signature: t=<ts>,s=<hex>` = HMAC-SHA256 de `<ts>.<cuerpo
  crudo>`, comparación en tiempo constante, tolerancia 5 min, **obligatoria**.
- Sandbox: las conversaciones `is_test` jamás llegan a YCloud (el sender lanza;
  no se «arregla»).
- Base de la API: `https://api.ycloud.com/v2`, header `X-API-Key`. En el
  self-test se sobreescribe con `YCLOUD_BASE_URL` → `ycloud-mock`.
- Nunca asumir que un contacto tiene teléfono (BSUID, `bsuid:<id>`).
- Mensajes de UI y de error en español.
- Commits al final de cada tarea, con las líneas de atribución del proyecto.

## Review Focus

1. **Firma**: timestamp fuera de ventana, cuerpo alterado un byte, header
   ausente o mal formado → 401 y *cero* efectos.
2. **Evento sin teléfono**: `from` ausente y solo `fromUserId` → entra como
   contacto `bsuid:`; sin ninguna de las dos → se descarta sin reventar.
3. **Reintento duplicado**: YCloud reenvía el mismo evento (hasta 7 veces) →
   un solo mensaje y un solo avance de estado.
4. **Respuesta rara de YCloud**: 200 sin `wamid`, cuerpo no-JSON, 5xx o timeout
   → `SendError` con código estable, mensaje `failed` visible, nunca excepción
   sin tipar.
5. **Credenciales huérfanas / bandera apagada**: webhook para un número que no
   es de ninguna organización → 200 sin efectos; instancia con credenciales de
   YCloud pero bandera apagada → el envío falla claro, no usa Meta por error.

---

## Mapa de archivos

| Archivo | Responsabilidad |
|---|---|
| `src/server/whatsapp/providers-flag.ts` (nuevo) | Bandera `WHATSAPP_PROVIDERS`, respuesta 404 |
| `src/lib/db/schema.ts` · `drizzle/0016_*.sql` | Tabla `ycloud_credentials` |
| `src/lib/db/ids.ts` | Prefijo `ycCredentials` |
| `src/server/ycloud/credentials.ts` (nuevo) | CRUD cifrado de credenciales |
| `src/lib/ycloud/client.ts` (nuevo) | Único punto de salida a la API de YCloud |
| `src/lib/ycloud/send-body.ts` (nuevo) | Payload interno (Graph) → cuerpo de `sendDirectly` |
| `src/server/ycloud/signature.ts` (nuevo) | Verificación de `YCloud-Signature` |
| `src/server/ycloud/translate.ts` (nuevo) | Evento de YCloud → `WebhookValue` interno |
| `src/server/whatsapp/connection.ts` (nuevo) | Resolvedor de proveedor + envío/subida unificados |
| `src/server/inbox/send.ts`, `whatsapp/templates.ts`, `whatsapp/media.ts`, `api/bot/typing` | Usan `connection.ts` en vez de Graph directo |
| `src/server/inbox/ingest.ts` | `processMessagesForOrg` / `processEchoesForOrg` separados del enrutamiento |
| `src/app/api/webhooks/yc/[webhookToken]/route.ts` (nuevo) | Webhook |
| `src/app/api/settings/ycloud/route.ts` (nuevo) | Conectar / estado / desconectar + webhook automático |
| `src/components/settings/ycloud-client.tsx`, `src/app/(app)/settings/ycloud/page.tsx` (nuevos), `settings-nav.tsx`, `settings/layout.tsx` | UI tras la bandera |
| `src/app/api/dev/ycloud-mock/**` (nuevo) | Mock de la API y simulador de entrantes firmados |
| `scripts/e2e-ycloud.mjs` (nuevo) | E2E de comportamiento |

---

### Task 1: Bandera `WHATSAPP_PROVIDERS`

**Files:**
- Create: `src/server/whatsapp/providers-flag.ts`
- Modify: `src/lib/env.ts` (esquema), `.env.example`
- Test: `tests/unit/providers-flag.test.ts`

**Interfaces:**
- Produces: `parseWhatsAppProviders(raw: string | undefined): Set<"meta" | "ycloud">`, `ycloudEnabled(): boolean`, `ycloudDisabledResponse(): Response`.

- [ ] **Step 1: Test que falla**

```ts
// tests/unit/providers-flag.test.ts
import { describe, expect, it } from "vitest";
import { parseWhatsAppProviders } from "@/server/whatsapp/providers-flag";

describe("parseWhatsAppProviders", () => {
  it("sin variable, solo meta", () => {
    expect([...parseWhatsAppProviders(undefined)]).toEqual(["meta"]);
    expect([...parseWhatsAppProviders("")]).toEqual(["meta"]);
  });
  it("meta está siempre encendido, aunque no se liste", () => {
    expect(parseWhatsAppProviders("ycloud").has("meta")).toBe(true);
  });
  it("enciende ycloud con espacios y mayúsculas", () => {
    expect(parseWhatsAppProviders(" Meta , YCloud ").has("ycloud")).toBe(true);
  });
  it("un typo no enciende nada", () => {
    expect(parseWhatsAppProviders("ycloudd").has("ycloud")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver el fallo**

Run: `pnpm exec vitest run tests/unit/providers-flag.test.ts`
Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar**

```ts
// src/server/whatsapp/providers-flag.ts
/**
 * 020 — Qué proveedores de WhatsApp existen en esta instancia.
 *
 * Mismo patrón que `CHANNELS` y `AGENDA` (ADR-001): el código de YCloud viaja
 * siempre en main; lo que decide si EXISTE para el usuario es una variable de
 * despliegue. Meta no se puede apagar: es la conexión por la que nació el
 * producto. Se lee de `process.env` y no de `getEnv()` para que preguntar si
 * existe no dependa de que TODO el entorno valide.
 */
export type WhatsAppProviderName = "meta" | "ycloud";

const KNOWN: readonly WhatsAppProviderName[] = ["meta", "ycloud"];

export function parseWhatsAppProviders(
  raw: string | undefined
): Set<WhatsAppProviderName> {
  const enabled = new Set<WhatsAppProviderName>(["meta"]);
  for (const part of (raw ?? "").split(",")) {
    const name = part.trim().toLowerCase();
    if ((KNOWN as readonly string[]).includes(name)) {
      enabled.add(name as WhatsAppProviderName);
    }
  }
  return enabled;
}

export function ycloudEnabled(): boolean {
  return parseWhatsAppProviders(process.env.WHATSAPP_PROVIDERS).has("ycloud");
}

/** 404 y no 403: apagado, ese endpoint no existe en esta instancia. */
export function ycloudDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}
```

En `src/lib/env.ts`, dentro de `envSchema`, junto a `AGENDA`:

```ts
  // 020: proveedores de WhatsApp encendidos, separados por coma. Meta siempre
  // está on. Ej.: WHATSAPP_PROVIDERS=meta,ycloud. Sin ella, YCloud no existe
  // (su pantalla, su webhook y sus rutas responden 404).
  WHATSAPP_PROVIDERS: z.string().optional(),
  // 020: base de la API de YCloud. Solo se sobreescribe para apuntar al mock
  // en el self-test; en producción se usa la real.
  YCLOUD_BASE_URL: z.string().url().default("https://api.ycloud.com/v2"),
```

En `.env.example` (junto a `AGENDA`), con guía inline:

```bash
# --- WhatsApp por YCloud (opcional) ---
# Enciende YCloud como forma de conectar el número, además de Meta directo.
# La API key de YCloud NO va aquí: se pega en Configuración → YCloud.
# WHATSAPP_PROVIDERS=meta,ycloud
```

- [ ] **Step 4: Verde**

Run: `pnpm exec vitest run tests/unit/providers-flag.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(ycloud): bandera WHATSAPP_PROVIDERS`

---

### Task 2: Credenciales de YCloud (esquema, migración, módulo)

**Files:**
- Modify: `src/lib/db/schema.ts`, `src/lib/db/ids.ts`
- Create: `drizzle/0016_ycloud_credentials.sql` (generado), `src/server/ycloud/credentials.ts`
- Test: `tests/unit/ycloud-credentials.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type YCloudCredentials = {
    id: string; organizationId: string;
    phone: string;            // E.164 con "+", ej. "+5215512345678"
    wabaId: string | null;
    webhookId: string | null;
    webhookStatus: "registered" | "pending";
    status: "connected" | "reconnect_required";
    apiKey: string;           // descifrada
    webhookSecret: string | null; // descifrado
  };
  getYCloudCredentialsByOrg(orgId: string): Promise<YCloudCredentials | null>
  getYCloudCredentialsByPhone(phone: string): Promise<YCloudCredentials | null>
  getYCloudCredentialsByWabaId(wabaId: string): Promise<YCloudCredentials | null>
  saveYCloudCredentials(i: { organizationId; phone; apiKey; wabaId?; webhookId?; webhookSecret?; webhookStatus }): Promise<void>
  markYCloudReconnectRequired(orgId: string): Promise<void>
  deleteYCloudCredentials(orgId: string): Promise<void>
  apiKeyLast4(key: string): string
  normalizePhoneE164(raw: string): string
  ```

- [ ] **Step 1: Test que falla** — copiar el patrón de `tests/unit/credentials.test.ts`
  (mock de `@/lib/db`, `process.env` de prueba en `beforeAll`):

```ts
// tests/unit/ycloud-credentials.test.ts
import { beforeAll, describe, expect, it, vi } from "vitest";

const insertedRows: Record<string, unknown>[] = [];
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedRows.push(v);
        return { onConflictDoUpdate: () => Promise.resolve() };
      },
    }),
  }),
  schema: { ycloudCredentials: { organizationId: "organization_id" } },
}));

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});

describe("credenciales de YCloud", () => {
  it("cifra la API key y el secreto: la fila no trae texto plano", async () => {
    const { saveYCloudCredentials } = await import("@/server/ycloud/credentials");
    await saveYCloudCredentials({
      organizationId: "org_1",
      phone: "+5215512345678",
      apiKey: "yc-key-secreta-9999",
      webhookSecret: "whsec-secreto-abc",
      webhookStatus: "registered",
    });
    const row = insertedRows[0]!;
    const s = JSON.stringify(row);
    expect(s).not.toContain("yc-key-secreta-9999");
    expect(s).not.toContain("whsec-secreto-abc");
    expect(row.apiKeyCipher).toBeTruthy();
    expect(row.webhookSecretCipher).toBeTruthy();
  });

  it("apiKeyLast4 solo enseña la cola", async () => {
    const { apiKeyLast4 } = await import("@/server/ycloud/credentials");
    expect(apiKeyLast4("yc-key-secreta-9999")).toBe("9999");
  });

  it("normalizePhoneE164 deja `+` y solo dígitos", async () => {
    const { normalizePhoneE164 } = await import("@/server/ycloud/credentials");
    expect(normalizePhoneE164("+52 1 55 1234 5678")).toBe("+5215512345678");
    expect(normalizePhoneE164("5215512345678")).toBe("+5215512345678");
  });
});
```

- [ ] **Step 2: Fallo** — `pnpm exec vitest run tests/unit/ycloud-credentials.test.ts` → FAIL.

- [ ] **Step 3: Esquema** (`schema.ts`, después de `metaCredentials`):

```ts
/**
 * 020 — Credenciales de WhatsApp por YCloud. Alterna con `meta_credentials`
 * (una organización usa una u otra; la exclusividad la impone la API de
 * ajustes). La API key y el secreto del webhook se cifran como el token de Meta.
 */
export const ycloudCredentials = pgTable(
  "ycloud_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Número del negocio en E.164 con «+»; el webhook enruta por él. */
    phone: text("phone").notNull(),
    wabaId: text("waba_id"),
    webhookId: text("webhook_id"),
    webhookStatus: text("webhook_status", { enum: ["registered", "pending"] })
      .notNull()
      .default("pending"),
    apiKeyCipher: text("api_key_cipher").notNull(),
    apiKeyIv: text("api_key_iv").notNull(),
    apiKeyTag: text("api_key_tag").notNull(),
    webhookSecretCipher: text("webhook_secret_cipher"),
    webhookSecretIv: text("webhook_secret_iv"),
    webhookSecretTag: text("webhook_secret_tag"),
    status: text("status", { enum: ["connected", "reconnect_required"] })
      .notNull()
      .default("connected"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ycloud_credentials_org_uq").on(t.organizationId),
    uniqueIndex("ycloud_credentials_phone_uq").on(t.phone),
  ]
);
```

En `ids.ts`, agregar `ycCredentials: "yccred",` junto a `googleCredentials`.

- [ ] **Step 4: Migración**

Run: `DATABASE_URL=postgresql://x:x@localhost/x pnpm db:generate --name=ycloud_credentials`
Verificar que `drizzle/0016_ycloud_credentials.sql` solo contiene
`CREATE TABLE "ycloud_credentials"`, su FK y los dos índices únicos. Agregar al
final del `.sql` (la migración debe dejar RLS activo como el resto):
`ALTER TABLE "ycloud_credentials" ENABLE ROW LEVEL SECURITY;`

- [ ] **Step 5: Módulo** `src/server/ycloud/credentials.ts`

```ts
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { scoped } from "@/lib/db/tenant";

export type YCloudCredentials = {
  id: string;
  organizationId: string;
  phone: string;
  wabaId: string | null;
  webhookId: string | null;
  webhookStatus: "registered" | "pending";
  status: "connected" | "reconnect_required";
  apiKey: string;
  webhookSecret: string | null;
};

type Row = typeof schema.ycloudCredentials.$inferSelect;

function toCredentials(row: Row): YCloudCredentials {
  return {
    id: row.id,
    organizationId: row.organizationId,
    phone: row.phone,
    wabaId: row.wabaId,
    webhookId: row.webhookId,
    webhookStatus: row.webhookStatus,
    status: row.status,
    apiKey: decryptSecret({
      cipher: row.apiKeyCipher,
      iv: row.apiKeyIv,
      tag: row.apiKeyTag,
    }),
    webhookSecret:
      row.webhookSecretCipher && row.webhookSecretIv && row.webhookSecretTag
        ? decryptSecret({
            cipher: row.webhookSecretCipher,
            iv: row.webhookSecretIv,
            tag: row.webhookSecretTag,
          })
        : null,
  };
}

/** `+` y solo dígitos: la forma en que YCloud identifica el número. */
export function normalizePhoneE164(raw: string): string {
  return `+${raw.replace(/\D/g, "")}`;
}

export async function getYCloudCredentialsByOrg(
  organizationId: string
): Promise<YCloudCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.ycloudCredentials)
    .where(scoped(schema.ycloudCredentials.organizationId, organizationId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Enrutamiento del webhook: el número del negocio identifica la organización. */
export async function getYCloudCredentialsByPhone(
  phone: string
): Promise<YCloudCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.ycloudCredentials)
    .where(eq(schema.ycloudCredentials.phone, normalizePhoneE164(phone)))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

/** Eventos a nivel WABA (plantillas): el WABA identifica la organización. */
export async function getYCloudCredentialsByWabaId(
  wabaId: string
): Promise<YCloudCredentials | null> {
  const rows = await getDb()
    .select()
    .from(schema.ycloudCredentials)
    .where(eq(schema.ycloudCredentials.wabaId, wabaId))
    .limit(1);
  return rows[0] ? toCredentials(rows[0]) : null;
}

export async function saveYCloudCredentials(input: {
  organizationId: string;
  phone: string;
  apiKey: string;
  wabaId?: string | null;
  webhookId?: string | null;
  webhookSecret?: string | null;
  webhookStatus: "registered" | "pending";
}): Promise<void> {
  const key = encryptSecret(input.apiKey);
  const secret = input.webhookSecret ? encryptSecret(input.webhookSecret) : null;
  const values = {
    phone: normalizePhoneE164(input.phone),
    wabaId: input.wabaId ?? null,
    webhookId: input.webhookId ?? null,
    webhookStatus: input.webhookStatus,
    apiKeyCipher: key.cipher,
    apiKeyIv: key.iv,
    apiKeyTag: key.tag,
    webhookSecretCipher: secret?.cipher ?? null,
    webhookSecretIv: secret?.iv ?? null,
    webhookSecretTag: secret?.tag ?? null,
    status: "connected" as const,
  };
  await getDb()
    .insert(schema.ycloudCredentials)
    .values({
      id: newId("ycCredentials"),
      organizationId: input.organizationId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [schema.ycloudCredentials.organizationId],
      set: { ...values, updatedAt: new Date() },
    });
}

export async function markYCloudReconnectRequired(
  organizationId: string
): Promise<void> {
  await getDb()
    .update(schema.ycloudCredentials)
    .set({ status: "reconnect_required", updatedAt: new Date() })
    .where(scoped(schema.ycloudCredentials.organizationId, organizationId));
}

export async function deleteYCloudCredentials(
  organizationId: string
): Promise<void> {
  await getDb()
    .delete(schema.ycloudCredentials)
    .where(scoped(schema.ycloudCredentials.organizationId, organizationId));
}

export function apiKeyLast4(key: string): string {
  return key.slice(-4);
}
```

- [ ] **Step 6: Verde** — `pnpm exec vitest run tests/unit/ycloud-credentials.test.ts && pnpm typecheck`
- [ ] **Step 7: Commit** — `feat(ycloud): credenciales cifradas y migración 0016`

---

### Task 3: Cliente de YCloud y traductor de salida

**Files:**
- Create: `src/lib/ycloud/client.ts`, `src/lib/ycloud/send-body.ts`
- Test: `tests/unit/ycloud-client.test.ts`, `tests/unit/ycloud-send-body.test.ts`

**Interfaces:**
- Produces:
  ```ts
  class YCloudApiError extends Error { status: number; code: string | null; details: unknown; get isAuthError(): boolean }
  ycloudRequest<T>(path: string, opts: { method?: "GET"|"POST"|"DELETE"; apiKey: string; body?: unknown; form?: FormData; timeoutMs?: number }): Promise<T>
  toYCloudSendBody(payload: Record<string, unknown>, from: string): Record<string, unknown>
  ```

- [ ] **Step 1: Tests que fallan**

```ts
// tests/unit/ycloud-send-body.test.ts
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
```

```ts
// tests/unit/ycloud-client.test.ts
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  process.env.APP_BASE_URL = "http://localhost:3000";
  process.env.DATABASE_URL = "postgresql://t:t@localhost:5432/t";
  process.env.BETTER_AUTH_SECRET = "secret-de-test-suficiente";
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  process.env.META_WEBHOOK_VERIFY_TOKEN = "verify-test";
});
afterEach(() => vi.unstubAllGlobals());

describe("ycloudRequest", () => {
  it("manda X-API-Key y devuelve el JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    const out = await ycloudRequest<{ id: string }>("/whatsapp/templates", { apiKey: "K" });
    expect(out.id).toBe("x");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.ycloud.com/v2/whatsapp/templates");
    expect((init as RequestInit).headers).toMatchObject({ "X-API-Key": "K" });
  });

  it("401 es error de autenticación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "AUTH", message: "bad key" } }), { status: 401 })));
    const { ycloudRequest, YCloudApiError } = await import("@/lib/ycloud/client");
    const err = await ycloudRequest("/x", { apiKey: "K" }).catch((e) => e);
    expect(err).toBeInstanceOf(YCloudApiError);
    expect(err.isAuthError).toBe(true);
  });

  it("5xx jamás es error de autenticación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 503 })));
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    const err = await ycloudRequest("/x", { apiKey: "K" }).catch((e) => e);
    expect(err.isAuthError).toBe(false);
    expect(err.status).toBe(503);
  });

  it("falla de red → status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    const err = await ycloudRequest("/x", { apiKey: "K" }).catch((e) => e);
    expect(err.status).toBe(0);
  });

  it("cuerpo no-JSON con 200 no revienta: devuelve null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })));
    const { ycloudRequest } = await import("@/lib/ycloud/client");
    expect(await ycloudRequest("/x", { apiKey: "K" })).toBeNull();
  });
});
```

- [ ] **Step 2: Fallo** — `pnpm exec vitest run tests/unit/ycloud-client.test.ts tests/unit/ycloud-send-body.test.ts` → FAIL.

- [ ] **Step 3: Cliente**

```ts
// src/lib/ycloud/client.ts
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

  /** Key inválida o revocada. Un 5xx nunca cuenta: es el proveedor, no la key. */
  get isAuthError(): boolean {
    if (this.status >= 500) return false;
    return this.status === 401 || this.status === 403;
  }
}

export async function ycloudRequest<T>(
  path: string,
  opts: {
    method?: "GET" | "POST" | "DELETE";
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
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
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
    const e = (json as { error?: { code?: string; message?: string }; code?: string; message?: string } | null);
    const message = e?.error?.message ?? e?.message ?? `YCloud respondió ${res.status}`;
    throw new YCloudApiError(message, {
      status: res.status,
      code: e?.error?.code ?? e?.code ?? null,
      details: json ?? text,
    });
  }
  return json as T;
}
```

- [ ] **Step 4: Traductor de salida**

```ts
// src/lib/ycloud/send-body.ts
/**
 * 020 — El payload interno de envío tiene forma Graph (así lo arman send.ts y
 * templates.ts, y así lo consume Meta). YCloud acepta el mismo contrato de
 * mensajes con tres diferencias, que este módulo puro absorbe:
 *   · no lleva `messaging_product`;
 *   · exige `from` (el número del negocio) y los teléfonos en E.164 con «+»;
 *   · un BSUID viaja en `recipient`, sin `to` ni `recipient_type`.
 */
export function toYCloudSendBody(
  payload: Record<string, unknown>,
  from: string
): Record<string, unknown> {
  const {
    messaging_product: _mp,
    recipient_type: _rt,
    to,
    recipient,
    ...rest
  } = payload as Record<string, unknown> & {
    to?: string;
    recipient?: string;
  };
  void _mp;
  void _rt;
  const body: Record<string, unknown> = { from, ...rest };
  if (typeof to === "string" && to) {
    body.to = to.startsWith("+") ? to : `+${to.replace(/\D/g, "")}`;
  } else if (typeof recipient === "string" && recipient) {
    body.recipient = recipient;
  }
  return body;
}
```

- [ ] **Step 5: Verde** — mismo comando del paso 2 → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 6: Commit** — `feat(ycloud): cliente único de la API y traductor de salida`

---

### Task 4: Firma y traductor de eventos entrantes (puros)

**Files:**
- Create: `src/server/ycloud/signature.ts`, `src/server/ycloud/translate.ts`
- Modify: `src/server/inbox/webhook.ts` (agregar `link?: string` a `WebhookMediaPayload`)
- Test: `tests/unit/ycloud-signature.test.ts`, `tests/unit/ycloud-translate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  verifyYCloudSignature(rawBody: string, header: string | null, secret: string, nowSec?: number, toleranceSec?: number): boolean
  signYCloudBody(rawBody: string, secret: string, ts: number): string   // "t=…,s=…" (lo usa el mock y los tests)

  type YCloudParsed =
    | { kind: "inbound"; businessPhone: string; wabaId: string | null; value: WebhookValue }
    | { kind: "status"; businessPhone: string; value: WebhookValue }
    | { kind: "template"; wabaId: string | null; event: string; name: string; language: string; reason: string | null }
    | { kind: "ignored" }
  translateYCloudEvent(event: unknown): YCloudParsed
  ```
  `value.metadata.phone_number_id` se rellena con el teléfono del negocio solo
  por conveniencia de logs; el enrutamiento NO lo usa (tarea 6).

- [ ] **Step 1: Tests que fallan**

```ts
// tests/unit/ycloud-signature.test.ts
import { describe, expect, it } from "vitest";
import { signYCloudBody, verifyYCloudSignature } from "@/server/ycloud/signature";

const SECRET = "whsec_test";
const BODY = '{"id":"evt_1","type":"whatsapp.inbound_message.received"}';
const NOW = 1_800_000_000;

describe("verifyYCloudSignature", () => {
  it("acepta una firma válida y reciente", () => {
    const h = signYCloudBody(BODY, SECRET, NOW);
    expect(verifyYCloudSignature(BODY, h, SECRET, NOW)).toBe(true);
  });
  it("rechaza el cuerpo alterado un byte", () => {
    const h = signYCloudBody(BODY, SECRET, NOW);
    expect(verifyYCloudSignature(BODY + " ", h, SECRET, NOW)).toBe(false);
  });
  it("rechaza otro secreto", () => {
    const h = signYCloudBody(BODY, "otro", NOW);
    expect(verifyYCloudSignature(BODY, h, SECRET, NOW)).toBe(false);
  });
  it("rechaza un timestamp fuera de los 5 minutos", () => {
    const h = signYCloudBody(BODY, SECRET, NOW - 301);
    expect(verifyYCloudSignature(BODY, h, SECRET, NOW)).toBe(false);
  });
  it("rechaza header ausente o mal formado", () => {
    expect(verifyYCloudSignature(BODY, null, SECRET, NOW)).toBe(false);
    expect(verifyYCloudSignature(BODY, "", SECRET, NOW)).toBe(false);
    expect(verifyYCloudSignature(BODY, "basura", SECRET, NOW)).toBe(false);
    expect(verifyYCloudSignature(BODY, "t=abc,s=00", SECRET, NOW)).toBe(false);
  });
});
```

```ts
// tests/unit/ycloud-translate.test.ts
import { describe, expect, it } from "vitest";
import { translateYCloudEvent } from "@/server/ycloud/translate";

// Fixtures con la forma DOCUMENTADA por YCloud (docs.ycloud.com, webhooks).
// Se confirman contra una cuenta real en la tarea 11 (spec: «Pendiente»).
const inboundText = {
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
    const ev = structuredClone(inboundText) as any;
    delete ev.whatsappInboundMessage.from;
    ev.whatsappInboundMessage.fromUserId = "US.123";
    const r = translateYCloudEvent(ev);
    if (r.kind !== "inbound") throw new Error("esperaba inbound");
    const m = r.value.messages![0]!;
    expect(m.from).toBeUndefined();
    expect(m.from_user_id).toBe("US.123");
  });

  it("imagen conserva id, mime, caption y link", () => {
    const ev = structuredClone(inboundText) as any;
    ev.whatsappInboundMessage.type = "image";
    delete ev.whatsappInboundMessage.text;
    ev.whatsappInboundMessage.image = { id: "mid1", link: "https://x/y.jpg", mime_type: "image/jpeg", caption: "foto" };
    const r = translateYCloudEvent(ev);
    if (r.kind !== "inbound") throw new Error("esperaba inbound");
    expect(r.value.messages![0]!.image).toMatchObject({ id: "mid1", link: "https://x/y.jpg", mime_type: "image/jpeg", caption: "foto" });
  });

  it("referral de anuncio pasa con la forma de Meta", () => {
    const ev = structuredClone(inboundText) as any;
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
```

- [ ] **Step 2: Fallo** — `pnpm exec vitest run tests/unit/ycloud-signature.test.ts tests/unit/ycloud-translate.test.ts` → FAIL.

- [ ] **Step 3: Firma**

```ts
// src/server/ycloud/signature.ts
import { createHmac } from "node:crypto";
import { safeEqual } from "@/server/inbox/webhook";

/** `YCloud-Signature: t=<ts>,s=<hex>` — HMAC-SHA256 de `<ts>.<cuerpo crudo>`. */
export function signYCloudBody(rawBody: string, secret: string, ts: number): string {
  const s = createHmac("sha256", secret).update(`${ts}.${rawBody}`, "utf8").digest("hex");
  return `t=${ts},s=${s}`;
}

export function verifyYCloudSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  toleranceSec = 300
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return i === -1 ? [p.trim(), ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  ) as Record<string, string>;
  const ts = Number(parts.t);
  const sig = parts.s;
  if (!Number.isFinite(ts) || !sig) return false;
  if (Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = createHmac("sha256", secret)
    .update(`${ts}.${rawBody}`, "utf8")
    .digest("hex");
  return safeEqual(sig, expected);
}
```

- [ ] **Step 4: `WebhookMediaPayload.link`** — en `src/server/inbox/webhook.ts` agregar
  `link?: string;` a `WebhookMediaPayload` con el comentario
  `/** 020: URL de descarga cuando el proveedor la entrega en el webhook (YCloud). */`.

- [ ] **Step 5: Traductor**

```ts
// src/server/ycloud/translate.ts
import type {
  WebhookMessage,
  WebhookReferral,
  WebhookValue,
} from "@/server/inbox/webhook";

/**
 * 020 — Eventos de YCloud → formato interno (`WebhookValue`). Puro y tolerante:
 * lo desconocido se ignora, nada lanza. Así la ingesta, el agente y la
 * atribución no saben de qué proveedor llegó el mensaje.
 */
export type YCloudParsed =
  | { kind: "inbound"; businessPhone: string; wabaId: string | null; value: WebhookValue }
  | { kind: "status"; businessPhone: string; value: WebhookValue }
  | { kind: "template"; wabaId: string | null; event: string; name: string; language: string; reason: string | null }
  | { kind: "ignored" };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const digits = (v: string | undefined): string | undefined => {
  const d = v?.replace(/\D/g, "");
  return d ? d : undefined;
};

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"] as const;
const PASSTHROUGH = new Set(["text", ...MEDIA_TYPES, "location", "contacts"]);

export function translateYCloudEvent(event: unknown): YCloudParsed {
  if (!isObj(event)) return { kind: "ignored" };
  switch (event.type) {
    case "whatsapp.inbound_message.received":
      return inbound(event.whatsappInboundMessage);
    case "whatsapp.message.updated":
      return status(event.whatsappMessage);
    case "whatsapp.template.reviewed":
      return template(event.whatsappTemplate);
    default:
      return { kind: "ignored" };
  }
}

function inbound(raw: unknown): YCloudParsed {
  if (!isObj(raw)) return { kind: "ignored" };
  const type = str(raw.type);
  const id = str(raw.wamid) ?? str(raw.id);
  const businessPhone = str(raw.to);
  if (!type || !id || !businessPhone || !PASSTHROUGH.has(type)) {
    return { kind: "ignored" };
  }
  const sendTime = str(raw.sendTime);
  const ms = sendTime ? Date.parse(sendTime) : NaN;
  const msg: WebhookMessage = {
    id,
    type,
    timestamp: String(Math.floor((Number.isFinite(ms) ? ms : Date.now()) / 1000)),
  };
  const from = digits(str(raw.from));
  if (from) msg.from = from;
  const fromUserId = str(raw.fromUserId);
  if (fromUserId) msg.from_user_id = fromUserId;
  if (isObj(raw.text) && typeof raw.text.body === "string") msg.text = { body: raw.text.body };
  for (const k of MEDIA_TYPES) {
    if (isObj(raw[k])) (msg as Record<string, unknown>)[k] = raw[k];
  }
  if (isObj(raw.location)) msg.location = raw.location as WebhookMessage["location"];
  if (Array.isArray(raw.contacts)) msg.contacts = raw.contacts;
  if (isObj(raw.referral)) msg.referral = raw.referral as WebhookReferral;

  const profile = isObj(raw.customerProfile) ? str(raw.customerProfile.name) : undefined;
  const value: WebhookValue = {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: businessPhone, phone_number_id: businessPhone },
    contacts: [
      {
        ...(profile ? { profile: { name: profile } } : {}),
        ...(from ? { wa_id: from } : {}),
        ...(fromUserId ? { user_id: fromUserId } : {}),
      },
    ],
    messages: [msg],
  };
  return { kind: "inbound", businessPhone, wabaId: str(raw.wabaId) ?? null, value };
}

function status(raw: unknown): YCloudParsed {
  if (!isObj(raw)) return { kind: "ignored" };
  const s = str(raw.status);
  const id = str(raw.wamid) ?? str(raw.id);
  const businessPhone = str(raw.from);
  if (!s || !id || !businessPhone) return { kind: "ignored" };
  if (!["sent", "delivered", "read", "failed"].includes(s)) {
    return { kind: "ignored" }; // `accepted`: aún no salió de YCloud
  }
  const code = Number(str(raw.errorCode));
  const st: NonNullable<WebhookValue["statuses"]>[number] = {
    id,
    status: s,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(digits(str(raw.to)) ? { recipient_id: digits(str(raw.to)) } : {}),
    ...(s === "failed"
      ? {
          errors: [
            {
              code: Number.isFinite(code) ? code : 0,
              message: str(raw.errorMessage) ?? "Error de entrega",
            },
          ],
        }
      : {}),
  };
  return {
    kind: "status",
    businessPhone,
    value: { messaging_product: "whatsapp", statuses: [st] },
  };
}

function template(raw: unknown): YCloudParsed {
  if (!isObj(raw)) return { kind: "ignored" };
  const name = str(raw.name);
  const language = str(raw.language);
  const event = str(raw.status) ?? str(raw.statusUpdateEvent);
  if (!name || !language || !event) return { kind: "ignored" };
  return {
    kind: "template",
    wabaId: str(raw.wabaId) ?? null,
    event,
    name,
    language,
    reason: str(raw.reason) ?? null,
  };
}
```

- [ ] **Step 6: Verde** — repetir el paso 2 → PASS; `pnpm typecheck && pnpm lint`.
- [ ] **Step 7: Commit** — `feat(ycloud): verificación de firma y traductor de eventos`

---

### Task 5: Resolvedor de proveedor y envío unificado

**Files:**
- Create: `src/server/whatsapp/connection.ts`
- Modify: `src/server/inbox/send.ts`, `src/server/whatsapp/templates.ts`, `src/server/whatsapp/media.ts`
- Test: `tests/unit/whatsapp-connection.test.ts` (nuevo) + los tests existentes
  (`send-sandbox`, `media-send`, `templates`, `window`, …) deben seguir verdes **sin editarse**.

**Interfaces:**
- Consumes: `getCredentialsByOrg` (Meta), `getYCloudCredentialsByOrg`, `ycloudEnabled`, `callGraphSend`, `uploadGraphMedia`, `ycloudRequest`, `toYCloudSendBody`.
- Produces:
  ```ts
  type WhatsAppConnection =
    | { provider: "meta"; creds: Credentials }
    | { provider: "ycloud"; creds: YCloudCredentials };
  getWhatsAppConnection(orgId: string): Promise<WhatsAppConnection | null>
  sendWhatsAppPayload(conn: WhatsAppConnection, payload: Record<string, unknown>): Promise<string>  // wamid; lanza SendError
  uploadWhatsAppMedia(conn: WhatsAppConnection, file: {data: Buffer|Uint8Array; mimeType: string; fileName?: string}): Promise<string>
  markConnectionReconnectRequired(conn: WhatsAppConnection): Promise<void>
  ```
  `SendError` se mueve a `src/server/whatsapp/send-error.ts` y `send.ts` lo reexporta (`export { SendError } from …`) para no romper imports ni tests.

- [ ] **Step 1: Test que falla**

```ts
// tests/unit/whatsapp-connection.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCredentialsByOrg = vi.fn();
const getYCloudCredentialsByOrg = vi.fn();
const ycloudRequest = vi.fn();
let flag = false;

vi.mock("@/server/whatsapp/credentials", () => ({
  getCredentialsByOrg, markReconnectRequired: vi.fn(),
}));
vi.mock("@/server/ycloud/credentials", () => ({
  getYCloudCredentialsByOrg, markYCloudReconnectRequired: vi.fn(),
}));
vi.mock("@/server/whatsapp/providers-flag", () => ({ ycloudEnabled: () => flag }));
vi.mock("@/lib/ycloud/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/ycloud/client")>()),
  ycloudRequest,
}));

const yc = { organizationId: "o", phone: "+5215512345678", apiKey: "K", status: "connected" };

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
  const payload = { messaging_product: "whatsapp", to: "5215598765432", type: "text", text: { body: "hi" } };

  it("devuelve el wamid y manda el cuerpo traducido", async () => {
    ycloudRequest.mockResolvedValue({ id: "ym", wamid: "wamid.X", status: "accepted" });
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    expect(await sendWhatsAppPayload(conn, payload)).toBe("wamid.X");
    expect(ycloudRequest.mock.calls[0]![0]).toBe("/whatsapp/messages/sendDirectly");
    expect(ycloudRequest.mock.calls[0]![1].body).toMatchObject({ from: "+5215512345678", to: "+5215598765432" });
  });
  it("200 sin wamid ni id → SendError meta_error", async () => {
    ycloudRequest.mockResolvedValue({});
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    await expect(sendWhatsAppPayload(conn, payload)).rejects.toMatchObject({ code: "meta_error" });
  });
  it("401 → reconnect_required", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    ycloudRequest.mockRejectedValue(new YCloudApiError("bad", { status: 401 }));
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    await expect(sendWhatsAppPayload(conn, payload)).rejects.toMatchObject({ code: "reconnect_required" });
  });
  it("5xx y red → meta_unavailable", async () => {
    const { YCloudApiError } = await import("@/lib/ycloud/client");
    const { sendWhatsAppPayload } = await import("@/server/whatsapp/connection");
    for (const status of [0, 503]) {
      ycloudRequest.mockRejectedValue(new YCloudApiError("x", { status }));
      await expect(sendWhatsAppPayload(conn, payload)).rejects.toMatchObject({ code: "meta_unavailable" });
    }
  });
});
```

- [ ] **Step 2: Fallo** — `pnpm exec vitest run tests/unit/whatsapp-connection.test.ts` → FAIL.

- [ ] **Step 3: `send-error.ts`** — mover la clase `SendError` de `send.ts` (tal cual) a
  `src/server/whatsapp/send-error.ts` y en `send.ts` reemplazar su definición por
  `import { SendError } from "@/server/whatsapp/send-error"; export { SendError };`.

- [ ] **Step 4: `connection.ts`**

```ts
import { callGraphSend } from "@/server/inbox/send";
import { uploadGraphMedia } from "@/server/whatsapp/media";
import {
  getCredentialsByOrg,
  markReconnectRequired,
  type Credentials,
} from "@/server/whatsapp/credentials";
import {
  getYCloudCredentialsByOrg,
  markYCloudReconnectRequired,
  type YCloudCredentials,
} from "@/server/ycloud/credentials";
import { ycloudEnabled } from "@/server/whatsapp/providers-flag";
import { SendError } from "@/server/whatsapp/send-error";
import { toYCloudSendBody } from "@/lib/ycloud/send-body";
import { YCloudApiError, ycloudRequest } from "@/lib/ycloud/client";

/**
 * 020 — Qué conexión de WhatsApp usa una organización. Meta tiene prioridad;
 * YCloud solo existe si la bandera está encendida (con ella apagada, unas
 * credenciales de YCloud que hayan quedado en la base NO se usan: el envío
 * falla claro como «sin número conectado», no por otro proveedor).
 */
export type WhatsAppConnection =
  | { provider: "meta"; creds: Credentials }
  | { provider: "ycloud"; creds: YCloudCredentials };

export async function getWhatsAppConnection(
  organizationId: string
): Promise<WhatsAppConnection | null> {
  const meta = await getCredentialsByOrg(organizationId);
  if (meta) return { provider: "meta", creds: meta };
  if (!ycloudEnabled()) return null;
  const yc = await getYCloudCredentialsByOrg(organizationId);
  return yc ? { provider: "ycloud", creds: yc } : null;
}

export async function markConnectionReconnectRequired(
  conn: WhatsAppConnection
): Promise<void> {
  if (conn.provider === "meta") await markReconnectRequired(conn.creds.organizationId);
  else await markYCloudReconnectRequired(conn.creds.organizationId);
}

function ycloudSendError(err: unknown, orgId: string): never {
  if (err instanceof YCloudApiError) {
    if (err.isAuthError) {
      void markYCloudReconnectRequired(orgId);
      throw new SendError(
        "reconnect_required",
        "La API key de YCloud no es válida o fue revocada: reconecta el número en Configuración"
      );
    }
    if (err.status === 0 || err.status >= 500) {
      throw new SendError("meta_unavailable", "YCloud no está disponible ahora");
    }
    throw new SendError("meta_error", err.message);
  }
  throw err;
}

/** Envía un payload interno (forma Graph) por el proveedor de la conexión. */
export async function sendWhatsAppPayload(
  conn: WhatsAppConnection,
  payload: Record<string, unknown>
): Promise<string> {
  if (conn.provider === "meta") return callGraphSend(conn.creds, payload);
  try {
    const res = await ycloudRequest<{ id?: string; wamid?: string } | null>(
      "/whatsapp/messages/sendDirectly",
      {
        method: "POST",
        apiKey: conn.creds.apiKey,
        body: toYCloudSendBody(payload, conn.creds.phone),
      }
    );
    const id = res?.wamid ?? res?.id;
    if (!id) throw new SendError("meta_error", "YCloud no devolvió ID de mensaje");
    return id;
  } catch (err) {
    return ycloudSendError(err, conn.creds.organizationId);
  }
}

/** Sube un adjunto y devuelve el id de medio para usarlo en el envío. */
export async function uploadWhatsAppMedia(
  conn: WhatsAppConnection,
  file: { data: Buffer | Uint8Array; mimeType: string; fileName?: string }
): Promise<string> {
  if (conn.provider === "meta") return uploadGraphMedia(conn.creds, file);
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(file.data)], { type: file.mimeType }),
    file.fileName ?? "adjunto"
  );
  try {
    const res = await ycloudRequest<{ id?: string } | null>(
      `/whatsapp/media/${encodeURIComponent(conn.creds.phone)}/upload`,
      { method: "POST", apiKey: conn.creds.apiKey, form, timeoutMs: 60_000 }
    );
    if (!res?.id) throw new SendError("upload_failed", "YCloud no devolvió ID del adjunto");
    return res.id;
  } catch (err) {
    return ycloudSendError(err, conn.creds.organizationId);
  }
}
```

  Nota de ciclo de imports: `connection.ts` importa `callGraphSend` de `send.ts`
  y `send.ts` importará `connection.ts`. Para evitarlo, **mover `callGraphSend`
  a `src/server/whatsapp/graph-send.ts`** (mismo cuerpo, mismas dependencias) y
  que `send.ts` lo reexporte: `export { callGraphSend } from "@/server/whatsapp/graph-send";`.
  Hacer lo mismo con la importación circular de `templates.ts`.

- [ ] **Step 5: Cablear `send.ts`**

  - `SendTarget.credentials: Credentials | null` → `connection: WhatsAppConnection | null`.
  - En `prepareSend`, reemplazar el bloque de `getCredentialsByOrg` por:
    ```ts
    const connection = await getWhatsAppConnection(organizationId);
    if (!connection) {
      throw new SendError("not_connected", "No hay número de WhatsApp conectado");
    }
    if (connection.creds.status === "reconnect_required") {
      throw new SendError(
        "reconnect_required",
        connection.provider === "ycloud"
          ? "La API key de YCloud expiró: reconecta el número en Configuración"
          : "El token de WhatsApp expiró: reconecta el número en Configuración"
      );
    }
    ```
    y devolver `{ conversation, connection, destinatario, recipient }`. Los
    retornos de Instagram/Messenger llevan `connection: null`.
  - `sendText`: `callGraphSend(credentials!, {...})` → `sendWhatsAppPayload(target.connection!, {...})`.
  - `sendMediaMessage`: `uploadGraphMedia(credentials!, …)` → `uploadWhatsAppMedia(target.connection!, …)`; las dos `callGraphSend` → `sendWhatsAppPayload`; en el `catch`, `MetaApiError.isAuthError` queda y se agrega que un `SendError` ya tipado se propaga (ya lo hace).
  - `sendStructured`: `if (!target.credentials)` → `if (!target.connection)`; `callGraphSend(target.credentials, …)` → `sendWhatsAppPayload(target.connection, …)`.
  - Imports: quitar los de `Credentials`/`getCredentialsByOrg`/`markReconnectRequired` que queden sin uso.

- [ ] **Step 6: Cablear `templates.ts`** — en `sendTemplate`: `getCredentialsByOrg` →
  `getWhatsAppConnection`; mismos chequeos de `not_connected`/`reconnect_required`
  (mensaje según proveedor); `callGraphSend(creds, …)` → `sendWhatsAppPayload(conn, …)`.
  `createTemplate` y `syncTemplates` se cablean en la tarea 9.

- [ ] **Step 7: Regresión completa** — esta tarea es una refactorización de Meta:

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: los 715 tests previos siguen verdes sin tocarlos, más los nuevos. Si
algún test existente mockea `@/server/whatsapp/credentials` y ahora falla por
una importación nueva, **ajustar la implementación, no el test**.

- [ ] **Step 8: Commit** — `refactor(whatsapp): resolvedor de proveedor y envío unificado`

---

### Task 6: Ingesta por organización y webhook de YCloud

**Files:**
- Modify: `src/server/inbox/ingest.ts`, `src/server/whatsapp/templates.ts`, `src/server/whatsapp/media.ts`
- Create: `src/server/ycloud/process.ts`, `src/app/api/webhooks/yc/[webhookToken]/route.ts`
- Test: `tests/unit/ycloud-webhook.test.ts`, regresión de `echoes.test.ts`, `webhook.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // ingest.ts
  processMessagesForOrg(organizationId: string, value: WebhookValue): Promise<void>
  // templates.ts
  applyTemplateStatusForOrg(organizationId: string, p: {event: string; name: string; language: string; reason: string | null}): Promise<void>
  // process.ts
  processYCloudWebhook(rawBody: string, signatureHeader: string | null): Promise<"ok" | "bad_signature" | "ignored">
  ```

- [ ] **Step 1: Test que falla**

```ts
// tests/unit/ycloud-webhook.test.ts
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
  id: "e1", type: "whatsapp.inbound_message.received",
  whatsappInboundMessage: { id: "y", wamid: "w1", from: "+5215598765432", to: "+5215512345678", sendTime: "2026-10-04T12:00:00.000Z", type: "text", text: { body: "hola" } },
};
const raw = JSON.stringify(ev);

beforeEach(() => vi.resetAllMocks());

describe("processYCloudWebhook", () => {
  it("firma válida → ingiere para la organización del número", async () => {
    getByPhone.mockResolvedValue(creds);
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    const r = await processYCloudWebhook(raw, signYCloudBody(raw, SECRET, Math.floor(Date.now() / 1000)));
    expect(r).toBe("ok");
    expect(processMessagesForOrg).toHaveBeenCalledWith("org_1", expect.objectContaining({ messages: expect.any(Array) }));
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
    expect(await processYCloudWebhook(raw, signYCloudBody(raw, SECRET, Math.floor(Date.now() / 1000)))).toBe("bad_signature");
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
    const ok = await processYCloudWebhook(tpl, signYCloudBody(tpl, SECRET, Math.floor(Date.now() / 1000)));
    expect(ok).toBe("ok");
    expect(applyTemplateStatusForOrg).toHaveBeenCalledWith("org_1", { event: "APPROVED", name: "aviso", language: "es_MX", reason: null });
  });
  it("estado de mensaje: aplica el status para la organización", async () => {
    getByPhone.mockResolvedValue(creds);
    const upd = JSON.stringify({
      id: "e3", type: "whatsapp.message.updated",
      whatsappMessage: { wamid: "w9", status: "delivered", from: "+5215512345678", to: "+5215598765432" },
    });
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    const r = await processYCloudWebhook(upd, signYCloudBody(upd, SECRET, Math.floor(Date.now() / 1000)));
    expect(r).toBe("ok");
    expect(applyStatusUpdate).toHaveBeenCalledWith("org_1", expect.objectContaining({ id: "w9", status: "delivered" }));
  });
  it("JSON roto → ignored, sin lanzar", async () => {
    const { processYCloudWebhook } = await import("@/server/ycloud/process");
    expect(await processYCloudWebhook("{no", null)).toBe("ignored");
  });
});
```

- [ ] **Step 2: Fallo** → FAIL.

- [ ] **Step 3: Separar el enrutamiento de la ingesta (`ingest.ts`)** — sin cambiar comportamiento:

```ts
export async function processMessagesValue(value: WebhookValue): Promise<void> {
  const phoneNumberId = value.metadata?.phone_number_id;
  if (!phoneNumberId) return;
  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  if (!credentials) {
    console.warn(/* el mismo aviso de hoy, sin cambios */);
    return;
  }
  await processMessagesForOrg(credentials.organizationId, value);
}

/** 020 — El cuerpo de la ingesta, con la organización ya resuelta por el proveedor. */
export async function processMessagesForOrg(
  organizationId: string,
  value: WebhookValue
): Promise<void> {
  for (const status of value.statuses ?? []) {
    await applyStatusUpdate(organizationId, status);
  }
  for (const msg of value.messages ?? []) {
    /* … el for de mensajes tal cual está hoy … */
  }
}
```

  `applyStatusUpdate` hoy se importa de `@/server/inbox/status`; si no está
  exportada con esa firma, exportarla sin cambiar su cuerpo.
  En `mediaInputFrom`, para binarios: `payload: media.link ? { link: media.link } : null`.

- [ ] **Step 4: Plantillas** — en `templates.ts`, extraer de `applyTemplateStatusEvent`
  el `update` a `applyTemplateStatusForOrg(organizationId, {event, name, language, reason})`
  (reutiliza `mapMetaStatus(event)`; YCloud usa los mismos nombres de estado en
  mayúsculas); `applyTemplateStatusEvent` queda como: resolver credenciales por
  WABA → `applyTemplateStatusForOrg(creds.organizationId, {…})`.

- [ ] **Step 5: Descarga de adjuntos entrantes (`media.ts`)** — en `ensureAssetAvailable`,
  reemplazar `getCredentialsByOrg` por `getWhatsAppConnection`; si
  `conn.provider === "ycloud"`, usar:

```ts
export async function downloadYCloudMedia(
  creds: YCloudCredentials,
  asset: { payload: unknown },
  maxBytes: number = MEDIA_LIMITS.document.maxBytes
): Promise<{ data: Buffer; mimeType: string | null; fileSize: number }> {
  const link = (asset.payload as { link?: string } | null)?.link;
  if (!link) throw new MediaFetchError("YCloud no entregó URL del adjunto");
  let res: Response;
  try {
    // La key solo viaja a hosts de YCloud, jamás a una URL arbitraria.
    const trusted = new URL(link).hostname.endsWith("ycloud.com");
    res = await fetch(link, {
      headers: trusted ? { "X-API-Key": creds.apiKey } : {},
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new MediaFetchError("No se pudo descargar el adjunto");
  }
  if (!res.ok) {
    throw new MediaFetchError(`La descarga devolvió ${res.status}`, res.status === 404 || res.status === 410);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) throw new MediaFetchError("El adjunto excede el límite de tamaño", true);
  return { data: buf, mimeType: res.headers.get("content-type"), fileSize: buf.byteLength };
}
```

  (Si la descarga real exige otro mecanismo, se enmienda en la tarea 11.)

- [ ] **Step 6: `process.ts`**

```ts
import { applyStatusUpdate } from "@/server/inbox/status";
import { processMessagesForOrg } from "@/server/inbox/ingest";
import { applyTemplateStatusForOrg } from "@/server/whatsapp/templates";
import {
  getYCloudCredentialsByPhone,
  getYCloudCredentialsByWabaId,
} from "@/server/ycloud/credentials";
import { verifyYCloudSignature } from "@/server/ycloud/signature";
import { translateYCloudEvent } from "@/server/ycloud/translate";

/**
 * 020 — Orden deliberado: se lee el JSON SIN confiar en él solo para saber a qué
 * organización pertenece el número; no se procesa nada hasta verificar la firma
 * con el secreto de ESA organización. La firma es obligatoria: sin secreto
 * guardado no hay forma de autenticar al remitente, así que se rechaza.
 */
export async function processYCloudWebhook(
  rawBody: string,
  signatureHeader: string | null
): Promise<"ok" | "bad_signature" | "ignored"> {
  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return "ignored";
  }
  const parsed = translateYCloudEvent(event);
  if (parsed.kind === "ignored") return "ignored";

  // Mensajes y estados se enrutan por el número del negocio; las plantillas, que
  // llegan a nivel WABA, por el WABA.
  const creds =
    parsed.kind === "template"
      ? parsed.wabaId
        ? await getYCloudCredentialsByWabaId(parsed.wabaId)
        : null
      : await getYCloudCredentialsByPhone(parsed.businessPhone);
  if (!creds) return "ignored";
  if (
    !creds.webhookSecret ||
    !verifyYCloudSignature(rawBody, signatureHeader, creds.webhookSecret)
  ) {
    return "bad_signature";
  }

  if (parsed.kind === "inbound") {
    await processMessagesForOrg(creds.organizationId, parsed.value);
  } else if (parsed.kind === "status") {
    for (const s of parsed.value.statuses ?? []) {
      await applyStatusUpdate(creds.organizationId, s);
    }
  } else if (parsed.kind === "template") {
    await applyTemplateStatusForOrg(creds.organizationId, {
      event: parsed.event,
      name: parsed.name,
      language: parsed.language,
      reason: parsed.reason,
    });
  }
  return "ok";
}
```


- [ ] **Step 7: Ruta**

```ts
// src/app/api/webhooks/yc/[webhookToken]/route.ts
import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { isValidWebhookToken } from "@/server/inbox/webhook";
import { processYCloudWebhook } from "@/server/ycloud/process";
import {
  ycloudDisabledResponse,
  ycloudEnabled,
} from "@/server/whatsapp/providers-flag";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webhookToken: string }> };

export async function POST(req: Request, { params }: Params) {
  if (!ycloudEnabled()) return ycloudDisabledResponse();
  const { webhookToken } = await params;
  if (!isValidWebhookToken(webhookToken, getEnv().META_WEBHOOK_VERIFY_TOKEN)) {
    return new Response(null, { status: 404 });
  }
  const rawBody = await req.text();
  const signature = req.headers.get("ycloud-signature");

  // La firma se verifica ANTES de responder: un 401 le dice a YCloud (y a quien
  // sea) que el evento no se aceptó. Solo el procesamiento va en after().
  let verdict: "ok" | "bad_signature" | "ignored" = "ignored";
  const work = (async () => {
    try {
      verdict = await processYCloudWebhook(rawBody, signature);
    } catch (err) {
      console.error("[webhook-yc] error procesando evento:", err);
    }
  })();
  after(() => work);
  await Promise.race([work, new Promise((r) => setTimeout(r, 4_000))]);
  if (verdict === "bad_signature") return new Response(null, { status: 401 });
  return Response.json({ received: true });
}
```

  (La carrera de 4 s garantiza responder < 6 s; si la ingesta tarda más, sigue
  en `after()` y la firma, que es rápida, ya se resolvió.)

- [ ] **Step 8: Verde y regresión** — `pnpm typecheck && pnpm lint && pnpm test` → todo verde, incluidos `echoes`, `webhook`, `status-monotonic`.
- [ ] **Step 9: Commit** — `feat(ycloud): webhook firmado e ingesta por organización`

---

### Task 7: API de conexión (webhook automático, exclusividad)

**Files:**
- Create: `src/app/api/settings/ycloud/route.ts`, `src/server/ycloud/connect.ts`
- Modify: `src/app/api/settings/whatsapp/route.ts` (409 si hay YCloud), `src/app/api/settings/webhook/route.ts` (agregar `ycloudUrl`)
- Test: `tests/unit/ycloud-connect.test.ts`, `tests/unit/ycloud-exclusivity.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // connect.ts
  testYCloudConnection(apiKey: string, phone: string): Promise<{ ok: true; wabaId: string | null } | { ok: false; code: "invalid_key" | "provider_unavailable" | "number_not_found" | "provider_error"; message: string }>
  registerWebhook(apiKey: string, url: string): Promise<{ ok: true; id: string; secret: string } | { ok: false; message: string }>
  unregisterWebhook(apiKey: string, webhookId: string): Promise<void>   // mejor esfuerzo, nunca lanza
  ```
  `GET/PUT/DELETE /api/settings/ycloud` (solo propietario en PUT y DELETE).

- [ ] **Step 1: Tests que fallan** — `testYCloudConnection`: 401 → `invalid_key`; 5xx/red → `provider_unavailable`;
  número ausente de `GET /whatsapp/phoneNumbers` → `number_not_found`; éxito → `wabaId`.
  `registerWebhook`: éxito devuelve `id` y `secret`; error devuelve `{ok:false}` (no lanza).
  `unregisterWebhook`: error de red no lanza. Exclusividad: `PUT /api/settings/ycloud`
  con credenciales de Meta existentes → 409 `provider_conflict`; `PUT /api/settings/whatsapp`
  con credenciales de YCloud → 409. Con la bandera apagada, las tres rutas de
  YCloud → 404. (Mockear `ycloudRequest` y los módulos de credenciales como en la tarea 5.)

- [ ] **Step 2: Fallo** → FAIL.

- [ ] **Step 3: `connect.ts`**

```ts
import { getEnv } from "@/lib/env";
import { YCloudApiError, ycloudRequest } from "@/lib/ycloud/client";
import { normalizePhoneE164 } from "@/server/ycloud/credentials";

type PhoneNumber = { phoneNumber?: string; wabaId?: string };

export async function testYCloudConnection(apiKey: string, phone: string) {
  try {
    const res = await ycloudRequest<{ items?: PhoneNumber[] } | null>(
      "/whatsapp/phoneNumbers?limit=100",
      { apiKey }
    );
    const wanted = normalizePhoneE164(phone);
    const hit = (res?.items ?? []).find(
      (p) => p.phoneNumber && normalizePhoneE164(p.phoneNumber) === wanted
    );
    if (!hit) {
      return {
        ok: false as const,
        code: "number_not_found" as const,
        message: "Ese número no aparece en tu cuenta de YCloud. Verifica que esté registrado ahí.",
      };
    }
    return { ok: true as const, wabaId: hit.wabaId ?? null };
  } catch (err) {
    if (err instanceof YCloudApiError) {
      if (err.isAuthError) {
        return { ok: false as const, code: "invalid_key" as const, message: "La API key de YCloud no es válida o no tiene permisos." };
      }
      if (err.status === 0 || err.status >= 500) {
        return { ok: false as const, code: "provider_unavailable" as const, message: "YCloud no está disponible en este momento; intenta de nuevo" };
      }
      return { ok: false as const, code: "provider_error" as const, message: err.message };
    }
    throw err;
  }
}

export function webhookUrl(): string {
  const env = getEnv();
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/yc/${env.META_WEBHOOK_VERIFY_TOKEN}`;
}

export async function registerWebhook(apiKey: string, url: string) {
  try {
    const res = await ycloudRequest<{ id?: string; secret?: string } | null>(
      "/webhookEndpoints",
      {
        method: "POST",
        apiKey,
        body: {
          url,
          description: "Vocero CRM",
          status: "active",
          enabledEvents: [
            "whatsapp.inbound_message.received",
            "whatsapp.message.updated",
            "whatsapp.template.reviewed",
          ],
        },
      }
    );
    if (!res?.id || !res.secret) {
      return { ok: false as const, message: "YCloud no devolvió el secreto del webhook" };
    }
    return { ok: true as const, id: res.id, secret: res.secret };
  } catch (err) {
    return { ok: false as const, message: err instanceof Error ? err.message : "No se pudo registrar el webhook" };
  }
}

export async function unregisterWebhook(apiKey: string, webhookId: string): Promise<void> {
  try {
    await ycloudRequest(`/webhookEndpoints/${encodeURIComponent(webhookId)}`, { method: "DELETE", apiKey });
  } catch (err) {
    console.warn("[ycloud] no se pudo borrar el webhook (mejor esfuerzo):", err instanceof Error ? err.message : err);
  }
}
```

- [ ] **Step 4: Ruta `PUT`** — Zod `{ apiKey: string, phone: string }`; flujo:
  bandera → 404; `session.role !== "owner"` → 403; si existe `getCredentialsByOrg`
  (Meta) → 409 `provider_conflict` «Desconecta primero la conexión directa de Meta»;
  `testYCloudConnection` (422/503 según código); `registerWebhook(apiKey, webhookUrl())`;
  `saveYCloudCredentials({ …, webhookStatus: reg.ok ? "registered" : "pending", webhookId, webhookSecret })`;
  responder `{ ok: true, webhook: reg.ok ? "registered" : "pending", webhookUrl: webhookUrl() }`.
  **Si el registro falla se guarda igual** (spec FR-310) y la respuesta lleva `webhookUrl`
  para el pegado manual; en ese caso `webhookSecret` queda null y el webhook rechaza
  hasta que el operador lo complete con `PATCH { webhookSecret }` (misma ruta, solo
  propietario, cifra el secreto). Después de guardar, `syncTemplates` en mejor
  esfuerzo (tarea 9).
  `GET` → `{ connection: {phone, wabaId, status, webhookStatus, apiKeyLast4} | null, webhookUrl }`.
  `DELETE` → `unregisterWebhook` (si hay `webhookId`) + `deleteYCloudCredentials`.

- [ ] **Step 5: Exclusividad en Meta** — en `PUT /api/settings/whatsapp`, antes de `testConnection`:
  `if (ycloudEnabled() && (await getYCloudCredentialsByOrg(session.organizationId))) return apiError(409, "provider_conflict", "Desconecta primero YCloud");`

- [ ] **Step 6: URL en `/api/settings/webhook`** — agregar
  `ycloudUrl: ycloudEnabled() ? \`${base}/api/webhooks/yc/${env.META_WEBHOOK_VERIFY_TOKEN}\` : null`.

- [ ] **Step 7: Verde** — `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 8: Commit** — `feat(ycloud): conexión con webhook automático y exclusividad`

---

### Task 8: Interfaz de Configuración → YCloud

**Files:**
- Create: `src/components/settings/ycloud-client.tsx`, `src/app/(app)/settings/ycloud/page.tsx`
- Modify: `src/components/settings/settings-nav.tsx`, `src/app/(app)/settings/layout.tsx`
- Test: `tests/unit/ycloud-ui.test.ts` (la pestaña y la página existen solo con la bandera)

- [ ] **Step 1: Página con 404 si está apagado** (mismo patrón que Messenger):

```tsx
// src/app/(app)/settings/ycloud/page.tsx
import { notFound } from "next/navigation";
import { YCloudClient } from "@/components/settings/ycloud-client";
import { ycloudEnabled } from "@/server/whatsapp/providers-flag";

export const dynamic = "force-dynamic";

export default function YCloudSettingsPage() {
  if (!ycloudEnabled()) notFound();
  return <YCloudClient />;
}
```

- [ ] **Step 2: Pestaña** — `settings-nav.tsx`: agregar
  `const YCLOUD_TAB: Tab = { href: "/settings/ycloud", label: "YCloud" };`, prop
  `ycloud?: boolean` y, en `tabs`, `...(ycloud ? [YCLOUD_TAB] : [])` justo después
  de la de WhatsApp. `layout.tsx`: `ycloud={ycloudEnabled()}`.

- [ ] **Step 3: `YCloudClient`** — mismo esqueleto que `messenger-client.tsx`
  (`Card`, `Input`, `Label`, `Button`, `Badge`, `AlertTriangle`, `CheckCircle2`):
  carga `GET /api/settings/ycloud` y `/api/settings/webhook`; formulario con
  «API key de YCloud» (`type="password"`) y «Número de WhatsApp (con código de
  país)»; botón «Conectar» → `PUT`; tras guardar, `setApiKey("")`. Estados:
  - **Conectado**: tarjeta verde «Conectado por YCloud · ····{apiKeyLast4}».
  - **`reconnect_required`**: tarjeta roja «La API key expiró o fue revocada».
  - **`webhookStatus === "pending"`**: aviso ámbar «No pudimos registrar el
    webhook automáticamente», con la URL copiable y un campo «Secreto del
    webhook» + botón «Guardar secreto» (`PATCH`).
  - **Conflicto 409**: muestra el mensaje del servidor («Desconecta primero…»).
  - Botón «Desconectar» (`DELETE`) con confirmación en línea.
  Texto de ayuda: dónde se crea la API key (YCloud → Developers → API Keys) y
  que el webhook se registra solo.

- [ ] **Step 4: Test de superficie** — verificar con `vi.stubEnv("WHATSAPP_PROVIDERS", …)`
  que `ycloudEnabled()` gobierna la página (`notFound` lanza) y que `SettingsNav`
  no renderiza la pestaña sin la prop.

- [ ] **Step 5: Verde** — `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] **Step 6: Commit** — `feat(ycloud): pantalla de conexión tras la bandera`

---

### Task 9: Plantillas, «escribiendo…» y lectura por YCloud

**Files:**
- Modify: `src/server/whatsapp/templates.ts` (`createTemplate`, `syncTemplates`), `src/app/api/bot/typing/route.ts`
- Test: `tests/unit/ycloud-templates.test.ts`, `tests/unit/ycloud-typing.test.ts`

- [ ] **Step 1: Tests que fallan**
  - `syncTemplates` con conexión YCloud llama `GET /whatsapp/templates?limit=100&filter.wabaId=…`
    y actualiza estado/categoría con la misma lógica que Meta (reutilizar el
    cuerpo existente extrayendo `applyRemoteTemplates(orgId, remote[])`).
  - `createTemplate` con YCloud: si el endpoint de creación no está confirmado
    (tarea 11), responde `TemplateError("provider_unsupported", "Crea la plantilla en el panel de YCloud y pulsa «Sincronizar»")` — **degradación definida**, sin 500.
  - `POST /api/bot/typing` con YCloud: llama `POST /whatsapp/inboundMessages/{wamid}/markAsRead` y responde `{ ok: true, typing: false }`; si falla, `{ ok:false, reason:"provider_error" }` con 200.

- [ ] **Step 2: Implementar** — `syncTemplates`: reemplazar `getCredentialsByOrg` por
  `getWhatsAppConnection`; rama `ycloud` con `ycloudRequest` y mapeo
  `{name, language, status, category, reason}` → forma que ya consume el bucle
  (`status.toLowerCase()` pasa por `mapMetaStatus`). `bot/typing`: resolver con
  `getWhatsAppConnection`; `meta` queda idéntico; `ycloud` hace el `markAsRead`.

- [ ] **Step 3: Verde** — `pnpm typecheck && pnpm lint && pnpm test` (incluye `templates.test.ts` sin editar).
- [ ] **Step 4: Commit** — `feat(ycloud): plantillas y lectura por YCloud`

---

### Task 10: Mock de YCloud y E2E de comportamiento

**Files:**
- Create: `src/app/api/dev/ycloud-mock/**`, `src/server/dev/ycloud-mock-state.ts`, `scripts/e2e-ycloud.mjs`
- Modify: `package.json` (`"test:e2e:ycloud": "node --env-file=.env scripts/e2e-ycloud.mjs"`), `tests/e2e/us-ycloud.md` (guion)

El mock vive tras `mockGuard()` (404 en producción) y guarda estado en
`globalThis.__ycloudMock` (mensajes enviados, webhooks registrados con su
`secret`, números). Rutas que emula, bajo `/api/dev/ycloud-mock/v2/…` (el E2E
pone `YCLOUD_BASE_URL=http://localhost:3000/api/dev/ycloud-mock/v2`):

| Ruta del mock | Qué hace |
|---|---|
| `GET whatsapp/phoneNumbers` | devuelve `{items:[{phoneNumber, wabaId}]}` con los números sembrados |
| `POST webhookEndpoints` | registra la URL, genera `secret`, devuelve `{id, secret}` |
| `DELETE webhookEndpoints/[id]` | borra el registro |
| `POST whatsapp/messages/sendDirectly` | guarda el cuerpo en `outbox`, devuelve `{id, wamid, status:"accepted"}`; con `?fail=401|503` simula errores |
| `POST whatsapp/media/[phone]/upload` | devuelve `{id}` |
| `GET whatsapp/templates` | lista sembrada |
| `POST whatsapp/inboundMessages/[id]/markAsRead` | `{}` |
| `POST simulate/inbound`, `simulate/status`, `simulate/template` (extra, solo mock) | construyen el evento, lo firman con `signYCloudBody` y el `secret` del webhook registrado y lo entregan a `/api/webhooks/yc/<token>`; con `badSignature:true` lo firman mal |
| `GET outbox` | lo enviado, para aserciones |

**Guion del E2E (`e2e-ycloud.mjs`)**, con el mismo arnés `ok()/hasta()` de
`e2e-selftest.mjs`; la app corre con `WA_MOCK_ENABLED=true`,
`WHATSAPP_PROVIDERS=meta,ycloud`, `YCLOUD_BASE_URL` → mock:

1. Registrar la organización y sembrar el número en el mock.
2. `PUT /api/settings/ycloud` → `webhook: "registered"`; el mock tiene un webhook activo.
3. Entrante firmado → aparece conversación y mensaje; reenviar el MISMO evento → sigue habiendo uno solo (idempotencia).
4. Entrante con `fromUserId` y sin teléfono → contacto `bsuid:`.
5. Responder por la API de conversaciones → el mock recibe `sendDirectly` con `from`/`to` en E.164; `simulate/status delivered` → el mensaje pasa a `delivered`; un `sent` posterior no lo retrocede.
6. Adjunto saliente → `upload` + `sendDirectly` con `image.id`.
7. Entrante con `referral` → la conversación muestra el anuncio de origen.
8. Fuera de ventana → 4xx `window_closed`; plantilla aprobada vía `simulate/template` → envío OK.
9. **Infelices**: firma inválida → 401 y sin mensaje nuevo; `sendDirectly?fail=503` → mensaje `failed` visible y el CRM sigue respondiendo; `fail=401` → estado `reconnect_required`; fallo al registrar webhook → conexión guardada con `webhook: "pending"`.
10. Exclusividad: con YCloud conectado, `PUT /api/settings/whatsapp` → 409; `DELETE /api/settings/ycloud` → el mock ya no tiene el webhook y Meta puede conectarse.
11. Bandera apagada (segunda pasada, app reiniciada sin `ycloud`): `/api/settings/ycloud` y `/api/webhooks/yc/<token>` → 404.

- [ ] **Step 1:** escribir mock + estado + rutas + guion (código completo, siguiendo `wa-mock/*` como plantilla).
- [ ] **Step 2:** levantar con `pnpm dev` y las variables de arriba; `pnpm test:e2e:ycloud` → debe salir 0. **Si algo falla: diagnosticar, corregir y repetir hasta verde** (CLAUDE.md).
- [ ] **Step 3:** correr también `pnpm test:e2e` (Meta) para confirmar cero regresión.
- [ ] **Step 4: Commit** — `test(ycloud): mock de la API y E2E de comportamiento`

---

### Task 11: Documentación, despliegue y verificación con cuenta real

**Files:**
- Create: `docs/ycloud.md`
- Modify: `README.md`, `INSTALL-IA.md` (nota opcional), `CHANGELOG.md`, `CLAUDE.md` (fila en el mapa de código), `.github/workflows/*` si existe (matriz con y sin `WHATSAPP_PROVIDERS=meta,ycloud`)

- [ ] **Step 1: Docs** — `docs/ycloud.md`: qué es, cómo encender la bandera, dónde crear la API key, qué hace el webhook automático y cómo pegarlo a mano, límites conocidos y cómo desconectar.
- [ ] **Step 2: CI** — si hay workflow, correr la suite con la bandera apagada y encendida.
- [ ] **Step 3: Gate completo** — `pnpm typecheck && pnpm lint && pnpm build && pnpm test`.
- [ ] **Step 4: Aplicar la migración 0016** al Supabase de producción (se aplica sola en el build de Vercel por `vercel.json`) y verificar en Supabase que `ycloud_credentials` existe con RLS activo.
- [ ] **Step 5: Desplegar** con `WHATSAPP_PROVIDERS=meta,ycloud` en Vercel; verificar `/api/health` y que `/settings/ycloud` carga.
- [ ] **Step 6: Verificación con cuenta real (bloqueante para «Hecho»)** — con una API key y un número de YCloud (pedírselos al dueño en este punto, no antes), resolver los cuatro pendientes de la spec y **enmendar spec y código con lo observado**:
  1. endpoint y cuerpo para crear plantillas;
  2. descarga de adjuntos entrantes (URL, header, caducidad);
  3. indicador de «escribiendo…»;
  4. forma real del evento de plantilla y del `referral`.
  Después: enviar y recibir un mensaje real de ida y vuelta, un adjunto y una plantilla.
- [ ] **Step 7: Commit y PR** — `docs(ycloud): guía, changelog y cierre de la 020`

---

## Autorrevisión del plan contra la spec

| Requisito | Tarea |
|---|---|
| FR-301 bandera | 1, 7 (404), 8 |
| FR-302 interfaz de proveedor | 5, 9 |
| FR-303 credenciales cifradas | 2 |
| FR-304 exclusividad | 7 |
| FR-305 / FR-306 webhook, firma, idempotencia | 4, 6 |
| FR-307 traductor | 4 |
| FR-308 identidad BSUID | 4 (test), 10 (E2E) |
| FR-309 cliente y mapeo de errores | 3, 5 |
| FR-310 conexión y webhook automático | 7, 8 |
| FR-311 capacidades sin lógica de proveedor | 5 (el núcleo no cambia `capabilities.ts`) |
| FR-312 adjuntos | 5 (subida), 6 (descarga) |
| FR-313 degradación | 3, 5, 9, 10 |
| FR-314 sandbox | 5 (`prepareSend` conserva la aserción; `send-sandbox.test.ts` sin editar) |
| FR-315 multi-tenancy | 2, 6 |
