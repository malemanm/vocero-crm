import { mockGuard } from "@/lib/dev-guard";

export const dynamic = "force-dynamic";

// PNG de 1×1 px: un adjunto entrante servible por URL, como el que YCloud
// entregaría en `image.link`.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return new Response(PNG, { headers: { "content-type": "image/png" } });
}
