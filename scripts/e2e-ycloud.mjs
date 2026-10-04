/**
 * E2E de comportamiento — WhatsApp por YCloud (spec 020).
 *
 * Conduce la app real con el ycloud-mock por las superficies de usuario:
 * conectar (webhook automático), recibir (firmado), responder, estados,
 * adjuntos, anuncios, plantillas, exclusividad con Meta y los caminos
 * infelices (firma inválida, YCloud caído, webhook que no se registra).
 *
 * Uso (dos pasadas, la app se reinicia entre ellas):
 *   1) app con WA_MOCK_ENABLED=true, WHATSAPP_PROVIDERS=meta,ycloud,
 *      YCLOUD_BASE_URL → /api/dev/ycloud-mock/v2, META_GRAPH_BASE_URL → wa-mock
 *        node --env-file=.env scripts/e2e-ycloud.mjs
 *   2) app SIN WHATSAPP_PROVIDERS:
 *        E2E_YC_FLAG_OFF=1 node --env-file=.env scripts/e2e-ycloud.mjs
 *
 * Necesita BD de pruebas LIMPIA: el último tramo deja Meta conectado y no hay
 * API para desconectarlo. Para reiniciarla:
 *   docker compose -f docker-compose.dev.yml down -v && \
 *   docker compose -f docker-compose.dev.yml up -d && \
 *   MIGRATIONS_DIR=./drizzle node --env-file=.env scripts/migrate.mjs
 *
 * Sale con código 1 si algún check falla (2 si la BD no está limpia).
 */

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "";
const FLAG_OFF = process.env.E2E_YC_FLAG_OFF === "1";

let cookie = "";
let failures = 0;

function ok(name, cond, extra = "") {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function api(path, opts = {}) {
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      origin: BASE,
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  let json = null;
  try {
    json = await res.clone().json();
  } catch {}
  return { res, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond, ms = 15000, paso = 400) {
  const fin = Date.now() + ms;
  for (;;) {
    if (await cond()) return true;
    if (Date.now() > fin) return false;
    await sleep(paso);
  }
}

const BIZ = "+5215512345678";
const CLIENT = "+5215598765432";
const KEY = "yc-e2e-key";

const mock = (body) =>
  api("/api/dev/ycloud-mock/control", { method: "POST", body: JSON.stringify(body) });
const simulate = (body) =>
  api("/api/dev/ycloud-mock/simulate", { method: "POST", body: JSON.stringify(body) });
const outbox = async () => (await api("/api/dev/ycloud-mock/outbox")).json;
const convs = async () => (await api("/api/conversations")).json?.conversations ?? [];
const msgs = async (id) => (await api(`/api/conversations/${id}/messages`)).json?.messages ?? [];

async function login() {
  const email = "e2e-yc@vocero.test";
  const password = "password-e2e-123";
  let su = await api("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password, name: "Operador YCloud" }),
  });
  if (!su.res.ok) {
    su = await api("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  }
  ok("registro o login del operador", su.res.ok, JSON.stringify(su.json));
}

async function flagOff() {
  console.log("== Bandera apagada: YCloud no existe ==");
  await login();
  ok("GET /api/settings/ycloud → 404", (await api("/api/settings/ycloud")).res.status === 404);
  ok(
    "PUT /api/settings/ycloud → 404",
    (await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: "x", phone: "+5215500000000" }) })).res.status === 404
  );
  const wh = await fetch(`${BASE}/api/webhooks/yc/${TOKEN}`, { method: "POST", body: "{}" });
  ok("POST /api/webhooks/yc/<token> → 404", wh.status === 404);
  const info = (await api("/api/settings/webhook")).json;
  ok("la URL de YCloud no se anuncia", info?.ycloudUrl === null);
}

async function main() {
  if (FLAG_OFF) return flagOff();

  console.log("== Setup ==");
  await login();
  if ((await api("/api/settings/whatsapp")).json?.connection) {
    console.error("La BD ya tiene Meta conectado (corrida anterior). Reinicia la BD de pruebas; ver el encabezado.");
    process.exit(2);
  }
  await api("/api/settings/ycloud", { method: "DELETE" });
  await mock({ reset: true, apiKey: KEY, numbers: [{ phoneNumber: BIZ, wabaId: "WABA-YC-E2E" }] });

  console.log("\n== Conectar: caminos infelices ==");
  let r = await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: "mala", phone: BIZ }) });
  ok("key inválida → 422 invalid_key", r.res.status === 422 && r.json?.error?.code === "invalid_key", JSON.stringify(r.json));
  r = await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: KEY, phone: "+5215500000099" }) });
  ok("número ajeno → 422 number_not_found", r.res.status === 422 && r.json?.error?.code === "number_not_found", JSON.stringify(r.json));
  ok("nada se guardó", (await api("/api/settings/ycloud")).json?.connection === null);

  console.log("\n== Conectar: webhook automático ==");
  r = await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: KEY, phone: BIZ }) });
  ok("conexión guardada", r.res.ok && r.json?.webhook === "registered", JSON.stringify(r.json));
  let ob = await outbox();
  ok("el webhook quedó registrado en YCloud", ob.webhooks.length === 1 && ob.webhooks[0].url.includes(`/api/webhooks/yc/${TOKEN}`));
  const st = (await api("/api/settings/ycloud")).json;
  ok("estado conectado, key solo con cola", st?.connection?.status === "connected" && st.connection.apiKeyLast4 === KEY.slice(-4) && !JSON.stringify(st).includes(KEY));

  console.log("\n== Recibir ==");
  r = await simulate({ kind: "inbound", from: CLIENT, to: BIZ, name: "Ana YC", text: "hola desde ycloud", wamid: "wamid.YC.IN.1" });
  ok("entrante firmado aceptado", r.json?.webhookStatus === 200, JSON.stringify(r.json));
  let conv;
  ok("aparece la conversación con nombre de perfil", await hasta(async () => (conv = (await convs()).find((c) => c.contact.name === "Ana YC")) !== undefined));
  ok("el mensaje entró", (await msgs(conv?.id)).some((m) => m.direction === "in" && m.text === "hola desde ycloud"));

  await simulate({ kind: "inbound", from: CLIENT, to: BIZ, name: "Ana YC", text: "hola desde ycloud", wamid: "wamid.YC.IN.1" });
  await sleep(800);
  ok("reenvío del MISMO evento no duplica", (await msgs(conv.id)).filter((m) => m.direction === "in").length === 1);

  r = await simulate({ kind: "inbound", from: CLIENT, to: BIZ, text: "no debería entrar", wamid: "wamid.YC.IN.BAD", badSignature: true });
  ok("firma inválida → 401", r.json?.webhookStatus === 401, JSON.stringify(r.json));
  await sleep(800);
  ok("la firma inválida no dejó mensaje", !(await msgs(conv.id)).some((m) => m.text === "no debería entrar"));

  r = await simulate({ kind: "inbound", fromUserId: "US.YC.E2E.1", to: BIZ, name: "Sin Teléfono", text: "soy bsuid", wamid: "wamid.YC.IN.2" });
  let bs;
  ok("entrante solo con BSUID crea contacto sin teléfono", await hasta(async () => (bs = (await convs()).find((c) => c.contact.name === "Sin Teléfono")) !== undefined) && bs.contact.phone === null);

  console.log("\n== Responder y estados ==");
  r = await api(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "¡Hola Ana!" }) });
  ok("respuesta enviada", r.res.ok, JSON.stringify(r.json));
  ob = await outbox();
  let sent = ob.sent.find((s) => s.body.text?.body === "¡Hola Ana!");
  // México: el 1 de móvil (521…) se envía como 52…, igual que con Meta.
  ok("sale por sendDirectly con from/to en E.164", sent?.body.from === BIZ && sent?.body.to === "+525598765432" && sent?.body.type === "text", JSON.stringify(sent?.body));
  ok("el mensaje queda pendiente de acuse", (await msgs(conv.id)).find((m) => m.text === "¡Hola Ana!")?.status === "pending");

  await simulate({ kind: "status", wamid: sent.wamid, status: "delivered", from: BIZ, to: CLIENT });
  ok("delivered avanza el estado", await hasta(async () => (await msgs(conv.id)).find((m) => m.text === "¡Hola Ana!")?.status === "delivered"));
  await simulate({ kind: "status", wamid: sent.wamid, status: "sent", from: BIZ, to: CLIENT });
  await sleep(700);
  ok("un `sent` tardío no retrocede el estado", (await msgs(conv.id)).find((m) => m.text === "¡Hola Ana!")?.status === "delivered");

  r = await api(`/api/conversations/${bs.id}/messages`, { method: "POST", body: JSON.stringify({ text: "a un bsuid" }) });
  ok("se le puede responder a un contacto sin teléfono", r.res.ok, JSON.stringify(r.json));
  sent = (await outbox()).sent.find((s) => s.body.text?.body === "a un bsuid");
  ok("el BSUID viaja en `recipient`, sin `to`", sent?.body.recipient === "US.YC.E2E.1" && !sent?.body.to, JSON.stringify(sent?.body));

  console.log("\n== Adjuntos ==");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const form = new FormData();
  form.set("file", new File([png], "foto.png", { type: "image/png" }));
  form.set("caption", "mira");
  r = await api(`/api/conversations/${conv.id}/messages/media`, { method: "POST", body: form });
  ok("adjunto saliente enviado", r.res.status === 201, JSON.stringify(r.json));
  ob = await outbox();
  sent = ob.sent.find((s) => s.body.type === "image");
  ok("se subió a YCloud y se envió por id", ob.uploads === 1 && /^ycmedia_/.test(sent?.body.image?.id ?? "") && sent?.body.image?.caption === "mira", JSON.stringify(sent?.body));

  await simulate({ kind: "inbound", from: CLIENT, to: BIZ, withImage: true, text: "foto del cliente", wamid: "wamid.YC.IN.IMG" });
  let imgMsg;
  ok("adjunto entrante registrado", await hasta(async () => (imgMsg = (await msgs(conv.id)).find((m) => m.type === "image" && m.direction === "in")) !== undefined));
  const assetId = imgMsg?.media?.assetId;
  ok("el adjunto entrante se descarga y se sirve", await hasta(async () => (await fetch(`${BASE}/api/media/${assetId}`, { headers: { cookie } })).status === 200));

  console.log("\n== Anuncio de origen ==");
  await simulate({
    kind: "inbound", from: "+5215511110000", to: BIZ, name: "Desde Anuncio", text: "vi su anuncio", wamid: "wamid.YC.IN.AD",
    referral: { source_url: "https://fb.me/ad1", source_id: "AD-123", source_type: "ad", headline: "Oferta de otoño", ctwa_clid: "CLID-E2E" },
  });
  let adConv;
  ok("la conversación muestra el anuncio de origen", await hasta(async () => (adConv = (await convs()).find((c) => c.contact.name === "Desde Anuncio"))?.anuncio?.headline === "Oferta de otoño"));

  console.log("\n== Plantillas ==");
  await mock({
    templates: [
      { official_id: "off_1", name: "recordatorio", language: "es_MX", status: "PENDING", category: "UTILITY",
        components: [{ type: "BODY", text: "Hola {{1}}, tu cita es mañana" }] },
    ],
  });
  r = await api("/api/templates/sync", { method: "POST" });
  ok("sync importa la plantilla creada en YCloud", r.res.ok, JSON.stringify(r.json));
  let tpl;
  ok("aparece como pendiente", await hasta(async () => (tpl = (await api("/api/templates")).json?.templates?.find((t) => t.name === "recordatorio")) !== undefined) && tpl.status === "pending");
  r = await api(`/api/conversations/${conv.id}/messages/template`, { method: "POST", body: JSON.stringify({ templateId: tpl.id, variables: ["Ana"] }) });
  ok("una plantilla pendiente no se puede enviar", !r.res.ok);
  await simulate({ kind: "template", templateName: "recordatorio", language: "es_MX", status: "APPROVED", wabaId: "WABA-YC-E2E" });
  ok("el webhook de plantilla la aprueba", await hasta(async () => (await api("/api/templates")).json?.templates?.find((t) => t.name === "recordatorio")?.status === "approved"));
  r = await api(`/api/conversations/${conv.id}/messages/template`, { method: "POST", body: JSON.stringify({ templateId: tpl.id, variables: ["Ana"] }) });
  ok("la plantilla aprobada se envía", r.res.ok, JSON.stringify(r.json));
  sent = (await outbox()).sent.find((s) => s.body.type === "template");
  ok("sale con nombre, idioma y parámetros", sent?.body.template?.name === "recordatorio" && sent.body.template.language?.code === "es_MX" && sent.body.template.components?.[0]?.parameters?.[0]?.text === "Ana", JSON.stringify(sent?.body));

  console.log("\n== Infelices al enviar ==");
  await mock({ sendFail: 503 });
  r = await api(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "con YCloud caído" }) });
  ok("YCloud caído → 503", r.res.status === 503, `status=${r.res.status}`);
  ok("el error le llega al operador con un motivo legible", /YCloud/.test(r.json?.error?.message ?? ""), JSON.stringify(r.json));
  ok("el CRM sigue respondiendo", (await fetch(`${BASE}/api/health`)).ok);
  // Un rechazo POSTERIOR (evento `failed`) sí deja el mensaje `failed` con su motivo.
  await mock({ sendFail: null });
  r = await api(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "rebota despues" }) });
  const rebota = (await outbox()).sent.find((s) => s.body.text?.body === "rebota despues");
  await simulate({ kind: "status", wamid: rebota?.wamid, status: "failed", from: BIZ, to: CLIENT, errorCode: "131047", errorMessage: "Re-engagement message" });
  ok("un `failed` posterior deja el mensaje fallido con motivo", await hasta(async () => {
    const m = (await msgs(conv.id)).find((x) => x.text === "rebota despues");
    return m?.status === "failed" && !!m.error;
  }));
  await mock({ sendFail: 401 });
  r = await api(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "key revocada" }) });
  ok("key revocada → 409 reconnect_required", r.res.status === 409, `status=${r.res.status} ${JSON.stringify(r.json)}`);
  ok("la conexión queda marcada para reconectar", (await api("/api/settings/ycloud")).json?.connection?.status === "reconnect_required");
  await mock({ sendFail: null });
  r = await api(`/api/conversations/${conv.id}/messages`, { method: "POST", body: JSON.stringify({ text: "sigue bloqueado" }) });
  ok("mientras no se reconecte, no se envía", r.res.status === 409);
  r = await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: KEY, phone: BIZ }) });
  ok("reconectar con la key buena", r.res.ok && (await api("/api/settings/ycloud")).json?.connection?.status === "connected");

  console.log("\n== Webhook que no se puede registrar ==");
  await api("/api/settings/ycloud", { method: "DELETE" });
  await mock({ failWebhook: true });
  r = await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: KEY, phone: BIZ }) });
  ok("la conexión se guarda igual, con webhook pendiente", r.res.ok && r.json?.webhook === "pending" && String(r.json?.webhookUrl).includes("/api/webhooks/yc/"), JSON.stringify(r.json));
  ok("sin secreto, el webhook rechaza (la firma es obligatoria)", (await simulate({ kind: "inbound", from: CLIENT, to: BIZ, text: "x", wamid: "wamid.YC.PEND" })).json?.webhookStatus === 401);
  r = await api("/api/settings/ycloud", { method: "PATCH", body: JSON.stringify({ webhookSecret: "secreto-manual" }) });
  ok("el operador completa el secreto a mano", r.res.ok && (await api("/api/settings/ycloud")).json?.connection?.webhookStatus === "registered");
  await mock({ failWebhook: false });

  console.log("\n== Exclusividad con Meta ==");
  await api("/api/settings/ycloud", { method: "DELETE" });
  await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: KEY, phone: BIZ }) });
  r = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "WABA-X", phoneNumberId: "PN-YC-E2E", token: "tok" }) });
  ok("con YCloud conectado, Meta responde 409", r.res.status === 409 && r.json?.error?.code === "provider_conflict", JSON.stringify(r.json));
  r = await api("/api/settings/ycloud", { method: "DELETE" });
  ok("desconectar YCloud", r.res.ok);
  ok("el webhook se borró en YCloud", (await outbox()).webhooks.length === 0);
  r = await api("/api/settings/whatsapp", { method: "PUT", body: JSON.stringify({ wabaId: "WABA-X", phoneNumberId: "PN-YC-E2E", token: "tok" }) });
  ok("liberado, Meta conecta", r.res.ok, JSON.stringify(r.json));
  r = await api("/api/settings/ycloud", { method: "PUT", body: JSON.stringify({ apiKey: KEY, phone: BIZ }) });
  ok("con Meta conectado, YCloud responde 409", r.res.status === 409 && r.json?.error?.code === "provider_conflict", JSON.stringify(r.json));
}

main()
  .then(() => {
    console.log(failures ? `\n${failures} check(s) fallaron` : "\nTodos los checks pasaron");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
