# Runbook — Git privado + Branch protection + Railway `web-dev` + SMTP

> **Para el OWNER (`japalmo`).** Estos pasos requieren permisos que un agente no
> tiene (admin del repo en GitHub, token de Railway, login interactivo de `gh`).
> Ejecutalos vos, en este orden. Todo lo **autónomo** (código del seed, tests,
> `.gitignore`, `.env.example`, scrub de la clave en docs) ya quedó hecho por el
> track Fase 1d; ver `docs/superpowers/plans/2026-07-10-fase1d-infra-seguridad-git.md`.

**Contexto verificado del repo (2026-07-10):**
- `origin` = `https://github.com/japalmo/GMT-Link.git`; rama de trabajo `feat/finanzas-roles-deploy`.
- `gh` (GitHub CLI) **NO** está en el PATH de esta máquina → hay que instalarlo/autenticarlo (paso 0).
- `railway` **SÍ** está instalado (npm global) — sólo necesita un **Project Token**.
- Proyecto Railway: **`tranquil-essence`**, environment **`production`** (cuenta de pago).

---

## 0. Preflight — herramientas

### 0.1 GitHub CLI (`gh`)
```powershell
Get-Command gh -ErrorAction SilentlyContinue | Select-Object Source   # hoy: vacío
winget install --id GitHub.cli -e --source winget                     # instalar
# Reabrir la terminal para refrescar el PATH:
gh --version                                                          # -> gh version 2.x
gh auth login --hostname github.com --git-protocol https --web        # login interactivo (navegador)
gh auth status                                                        # -> Logged in as japalmo
```
El scope debe incluir `repo` y `administration` (branch protection). Si `gh auth status`
no lista `admin`/`administration`, re-corré `gh auth login` y aceptá los scopes.

### 0.2 Railway CLI
```powershell
railway --version
railway whoami
```
Si `whoami` falla: Project → Settings → Tokens → crear un **Project Token** y:
```powershell
$env:RAILWAY_TOKEN = "<project-token>"
railway status     # debe mostrar proyecto tranquil-essence / env production
```
Si no está linkeado: `railway link` → elegir `tranquil-essence` / `production`.

---

## 1. Repo `japalmo/GMT-Link` → PRIVADO

```powershell
gh repo view japalmo/GMT-Link --json visibility          # -> {"visibility":"PUBLIC"} (o PRIVATE si ya está)
gh repo edit japalmo/GMT-Link --visibility private --accept-visibility-change-consequences
gh repo view japalmo/GMT-Link --json visibility          # -> {"visibility":"PRIVATE"}
```

**Fallback UI:** GitHub → repo → **Settings** → **General** → **Danger Zone** →
**Change repository visibility** → **Make private** → escribir `japalmo/GMT-Link` para confirmar.

**Avisos:**
- Privatizar rompe forks públicos y GitHub Pages (si existieran).
- Los colaboradores necesitan acceso explícito: **Settings → Collaborators**. Verificá
  que tu compañero de trabajo siga con acceso `write` tras el cambio.

---

## 2. Branch protection en `main` (PR obligatorio + 1 aprobación, sin push directo)

Regla objetivo: PR obligatorio, 1 aprobación, sin push directo, sin force-push, sin borrado.
El método robusto en PowerShell es pasar el JSON por stdin (evita el parseo de corchetes):

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

Verificar:
```powershell
gh api repos/japalmo/GMT-Link/branches/main/protection --jq '{prReviews: .required_pull_request_reviews.required_approving_review_count, enforceAdmins: .enforce_admins.enabled, forcePush: .allow_force_pushes.enabled}'
# Esperado: {"prReviews":1,"enforceAdmins":true,"forcePush":false}
```

**Fallback UI:** repo → **Settings** → **Branches** → **Add branch ruleset** (o "Add rule" clásico)
sobre `main`: activar **Require a pull request before merging** (Required approvals = 1),
**Do not allow bypassing the above settings** (= `enforce_admins`), y dejar
**Allow force pushes** / **Allow deletions** desmarcados. Guardar.

**Trade-off de aprobaciones (decisión tuya):**
- Con `enforce_admins=true` **ni el owner** puede pushear directo a `main`: todo va por PR.
- Con `required_approving_review_count=1`, los PRs necesitan que **otra** persona apruebe.
  Como `japalmo` es el único admin, tenés dos opciones:
  1. Agregar un segundo reviewer (tu compañero) y mantener `=1`. **(Recomendado.)**
  2. Bajar a `required_approving_review_count=0` (mantiene "require PR" pero te deja
     mergear tu propio PR sin segundo revisor). Menos control, pero desbloquea a un solo dev.

---

## 3. Railway — segundo servicio web `web-dev`

`web-dev` comparte **la misma `api` y BD** que `web`; sólo cambia el dominio. Se deploya
lo nuevo aquí y, cuando validás, se promueve a `web`.

### 3.1 Anotar la URL del `api` (la misma que usa `web`)
```powershell
railway status
railway variables --service web | Select-String "VITE_API_URL"   # -> URL pública del api
```

### 3.2 Crear el servicio y su dominio
```powershell
railway add --service web-dev `
  --repo japalmo/GMT-Link `
  --branch main `
  --variables "RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile" `
  --variables "VITE_API_URL=<url-publica-del-api>"

railway domain --service web-dev    # -> web-dev-production-xxxx.up.railway.app  (anotarlo)
```
> **Rama:** por defecto `main` (estable). Si querés que `web-dev` siga una rama de
> pruebas, cambiá `--branch` a `feat/finanzas-roles-deploy` (o la rama de trabajo).

### 3.3 Cablear CORS en el `api` (CRÍTICO — sin esto el navegador bloquea `web-dev`)
Agregar el dominio de `web-dev` a la lista `CORS_ORIGINS` **conservando** el de `web`
(separada por comas, sin espacios):
```powershell
railway variables --service api --set "CORS_ORIGINS=https://<dominio-web>,https://<dominio-web-dev>"
railway redeploy --service api      # si Railway no re-despliega solo
```

### 3.4 Verificar el build
```powershell
railway logs --service web-dev      # build del Dockerfile OK, sirviendo la SPA
```
Abrir `https://<dominio-web-dev>` → carga el login sin errores de red en consola
(las llamadas van al mismo `api`).

**Fallback dashboard:** Railway → `tranquil-essence` → env `production` → **+ New** →
**GitHub Repo** `japalmo/GMT-Link` → nombrar `web-dev` → Variables
`RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile`, `VITE_API_URL=<url-api>` →
**Settings → Networking → Generate Domain** → luego editar `CORS_ORIGINS` del `api`.

---

## 4. SMTP en el servicio `api` (para Fase 3 — hoy DESACTIVADO)

El backend usa `NoopEmailService` mientras `SMTP_HOST` esté vacío: **no se envían correos**
y la clave provisoria se ve en la UI (decisión §9). Cuando arranque Fase 3, setear en el `api`:
```powershell
railway variables --service api `
  --set "SMTP_HOST=<host>" `
  --set "SMTP_PORT=587" `
  --set "SMTP_USER=<user>" `
  --set "SMTP_PASS=<pass>" `
  --set "EMAIL_FROM=no-reply@gmt.cl"
```
Variables reales que lee el código: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`,
`SMTP_PASS`, `EMAIL_FROM` (default `no-reply@gmt.cl`). Ver `docs/railway-deploy.md` §2.

---

## 5. Notas de credenciales y datos

### 5.1 Admin seed — sin clave fija en el repo
La clave del admin **ya no vive en el código**. Sale de `ADMIN_PASSWORD` (env del servicio
`api`); si se omite, el seed genera una aleatoria y la imprime **una sola vez** en el log del
release. En prod el admin queda `PENDING_FIRST_LOGIN` (fuerza cambio en el primer login).
Setear en Railway (opcional):
```powershell
railway variables --service api --set "ADMIN_PASSWORD=<clave-inicial-fuerte>"
```

### 5.2 Rotación de creds NVIDIA (decisión tuya)
`NVIDIA_API_KEY` / `NVIDIA_API_KEY_VISION` son creds **vivas**. El `.env` local nunca se
commiteó (git no lo trackea), así que el riesgo de exposición es bajo. **Rotalas sólo si**
el `.env` se compartió alguna vez fuera de tu máquina; de lo contrario, mantenelas.

### 5.3 Data geoespacial (`prisma/data-reservorios.json`, `nodes/web/public/dem`)
Con el repo **privado**, es aceptable que esta data pública del cliente quede versionada.
No está en `.gitignore` (sigue trackeada; el `/data/` del `.gitignore` es sólo para el
directorio de runtime, no para estos paths). **Pendiente:** confirmar con el cliente
(Albemarle) que la data geoespacial pública puede vivir en el repo privado. No es
bloqueante para privatizar; si el cliente objeta, mover a R2 y cargar por seed.

---

## Verificación final
- [ ] `gh repo view japalmo/GMT-Link --json visibility` → `PRIVATE`
- [ ] `gh api repos/japalmo/GMT-Link/branches/main/protection --jq .required_pull_request_reviews.required_approving_review_count` → `1`
- [ ] push directo a `main` rechazado (probar con una rama de descarte)
- [ ] `https://<dominio-web-dev>` carga el login y pega contra el mismo `api`
- [ ] `CORS_ORIGINS` del `api` incluye web **y** web-dev
- [ ] `Select-String nodes/backend-central/prisma/seed-admin.core.ts -Pattern "AdminGmt2026"` → vacío
- [ ] tests del seed en verde (`pnpm --filter @gmt-platform/backend-central exec vitest run test/prisma/seed-admin.spec.ts`)
