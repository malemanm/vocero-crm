"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  canSaveInstagram,
  instagramPutBody,
  type InstagramSource,
} from "@/lib/instagram-form";
import { cn } from "@/lib/utils";

/**
 * 014 — Conexión del canal de Instagram.
 *
 * Misma forma que la de Messenger: dos fuentes (Zernio o app propia de Meta),
 * se prueba contra la plataforma ANTES de guardar, el token se cifra y hacia
 * fuera solo se enseña su cola. La pantalla solo existe si el canal está
 * encendido con `CHANNELS` (ADR-001). Las reglas de qué campos hacen falta
 * viven en `lib/instagram-form.ts`.
 */

type Connection = {
  source: InstagramSource;
  igUserId: string | null;
  accountRef: string | null;
  username: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type WebhookInfo = {
  instagramUrl: string | null;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

const HELP: Record<InstagramSource, { title: string; items: string[] }> = {
  zernio: {
    title: "Conecta la cuenta en Zernio y pega aquí su cuenta y tu API key",
    items: [
      "Hace falta una cuenta de Instagram profesional (empresa o creador) vinculada a una página de Facebook.",
      "La cuenta se vincula en el panel de Zernio, no desde Vocero. Copia de ahí el accountId de la cuenta de Instagram conectada.",
      "La API key se crea en Zernio → Settings → API Keys y se muestra una sola vez (empieza con sk_).",
      "El mismo webhook de Zernio entrega Messenger, WhatsApp y X si esas cuentas están conectadas; Vocero filtra por plataforma y solo ingiere lo de Instagram aquí.",
      "El secreto del webhook es opcional pero recomendado: con él se verifica la firma de cada entrega.",
    ],
  },
  meta: {
    title: "Crea una app en developers.facebook.com con el producto de Instagram",
    items: [
      "Hace falta una cuenta de Instagram profesional. Genera un token con permiso de mensajes de Instagram y anota el ID de esa cuenta (IG_ID).",
      "Sin App Review, la cuenta solo recibe mensajes de perfiles con un rol en la app (administradores, desarrolladores, testers).",
      "Vocero comprueba que el token pertenezca a ese IG_ID antes de guardarlo.",
    ],
  },
};

export function InstagramClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [source, setSource] = useState<InstagramSource>("zernio");
  const [igUserId, setIgUserId] = useState("");
  const [accountRef, setAccountRef] = useState("");
  const [token, setToken] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "token" | null>(null);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/instagram").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) {
      setConnection(c.connection);
      if (c.connection) {
        setSource(c.connection.source);
        if (c.connection.igUserId) setIgUserId(c.connection.igUserId);
        if (c.connection.accountRef) setAccountRef(c.connection.accountRef);
      }
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const form = { source, igUserId, accountRef, token, webhookSecret };

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(null);
    const res = await fetch("/api/settings/instagram", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(instagramPutBody(form)),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo conectar la cuenta");
      return;
    }
    const data = (await res.json()) as { username?: string | null };
    setToken("");
    setWebhookSecret("");
    setSaved(
      data.username ? `Cuenta conectada: @${data.username}` : "Conexión guardada"
    );
    void refetch();
  }

  async function copy(text: string, what: "url" | "token") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // sin portapapeles (contexto no seguro): el texto sigue visible
    }
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  const help = HELP[source];
  const canSave = canSaveInstagram(form);

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos por Instagram están pausados. Pega uno nuevo abajo para
              reconectar.
            </p>
          </div>
        </div>
      )}

      {connection?.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Conectado por {connection.source === "zernio" ? "Zernio" : "Meta"}
              {connection.username ? `: @${connection.username}` : ""}
            </p>
            <p className="text-success-text opacity-80">
              {connection.source === "zernio"
                ? `Cuenta ${connection.accountRef}`
                : `IG_ID ${connection.igUserId}`}{" "}
              · token que termina en ····{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Instagram activo</Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {connection ? "Reconectar Instagram" : "Conectar Instagram"}
          </CardTitle>
          <CardDescription>
            Los mensajes directos de tu cuenta profesional entran a la misma
            bandeja que WhatsApp, con su distintivo de canal. {help.title}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>¿De dónde llegan los mensajes?</Label>
            <div className="flex flex-wrap gap-2">
              {(["zernio", "meta"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  aria-pressed={source === s}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                    source === s
                      ? "border-brand bg-brand-tint text-brand-text"
                      : "border-border-strong hover:bg-accent"
                  )}
                >
                  {s === "zernio" ? "Zernio (API unificada)" : "App propia de Meta"}
                </button>
              ))}
            </div>
          </div>

          <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
            {help.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>

          <div className="grid gap-4 sm:grid-cols-2">
            {source === "zernio" ? (
              <div className="space-y-1.5">
                <Label htmlFor="ig-account">accountId de Zernio</Label>
                <Input
                  id="ig-account"
                  value={accountRef}
                  onChange={(e) => setAccountRef(e.target.value)}
                  placeholder="665f1c2e8b3a4d0012345678"
                  autoComplete="off"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="ig-id">ID de la cuenta de Instagram (IG_ID)</Label>
                <Input
                  id="ig-id"
                  value={igUserId}
                  onChange={(e) => setIgUserId(e.target.value)}
                  placeholder="17841400000000000"
                  autoComplete="off"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="ig-token">
                {source === "zernio" ? "API key de Zernio" : "Token de Instagram"}
              </Label>
              <Input
                id="ig-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={source === "zernio" ? "sk_…" : "IGQ…"}
                autoComplete="off"
              />
            </div>
            {source === "zernio" && (
              <div className="space-y-1.5">
                <Label htmlFor="ig-secret">Secreto del webhook (opcional)</Label>
                <Input
                  id="ig-secret"
                  type="password"
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  placeholder="el mismo que pusiste en Zernio"
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {saved && <p className="text-sm text-success-text">{saved} ✓</p>}

          <Button disabled={saving || !canSave} onClick={() => void save()}>
            {saving ? "Probando…" : "Probar y guardar"}
          </Button>
        </CardContent>
      </Card>

      {webhook?.instagramUrl && (
        <Card>
          <CardHeader>
            <CardTitle>Webhook de Instagram</CardTitle>
            <CardDescription>
              {source === "zernio" ? (
                <>
                  En Zernio, da de alta este endpoint con el evento{" "}
                  <code>message.received</code> y, si usas secreto, el mismo que
                  pegaste arriba. Es un endpoint distinto al de Messenger.
                </>
              ) : (
                <>
                  En tu app de Meta: Instagram → Webhooks. Objeto{" "}
                  <code>instagram</code>, campo <code>messages</code>. Pega esta
                  URL y este token de verificación.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>URL de callback</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhook.instagramUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copiar la URL"
                  onClick={() => void copy(webhook.instagramUrl!, "url")}
                >
                  {copied === "url" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            {source === "meta" && (
              <div className="space-y-1.5">
                <Label>Token de verificación</Label>
                <div className="flex gap-2">
                  <Input readOnly value={webhook.verifyToken} className="font-mono text-xs" />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Copiar el token de verificación"
                    onClick={() => void copy(webhook.verifyToken, "token")}
                  >
                    {copied === "token" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            )}
            <p className="flex items-start gap-2 text-xs text-text-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {source === "zernio"
                ? "Con secreto configurado, cada entrega se verifica con su firma HMAC; sin él, la protección es el segmento secreto de la URL."
                : webhook.signatureLayer
                  ? "Cada entrega se verifica con la firma del App Secret de tu app."
                  : "Define META_APP_SECRET en la instancia para que además se verifique la firma de cada entrega."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
