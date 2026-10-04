import { notFound } from "next/navigation";
import { YCloudClient } from "@/components/settings/ycloud-client";
import { ycloudEnabled } from "@/server/whatsapp/providers-flag";

export const dynamic = "force-dynamic";

export default function YCloudSettingsPage() {
  // Sin el proveedor encendido esta pantalla no existe en esta instancia (ADR-001).
  if (!ycloudEnabled()) notFound();
  return <YCloudClient />;
}
