"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy } from "lucide-react";
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

/**
 * 020 — Conexión del número de WhatsApp por YCloud.
 *
 * Misma forma que el wizard de Meta: se prueba contra el proveedor ANTES de
 * guardar, la key se cifra y hacia fuera solo se enseña su cola. El webhook se
 * registra solo; si no se pudo, la pantalla da la URL y pide el secreto a mano.
 * La pantalla solo existe si el proveedor está encendido (ADR-001).
 */

type Connection = {
  phone: string;
  wabaId: string | null;
  status: "connected" | "reconnect_required";
  webhookStatus: "registered" | "pending";
  apiKeyLast4: string;
};

async function errorMessage(res: Response | null, fallback: string) {
  const data = (await res?.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? fallback;
}

export function YCloudClient() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [phone, setPhone] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/ycloud").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as {
        connection: Connection | null;
        webhookUrl: string;
      };
      setConnection(data.connection);
      setWebhookUrl(data.webhookUrl);
      if (data.connection) setPhone(data.connection.phone);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function connect() {
    setSaving(true);
    setError(null);
    setNotice(null);
    const res = await fetch("/api/settings/ycloud", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: apiKey.trim(), phone: phone.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(await errorMessage(res, "No se pudo conectar el número"));
      return;
    }
    const data = (await res.json()) as { webhook: "registered" | "pending" };
    setApiKey("");
    setNotice(
      data.webhook === "registered"
        ? "Número conectado y webhook registrado"
        : "Número conectado. Falta completar el webhook (abajo)"
    );
    void refetch();
  }

  async function saveSecret() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/ycloud", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookSecret: secret.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      setError(await errorMessage(res, "No se pudo guardar el secreto"));
      return;
    }
    setSecret("");
    setNotice("Secreto del webhook guardado");
    void refetch();
  }

  async function disconnect() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/settings/ycloud", { method: "DELETE" }).catch(
      () => null
    );
    setSaving(false);
    setConfirmDisconnect(false);
    if (!res?.ok) {
      setError(await errorMessage(res, "No se pudo desconectar"));
      return;
    }
    setNotice("Número desconectado");
    setPhone("");
    void refetch();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sin portapapeles (contexto no seguro): la URL sigue visible
    }
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Cargando…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              La API key expiró o fue revocada.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos por WhatsApp están pausados. Pega una nueva abajo para
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
              Conectado por YCloud: {connection.phone}
            </p>
            <p className="text-success-text opacity-80">
              API key que termina en ····{connection.apiKeyLast4}
            </p>
          </div>
          <Badge variant="success">WhatsApp activo</Badge>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {connection ? "Reconectar YCloud" : "Conectar WhatsApp por YCloud"}
          </CardTitle>
          <CardDescription>
            Usa el número que ya tienes en YCloud. Vocero valida la key y registra
            el webhook por ti.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="list-disc space-y-1 pl-5 text-xs text-text-2">
            <li>
              Crea la API key en YCloud → Developers → API Keys. Se muestra una
              sola vez.
            </li>
            <li>
              El número debe estar registrado en tu cuenta de YCloud; escríbelo
              con código de país.
            </li>
            <li>
              Si ya tienes un número conectado directo por Meta, desconéctalo
              primero: una instancia usa un solo proveedor.
            </li>
          </ul>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="yc-phone">Número de WhatsApp</Label>
              <Input
                id="yc-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+52 55 1234 5678"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="yc-key">API key de YCloud</Label>
              <Input
                id="yc-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-success-text">{notice} ✓</p>}

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={saving || !apiKey.trim() || !phone.trim()}
              onClick={() => void connect()}
            >
              {saving ? "Probando…" : "Probar y guardar"}
            </Button>
            {connection &&
              (confirmDisconnect ? (
                <>
                  <Button
                    variant="outline"
                    disabled={saving}
                    onClick={() => void disconnect()}
                  >
                    Sí, desconectar
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setConfirmDisconnect(true)}>
                  Desconectar
                </Button>
              ))}
          </div>
        </CardContent>
      </Card>

      {connection?.webhookStatus === "pending" && (
        <Card>
          <CardHeader>
            <CardTitle>Completa el webhook</CardTitle>
            <CardDescription>
              No pudimos registrar el webhook automáticamente. En YCloud →
              Developers → Webhooks crea un endpoint con esta URL y los eventos de
              mensajes y plantillas de WhatsApp, y pega aquí el secreto que te
              muestra. Mientras falte, los mensajes entrantes se rechazan.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>URL del webhook</Label>
              <div className="flex gap-2">
                <Input readOnly value={webhookUrl} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Copiar la URL"
                  onClick={() => void copy()}
                >
                  {copied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="yc-secret">Secreto del webhook</Label>
              <Input
                id="yc-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="off"
              />
            </div>
            <Button
              disabled={saving || !secret.trim()}
              onClick={() => void saveSecret()}
            >
              Guardar secreto
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
