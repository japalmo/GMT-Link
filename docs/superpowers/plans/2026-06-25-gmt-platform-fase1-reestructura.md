# Reestructura Multicloud — Fase 1 (esqueleto del monorepo) · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganizar **in-place** el repo `japalmo/GMT-Link` hacia el layout multicloud `gmt-platform` (nodos + paquetes compartidos) **sin romper** el sistema actual: el backend y la web siguen compilando, testeando y corriendo igual.

**Architecture:** Movimiento estructural + scaffolds. `apps/api → nodes/backend-central`, `apps/web → nodes/web`, `packages/shared-types → packages/contracts`; se renombran los paquetes npm `@gmt-link/* → @gmt-platform/*`; se crean esqueletos compilables de `nodes/auth-service`, `nodes/tenant-gateway`, `packages/sdk-gateway`; `nodes/v-metric` como submódulo; plantillas en `deploy/`. **Ninguna lógica de negocio cambia.** Las fases 2–5 (gateway de datos, BD por tenant, auth propio, V-metric) quedan fuera.

**Tech Stack:** pnpm workspaces · TypeScript estricto · NestJS (backend-central) · React+Vite (web) · vitest · Docker/Railway · git submodule (v-metric, Python).

**Spec de referencia:** [docs/superpowers/specs/2026-06-25-gmt-platform-multicloud-design.md](../specs/2026-06-25-gmt-platform-multicloud-design.md)

---

## Decisiones de alcance (leer antes de empezar)

1. **In-place.** No se crea un repo nuevo: se reestructura el repo actual. El nombre del repo en GitHub (`japalmo/GMT-Link`), el nombre de la BD (`gmt_link`) y el tag de imagen (`gmt-link-app`) **NO se tocan** — son identidad/runtime, no estructura. Solo cambian rutas de carpetas y nombres de paquetes npm (`@gmt-link/* → @gmt-platform/*`).
2. **`turbo` y `packages/config` se DIFIEREN** a una fase posterior. `packages/config` implicaría mover `tsconfig.base.json` y reescribir todos los `extends "../../tsconfig.base.json"` (que hoy son correctos por profundidad); eso añade riesgo sin aportar al objetivo de Fase 1. La config compartida (`tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc`) se queda en la **raíz**, donde está.
3. **Profundidad preservada = no tocar rutas relativas.** Los tres destinos (`nodes/backend-central`, `nodes/web`, `packages/contracts`) quedan a **2 niveles** bajo la raíz, igual que hoy. Por eso **NO se editan** (siguen siendo correctas): los `extends "../../tsconfig.base.json"` (×3), `nodes/web/vite.config.ts` `envDir: "../.."`, `nodes/backend-central/prisma.config.ts` `process.cwd()/../../.env`, `nodes/backend-central/src/main.ts` `resolve(__dirname,'../../../.env')`. Editarlas rompería una ruta hoy correcta.
4. **El lockfile se re-genera con `pnpm install`, nunca a mano.** `pnpm-lock.yaml` indexa por ruta y por nombre de paquete; ambos cambian. Regla de oro: **renombrar nombres de paquete + ajustar el glob del workspace ANTES de `pnpm install`**.

### Mapa de renombres (autoridad única)

| Antes (dir) | Después (dir) | Antes (pkg npm) | Después (pkg npm) |
| :-- | :-- | :-- | :-- |
| `apps/api` | `nodes/backend-central` | `@gmt-platform/backend-central` | `@gmt-platform/backend-central` |
| `apps/web` | `nodes/web` | `@gmt-platform/web` | `@gmt-platform/web` |
| `packages/shared-types` | `packages/contracts` | `@gmt-platform/contracts` | `@gmt-platform/contracts` |
| (raíz) | (raíz) | `gmt-link` | `gmt-platform` |

### Secuencia de Verificación verde (SV) — se usa en varias tareas

Estos comandos se ejecutan desde la raíz del repo. **Usan nombres de paquete**, así que son idénticos antes y después del movimiento de carpetas. `contracts` se compila **primero** porque su `main`/`types` apuntan a `./dist` y ese `dist/` **no está versionado** (es gitignored): sin build, los imports de `@gmt-platform/contracts` no resuelven.

```bash
pnpm install
pnpm --filter @gmt-platform/contracts build
pnpm --filter @gmt-platform/backend-central exec tsc --noEmit
pnpm --filter @gmt-platform/web exec tsc --noEmit
pnpm --filter @gmt-platform/backend-central test
pnpm --filter @gmt-platform/web test
pnpm lint
```

**Esperado:** install OK · contracts emite `dist/` · ambos `tsc --noEmit` salen 0 · tests de web PASAN · tests de api PASAN **salvo** `test/fga-model.spec.ts` si OpenFGA no está levantado (es un test de integración que necesita OpenFGA vivo; debe fallar **igual** que en el baseline de la Tarea 0, no cuenta como regresión) · `pnpm lint` sale 0.

---

## Tarea 0: Baseline verde (antes de tocar nada)

Capturar el estado "antes" para distinguir regresiones reales de fallos preexistentes (sobre todo el spec de integración de OpenFGA).

**Files:** ninguno (solo lectura/ejecución).

- [ ] **Step 1: Confirmar rama**

Run:
```bash
git rev-parse --abbrev-ref HEAD
```
Expected: `feat/gmt-platform-multicloud`. Si no, `git checkout feat/gmt-platform-multicloud`.

- [ ] **Step 2: Instalar y compilar contracts**

Run:
```bash
pnpm install
pnpm --filter @gmt-platform/contracts build
```
Expected: install sin errores; `packages/shared-types/dist/index.js` y `index.d.ts` generados.

- [ ] **Step 3: Typecheck api + web**

Run:
```bash
pnpm --filter @gmt-platform/backend-central exec tsc --noEmit
pnpm --filter @gmt-platform/web exec tsc --noEmit
```
Expected: ambos salen 0.

- [ ] **Step 4: Tests api + web (registrar fallos preexistentes)**

Run:
```bash
pnpm --filter @gmt-platform/backend-central test
pnpm --filter @gmt-platform/web test
```
Expected: web PASA. api PASA salvo, posiblemente, `test/fga-model.spec.ts` (necesita OpenFGA). **Anotar** exactamente qué falla y por qué — esa es la línea base. Si quieres aislar el unit-set de api: `pnpm --filter @gmt-platform/backend-central exec vitest run --exclude "**/fga-model.spec.ts"` debe quedar 100% verde.

- [ ] **Step 5: Lint**

Run:
```bash
pnpm lint
```
Expected: sale 0.

No hay commit en esta tarea.

---

## Tarea 1: Renombrar paquetes `@gmt-link/* → @gmt-platform/*` (carpetas sin mover)

Renombrado puramente nominal. Las carpetas siguen en `apps/*` y `packages/shared-types`; pnpm resuelve la membresía por glob de carpeta y las dependencias por nombre, así que el árbol queda verde al terminar.

**Files:**
- Modify: `package.json` (name raíz)
- Modify: `packages/shared-types/package.json` (name + description)
- Modify: `apps/api/package.json` (name + dep)
- Modify: `apps/web/package.json` (name + dep)
- Modify: 51 archivos fuente con `import ... from '@gmt-platform/contracts'` + strings de filtro/comentarios
- Modify: `Dockerfile`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `.claude/launch.json`, `apps/api/src/fga/fga.module.ts`

- [ ] **Step 1: Reemplazo masivo de los tres nombres de paquete (tracked files, excluyendo el lockfile)**

Desde la raíz, en Git Bash (Git for Windows trae `sed`):
```bash
git grep -lZ '@gmt-platform/contracts' -- ':!pnpm-lock.yaml' | xargs -0 sed -i 's#@gmt-platform/contracts#@gmt-platform/contracts#g'
git grep -lZ '@gmt-platform/backend-central'          -- ':!pnpm-lock.yaml' | xargs -0 sed -i 's#@gmt-platform/backend-central#@gmt-platform/backend-central#g'
git grep -lZ '@gmt-platform/web'          -- ':!pnpm-lock.yaml' | xargs -0 sed -i 's#@gmt-platform/web#@gmt-platform/web#g'
```
Esto cubre: los 51 imports de `@gmt-platform/contracts`, las `dependencies` `workspace:*` en los dos consumidores, los `--filter` de los 3 Dockerfiles, `.claude/launch.json`, el string de error en `apps/api/src/fga/fga.module.ts`, y los comentarios. Los tres nombres son disjuntos, así que el orden no genera colisiones.

- [ ] **Step 2: Renombrar el `name` del paquete raíz**

En `package.json` (raíz):
```diff
-  "name": "gmt-link",
+  "name": "gmt-platform",
```
(Editar SOLO el campo `name`. NO tocar `gmt_link`/`gmt-link-app` en ningún otro lado.)

- [ ] **Step 3: Verificar que no quedó ningún `@gmt-link/`**

Run:
```bash
git grep -n '@gmt-link/'
```
Expected: **0 resultados**. (Nota: `gmt-link-app` y `gmt_link` NO contienen `@gmt-link/`, así que no deben aparecer.)

- [ ] **Step 4: Re-lock + verificación verde (SV)**

Run:
```bash
pnpm install
pnpm --filter @gmt-platform/contracts build
pnpm --filter @gmt-platform/backend-central exec tsc --noEmit
pnpm --filter @gmt-platform/web exec tsc --noEmit
pnpm --filter @gmt-platform/backend-central test
pnpm --filter @gmt-platform/web test
pnpm lint
```
Expected: igual que el baseline de la Tarea 0 (mismo set de fallos preexistentes de OpenFGA, nada nuevo). `pnpm-lock.yaml` queda actualizado con los nuevos nombres.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(repo): renombra paquetes @gmt-link/* → @gmt-platform/*

Renombre nominal previo al movimiento de carpetas (Fase 1 multicloud).
Sin cambios de lógica. Lockfile regenerado.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Tarea 2: Mover carpetas al layout `nodes/` + `packages/contracts` y arreglar rutas

El movimiento físico con `git mv` (preserva historial) + ajuste de **rutas** (no nombres) en config de build, glob del workspace, ignores y los 2 scripts Python con rutas absolutas. Termina con re-lock y SV verde.

**Files:**
- Move: `apps/api → nodes/backend-central`, `apps/web → nodes/web`, `packages/shared-types → packages/contracts`
- Modify: `pnpm-workspace.yaml`, `Dockerfile`, `nodes/backend-central/Dockerfile`, `nodes/web/Dockerfile`, `docker-compose.yml`, `.gitignore`, `.dockerignore`, `eslint.config.mjs`
- Modify: `nodes/backend-central/scripts/regen-data-reservorios.py`, `nodes/backend-central/scripts/parse-reservorios.py`

- [ ] **Step 1: Mover las carpetas con git mv**

```bash
mkdir -p nodes
git mv apps/api nodes/backend-central
git mv apps/web nodes/web
git mv packages/shared-types packages/contracts
rmdir apps 2>/dev/null || true
```
Nota: las carpetas **no versionadas** `nodes/backend-central/var/` (uploads runtime) y `nodes/backend-central/uploads/` (legacy) NO las mueve `git mv`. No hace falta: `UPLOADS_ROOT = process.cwd()/var/uploads` se recrea solo en runtime. `prisma/data-reservorios.json` SÍ está versionado y se mueve con la carpeta.

- [ ] **Step 2: Actualizar el glob del workspace**

En `pnpm-workspace.yaml`, reemplazar `apps/*` por `nodes/*` y excluir el submódulo Python (que se añade en la Tarea 6) para que pnpm no lo trate como paquete JS:
```yaml
packages:
  - nodes/*
  - '!nodes/v-metric'
  - packages/*
allowBuilds:
  esbuild: true
  '@nestjs/core': true
  unrs-resolver: true
  '@prisma/client': true
  '@prisma/engines': true
  prisma: true
  '@firebase/util': true
  protobufjs: true
```
(El bloque `allowBuilds` queda igual: lista nombres de dependencias de terceros, no de `@gmt-platform/*`.)

- [ ] **Step 3: Arreglar el `Dockerfile` raíz (dev/compose)**

`WORKDIR /workspace`. Editar las tres COPY y la línea de build:
```diff
-COPY apps/api/package.json apps/api/package.json
-COPY apps/web/package.json apps/web/package.json
-COPY packages/shared-types/package.json packages/shared-types/package.json
+COPY nodes/backend-central/package.json nodes/backend-central/package.json
+COPY nodes/web/package.json nodes/web/package.json
+COPY packages/contracts/package.json packages/contracts/package.json
```
```diff
-RUN pnpm --filter @gmt-platform/contracts build && cd apps/api && pnpm exec prisma generate
+RUN pnpm --filter @gmt-platform/contracts build && cd nodes/backend-central && pnpm exec prisma generate
```
(El `--filter` ya quedó renombrado en la Tarea 1; aquí solo cambia el `cd apps/api`.)

- [ ] **Step 4: Arreglar `nodes/backend-central/Dockerfile`**

```diff
-# En Railway: setear RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile (root dir = raíz del repo).
+# En Railway: setear RAILWAY_DOCKERFILE_PATH=nodes/backend-central/Dockerfile (root dir = raíz del repo).
```
```diff
-WORKDIR /app/apps/api
+WORKDIR /app/nodes/backend-central
```
(Los `--filter` ya están renombrados desde la Tarea 1.)

- [ ] **Step 5: Arreglar `nodes/web/Dockerfile`**

```diff
-# En Railway: RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile (root dir = raíz del repo).
+# En Railway: RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile (root dir = raíz del repo).
```
```diff
-COPY --from=build /app/apps/web/dist ./dist
+COPY --from=build /app/nodes/web/dist ./dist
```

- [ ] **Step 6: Arreglar `docker-compose.yml`, `.gitignore`, `.dockerignore`, `eslint.config.mjs`**

`docker-compose.yml`:
```diff
-    working_dir: /workspace/apps/api
+    working_dir: /workspace/nodes/backend-central
```
`.gitignore`:
```diff
-apps/api/var/
+nodes/backend-central/var/
```
```diff
-apps/api/prisma/backups/
+nodes/backend-central/prisma/backups/
```
`.dockerignore`:
```diff
-apps/api/prisma/backups
+nodes/backend-central/prisma/backups
```
`eslint.config.mjs`:
```diff
-    files: ['apps/api/**/*.ts'],
+    files: ['nodes/backend-central/**/*.ts'],
```

- [ ] **Step 7: Arreglar las rutas ABSOLUTAS en los 2 scripts Python**

⚠️ Estas no las captura ningún find/replace de barras-normales: usan rutas Windows con `\`. Editar a mano.

`nodes/backend-central/scripts/regen-data-reservorios.py`:
```diff
-JSON_PATH = Path(r"C:\Users\juana\GMT Link\apps\api\prisma\data-reservorios.json")
+JSON_PATH = Path(r"C:\Users\juana\GMT Link\nodes\backend-central\prisma\data-reservorios.json")
```
(La línea `sys.path.insert(0, r"C:\Users\juana\V-metric")` apunta al clon hermano de V-metric; **dejarla como está** por ahora — se revisita en la Tarea 6 si el submódulo aterriza.)

`nodes/backend-central/scripts/parse-reservorios.py`:
```diff
-OUT_PATH = r"C:\Users\juana\GMT Link\apps\api\prisma\data-reservorios.json"
+OUT_PATH = r"C:\Users\juana\GMT Link\nodes\backend-central\prisma\data-reservorios.json"
```

- [ ] **Step 8: Re-lock + verificación verde (SV)**

Run:
```bash
pnpm install
pnpm --filter @gmt-platform/contracts build
pnpm --filter @gmt-platform/backend-central exec tsc --noEmit
pnpm --filter @gmt-platform/web exec tsc --noEmit
pnpm --filter @gmt-platform/backend-central test
pnpm --filter @gmt-platform/web test
pnpm lint
```
Expected: igual al baseline (solo fallos preexistentes de OpenFGA). El lockfile se actualiza con las nuevas rutas de importer (`nodes/backend-central:`, `nodes/web:`, `packages/contracts:`).

- [ ] **Step 9: Smoke del workspace (opcional pero recomendado)**

Run:
```bash
pnpm --filter @gmt-platform/web build
```
Expected: `vite build` genera `nodes/web/dist/` sin errores (valida el alias `@` y `envDir` tras el move).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(repo): mueve apps→nodes y shared-types→contracts (layout multicloud)

git mv de apps/api→nodes/backend-central, apps/web→nodes/web,
packages/shared-types→packages/contracts. Ajusta glob del workspace,
Dockerfiles, docker-compose, ignores, glob de eslint y rutas absolutas
de los scripts python. Lockfile regenerado. Sin cambios de lógica.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Tarea 3: Scaffold `packages/sdk-gateway` (cliente tipado backend→gateway)

Paquete nuevo, mínimo y compilable: el cliente HTTP tipado que la fase 2 usará para que `backend-central` hable con los `tenant-gateway`. Habla los tipos de `@gmt-platform/contracts`. TDD.

**Files:**
- Create: `packages/sdk-gateway/package.json`
- Create: `packages/sdk-gateway/tsconfig.json`
- Create: `packages/sdk-gateway/src/index.ts`
- Test: `packages/sdk-gateway/src/index.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`packages/sdk-gateway/src/index.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { GatewayClient } from './index.js';

describe('GatewayClient', () => {
  it('normaliza el baseUrl quitando la barra final', () => {
    const client = new GatewayClient({ baseUrl: 'https://gw.example.com/' });
    expect(client.baseUrl).toBe('https://gw.example.com');
  });

  it('expone el tenant configurado', () => {
    const client = new GatewayClient({ baseUrl: 'https://gw', tenant: 'albemarle' });
    expect(client.tenant).toBe('albemarle');
  });
});
```

- [ ] **Step 2: Crear package.json + tsconfig (para que el test pueda correr)**

`packages/sdk-gateway/package.json`:
```json
{
  "name": "@gmt-platform/sdk-gateway",
  "version": "0.1.0",
  "private": true,
  "description": "Cliente tipado backend-central → tenant-gateway (contrato REST/HTTP).",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "test": "vitest run"
  },
  "dependencies": {
    "@gmt-platform/contracts": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.0.0"
  }
}
```
`packages/sdk-gateway/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Instalar para enlazar el nuevo paquete**

Run:
```bash
pnpm install
```
Expected: `@gmt-platform/sdk-gateway` aparece como paquete del workspace; lockfile actualizado.

- [ ] **Step 4: Correr el test y verlo fallar**

Run:
```bash
pnpm --filter @gmt-platform/sdk-gateway test
```
Expected: FALLA con "Failed to resolve import './index.js'" / `GatewayClient` no existe.

- [ ] **Step 5: Implementar el mínimo**

`packages/sdk-gateway/src/index.ts`:
```ts
import type { HealthResponse } from '@gmt-platform/contracts';

export interface GatewayClientOptions {
  /** URL base del tenant-gateway, p.ej. https://gw-albemarle.internal */
  baseUrl: string;
  /** Identificador del tenant (gmt | albemarle | mantos-blancos). */
  tenant?: string;
  /** Token de servicio backend→gateway (se inyecta en Authorization). */
  serviceToken?: string;
}

/**
 * Cliente tipado que backend-central usará para hablar con un tenant-gateway.
 * Scaffold de Fase 1: solo expone configuración y un health(). La superficie
 * real (CRUD de dominio, decisiones FGA) se agrega en la Fase 2.
 */
export class GatewayClient {
  readonly baseUrl: string;
  readonly tenant: string | undefined;
  private readonly serviceToken: string | undefined;

  constructor(options: GatewayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.tenant = options.tenant;
    this.serviceToken = options.serviceToken;
  }

  /** Llama al /health del gateway. Útil para readiness checks. */
  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/health`, {
      headers: this.serviceToken ? { Authorization: `Bearer ${this.serviceToken}` } : {},
    });
    if (!res.ok) {
      throw new Error(`Gateway ${this.tenant ?? this.baseUrl} no saludable: HTTP ${res.status}`);
    }
    return (await res.json()) as HealthResponse;
  }
}
```

- [ ] **Step 6: Test verde + build**

Run:
```bash
pnpm --filter @gmt-platform/sdk-gateway test
pnpm --filter @gmt-platform/sdk-gateway build
```
Expected: test PASA; `packages/sdk-gateway/dist/index.js` + `index.d.ts` generados.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sdk-gateway): scaffold del cliente tipado backend→gateway

Paquete compilable mínimo (GatewayClient + health) que habla los tipos
de @gmt-platform/contracts. La superficie real llega en Fase 2.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Tarea 4: Scaffold `nodes/auth-service` (nodo mínimo con /health)

Nodo de identidad: por ahora un servidor HTTP mínimo (sin dependencias de framework) con `/health`, compilable y testeable. La lógica real de JWT/usuarios llega en la Fase 4. La separación `app.ts` (lógica pura, testeable) / `main.ts` (servidor) es el patrón para todos los nodos nuevos.

**Files:**
- Create: `nodes/auth-service/package.json`
- Create: `nodes/auth-service/tsconfig.json`
- Create: `nodes/auth-service/src/app.ts`
- Create: `nodes/auth-service/src/main.ts`
- Test: `nodes/auth-service/src/app.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`nodes/auth-service/src/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { handleHealth } from './app.js';

describe('auth-service handleHealth', () => {
  it('reporta ok con el nombre del servicio', () => {
    expect(handleHealth()).toEqual({ status: 'ok', service: 'auth-service' });
  });
});
```

- [ ] **Step 2: Crear package.json + tsconfig**

`nodes/auth-service/package.json`:
```json
{
  "name": "@gmt-platform/auth-service",
  "version": "0.1.0",
  "private": true,
  "description": "Servicio de identidad (JWT propios). Scaffold Fase 1.",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.0"
  }
}
```
`nodes/auth-service/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Instalar**

Run:
```bash
pnpm install
```
Expected: `@gmt-platform/auth-service` enlazado; lockfile actualizado.

- [ ] **Step 4: Correr el test y verlo fallar**

Run:
```bash
pnpm --filter @gmt-platform/auth-service test
```
Expected: FALLA (no existe `./app.js` / `handleHealth`).

- [ ] **Step 5: Implementar app.ts + main.ts**

`nodes/auth-service/src/app.ts`:
```ts
export interface HealthPayload {
  status: 'ok';
  service: string;
}

/** Lógica pura del healthcheck (testeable sin levantar el servidor). */
export function handleHealth(): HealthPayload {
  return { status: 'ok', service: 'auth-service' };
}
```
`nodes/auth-service/src/main.ts`:
```ts
import { createServer } from 'node:http';
import { handleHealth } from './app.js';

const PORT = Number(process.env.PORT ?? 3002);

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(handleHealth()));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[auth-service] escuchando en http://0.0.0.0:${PORT}`);
});
```

- [ ] **Step 6: Test verde + build + smoke**

Run:
```bash
pnpm --filter @gmt-platform/auth-service test
pnpm --filter @gmt-platform/auth-service build
node nodes/auth-service/dist/main.js &
sleep 1 && curl -s http://localhost:3002/health && kill %1
```
Expected: test PASA; build genera `dist/main.js`; el curl devuelve `{"status":"ok","service":"auth-service"}`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth-service): scaffold del nodo de identidad con /health

Servidor HTTP mínimo (sin framework) + lógica de health separada y
testeada. La emisión de JWT/usuarios llega en Fase 4.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Tarea 5: Scaffold `nodes/tenant-gateway` (plantilla de gateway con /health)

Plantilla del gateway por-tenant (un despliegue por cliente). Mismo patrón `app.ts`/`main.ts`. La lógica real (Prisma a la BD del tenant + OpenFGA) llega en las fases 2–3.

**Files:**
- Create: `nodes/tenant-gateway/package.json`
- Create: `nodes/tenant-gateway/tsconfig.json`
- Create: `nodes/tenant-gateway/src/app.ts`
- Create: `nodes/tenant-gateway/src/main.ts`
- Test: `nodes/tenant-gateway/src/app.test.ts`

- [ ] **Step 1: Escribir el test que falla**

`nodes/tenant-gateway/src/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { handleHealth } from './app.js';

describe('tenant-gateway handleHealth', () => {
  it('reporta ok con el nombre del servicio y el tenant del entorno', () => {
    expect(handleHealth('albemarle')).toEqual({
      status: 'ok',
      service: 'tenant-gateway',
      tenant: 'albemarle',
    });
  });

  it('usa "unknown" cuando no hay tenant configurado', () => {
    expect(handleHealth(undefined)).toEqual({
      status: 'ok',
      service: 'tenant-gateway',
      tenant: 'unknown',
    });
  });
});
```

- [ ] **Step 2: Crear package.json + tsconfig**

`nodes/tenant-gateway/package.json`:
```json
{
  "name": "@gmt-platform/tenant-gateway",
  "version": "0.1.0",
  "private": true,
  "description": "Gateway por-tenant (Prisma + OpenFGA por cliente). Scaffold Fase 1.",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.0"
  }
}
```
`nodes/tenant-gateway/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "nodenext",
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Instalar**

Run:
```bash
pnpm install
```
Expected: `@gmt-platform/tenant-gateway` enlazado.

- [ ] **Step 4: Correr el test y verlo fallar**

Run:
```bash
pnpm --filter @gmt-platform/tenant-gateway test
```
Expected: FALLA (no existe `handleHealth`).

- [ ] **Step 5: Implementar app.ts + main.ts**

`nodes/tenant-gateway/src/app.ts`:
```ts
export interface HealthPayload {
  status: 'ok';
  service: string;
  tenant: string;
}

/** Lógica pura del healthcheck; el tenant viene del entorno del despliegue. */
export function handleHealth(tenant: string | undefined): HealthPayload {
  return { status: 'ok', service: 'tenant-gateway', tenant: tenant ?? 'unknown' };
}
```
`nodes/tenant-gateway/src/main.ts`:
```ts
import { createServer } from 'node:http';
import { handleHealth } from './app.js';

const PORT = Number(process.env.PORT ?? 3010);
const TENANT = process.env.TENANT_ID;

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(handleHealth(TENANT)));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[tenant-gateway:${TENANT ?? 'unknown'}] escuchando en http://0.0.0.0:${PORT}`);
});
```

- [ ] **Step 6: Test verde + build**

Run:
```bash
pnpm --filter @gmt-platform/tenant-gateway test
pnpm --filter @gmt-platform/tenant-gateway build
```
Expected: test PASA; `dist/main.js` generado.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(tenant-gateway): scaffold de la plantilla de gateway por-tenant

Servidor HTTP mínimo + health con tenant del entorno. Prisma/OpenFGA
por cliente llegan en Fases 2–3.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Tarea 6: `nodes/v-metric` como git submodule (con prerrequisito y fallback)

⚠️ **Prerrequisito.** El submódulo apunta a `japalmo/V-metric`, pero hoy: (a) el push a ese repo está bloqueado por un *ruleset*, y (b) el clon local en `C:\Users\juana\V-metric` tiene su `origin` en un fork. **Antes** de añadir el submódulo, el repo `japalmo/V-metric` debe existir y tener la rama deseada pusheada. Si eso aún no está resuelto, ejecutar la **Vía B (fallback)** y dejar el submódulo para cuando el repo esté listo.

**Files:**
- Create: `.gitmodules` (vía git submodule) **o** `nodes/v-metric/README.md` (fallback)

### Vía A — submódulo (cuando `japalmo/V-metric` esté disponible)

- [ ] **Step A1: Verificar acceso al repo remoto**

Run:
```bash
git ls-remote https://github.com/japalmo/V-metric.git
```
Expected: lista refs sin error. Si falla (404/permiso), ir a la Vía B.

- [ ] **Step A2: Añadir el submódulo**

```bash
git submodule add https://github.com/japalmo/V-metric.git nodes/v-metric
```
Expected: crea `.gitmodules` y checkout de `nodes/v-metric`.

- [ ] **Step A3: Confirmar que pnpm NO lo trata como paquete**

Run:
```bash
pnpm install
pnpm -r list --depth -1
```
Expected: `@gmt-platform/v-metric` **no** aparece (la exclusión `!nodes/v-metric` del workspace lo mantiene fuera). Si V-metric trajera un `package.json` que pnpm intente leer, confirmar que la exclusión funciona; si no, la SV seguiría verde igual.

- [ ] **Step A4: SV abreviada**

Run:
```bash
pnpm --filter @gmt-platform/backend-central exec tsc --noEmit
pnpm lint
```
Expected: 0 (el submódulo Python no afecta al toolchain JS).

- [ ] **Step A5: Commit**

```bash
git add .gitmodules nodes/v-metric
git commit -m "feat(v-metric): añade el desktop V-metric como submódulo en nodes/v-metric

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### Vía B — fallback (si el repo aún no está listo)

- [ ] **Step B1: Placeholder documentado**

`nodes/v-metric/README.md`:
```markdown
# nodes/v-metric — placeholder

El desktop V-metric (Python + PySide6) vivirá aquí como **git submodule**
de `japalmo/V-metric`. Aún no se añadió porque el repo remoto no está
disponible para submódulo (ruleset de push pendiente).

Cuando el repo esté listo, reemplazar este placeholder:

    git rm -r nodes/v-metric
    git submodule add https://github.com/japalmo/V-metric.git nodes/v-metric

El submódulo está EXCLUIDO del workspace pnpm (`!nodes/v-metric` en
pnpm-workspace.yaml) porque es Python, no un paquete JS.
```

- [ ] **Step B2: Commit**

```bash
git add nodes/v-metric/README.md
git commit -m "chore(v-metric): placeholder de nodes/v-metric (submódulo pendiente de repo remoto)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Tarea 7: Estructura `deploy/` con plantillas por nodo y por tenant (sin secretos)

Plantillas de entorno que reflejan la topología multicloud. Solo `.env.example` y READMEs — **cero secretos**.

**Files:**
- Create: `deploy/README.md`
- Create: `deploy/auth/.env.example`, `deploy/backend/.env.example`, `deploy/web/.env.example`
- Create: `deploy/tenants/gmt/.env.example`, `deploy/tenants/albemarle/.env.example`, `deploy/tenants/mantos-blancos/.env.example`

- [ ] **Step 1: README de deploy**

`deploy/README.md`:
```markdown
# deploy/ — plantillas de entorno por nodo (multicloud)

En producción cada nodo vive en un servidor distinto. Esta carpeta agrupa
las **plantillas** de variables de entorno por nodo y por tenant. Son
ejemplos versionables (`.env.example`): **nunca** commitear `.env` reales.

- `auth/`     → auth-service (identidad/JWT)
- `backend/`  → backend-central (orquestador)
- `web/`      → frontend
- `tenants/<cliente>/` → un tenant-gateway + su PostgreSQL (BD soberana del cliente)

Tenants previstos: `gmt`, `albemarle`, `mantos-blancos`.
```

- [ ] **Step 2: Plantillas de los nodos centrales**

`deploy/auth/.env.example`:
```bash
# auth-service
PORT=3002
# Firma de JWT (rotar en prod). En Fase 1 el servicio es un scaffold.
AUTH_JWT_SECRET=
AUTH_TOKEN_TTL=3600
```
`deploy/backend/.env.example`:
```bash
# backend-central (orquestador)
PORT=3001
CORS_ORIGINS=http://localhost:5173
# URLs de los tenant-gateways que orquesta (Fase 2):
GATEWAY_GMT_URL=
GATEWAY_ALBEMARLE_URL=
GATEWAY_MANTOS_BLANCOS_URL=
# Verificación de identidad emitida por auth-service:
AUTH_JWKS_URL=
```
`deploy/web/.env.example`:
```bash
# frontend (Vite)
VITE_API_URL=http://localhost:3001
VITE_AUTH_URL=http://localhost:3002
```

- [ ] **Step 3: Plantilla de tenant (×3)**

Crear el mismo contenido en `deploy/tenants/gmt/.env.example`, `deploy/tenants/albemarle/.env.example` y `deploy/tenants/mantos-blancos/.env.example`, cambiando `TENANT_ID`:
```bash
# tenant-gateway — un despliegue por cliente (BD soberana del tenant)
TENANT_ID=gmt           # gmt | albemarle | mantos-blancos
PORT=3010
# PostgreSQL del tenant (vive en infra del cliente):
DATABASE_URL=
# OpenFGA del tenant:
FGA_API_URL=
FGA_STORE_ID=
FGA_MODEL_ID=
# Token de servicio que acepta SOLO desde backend-central:
GATEWAY_SERVICE_TOKEN=
```

- [ ] **Step 4: Confirmar que no hay secretos reales**

Run:
```bash
git status --porcelain deploy/
grep -rIl "AIza\|postgresql://\|secret=" deploy/ || echo "sin secretos"
```
Expected: solo archivos `.env.example`/README; el grep imprime `sin secretos`.

- [ ] **Step 5: Commit**

```bash
git add deploy/
git commit -m "chore(deploy): plantillas de entorno por nodo y por tenant (sin secretos)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Tarea 8: Actualizar documentación al nuevo layout

Las rutas viejas en docs cargadas por agentes/deploy desorientan. Actualizar las **load-bearing** (CLAUDE.md, runbook de Railway, prompts, plan maestro) y barrer las cosméticas.

**Files:**
- Modify: `CLAUDE.md`, `docs/railway-deploy.md`, `docs/prompts-nuevas-sesiones.md`, `docs/GMT_LINK_PLAN_MAESTRO.md`
- Modify (cosmético, barrido): `docs/audit_report.md`, `docs/AUDITORIA_Y_PLAN_NFR_2026-06-18.md`, `docs/adr/0001-rbac-dinamico-permission-service.md`, `docs/GMT_LINK_PLAN_IMPL_MODULOS_1-4.md`, `nodes/web/src/components/primitives/import-wizard/README.md`
- Modify: el bloque "Estado" del spec

- [ ] **Step 1: CLAUDE.md — stack + Estructura**

En la línea del stack:
```diff
-NestJS (`apps/api`) · React + Vite + TS + Tailwind + shadcn/ui (`apps/web`) · tipos compartidos en `packages/shared-types`
+NestJS (`nodes/backend-central`) · React + Vite + TS + Tailwind + shadcn/ui (`nodes/web`) · tipos compartidos en `packages/contracts`
```
En el bloque `Estructura`:
```diff
-apps/api/              → NestJS
-apps/web/              → React + Vite
-packages/shared-types/ → tipos compartidos (@gmt-platform/contracts)
+nodes/backend-central/ → NestJS (orquestador central)
+nodes/web/             → React + Vite (frontend)
+nodes/auth-service/    → identidad / JWT (scaffold)
+nodes/tenant-gateway/  → gateway por tenant (scaffold)
+nodes/v-metric/        → desktop V-metric (submódulo, Python)
+packages/contracts/    → tipos/contratos compartidos (@gmt-platform/contracts)
+packages/sdk-gateway/  → cliente tipado backend→gateway
```
Añadir una nota de que la decisión "instancia única" (§2 plan maestro) fue superseded por el diseño multicloud (ver el spec).

- [ ] **Step 2: Barrido de filtros y rutas en docs (forward-slash)**

Desde la raíz (Git Bash) — actualiza filtros y rutas en TODOS los `.md` de `docs/` y READMEs en `nodes/`:
```bash
git grep -lZ -e 'apps/api' -e 'apps/web' -e 'packages/shared-types' -- '*.md' | xargs -0 sed -i \
  -e 's#packages/shared-types#packages/contracts#g' \
  -e 's#apps/api#nodes/backend-central#g' \
  -e 's#apps/web#nodes/web#g'
```
(Los nombres `@gmt-link/*` en docs ya se renombraron en la Tarea 1, porque el find/replace de la Tarea 1 incluía los `.md` versionados.)

- [ ] **Step 3: Railway runbook — RAILWAY_DOCKERFILE_PATH y start commands**

En `docs/railway-deploy.md`, confirmar tras el barrido que quedan correctos: `RAILWAY_DOCKERFILE_PATH=nodes/backend-central/Dockerfile` y `=nodes/web/Dockerfile`, `node nodes/backend-central/dist/main.js`. Añadir una nota visible:
```markdown
> ⚠️ Las variables `RAILWAY_DOCKERFILE_PATH` viven en el dashboard de Railway,
> no en el repo. Tras esta reestructura hay que actualizarlas a
> `nodes/backend-central/Dockerfile` y `nodes/web/Dockerfile` **manualmente**
> en cada servicio, o el deploy falla.
```

- [ ] **Step 4: Marcar el spec como ejecutado**

En `docs/superpowers/specs/2026-06-25-gmt-platform-multicloud-design.md`, línea de Estado:
```diff
-**Estado:** aprobado (estructura) — pendiente revisión del spec antes del plan de implementación.
+**Estado:** Fase 1 implementada (ver docs/superpowers/plans/2026-06-25-gmt-platform-fase1-reestructura.md). Fases 2–5 pendientes.
```

- [ ] **Step 5: Verificar que no quedan rutas viejas en docs load-bearing**

Run:
```bash
git grep -n -e 'apps/api' -e 'apps/web' -e 'packages/shared-types' -e '@gmt-link/' -- CLAUDE.md docs/railway-deploy.md docs/prompts-nuevas-sesiones.md docs/GMT_LINK_PLAN_MAESTRO.md
```
Expected: 0 resultados. (Los docs históricos de auditoría pueden conservar referencias en citas textuales; está bien si quedan, pero el barrido del Step 2 ya los cubrió.)

- [ ] **Step 6: SV final completa**

Run:
```bash
pnpm install
pnpm --filter @gmt-platform/contracts build
pnpm --filter @gmt-platform/backend-central exec tsc --noEmit
pnpm --filter @gmt-platform/web exec tsc --noEmit
pnpm --filter @gmt-platform/backend-central test
pnpm --filter @gmt-platform/web test
pnpm --filter @gmt-platform/sdk-gateway test
pnpm --filter @gmt-platform/auth-service test
pnpm --filter @gmt-platform/tenant-gateway test
pnpm lint
```
Expected: todo verde salvo el fallo preexistente de OpenFGA (`fga-model.spec.ts`) idéntico al baseline.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: actualiza CLAUDE.md, runbook y specs al layout gmt-platform

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Cierre de Fase 1

- [ ] **Verificación de aceptación** (criterio del spec §7): el monorepo compila y testea verde con la nueva estructura; `backend-central` + `web` corren igual que antes (`pnpm dev` levanta 3001 + 5173 + los scaffolds); los nodos nuevos existen como esqueletos compilables. Confirmar `pnpm dev` arranca sin errores y `curl http://localhost:3001/health` + `:5173` responden.
- [ ] **Push de la rama** y abrir PR único `feat/gmt-platform-multicloud → main` (la reestructura es atómica y revisable como un solo PR). Recordar: actualizar `RAILWAY_DOCKERFILE_PATH` en el dashboard de Railway antes/junto al merge, o el deploy falla.

---

## Self-Review (autor del plan)

**1. Cobertura del spec (§7 Fase 1):**
- §7.1 esqueleto del monorepo → Tareas 2 (glob `nodes/*`) + 3–5 (paquetes nuevos). `turbo`/`packages/config` diferidos explícitamente (decisión §10.3 del spec).
- §7.2 mover web/api → Tarea 2. ✓
- §7.3 shared-types → contracts → Tareas 1 (nombre) + 2 (carpeta). ✓
- §7.4 scaffolds auth-service / tenant-gateway / sdk-gateway → Tareas 3, 4, 5. ✓
- §7.5 v-metric submódulo → Tarea 6 (con fallback por el bloqueo de push). ✓
- §7.6 deploy/ templates → Tarea 7. ✓
- §7.7 verificación verde → SV en cada tarea + Tarea 0 baseline + cierre. ✓
- Extra cubierto por el inventario: docs (Tarea 8), scripts .py con rutas absolutas (Tarea 2 Step 7), `.gitignore`/`.dockerignore`/eslint glob/docker-compose (Tarea 2).

**2. Placeholders:** sin "TBD/etc."; cada paso de código trae el código o el comando exacto y su salida esperada. Los renombres masivos van como comandos `sed` precisos + un `git grep` que debe dar 0.

**3. Consistencia de tipos/nombres:** `handleHealth` se usa igual en auth-service (sin args) y tenant-gateway (con `tenant`); cada uno define su propio `HealthPayload` local (no se comparten, evita acoplar scaffolds). `GatewayClient` expone `baseUrl`/`tenant` tal como los testea su spec. Los nombres de paquete del mapa (§ "Mapa de renombres") se usan idénticos en todos los `--filter` y `dependencies`.

**Riesgo residual conocido:** la Tarea 6 (submódulo) depende de que `japalmo/V-metric` exista y sea accesible; por eso trae fallback. El fallo preexistente de `fga-model.spec.ts` (OpenFGA) se neutraliza con el baseline de la Tarea 0.
