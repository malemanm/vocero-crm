import { mockGuard } from "@/lib/dev-guard";
import { ycState } from "@/server/dev/ycloud-mock-state";

export const dynamic = "force-dynamic";

/** Lo que el CRM le mandó al mock, para las aserciones del E2E. */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  const st = ycState();
  return Response.json({
    sent: st.sent,
    webhooks: st.webhooks,
    markedRead: st.markedRead,
    uploads: st.uploads,
  });
}
