# WhatsApp por YCloud

YCloud es un proveedor de la API de WhatsApp Business (BSP). Con él puedes
conectar tu número a Vocero **sin crear una app de desarrollador en Meta**: solo
necesitas una API key de YCloud. Es una forma alterna de conectar el mismo canal
de WhatsApp, no un canal nuevo: la bandeja, el agente, el Laboratorio, las
plantillas y el origen de anuncios funcionan igual.

Es un conector **opcional**: viaja siempre en el código pero está apagado por
defecto ([ADR-001](adr-001-canales-opcionales.md)). Detalle de diseño en
[`specs/020-ycloud-whatsapp`](../specs/020-ycloud-whatsapp/spec.md).

## Encenderlo

En las variables de la instancia (runtime, no build):

```bash
WHATSAPP_PROVIDERS=meta,ycloud
```

Sin ella, `/api/settings/ycloud` y `/api/webhooks/yc/*` responden 404, la
pestaña no aparece y no se pide nada. Meta directo siempre está disponible.

## Conectar el número

1. En YCloud: **Developers → API Keys** → crea una key. Se muestra una sola vez.
   El número de WhatsApp debe estar ya registrado en tu cuenta de YCloud.
2. En Vocero: **Configuración → YCloud** → pega el número (con código de país)
   y la API key → **Probar y guardar**.
3. Vocero valida la key y el número, **registra el webhook en YCloud por ti**,
   guarda su secreto cifrado y trae las plantillas de tu cuenta.

La API key se guarda cifrada (AES-256-GCM); en pantalla solo se ve su cola.

### Si el webhook no se pudo registrar solo

La conexión se guarda igual y la pantalla muestra «Completa el webhook». En
YCloud → **Developers → Webhooks** crea un endpoint con la URL que te muestra
Vocero y los eventos de mensajes y plantillas de WhatsApp, y pega el secreto que
YCloud te da en Vocero → **Guardar secreto**. Mientras falte el secreto, los
mensajes entrantes se rechazan: la firma es obligatoria.

## Una cuenta de YCloud, una instancia de Vocero

Los endpoints de webhook de YCloud son **de la cuenta**: reciben los eventos de
todos sus números. Por eso una cuenta de YCloud debe conectarse a UNA sola
instancia de Vocero. Si dos instancias (o dos organizaciones) comparten la
cuenta, cada una recibiría los eventos de la otra, los rechazaría por firma y
YCloud reintentaría hasta desactivar el endpoint. Un negocio, una cuenta.

## Una instancia, un proveedor

Una organización usa Meta directo **o** YCloud, no los dos. Para cambiar:
desconecta el actual (en YCloud, **Desconectar** también borra el webhook allá)
y conecta el otro. Intentar conectar uno con el otro activo responde 409.

## Cómo se comporta

- **Adjuntos entrantes**: Vocero los descarga de la URL que trae el webhook y
  solo envía tu API key a `ycloud.com`, por https; un enlace a una red privada
  se rechaza.
- **Entrantes**: llegan firmados (`YCloud-Signature`, HMAC-SHA256 con tolerancia
  de 5 minutos). Una firma inválida se rechaza con 401 y no deja rastro. Los
  reintentos de YCloud no duplican mensajes.
- **Salientes**: texto, adjuntos y plantillas, con los acuses de entrega y
  lectura. Un móvil de México (`521…`) se envía como `52…`, igual que con Meta.
- **Contactos sin teléfono** (BSUID): se les responde por su identificador.
- **Plantillas**: se crean en el panel de YCloud y **Sincronizar** (Configuración
  → Plantillas) las importa con su estado; el webhook las mantiene al día. Crear
  plantillas desde Vocero no está disponible con YCloud.
- **«Escribiendo…»**: con YCloud solo se marca el mensaje como leído.
- **Si YCloud falla**: el operador ve el error y el CRM sigue funcionando; si la
  key se revoca (401), la conexión queda en «reconectar» y el envío se pausa
  hasta pegar una nueva. Un 403 de una operación suelta no pausa el canal.
- **Si el procesamiento de un evento falla** (p. ej. la base no responde),
  Vocero contesta 500 para que YCloud lo reintente; la ingesta es idempotente.
- **Reconectar** registra el webhook nuevo antes de borrar el viejo, así una
  falla a medias no te deja sin recepción.
- **Atribución (CAPI)** funciona igual con YCloud: usa el WABA de la conexión.

## Pruebas

`pnpm test:e2e:ycloud` conduce la app real con un mock de YCloud
(`src/app/api/dev/ycloud-mock/`); ver el encabezado del script para la BD limpia
y la segunda pasada con la bandera apagada. Guion: `tests/e2e/us-ycloud.md`.
