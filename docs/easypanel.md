# Instalar Vocero en Easypanel

Guía para dejar una instancia de Vocero corriendo en un servidor propio con
[Easypanel](https://easypanel.io). Una instancia es **un negocio**: cada cliente
lleva su propia app, su propia base de datos y sus propias variables.

> **Estado de esta guía.** Los pasos de Easypanel salen de su documentación
> pública (servicios [App](https://easypanel.io/docs/services/app) y
> [Postgres](https://easypanel.io/docs/services/postgres)); los de Vocero, del
> propio código. **Todavía no se ha seguido de principio a fin en un servidor
> real.** Lo que dependa de cómo se ve tu panel está marcado con ⚠️: si algo no
> coincide, corrige esta guía con lo que encuentres.

## Antes de empezar

| Necesitas | Detalle |
|---|---|
| Un servidor con Easypanel | Con **2 GB de memoria como mínimo**. Construir la app (`next build`) es lo más pesado; con menos, el build puede morir por falta de memoria. ⚠️ Si pasa, agrega *swap* o sube la memoria durante el build. |
| Un dominio | Con un registro **A** apuntando a la IP del servidor. Easypanel pone el HTTPS. |
| El repositorio | `malemanm/vocero-crm` (tu fork), rama `main`. Es público, así que no hace falta llave de acceso. |
| Una cuenta de YCloud o de Meta | Para conectar el WhatsApp del negocio. **Una cuenta no se comparte entre dos instancias.** |
| (Opcional) Una key de OpenRouter | Sin ella funciona todo menos el agente de IA y el Laboratorio. |

> **Usa el repositorio, no la imagen publicada.** La imagen del proyecto original
> (`ghcr.io/kevinrivm/vocero-crm`) no trae lo que se agregó en este fork
> (YCloud, la pantalla de Instagram, el menú colapsable, etc.).

## 1. Crear el proyecto y la base de datos

1. En Easypanel, crea un **proyecto** (uno por cliente, por ejemplo `dental-sonrisa`).
2. Dentro, **New Service → Postgres**.
   - Nombre del servicio: `db`.
   - Base de datos: `vocero`.
   - Usuario: `postgres`.
   - Contraseña: déjala que Easypanel la genere (o pon una larga y aleatoria).
3. Abre la pestaña **Credentials** del servicio y copia la **URL de conexión
   interna**. La necesitas en el paso 3. Tiene esta forma:
   ```
   postgres://postgres:<contraseña>@<proyecto>_db:5432/vocero?sslmode=disable
   ```
   Vocero la acepta tal cual (con `postgres://` o `postgresql://`, y con o sin
   `?sslmode=disable`: se probó contra un Postgres local).

**Postgres no se expone a internet**; déjalo privado (la pestaña *Expose* apagada).

## 2. Crear la app

1. **New Service → App**, nombre `crm`.
2. **Source → GitHub**: repositorio `malemanm/vocero-crm`, rama `main`.
3. **Build → Dockerfile**, con la ruta `Dockerfile` (está en la raíz del repo).
   No uses Nixpacks ni Buildpacks: el `Dockerfile` ya hace el build correcto y
   corre las migraciones al arrancar.
4. **Domains & Proxy**: tu dominio, **puerto 3000**, **HTTPS activado**.
   La imagen ya escucha en `0.0.0.0:3000`.
5. **No agregues volumen.** En este fork los adjuntos, el logo y el icono viven
   en Postgres, no en disco, así que `/data` no hace falta.
6. **Una sola réplica.** Vocero guarda el tiempo real (SSE) y el trabajo en
   segundo plano (agente, Laboratorio) en la memoria del proceso. Si escalas a
   dos réplicas, los eventos de una no llegan a las pantallas conectadas a la
   otra y el agente podría contestar doble.

## 3. Variables de entorno

En la pestaña **Environment** de la app. Genera los secretos **en tu computadora**
(no en un chat ni en un documento compartido):

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY (exactamente 32 bytes en base64)
openssl rand -hex 32      # META_WEBHOOK_VERIFY_TOKEN
```

| Variable | Valor |
|---|---|
| `APP_BASE_URL` | `https://tu-dominio` (sin barra final) |
| `DATABASE_URL` | La URL interna del paso 1 |
| `BETTER_AUTH_SECRET` | Generado |
| `ENCRYPTION_KEY` | Generado (44 caracteres) |
| `META_WEBHOOK_VERIFY_TOKEN` | Generado |
| `META_GRAPH_API_VERSION` | `v25.0` |
| `WHATSAPP_PROVIDERS` | `meta,ycloud` para conectar por YCloud (sin esto, YCloud no existe) |
| `OPENROUTER_API_TOKEN` | Tu key (si usas el agente) |
| `OPENROUTER_MODEL` | Por ejemplo `anthropic/claude-sonnet-4.5` |
| `OPENROUTER_JUDGE_MODEL` | Opcional: un modelo más barato para el juez del Laboratorio |
| `AGENDA` | `on`, solo si el cliente usa agenda |
| `CHANNELS` | `whatsapp,instagram,messenger`, solo los que use |

**No pongas** `NEXT_PUBLIC_REALTIME_MODE` ni `MIGRATE_DATABASE_URL`: son solo
de Vercel. En Easypanel el tiempo real funciona por SSE y las migraciones corren
al arrancar el contenedor. Además, `NEXT_PUBLIC_*` se fija al construir y no se
puede cambiar después con solo reiniciar.

Las variables se guardan en Easypanel; **no las pongas en el repositorio**.
Guarda una copia de los secretos de cada cliente en tu gestor de contraseñas:
`ENCRYPTION_KEY` en particular **no se puede recuperar**, y sin ella no se pueden
descifrar las credenciales guardadas.

## 4. Desplegar y verificar

1. Pulsa **Deploy**. La primera construcción tarda varios minutos.
2. Al arrancar, el contenedor aplica las migraciones y luego inicia la app. Si
   falla, el log lo dice (`[migrate] falló tras varios intentos`).
3. Verifica desde cualquier terminal:
   ```bash
   curl https://tu-dominio/api/health
   # → {"ok":true,"version":"1.4.0", ...}
   curl -o /dev/null -w "%{http_code}\n" https://tu-dominio/login
   # → 200
   ```
4. **Si pusiste `WHATSAPP_PROVIDERS`**, comprueba que la superficie existe (sin
   sesión debe dar 401, no 404):
   ```bash
   curl -o /dev/null -w "%{http_code}\n" https://tu-dominio/api/settings/ycloud
   # → 401
   ```
   Un 404 ahí significa que la variable no llegó al contenedor: revisa que la
   guardaste y **vuelve a desplegar** (Easypanel aplica las variables en el
   siguiente despliegue).

## 5. Primer uso

1. Entra a `https://tu-dominio` y **regístrate**: el primer registro crea la
   organización del negocio. Después el registro público se cierra solo.
2. **Configuración → YCloud**: el número con código de país y la API key de
   YCloud. Vocero valida los datos y **registra solo el webhook** en YCloud.
   Para que eso funcione, el dominio debe ser accesible desde internet con HTTPS.
3. **Agente → Conocimiento**: carga la información real del negocio. Sin esto, el
   agente responde con los datos de demostración.
4. **Laboratorio**: corre la evaluación y ajusta hasta que el puntaje convenza
   antes de que el agente hable con clientes.
5. Prueba real desde otro teléfono.

## Actualizar

- **A mano:** en la app, **Deploy**. Reconstruye desde la rama `main`; las
  migraciones nuevas corren solas al arrancar.
- **Automático:** la pestaña **Deployments** da un *webhook* que, al llamarlo,
  inicia un despliegue; con una fuente GitHub también puede desplegar solo en
  cada cambio. ⚠️ Con varios clientes en la misma rama, **un mismo cambio los
  despliega a todos a la vez**. Para controlarlo, haz que cada cliente siga una
  rama estable (por ejemplo `release`) a la que subes los cambios con calma.
- Antes de actualizar, lee `CHANGELOG.md` y **haz un respaldo**.

## Respaldos

Son tuyos: no vienen incluidos. En el servicio Postgres, pestaña **Backups**:
programa un respaldo periódico a un almacenamiento externo (S3 o similar) con
una retención razonable. **Prueba restaurar uno** con datos de prueba antes de
confiar en ellos; un respaldo que nunca se restauró no es un respaldo.

## Si algo falla

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El build termina con `Killed` o sin mensaje | Falta de memoria | Más memoria o *swap* mientras se construye |
| La app no arranca y el log lista variables inválidas | Falta una variable | Revisa `APP_BASE_URL`, `DATABASE_URL`, los tres secretos |
| `ENCRYPTION_KEY inválida` | No son exactamente 32 bytes en base64 | Regénerala con `openssl rand -base64 32` |
| `[migrate] BD no lista` repetido | La base no es alcanzable | Revisa que `DATABASE_URL` use el nombre interno del servicio Postgres del **mismo proyecto** |
| 502 / *Bad gateway* | Puerto o dominio mal configurado | El dominio debe apuntar al puerto **3000** |
| `/api/health` responde 503 `db_unavailable` | La app no llega a Postgres | Misma revisión que arriba; mira el log de la app |
| `/api/settings/ycloud` da 404 | `WHATSAPP_PROVIDERS` no llegó | Guarda la variable y vuelve a desplegar |
| YCloud no recibe el webhook | El dominio no es público o no tiene HTTPS | Comprueba el dominio desde fuera de tu red |
| Las pantallas no se actualizan solas | Hay más de una réplica, o un proxy corta SSE | Una sola réplica; revisa que el proxy no limite conexiones largas |

Para los problemas del propio Vocero (webhook "no verificado", adjuntos, etc.)
mira también «Diagnóstico rápido» al final de `INSTALL-IA.md`.

## Qué se probó y qué no

- ✅ El `Dockerfile` construye (el CI lo corre en cada cambio) y la app y sus
  migraciones aceptan una URL de Postgres como la que da Easypanel.
- ✅ El mismo código corre en Vercel y en Docker: detecta la plataforma solo.
- ⚠️ **No se ha desplegado en un Easypanel real.** Los nombres de menús, el
  formato exacto del nombre interno de la base y el comportamiento del build con
  poca memoria están sin verificar.
