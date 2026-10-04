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
