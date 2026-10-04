# E2E — WhatsApp por YCloud (spec 020)

Automatizado en `scripts/e2e-ycloud.mjs` (`pnpm test:e2e:ycloud`). Este guion
describe lo que cubre; el arnés lo conduce contra la app real con el
`ycloud-mock` (`src/app/api/dev/ycloud-mock/`).

## Preparación

- BD de pruebas LIMPIA (el último tramo deja Meta conectado).
- App con `WA_MOCK_ENABLED=true`, `WHATSAPP_PROVIDERS=meta,ycloud`,
  `YCLOUD_BASE_URL=http://localhost:3000/api/dev/ycloud-mock/v2` y
  `META_GRAPH_BASE_URL` → wa-mock.
- Segunda pasada con `WHATSAPP_PROVIDERS` VACÍA (no ausente: Next recarga
  `.env`): `E2E_YC_FLAG_OFF=1 pnpm test:e2e:ycloud`.

## Historias

1. **Conectar** — key inválida y número ajeno se rechazan sin guardar; la
   conexión buena registra el webhook en YCloud y la key solo se muestra por su
   cola.
2. **Recibir** — entrante firmado crea contacto y conversación; el mismo evento
   reenviado no duplica; firma inválida → 401 sin efectos; solo BSUID crea un
   contacto sin teléfono.
3. **Responder** — sale por `sendDirectly` con `from`/`to` en E.164 (móvil MX
   521→52); un BSUID viaja en `recipient`; los estados avanzan y un `sent`
   tardío no retrocede; un `failed` posterior deja el mensaje fallido con motivo.
4. **Adjuntos** — saliente por subida + id; entrante se descarga y se sirve.
5. **Anuncio** — el `referral` deja la marca del anuncio en la conversación.
6. **Plantillas** — la creada en el panel de YCloud se importa; pendiente no se
   envía; el webhook la aprueba; aprobada se envía con nombre/idioma/parámetros.
7. **Infelices** — YCloud caído (503) → error legible y el CRM sigue; key
   revocada (401) → `reconnect_required` y se bloquea el envío hasta reconectar;
   webhook que no se puede registrar → conexión guardada con `pending`, la
   firma obligatoria rechaza hasta completar el secreto a mano.
8. **Exclusividad** — con YCloud conectado, Meta responde 409 (y al revés);
   desconectar borra el webhook en YCloud y libera al otro proveedor.
9. **Bandera apagada** — `/api/settings/ycloud` y `/api/webhooks/yc/<token>`
   responden 404 y la URL de YCloud no se anuncia.
