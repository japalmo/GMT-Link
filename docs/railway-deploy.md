# Despliegue en Railway — GMT Link (MVP)

Guía para dejar GMT Link online en Railway con **deploy continuo desde GitHub**
(`japalmo/GMT-Link`, rama `main`). BD: **PostgreSQL gestionado por Railway**
(migrar a servidores de Albemarle más adelante; ver §5).

> **Build por Dockerfile, no Nixpacks.** Cada servicio de código se construye con
> su Dockerfile (`nodes/backend-central/Dockerfile`, `nodes/web/Dockerfile`)
> seleccionado con la variable `RAILWAY_DOCKERFILE_PATH` en el propio servicio.
> Ignora cualquier mención histórica a Nixpacks: quedó obsoleta.

> **Auth propia (JWT), sin Firebase.** El backend usa bcrypt + JWT HS256
> (`AUTH_JWT_SECRET`). `firebase-admin` fue eliminado del backend. NO se definen
> variables `FIREBASE_*` ni `VITE_FIREBASE_*` en ningún servicio.

---

## 1. Topología de servicios

| Servicio | Qué es | Origen |
| :-- | :-- | :-- |
| **postgres-gmt** | BD de la app | Plugin Postgres de Railway → inyecta `DATABASE_URL` |
| **openfga** | Autorización (§4.3) | Imagen `openfga/openfga` + su propio Postgres backing |
| **api** | NestJS (`nodes/backend-central`) | Repo GitHub, build por Dockerfile |
| **web** | React/Vite (`nodes/web`) | Repo GitHub, build por Dockerfile |

Dominio público: sólo **api** y **web**. El resto se comunica por
`*.railway.internal`. Flujo: `web` (build con `VITE_API_URL`) → `api` → `api` usa
`postgres-gmt` y `openfga` por URL interna privada.

---

## 2. Servicio API (NestJS)

- **Dockerfile:** variable de servicio `RAILWAY_DOCKERFILE_PATH=nodes/backend-central/Dockerfile`.
- **Release command** (migraciones + seed del admin):
  ```
  pnpm --filter @gmt-platform/backend-central exec prisma migrate deploy && pnpm --filter @gmt-platform/backend-central seed:admin
  ```
- **Healthcheck path:** `/health`

### Variables del servicio API
| Variable | Valor | ¿Secret? |
| :-- | :-- | :-- |
| `RAILWAY_DOCKERFILE_PATH` | `nodes/backend-central/Dockerfile` | — |
| `DATABASE_URL` | `${{postgres-gmt.DATABASE_URL}}` | — (referencia) |
| `AUTH_JWT_SECRET` | secreto HS256 de **>= 32 bytes** (ver nota) | 🔒 |
| `ADMIN_PASSWORD` | clave inicial del admin sembrado (opcional; si se omite, el seed genera una aleatoria y la imprime una vez) | 🔒 |
| `FGA_API_URL` | `http://openfga.railway.internal:8080` | — |
| `FGA_STORE_ID` | tras el bootstrap (§4) | — |
| `FGA_MODEL_ID` | tras el bootstrap (§4) | — |
| `NVIDIA_API_KEY` | clave NVIDIA NIM (texto) | 🔒 |
| `NVIDIA_API_KEY_VISION` | clave NVIDIA NIM (visión) | 🔒 |
| `CORS_ORIGINS` | URLs públicas del frontend separadas por comas (web **y** web-dev, §3), p. ej. `https://gmt-link-web.up.railway.app,https://web-dev-production-xxxx.up.railway.app` | — |
| `SMTP_HOST` | host SMTP; **vacío = no se envían correos** (NoopEmailService). Se llena en Fase 3. | — |
| `SMTP_PORT` | puerto SMTP (default 587) | — |
| `SMTP_USER` | usuario SMTP | 🔒 |
| `SMTP_PASS` | password SMTP | 🔒 |
| `EMAIL_FROM` | remitente, default `no-reply@gmt.cl` | — |
| `NODE_ENV` | `production` | — |
| `PORT` | lo inyecta Railway (no fijar) | — |

> El envío de credenciales por email queda **DESACTIVADO** hasta Fase 3 (spec §4.3/§7):
> con `SMTP_HOST` vacío el backend usa `NoopEmailService`. En Fase 1b/1c la clave
> provisoria se ve en la UI, así que estas variables pueden quedar sin definir por ahora.

> **`AUTH_JWT_SECRET` es obligatorio y validado al arrancar.** El bootstrap
> (`src/common/env.ts` → `validateAuthJwtSecret`, invocado en `main.ts`) **aborta
> el arranque** si la variable falta o mide menos de 32 bytes. Genera uno con:
> ```
> node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
> ```
> y cárgalo como secret del servicio api. Si el contenedor no levanta, revisa
> primero esta variable en los logs del deploy.

> **`NODE_ENV=production` cambia el sembrado del admin.** Con `production`, el seed
> NO usa la clave pública fija: usa `ADMIN_PASSWORD` (o una aleatoria) y deja al
> admin en `PENDING_FIRST_LOGIN`, forzando el cambio de clave en el primer login.
> Si el admin ya existe en prod, el seed no re-baja su clave ni su estado.

---

## 3. Servicio Web (Vite)

- **Dockerfile:** `RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile`.

### Variables del servicio Web
| Variable | Valor |
| :-- | :-- |
| `RAILWAY_DOCKERFILE_PATH` | `nodes/web/Dockerfile` |
| `VITE_API_URL` | URL pública del api, p. ej. `https://gmt-link-api.up.railway.app` (se hornea en build) |

> No hay variables `VITE_FIREBASE_*`: la web ya no usa Firebase Auth. Tras cambiar
> `VITE_API_URL` hay que re-desplegar la web (se compila en build).

### Servicio Web-Dev (pruebas)

Segundo servicio web `web-dev` en el mismo env `production`, mismo Dockerfile que `web`,
**misma `api` y misma BD**. Se deploya lo nuevo aquí; cuando el owner valida, se promueve a `web`.

| Variable | Valor |
| :-- | :-- |
| `RAILWAY_DOCKERFILE_PATH` | `nodes/web/Dockerfile` |
| `VITE_API_URL` | **la misma** URL pública del `api` que usa `web` |

Crear: `railway add --service web-dev --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile' --variables 'VITE_API_URL=<url-api>'` y luego `railway domain --service web-dev`.

> **CORS:** el dominio de `web-dev` debe agregarse a `CORS_ORIGINS` del `api` (lista separada
> por comas, junto al de `web`), o el navegador bloqueará las llamadas. Ver el runbook
> `docs/infra/git-railway-setup.md` para los pasos exactos que ejecuta el owner.

---

## 4. Servicio OpenFGA + bootstrap del modelo

1. Servicio desde imagen `openfga/openfga:latest`.
2. Postgres backing propio. Variables del servicio openfga:
   - `OPENFGA_DATASTORE_ENGINE=postgres`
   - `OPENFGA_DATASTORE_URI=<uri del Postgres backing de openfga>`
   - `OPENFGA_HTTP_ADDR=0.0.0.0:8080`
3. Start / release: `./openfga migrate && ./openfga run`.
4. **Bootstrap del modelo:** correr una vez, apuntando `FGA_API_URL` al openfga
   desplegado (usa el script `scripts/fga-bootstrap.ts`):
   ```
   pnpm --filter @gmt-platform/backend-central fga:bootstrap
   ```
   Anota `FGA_STORE_ID` y `FGA_MODEL_ID` que imprime y cárgalos en el servicio api (§2).
5. El seed del admin (release del api, §2) escribe la tupla FGA `user:<id> admin
   organization:gmt` una vez que `FGA_STORE_ID`/`FGA_MODEL_ID` están presentes.

---

## 5. Migración futura a BD de Albemarle

Cuando los servidores de Albemarle estén listos: apuntar `DATABASE_URL` del api a su
Postgres por túnel seguro (VPN/mTLS, IP allowlist), correr `prisma migrate deploy`
contra esa BD y quitar el plugin Postgres de Railway.

---

## 6. Estado del provisioning

Proyecto Railway: **`tranquil-essence`** (env `production`, **cuenta de pago** — ya
sin el bloqueo de plan free que antes impedía crear más de un servicio). El
provisioning de los servicios (`postgres-gmt`, `openfga` + su Postgres backing,
`api`, `web`) se realiza en la Fase 2 del plan; ver los pasos `railway add` abajo.

**Cómo provisionar/retomar** (con un Project Token en `RAILWAY_TOKEN` — Project →
Settings → Tokens):

1. `railway add --service api --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=nodes/backend-central/Dockerfile' --variables 'DATABASE_URL=${{postgres-gmt.DATABASE_URL}}' --variables 'NODE_ENV=production' --variables 'AUTH_JWT_SECRET=<secreto->=32-bytes>'`
2. Resto de variables del api (§2): `ADMIN_PASSWORD` (opcional), `NVIDIA_API_KEY`, `NVIDIA_API_KEY_VISION`, `CORS_ORIGINS` (= URL pública del web), y `FGA_API_URL/STORE_ID/MODEL_ID` (tras bootstrap).
3. `railway add --service web --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile' --variables 'VITE_API_URL=<url-publica-api>'`.
4. `railway add --image openfga/openfga --service openfga` + su Postgres backing + start `openfga migrate && openfga run`; luego `pnpm --filter @gmt-platform/backend-central fga:bootstrap` apuntando a su URL para obtener `FGA_STORE_ID` / `FGA_MODEL_ID`.
5. `railway domain` SÓLO en api y web; cablear `CORS_ORIGINS` (api) ↔ `VITE_API_URL` (web).

> La CLI sólo funciona con **Project Token** (`RAILWAY_TOKEN`), no con el token de equipo.
