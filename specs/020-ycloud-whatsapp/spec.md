# 020 — WhatsApp por YCloud (proveedor alterno del canal)

**Carril**: ciclo completo. Criterio objetivo de la constitución (Principio VI):
toca el modelo de datos (migración: tabla de credenciales) y dos superficies
públicas (webhook y ajustes del proveedor).

**Escrito antes del código.** YCloud no es un canal nuevo: es **otra forma de
conectar el canal WhatsApp** que ya existe. Entra como conector opcional bajo
la Soberanía endurecida (II, 1.4.0) y el patrón de
[ADR-001](../../docs/adr-001-canales-opcionales.md): apagado por defecto tras
bandera, aislado tras un adaptador con contrato, con degradación definida y
credenciales cifradas.

## Problema

Hoy Vocero habla con WhatsApp solo por la Graph API de Meta: el negocio
necesita su propia app de desarrollador, un System User token y el alta del
WABA. Muchos negocios ya tienen su número en **YCloud** (un BSP) y solo
tienen una API key. Para ellos Vocero es inalcanzable sin rehacer su alta.

## Decisiones tomadas (brainstorming)

- **Enfoque A**: un proveedor intercambiable *dentro* del canal WhatsApp
  (`meta | ycloud`). Se descartó YCloud como canal aparte (duplica ventana de
  24 h y plantillas, y parte el mismo teléfono en dos contactos) y un proxy
  que imite la Graph API (frágil).
- **Paridad completa con Meta**: texto, adjuntos, plantillas, acuses,
  origen de anuncios y las funciones del agente.
- **Uno u otro por instancia/organización**, nunca ambos a la vez.
- **Webhook automático**: al conectar, Vocero lo registra en YCloud por API,
  con respaldo manual si falla.

## Escenarios

1. **Conectar**: el propietario entra a Configuración → WhatsApp, elige
   YCloud, pega su API key y su número; Vocero valida la key, registra el
   webhook, sincroniza plantillas y muestra «Conectado».
2. **Recibir**: un cliente escribe al número; el mensaje aparece en la
   bandeja con contacto y conversación, igual que por Meta.
3. **Responder**: el operador o el agente responde y el mensaje llega al
   cliente; el estado avanza (enviado → entregado → leído).
4. **Plantillas**: fuera de la ventana de 24 h el operador envía una plantilla
   aprobada; las plantillas del negocio se sincronizan desde YCloud.
5. **Adjuntos**: se reciben y se envían imágenes, audio, video y documentos.
6. **Anuncios**: una conversación que nace de un anuncio Click-to-WhatsApp
   muestra su origen igual que hoy.
7. **Desconectar / cambiar**: desconectar borra el webhook en YCloud y libera
   al negocio para conectar Meta (o al revés).
8. **Sin regresión**: una instancia con Meta, o con la bandeja de Instagram o
   Messenger, funciona idéntica a antes.

## Requisitos

- **FR-301** Bandera de despliegue `WHATSAPP_PROVIDERS` (lista separada por
  comas; default `meta`). `ycloud` solo existe si está en la lista. Con él
  apagado, `/api/settings/ycloud` y `/api/webhooks/yc/*` responden 404, la UI
  no lo menciona y no se piden variables. La migración se aplica siempre.
- **FR-302** Existe una interfaz `WhatsAppProvider` con dos implementaciones
  (`meta`, `ycloud`) que cubre: enviar texto, enviar adjunto, enviar
  plantilla, marcar leído, indicador de «escribiendo…», subir y descargar
  adjuntos, listar/crear plantillas y probar la conexión. El código que hoy
  llama a la Graph API de forma directa (`send.ts`, `templates.ts`,
  `media.ts`, `connect.ts`, `api/bot/typing`) pasa a depender del proveedor
  activo de la organización. El comportamiento con Meta no cambia.
- **FR-303** Tabla `ycloud_credentials` (migración aditiva, `organization_id`
  NOT NULL, única por organización): API key y secreto de webhook cifrados con
  el AES-256-GCM existente, número en E.164, `waba_id` opcional, `webhook_id`
  de YCloud, `status` (`connected | reconnect_required`). Hacia fuera solo
  viajan los últimos 4 de la key; jamás a logs ni al cliente.
- **FR-304** Exclusividad: una organización no puede tener a la vez
  `meta_credentials` y `ycloud_credentials`. Intentar conectar un proveedor
  con el otro activo responde 409 con un mensaje que pide desconectar primero.
- **FR-305** La ingesta entra por `/api/webhooks/yc/[webhookToken]` con dos
  capas: el segmento secreto de la ruta (mismo `META_WEBHOOK_VERIFY_TOKEN`) y
  la firma `YCloud-Signature: t=<ts>,s=<hex>`, HMAC-SHA256 de `<ts>.<cuerpo
  crudo>` con el secreto de esa organización, comparación en tiempo constante
  y ventana de tolerancia de 5 minutos. La firma es **obligatoria** (no hay
  modo sin firma). Una firma inválida responde 401 y no procesa nada.
- **FR-306** El webhook responde 200 en menos de 6 s y procesa en `after()`.
  Es idempotente por `wamid` (UNIQUE existente) y los estados son monotónicos,
  porque YCloud reintenta hasta 7 veces.
- **FR-307** Un traductor puro (`src/server/ycloud/translate.ts`, sin BD)
  convierte los eventos de YCloud al formato interno (`WebhookMessage`,
  `WebhookStatus`, `referral`, BSUID). La ingesta, el agente, el pipeline y la
  atribución se reutilizan sin cambios. Eventos: mensaje entrante, mensaje
  actualizado (acuses y fallos) y estado de plantilla. Todo evento
  desconocido se ignora con 200.
- **FR-308** Identidad: se conserva `contact.wa_identity` (teléfono
  normalizado, o `bsuid:<id>` cuando YCloud no trae teléfono —`fromUserId`—).
  Nunca se asume que hay teléfono.
- **FR-309** Cliente único `src/lib/ycloud/client.ts` (único punto de salida
  hacia `api.ycloud.com/v2`, header `X-API-Key`, timeouts, errores tipados).
  Mapeo de errores a los códigos que ya entiende la UI: 401/403 →
  `reconnect_required`; ventana cerrada → `window_closed`; plantilla requerida
  → mismo mensaje que hoy; 5xx/red → `meta_unavailable` (renombrado lógico a
  «proveedor no disponible» en el mensaje al operador).
- **FR-310** Conexión (`POST /api/settings/ycloud`, solo propietario): valida
  la key con una lectura, registra el webhook (`POST /v2/webhookEndpoints`,
  eventos de mensaje entrante, actualización y plantillas), guarda el secreto
  que YCloud devuelve cifrado y sincroniza las plantillas. Si el registro
  automático falla, la conexión **se guarda igual** y la UI muestra la URL
  exacta para pegarla a mano, con el estado «webhook pendiente»; nunca queda a
  medias. `DELETE` borra el webhook en YCloud (mejor esfuerzo) y las
  credenciales.
- **FR-311** Capacidades: `deliveryReceipts`, ventana de 24 h y estrategia
  `template` fuera de ventana son las mismas que WhatsApp por Meta. El núcleo
  las sigue preguntando a `capabilities.ts`; no se añade lógica de proveedor
  al camino genérico de envío.
- **FR-312** Adjuntos: salientes por id de medio subido (`/whatsapp/media/
  {phone}/upload`) o por enlace; entrantes se descargan y se guardan en
  Postgres (`media_blob`) como hoy, con los mismos límites por tipo. Un
  adjunto que no se pueda bajar queda `failed` sin tumbar el mensaje.
- **FR-313** Degradación: si YCloud no responde, el operador recibe un error
  con motivo legible y el CRM sigue operando. Igual que con Meta, un texto
  rechazado en el acto no crea mensaje; el mensaje queda `failed` con su motivo
  cuando YCloud lo rechaza *después* (evento `failed`) o cuando falla un
  adjunto. Si el agente falla por el proveedor, el turno lo tolera y se
  reintenta como cualquier hipo. Una función que YCloud no ofrezca (p. ej.
  «escribiendo…») degrada sin error.
- **FR-314** Sandbox: las conversaciones `is_test` jamás llegan a YCloud; el
  sender lanza excepción igual que hoy (guardrail, no se «arregla»).
- **FR-315** Multi-tenancy: toda query pasa por `scoped()`. El enrutamiento
  del webhook localiza la organización por el número destinatario (`to`) y
  verifica la firma con el secreto *de esa* organización.

## Fuera de alcance

- Dar de alta o registrar el número en YCloud (el negocio ya lo tiene).
- Usar Meta y YCloud a la vez en una misma organización.
- El reporte de conversiones a Meta (CAPI): sigue por su camino y no depende
  del proveedor.
- Migrar conversaciones históricas entre proveedores.

## Pendiente de verificar con una API key real

La documentación pública de YCloud no deja claros estos puntos; se confirman
en un sandbox antes de cerrar las tareas correspondientes y la spec se
enmienda con lo que se encuentre:

1. Endpoint y cuerpo para **crear** plantillas (el listado es
   `GET /v2/whatsapp/templates`).
2. **Descarga de adjuntos entrantes**: campo de URL en el webhook, si exige el
   header `X-API-Key` y su caducidad.
3. Existencia del indicador de «escribiendo…».
4. Forma exacta del evento de estado de plantilla y del objeto `referral`.

## Criterios de éxito

- Con la bandera apagada: suite completa verde y las superficies de YCloud en
  404 (CI corre apagado y encendido).
- Con la bandera encendida y el `ycloud-mock`: conectar, recibir, responder,
  estados, plantilla, adjunto, anuncio y desconectar pasan en `pnpm
  test:e2e`, más los caminos infelices (firma inválida, YCloud caído, webhook
  que no se puede registrar).
- Prueba final contra una cuenta real de YCloud antes de declararlo Hecho
  (resuelve los cuatro puntos pendientes).
