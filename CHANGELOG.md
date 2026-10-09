# Cambios

Qué trae cada versión de Vocero CRM y qué hacer para actualizar. La versión
sigue el SemVer del [README](README.md#versiones): una menor trae funciones
nuevas y actualizar es redesplegar. Desde 1.4.0, cada tag `vX.Y.Z` publica la
imagen `ghcr.io/kevinrivm/vocero-crm:X.Y.Z`.

## Sin publicar

### El agente y la agenda: el día que pide el cliente

- **Antes**, `offer_slots` no llevaba fecha: el agente ofrecía siempre los
  primeros huecos desde hoy, pidiera el cliente el día que pidiera, y la frase
  que escribía el modelo («…para el lunes 12:») quedaba sobre una lista de otro
  día. **Ahora** `offer_slots` lleva `date` (YYYY-MM-DD en la zona del negocio),
  el prompt le dice al modelo qué día es hoy, y cuando hay fecha la frase de
  entrada la escribe el sistema con el día real. Un día cerrado, lleno, pasado o
  fuera del horizonte se dice con claridad y se ofrece lo más próximo.
- Con la agenda encendida, pedir una **demo, cita, reunión o videollamada**
  se agenda: ya no se escala ni cuenta como «fuera del conocimiento».
- No hay variables nuevas ni migración.

### WhatsApp por YCloud (opcional)

Nueva forma de conectar el número de WhatsApp: con la API key de YCloud, sin app
de desarrollador en Meta. Apagada por defecto.

- **Activarla.** `WHATSAPP_PROVIDERS=meta,ycloud` y **Configuración → YCloud**.
  Guía: [docs/ycloud.md](docs/ycloud.md); diseño:
  [specs/020-ycloud-whatsapp](specs/020-ycloud-whatsapp/spec.md).
- **Migración `0016_ycloud_credentials`.** Solo agrega la tabla (con RLS
  activado). Se aplica siempre, aunque YCloud esté apagado.
- **Adjuntos en Postgres** (`0015_media_blob`): los adjuntos, el logo y el icono
  se guardan en la base en vez del volumen `/data`, para poder correr en
  plataformas sin disco persistente (Vercel). `MEDIA_DIR` ya no se usa.
- **Actualizar.** Sin variables obligatorias nuevas. Una instancia con Meta
  directo no cambia.

## 1.4.0 — 2026-09-30

### Actualizar desde 1.3.0

Actualizar es redesplegar: no hay variables obligatorias nuevas ni nada que
reconectar. Respalda la base antes, como en cualquier actualización.

- **Cómo.** En Coolify, con la app que construye desde el repo (la de la guía
  hasta 1.3.0), redespliega. Con docker compose, `git pull` y
  `docker compose up -d`: el compose ahora descarga la imagen publicada. Con
  `--build` la sigue construyendo desde el código, que es lo que necesitas en
  un VPS ARM (la imagen es `linux/amd64`) o si tu fork tiene cambios propios.
- **Migraciones.** Corren solas al arrancar el contenedor, sin
  Pre-Deployment Command. Hay dos nuevas, y las dos solo agregan:
  - `0013_nombre_del_contacto`: la columna `contact.name_source`.
  - `0014_anuncio_de_origen`: la columna `ad_attribution.image_asset_id`, su
    llave foránea a `media_asset` y un índice.

  Van en una sola transacción: si una falla no queda ninguna, la app no
  arranca y el log dice `[migrate] falló tras varios intentos`. Si tu fork
  tiene migraciones propias posteriores a la `0012`, comprueba después que
  existan esas dos columnas: el migrador salta en silencio toda migración
  cuyo `when` no sea mayor que el de la última aplicada. Si falta una, corre a
  mano su SQL de `drizzle/`.
- **Nombres de contacto.** El nombre ahora sigue al perfil de WhatsApp, salvo
  que lo haya escrito una persona en el CRM. La `0013` deja como «del perfil»
  todos los contactos que ya existían: uno que renombraste a mano tomará su
  nombre de WhatsApp la próxima vez que escriba. Para conservar esos nombres,
  corre esto en la consola de Postgres justo después de actualizar (antes la
  columna no existe; con docker compose,
  `docker compose exec postgres psql -U postgres -d vocero`):

  ```sql
  UPDATE "contact" SET "name_source" = 'manual';
  ```

  Con eso ningún contacto viejo sigue a su perfil; los nuevos, sí. Quien
  escriba entre el arranque y el `UPDATE` ya habrá tomado su nombre de perfil.
- **Adjuntos, logo e icono.** La imagen los guarda en `/data/media` (trae
  `MEDIA_DIR=/data/media`) y arranca como root solo para darle el volumen de
  `/data` al usuario de la app. Qué hacer según cómo esté tu contenedor:

  | Tu instancia en 1.3.0 | Qué hacer |
  |---|---|
  | `MEDIA_DIR` sin definir o `./.dev-media` (la guía y el `.env.example` de 1.3.0) | Quita `MEDIA_DIR` si la tienes y monta un volumen en `/data` si aún no hay (en Coolify, un persistent storage). No hay nada que rescatar: esa ruta no era escribible y guardar un adjunto, el logo o el icono fallaba. |
  | Volumen en `/data/media`, con `MEDIA_DIR=/data/media` (la nota del `.env.example` de 1.3.0) | No muevas el volumen: 1.4.0 usa esa misma ruta y le arregla los permisos al arrancar. `MEDIA_DIR` ya sobra. Para montarlo en `/data`, como dice la guía nueva, primero pasa su contenido a una carpeta `media/` dentro del volumen. |
  | `MEDIA_DIR=/data/media` sin volumen | Tus archivos están dentro del contenedor y el redeploy los borra. Sácalos antes de actualizar (`docker cp <contenedor>:/data/media ./media`); con el volumen ya en `/data`, devuélvelos (`docker cp ./media/. <contenedor>:/data/media`) y reinicia la app para que el contenedor les dé dueño. |
  | docker compose | Nada: el compose nuevo monta el volumen `vocero_app_data` en `/data`. El de 1.3.0 no montaba volumen para la app, así que no había archivos guardados. |

  La imagen ya no declara `USER`: `docker exec` entra como root. Para actuar
  como la app, `docker exec -u vocero …`.
- **Variables.** Ninguna obligatoria nueva.
  - `BRAIN_HEALTH_URL` (opcional): el `/health` de tu cerebro externo, p. ej.
    `http://nea:8000/health`, para la tarjeta «Quién responde a tus
    clientes». Tiene que ser una URL `http://` o `https://` completa; si no
    lo es, la tarjeta lo marca como problema de configuración y el resto de
    la app sigue funcionando ([#74]). Vacía cuenta como no definida.
  - `SOURCE_COMMIT` escrito a mano en la plataforma: si el build no trae su
    propio commit, la barra lo marca «commit sin verificar» y `/api/health`
    responde `"commitVerified":false`. Quítalo, o pásalo como build arg en
    cada build (README → Versiones). La imagen publicada ya trae el suyo.
  - Solo docker compose: `VOCERO_CRM_VERSION` elige la versión de la imagen
    (por defecto, la de esta versión). Y el compose ahora le pasa a la app
    `CHANNELS`, `AGENDA`, `ATRIBUCION`, `BOT_API_KEY` y `BRAIN_HEALTH_URL`: en
    1.3.0 no le llegaban, así que lo que tengas escrito de ellas en tu `.env`
    empieza a surtir efecto.
- **Banderas.** `AGENDA`, `ATRIBUCION` y `CHANNELS` no cambian de nombre y
  siguen apagadas por defecto. Cambia lo que cubre `ATRIBUCION`: de qué
  anuncio llegó cada conversación (titular, texto, creativo, enlace) se guarda
  y se ve siempre, con o sin la bandera. Sin ella no se guarda el `ctwa_clid`
  ni se le reporta nada a Meta.
- **Override del webhook (cerebro externo o modo agencia).** En 1.3.0, cada
  vez que guardabas la conexión en Configuración → WhatsApp (o rotabas el
  token) se re-suscribía la app sin cuerpo, que es como Meta borra el
  override de callback de la WABA. 1.4.0 ya no lo hace, pero no devuelve uno
  que ya se perdió: revisa `GET /{WABA_ID}/subscribed_apps` y, si falta
  `override_callback_uri`, vuelve a ponerlo con la URL de quien debe recibir
  los webhooks (la llamada está en README → modo agencia, paso 4).
- **Si conectas tu propio cerebro por `/api/bot/*`.**
  - Límite nuevo: primero se autentica y después se cuenta. Con la llave
    buena hay 1200 llamadas por minuto (antes 600, contadas antes de mirar la
    llave). Las fallidas, sin llave o con una mala, se frenan por IP: pasadas
    30 en un minuto responden `429 rate_limited` («Demasiados intentos
    fallidos») en vez de `401`. Si tu bot recibe ese 429, revisa su llave.
  - `GET /api/bot/availability` sin `limit`, `perDay` ni `days` ahora
    devuelve los defaults del contrato (12 huecos, 3 por día, 5 días); antes,
    un solo hueco.
  - Lo demás es aditivo (`booking` en el contexto, `date` y `query` en los
    huecos): un bot que no lee los campos nuevos no nota nada.
- **Imagen publicada.** `ghcr.io/kevinrivm/vocero-crm:1.4.0`, solo
  `linux/amd64`, con el commit horneado. Es el camino nuevo para instalar
  ([INSTALL-IA.md](INSTALL-IA.md)). Una instancia que construye desde el repo
  puede seguir así. Si la pasas a la imagen con otra app de Coolify, su
  volumen de `/data` es otro: copia los archivos antes de apagar la vieja.

### Nuevo

- **Resultados** (`/results`, en el menú, sin bandera): ventas, origen y
  anuncios, el agente y lo que se está cayendo, contra el periodo anterior.
  Todo sale de la base propia: sin gasto publicitario ni conectores, y el
  Laboratorio no cuenta. Las citas del agente, solo con `AGENDA`. Los días se
  cortan en la zona de la agenda; si no hay agenda configurada, en
  `America/Mexico_City`. ([#70])
- **De qué anuncio llegó cada conversación**, sin bandera: marca «Anuncio ·
  titular» y filtro «Anuncios» en la bandeja; tarjeta con el creativo, el
  texto y el enlace en el panel del contacto y en el cajón del trato. La
  imagen del creativo se copia al volumen (solo de hosts de Meta, hasta
  300 KB). Solo WhatsApp. ([#67])
- **Calendario de Citas** (con `AGENDA`): vistas Día, Semana, Mes y Lista en
  la zona del negocio, panel de la cita con «Abrir conversación», reprogramar
  con todos los huecos de la ventana y bloquear un horario tocando la
  rejilla. `GET /api/bookings` acepta `from` y `to` (hasta 92 días); sin
  ellos responde igual que antes. ([#66])
- **«Quién responde a tus clientes»**, arriba de la pantalla Agente: el
  agente incluido, tu cerebro externo o los dos, con aviso rojo porque el
  cliente recibiría dos respuestas. `GET /api/agent/brain-status`. ([#69])
- Para tu bot, con `AGENDA`: `GET /api/bot/context` trae las citas del lead
  (`booking`), y `GET /api/bot/availability` con `date=AAAA-MM-DD` da las
  horas libres de ese día, con `query` diciendo hasta dónde llega lo
  consultado. ([#65], [#71])
- El logo que subes se ve en la barra lateral, en el login y en la vista
  previa de Configuración → Marca. ([#64])
- La imagen de Docker se construye en cada PR y se publica en GHCR con cada
  tag. ([#68])
- `/api/health` dice si el commit salió del build (`commitVerified`). ([#65])

### Cambió

- La barra lateral es azul marino en los dos temas, y el tema oscuro sube la
  página un escalón sobre ella: diálogos y cajones flotan, su texto pasa AA de
  contraste y el foco por teclado se ve. Con un acento propio claro (verde,
  amarillo…), la tinta de botones y distintivos pasa de blanco a casi negro
  cuando el blanco no llega a 4.5:1. ([#64], [#72])
- El Agente y «IA en esta conversación» usan el mismo interruptor, con el
  pomo dentro de la pista. ([#64])
- El nombre del contacto sigue a su perfil de WhatsApp, salvo que lo haya
  escrito una persona. ([#56])
- `/api/bot/*` autentica antes de contar: 1200 llamadas por minuto con llave
  válida y 30 fallidas por minuto por IP. ([#73])
- `ATRIBUCION` ya no decide si ves el anuncio de origen: solo el `ctwa_clid`,
  la Conversions API y Configuración → Anuncios. ([#67])
- La imagen trae `MEDIA_DIR=/data/media` y un entrypoint que deja `/data`
  escribible antes de bajar al usuario de la app. ([#63])
- La insignia de versión marca «commit sin verificar» cuando el commit no
  salió del build. ([#65])
- docker compose usa la imagen publicada, `--build` la construye desde el
  código, y ahora le pasa a la app `CHANNELS`, `AGENDA`, `ATRIBUCION`,
  `BOT_API_KEY` y `BRAIN_HEALTH_URL`.

### Corregido

- Cuando el patrón de respaldo detecta que el cliente pide un humano, el
  agente le avisa antes del traspaso («Claro, te comunico con una persona del
  equipo. En breve te responden.»); antes lo traspasaba sin mandarle nada.
  ([#65])
- El agente incluido reserva el horario que el cliente elige; antes no
  acertaba el instante y la conversación entraba en bucle. ([#54])
- A un contacto sin teléfono (solo BSUID) se le responde; antes Meta
  devolvía 131026. ([#57])
- Con Postgres fuera de UTC, un saliente enseñaba otra hora en el hilo que en
  la lista. Las filas escritas antes conservan su valor; en Docker nunca
  pasó. ([#58])
- En la instalación por defecto, guardar un adjunto, el logo o el icono
  fallaba por permisos. ([#63])
- Guardar la conexión de WhatsApp, o rotar el token, borraba el override de
  callback de la WABA y dejaba sin mensajes a un cerebro externo. ([#63])
- La prueba de conexión de Google Calendar daba 403 con credenciales
  correctas, y un cambio de credenciales de Google o Zoom tardaba hasta una
  hora en surtir efecto. ([#55])
- A «¿mañana en la tarde?» tu bot solo veía las primeras horas del día:
  `/api/bot/availability` ignoraba `date`. ([#71])
- `GET /api/bot/context?waIdentity=bsuid:…` respondía 404 a quien escribió
  primero con teléfono. ([#73])
- 600 llamadas por minuto sin llave dejaban a tu bot en 429. ([#73])
- Calendario: el bloqueo tomaba la hora del navegador, reprogramar ofrecía
  solo 12 huecos, cada evento recalculaba la disponibilidad y la lista se
  quedaba en las últimas 200 citas. ([#66])
- El pomo del interruptor del Agente no se veía y, encendido, se salía de la
  pista. ([#56], [#64])

Gracias a @Diony7004, @federicorv25, @fondeur27-09-73, @dev-bahari,
@davidcaroo y @dean-wya por los reportes, los diagnósticos y el código.

## 1.3.0 y anteriores

Sin entrada aquí: lo anterior está en el tag
[`v1.3.0`](https://github.com/kevinrivm/vocero-crm/tree/v1.3.0) (2026-09-01).

[#54]: https://github.com/kevinrivm/vocero-crm/pull/54
[#55]: https://github.com/kevinrivm/vocero-crm/pull/55
[#56]: https://github.com/kevinrivm/vocero-crm/pull/56
[#57]: https://github.com/kevinrivm/vocero-crm/pull/57
[#58]: https://github.com/kevinrivm/vocero-crm/pull/58
[#63]: https://github.com/kevinrivm/vocero-crm/pull/63
[#64]: https://github.com/kevinrivm/vocero-crm/pull/64
[#65]: https://github.com/kevinrivm/vocero-crm/pull/65
[#66]: https://github.com/kevinrivm/vocero-crm/pull/66
[#67]: https://github.com/kevinrivm/vocero-crm/pull/67
[#68]: https://github.com/kevinrivm/vocero-crm/pull/68
[#69]: https://github.com/kevinrivm/vocero-crm/pull/69
[#70]: https://github.com/kevinrivm/vocero-crm/pull/70
[#71]: https://github.com/kevinrivm/vocero-crm/pull/71
[#72]: https://github.com/kevinrivm/vocero-crm/pull/72
[#73]: https://github.com/kevinrivm/vocero-crm/pull/73
[#74]: https://github.com/kevinrivm/vocero-crm/pull/74
