# Fase 1d — Infra / Seguridad / Git (track paralelo)

**Fecha:** 2026-07-10
**Rama de trabajo:** `feat/finanzas-roles-deploy`
**Spec autoridad:** `docs/superpowers/specs/2026-07-10-deploy-finanzas-roles-design.md` (§7 = alcance de este plan)
**Depende de:** nada bloqueante. Es el track paralelo "∥ Infra/Seguridad" del roadmap (§1). Habilita el deploy pero no toca la lógica de Finanzas/Roles.

## Goal

Dejar la base **segura y deployable** para el ciclo `web-dev`:

1. **Git:** repo `japalmo/GMT-Link` → **privado** + **branch protection** en `main` (PR obligatorio + aprobación del owner + prohibido push directo).
2. **Railway:** segundo servicio web **`web-dev`** en el mismo environment `production` del proyecto `tranquil-essence`, compartiendo la misma `api` y BD (spec §Arquitectura).
3. **Seguridad:** eliminar la credencial dev hardcodeada (`admin@gmt.cl` / `AdminGmt2026`) de `seed-admin.core.ts`, tests y docs → clave **solo por env `ADMIN_PASSWORD`** (o aleatoria impresa una vez). Endurecer `.gitignore`. Limpiar creds legacy (Firebase/Gemini) del `.env` local. Alinear `.env.example` a los nombres reales que lee el código (`R2_BUCKET`, `R2_ENDPOINT`). Documentar `SMTP_*` en `railway-deploy.md`.
4. **Data geoespacial:** dejar registrada la decisión sobre `prisma/data-reservorios.json` y `nodes/web/public/dem` (repo ya será privado).

## Architecture / Decisiones

- **`web` y `web-dev` comparten `api` + BD** → todo cambio de api/BD debe ser retrocompatible y las features se prenden por permiso, no por build (spec §Arquitectura). Este plan **no** cambia api/BD salvo la lógica pura de resolución de credenciales del seed (retrocompatible: la firma pública de `resolveAdminSeed`/`ensurePostgresUser` no cambia).
- **`web-dev` necesita su propio dominio** → ese dominio debe agregarse a `CORS_ORIGINS` del servicio `api` (lista separada por comas) o el navegador bloqueará las llamadas. Es el único cambio de variable en `api`.
- **Seed sin secreto en el repo:** la clave del admin deja de vivir en el código. En prod ya se resolvía por `ADMIN_PASSWORD`/aleatoria; ahora **dev** hace lo mismo (usa `ADMIN_PASSWORD` si está en `.env`, si no genera una aleatoria y la imprime una vez). Status en dev sigue `ACTIVE` (sin forzar cambio) para no romper la ergonomía local.

## Tech Stack

- **GitHub CLI `gh`** (NO instalado en esta máquina — ver Task 1) para repo-visibility y branch-protection vía API REST. Alternativa UI documentada.
- **Railway CLI** `railway` (instalado: `C:\Users\juana\AppData\Roaming\npm\railway.ps1`) con **Project Token** en `RAILWAY_TOKEN`.
- Backend: NestJS + Prisma; tests con **vitest** (`pnpm --filter @gmt-platform/backend-central test`).
- Shell: **PowerShell** (Windows 11).

## Estado verificado del repo (leído, no inventado)

- `git remote origin` = `https://github.com/japalmo/GMT-Link.git`; rama actual `feat/finanzas-roles-deploy`.
- `gh` **no está en el PATH** (`Get-Command gh` vacío). `railway` **sí** (npm global). `git` en `C:\Program Files\Git\cmd\git.exe`.
- `.env` **NO está trackeado** por git (`git ls-files --error-unmatch .env` → "did not match") — los secretos locales nunca se commitearon. Aun así hay que limpiar/rotar.
- `seed-admin.core.ts:28` → `const DEV_PASSWORD = 'AdminGmt2026';`. Comentario cabecera (líneas 7-12) también expone la clave.
- `R2StorageService` (`src/common/storage/r2-storage.service.ts:41-45`) lee `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, **`R2_BUCKET`**, **`R2_ENDPOINT`** (+ opcionales `R2_PRESIGN_TTL_SECONDS`, `STORAGE_MAX_BYTES`). Pero `.env.example:27` declara **`R2_BUCKET_NAME`** y **no** declara `R2_ENDPOINT` → desalineado (el gate `isR2Configured()` nunca daría true con el `.env.example`).
- `EmailService` (`src/common/email.service.ts:52-66`) lee `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` (default `no-reply@gmt.cl`). `common.module.ts:15` usa `SmtpEmailService` solo si `SMTP_HOST` está seteado, si no `NoopEmailService`.
- `.env` real tiene `GEMINI_API_KEY=""` (vacío), `FIREBASE_*` server vacío, `VITE_FIREBASE_*` demo, y **`NVIDIA_API_KEY`/`NVIDIA_API_KEY_VISION` con valores reales** (creds vivas — NO borrar, ver Task 8).
- Docs con la clave literal `AdminGmt2026`: `docs/superpowers/plans/2026-06-26-auth-propia-jwt-plan.md` (varias líneas) y `docs/superpowers/plans/2026-07-06-milestone-a-produccion-railway-plan.md` (varias líneas, incluida su propia copia del código del seed). `railway-deploy.md` **no** la contiene.
- Data geoespacial: `nodes/backend-central/prisma/data-reservorios.json` (trackeado) y `nodes/web/public/dem/` (trackeado). No están en `.gitignore`.

---

## File Structure

| Archivo | Acción | Responsabilidad |
| :-- | :-- | :-- |
| `nodes/backend-central/prisma/seed-admin.core.ts` | modify | Quitar `DEV_PASSWORD`; `resolveAdminSeed` sin clave fija (env `ADMIN_PASSWORD` o aleatoria) también en dev. |
| `nodes/backend-central/test/prisma/seed-admin.spec.ts` | modify | Actualizar los tests dev (ya no existe la clave fija). |
| `.gitignore` | modify | Añadir `*.key`, `*.pem`, `service-account*.json`, `firebase-key.json`, `/data`. |
| `.env.example` | modify | `R2_BUCKET_NAME`→`R2_BUCKET`, añadir `R2_ENDPOINT`; añadir `ADMIN_PASSWORD` (dev opcional) y bloque `SMTP_*`; quitar Firebase/Gemini muertos. |
| `.env` (local, NO commit) | modify manual | Quitar `GEMINI_API_KEY` y `FIREBASE_*`/`VITE_FIREBASE_*` muertos; alinear `R2_*`. |
| `docs/railway-deploy.md` | modify | Documentar servicio `web-dev`, `CORS_ORIGINS` con dos dominios, y variables `SMTP_*`. |
| `docs/superpowers/plans/2026-06-26-auth-propia-jwt-plan.md` | modify | Scrub de la clave literal en pasos runnable. |
| `docs/superpowers/plans/2026-07-06-milestone-a-produccion-railway-plan.md` | modify | Scrub de la clave literal en pasos runnable. |
| `docs/infra/git-railway-setup.md` | **create** | Runbook: pasos `gh`/UI (privado + branch protection) y `railway` (web-dev). Entregable para el owner. |

> Nota de commits: el **controlador** commitea. Este plan describe *qué* commitear y con qué mensaje; el ejecutor deja los cambios staged y verificados, sin `git commit` propio salvo que el controlador lo indique.

---

## Task 1 — Preflight de tooling (gh + railway + link del proyecto)

**Files:** ninguno (solo verificación de entorno).

- [ ] Verificar `gh`:
  ```powershell
  Get-Command gh -ErrorAction SilentlyContinue | Select-Object Source
  ```
  **Esperado hoy:** vacío (no instalado). Si vacío, instalar (requiere confirmación del owner; es un `winget`):
  ```powershell
  winget install --id GitHub.cli -e --source winget
  ```
  Reabrir la shell y `gh --version` debe imprimir `gh version 2.x`.
- [ ] Autenticar `gh` (interactivo, lo hace el **owner** — la sesión de agente es no-interactiva):
  ```powershell
  gh auth login --hostname github.com --git-protocol https --web
  ```
  Verificar: `gh auth status` → `Logged in to github.com as japalmo` con scope `repo` y `admin:repo_hook`/`administration` (necesario para branch protection).
- [ ] Verificar `railway`:
  ```powershell
  railway --version
  railway whoami
  ```
  **Esperado:** versión impresa; `whoami` muestra la cuenta. Si `whoami` falla, exportar el Project Token (Project → Settings → Tokens) y linkear:
  ```powershell
  $env:RAILWAY_TOKEN = "<project-token>"
  railway status
  ```
  `railway status` debe mostrar el proyecto **`tranquil-essence`** y el environment **`production`** (docs/railway-deploy.md §6). Si no está linkeado: `railway link` y elegir `tranquil-essence` / `production`.

**Commit:** ninguno (preflight).

---

## Task 2 — Repo `japalmo/GMT-Link` → privado

**Files:** ninguno (operación en GitHub). Se documenta en Task 10.

- [ ] Confirmar visibilidad actual:
  ```powershell
  gh repo view japalmo/GMT-Link --json visibility
  ```
  **Esperado:** `{"visibility":"PUBLIC"}` (o `"PRIVATE"` si ya está — entonces saltar).
- [ ] Antes de privatizar, confirmar la data geoespacial (Task 9 hace la confirmación formal; aquí solo se chequea que no bloquee).
- [ ] Pasar a privado:
  ```powershell
  gh repo edit japalmo/GMT-Link --visibility private --accept-visibility-change-consequences
  ```
  **Esperado:** sin error; `gh repo view japalmo/GMT-Link --json visibility` → `{"visibility":"PRIVATE"}`.
- [ ] **Fallback UI** (si `gh` no tiene permiso o falla): GitHub → repo → **Settings** → **General** → sección **Danger Zone** → **Change repository visibility** → **Make private** → escribir `japalmo/GMT-Link` para confirmar.
- [ ] **Aviso al owner (documentar en runbook):** privatizar rompe forks públicos y GitHub Pages si los hubiera; los colaboradores deben tener acceso explícito (Settings → Collaborators). Verificar que el compañero de trabajo siga con acceso `write` tras el cambio.

**Commit:** ninguno.

---

## Task 3 — Branch protection en `main` (PR + aprobación del owner)

**Files:** ninguno (GitHub API). Se documenta en Task 10.

- [ ] Aplicar la protección vía API REST (regla: PR obligatorio, 1 aprobación, sin push directo, sin bypass de admins):
  ```powershell
  gh api -X PUT repos/japalmo/GMT-Link/branches/main/protection `
    -H "Accept: application/vnd.github+json" `
    -F "required_pull_request_reviews[required_approving_review_count]=1" `
    -F "required_pull_request_reviews[require_code_owner_reviews]=false" `
    -F "required_pull_request_reviews[dismiss_stale_reviews]=true" `
    -F "enforce_admins=true" `
    -F "required_status_checks=null" `
    -F "restrictions=null" `
    -F "allow_force_pushes=false" `
    -F "allow_deletions=false"
  ```
  > Nota PowerShell: `gh api` con estos `-F` anidados a veces falla por el parseo de corchetes. Si da error, usar el JSON explícito por stdin (más robusto):
  ```powershell
  $body = @'
  {
    "required_status_checks": null,
    "enforce_admins": true,
    "required_pull_request_reviews": {
      "required_approving_review_count": 1,
      "require_code_owner_reviews": false,
      "dismiss_stale_reviews": true
    },
    "restrictions": null,
    "allow_force_pushes": false,
    "allow_deletions": false
  }
  '@
  $body | gh api -X PUT repos/japalmo/GMT-Link/branches/main/protection -H "Accept: application/vnd.github+json" --input -
  ```
  **Esperado:** respuesta JSON con el objeto de protección (código 200), campo `"required_pull_request_reviews"` presente.
- [ ] Verificar:
  ```powershell
  gh api repos/japalmo/GMT-Link/branches/main/protection --jq '{prReviews: .required_pull_request_reviews.required_approving_review_count, enforceAdmins: .enforce_admins.enabled, forcePush: .allow_force_pushes.enabled}'
  ```
  **Esperado:** `{"prReviews":1,"enforceAdmins":true,"forcePush":false}`.
- [ ] **Fallback UI:** repo → **Settings** → **Branches** → **Add branch ruleset** (o classic "Add rule") sobre `main`: activar **Require a pull request before merging** (Required approvals = 1), **Do not allow bypassing the above settings** (= enforce_admins), y dejar **Allow force pushes** / **Allow deletions** desmarcados. Guardar.
- [ ] **Necesita del owner:** al ser `japalmo` el único con permisos de admin del repo, la aprobación de PRs debe hacerla él (o agregar un segundo reviewer). Documentar en el runbook que con `enforce_admins=true` **ni siquiera el owner** puede pushear directo a `main`: todo va por PR. Si el owner quiere poder mergear su propio PR sin segundo revisor, dejar `required_approving_review_count=1` implica que **otra** persona apruebe; alternativa: bajar a `0` aprobaciones pero mantener "require PR" (documentar el trade-off, decisión del owner).

**Commit:** ninguno.

---

## Task 4 — Servicio Railway `web-dev`

**Files:** ninguno (Railway). Se documenta en Task 10.

- [ ] Obtener la URL pública del `api` y del `web` actuales (para VITE_API_URL y CORS):
  ```powershell
  railway status
  railway variables --service api    | Select-String "CORS_ORIGINS"
  railway variables --service web    | Select-String "VITE_API_URL"
  ```
  Anotar `VITE_API_URL` del `web` (la URL pública del `api`, p. ej. `https://gmt-link-api.up.railway.app`). `web-dev` usa **la misma** `VITE_API_URL` (misma api/BD, spec §Arquitectura).
- [ ] Crear el servicio `web-dev` desde el mismo repo/rama/Dockerfile que `web` (docs/railway-deploy.md §3):
  ```powershell
  railway add --service web-dev `
    --repo japalmo/GMT-Link `
    --branch main `
    --variables "RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile" `
    --variables "VITE_API_URL=<url-publica-del-api>"
  ```
  **Esperado:** Railway crea el servicio `web-dev` en el env `production` y dispara un build por Dockerfile.
  > Decisión de rama: el spec valida "lo nuevo" en `web-dev`. Como `main` queda protegido y estable, si se quiere que `web-dev` siga una rama de pruebas, cambiar `--branch` a `feat/finanzas-roles-deploy` (o la rama de trabajo). Dejar documentada la decisión en el runbook; por defecto `main` para no acoplar el servicio a una rama efímera.
- [ ] Generar dominio público para `web-dev`:
  ```powershell
  railway domain --service web-dev
  ```
  **Esperado:** imprime algo como `web-dev-production-xxxx.up.railway.app`. Anotarlo.
- [ ] **Cablear CORS en `api`** (crítico — sin esto el navegador bloquea `web-dev`). Agregar el dominio de `web-dev` a la lista `CORS_ORIGINS` existente (separada por comas, sin espacios), conservando el dominio de `web`:
  ```powershell
  railway variables --service api --set "CORS_ORIGINS=https://<dominio-web>,https://<dominio-web-dev>"
  ```
  Re-desplegar `api` si Railway no lo hace solo (`railway redeploy --service api`).
- [ ] Verificar el build de `web-dev`:
  ```powershell
  railway logs --service web-dev
  ```
  **Esperado:** build del Dockerfile OK, servidor sirviendo la SPA. Abrir `https://<dominio-web-dev>` en el navegador → carga el login sin errores de red en consola (las llamadas van al mismo `api`).
- [ ] **Fallback dashboard:** Railway → proyecto `tranquil-essence` → env `production` → **+ New** → **GitHub Repo** `japalmo/GMT-Link` → nombrar `web-dev` → Variables: `RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile`, `VITE_API_URL=<url-api>` → **Settings → Networking → Generate Domain**. Luego editar `CORS_ORIGINS` del servicio `api` para incluir el nuevo dominio.

**Commit:** ninguno.

---

## Task 5 — Quitar la credencial dev del seed (código)

**Files:**
- modify: `nodes/backend-central/prisma/seed-admin.core.ts`

- [ ] Actualizar el comentario de cabecera para no exponer ninguna clave. Reemplazar las líneas 7-12:
  ```
   * Credenciales según entorno (ver resolveAdminSeed):
   *  - dev:  clave fija pública `AdminGmt2026`, status ACTIVE (cómodo en local).
   *  - prod: `ADMIN_PASSWORD` si está definida; si no, una clave ALEATORIA
   *          impresa una sola vez. Status PENDING_FIRST_LOGIN para FORZAR el
   *          cambio de clave en el primer login (flujo /auth/first-login/complete).
   *          Nunca se re-baja el passwordHash/estado de un admin ya existente (C3).
  ```
  por:
  ```
   * Credenciales según entorno (ver resolveAdminSeed): NUNCA hay clave fija en el
   * repo. La clave sale de `ADMIN_PASSWORD`; si no está, se genera una ALEATORIA y
   * se imprime una sola vez.
   *  - dev:  status ACTIVE (cómodo en local; no fuerza cambio de clave).
   *  - prod: status PENDING_FIRST_LOGIN para FORZAR el cambio de clave en el primer
   *          login (flujo /auth/first-login/complete).
   *          Nunca se re-baja el passwordHash/estado de un admin ya existente (C3).
  ```
- [ ] Borrar el literal de la clave. Eliminar las líneas 27-28:
  ```ts
  /** Clave fija SOLO para desarrollo local. Nunca se usa en producción. */
  const DEV_PASSWORD = 'AdminGmt2026';
  ```
- [ ] Reescribir `resolveAdminSeed` (líneas 46-61) para que dev y prod salgan del mismo camino (env o aleatoria), diferenciando solo el `status`/`mustChangePassword`:
  ```ts
  export function resolveAdminSeed(env: NodeJS.ProcessEnv): AdminSeedResolution {
    const isProd = env.NODE_ENV === 'production';
    const provided = env.ADMIN_PASSWORD?.trim();
    if (provided) {
      return {
        password: provided,
        status: isProd ? 'PENDING_FIRST_LOGIN' : 'ACTIVE',
        generated: false,
        mustChangePassword: isProd,
      };
    }
    // Sin ADMIN_PASSWORD: clave aleatoria impresa una vez (jamás una clave fija en el repo).
    return {
      password: generateProvisionalPassword(16),
      status: isProd ? 'PENDING_FIRST_LOGIN' : 'ACTIVE',
      generated: true,
      mustChangePassword: isProd,
    };
  }
  ```
- [ ] Sanity grep (no debe quedar el literal en el código fuente):
  ```powershell
  Select-String -Path nodes/backend-central/prisma/seed-admin.core.ts -Pattern "AdminGmt2026"
  ```
  **Esperado:** sin coincidencias.

**Commit (sugerido al controlador):** `security(seed): quita clave dev fija del admin; clave solo por ADMIN_PASSWORD o aleatoria`.

---

## Task 6 — Actualizar los tests del seed (dev ya no tiene clave fija)

**Files:**
- modify: `nodes/backend-central/test/prisma/seed-admin.spec.ts`

- [ ] Reemplazar el primer test dev (líneas 13-19) que espera `'AdminGmt2026'` por dos casos que reflejan el nuevo comportamiento. Sustituir:
  ```ts
    it('dev: usa la clave fija y status ACTIVE', () => {
      const r = resolveAdminSeed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
      expect(r.password).toBe('AdminGmt2026');
      expect(r.status).toBe('ACTIVE');
      expect(r.mustChangePassword).toBe(false);
      expect(r.generated).toBe(false);
    });
  ```
  por:
  ```ts
    it('dev con ADMIN_PASSWORD: usa esa clave, status ACTIVE, sin forzar cambio', () => {
      const r = resolveAdminSeed({
        NODE_ENV: 'development',
        ADMIN_PASSWORD: 'ClaveDevLocal!',
      } as NodeJS.ProcessEnv);
      expect(r.password).toBe('ClaveDevLocal!');
      expect(r.status).toBe('ACTIVE');
      expect(r.mustChangePassword).toBe(false);
      expect(r.generated).toBe(false);
    });

    it('dev sin ADMIN_PASSWORD: genera una clave aleatoria (nunca la fija del repo), status ACTIVE', () => {
      const r = resolveAdminSeed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
      expect(r.status).toBe('ACTIVE');
      expect(r.mustChangePassword).toBe(false);
      expect(r.generated).toBe(true);
      expect(r.password.length).toBeGreaterThanOrEqual(12);
      expect(r.password).not.toBe('AdminGmt2026');
    });
  ```
  > Los tests de prod (líneas 21-41) y el bloque `ensurePostgresUser` (líneas 44-104) **no cambian**: la firma y el contrato de prod son idénticos.
- [ ] Correr solo este spec:
  ```powershell
  pnpm --filter @gmt-platform/backend-central exec vitest run test/prisma/seed-admin.spec.ts
  ```
  **Esperado:** `Test Files 1 passed`, todos los `it` en verde (incluye los 2 nuevos dev + los de prod + los 2 de `ensurePostgresUser`).
- [ ] Correr el typecheck de tests (el script `test` lo exige antes de vitest):
  ```powershell
  pnpm --filter @gmt-platform/backend-central run typecheck:test
  ```
  **Esperado:** sin errores TS.

**Commit (sugerido):** `test(seed): actualiza casos dev del admin al esquema sin clave fija`.

---

## Task 7 — Endurecer `.gitignore`

**Files:**
- modify: `.gitignore`

- [ ] Añadir al final del archivo un bloque de secretos/artefactos (spec §7):
  ```gitignore

  # Secretos / llaves — NUNCA versionar
  *.key
  *.pem
  service-account*.json
  firebase-key.json

  # Datos de runtime del backend (DEMs, uploads pesados) — nunca versionar
  /data
  ```
- [ ] Verificar que nada trackeado matchee sin querer (evitar sorpresas):
  ```powershell
  git ls-files | Select-String -Pattern '\.key$|\.pem$|service-account.*\.json$|firebase-key\.json$|^data/'
  ```
  **Esperado:** sin coincidencias (nada de eso estaba trackeado). Si aparece algo, avisar al controlador antes de continuar (habría que `git rm --cached`).
- [ ] Verificar que el ignore aplica:
  ```powershell
  git check-ignore -v test.key data/x.txt
  ```
  **Esperado:** cada ruta reportada como ignorada por la nueva regla.

**Commit (sugerido):** `chore(gitignore): ignora *.key/*.pem/service-account*.json/firebase-key.json y /data`.

---

## Task 8 — Limpiar creds legacy del `.env` local (Firebase/Gemini)

**Files:**
- modify (manual, NO commit — `.env` está gitignoreado): `.env`

> Contexto: `.env` no está trackeado, así que estas creds nunca salieron por git. Es limpieza para evitar confusión y alinear con el código (el backend ya no usa Firebase ni Gemini; usa NVIDIA). **`NVIDIA_API_KEY`/`NVIDIA_API_KEY_VISION` son creds VIVAS: NO borrarlas.**

- [ ] Antes de tocar Firebase/Vite, confirmar que la web ya no referencia `VITE_FIREBASE_*` (para no romper el build local):
  ```powershell
  # desde la raíz del repo
  ```
  ```
  Grep pattern: VITE_FIREBASE_ ; glob: nodes/web/**/*.{ts,tsx}
  ```
  Si hay 0 coincidencias en `nodes/web/src`, se pueden quitar las `VITE_FIREBASE_*`. Si hay coincidencias (código muerto aún importado), **dejarlas** y anotar en pendientes que la limpieza de Firebase en el front es tarea aparte (fuera de este plan de infra).
- [ ] Eliminar del `.env` local las líneas server de Firebase y Gemini (líneas ~15-19 y ~27-28 del `.env` real):
  ```
  # Firebase Auth (§2)
  FIREBASE_PROJECT_ID="demo-gmt-link"
  FIREBASE_AUTH_EMULATOR_HOST="localhost:9099"
  FIREBASE_CLIENT_EMAIL=""
  FIREBASE_PRIVATE_KEY=""
  ...
  # IA — Gemini desde backend, cuota 3/día/usuario (§2)
  GEMINI_API_KEY=""
  ```
  y (solo si el grep anterior dio 0) las `VITE_FIREBASE_*` (líneas ~37-41).
- [ ] Añadir al `.env` local, para paridad con el código real de R2 y el nuevo seed:
  ```
  # Storage — Cloudflare R2 (nombres reales que lee el código)
  R2_ENDPOINT=""
  # (renombrar la línea existente R2_BUCKET_NAME -> R2_BUCKET)
  ```
  Renombrar la línea `R2_BUCKET_NAME="gmt-link-docs"` → `R2_BUCKET="gmt-link-docs"`.
  ```
  # Admin seed (dev): clave del admin sembrado. Si se omite, el seed genera una aleatoria.
  ADMIN_PASSWORD=""
  ```
- [ ] **Rotación de las creds NVIDIA (decisión del owner, documentar):** como el `.env` nunca se commiteó, el riesgo de exposición es bajo. Recomendar rotar `NVIDIA_API_KEY`/`NVIDIA_API_KEY_VISION` **solo si** alguna vez se compartió el `.env` fuera de la máquina; de lo contrario, mantenerlas. No borrarlas. Anotar en el runbook (Task 10).
- [ ] Verificar que el backend sigue arrancando con el `.env` limpio:
  ```powershell
  pnpm --filter @gmt-platform/backend-central run build
  ```
  **Esperado:** build OK (no depende de Firebase/Gemini).

**Commit:** ninguno (`.env` no se versiona). Documentar el cambio en el runbook.

---

## Task 9 — Alinear `.env.example` (R2, SMTP, ADMIN_PASSWORD; quitar Firebase/Gemini)

**Files:**
- modify: `.env.example`

- [ ] Reemplazar el bloque R2 (líneas 23-27) para usar los nombres reales y agregar `R2_ENDPOINT`:
  ```
  # Storage — Cloudflare R2 (§2). isR2Configured() exige las 5; si falta una, cae a storage local.
  R2_ACCOUNT_ID=""
  R2_ACCESS_KEY_ID=""
  R2_SECRET_ACCESS_KEY=""
  R2_BUCKET="gmt-link-docs"
  R2_ENDPOINT=""            # p. ej. https://<accountid>.r2.cloudflarestorage.com
  # Opcionales (tienen default en el código): R2_PRESIGN_TTL_SECONDS, STORAGE_MAX_BYTES
  ```
- [ ] Quitar los bloques Firebase server (líneas 15-21) y las `VITE_FIREBASE_*` (líneas 48-54) del `.env.example` (el backend usa auth propia JWT; docs/railway-deploy.md dice explícitamente que no hay `FIREBASE_*` ni `VITE_FIREBASE_*`). Reemplazar el `VITE_FIREBASE_*` trailing por nada. Gemini ya no figura en `.env.example` (usa NVIDIA) — verificar y, si aparece, quitarlo.
- [ ] Añadir el seed admin y SMTP (para Fase 3, desactivado por defecto). Insertar tras el bloque API/CORS:
  ```
  # Admin seed. Si se omite, el seed genera una clave aleatoria y la imprime una vez.
  # En prod deja al admin en PENDING_FIRST_LOGIN (fuerza cambio en el primer login).
  ADMIN_PASSWORD=""

  # Email (SMTP) — DESACTIVADO por defecto. Si SMTP_HOST está vacío, se usa NoopEmailService
  # (no se envían correos). Se activa en Fase 3 con plantilla acordada.
  SMTP_HOST=""
  SMTP_PORT="587"
  SMTP_USER=""
  SMTP_PASS=""
  EMAIL_FROM="no-reply@gmt.cl"
  ```
- [ ] Sanity: el `.env.example` no debe declarar variables que el código no lee, ni omitir las que sí (R2_BUCKET/R2_ENDPOINT). Grep de control:
  ```powershell
  Select-String -Path .env.example -Pattern "R2_BUCKET_NAME|FIREBASE_|GEMINI_"
  ```
  **Esperado:** sin coincidencias.

**Commit (sugerido):** `chore(env): alinea .env.example a R2_BUCKET/R2_ENDPOINT, agrega SMTP_*/ADMIN_PASSWORD, quita Firebase/Gemini`.

---

## Task 10 — Scrub de la clave literal en docs + runbook de infra

**Files:**
- modify: `docs/superpowers/plans/2026-06-26-auth-propia-jwt-plan.md`
- modify: `docs/superpowers/plans/2026-07-06-milestone-a-produccion-railway-plan.md`
- modify: `docs/railway-deploy.md`
- create: `docs/infra/git-railway-setup.md`

- [ ] Localizar todas las apariciones del literal:
  ```powershell
  Select-String -Path docs/superpowers/plans/*.md -Pattern "AdminGmt2026"
  ```
  **Esperado:** coincidencias en los dos plans listados (varias líneas).
- [ ] En ambos plans, reemplazar el literal `AdminGmt2026` por el placeholder `<ADMIN_PASSWORD>` en los pasos runnable (login curl/Invoke-RestMethod, smoke UI, seed) y, donde el doc reproduce el código del seed (`const DEV_PASSWORD = 'AdminGmt2026'`), reemplazar por una nota `// (histórico) — hoy la clave sale de ADMIN_PASSWORD, ver plan 2026-07-10-fase1d`. No reescribir la historia del doc, solo neutralizar el secreto reproducible.
  > Estos plans son registros históricos ya ejecutados; el objetivo del scrub es que **no quede una clave copy-pasteable** que alguien reuse. El email `admin@gmt.cl` (identidad) se conserva.
- [ ] Verificar que ya no queda la clave en docs de ejecución:
  ```powershell
  Select-String -Path docs/**/*.md -Pattern "AdminGmt2026" | Where-Object { $_.Path -notmatch "2026-07-10-fase1d|2026-07-10-deploy-finanzas" }
  ```
  **Esperado:** sin coincidencias (salvo este plan y el spec, que la citan como el secreto a remover).
- [ ] En `docs/railway-deploy.md`, agregar al final de la §3 (Servicio Web) un sub-bloque **web-dev**:
  ```markdown
  ### Servicio Web-Dev (pruebas)

  Segundo servicio web `web-dev` en el mismo env `production`, mismo Dockerfile que `web`,
  **misma `api` y misma BD**. Se deploya lo nuevo aquí; cuando el owner valida, se promueve a `web`.

  | Variable | Valor |
  | :-- | :-- |
  | `RAILWAY_DOCKERFILE_PATH` | `nodes/web/Dockerfile` |
  | `VITE_API_URL` | **la misma** URL pública del `api` que usa `web` |

  Crear: `railway add --service web-dev --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile' --variables 'VITE_API_URL=<url-api>'` y luego `railway domain --service web-dev`.

  > **CORS:** el dominio de `web-dev` debe agregarse a `CORS_ORIGINS` del `api` (lista separada por comas, junto al de `web`), o el navegador bloqueará las llamadas.
  ```
- [ ] En `docs/railway-deploy.md` §2 (tabla de variables del api), agregar las filas SMTP (Fase 3, desactivado):
  ```markdown
  | `SMTP_HOST` | host SMTP; **vacío = no se envían correos** (NoopEmailService). Se llena en Fase 3. | — |
  | `SMTP_PORT` | puerto SMTP (default 587) | — |
  | `SMTP_USER` | usuario SMTP | 🔒 |
  | `SMTP_PASS` | password SMTP | 🔒 |
  | `EMAIL_FROM` | remitente, default `no-reply@gmt.cl` | — |
  ```
  y una nota: `> El email de credenciales queda DESACTIVADO hasta Fase 3 (spec §4.3/§7). En Fase 1b/1c la clave provisoria se ve en la UI.`
- [ ] Crear `docs/infra/git-railway-setup.md` como **runbook entregable al owner**, con:
  - Preflight (Task 1): instalar/autenticar `gh`, verificar `railway`/token.
  - Repo privado (Task 2): comando `gh` + fallback UI + aviso de colaboradores.
  - Branch protection (Task 3): el bloque JSON exacto + verificación + el trade-off de aprobaciones (quién aprueba los PRs del owner).
  - web-dev (Task 4): comandos `railway add`/`domain` + el paso de CORS en `api`.
  - Nota de creds NVIDIA (Task 8): cuándo rotar.
  - Checklist final de verificación (abajo).
- [ ] El runbook cierra con este checklist copiable:
  ```markdown
  ## Verificación final
  - [ ] `gh repo view japalmo/GMT-Link --json visibility` → PRIVATE
  - [ ] `gh api repos/japalmo/GMT-Link/branches/main/protection --jq .required_pull_request_reviews.required_approving_review_count` → 1
  - [ ] push directo a `main` rechazado (probar con una rama de descarte)
  - [ ] `https://<dominio-web-dev>` carga el login y pega contra el mismo `api`
  - [ ] `CORS_ORIGINS` del api incluye web y web-dev
  - [ ] `Select-String seed-admin.core.ts -Pattern AdminGmt2026` → vacío
  - [ ] tests del seed en verde
  ```

**Commit (sugerido):** `docs(infra): scrub clave dev en plans; documenta web-dev, CORS y SMTP; runbook git+railway`.

---

## Task 11 — Confirmar data geoespacial (`data-reservorios.json` / `public/dem`)

**Files:** ninguno de código (decisión + nota en runbook).

- [ ] Inventariar lo que hay trackeado y su peso:
  ```powershell
  git ls-files nodes/backend-central/prisma/data-reservorios.json nodes/web/public/dem | ForEach-Object { "{0}  {1:N0} bytes" -f $_, (Get-Item $_).Length }
  ```
  **Esperado:** lista con `data-reservorios.json` y los archivos de `public/dem`.
- [ ] Decisión (spec §7 y §10): con el repo **privado**, es **aceptable** que `data-reservorios.json` y `public/dem` queden versionados (data pública del cliente, no secreta). Registrar en el runbook la confirmación: *"Con repo privado, la data geoespacial pública del cliente puede permanecer en el repo. Si el cliente objeta, mover a R2/almacenamiento externo y cargar por seed"*.
- [ ] **Acción requerida del owner:** confirmar con el cliente (Albemarle) que la data geoespacial pública puede vivir en el repo privado. Hasta que confirme, **no** es bloqueante para privatizar (Task 2), pero sí queda como pendiente anotado.
- [ ] No agregar estos paths a `.gitignore` (siguen versionados); el `/data` del `.gitignore` (Task 7) es para el directorio de runtime, no para `prisma/data-reservorios.json` ni `public/dem`. Confirmar que no colisionan:
  ```powershell
  git check-ignore -v nodes/backend-central/prisma/data-reservorios.json nodes/web/public/dem/. 2>$null
  ```
  **Esperado:** sin salida (no ignorados) → siguen trackeados. Correcto.

**Commit:** ninguno (solo documentación, ya incluida en el runbook de Task 10).

---

## Orden de ejecución sugerido

1. Task 1 (preflight) → 2 → 3 (git privado + protección; requieren `gh` autenticado por el owner).
2. Task 5 → 6 (código+tests del seed; verificable local, sin infra).
3. Task 7 → 9 (`.gitignore` + `.env.example`; verificable local).
4. Task 8 (`.env` local; manual).
5. Task 4 (railway web-dev; requiere token) — puede ir en paralelo a 5-9.
6. Task 10 (docs + runbook) al final, consolidando lo hecho.
7. Task 11 (data geoespacial) — decisión, cierra el runbook.

## Verificación de cierre (DoD)

- [ ] Repo PRIVATE + branch protection activa (PR + 1 aprobación, sin push directo).
- [ ] `web-dev` sirviendo la SPA contra la misma `api`; su dominio en `CORS_ORIGINS`.
- [ ] `AdminGmt2026` no aparece en código, tests, ni docs de ejecución (`Select-String -Path .\ -Pattern AdminGmt2026 -Recurse` solo en spec + este plan).
- [ ] `pnpm --filter @gmt-platform/backend-central test` verde.
- [ ] `.gitignore` cubre `*.key/*.pem/service-account*.json/firebase-key.json//data`.
- [ ] `.env.example` alineado (`R2_BUCKET`, `R2_ENDPOINT`, `SMTP_*`, `ADMIN_PASSWORD`; sin Firebase/Gemini).
- [ ] `railway-deploy.md` documenta `web-dev`, CORS de dos dominios y `SMTP_*`.
- [ ] `docs/infra/git-railway-setup.md` entregable al owner, con checklist de verificación.
