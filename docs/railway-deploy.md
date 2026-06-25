# Despliegue en Railway — GMT Link (MVP)

Guía para dejar GMT Link online en Railway con **deploy continuo desde GitHub**
(`japalmo/GMT-Link`). Decisión de arranque: **PostgreSQL gestionado por Railway**
(migrar a servidores de Albemarle más adelante; ver §7).

> Estado del repo: ya es Railway-ready (CORS por env, `listen 0.0.0.0`, `/health`,
> `prisma migrate deploy` disponible). Falta crear el proyecto en Railway y cargar
> variables. El despliegue se hace por servicio (Nixpacks, sin Dockerfile).

---

## 1. Topología de servicios (5)

| Servicio | Qué es | Origen |
| :-- | :-- | :-- |
| **postgres** | BD de la app | Plugin de Railway (Postgres) → inyecta `DATABASE_URL` |
| **redis** | Caché / colas | Plugin de Railway (Redis) → inyecta `REDIS_URL` |
| **openfga** | Autorización (§4.3) | Imagen Docker `openfga/openfga` + su propia BD Postgres |
| **api** | NestJS (apps/api) | Repo GitHub (Nixpacks) |
| **web** | React/Vite estático (apps/web) | Repo GitHub (Nixpacks) |

Flujo: `web` (build con `VITE_API_URL`) → llama a `api` → `api` usa `postgres`,
`redis` y `openfga` (URL interna privada de Railway).

---

## 2. Servicio API (NestJS, monorepo pnpm)

Root directory del servicio: **raíz del repo** (no `apps/api`, porque el build
necesita el workspace pnpm completo).

- **Build command:**
  ```
  pnpm install --frozen-lockfile && pnpm --filter @gmt-link/shared-types build && pnpm --filter @gmt-link/api exec prisma generate && pnpm --filter @gmt-link/api build
  ```
  (si `@gmt-link/shared-types` no tiene script `build`, omitir ese tramo)
- **Pre-deploy / Release command** (corre las migraciones y siembra FGA):
  ```
  pnpm --filter @gmt-link/api exec prisma migrate deploy
  ```
- **Start command:**
  ```
  node apps/api/dist/main.js
  ```
- **Healthcheck path:** `/health`

### Variables del servicio API
| Variable | Valor | ¿Secret? |
| :-- | :-- | :-- |
| `DATABASE_URL` | referencia al plugin Postgres (`${{Postgres.DATABASE_URL}}`) | — (referencia) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | — |
| `FGA_API_URL` | URL interna del servicio openfga, p. ej. `http://openfga.railway.internal:8080` | — |
| `FGA_STORE_ID` | se obtiene tras el bootstrap (§4) | — |
| `FGA_MODEL_ID` | se obtiene tras el bootstrap (§4) | — |
| `FIREBASE_PROJECT_ID` | proyecto Firebase real (§5) | — |
| `FIREBASE_CLIENT_EMAIL` | del service account | 🔒 |
| `FIREBASE_PRIVATE_KEY` | del service account (con `\n` escapados) | 🔒 |
| `NVIDIA_API_KEY` | clave NVIDIA NIM — texto (nemotron-3-ultra-550b) | 🔒 |
| `NVIDIA_API_KEY_VISION` | clave NVIDIA NIM — visión (nemotron-3-nano-omni) | 🔒 |
| `CORS_ORIGINS` | URL pública del servicio web, p. ej. `https://gmt-link-web.up.railway.app` | — |
| `NODE_ENV` | `production` | — |
| `PORT` | lo inyecta Railway (no fijar) | — |

> **NO** definir `FIREBASE_AUTH_EMULATOR_HOST` en producción (debe quedar ausente).

---

## 3. Servicio Web (Vite estático)

Root directory: raíz del repo.

- **Build command** (`VITE_API_URL` debe estar definida ANTES del build):
  ```
  pnpm install --frozen-lockfile && pnpm --filter @gmt-link/web build
  ```
- **Start command** (sirve el estático en el puerto de Railway):
  ```
  pnpm --filter @gmt-link/web exec vite preview --host 0.0.0.0 --port $PORT
  ```

### Variables del servicio Web (todas `VITE_*`, se hornean en build)
| Variable | Valor |
| :-- | :-- |
| `VITE_API_URL` | URL pública del servicio api, p. ej. `https://gmt-link-api.up.railway.app` |
| `VITE_FIREBASE_API_KEY` | `AIzaSyBj9V4iLs40rdftaY4w-CQK3vGaAOagNMA` (proyecto `gmt-hub-6d8f7`) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `gmt-hub-6d8f7.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `gmt-hub-6d8f7` |
| `VITE_FIREBASE_AUTH_EMULATOR` | **vacía** en prod (activa el emulador solo si está definida) |

> Tras cambiar `VITE_API_URL` hay que re-desplegar la web (se compila en build).

---

## 4. Servicio OpenFGA + bootstrap del modelo

1. Crear servicio desde imagen `openfga/openfga:latest`.
2. Darle una BD: otro plugin Postgres (o un schema dedicado). Variables del servicio openfga:
   - `OPENFGA_DATASTORE_ENGINE=postgres`
   - `OPENFGA_DATASTORE_URI=<uri postgres del openfga>`
   - `OPENFGA_HTTP_ADDR=0.0.0.0:8080`
3. Start command: `./openfga migrate && ./openfga run` (migrate crea las tablas).
4. **Bootstrap del modelo** (escribe `apps/api/fga/model.fga` y crea el store):
   correr una vez `pnpm --filter @gmt-link/api run fga:bootstrap` apuntando
   `FGA_API_URL` al openfga desplegado. Anota el `FGA_STORE_ID` y `FGA_MODEL_ID`
   que imprime y cárgalos como variables del servicio api (§2).

---

## 5. Firebase en producción (no emulador)

El emulador NO corre en Railway. Proyecto Firebase real: **GMT Link / `gmt-hub-6d8f7`**
(la config de cliente ya está en §3). Para prod:
1. Verificar que **Authentication → email/password** esté habilitado en `gmt-hub-6d8f7`.
2. **Generar un service account** (Firebase Console → Project Settings → Service
   Accounts → *Generate new private key*). El MVP usaba la REST API con solo la
   apiKey, pero la API nueva usa `firebase-admin` (necesita service account para
   `setPassword` del primer login). De ese JSON saca `FIREBASE_CLIENT_EMAIL` y
   `FIREBASE_PRIVATE_KEY` (con `\n` escapados) para el servicio api (§2).
   **Dejar `FIREBASE_AUTH_EMULATOR_HOST` sin definir.**
3. Sembrar los usuarios demo en el proyecto real (adaptar
   `apps/api/scripts/seed-firebase-mvp.ts` apuntando a `gmt-hub-6d8f7`, sin
   `FIREBASE_AUTH_EMULATOR_HOST`).

> ⚠️ Las claves `firebase-adminsdk-*.json` de tu carpeta Downloads son **secretos**:
> van como variables de Railway, nunca al repo.

---

## 6. Cómo me das acceso (elegiste "token")

Para que yo cree y configure todo con la Railway CLI:
1. Entra a Railway → **Account Settings → Tokens** (o **Project → Settings → Tokens**
   para un token de proyecto).
2. Crea un **token** (Account Token si el proyecto aún no existe; Project Token si ya
   lo creaste).
3. Pásamelo en el chat (yo lo uso como `RAILWAY_TOKEN` para `railway up`/`railway
   variables`, etc.). ⚠️ Es una credencial: revócala cuando terminemos.

Con el token yo: creo el proyecto, agrego los 5 servicios, conecto este repo de
GitHub para auto-deploy, y cargo variables/secrets según §2–§5.

---

## 7. Migración futura a BD de Albemarle

Cuando los servidores de Albemarle estén listos: cambiar `DATABASE_URL` del servicio
api para apuntar a su Postgres a través de un túnel seguro (VPN/mTLS, IP allowlist),
correr `prisma migrate deploy` contra esa BD, y quitar el plugin Postgres de Railway.
La lógica sigue en Railway; los datos pasan a estar bajo control de Albemarle (ver
`docs/prompts-nuevas-sesiones.md`, prompt #5).

---

## 8. Estado del provisioning (PAUSADO — 2026-06-25)

Proyecto Railway: **`valiant-rebirth`** (id `a4a055bc-ad80-45bb-9b8b-39899e4b3f0c`), env `production`.

- ✅ **Postgres** provisionado y Online (service id `cb387508-…`).
- ✅ Dockerfiles `apps/api/Dockerfile` y `apps/web/Dockerfile` en `main`.
- ⛔ **Bloqueo:** el plan **free** de Railway no deja provisionar más servicios
  (*"Free plan resource provision limit exceeded"* al crear el segundo servicio).
  Se necesita **upgrade a Hobby** para agregar api + web + openfga.

**Cómo retomar** (tras subir el proyecto a Hobby, con un Project Token en `RAILWAY_TOKEN`
— Project → Settings → Tokens):

1. `railway add --service api --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile' --variables 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --variables 'NODE_ENV=production'`
2. Resto de variables del api (§2): `FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY` (service
   account de `gmt-hub-6d8f7`), `NVIDIA_API_KEY`, `NVIDIA_API_KEY_VISION`, `CORS_ORIGINS`
   (= URL pública del web), y `FGA_API_URL/STORE_ID/MODEL_ID` (tras bootstrap).
3. `railway add --service web --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile'` + `VITE_*` (§3; se hornean como build args).
4. `railway add --image openfga/openfga --service openfga` + su Postgres + start
   `openfga migrate && openfga run`; luego `pnpm --filter @gmt-link/api run fga:bootstrap`
   apuntando a su URL para obtener `FGA_STORE_ID` / `FGA_MODEL_ID`.
5. `railway domain` por servicio y cablear `CORS_ORIGINS` (api) ↔ `VITE_API_URL` (web).

> Notas: el Postgres creado consume algo del crédito de trial aunque esté idle — si no
> retomas pronto, puedes borrarlo (`railway` dashboard) y recrearlo al continuar. La CLI
> solo funciona con **Project Token** (`RAILWAY_TOKEN`), no con el token de equipo.
