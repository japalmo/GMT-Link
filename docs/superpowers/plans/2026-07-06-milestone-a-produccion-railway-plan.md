# Milestone A — Producción en Railway (Fases 1-3) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar tarea por tarea. Los pasos usan checkbox (`- [ ]`) para tracking.

**Goal:** Dejar GMT Link (web) y V-Metric (desktop) en producción en Railway con autenticación propia compartida (sin Firebase), endurecida y con los datos locales migrados.

**Architecture:** Monolito NestJS `backend-central` (JWT propio HS256 + bcrypt) desplegado en Railway junto a `web`, `openfga` y una Postgres única. Se endurece el login (throttler/helmet/validación de secreto/seed admin seguro) ANTES de exponer; se despliegan los 4 servicios; y se migra V-Metric a la auth propia guardando el token con keyring. El aislamiento físico por cliente (BD por tenant) es el Milestone B, aparte.

**Tech Stack:** NestJS 11 · @nestjs/throttler v6 · helmet · Prisma 6 · vitest · Railway CLI · OpenFGA · PostgreSQL · Python/PySide6 + keyring (V-Metric).

**Fuentes:** [plan maestro](2026-07-06-plataforma-railway-multitenant-plan.md) · [evaluación de arquitectura](../specs/2026-07-06-evaluacion-arquitectura-railway.md) · [auth propia](2026-06-26-auth-propia-jwt-plan.md).

**Verificación (enjambre adversarial, 2026-07-06):** cada fase fue redactada leyendo el código real y luego verificada contra el repo (rutas, firmas, comandos, API de librerías). Estado: Fase 1 / 2 / 3 → `allPathsExist=true`, `noPlaceholders=true`, confianza `high`. Bugs corregidos por el verificador anotados en cada sección.

> **Convención de shell (esta máquina):** **PowerShell** para pnpm/tsc/vitest/node/railway; **Bash** solo para git. Rama de trabajo actual: `feat/modulos-1-4` (= `main` remoto para el auto-deploy).

---


## Fase 1 — Gate de seguridad de producción

**Objetivo:** cerrar los agujeros que hacen inseguro exponer el backend públicamente ANTES del deploy: rate limiting (anti fuerza bruta en login), cabeceras de seguridad (helmet), fallo rápido si `AUTH_JWT_SECRET` es débil/ausente, siembra segura del admin en producción, y documentación de deploy correcta (sin Firebase, con Dockerfiles).

**Verdad de terreno verificada leyendo el repo (working dir `C:/Users/juana/GMT/proyectos`):**
- Filtros pnpm EXACTOS confirmados en `package.json`: backend = `@gmt-platform/backend-central`, web = `@gmt-platform/web`.
- NestJS 11 (`@nestjs/common`/`core`/`platform-express` `^11.0.1`) → par correcto **`@nestjs/throttler` v6** (registry: última 6.5.0). API v6 confirmada leyendo los `.d.ts`/`.js` del paquete: `ThrottlerModule.forRoot([{ name, ttl, limit }])` con `ttl` en **milisegundos**; `ThrottlerGuard(options, storageService, reflector)` (3 args); `@Throttle({ default: { limit, ttl } })`. **`ThrottlerStorageService`** se exporta desde la raíz del paquete (índice re-exporta `./throttler.service`). **`ThrottlerException`** también.
- **CRÍTICO (corregido):** `ThrottlerGuard` sólo puebla su arreglo interno `this.throttlers` y los defaults `getTracker`/`generateKey` dentro de `onModuleInit()`. Un guard construido a mano en un test SIN llamar `await guard.onModuleInit()` lanza `TypeError: this.throttlers is not iterable`, no `ThrottlerException`. El test del borrador estaba roto; se corrige llamando `onModuleInit()`. Además el `getTracker` por defecto devuelve `req.ip` (no depende de `req.ips`), y `blockDuration` cae a `ttl` cuando no se define.
- `main.ts` hace bootstrap manual (`NestFactory.create` + `enableCors` + `listen(port, '0.0.0.0')`), sin `helmet` ni validación de env. Carga `.env` con `dotenv` (`config({ path: resolve(__dirname, '../../../.env') })`) ANTES de importar Nest. `bootstrap()` es `async function bootstrap(): Promise<void>` y el archivo cierra con `void bootstrap();`.
- `AppModule` ya registra un `APP_GUARD` (`PermissionsGuard`) e importa `APP_GUARD` de `@nestjs/core`. Agregar `ThrottlerGuard` como segundo `APP_GUARD` es aditivo.
- `AuthController.login` es `POST /auth/login`, decorado con `@Post('login')` y `@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`, firma `async login(@Body() body: LoginDto): Promise<{ token: string }>`. Sin throttling propio.
- `common/jwt.ts` lee `AUTH_JWT_SECRET` perezosamente (`secret()`) y sólo verifica que exista (no longitud).
- `common/password.ts` exporta `hashPassword`/`verifyPassword` (bcryptjs, SALT_ROUNDS=12). `common/provisional-password.ts` exporta `generateProvisionalPassword(length=12)` (CSPRNG, mínimo 12).
- `prisma/seed-admin.ts` siembra `admin@gmt.cl / <ADMIN_PASSWORD>` con `status: UserStatus.ACTIVE` fijo e imprime la clave — inseguro en prod. Importa `path`, `dotenv`, `@openfga/sdk`, `PrismaClient, UserStatus` de `@prisma/client`, `hashPassword` de `../src/common/password`. Carga `.env` con `config({ path: path.resolve(process.cwd(), '../../.env') })` (cwd al correr `pnpm --filter` es `nodes/backend-central`, `../../.env` = raíz del repo).
- `enum UserStatus { PENDING_FIRST_LOGIN, ACTIVE, SUSPENDED }` ya existe (`prisma/schema.prisma` línea 64-65); `default` del campo `status` es `PENDING_FIRST_LOGIN` (línea 23). `POST /auth/first-login/complete` fuerza el cambio de clave cuando el user está en `PENDING_FIRST_LOGIN`. **Reutilizamos ese estado** — sin migración nueva.
- Tests con **vitest** (`vitest.config.ts`: `include: ['test/**/*.spec.ts']`, entorno node). Patrón real (`test/auth/login.spec.ts`): construir la clase con mocks `vi.fn()`, `process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min'` en `beforeAll`. **`@nestjs/testing` y `supertest` NO están instalados** → los tests no usan `Test.createTestingModule` ni HTTP real; se construyen instancias directas.
- `tsconfig.test.json` tiene `"include": ["src", "test"]` (NO incluye `prisma/`). El nuevo spec de Task 4 importa `../../prisma/seed-admin`, por lo que `typecheck:test` fallará salvo que se añada `"prisma"` al include. **Corrección obligatoria, no opcional.**
- Scripts confirmados en `package.json`: `test` = `pnpm run typecheck:test && vitest run`; `typecheck:test` = `tsc -p tsconfig.test.json`; `build` = `nest build`; `seed:admin` = `tsx prisma/seed-admin.ts`; `fga:bootstrap` = `tsx scripts/fga-bootstrap.ts` (script `scripts/fga-bootstrap.ts` existe). NO existe script `start` que llame `dist/main.js` distinto; sí existe `start` = `node dist/main.js`.
- Dockerfiles confirmados: `nodes/backend-central/Dockerfile` y `nodes/web/Dockerfile` existen. `HealthController` responde en `GET /health`.
- Git: remoto `origin https://github.com/japalmo/GMT-Link.git`; rama actual `feat/modulos-1-4` (los commits de esta fase caen en la rama de trabajo actual). `pnpm-lock.yaml` en la RAÍZ del monorepo (`gmt-link/pnpm-lock.yaml`).
- Shell: **PowerShell** para pnpm/tsc/vitest/node; **Bash** sólo para git.

> Nota de rutas para los comandos: el working dir es `C:/Users/juana/GMT/proyectos`. Los comandos PowerShell de abajo asumen que el cwd es el monorepo `gmt-link`. Si no lo es, anteponer `Set-Location C:/Users/juana/GMT/proyectos/gmt-link` una vez por terminal. Los `pnpm --filter` funcionan desde cualquier subruta del monorepo.

---

### Task 1: Rate limiting global + 5/min en POST /auth/login (@nestjs/throttler)

**Files:**
- Modify: `nodes/backend-central/package.json` (dep `@nestjs/throttler`)
- Modify: `nodes/backend-central/src/app.module.ts` (ThrottlerModule + ThrottlerGuard como APP_GUARD)
- Modify: `nodes/backend-central/src/auth/auth.controller.ts` (`@Throttle` en `login`)
- Create: `nodes/backend-central/test/auth/throttle-login.spec.ts` (verifica 429 tras exceder el límite)
- Modify: `pnpm-lock.yaml` (raíz del monorepo)

- [ ] **Step 1: Instalar `@nestjs/throttler` v6 (compatible con Nest 11).**
  PowerShell (cwd = `gmt-link`):
  ```powershell
  pnpm --filter @gmt-platform/backend-central add "@nestjs/throttler@^6.5.0"
  ```
  Salida esperada: pnpm agrega `"@nestjs/throttler": "^6.5.0"` a `dependencies` de `nodes/backend-central/package.json` y actualiza `pnpm-lock.yaml` (raíz). Verificar:
  ```powershell
  pnpm --filter @gmt-platform/backend-central why @nestjs/throttler
  ```
  Debe listar `@nestjs/throttler 6.x`.

- [ ] **Step 2 (test que falla): crear el spec del 429 en login.**
  Crear `nodes/backend-central/test/auth/throttle-login.spec.ts` con contenido COMPLETO. Ejerce el `ThrottlerGuard` REAL (no un mock): lo construye con un `ThrottlerStorageService` en memoria y las mismas opciones globales que registra AppModule, **llama `await guard.onModuleInit()`** (imprescindible: sin él `this.throttlers` queda `undefined` y `canActivate` lanza `TypeError`, no `ThrottlerException`), y le pasa un `ExecutionContext` que apunta al handler `AuthController.prototype.login` (de donde el guard lee la metadata `@Throttle`).
  ```ts
  import 'reflect-metadata';
  import { describe, it, expect, beforeEach } from 'vitest';
  import { ExecutionContext } from '@nestjs/common';
  import { Reflector } from '@nestjs/core';
  import {
    ThrottlerGuard,
    ThrottlerModuleOptions,
    ThrottlerStorageService,
    ThrottlerException,
  } from '@nestjs/throttler';
  import { AuthController } from '../../src/auth/auth.controller';

  /**
   * Verifica que el rate-limit por IP declarado con @Throttle sobre
   * AuthController.login (5 req / 60 s) produce ThrottlerException (HTTP 429)
   * en la 6.ª petición desde la misma IP.
   *
   * Se ejerce el ThrottlerGuard real: se construye con un ThrottlerStorageService
   * en memoria y las mismas opciones globales que registra AppModule, y se llama
   * a onModuleInit() (obligatorio: es ahí donde el guard puebla this.throttlers y
   * los defaults getTracker/generateKey; sin ello canActivate lanza TypeError).
   * El getTracker por defecto usa req.ip, así que basta con fijar la IP en el req.
   */

  const LIMIT = 5;
  const TTL_MS = 60_000;

  function makeContext(ip: string): ExecutionContext {
    const req = { ip, headers: {}, method: 'POST', url: '/auth/login' };
    const res = { header: () => undefined };
    return {
      getClass: () => AuthController,
      getHandler: () => AuthController.prototype.login,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as unknown as ExecutionContext;
  }

  async function makeGuard(): Promise<ThrottlerGuard> {
    const options: ThrottlerModuleOptions = [{ name: 'default', ttl: TTL_MS, limit: LIMIT }];
    const storage = new ThrottlerStorageService();
    const reflector = new Reflector();
    const guard = new ThrottlerGuard(options, storage, reflector);
    // onModuleInit puebla this.throttlers y los defaults internos del guard.
    await guard.onModuleInit();
    return guard;
  }

  describe('Rate limit de POST /auth/login', () => {
    let guard: ThrottlerGuard;
    beforeEach(async () => {
      guard = await makeGuard();
    });

    it('permite las primeras 5 peticiones y bloquea la 6.ª con ThrottlerException (429)', async () => {
      const ctx = makeContext('203.0.113.7');
      for (let i = 0; i < LIMIT; i++) {
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
      }
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ThrottlerException);
    });

    it('cuenta el límite por IP: otra IP no queda bloqueada', async () => {
      const ctxA = makeContext('203.0.113.7');
      for (let i = 0; i < LIMIT; i++) {
        await guard.canActivate(ctxA);
      }
      await expect(guard.canActivate(ctxA)).rejects.toBeInstanceOf(ThrottlerException);
      const ctxB = makeContext('198.51.100.9');
      await expect(guard.canActivate(ctxB)).resolves.toBe(true);
    });
  });
  ```

- [ ] **Step 3 (verlo fallar): correr el spec — debe fallar porque `login` aún no tiene `@Throttle`.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central exec vitest run test/auth/throttle-login.spec.ts
  ```
  Salida esperada: FAIL. Con `@Throttle` ausente en `login`, el guard aplica el límite GLOBAL (que registraremos como 120/min en Step 4) o —si aún no existe ese import— el spec falla en resolución del handler decorado; en cualquier caso la 6.ª petición con límite 5 NO se bloquea (el efectivo no es 5) → los `rejects.toBeInstanceOf(ThrottlerException)` fallan. Confirmar que vitest reporta el archivo en rojo antes de implementar.

- [ ] **Step 4 (implementación): registrar ThrottlerModule + ThrottlerGuard global en AppModule.**
  En `nodes/backend-central/src/app.module.ts`:
  1. Añadir el import (junto a los otros de `@nestjs/*`, tras `import { APP_GUARD } from '@nestjs/core';`):
     ```ts
     import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
     ```
  2. Añadir el módulo como PRIMER elemento del arreglo `imports` (antes de `ConfigModule.forRoot(...)`). Límite global: 120 req/min por IP.
     ```ts
     ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
     ```
     El bloque `imports` queda:
     ```ts
     imports: [
       ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
       ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
       CommonModule,
       // ...resto sin cambios...
     ],
     ```
  3. Reemplazar el `providers` actual `providers: [{ provide: APP_GUARD, useClass: PermissionsGuard }],` por (ThrottlerGuard primero para rechazar floods antes del trabajo de permisos):
     ```ts
     providers: [
       { provide: APP_GUARD, useClass: ThrottlerGuard },
       { provide: APP_GUARD, useClass: PermissionsGuard },
     ],
     ```

- [ ] **Step 5 (implementación): endurecer `POST /auth/login` a 5/min por IP.**
  En `nodes/backend-central/src/auth/auth.controller.ts`:
  1. Añadir el import tras `import { signToken } from '../common/jwt';`:
     ```ts
     import { Throttle } from '@nestjs/throttler';
     ```
  2. Decorar el handler `login` añadiendo `@Throttle` ENCIMA de `@Post('login')` (el resto del método queda idéntico):
     ```ts
     @Throttle({ default: { limit: 5, ttl: 60_000 } })
     @Post('login')
     @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
     async login(@Body() body: LoginDto): Promise<{ token: string }> {
     ```

- [ ] **Step 6 (verde): correr el spec del throttler y ver que pasa.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central exec vitest run test/auth/throttle-login.spec.ts
  ```
  Salida esperada: PASS (2 tests). Luego typecheck de tests para asegurar que los imports nuevos compilan:
  ```powershell
  pnpm --filter @gmt-platform/backend-central run typecheck:test
  ```
  Salida esperada: sin errores (exit 0).

- [ ] **Step 7 (regresión): correr la suite completa del backend.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central test
  ```
  Salida esperada: toda la suite verde. `login.spec.ts`, `auth.controller.spec.ts` y `session.middleware.spec.ts` prueban el controlador construido a mano (sin pasar por el guard global), así que el throttling no los afecta.

- [ ] **Step 8 (commit).**
  Bash:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link && git add nodes/backend-central/package.json nodes/backend-central/src/app.module.ts nodes/backend-central/src/auth/auth.controller.ts nodes/backend-central/test/auth/throttle-login.spec.ts pnpm-lock.yaml && git commit -m "feat(seguridad): rate limiting global y 5/min por IP en POST /auth/login con @nestjs/throttler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 2: helmet en el bootstrap (cabeceras de seguridad)

**Files:**
- Modify: `nodes/backend-central/package.json` (dep `helmet`)
- Modify: `nodes/backend-central/src/main.ts` (`app.use(helmet())`)
- Modify: `pnpm-lock.yaml` (raíz del monorepo)

- [ ] **Step 1: Instalar `helmet`.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central add "helmet@^8.0.0"
  ```
  Salida esperada: `"helmet": "^8.0.0"` en `dependencies` de `nodes/backend-central/package.json` y `pnpm-lock.yaml` (raíz) actualizado. (helmet v8 trae sus propios tipos; no requiere `@types/helmet`.)

- [ ] **Step 2 (implementación): añadir `helmet` en `main.ts` antes de `enableCors`.**
  En `nodes/backend-central/src/main.ts`:
  1. Añadir el import tras `import { AppModule } from './app.module';`:
     ```ts
     import helmet from 'helmet';
     ```
  2. Dentro de `bootstrap()`, inmediatamente después de `const app = await NestFactory.create(AppModule);` y ANTES del bloque de CORS (`const corsOrigins = ...`):
     ```ts
     // Cabeceras de seguridad HTTP (X-Content-Type-Options, HSTS, etc.).
     // La API es JSON pura (sin HTML propio) → desactivamos la CSP por defecto
     // de helmet, que sólo aplica a documentos servidos por esta app; el resto
     // de cabeceras sí se aplican.
     app.use(helmet({ contentSecurityPolicy: false }));
     ```
  El bloque de CORS y `app.listen(port, '0.0.0.0')` quedan igual.

- [ ] **Step 3 (build + regresión de tipos).**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central build
  ```
  Salida esperada: build sin errores (el import de `helmet` compila; `nest build` emite a `dist/`).

- [ ] **Step 4 (verificación de cabeceras — manual, no TDD): arrancar la API local y comprobar cabeceras.**
  Requiere Postgres arriba (WSL/docker-compose). PowerShell, terminal 1 (cwd = `gmt-link`):
  ```powershell
  $env:AUTH_JWT_SECRET = "clave-local-de-desarrollo-de-32-bytes-minimo"; node nodes/backend-central/dist/main.js
  ```
  Salida esperada: la API escucha en `0.0.0.0:3001`. PowerShell, terminal 2:
  ```powershell
  (Invoke-WebRequest -Uri http://localhost:3001/health -UseBasicParsing).Headers | Format-List
  ```
  Salida esperada: entre las cabeceras aparecen `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control` y `X-Frame-Options: SAMEORIGIN`, y NO aparece `X-Powered-By` (helmet lo elimina). Detener la API (Ctrl+C) al terminar.
  > Verificación explícita si no hay Postgres a mano: este paso es opcional para el commit; el build de Step 3 ya garantiza que `helmet` compila e integra. Ejecutar el paso 4 cuando haya BD disponible.

- [ ] **Step 5 (commit).**
  Bash:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link && git add nodes/backend-central/package.json nodes/backend-central/src/main.ts pnpm-lock.yaml && git commit -m "feat(seguridad): aplicar helmet en el bootstrap para cabeceras de seguridad HTTP

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 3: validar AUTH_JWT_SECRET al arrancar (falla el boot si ausente o <32 bytes)

**Decisión de ubicación (leyendo el arranque actual):** `main.ts` carga `.env` con `dotenv` ANTES de importar Nest, y luego `bootstrap()` crea la app. Ponemos la validación en un módulo puro y reutilizable (`src/common/env.ts`) y la invocamos como PRIMERA instrucción de `bootstrap()`, después de que `dotenv` ya pobló `process.env`. Así el fallo ocurre antes de instanciar la app (fail-fast) y la función queda unit-testeable sin levantar Nest.

**Files:**
- Create: `nodes/backend-central/src/common/env.ts` (validador)
- Modify: `nodes/backend-central/src/main.ts` (llamada en bootstrap)
- Create: `nodes/backend-central/test/common/env.spec.ts` (test unitario)

- [ ] **Step 1 (test que falla): crear el spec del validador.**
  Crear `nodes/backend-central/test/common/env.spec.ts`:
  ```ts
  import { describe, it, expect, afterEach } from 'vitest';
  import { validateAuthJwtSecret } from '../../src/common/env';

  /**
   * validateAuthJwtSecret debe abortar el arranque cuando AUTH_JWT_SECRET
   * está ausente o es demasiado corto (< 32 bytes UTF-8). Un secreto HS256
   * corto es adivinable por fuerza bruta, así que exigimos >= 32.
   */
  describe('validateAuthJwtSecret', () => {
    const original = process.env.AUTH_JWT_SECRET;
    afterEach(() => {
      if (original === undefined) delete process.env.AUTH_JWT_SECRET;
      else process.env.AUTH_JWT_SECRET = original;
    });

    it('lanza si AUTH_JWT_SECRET está ausente', () => {
      delete process.env.AUTH_JWT_SECRET;
      expect(() => validateAuthJwtSecret()).toThrow(/AUTH_JWT_SECRET/);
    });

    it('lanza si AUTH_JWT_SECRET tiene menos de 32 bytes', () => {
      process.env.AUTH_JWT_SECRET = 'corto'; // 5 bytes
      expect(() => validateAuthJwtSecret()).toThrow(/32/);
    });

    it('lanza si AUTH_JWT_SECRET tiene exactamente 31 bytes', () => {
      process.env.AUTH_JWT_SECRET = 'a'.repeat(31);
      expect(() => validateAuthJwtSecret()).toThrow(/32/);
    });

    it('no lanza con un secreto de 32 bytes exactos', () => {
      process.env.AUTH_JWT_SECRET = 'a'.repeat(32);
      expect(() => validateAuthJwtSecret()).not.toThrow();
    });

    it('cuenta bytes UTF-8, no caracteres (multibyte)', () => {
      // 16 emojis de 4 bytes c/u = 64 bytes pero sólo 16 code points visibles.
      process.env.AUTH_JWT_SECRET = '😀'.repeat(16);
      expect(() => validateAuthJwtSecret()).not.toThrow();
    });
  });
  ```

- [ ] **Step 2 (verlo fallar): correr el spec.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central exec vitest run test/common/env.spec.ts
  ```
  Salida esperada: FAIL con error de resolución de módulo (`src/common/env` no existe todavía).

- [ ] **Step 3 (implementación): crear `src/common/env.ts`.**
  Crear `nodes/backend-central/src/common/env.ts`:
  ```ts
  /**
   * Validación de variables de entorno críticas al arranque (fail-fast).
   *
   * Se invoca al inicio de bootstrap() en main.ts, después de que dotenv pobló
   * process.env y antes de instanciar la app Nest, de modo que un secreto débil
   * o ausente aborta el proceso ANTES de aceptar tráfico.
   */

  /** Longitud mínima recomendada para una clave HMAC-SHA256 (32 bytes = 256 bits). */
  const MIN_SECRET_BYTES = 32;

  /**
   * Verifica que AUTH_JWT_SECRET exista y tenga al menos 32 bytes (UTF-8).
   * Lanza Error (que aborta el boot) si no cumple. Mide BYTES, no caracteres,
   * porque la fortaleza del HMAC depende de los bytes de la clave.
   */
  export function validateAuthJwtSecret(): void {
    const secret = process.env.AUTH_JWT_SECRET;
    if (!secret) {
      throw new Error(
        'AUTH_JWT_SECRET no está configurado. Define un secreto de al menos 32 bytes antes de arrancar.',
      );
    }
    const bytes = Buffer.byteLength(secret, 'utf8');
    if (bytes < MIN_SECRET_BYTES) {
      throw new Error(
        `AUTH_JWT_SECRET es demasiado corto (${bytes} bytes). Se requieren al menos ${MIN_SECRET_BYTES} bytes para HS256.`,
      );
    }
  }
  ```

- [ ] **Step 4 (verde): correr el spec.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central exec vitest run test/common/env.spec.ts
  ```
  Salida esperada: PASS (5 tests).

- [ ] **Step 5 (integración): invocar la validación en `main.ts`.**
  En `nodes/backend-central/src/main.ts`:
  1. Añadir el import tras `import { AppModule } from './app.module';` (y tras el de helmet de Task 2):
     ```ts
     import { validateAuthJwtSecret } from './common/env';
     ```
  2. Como PRIMERA instrucción dentro de `bootstrap()`, antes de `const app = await NestFactory.create(AppModule);`:
     ```ts
     async function bootstrap(): Promise<void> {
       // Fail-fast: aborta el arranque si AUTH_JWT_SECRET falta o es débil.
       validateAuthJwtSecret();
       const app = await NestFactory.create(AppModule);
     ```

- [ ] **Step 6 (verificación manual del fail-fast): arrancar sin el secreto y ver el aborto.**
  PowerShell (cwd = `gmt-link`):
  ```powershell
  pnpm --filter @gmt-platform/backend-central build
  Remove-Item Env:AUTH_JWT_SECRET -ErrorAction SilentlyContinue; node nodes/backend-central/dist/main.js; Write-Host "exit=$LASTEXITCODE"
  ```
  Salida esperada: el proceso imprime `Error: AUTH_JWT_SECRET no está configurado...` y termina con `exit` distinto de 0 (no queda escuchando). Luego con un secreto válido arranca:
  ```powershell
  $env:AUTH_JWT_SECRET = "clave-local-de-desarrollo-de-32-bytes-minimo"; node nodes/backend-central/dist/main.js
  ```
  Salida esperada: arranca y escucha en `0.0.0.0:3001` (Ctrl+C para detener). Nota: este arranque completo requiere Postgres; si no hay BD, basta con confirmar que el aborto por secreto ausente ocurre ANTES de intentar conectar (el mensaje de error de `validateAuthJwtSecret` aparece primero).

- [ ] **Step 7 (regresión + commit).**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central test
  ```
  Salida esperada: suite verde.
  Bash:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link && git add nodes/backend-central/src/common/env.ts nodes/backend-central/src/main.ts nodes/backend-central/test/common/env.spec.ts && git commit -m "feat(seguridad): abortar el arranque si AUTH_JWT_SECRET falta o mide menos de 32 bytes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 4: siembra segura del admin en producción

**Diseño (leyendo `seed-admin.ts` y el enum `UserStatus`):** hoy el seed fija `status: ACTIVE` y clave pública `<ADMIN_PASSWORD>`. En producción eso re-siembra una credencial conocida en cada release. Solución concreta:

- Detectar producción con `NODE_ENV === 'production'`.
- En **dev** (comportamiento actual): sigue usando `admin@gmt.cl / <ADMIN_PASSWORD>`, `status: ACTIVE`, e imprime la clave (cómodo para desarrollo local).
- En **prod**:
  - La contraseña viene de `ADMIN_PASSWORD` (env) si está definida; si no, se **genera aleatoria** con `generateProvisionalPassword(16)` (existe en `src/common/provisional-password.ts`, CSPRNG) e se **imprime una sola vez** en el log del release.
  - El admin se siembra con `status: PENDING_FIRST_LOGIN` (estado ya existente) para **forzar el cambio de clave** en el primer login vía `POST /auth/first-login/complete` (ya implementado). Aun cuando la clave se imprima en logs del deploy, deja de ser válida en cuanto el admin la cambia.
  - En prod, si el admin YA existe, NO se re-baja su `passwordHash` ni su `status` (no invalida su clave real en cada release): el `update` en prod sólo toca nombre.

**Files:**
- Modify: `nodes/backend-central/prisma/seed-admin.ts`
- Create: `nodes/backend-central/test/prisma/seed-admin.spec.ts`
- Modify: `nodes/backend-central/tsconfig.test.json` (añadir `prisma` al `include` — obligatorio: el `include` actual es `["src", "test"]` y el nuevo spec importa `../../prisma/seed-admin`)

- [ ] **Step 1 (arreglar `tsconfig.test.json` ANTES del test): añadir `prisma` al include.**
  En `nodes/backend-central/tsconfig.test.json`, cambiar:
  ```json
  "include": ["src", "test"]
  ```
  por:
  ```json
  "include": ["src", "test", "prisma"]
  ```
  (Verificado: sin esto, `typecheck:test` no resuelve el import `../../prisma/seed-admin` del nuevo spec.)

- [ ] **Step 2 (test que falla): crear el spec de la lógica de resolución de credenciales.**
  Para hacerlo unit-testeable extraemos la decisión a una función pura exportada `resolveAdminSeed(env)`. Crear `nodes/backend-central/test/prisma/seed-admin.spec.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { resolveAdminSeed } from '../../prisma/seed-admin';

  /**
   * resolveAdminSeed decide, según el entorno, con qué credenciales y estado se
   * siembra el admin:
   *  - dev: clave fija pública + ACTIVE (cómodo para desarrollo local).
   *  - prod: ADMIN_PASSWORD si está; si no, una aleatoria; status PENDING para
   *    forzar cambio de clave en el primer login.
   */
  describe('resolveAdminSeed', () => {
    it('dev: usa la clave fija y status ACTIVE', () => {
      const r = resolveAdminSeed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv);
      expect(r.password).toBe('<ADMIN_PASSWORD>');
      expect(r.status).toBe('ACTIVE');
      expect(r.mustChangePassword).toBe(false);
      expect(r.generated).toBe(false);
    });

    it('prod con ADMIN_PASSWORD: usa esa clave y status PENDING_FIRST_LOGIN', () => {
      const r = resolveAdminSeed({ NODE_ENV: 'production', ADMIN_PASSWORD: 'MiClaveProdSuperSegura!' } as NodeJS.ProcessEnv);
      expect(r.password).toBe('MiClaveProdSuperSegura!');
      expect(r.status).toBe('PENDING_FIRST_LOGIN');
      expect(r.mustChangePassword).toBe(true);
      expect(r.generated).toBe(false);
    });

    it('prod sin ADMIN_PASSWORD: genera una clave aleatoria fuerte y status PENDING_FIRST_LOGIN', () => {
      const r = resolveAdminSeed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
      expect(r.status).toBe('PENDING_FIRST_LOGIN');
      expect(r.mustChangePassword).toBe(true);
      expect(r.generated).toBe(true);
      expect(r.password.length).toBeGreaterThanOrEqual(12);
      expect(r.password).not.toBe('<ADMIN_PASSWORD>');
    });

    it('prod nunca usa la clave pública fija', () => {
      const r = resolveAdminSeed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
      expect(r.password).not.toBe('<ADMIN_PASSWORD>');
    });
  });
  ```

- [ ] **Step 3 (verlo fallar): correr el spec.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central exec vitest run test/prisma/seed-admin.spec.ts
  ```
  Salida esperada: FAIL — `resolveAdminSeed` no está exportada por `prisma/seed-admin.ts`.

- [ ] **Step 4 (implementación): reescribir `seed-admin.ts` con la resolución de credenciales y el sembrado seguro en prod.**
  Reemplazar el contenido COMPLETO de `nodes/backend-central/prisma/seed-admin.ts` por:
  ```ts
  /**
   * Seed del administrador de organización (§1.1, prueba de la provisión).
   *
   * Idempotente. Asegura, para `admin@gmt.cl`:
   *  1. Postgres   — User + Membership org_admin ORGANIZATION ORG_ID (espejo §4.1).
   *  2. OpenFGA    — tupla user:<id> admin organization:gmt (§4.3).
   *
   * Credenciales según entorno (ver resolveAdminSeed):
   *  - dev:  clave fija pública `<ADMIN_PASSWORD>`, status ACTIVE (cómodo en local).
   *  - prod: `ADMIN_PASSWORD` si está definida; si no, una clave ALEATORIA
   *          impresa una sola vez. Status PENDING_FIRST_LOGIN para FORZAR el
   *          cambio de clave en el primer login (flujo /auth/first-login/complete).
   *          Nunca se re-baja el passwordHash de un admin ya existente en prod.
   *
   * Ejecutar con: pnpm --filter @gmt-platform/backend-central seed:admin
   * Requiere: Postgres arriba, catálogo sembrado antes (`pnpm db:seed`) y, para
   * la tupla FGA, OpenFGA bootstrapeado (FGA_STORE_ID/FGA_MODEL_ID en env).
   */
  import path from 'node:path';
  import { config } from 'dotenv';
  import { OpenFgaClient } from '@openfga/sdk';
  import { PrismaClient, UserStatus } from '@prisma/client';
  import { hashPassword } from '../src/common/password';
  import { generateProvisionalPassword } from '../src/common/provisional-password';

  config({ path: path.resolve(process.cwd(), '../../.env') });

  const ORG_ID = 'gmt';
  const ADMIN = {
    email: 'admin@gmt.cl',
    firstName: 'Admin',
    lastName: 'GMT',
    roleKey: 'org_admin',
  } as const;

  /** Clave fija SOLO para desarrollo local. Nunca se usa en producción. */
  const DEV_PASSWORD = '<ADMIN_PASSWORD>';

  /** Resultado de la decisión de credenciales del admin según el entorno. */
  export interface AdminSeedResolution {
    /** Clave en claro a sembrar (se hashea antes de persistir). */
    password: string;
    /** Estado inicial del User. PENDING_FIRST_LOGIN fuerza cambio de clave. */
    status: 'ACTIVE' | 'PENDING_FIRST_LOGIN';
    /** true si la clave fue generada aleatoriamente (para avisar en el log). */
    generated: boolean;
    /** true en producción: el admin debe cambiar la clave en el primer login. */
    mustChangePassword: boolean;
  }

  /**
   * Decide, de forma pura (testeable), con qué credenciales/estado se siembra el
   * admin. En prod jamás devuelve la clave pública fija.
   */
  export function resolveAdminSeed(env: NodeJS.ProcessEnv): AdminSeedResolution {
    const isProd = env.NODE_ENV === 'production';
    if (!isProd) {
      return { password: DEV_PASSWORD, status: 'ACTIVE', generated: false, mustChangePassword: false };
    }
    const provided = env.ADMIN_PASSWORD?.trim();
    if (provided) {
      return { password: provided, status: 'PENDING_FIRST_LOGIN', generated: false, mustChangePassword: true };
    }
    return {
      password: generateProvisionalPassword(16),
      status: 'PENDING_FIRST_LOGIN',
      generated: true,
      mustChangePassword: true,
    };
  }

  const prisma = new PrismaClient();

  /**
   * Asegura el User en Postgres. Devuelve `{ id, seededPassword }` donde
   * seededPassword es la clave a comunicar al admin (o null si el usuario ya
   * existía y en prod no se tocó su clave).
   */
  async function ensurePostgresUser(
    resolution: AdminSeedResolution,
  ): Promise<{ id: string; seededPassword: string | null }> {
    const existing = await prisma.user.findUnique({
      where: { email: ADMIN.email },
      select: { id: true, status: true },
    });

    const isProd = process.env.NODE_ENV === 'production';

    // En prod, si el admin YA existe (cualquier estado), no re-bajamos su clave
    // ni su estado: evitamos invalidar la clave real que ya fijó, en cada release.
    if (existing && isProd) {
      await prisma.user.update({
        where: { email: ADMIN.email },
        data: { firstName: ADMIN.firstName, lastName: ADMIN.lastName },
      });
      console.log(
        `Postgres: User existente conservado ${ADMIN.email} (id ${existing.id}, status ${existing.status}) — clave NO modificada.`,
      );
      return { id: existing.id, seededPassword: null };
    }

    const passwordHash = await hashPassword(resolution.password);
    const statusValue =
      resolution.status === 'PENDING_FIRST_LOGIN'
        ? UserStatus.PENDING_FIRST_LOGIN
        : UserStatus.ACTIVE;

    const user = await prisma.user.upsert({
      where: { email: ADMIN.email },
      update: { firstName: ADMIN.firstName, lastName: ADMIN.lastName, status: statusValue, passwordHash },
      create: {
        email: ADMIN.email,
        firstName: ADMIN.firstName,
        lastName: ADMIN.lastName,
        status: statusValue,
        isClientUser: false,
        passwordHash,
      },
    });
    console.log(`Postgres: User asegurado ${user.email} (id ${user.id}, status ${user.status})`);
    return { id: user.id, seededPassword: resolution.password };
  }

  /** Asegura la Membership org_admin ORGANIZATION ORG_ID. */
  async function ensureMembership(userId: string): Promise<void> {
    await prisma.membership.upsert({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: ADMIN.roleKey,
          scopeType: 'ORGANIZATION',
          scopeId: ORG_ID,
        },
      },
      update: {},
      create: { userId, roleKey: ADMIN.roleKey, scopeType: 'ORGANIZATION', scopeId: ORG_ID },
    });
    console.log(`Postgres: Membership ${ADMIN.roleKey} ORGANIZATION:${ORG_ID} asegurada`);
  }

  /** Escribe la tupla FGA user:<id> admin organization:gmt (idempotente). */
  async function ensureFgaTuple(userId: string): Promise<void> {
    const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';
    const storeId = process.env.FGA_STORE_ID;
    if (!storeId) {
      console.log('OpenFGA omitido: FGA_STORE_ID vacío.');
      return;
    }
    const modelId = process.env.FGA_MODEL_ID || undefined;
    const client = new OpenFgaClient({ apiUrl, storeId, authorizationModelId: modelId });
    const tuple = { user: `user:${userId}`, relation: 'admin', object: `organization:${ORG_ID}` };
    try {
      await client.write({ writes: [tuple] });
      console.log(`OpenFGA: tupla escrita ${tuple.user} ${tuple.relation} ${tuple.object}`);
    } catch (error: unknown) {
      const errObj = error as Record<string, unknown>;
      const message = [
        error instanceof Error ? error.message : String(error),
        typeof errObj['apiErrorCode'] === 'string' ? errObj['apiErrorCode'] : '',
        typeof errObj['apiErrorMessage'] === 'string' ? errObj['apiErrorMessage'] : '',
      ].join(' ');
      if (/already exists|write_failed_due_to_invalid_input|duplicate/i.test(message)) {
        console.log(`OpenFGA: tupla ya existía ${tuple.user} ${tuple.relation} ${tuple.object}`);
        return;
      }
      if (/authorization_model_not_found/i.test(message)) {
        console.warn('OpenFGA: FGA_MODEL_ID obsoleto — tupla no escrita. Actualiza FGA_MODEL_ID o re-bootstrapea OpenFGA.');
        return;
      }
      throw error;
    }
  }

  async function main(): Promise<void> {
    const resolution = resolveAdminSeed(process.env);
    const { id: userId, seededPassword } = await ensurePostgresUser(resolution);
    await ensureMembership(userId);
    await ensureFgaTuple(userId);

    if (seededPassword === null) {
      console.log('\n=== Admin ya existía en producción: no se muestran credenciales (clave sin cambios) ===');
      return;
    }

    console.log('\n=== Credenciales del admin (compartir manualmente, §9) ===');
    console.log(`  email:    ${ADMIN.email}`);
    console.log(`  password: ${seededPassword}`);
    if (resolution.generated) {
      console.log('  (clave generada aleatoriamente — se muestra UNA sola vez)');
    }
    if (resolution.mustChangePassword) {
      console.log('  status: PENDING_FIRST_LOGIN — el admin DEBE cambiar la clave en el primer login.');
    }
    console.log('===========================================================');
  }

  main()
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
  ```

- [ ] **Step 5 (verde): correr el spec.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central exec vitest run test/prisma/seed-admin.spec.ts
  ```
  Salida esperada: PASS (4 tests).

- [ ] **Step 6 (typecheck de tests + regresión): asegurar que el spec del seed compila y la suite sigue verde.**
  PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central test
  ```
  Salida esperada: suite completa verde. `typecheck:test` (que corre `tsc -p tsconfig.test.json`) ahora resuelve `../../prisma/seed-admin` porque en el Step 1 se añadió `"prisma"` al `include`. Si aún reportara error de resolución, revisar que el cambio del Step 1 quedó guardado.

- [ ] **Step 7 (verificación funcional en dev): correr el seed en dev y confirmar comportamiento actual intacto.**
  Requiere Postgres arriba y catálogo sembrado (`pnpm --filter @gmt-platform/backend-central db:seed`). PowerShell:
  ```powershell
  pnpm --filter @gmt-platform/backend-central seed:admin
  ```
  Salida esperada: imprime `status ACTIVE` y `password: <ADMIN_PASSWORD>` (comportamiento dev sin cambios, porque `NODE_ENV` no es `production`). Si no hay BD disponible, omitir este paso; los tests del Step 5-6 ya cubren la lógica de resolución.

- [ ] **Step 8 (commit).**
  Bash:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link && git add nodes/backend-central/prisma/seed-admin.ts nodes/backend-central/test/prisma/seed-admin.spec.ts nodes/backend-central/tsconfig.test.json && git commit -m "feat(seguridad): siembra segura del admin en produccion (clave por env o aleatoria + cambio forzado)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

### Task 5: reescribir docs/railway-deploy.md (NO es TDD)

**Objetivo:** eliminar todo Firebase, documentar `AUTH_JWT_SECRET` (y su validación de la Task 3), fijar `RAILWAY_DOCKERFILE_PATH` por servicio, y resolver la contradicción Nixpacks vs Dockerfile del doc actual (que en §8 dice tener Dockerfiles en `main` pero en §1–§3 describe Nixpacks; se unifica a **Dockerfile por servicio**). Ruta real confirmada: `gmt-link/docs/railway-deploy.md`.

**Files:**
- Modify: `docs/railway-deploy.md`

- [ ] **Step 1: reemplazar el contenido COMPLETO de `docs/railway-deploy.md` por el siguiente.**
  ```markdown
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
  | `CORS_ORIGINS` | URL pública del web, p. ej. `https://gmt-link-web.up.railway.app` | — |
  | `NODE_ENV` | `production` | — |
  | `PORT` | lo inyecta Railway (no fijar) | — |

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

  Proyecto Railway: **`valiant-rebirth`** (env `production`).

  - ✅ **postgres-gmt** provisionado.
  - ✅ Dockerfiles `nodes/backend-central/Dockerfile` y `nodes/web/Dockerfile` en `main`.
  - Pendiente: crear api + web + openfga (requiere plan Hobby si el free bloquea).

  **Cómo retomar** (con un Project Token en `RAILWAY_TOKEN` — Project → Settings → Tokens):

  1. `railway add --service api --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=nodes/backend-central/Dockerfile' --variables 'DATABASE_URL=${{postgres-gmt.DATABASE_URL}}' --variables 'NODE_ENV=production' --variables 'AUTH_JWT_SECRET=<secreto->=32-bytes>'`
  2. Resto de variables del api (§2): `ADMIN_PASSWORD` (opcional), `NVIDIA_API_KEY`, `NVIDIA_API_KEY_VISION`, `CORS_ORIGINS` (= URL pública del web), y `FGA_API_URL/STORE_ID/MODEL_ID` (tras bootstrap).
  3. `railway add --service web --repo japalmo/GMT-Link --branch main --variables 'RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile' --variables 'VITE_API_URL=<url-publica-api>'`.
  4. `railway add --image openfga/openfga --service openfga` + su Postgres backing + start `openfga migrate && openfga run`; luego `pnpm --filter @gmt-platform/backend-central fga:bootstrap` apuntando a su URL para obtener `FGA_STORE_ID` / `FGA_MODEL_ID`.
  5. `railway domain` SÓLO en api y web; cablear `CORS_ORIGINS` (api) ↔ `VITE_API_URL` (web).

  > La CLI sólo funciona con **Project Token** (`RAILWAY_TOKEN`), no con el token de equipo.
  ```

- [ ] **Step 2 (verificación): confirmar que no quedan referencias a Firebase ni Nixpacks.**
  Bash:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link && grep -niE "firebase|nixpacks" docs/railway-deploy.md; echo "hits=$?"
  ```
  Salida esperada: sin líneas de resultado y `hits=1` (grep devuelve 1 cuando no encuentra coincidencias). Además confirmar que `AUTH_JWT_SECRET` y ambos `RAILWAY_DOCKERFILE_PATH` sí aparecen:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link && grep -nE "AUTH_JWT_SECRET|RAILWAY_DOCKERFILE_PATH" docs/railway-deploy.md
  ```
  Salida esperada: varias líneas, incluyendo `nodes/backend-central/Dockerfile` y `nodes/web/Dockerfile`.

- [ ] **Step 3 (commit).**
  Bash:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link && git add docs/railway-deploy.md && git commit -m "docs(railway): eliminar Firebase, documentar AUTH_JWT_SECRET y fijar Dockerfile por servicio

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```

---

## Notas de entrega para el ejecutor (verificado contra el repo)

- El fix crítico es Task 1 Step 2: el `ThrottlerGuard` construido a mano DEBE recibir `await guard.onModuleInit()` antes de `canActivate`, o lanza `TypeError` en vez de `ThrottlerException`. `ThrottlerStorageService` y `ThrottlerException` se importan desde `@nestjs/throttler` (raíz del paquete) — confirmado en el índice del paquete.
- El fix obligatorio de Task 4 Step 1: `tsconfig.test.json` pasa de `["src","test"]` a `["src","test","prisma"]`; sin ello `typecheck:test` (parte de `pnpm test`) falla al resolver `../../prisma/seed-admin`.
- No se necesita migración Prisma: `UserStatus.PENDING_FIRST_LOGIN` ya existe (`prisma/schema.prisma` línea 65) y `/auth/first-login/complete` ya fuerza el cambio de clave.
- `pnpm-lock.yaml` vive en la RAÍZ del monorepo (`gmt-link/pnpm-lock.yaml`), por eso los `git add` de Tasks 1 y 2 lo referencian con ruta desde la raíz.
- La rama actual es `feat/modulos-1-4` (no `main`); los commits caen ahí. El deploy de Railway auto-despliega desde `main`, por lo que el merge a `main` es un paso posterior fuera del alcance de esta fase.


---


## Fase 2 — Deploy single-DB en Railway (plan verificado y corregido)

> **Objetivo:** dejar los 5 servicios (`postgres-gmt`, `openfga-db`, `openfga`, `api`, `web`) online en Railway con auto-deploy desde `main`, los datos del PostgreSQL local migrados a producción y el login web funcionando en vivo.
>
> **Verdad de terreno CONFIRMADA leyendo el repo (2026-07-06):**
> - Repo GitHub: `japalmo/GMT-Link` (remote `origin` confirmado). Rama de trabajo actual: `feat/modulos-1-4` (confirmada con `git branch --show-current`). Rama de auto-deploy: `main`.
> - Filtros pnpm EXACTOS (verificados en package.json): api = `@gmt-platform/backend-central`, web = `@gmt-platform/web`, tipos = `@gmt-platform/contracts`.
> - Scripts backend EXACTOS (verificados): `db:seed` (`tsx prisma/seed.ts`), `seed:admin` (`tsx prisma/seed-admin.ts`), `fga:bootstrap` (`tsx scripts/fga-bootstrap.ts`). NO existe script `db:migrate deploy`; la migración se corre con `pnpm exec prisma migrate deploy`.
> - `nodes/backend-central/Dockerfile` línea 31 hoy: `CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]` → carrera de migración con >1 réplica; se saca a pre-deploy (Task 5). WORKDIR final del Dockerfile = `/app/nodes/backend-central` (línea 28).
> - `deploy/openfga/Dockerfile` YA existe: `FROM alpine:3.20`, copia `/openfga` de `openfga/openfga:latest`, `ENTRYPOINT ["/bin/sh","-c","openfga migrate && openfga run"]`, `EXPOSE 8080 8081`. Se usa ESTE (no la imagen distroless cruda).
> - `nodes/web/Dockerfile` hornea `VITE_*` vía `ARG`/`ENV` en build (multi-stage: build node:22-slim → runtime `serve@14` en `${PORT:-3000}`). Tiene `ARG VITE_API_URL` y ARGs Firebase con **default vacío** (`VITE_FIREBASE_*`): dejarlos sin setear queda como cadena vacía; NO hay que setear ninguna variable Firebase. Cambiar `VITE_API_URL` obliga re-deploy.
> - `scripts/fga-bootstrap.ts` (verificado): imprime por stdout `Store "gmt-link": <id> (creado)` **o** `(existente)`, luego `Authorization model: <id>`, luego `IDs escritos en <ruta>/.env`. `updateEnv()` hace `readFileSync(ENV_PATH)` sobre `../../.env` (raíz del monorepo) → ese archivo DEBE existir en la máquina donde corre el script. Lee `FGA_API_URL` de env (default `http://localhost:8080`). Los IDs se leen del **stdout**, no del `.env`.
> - `src/main.ts` (verificado): CORS por `CORS_ORIGINS` (coma-separado, default `http://localhost:5173`), escucha `0.0.0.0`, puerto `Number(process.env.PORT ?? 3001)`.
> - `src/common/jwt.ts` (verificado): `AUTH_JWT_SECRET` se valida **de forma perezosa** — `secret()` lanza `Error('AUTH_JWT_SECRET no está configurado.')` sólo al FIRMAR o VERIFICAR un token (primer `/auth/login` o `/auth/me`), NO al arrancar. El server arranca sin la variable; el login falla si falta.
> - `src/health.controller.ts` (verificado): `GET /health` → `{ status:'ok', service:'gmt-link-api', timestamp }`.
> - `src/auth/*.controller.ts` (verificado): `POST /auth/login` devuelve `{ token }` (sólo valida email+passwordHash, NO gatea por `status`); `GET /auth/me` (requiere Bearer; usa Postgres + FGA vía `resolveCanManageRoles`). Existe también `POST /auth/first-login/complete`.
> - `prisma/seed.ts` (verificado): idempotente (upsert de Permission/Role/RolePermission); imprime `Permisos asegurados: N`, `Roles asegurados: ...`, `Bundles rol→permiso: N`.
> - `prisma/seed-admin.ts` (verificado): idempotente; requiere catálogo sembrado ANTES (FK `Membership.roleKey → Role.key`); admin `admin@gmt.cl` / `<ADMIN_PASSWORD>`, `ORG_ID='gmt'`, rol `org_admin`. Imprime `Postgres: User asegurado admin@gmt.cl ...`, `Postgres: Membership org_admin ORGANIZATION:gmt asegurada`, y `OpenFGA: tupla escrita ...` / `... ya existía ...` (o `OpenFGA omitido: FGA_STORE_ID vacío.` si no hay FGA). Lee `../../.env`.
> - `.dockerignore` (verificado, raíz): excluye `.env` y `.env.*` (sólo permite `.env.example`) → **dentro del contenedor NO hay `.env`**. Por eso `fga:bootstrap`/`seed:*` sólo pueden correr en local (con el `.env` de la raíz) o vía `railway run` (que corre en local).
> - `nodes/backend-central/fga/model.fga` (verificado) existe: lo consume `fga:bootstrap`.
> - `docs/railway-deploy.md` (verificado) existe (a actualizar en Task 8).
>
> **Railway CLI verificada en esta máquina: `railway 5.23.0`.** Flags confirmados con `--help`:
> - `railway add` soporta `--service`, `--repo`, `--branch`, `--image`, `--variables` (repetible), `--database`.
> - `railway variable`/`railway variables` (alias): subcomando `set` (`railway variable set KEY=VALUE`), `list`, `delete`. El flag `--set "K=V"` en `railway variables --service X --set ...` es **legacy pero funcional**. Setear una variable **dispara un deploy por defecto**; usar `--skip-deploys` cuando se setean varias seguidas y disparar UN deploy al final.
> - `railway variables --service X` (bare) lista; `--kv` imprime `KEY=value` crudo (mejor para grep); `--json` para parseo estructurado.
> - `railway redeploy --service X -y` (con `--from-source` para traer el último commit/imagen del source).
> - `railway run --service X -- <cmd>` corre el comando **EN LA MÁQUINA LOCAL** con las env-vars del servicio inyectadas (NO dentro del contenedor Railway). Requiere el separador `--`. → un comando que dependa de `*.railway.internal` **fallará** localmente.
> - `railway logs --service X` **hace streaming por defecto** (bloquea la terminal). Para logs históricos sin bloquear: `railway logs --service X --lines 100`.
> - `railway domain [--service X]` genera/gestiona dominios; subcomando `delete`/`rm` para quitar.
> - `railway status [--json]`.
>
> **Shell:** PowerShell para `railway`/`pnpm`/`node`/`psql`/`Invoke-RestMethod`. **Bash SOLO para git.** El Project Token va en `$env:RAILWAY_TOKEN`.
>
> **Valores de runtime (NO placeholders — se leen del dashboard/logs en el momento; cada Task marca dónde leerlos):** `STORE_ID`, `MODEL_ID`, `DATABASE_PUBLIC_URL`, dominios `<api-domain>` / `<web-domain>`, `<openfga-public-domain>` (temporal). El id/nombre exactos del proyecto Railway se CONFIRMAN en la Task 1 (no se asumen).

---

### Task 1: Preparar CLI, token y confirmar el proyecto/servicios en Railway

**Files:** ninguno (infra; PowerShell).

- [ ] **Step 1: Verificar la Railway CLI (ya instalada 5.23.0).**
  ```powershell
  railway --version
  ```
  Salida esperada: `railway 5.23.0` (o superior). Si falla con "command not found", instalar:
  ```powershell
  npm install -g @railway/cli
  railway --version
  ```

- [ ] **Step 2: Cargar el Project Token en la sesión.** (Railway → Project → Settings → Tokens → crear un **Project Token** y pegarlo.)
  ```powershell
  $env:RAILWAY_TOKEN = "<PROJECT_TOKEN del proyecto Railway>"
  ```
  Verificar a qué proyecto apunta:
  ```powershell
  railway status --json
  ```
  Salida esperada: JSON con el nombre del proyecto (se espera `valiant-rebirth`) y su id. **Confirmar/anotar el nombre real del proyecto**; si difiere de lo esperado, usar el real en todas las Tasks. Si dice "Unauthorized", el token es de equipo o inválido: se necesita **Project Token**.
  > Nota: el esquema exacto del JSON de `railway status` no está garantizado entre versiones. Si `railway status --json` no expone claramente `name`/`services`, usar `railway status` (salida humana) para leer proyecto/entorno/servicios. NO parsear campos que no aparezcan.

- [ ] **Step 3: Enumerar servicios existentes.**
  ```powershell
  railway status
  ```
  Salida esperada: lista legible del proyecto, entorno (`production`) y servicios. Anotar qué servicios ya existen (p. ej. la Postgres provisionada previamente) para no duplicarlos. Si la Postgres de la app NO se llama `postgres-gmt`, conservar su nombre real y usarlo en las referencias `${{<nombre>.DATABASE_URL}}` de las Tasks siguientes.

- [ ] **Step 4 (verificación): confirmar que la Postgres de la app está Online.**
  ```powershell
  railway status
  ```
  Salida esperada: la Postgres aparece `Online`. Si NO existe (borrada por consumo de crédito), crearla:
  ```powershell
  railway add --database postgres --service postgres-gmt
  ```
  Salida esperada: servicio `postgres-gmt` creado. Verificar `Online` con `railway status`.

---

### Task 2: Provisionar `openfga-db`, `openfga`, `api` y `web` con auto-deploy desde `main`

**Files:**
- Verify (no modificar): `C:\Users\juana\GMT\proyectos\gmt-link\deploy\openfga\Dockerfile`
- Verify (no modificar): `C:\Users\juana\GMT\proyectos\gmt-link\nodes\backend-central\Dockerfile`
- Verify (no modificar): `C:\Users\juana\GMT\proyectos\gmt-link\nodes\web\Dockerfile`

- [ ] **Step 1: Postgres dedicada para OpenFGA** (aísla sus tablas de la app).
  ```powershell
  railway add --database postgres --service openfga-db
  ```
  Salida esperada: servicio `openfga-db` creado. Verificar `Online` con `railway status`.

- [ ] **Step 2: Servicio `openfga` desde el Dockerfile del repo** (Alpine con shell; su ENTRYPOINT ya hace `openfga migrate && openfga run`).
  ```powershell
  railway add --service openfga --repo japalmo/GMT-Link --branch main `
    --variables "RAILWAY_DOCKERFILE_PATH=deploy/openfga/Dockerfile" `
    --variables "OPENFGA_DATASTORE_ENGINE=postgres" `
    --variables 'OPENFGA_DATASTORE_URI=${{openfga-db.DATABASE_URL}}?sslmode=disable' `
    --variables "OPENFGA_HTTP_ADDR=0.0.0.0:8080"
  ```
  Salida esperada: servicio `openfga` creado.
  > No hace falta start command: el ENTRYPOINT del Dockerfile ya migra y arranca. El `?sslmode=disable` es porque la Postgres interna de Railway no expone TLS por `railway.internal`. Si la referencia `${{openfga-db.DATABASE_URL}}` ya trae query params, verificar en el dashboard que la URI final quede válida (un solo `?`).

- [ ] **Step 3: Servicio `api` conectado al repo, Dockerfile fijado.**
  ```powershell
  railway add --service api --repo japalmo/GMT-Link --branch main `
    --variables "RAILWAY_DOCKERFILE_PATH=nodes/backend-central/Dockerfile" `
    --variables 'DATABASE_URL=${{postgres-gmt.DATABASE_URL}}' `
    --variables "NODE_ENV=production"
  ```
  Salida esperada: servicio `api` creado.
  > Si la Postgres de la app NO se llama `postgres-gmt` (Task 1 Step 3), reemplazar `postgres-gmt` por su nombre real. El resto de variables del `api` (`FGA_*`, `CORS_ORIGINS`, `AUTH_JWT_SECRET`, NVIDIA) se cargan en Tasks 3–4.

- [ ] **Step 4: Servicio `web` conectado al repo, Dockerfile fijado.** (Sin `VITE_API_URL` aún — se setea y re-despliega en Task 4 cuando exista el dominio del `api`.)
  ```powershell
  railway add --service web --repo japalmo/GMT-Link --branch main `
    --variables "RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile"
  ```
  Salida esperada: servicio `web` creado.

- [ ] **Step 5: Generar dominios públicos SOLO para `api` y `web`** (el resto queda por `railway.internal`).
  ```powershell
  railway domain --service api
  railway domain --service web
  ```
  Salida esperada: dos URLs `https://<algo>.up.railway.app`. **Anotar ambas** como `<api-domain>` y `<web-domain>` (se usan en Tasks 4, 6, 8). Si un servicio no expone puerto todavía, Railway puede pedir el puerto: `api` = puerto de `PORT` (lo inyecta Railway), `web` = `serve` en `${PORT:-3000}`.

- [ ] **Step 6 (verificación): confirmar los 5 servicios y sus dockerfiles.**
  ```powershell
  railway status
  railway variables --service openfga --kv | Select-String "RAILWAY_DOCKERFILE_PATH"
  railway variables --service api --kv | Select-String "RAILWAY_DOCKERFILE_PATH"
  railway variables --service web --kv | Select-String "RAILWAY_DOCKERFILE_PATH"
  ```
  Salida esperada: `postgres-gmt`, `openfga-db`, `openfga`, `api`, `web` presentes; cada `RAILWAY_DOCKERFILE_PATH` con su valor (`deploy/openfga/Dockerfile`, `nodes/backend-central/Dockerfile`, `nodes/web/Dockerfile`).

---

### Task 3: Levantar OpenFGA en Railway y bootstrapear el store/modelo

**Files:** ninguno (infra + ejecución de `scripts/fga-bootstrap.ts` contra Railway).

- [ ] **Step 1: Desplegar `openfga` (y su Postgres) desde el source.**
  ```powershell
  railway redeploy --service openfga --from-source -y
  ```
  Salida esperada: build del `deploy/openfga/Dockerfile` y deploy iniciado.

- [ ] **Step 2: Verificar migrate + run en logs (histórico, sin bloquear).**
  ```powershell
  railway logs --service openfga --lines 100
  ```
  Salida esperada: líneas de migración sin error y `starting openfga service` / servidor escuchando en `0.0.0.0:8080`. Si hay error de conexión al datastore, revisar que `OPENFGA_DATASTORE_URI` referencie `openfga-db` y que `openfga-db` esté `Online`.

- [ ] **Step 3: Fijar la URL interna de OpenFGA en el `api`.**
  ```powershell
  railway variables --service api --skip-deploys --set "FGA_API_URL=http://openfga.railway.internal:8080"
  ```
  Salida esperada: variable seteada (host interno = `<nombre-de-servicio>.railway.internal`; aquí `openfga`). `--skip-deploys` evita un redeploy prematuro (aún faltan variables).

- [ ] **Step 4: Bootstrapear el store/modelo contra la OpenFGA de Railway.**
  `fga:bootstrap` necesita alcanzar OpenFGA por HTTP y necesita que exista `../../.env` (raíz del monorepo) porque `updateEnv()` hace `readFileSync`. `railway run` corre el proceso **en tu máquina local** (NO en el contenedor), así que `http://openfga.railway.internal:8080` **NO es resoluble** desde local. Por eso el camino fiable es un **dominio público temporal** de OpenFGA:
  ```powershell
  # 4a. Asegurar que existe el .env de la raíz (fga:bootstrap lo lee/escribe).
  if (-not (Test-Path "C:\Users\juana\GMT\proyectos\gmt-link\.env")) {
    New-Item -ItemType File "C:\Users\juana\GMT\proyectos\gmt-link\.env"
  }

  # 4b. Dominio público temporal para OpenFGA.
  railway domain --service openfga
  # -> anotar la URL, p.ej. https://openfga-production-zzzz.up.railway.app

  # 4c. Correr el bootstrap local apuntando a esa URL pública.
  $env:FGA_API_URL = "https://<openfga-public-domain>"
  pnpm --filter "@gmt-platform/backend-central" run fga:bootstrap
  Remove-Item Env:\FGA_API_URL

  # 4d. Quitar el dominio público de OpenFGA (dejarlo sólo-interno).
  railway domain delete --service openfga
  ```
  Salida esperada de 4c (leer LITERALMENTE estos dos IDs del stdout):
  ```
  Store "gmt-link": <STORE_ID> (creado)      # o "(existente)" si ya estaba
  Authorization model: <MODEL_ID>
  IDs escritos en C:\Users\juana\GMT\proyectos\gmt-link\.env
  ```
  > El `.env` local que el script escribe es intrascendente para prod; sólo importan los dos IDs impresos por stdout. En 4d, si `railway domain delete --service openfga` pide el nombre del dominio, obtenerlo con `railway domain list --service openfga` y pasarlo, o quitarlo por dashboard (openfga → Settings → Networking → remove domain).
  > Alternativa (sólo si NO se quiere exponer OpenFGA ni temporalmente): setear `FGA_API_URL` interno y correr el bootstrap como un job dentro de Railway (p. ej. un one-off `railway run` NO sirve porque es local; habría que un servicio/comando efímero en la red interna). El camino de dominio temporal es el recomendado por simplicidad.

- [ ] **Step 5: Setear `FGA_STORE_ID` y `FGA_MODEL_ID` en el `api`** con los valores del stdout:
  ```powershell
  railway variables --service api --skip-deploys `
    --set "FGA_STORE_ID=<STORE_ID>" `
    --set "FGA_MODEL_ID=<MODEL_ID>"
  ```
  Salida esperada: ambas variables seteadas.

- [ ] **Step 6 (verificación): confirmar las tres FGA_* en el `api`.**
  ```powershell
  railway variables --service api --kv | Select-String "FGA_"
  ```
  Salida esperada: `FGA_API_URL`, `FGA_STORE_ID`, `FGA_MODEL_ID` con valores no vacíos.

---

### Task 4: Cablear variables del `api` (auth/CORS/NVIDIA) y del `web` (`VITE_API_URL`)

**Files:** ninguno (Railway variables).

- [ ] **Step 1: Generar un `AUTH_JWT_SECRET` fuerte y setearlo en el `api`.**
  ```powershell
  $secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  railway variables --service api --skip-deploys --set "AUTH_JWT_SECRET=$secret"
  ```
  Salida esperada: variable seteada (64 hex chars = 256 bits). `jwt.ts` la exige al firmar/verificar (login/me); sin ella esos endpoints devuelven 500.

- [ ] **Step 2: `CORS_ORIGINS` del `api` = dominio público del `web`** (Task 2 Step 5, sin barra final):
  ```powershell
  railway variables --service api --skip-deploys --set "CORS_ORIGINS=https://<web-domain>"
  ```
  Salida esperada: variable seteada. (`src/main.ts` la parte por comas y filtra vacíos; un solo origen basta.)

- [ ] **Step 3: Claves NVIDIA NIM en el `api`** (leídas vía `configService.get` con fallback `??`; NO se requieren para arrancar, sí para features IA).
  ```powershell
  railway variables --service api --skip-deploys `
    --set "NVIDIA_API_KEY=<clave NVIDIA nvapi-...>" `
    --set "NVIDIA_API_KEY_VISION=<clave NVIDIA visión nvapi-...>"
  ```
  Salida esperada: ambas seteadas. Si no se tienen a mano, se pueden omitir sin romper el arranque (verificar en Task 6 que el server levanta igual).

- [ ] **Step 4: `VITE_API_URL` del `web` = dominio público del `api`** (se hornea en build; dispara re-build del `web`). NO se setea ninguna variable Firebase (los ARGs Firebase del Dockerfile quedan en cadena vacía).
  ```powershell
  railway variables --service web --set "VITE_API_URL=https://<api-domain>"
  ```
  Salida esperada: variable seteada. (Aquí SÍ dejamos que dispare deploy del `web`; horneará `VITE_API_URL`.)

- [ ] **Step 5 (verificación): listar variables clave.**
  ```powershell
  railway variables --service api --kv | Select-String "AUTH_JWT_SECRET|CORS_ORIGINS|DATABASE_URL|FGA_|NODE_ENV"
  railway variables --service web --kv | Select-String "VITE_API_URL"
  ```
  Salida esperada: en `api` → `AUTH_JWT_SECRET`, `CORS_ORIGINS=https://<web-domain>`, `DATABASE_URL=...`, las tres `FGA_*`, `NODE_ENV=production`. En `web` → `VITE_API_URL=https://<api-domain>`.

---

### Task 5: Sacar `prisma migrate deploy` del arranque a un pre-deploy command

**Files:**
- Modify: `C:\Users\juana\GMT\proyectos\gmt-link\nodes\backend-central\Dockerfile`

**Contexto verificado:** hoy el `CMD` (líneas 30-31) es:
```
# Release + arranque: aplica migraciones y levanta. PORT lo inyecta Railway.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
```
→ con >1 réplica ambas corren `migrate deploy` en paralelo (carrera/lock). Se mueve la migración al **pre-deploy command** de Railway (corre UNA vez por deploy, antes de las réplicas) y el `CMD` queda sólo arrancando el server. El WORKDIR del contenedor ya es `/app/nodes/backend-central` (Dockerfile línea 28), así que `pnpm exec prisma migrate deploy` corre en el proyecto correcto.

- [ ] **Step 1: Editar el `CMD` del Dockerfile del backend.** Reemplazar EXACTAMENTE las líneas 30-31:
  ```
  # Release + arranque: aplica migraciones y levanta. PORT lo inyecta Railway.
  CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
  ```
  por:
  ```
  # Arranque: SOLO levanta el server. Las migraciones corren en el pre-deploy
  # command de Railway (una vez por deploy, antes de las réplicas) para evitar la
  # carrera de `migrate deploy` con >1 réplica. PORT lo inyecta Railway.
  CMD ["node", "dist/main.js"]
  ```

- [ ] **Step 2: Fijar el Pre-deploy Command del servicio `api`.** El pre-deploy corre en el contenedor construido (WORKDIR `/app/nodes/backend-central`, `DATABASE_URL` inyectada):
  ```powershell
  railway variables --service api --skip-deploys --set "RAILWAY_PREDEPLOY_COMMAND=pnpm exec prisma migrate deploy"
  ```
  Salida esperada: variable seteada.
  > **Paso de verificación explícito (no dar por hecho):** confirmar en el dashboard que el Pre-deploy Command quedó registrado (Railway → `api` → Settings → Deploy → *Pre-deploy Command* = `pnpm exec prisma migrate deploy`). Si esta versión de la CLI ignora `RAILWAY_PREDEPLOY_COMMAND` como variable, setearlo a mano en ese campo del dashboard y anotar que se hizo por dashboard.

- [ ] **Step 3: Fijar el healthcheck path del `api`.**
  ```powershell
  railway variables --service api --skip-deploys --set "RAILWAY_HEALTHCHECK_PATH=/health"
  ```
  Salida esperada: variable seteada.
  > **Verificación explícita:** confirmar en dashboard (Railway → `api` → Settings → Deploy → Healthcheck Path = `/health`). Si la variable no aplica, setear en el dashboard. `GET /health` está verificado y devuelve `{status:'ok', service:'gmt-link-api', ...}`.

- [ ] **Step 4: Commit del cambio de Dockerfile** (Bash; conventional-commit en español).
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link
  git add nodes/backend-central/Dockerfile
  git commit -m "chore(deploy): mover prisma migrate deploy al pre-deploy de Railway

El CMD corria 'migrate deploy && node main.js', lo que provoca una carrera de
migracion con mas de una replica. Se deja el CMD solo arrancando el server y las
migraciones pasan al pre-deploy command de Railway (una vez por deploy).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  Salida esperada: un commit creado en `feat/modulos-1-4`.

---

### Task 6: Desplegar `api` + `web` desde `main` y verificar arranque

**Files:** ninguno (git push + deploy).

- [ ] **Step 1: Publicar la rama de trabajo en `main`** (dispara auto-deploy de `api` y `web`). Bash para git:
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link
  git push origin feat/modulos-1-4:main
  ```
  Salida esperada: push aceptado; `main` actualizado con el commit de la Task 5.
  > Si `main` está protegido o divergió, alternativa sin push: `railway redeploy --service api --from-source -y` y `railway redeploy --service web --from-source -y` (usa el `main` remoto actual). Preferir el push para que el Dockerfile nuevo (CMD sin migrate) entre al build.

- [ ] **Step 2: Verificar el deploy del `api`** (pre-deploy corre `migrate deploy`, luego arranca).
  ```powershell
  railway logs --service api --lines 150
  ```
  Salida esperada: en el pre-deploy, Prisma aplicando migraciones (o `No pending migrations to apply`); luego Nest arrancando y escuchando en `0.0.0.0:$PORT`. NO debe verse un crash por Postgres/OpenFGA. `AUTH_JWT_SECRET` no aborta el arranque (validación perezosa), pero debe estar seteado (Task 4) para que login/me funcionen.

- [ ] **Step 3: Verificar el deploy del `web`.**
  ```powershell
  railway logs --service web --lines 150
  ```
  Salida esperada: build de Vite ok (con `VITE_API_URL` horneada) y `serve -s dist -l ${PORT}` sirviendo el estático.

- [ ] **Step 4 (verificación de salud del `api`):**
  ```powershell
  Invoke-RestMethod -Uri "https://<api-domain>/health"
  ```
  Salida esperada: objeto con `status = ok`, `service = gmt-link-api`, `timestamp` ISO.

---

### Task 7: Migrar los datos del PostgreSQL local a `postgres-gmt` (con poda de demo)

**Files:** ninguno (pg_dump/psql; PowerShell). Artefactos temporales en el scratchpad.

**Contexto (CLAUDE.md):** la Postgres local vive en WSL Ubuntu, base `gmt_link`, usuario `postgres`. Si el 5432 no responde, despertar WSL: `Start-Process wsl -ArgumentList "-d","Ubuntu","--exec","sleep","infinity" -WindowStyle Hidden`. Destino: `postgres-gmt` de Railway, alcanzable desde local SÓLO por su `DATABASE_PUBLIC_URL` (la interna no es resoluble fuera de Railway). El pre-deploy de la Task 6 ya creó el **esquema** en `postgres-gmt`; aquí migramos **datos**.
> **Verificación explícita previa:** confirmar que `psql` está disponible en Windows (`psql --version`). Si NO lo está, correr TODOS los `psql`/`pg_dump` de esta Task **dentro de WSL** (`wsl -d Ubuntu --exec bash -c "..."`), pasando `$PUB`/`$DUMP` como variables de entorno al subshell.

- [ ] **Step 1: Obtener la `DATABASE_PUBLIC_URL` de `postgres-gmt`.**
  ```powershell
  railway variables --service postgres-gmt --kv | Select-String "DATABASE_PUBLIC_URL"
  ```
  Salida esperada: `DATABASE_PUBLIC_URL=postgresql://postgres:<pwd>@<host>.proxy.rlwy.net:<port>/railway`. Guardar:
  ```powershell
  $PUB = "<DATABASE_PUBLIC_URL leída>"
  ```
  > Si `postgres-gmt` no expone `DATABASE_PUBLIC_URL`, generar el dominio TCP/proxy en el dashboard (postgres-gmt → Settings → Networking → Public Networking) y releer.

- [ ] **Step 2: Confirmar que el esquema ya existe en destino.**
  ```powershell
  psql $PUB -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
  ```
  Salida esperada: un número > 40 (tablas de Prisma). Si es 0, el pre-deploy no corrió: revisar Task 6 Step 2 antes de continuar.

- [ ] **Step 3: Volcar SÓLO los datos del local** (`--data-only`, en orden de FKs con `--disable-triggers`). Ejecutar el `pg_dump` de WSL contra la base `gmt_link`:
  ```powershell
  $DUMP = "$env:TEMP\claude\C--Users-juana-GMT-proyectos\58405bea-22a0-4724-8cc9-c0c51a7a9e47\scratchpad\gmt_link_data.sql"
  wsl -d Ubuntu --exec bash -c "PGPASSWORD=<pwd-local> pg_dump --data-only --disable-triggers --no-owner --no-privileges -h localhost -U postgres -d gmt_link" | Out-File -Encoding utf8 $DUMP
  ```
  Salida esperada: archivo `gmt_link_data.sql` creado, > 0 bytes (`(Get-Item $DUMP).Length` > 0). Si `pg_dump` no pide password, se puede omitir `PGPASSWORD=...`.
  > Verificación explícita: confirmar el nombre de la base local (`gmt_link`) y el usuario (`postgres`) con `wsl -d Ubuntu --exec psql -h localhost -U postgres -l`. Ajustar si el nombre real difiere.

- [ ] **Step 4: Restaurar los datos en `postgres-gmt`.**
  ```powershell
  psql $PUB -v ON_ERROR_STOP=1 -f $DUMP
  ```
  Salida esperada: sentencias `COPY`/`INSERT` sin error hasta el final. Si aparece violación de FK, re-verificar que el dump usó `--disable-triggers`.

- [ ] **Step 5: Poda de filas demo** (conservar catálogo de roles/permisos y el admin). Verificar ANTES con un SELECT, luego borrar:
  ```powershell
  psql $PUB -c "SELECT email FROM \"User\" WHERE email LIKE '%@example.com' OR email LIKE '%demo%' OR email LIKE '%test%';"
  psql $PUB -v ON_ERROR_STOP=1 -c "DELETE FROM \"User\" WHERE (email LIKE '%@example.com' OR email LIKE '%demo%' OR email LIKE '%test%') AND email <> 'admin@gmt.cl';"
  ```
  Salida esperada: primero la lista de emails demo; luego `DELETE <n>`. NUNCA borrar `admin@gmt.cl` (el `AND email <> 'admin@gmt.cl'` lo protege explícitamente). Para otros datos demo sin usuario asociado (proyectos/servicios/documentos sembrados), verificar con `SELECT` su marcador propio y borrar en pasos análogos sólo tras confirmar.

- [ ] **Step 6: Re-asegurar catálogo + admin en el destino** (idempotente; garantiza catálogo completo para FKs y admin con Membership). Correr los seeds locales apuntando al destino. Para que `seed:admin` escriba la tupla FGA contra Railway, exportar también `FGA_*` con el dominio público temporal de OpenFGA (como en Task 3 Step 4):
  ```powershell
  # Dominio público temporal de OpenFGA para que seed:admin escriba la tupla FGA.
  railway domain --service openfga   # -> anotar https://<openfga-public-domain>

  $env:DATABASE_URL   = $PUB
  $env:FGA_API_URL    = "https://<openfga-public-domain>"
  $env:FGA_STORE_ID   = "<STORE_ID de Task 3>"
  $env:FGA_MODEL_ID   = "<MODEL_ID de Task 3>"

  pnpm --filter "@gmt-platform/backend-central" run db:seed
  pnpm --filter "@gmt-platform/backend-central" run seed:admin

  Remove-Item Env:\DATABASE_URL, Env:\FGA_API_URL, Env:\FGA_STORE_ID, Env:\FGA_MODEL_ID
  railway domain delete --service openfga   # volver a sólo-interno
  ```
  Salida esperada: `db:seed` imprime `Permisos asegurados: N`, `Roles asegurados: ...`, `Bundles rol→permiso: N` sin error; `seed:admin` imprime `Postgres: User asegurado admin@gmt.cl ...`, `Postgres: Membership org_admin ORGANIZATION:gmt asegurada` y `OpenFGA: tupla escrita user:<id> admin organization:gmt` (o `... ya existía ...`).
  > Si NO se exporta `FGA_STORE_ID`, `seed:admin` imprime `OpenFGA omitido: FGA_STORE_ID vacío.` y NO escribe la tupla (el login sigue funcionando, pero `/me` no verá el gate de roles). Por eso se exportan los `FGA_*`.
  > Nota: los seeds leen `../../.env` vía dotenv, pero las variables de entorno del proceso (exportadas arriba) tienen prioridad sobre lo que dotenv cargue si la clave no está en el `.env`; para evitar ambigüedad, asegurarse de que el `.env` local NO tenga un `DATABASE_URL` apuntando a otra base (o vaciarlo temporalmente).

- [ ] **Step 7 (verificación de conteos): comparar filas clave local vs Railway.**
  ```powershell
  wsl -d Ubuntu --exec bash -c "PGPASSWORD=<pwd-local> psql -h localhost -U postgres -d gmt_link -t -c 'SELECT count(*) FROM \"User\";'"
  psql $PUB -t -c "SELECT count(*) FROM \"User\";"
  psql $PUB -t -c "SELECT count(*) FROM \"User\" WHERE email='admin@gmt.cl';"
  ```
  Salida esperada: `users_railway` = `users_local` menos las filas demo podadas; el conteo del admin = `1`.

---

### Task 8: Smoke-test end-to-end en producción (API + web login)

**Files:** ninguno (verificación; PowerShell + navegador).

- [ ] **Step 1: `POST /auth/login` como admin → obtener token.**
  ```powershell
  $BE = "<api-domain>"
  $r = Invoke-RestMethod -Method Post -Uri ("https://" + $BE + "/auth/login") `
    -ContentType application/json `
    -Body (@{ email = 'admin@gmt.cl'; password = '<ADMIN_PASSWORD>' } | ConvertTo-Json)
  $r.token
  ```
  Salida esperada: un JWT (`eyJ...`) — el endpoint devuelve `{ token }`. Si devuelve 401, revisar que `seed:admin` corrió contra `postgres-gmt` (Task 7 Step 6). Si devuelve 500, falta `AUTH_JWT_SECRET` en el `api` (Task 4 Step 1).

- [ ] **Step 2: `GET /auth/me` con Bearer.**
  ```powershell
  Invoke-RestMethod -Uri ("https://" + $BE + "/auth/me") `
    -Headers @{ Authorization = "Bearer " + $r.token }
  ```
  Salida esperada: el admin con `email = admin@gmt.cl`, `status = ACTIVE`, sus `modules` y el flag de gestión de roles. Si 401, el `SessionMiddleware` no validó el JWT → verificar que el `AUTH_JWT_SECRET` que firmó (login) es el mismo que valida (misma variable del servicio `api`). Si 500 o tarda/errores de FGA, verificar `FGA_API_URL`/`FGA_STORE_ID`/`FGA_MODEL_ID` (Task 3) y que `openfga` esté `Online`.

- [ ] **Step 3: Verificar CORS desde el origen del `web`** (preflight con `Origin`).
  ```powershell
  $resp = Invoke-WebRequest -Method Options -Uri ("https://" + $BE + "/auth/login") `
    -Headers @{ Origin = "https://<web-domain>"; "Access-Control-Request-Method" = "POST" }
  $resp.Headers["Access-Control-Allow-Origin"]
  ```
  Salida esperada: `https://<web-domain>`. Si viene vacío, corregir `CORS_ORIGINS` en el `api` (Task 4 Step 2, sin barra final) y re-desplegar.

- [ ] **Step 4: Login web en vivo.**
  ```powershell
  Start-Process "https://<web-domain>"
  ```
  Salida esperada (manual): la SPA carga, se entra con `admin@gmt.cl` / `<ADMIN_PASSWORD>`, el dashboard renderiza sin errores de red en consola (las llamadas van a `https://<api-domain>`), y una acción de admin (p. ej. crear un usuario y ver la clave provisoria en la UI, §9) funciona end-to-end.

- [ ] **Step 5 (entrega): registrar URLs y credenciales de la demo.**
  - Web: `https://<web-domain>`
  - API: `https://<api-domain>`
  - Admin: `admin@gmt.cl` / `<ADMIN_PASSWORD>`

- [ ] **Step 6: Commit de cierre de la fase** (docs). Actualizar `docs/railway-deploy.md` marcando la Fase 2 completada con los dominios reales, y commitear (Bash):
  ```bash
  cd /c/Users/juana/GMT/proyectos/gmt-link
  git add docs/railway-deploy.md
  git commit -m "docs(deploy): registrar Fase 2 completada — 4 servicios online en Railway

Anota dominios publicos de api y web, y confirma login del admin en produccion.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  git push origin feat/modulos-1-4:main
  ```
  Salida esperada: commit creado y `main` actualizado (deploy de docs es no-op para el runtime).

---

**Rutas absolutas de los archivos tocados en esta fase:**
- `C:\Users\juana\GMT\proyectos\gmt-link\nodes\backend-central\Dockerfile` (Task 5 — quitar `migrate deploy` del `CMD`)
- `C:\Users\juana\GMT\proyectos\gmt-link\docs\railway-deploy.md` (Task 8 — cierre)
- Consumidos sin modificar: `deploy\openfga\Dockerfile`, `nodes\web\Dockerfile`, `nodes\backend-central\scripts\fga-bootstrap.ts`, `nodes\backend-central\fga\model.fga`, `nodes\backend-central\prisma\seed.ts`, `nodes\backend-central\prisma\seed-admin.ts`, `nodes\backend-central\src\main.ts`, `nodes\backend-central\src\health.controller.ts`, `nodes\backend-central\src\common\jwt.ts`.


---


## Fase 3 — V-Metric a la auth propia (PLAN CORREGIDO Y VERIFICADO)

**Verdad de terreno confirmada contra el repo (Read/Grep):**

- `v-metric/` es repo git independiente (`git rev-parse --show-toplevel` → `C:/Users/juana/GMT/proyectos/v-metric`). Código en `poza/*.py`, entrypoint `app.py` (que solo llama a `poza.gui_qt.main`), empaquetado `V-Metric.spec`.
- **`main()` vive en `poza/gui_qt.py` (líneas 375-388), NO en `app.py`.** `app.py` (13 líneas) solo hace `init_db()` + `main()`; NO se modifica en esta fase.
- **No hay suite de tests propia**; se crea en `v-metric/tests/`. `pytest` NO está instalado en `.venv` (verificado: `ModuleNotFoundError`), así que Task 1 lo instala. `requests` y `keyring` SÍ están instalados.
- Backend NestJS (`gmt-link/nodes/backend-central/src/auth/auth.controller.ts`): `POST /auth/login` `{email,password}` → `{token}`; `GET /auth/me` con `Authorization: Bearer <jwt>` → `{id,email,firstName,lastName,status,modules,canManageRoles}`. `SessionMiddleware` valida el JWT propio (`verifyToken`) y puebla `req.authUser`. No hay refresh token.
- Endpoints de datos (`metrics.controller.ts`, verificados como `@Post`): `saveCubicacion`, `getLatestDem`, `listDems`, `createDemUploadUrl`, `getDemDownloadUrl`, `registerDemMetadata`, `saveReservorioMetadata`, `getAssetUploadUrl`, `getAssetDownloadUrl`, `logActivity`, `otp/generate`, `otp/verify`. Todos bajo `/metrics/{name}`.
- **`poza/firebase_sync.py` (líneas 39 y 44) exige `getattr(session, "id_token", ...)` truthy** en `available` y `_get_session()`. Por eso la nueva `GmtSession` DEBE exponer `id_token` (alias de `token`) o TODAS las llamadas a datos fallarían con `RuntimeError("Firebase requiere una sesión autenticada.")`. — **CORRECCIÓN CLAVE respecto del borrador.**
- `poza/firebase_http.py`: `call_function` lee `getattr(session, "id_token", "")` (línea 64), tiene retry `refresh_session_token` (líneas 26-51, 73-76) contra `securetoken.googleapis.com`, e importa `FIREBASE_WEB_API_KEY`. `refresh_session_token`/`retry_refresh`/`FIREBASE_WEB_API_KEY` NO se usan fuera de los archivos Firebase (verificado por grep).
- `poza/firebase_config.py`: la URL de datos sale de `_GMT_LINK_API_DEFAULT = os.getenv("VMETRIC_GMT_LINK_API_URL", "http://localhost:3001/metrics")` (línea 22); reexportada como `FIREBASE_FUNCTIONS_BASE_URL` (26-28) y `FIREBASE_FUNCTIONS_PUBLIC_BASE_URL` (23-25, usada por `firebase_sync`). No se tocan esas dos.
- `poza/gui_qt.py`: import de auth en **líneas 51-59** (`_FB_AUTH_AVAILABLE`); `_load_saved_credentials` es **línea 186** (`def ...: pass`); `_try_login` **líneas 187-223**; logout **líneas 352-353** (`triggered.connect(self.close)`); `main()` **375-388**. La flag de firebase_sync es `_FB_AVAILABLE` (línea 47), SEPARADA de la de auth. `themes.fetch_remote_theme_tokens` existe (línea 441). El `user_info` usa la clave `"username"` (línea 229) → el logout debe leer `"username"`.
- `V-Metric.spec`: `datas` = `[('img','img'), ('poza/icons','poza/icons')]`; NO referencia `firebase-key.json`; `keyring` ya está en `hiddenimports` (línea 22); `pytest` ya está en `excludes` (línea 34). No hay nada Firebase que quitar del `.spec`.
- **`firebase-key.json` NO está trackeado por git** (verificado con `git ls-files`), pero existe en disco. `firebase.json`, `firestore.rules`, `storage.rules`, `functions/` SÍ están trackeados. — **CORRECCIÓN: el `git rm firebase-key.json` del borrador abortaría el comando; se separa.**
- `poza/db/repository.py` menciona `firebase_auth` **solo en un comentario** (líneas 117), no lo importa. Aun así, la verificación de "quién importa firebase_auth" del borrador (`Select-String -Path poza\*.py`) es no-recursiva y NO escanearía `poza/db/` ni `poza/views/` → se corrige a recursiva.
- `keyring.errors` expone `NoKeyringError`, `PasswordDeleteError`, `PasswordSetError`, `KeyringError`, `InitError` (verificado). Los tests del borrador usan clases válidas.
- `poza/export.py` usa `google.oauth2.service_account` para Google Sheets (no Firebase) → NO se toca.

**Objetivo:** V-Metric deja Firebase Identity Toolkit; usa el JWT propio (`/auth/login` + `/auth/me`), lo persiste con `keyring`, y ante 401 hace re-login explícito (no refresh).

**Convención de shell:** `git` por **Bash**; `python`/`pytest`/`pip`/`railway` por **PowerShell** con el venv del repo. Rutas absolutas siempre.

**Activación del venv (PowerShell, al inicio de cada Task con comandos Python):**
```powershell
Set-Location C:\Users\juana\GMT\proyectos\v-metric
.\.venv\Scripts\Activate.ps1
```

---

### Task 1: Scaffolding de tests + verificar/instalar pytest

**Files:**
- Create: `C:/Users/juana/GMT/proyectos/v-metric/tests/__init__.py`
- Create: `C:/Users/juana/GMT/proyectos/v-metric/tests/conftest.py`
- Create: `C:/Users/juana/GMT/proyectos/v-metric/pytest.ini`
- Modify: `C:/Users/juana/GMT/proyectos/v-metric/requirements.txt`

- [ ] **Step 1: Instalar pytest en el venv (PowerShell).** Verificado: pytest NO está instalado, así que este paso instala.
```powershell
Set-Location C:\Users\juana\GMT\proyectos\v-metric
.\.venv\Scripts\Activate.ps1
python -c "import pytest, sys; print('pytest', pytest.__version__)" 2>$null; if ($LASTEXITCODE -ne 0) { pip install "pytest>=8.0" }
python -c "import pytest; print('pytest', pytest.__version__)"
```
Salida esperada: tras el `pip install`, `Successfully installed pytest-8.x.x ...`, y la última línea imprime `pytest 8.x.x`.

- [ ] **Step 2: Añadir pytest a requirements (dev).** En `C:/Users/juana/GMT/proyectos/v-metric/requirements.txt`, reemplazar exactamente:
```
# ── Empaquetado (solo dev) ───────────────────────────────
pyinstaller>=6.0
```
por:
```
# ── Empaquetado y pruebas (solo dev) ─────────────────────
pyinstaller>=6.0
pytest>=8.0
```

- [ ] **Step 3: Crear `C:/Users/juana/GMT/proyectos/v-metric/pytest.ini`:**
```ini
[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
addopts = -q
```

- [ ] **Step 4: Crear `C:/Users/juana/GMT/proyectos/v-metric/tests/__init__.py`** vacío (0 bytes).

- [ ] **Step 5: Crear `C:/Users/juana/GMT/proyectos/v-metric/tests/conftest.py`:**
```python
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Garantiza que el paquete `poza` sea importable al correr pytest desde la raíz.
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


@pytest.fixture()
def api_url(monkeypatch: pytest.MonkeyPatch) -> str:
    """Fija una URL de API determinista para los tests de auth."""
    url = "https://api.test.local"
    monkeypatch.setenv("VMETRIC_GMT_LINK_API_URL", url)
    monkeypatch.setenv("VMETRIC_FIREBASE_FUNCTIONS_BASE_URL", f"{url}/metrics")
    return url
```

- [ ] **Step 6: Correr pytest para ver colección vacía sin error (PowerShell).**
```powershell
python -m pytest
```
Salida esperada: `no tests ran` (exit code 5). Lo importante: sin errores de import de `conftest.py`.

- [ ] **Step 7: Commit (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git add tests/__init__.py tests/conftest.py pytest.ini requirements.txt && git commit -m "test: scaffolding de pytest para la migracion de auth de V-Metric

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `poza/gmt_auth.py` — cliente de auth propia (login / me)

**Files:**
- Create: `C:/Users/juana/GMT/proyectos/v-metric/tests/test_gmt_auth.py`
- Create: `C:/Users/juana/GMT/proyectos/v-metric/poza/gmt_auth.py`

- [ ] **Step 1: Escribir el test que falla.** Crear `C:/Users/juana/GMT/proyectos/v-metric/tests/test_gmt_auth.py`:
```python
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from poza import gmt_auth
from poza.gmt_auth import GmtAuthError, GmtSession


def _fake_response(status_code: int, json_body: dict | None = None):
    resp = MagicMock()
    resp.status_code = status_code
    resp.ok = 200 <= status_code < 300
    resp.json.return_value = json_body if json_body is not None else {}
    resp.content = b"x" if json_body is not None else b""
    return resp


def test_login_ok_devuelve_jwt(api_url: str):
    with patch("poza.gmt_auth.requests.post") as post:
        post.return_value = _fake_response(200, {"token": "jwt-abc"})
        token = gmt_auth.login("user@gmt.cl", "secreta", api_url=api_url)

    assert token == "jwt-abc"
    called_url = post.call_args.args[0]
    assert called_url == f"{api_url}/auth/login"
    assert post.call_args.kwargs["json"] == {"email": "user@gmt.cl", "password": "secreta"}


def test_login_credenciales_invalidas_lanza_401(api_url: str):
    with patch("poza.gmt_auth.requests.post") as post:
        post.return_value = _fake_response(401, {"message": "Correo o contraseña incorrectos."})
        with pytest.raises(GmtAuthError) as exc:
            gmt_auth.login("user@gmt.cl", "mala", api_url=api_url)

    assert exc.value.status_code == 401
    assert "correo" in str(exc.value).lower()


def test_me_ok_devuelve_sesion(api_url: str):
    body = {
        "id": "u1",
        "email": "user@gmt.cl",
        "firstName": "Ana",
        "lastName": "Perez",
        "status": "ACTIVE",
        "modules": ["v-metric"],
        "canManageRoles": True,
    }
    with patch("poza.gmt_auth.requests.get") as get:
        get.return_value = _fake_response(200, body)
        session = gmt_auth.me("jwt-abc", api_url=api_url)

    assert isinstance(session, GmtSession)
    assert session.uid == "u1"
    assert session.email == "user@gmt.cl"
    assert session.token == "jwt-abc"
    assert session.id_token == "jwt-abc"   # alias requerido por firebase_sync
    assert session.nombre_completo == "Ana Perez"
    assert session.rol == "admin"          # canManageRoles=True -> admin
    assert session.activo is True
    called_url = get.call_args.args[0]
    assert called_url == f"{api_url}/auth/me"
    assert get.call_args.kwargs["headers"]["Authorization"] == "Bearer jwt-abc"


def test_me_operador_cuando_no_maneja_roles(api_url: str):
    body = {
        "id": "u2", "email": "op@gmt.cl", "firstName": "Op", "lastName": "Erario",
        "status": "ACTIVE", "modules": ["v-metric"], "canManageRoles": False,
    }
    with patch("poza.gmt_auth.requests.get") as get:
        get.return_value = _fake_response(200, body)
        session = gmt_auth.me("jwt-abc", api_url=api_url)

    assert session.rol == "operador"


def test_me_401_lanza_error(api_url: str):
    with patch("poza.gmt_auth.requests.get") as get:
        get.return_value = _fake_response(401, {"message": "Se requiere un usuario autenticado."})
        with pytest.raises(GmtAuthError) as exc:
            gmt_auth.me("jwt-expirado", api_url=api_url)

    assert exc.value.status_code == 401


def test_login_sin_conexion_lanza_error_amigable(api_url: str):
    import requests as _requests
    with patch("poza.gmt_auth.requests.post", side_effect=_requests.exceptions.ConnectionError()):
        with pytest.raises(GmtAuthError) as exc:
            gmt_auth.login("user@gmt.cl", "secreta", api_url=api_url)
    assert exc.value.code == "NETWORK_ERROR"
```

- [ ] **Step 2: Correr el test y verlo fallar (PowerShell).**
```powershell
Set-Location C:\Users\juana\GMT\proyectos\v-metric
.\.venv\Scripts\Activate.ps1
python -m pytest tests/test_gmt_auth.py
```
Salida esperada: error de colección `ModuleNotFoundError: No module named 'poza.gmt_auth'`.

- [ ] **Step 3: Implementar `C:/Users/juana/GMT/proyectos/v-metric/poza/gmt_auth.py`** (nota: `GmtSession` expone `id_token` como property que devuelve `token`, requisito de `firebase_sync`):
```python
"""Cliente de autenticación propia de GMT Link para V-Metric.

Reemplaza a Firebase Identity Toolkit. El backend (NestJS) expone:
  POST {API}/auth/login  {email, password}  -> {token}   (JWT HS256 propio)
  GET  {API}/auth/me      Bearer <token>     -> perfil del usuario

La auth propia NO emite refresh tokens: ante un 401 se hace re-login explícito
(ver poza.firebase_http.call_function y la UI de login).
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any, Dict

import requests

logger = logging.getLogger(__name__)

# Timeout de red por defecto (segundos).
_TIMEOUT = 10


class GmtAuthError(Exception):
    """Error de autenticación contra el backend de GMT Link."""

    def __init__(self, message: str, code: str = "UNKNOWN", status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


@dataclass
class GmtSession:
    """Sesión activa basada en el JWT propio. Se persiste con keyring (Task 4).

    Expone `id_token` como alias de `token` porque `poza.firebase_sync` exige
    `getattr(session, "id_token", ...)` truthy para habilitar las llamadas a datos.
    """

    uid: str
    email: str
    token: str
    nombre_completo: str = ""
    rol: str = "operador"
    activo: bool = True
    extra: Dict[str, Any] = field(default_factory=dict)

    @property
    def id_token(self) -> str:
        """Alias de compatibilidad para firebase_sync/firebase_http."""
        return self.token


def _default_api_url() -> str:
    """URL base de la API (sin sufijo /metrics).

    `VMETRIC_GMT_LINK_API_URL` apunta al router /metrics; /auth vive en la raíz,
    así que se recorta el sufijo /metrics si está presente.
    """
    raw = os.getenv("VMETRIC_GMT_LINK_API_URL", "http://localhost:3001/metrics").rstrip("/")
    if raw.endswith("/metrics"):
        raw = raw[: -len("/metrics")]
    return raw


def _extract_message(resp: Any, fallback: str) -> str:
    try:
        data = resp.json()
    except Exception:
        return fallback
    if isinstance(data, dict):
        msg = data.get("message")
        if isinstance(msg, list):  # ValidationPipe de Nest puede devolver listas
            return "; ".join(str(m) for m in msg)
        if isinstance(msg, str):
            return msg
    return fallback


def login(email: str, password: str, *, api_url: str | None = None) -> str:
    """Autentica contra POST {API}/auth/login y devuelve el JWT propio."""
    base = (api_url or _default_api_url()).rstrip("/")
    url = f"{base}/auth/login"
    try:
        resp = requests.post(url, json={"email": email, "password": password}, timeout=_TIMEOUT)
    except requests.exceptions.ConnectionError:
        raise GmtAuthError(
            "Sin conexión con el servidor. Verifica tu red e intenta de nuevo.",
            code="NETWORK_ERROR",
        )
    except requests.exceptions.Timeout:
        raise GmtAuthError(
            "El servidor tardó demasiado en responder. Intenta de nuevo.",
            code="TIMEOUT",
        )

    if resp.status_code == 401:
        raise GmtAuthError(
            _extract_message(resp, "Correo o contraseña incorrectos."),
            code="INVALID_CREDENTIALS",
            status_code=401,
        )
    if not resp.ok:
        raise GmtAuthError(
            _extract_message(resp, f"Error de inicio de sesión (HTTP {resp.status_code})."),
            code="LOGIN_FAILED",
            status_code=resp.status_code,
        )

    token = resp.json().get("token", "")
    if not token:
        raise GmtAuthError("El servidor no devolvió un token de sesión.", code="NO_TOKEN")
    return str(token)


def me(token: str, *, api_url: str | None = None) -> GmtSession:
    """Valida el JWT contra GET {API}/auth/me y construye la GmtSession."""
    base = (api_url or _default_api_url()).rstrip("/")
    url = f"{base}/auth/me"
    try:
        resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=_TIMEOUT)
    except requests.exceptions.ConnectionError:
        raise GmtAuthError(
            "Sin conexión con el servidor. Verifica tu red e intenta de nuevo.",
            code="NETWORK_ERROR",
        )
    except requests.exceptions.Timeout:
        raise GmtAuthError(
            "El servidor tardó demasiado en responder. Intenta de nuevo.",
            code="TIMEOUT",
        )

    if resp.status_code == 401:
        raise GmtAuthError(
            _extract_message(resp, "La sesión expiró. Vuelve a iniciar sesión."),
            code="UNAUTHENTICATED",
            status_code=401,
        )
    if not resp.ok:
        raise GmtAuthError(
            _extract_message(resp, f"No se pudo validar la sesión (HTTP {resp.status_code})."),
            code="ME_FAILED",
            status_code=resp.status_code,
        )

    data = resp.json()
    nombre = f"{data.get('firstName', '')} {data.get('lastName', '')}".strip()
    rol = "admin" if data.get("canManageRoles") else "operador"
    session = GmtSession(
        uid=str(data.get("id", "")),
        email=str(data.get("email", "")),
        token=token,
        nombre_completo=nombre or str(data.get("email", "")).split("@")[0],
        rol=rol,
        activo=data.get("status") == "ACTIVE",
        extra={"modules": data.get("modules", [])},
    )
    if not session.activo:
        raise GmtAuthError("Esta cuenta no está activa.", code="USER_INACTIVE", status_code=403)
    return session


def is_available() -> bool:
    """La auth propia siempre está disponible (no depende de una API key local)."""
    return True
```

- [ ] **Step 4: Correr el test y verlo verde (PowerShell).**
```powershell
python -m pytest tests/test_gmt_auth.py
```
Salida esperada: `6 passed`.

- [ ] **Step 5: Commit (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git add poza/gmt_auth.py tests/test_gmt_auth.py && git commit -m "feat: cliente gmt_auth (login/me) contra la auth propia con JWT

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `call_function` envía Bearer del JWT propio y elimina el retry Firebase

**Files:**
- Create: `C:/Users/juana/GMT/proyectos/v-metric/tests/test_firebase_http.py`
- Modify: `C:/Users/juana/GMT/proyectos/v-metric/poza/firebase_http.py`

> Esta Task fusiona "enviar Bearer JWT propio" y "eliminar `refresh_session_token`/retry securetoken", porque son la misma edición: el retry vive dentro de `call_function`. `call_function` deja de ocultar el 401 y lo **propaga** como `FirebaseHttpError(status_code=401)` para que la UI (Task 4) dispare re-login. Verificado que `refresh_session_token`, `retry_refresh` y `FIREBASE_WEB_API_KEY` no se usan en ningún otro módulo.

- [ ] **Step 1: Escribir los tests que fallan.** Crear `C:/Users/juana/GMT/proyectos/v-metric/tests/test_firebase_http.py`:
```python
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from poza import firebase_http
from poza.firebase_http import FirebaseHttpError, call_function


def _resp(status_code: int, json_body: dict | None = None):
    r = MagicMock()
    r.status_code = status_code
    r.ok = 200 <= status_code < 300
    r.content = b"{}" if json_body is not None else b""
    r.json.return_value = json_body if json_body is not None else {}
    r.text = ""
    return r


def _session(token: str = "jwt-propio"):
    # La sesión de la auth propia usa `.token`; se mantiene compat con `.id_token`.
    return SimpleNamespace(token=token, id_token=token)


def test_call_function_manda_bearer_jwt_propio():
    with patch("poza.firebase_http.requests.post") as post:
        post.return_value = _resp(200, {"ok": True})
        data = call_function("saveCubicacion", {"x": 1}, session=_session("jwt-propio"))

    assert data == {"ok": True}
    headers = post.call_args.kwargs["headers"]
    assert headers["Authorization"] == "Bearer jwt-propio"


def test_call_function_propaga_401_sin_reintentar():
    # La auth propia no tiene refresh: un 401 debe propagarse tal cual, UNA sola
    # llamada HTTP (nada de securetoken), para que la UI dispare re-login.
    with patch("poza.firebase_http.requests.post") as post:
        post.return_value = _resp(401, {"error": {"message": "Sesión inválida."}})
        with pytest.raises(FirebaseHttpError) as exc:
            call_function("getLatestDem", {"reservorio_codigo": "R1"}, session=_session())

    assert exc.value.status_code == 401
    assert post.call_count == 1


def test_refresh_session_token_ya_no_existe():
    # La función de refresh de Firebase debe haber sido eliminada por completo.
    assert not hasattr(firebase_http, "refresh_session_token")
```

- [ ] **Step 2: Correr los tests y verlos fallar (PowerShell).**
```powershell
python -m pytest tests/test_firebase_http.py
```
Salida esperada: fallan `test_call_function_propaga_401_sin_reintentar` (hoy el 401 intenta refresh → `NO_REFRESH_TOKEN`/reintenta) y `test_refresh_session_token_ya_no_existe` (la función aún existe).

- [ ] **Step 3: Reescribir `C:/Users/juana/GMT/proyectos/v-metric/poza/firebase_http.py`** con este contenido COMPLETO (reemplaza el archivo entero; elimina `refresh_session_token`, el `_refresh_lock`, el import de `FIREBASE_WEB_API_KEY` y el parámetro/bloque `retry_refresh`):
```python
from __future__ import annotations

import logging
from typing import Any, Optional

import requests

from .firebase_config import FIREBASE_FUNCTIONS_BASE_URL

logger = logging.getLogger(__name__)


class FirebaseHttpError(Exception):
    """Error devuelto por un endpoint de datos de GMT Link (router /metrics).

    (El nombre se conserva por compatibilidad con los imports existentes en
    firebase_sync.py y firebase_auth.py; ya no tiene relación con Firebase.)
    """

    def __init__(self, message: str, code: str = "UNKNOWN", status_code: int | None = None):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _bearer_token(session: Any) -> str:
    """Extrae el JWT propio de la sesión (soporta `.token` y el legado `.id_token`)."""
    return getattr(session, "token", None) or getattr(session, "id_token", "") or ""


def call_function(
    name: str,
    payload: Optional[dict[str, Any]] = None,
    *,
    session: Any,
    timeout: int = 30,
    base_url: str | None = None,
) -> dict[str, Any]:
    """Llama a un endpoint de datos de GMT Link con el JWT propio del usuario.

    La auth propia NO emite refresh tokens: si el backend responde 401, el error
    se propaga como FirebaseHttpError(status_code=401) para que la capa superior
    (UI) dispare un re-login explícito. No se reintenta aquí.
    """
    token = _bearer_token(session)
    if not token:
        raise FirebaseHttpError("Se requiere una sesión autenticada.", code="NO_SESSION")

    target_base_url = base_url or FIREBASE_FUNCTIONS_BASE_URL
    url = f"{target_base_url.rstrip('/')}/{name}"
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.post(url, json=payload or {}, headers=headers, timeout=timeout)

    if resp.ok:
        if not resp.content:
            return {}
        data = resp.json()
        return data if isinstance(data, dict) else {"data": data}

    code = "FUNCTION_ERROR"
    message = f"El endpoint {name} falló con HTTP {resp.status_code}."
    try:
        err = resp.json().get("error", {})
        code = err.get("code", code)
        message = err.get("message", message)
    except Exception:
        if resp.text:
            message = resp.text[:500]
    raise FirebaseHttpError(message, code=code, status_code=resp.status_code)
```

- [ ] **Step 4: Correr los tests y verlos verde (PowerShell).**
```powershell
python -m pytest tests/test_firebase_http.py
```
Salida esperada: `3 passed`.

- [ ] **Step 5: Verificar que no quedaron referencias colgantes a los símbolos eliminados (PowerShell).**
```powershell
Select-String -Path poza\*.py -Pattern "refresh_session_token|retry_refresh" -Recurse
```
Salida esperada: **sin coincidencias** (ni en `poza/` ni subcarpetas). (`firebase_auth.py` puede seguir importando `call_function`/`FirebaseHttpError`; eso es válido hasta que se elimine en Task 6.)

- [ ] **Step 6: Suite completa (PowerShell).**
```powershell
python -m pytest
```
Salida esperada: `9 passed` (Task 2: 6 + Task 3: 3).

- [ ] **Step 7: Commit (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git add poza/firebase_http.py tests/test_firebase_http.py && git commit -m "refactor: call_function usa el JWT propio y elimina el refresh via securetoken de Firebase

La auth propia no emite refresh tokens: el 401 se propaga para re-login explicito.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Persistencia con keyring + restaurar sesión al arrancar + re-login 401 + logout

**Files:**
- Create: `C:/Users/juana/GMT/proyectos/v-metric/tests/test_credential_store.py`
- Create: `C:/Users/juana/GMT/proyectos/v-metric/poza/credential_store.py`
- Modify: `C:/Users/juana/GMT/proyectos/v-metric/poza/gmt_auth.py`  (helper `try_restore_session`)
- Modify: `C:/Users/juana/GMT/proyectos/v-metric/poza/gui_qt.py`  (import auth, `_load_saved_credentials`, `_try_login`, logout, `main()`)

> **CORRECCIÓN respecto del borrador: `app.py` NO se modifica** — `main()` vive en `gui_qt.py` (líneas 375-388). La persistencia se aísla en `credential_store.py` (keyring mockeable).

- [ ] **Step 1: Escribir el test que falla.** Crear `C:/Users/juana/GMT/proyectos/v-metric/tests/test_credential_store.py`:
```python
from __future__ import annotations

from unittest.mock import patch

from poza.credential_store import (
    SERVICE_NAME,
    clear_token,
    load_token,
    save_token,
    load_last_email,
)


def test_save_token_usa_keyring_con_servicio_y_email():
    with patch("poza.credential_store.keyring") as kr:
        save_token("user@gmt.cl", "jwt-xyz")

    calls = {c.args[:2]: c.args[2] for c in kr.set_password.call_args_list}
    assert calls[(SERVICE_NAME, "user@gmt.cl")] == "jwt-xyz"
    assert calls[(SERVICE_NAME, "__last_email__")] == "user@gmt.cl"


def test_load_token_lee_de_keyring():
    with patch("poza.credential_store.keyring") as kr:
        kr.get_password.return_value = "jwt-xyz"
        token = load_token("user@gmt.cl")

    assert token == "jwt-xyz"
    kr.get_password.assert_called_with(SERVICE_NAME, "user@gmt.cl")


def test_clear_token_borra_credencial():
    with patch("poza.credential_store.keyring") as kr:
        clear_token("user@gmt.cl")

    kr.delete_password.assert_called_with(SERVICE_NAME, "user@gmt.cl")


def test_load_token_devuelve_none_si_no_hay_backend():
    import keyring.errors

    with patch("poza.credential_store.keyring") as kr:
        kr.get_password.side_effect = keyring.errors.NoKeyringError()
        assert load_token("user@gmt.cl") is None


def test_clear_token_silencioso_si_no_existe():
    import keyring.errors

    with patch("poza.credential_store.keyring") as kr:
        kr.delete_password.side_effect = keyring.errors.PasswordDeleteError()
        clear_token("user@gmt.cl")  # No debe propagar excepción.


def test_load_last_email():
    with patch("poza.credential_store.keyring") as kr:
        kr.get_password.return_value = "user@gmt.cl"
        assert load_last_email() == "user@gmt.cl"
        kr.get_password.assert_called_with(SERVICE_NAME, "__last_email__")
```

- [ ] **Step 2: Correr y ver fallar (PowerShell).**
```powershell
python -m pytest tests/test_credential_store.py
```
Salida esperada: `ModuleNotFoundError: No module named 'poza.credential_store'`.

- [ ] **Step 3: Implementar `C:/Users/juana/GMT/proyectos/v-metric/poza/credential_store.py`:**
```python
"""Persistencia del JWT propio con keyring (Windows Credential Manager).

Servicio fijo 'V-Metric'; el usuario de keyring es el email. Se guarda además el
último email usado bajo la clave sentinela '__last_email__' para autocompletar el
login y saber a quién restaurar al arrancar.
"""
from __future__ import annotations

import logging

import keyring
import keyring.errors

logger = logging.getLogger(__name__)

SERVICE_NAME = "V-Metric"
_LAST_EMAIL_KEY = "__last_email__"


def save_token(email: str, token: str) -> None:
    """Guarda el JWT bajo (SERVICE_NAME, email) y recuerda el último email."""
    try:
        keyring.set_password(SERVICE_NAME, email, token)
        keyring.set_password(SERVICE_NAME, _LAST_EMAIL_KEY, email)
    except keyring.errors.KeyringError as exc:
        logger.warning("No se pudo guardar la credencial en keyring: %s", exc)


def load_token(email: str) -> str | None:
    """Lee el JWT persistido para `email`, o None si no hay/backend inaccesible."""
    try:
        return keyring.get_password(SERVICE_NAME, email)
    except keyring.errors.KeyringError as exc:
        logger.warning("No se pudo leer la credencial de keyring: %s", exc)
        return None


def clear_token(email: str) -> None:
    """Borra la credencial persistida para `email` (idempotente, silencioso)."""
    try:
        keyring.delete_password(SERVICE_NAME, email)
    except keyring.errors.KeyringError as exc:
        logger.debug("No había credencial que borrar para %s: %s", email, exc)


def load_last_email() -> str | None:
    """Devuelve el último email que inició sesión, o None."""
    try:
        return keyring.get_password(SERVICE_NAME, _LAST_EMAIL_KEY)
    except keyring.errors.KeyringError as exc:
        logger.warning("No se pudo leer el último email de keyring: %s", exc)
        return None
```

- [ ] **Step 4: Correr y ver verde (PowerShell).**
```powershell
python -m pytest tests/test_credential_store.py
```
Salida esperada: `6 passed`.

- [ ] **Step 5: Añadir `try_restore_session` al final de `C:/Users/juana/GMT/proyectos/v-metric/poza/gmt_auth.py`:**
```python
def try_restore_session(*, api_url: str | None = None) -> GmtSession | None:
    """Intenta restaurar una sesión desde keyring validándola contra /auth/me.

    Devuelve la GmtSession si el token persistido sigue siendo válido; None si no
    hay token guardado o si el backend lo rechaza (401/403) — en cuyo caso además
    limpia la credencial caduca.
    """
    from . import credential_store

    email = credential_store.load_last_email()
    if not email:
        return None
    token = credential_store.load_token(email)
    if not token:
        return None
    try:
        return me(token, api_url=api_url)
    except GmtAuthError as exc:
        if exc.status_code in (401, 403):
            credential_store.clear_token(email)
        logger.info("Sesión persistida no válida (%s); se requiere login.", exc.code)
        return None
```

- [ ] **Step 6: Añadir tests de `try_restore_session` al final de `C:/Users/juana/GMT/proyectos/v-metric/tests/test_gmt_auth.py`:**
```python
def test_try_restore_session_ok(api_url: str):
    body = {
        "id": "u1", "email": "user@gmt.cl", "firstName": "Ana", "lastName": "P",
        "status": "ACTIVE", "modules": ["v-metric"], "canManageRoles": False,
    }
    with patch("poza.credential_store.load_last_email", return_value="user@gmt.cl"), \
         patch("poza.credential_store.load_token", return_value="jwt-guardado"), \
         patch("poza.gmt_auth.requests.get") as get:
        get.return_value = _fake_response(200, body)
        session = gmt_auth.try_restore_session(api_url=api_url)

    assert session is not None
    assert session.uid == "u1"


def test_try_restore_session_token_caduco_limpia_credencial(api_url: str):
    with patch("poza.credential_store.load_last_email", return_value="user@gmt.cl"), \
         patch("poza.credential_store.load_token", return_value="jwt-viejo"), \
         patch("poza.credential_store.clear_token") as clear, \
         patch("poza.gmt_auth.requests.get") as get:
        get.return_value = _fake_response(401, {"message": "expiro"})
        session = gmt_auth.try_restore_session(api_url=api_url)

    assert session is None
    clear.assert_called_once_with("user@gmt.cl")


def test_try_restore_session_sin_token(api_url: str):
    with patch("poza.credential_store.load_last_email", return_value=None):
        assert gmt_auth.try_restore_session(api_url=api_url) is None
```

- [ ] **Step 7: Correr tests de gmt_auth y verlos verde (PowerShell).**
```powershell
python -m pytest tests/test_gmt_auth.py
```
Salida esperada: `9 passed`.

- [ ] **Step 8: Cablear el import de auth en `gui_qt.py`.** Reemplazar exactamente el bloque de **líneas 51-59**:
```python
try:
    from .firebase_auth import (
        sign_in as fb_sign_in,
        FirebaseAuthError,
        is_available as fb_auth_available,
    )
    _FB_AUTH_AVAILABLE = True
except ImportError:
    _FB_AUTH_AVAILABLE = False
```
por:
```python
try:
    from .gmt_auth import (
        login as gmt_login,
        me as gmt_me,
        try_restore_session as gmt_try_restore_session,
        GmtAuthError,
        is_available as gmt_auth_available,
    )
    from . import credential_store
    _AUTH_AVAILABLE = True
except ImportError:
    _AUTH_AVAILABLE = False
```

- [ ] **Step 9: Reemplazar `_load_saved_credentials` y `_try_login`.** Reemplazar exactamente el bloque de **líneas 186-223** (desde `def _load_saved_credentials(self): pass` hasta el `self.accept() # Mock bypass for testing shell` inclusive):
```python
    def _load_saved_credentials(self):
        if _AUTH_AVAILABLE:
            last = credential_store.load_last_email()
            if last:
                self._txt_user.setText(last)

    def _try_login(self):
        email = self._txt_user.text().strip(); password = self._txt_pass.text()
        if not email or not password: self._lbl_error.setText("Ingresa correo y contraseña."); return
        self._spinner.start(); self._spinner_lbl.setText("Validando credenciales…"); self._lbl_error.setText(""); QApplication.processEvents()
        if _AUTH_AVAILABLE and gmt_auth_available():
            try:
                token = gmt_login(email, password)
                session = gmt_me(token)
                credential_store.save_token(session.email, token)
                self._session = session
                self._user_uid = session.uid; self._user_email = session.email
                self._user_nombre = session.nombre_completo or email.split("@")[0]; self._user_rol = session.rol
                if _FB_AVAILABLE: firebase_sync.set_session(session)

                # --- SINCRONIZACIÓN DE TEMA EN BACKGROUND (no bloquea el UI) ---
                import os, threading as _t
                base_api_url = os.getenv("VMETRIC_GMT_LINK_API_URL", "http://localhost:3001/metrics").replace('/metrics', '')
                prefs = _load_prefs()

                def _sync_theme():
                    try:
                        themes.fetch_remote_theme_tokens(base_api_url)
                        from PySide6.QtCore import QTimer
                        QTimer.singleShot(0, lambda: _apply_theme(
                            QApplication.instance(),
                            prefs.get("theme", "gmt_link"),
                            prefs.get("custom_colors") or None,
                            prefs.get("font_scale", 1.0),
                        ))
                    except Exception:
                        pass  # Fallo silencioso: el tema por defecto ya aplicado es suficiente

                _t.Thread(target=_sync_theme, daemon=True).start()

                self.accept()
            except GmtAuthError as e:
                self._spinner.stop(); self._spinner_lbl.setText(""); self._lbl_error.setText(str(e))
            return
        self.accept() # Mock bypass for testing shell
```
> Nota: `firebase_sync.set_session(session)` funciona porque `GmtSession.id_token` (property) devuelve el JWT — requisito verificado de `firebase_sync` (líneas 39/44). Se usa `VMETRIC_GMT_LINK_API_URL` (no el legado `VMETRIC_FIREBASE_FUNCTIONS_BASE_URL`).

- [ ] **Step 10: Cablear el logout.** Reemplazar exactamente **líneas 352-353**:
```python
        act_logout = QAction("Cerrar sesión", self); act_logout.triggered.connect(self.close)
        menu_opt.addAction(act_logout)
```
por:
```python
        act_logout = QAction("Cerrar sesión", self); act_logout.triggered.connect(self._logout)
        menu_opt.addAction(act_logout)
```
Y añadir el método `_logout` dentro de `MainWindow`, inmediatamente después de `_change_theme` (tras la línea 369, antes del bloque de comentario del Entrypoint):
```python
    def _logout(self):
        try:
            if _AUTH_AVAILABLE:
                email = (self._user_info or {}).get("username")
                if email:
                    credential_store.clear_token(email)
        except Exception:
            pass
        self.close()
```
> Nota: se lee la clave `"username"` porque `LoginDialog.user_info` guarda el email bajo esa clave (verificado, gui_qt.py línea 229) y `MainWindow._user_info` recibe ese dict.

- [ ] **Step 11: Restaurar sesión al arrancar.** Reemplazar exactamente el cuerpo de `main()` (**líneas 375-388**):
```python
def main() -> None:
    app = QApplication(sys.argv); app.setApplicationName(_APP_NAME)
    prefs = _load_prefs()
    _apply_theme(app, prefs.get("theme", "predeterminado"), prefs.get("custom_colors") or None, prefs.get("font_scale", 1.0))

    if _FB_AUTH_AVAILABLE and fb_auth_available():
        dlg = LoginDialog()
        if dlg.exec() != QDialog.Accepted: sys.exit(0)
        win = MainWindow(user_info=dlg.user_info)
    else:
        win = MainWindow()

    win.showMaximized()
    sys.exit(app.exec())
```
por:
```python
def main() -> None:
    app = QApplication(sys.argv); app.setApplicationName(_APP_NAME)
    prefs = _load_prefs()
    _apply_theme(app, prefs.get("theme", "predeterminado"), prefs.get("custom_colors") or None, prefs.get("font_scale", 1.0))

    if _AUTH_AVAILABLE and gmt_auth_available():
        session = None
        try:
            session = gmt_try_restore_session()
        except Exception:
            session = None
        if session is not None:
            if _FB_AVAILABLE:
                firebase_sync.set_session(session)
            user_info = {
                "id": None, "uid": session.uid, "nombre": session.nombre_completo,
                "username": session.email, "rol": session.rol, "session": session,
            }
            win = MainWindow(user_info=user_info)
        else:
            dlg = LoginDialog()
            if dlg.exec() != QDialog.Accepted: sys.exit(0)
            win = MainWindow(user_info=dlg.user_info)
    else:
        win = MainWindow()

    win.showMaximized()
    sys.exit(app.exec())
```

- [ ] **Step 12: Suite completa (PowerShell).**
```powershell
python -m pytest
```
Salida esperada: `18 passed` (gmt_auth: 9 + firebase_http: 3 + credential_store: 6). Los tests de `gui_qt` no corren (dependen de Qt); esas ediciones se validan en el smoke-test (Task 7).

- [ ] **Step 13: Verificar que `gmt_auth`/`credential_store` importan en runtime (PowerShell).**
```powershell
python -c "from poza import gmt_auth, credential_store; print('imports OK', gmt_auth.is_available())"
```
Salida esperada: `imports OK True`.

- [ ] **Step 14: Verificar que `gui_qt` compila sin errores de sintaxis tras las ediciones (PowerShell).** (No importa Qt completo; solo valida el bytecode.)
```powershell
python -m py_compile poza\gui_qt.py; if ($LASTEXITCODE -eq 0) { echo "gui_qt compila OK" }
```
Salida esperada: `gui_qt compila OK`.

- [ ] **Step 15: Commit (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git add poza/credential_store.py poza/gmt_auth.py poza/gui_qt.py tests/test_credential_store.py tests/test_gmt_auth.py && git commit -m "feat: persistir el JWT con keyring, restaurar sesion al arrancar y re-login/logout

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Configuración — `AUTH_API_BASE_URL` + URL pública de Railway

**Files:**
- Modify: `C:/Users/juana/GMT/proyectos/v-metric/poza/firebase_config.py`
- Modify: `C:/Users/juana/GMT/proyectos/v-metric/.env.example`
- Create: `C:/Users/juana/GMT/proyectos/v-metric/tests/test_config_api_url.py`

> `firebase_config.py` ya deriva `FIREBASE_FUNCTIONS_BASE_URL` de `_GMT_LINK_API_DEFAULT` (línea 22, verificado). Esta Task añade `AUTH_API_BASE_URL` (raíz sin `/metrics`) reutilizable, con test, y documenta la URL de Railway.

- [ ] **Step 1: Obtener la URL pública del servicio `api` en Railway (PowerShell).**
```powershell
railway status
railway domain --service api
```
Salida esperada: URL pública tipo `https://api-production-XXXX.up.railway.app`. Anotarla como `<API_URL_RAILWAY>`. (Si no hay dominio, generarlo en el dashboard del proyecto "valiant-rebirth" → servicio `api` → Settings → Networking → Generate Domain.) **Paso de verificación explícito:** si `railway` CLI no está autenticado/instalado, ejecutar `railway login` primero, o tomar la URL del dashboard.

- [ ] **Step 2: Escribir el test de la derivación de URL.** Crear `C:/Users/juana/GMT/proyectos/v-metric/tests/test_config_api_url.py`:
```python
from __future__ import annotations

import importlib


def _reload_config(monkeypatch, url: str):
    monkeypatch.setenv("VMETRIC_GMT_LINK_API_URL", url)
    import poza.firebase_config as cfg
    return importlib.reload(cfg)


def test_functions_base_url_sigue_a_gmt_link_api(monkeypatch):
    cfg = _reload_config(monkeypatch, "https://api-prod.up.railway.app/metrics")
    assert cfg.FIREBASE_FUNCTIONS_BASE_URL == "https://api-prod.up.railway.app/metrics"


def test_auth_api_base_url_recorta_metrics(monkeypatch):
    cfg = _reload_config(monkeypatch, "https://api-prod.up.railway.app/metrics")
    assert cfg.AUTH_API_BASE_URL == "https://api-prod.up.railway.app"


def test_auth_api_base_url_sin_sufijo_metrics(monkeypatch):
    cfg = _reload_config(monkeypatch, "https://api-prod.up.railway.app")
    assert cfg.AUTH_API_BASE_URL == "https://api-prod.up.railway.app"
```

- [ ] **Step 3: Correr y ver fallar (PowerShell).**
```powershell
python -m pytest tests/test_config_api_url.py
```
Salida esperada: `AttributeError: module 'poza.firebase_config' has no attribute 'AUTH_API_BASE_URL'`.

- [ ] **Step 4: Añadir `AUTH_API_BASE_URL` a `firebase_config.py`.** Insertar, justo después de la línea 28 (fin del bloque `FIREBASE_FUNCTIONS_BASE_URL = os.getenv(... )`) y antes de la línea 29 (`_SHEETS_CREDS_RAW = ...`), este bloque (usa `_GMT_LINK_API_DEFAULT`, que existe en línea 22):
```python

# ── Auth propia (GMT Link) ─────────────────────────────────────────────────────
# /auth/login y /auth/me viven en la RAÍZ de la API (no bajo /metrics). Derivamos
# la base recortando el sufijo /metrics de la URL de datos.
def _auth_api_base_url() -> str:
    raw = _GMT_LINK_API_DEFAULT.rstrip("/")
    if raw.endswith("/metrics"):
        raw = raw[: -len("/metrics")]
    return raw

AUTH_API_BASE_URL = _auth_api_base_url()
```

- [ ] **Step 5: Correr y ver verde (PowerShell).**
```powershell
python -m pytest tests/test_config_api_url.py
```
Salida esperada: `3 passed`.

- [ ] **Step 6: Documentar en `.env.example`.** Reemplazar exactamente el bloque de **líneas 12-26** del `.env.example` (desde `# ─── Identidad (Firebase) ...` hasta `VMETRIC_FIRESTORE_DATABASE=default` inclusive):
```
# ─── Identidad (Firebase) — por defecto el proyecto de GMT Link ─────
# La nueva versión usa el MISMO proyecto Firebase que GMT Link (gmt-hub-6d8f7),
# para tener una sola identidad de usuario. Solo override si usas otro proyecto.
# VMETRIC_FIREBASE_PROJECT_ID=gmt-hub-6d8f7
# VMETRIC_FIREBASE_API_KEY=AIza...   (apiKey web; por defecto la de GMT Link)

# ─── Backend de datos — API de GMT Link (NestJS), misma BD (PostgreSQL) ──
# call_function(name) → POST {URL}/{name}. Los `name` coinciden con los
# endpoints de GMT Link (saveCubicacion, getLatestDem, …). En dev apunta al
# GMT Link local; en producción, la URL pública desplegada.
VMETRIC_GMT_LINK_API_URL=http://localhost:3001/metrics
# (avanzado) override fino de las bases de funciones:
# VMETRIC_FIREBASE_FUNCTIONS_BASE_URL=http://localhost:3001/metrics
# VMETRIC_FIREBASE_FUNCTIONS_PUBLIC_BASE_URL=http://localhost:3001/metrics
VMETRIC_FIRESTORE_DATABASE=default
```
por:
```
# ─── Backend de datos + AUTH — API de GMT Link (NestJS), misma BD (PostgreSQL) ──
# V-Metric ya NO usa Firebase para autenticar. El login va por la auth propia:
#   POST {URL_RAIZ}/auth/login  y  GET {URL_RAIZ}/auth/me   (JWT propio, keyring).
# Los datos van por {URL_RAIZ}/metrics/{name} (saveCubicacion, getLatestDem, …).
#
# VMETRIC_GMT_LINK_API_URL debe apuntar al router /metrics; la base de /auth se
# deriva recortando ese sufijo. En dev apunta al GMT Link local; en producción,
# a la URL pública del servicio `api` en Railway (proyecto "valiant-rebirth").
#
# Desarrollo local:
VMETRIC_GMT_LINK_API_URL=http://localhost:3001/metrics
#
# Producción (Railway) — reemplazar por el dominio real del servicio `api`:
# VMETRIC_GMT_LINK_API_URL=https://api-production-XXXX.up.railway.app/metrics
#
# (avanzado) override fino de la base de datos-endpoints:
# VMETRIC_FIREBASE_FUNCTIONS_BASE_URL=https://api-production-XXXX.up.railway.app/metrics
```
Además, eliminar del `.env.example` la nota final obsoleta (**líneas 36-37**):
```
# ─── Sin Firebase → SQLite local (modo offline / desarrollo) ────────
# El login local solo se permite con VMETRIC_DEV=1.
```

- [ ] **Step 7: Verificar la derivación con la URL real de Railway (PowerShell).** Sustituir `<API_URL_RAILWAY>` por el valor del Step 1:
```powershell
$env:VMETRIC_GMT_LINK_API_URL="<API_URL_RAILWAY>/metrics"
python -c "import importlib, poza.firebase_config as c; importlib.reload(c); print('AUTH:', c.AUTH_API_BASE_URL); print('DATA:', c.FIREBASE_FUNCTIONS_BASE_URL)"
Remove-Item Env:\VMETRIC_GMT_LINK_API_URL
```
Salida esperada: `AUTH: <API_URL_RAILWAY>` y `DATA: <API_URL_RAILWAY>/metrics`.

- [ ] **Step 8: Commit (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git add poza/firebase_config.py .env.example tests/test_config_api_url.py && git commit -m "feat: derivar AUTH_API_BASE_URL de la API de Railway y documentar en .env.example

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Quitar piezas Firebase del repo/bundle y confirmar independencia

**Files:**
- Delete (código muerto): `C:/Users/juana/GMT/proyectos/v-metric/poza/firebase_auth.py`
- Delete (repo, trackeados): `firebase.json`, `firestore.rules`, `storage.rules`, `functions/`
- Delete (disco, NO trackeado): `firebase-key.json`
- Modify: `C:/Users/juana/GMT/proyectos/v-metric/requirements.txt`

> Verdad de terreno: `firebase-key.json` NO está trackeado por git (verificado); `firebase.json`/`firestore.rules`/`storage.rules`/`functions/` SÍ lo están. `V-Metric.spec` no referencia nada Firebase. `poza/db/repository.py` menciona `firebase_auth` solo en un comentario (no lo importa) → borrar el módulo es seguro. Antes de borrar `firebase_auth.py` hay que verificar que Task 4 quitó el único import real (en `gui_qt.py`).

- [ ] **Step 1: Confirmar (recursivo) quién importa aún `firebase_auth` (PowerShell).** El grep del borrador era no-recursivo; se corrige con `-Recurse` para cubrir `poza/db/` y `poza/views/`.
```powershell
Set-Location C:\Users\juana\GMT\proyectos\v-metric
Get-ChildItem -Path poza -Recurse -Filter *.py | Select-String -Pattern "import firebase_auth|from .firebase_auth|from \.firebase_auth|firebase_auth" | Select-Object Path, LineNumber, Line
Select-String -Path app.py -Pattern "firebase_auth"
```
Salida esperada: la ÚNICA coincidencia real de import ya fue eliminada por Task 4. Puede aparecer el comentario de `poza/db/repository.py` línea 117 (`# La contraseña real se actualiza en Firebase Auth (firebase_auth.py)`) — es solo texto, no un import, y no bloquea el borrado. Si aparece cualquier `import`/`from ... firebase_auth`, corregirlo antes de continuar.

- [ ] **Step 2: Confirmar que nada del bundle lee Admin SDK / securetoken / identitytoolkit en runtime (PowerShell).**
```powershell
Get-ChildItem -Path poza -Recurse -Filter *.py | Select-String -Pattern "firebase-key|firebase_admin|securetoken|identitytoolkit" | Select-Object Path, LineNumber, Line
```
Salida esperada tras esta fase: solo posibles referencias dentro de `poza/firebase_auth.py` (que se elimina en el Step 3). `poza/export.py` puede seguir usando `google.oauth2.service_account` (Google Sheets) — NO es Firebase y se conserva.

- [ ] **Step 3: Eliminar el módulo muerto `poza/firebase_auth.py` (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git rm poza/firebase_auth.py
```
Salida esperada: `rm 'poza/firebase_auth.py'`.

- [ ] **Step 4: Purgar los artefactos Firebase TRACKEADOS del repo (Bash).** (`firebase-key.json` NO va aquí: no está trackeado.)
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git rm firebase.json firestore.rules storage.rules && git rm -r functions
```
Salida esperada: `rm 'firebase.json'`, `rm 'firestore.rules'`, `rm 'storage.rules'` y muchas líneas `rm 'functions/...'`.

- [ ] **Step 5: Borrar del disco el `firebase-key.json` no trackeado (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && rm -f firebase-key.json && ls firebase-key.json 2>&1
```
Salida esperada: `ls: cannot access 'firebase-key.json': No such file or directory` (confirmando que ya no existe). (Si además existieran `.firebaserc`/`check_firebase.py` y se decide purgarlos, hacerlo aparte; el borrador no los incluye y se dejan como están para no ampliar el alcance.)

- [ ] **Step 6: Confirmar que el `.spec` no referencia Firebase (paso de verificación; no hay edición).** Verificado en la lectura: `V-Metric.spec` no tiene entradas Firebase; `keyring` ya está en `hiddenimports`.
```powershell
Select-String -Path V-Metric.spec -Pattern "firebase|firebase-key"
```
Salida esperada: **sin coincidencias**.

- [ ] **Step 7: Actualizar el comentario de `requirements.txt`.** Reemplazar exactamente:
```
# ── Firebase ─────────────────────────────────────────────
requests>=2.31          # Firebase Auth REST API + Cloud Functions
```
por:
```
# ── HTTP (auth propia + endpoints de datos de GMT Link) ──
requests>=2.31          # POST /auth/login, GET /auth/me, POST /metrics/*
```

- [ ] **Step 8: Confirmar que la app importa y la suite pasa sin Firebase (PowerShell).**
```powershell
.\.venv\Scripts\Activate.ps1
python -m py_compile poza\gui_qt.py; if ($LASTEXITCODE -eq 0) { echo "gui_qt compila OK" }
python -c "import poza.firebase_sync, poza.firebase_http, poza.credential_store, poza.gmt_auth; print('imports OK')"
python -m pytest
```
Salida esperada: `gui_qt compila OK`, `imports OK`, y `18 passed` (el conteo no cambia; `firebase_auth` ya no se importa en ningún lado). Nota: no se importa `poza.gui_qt` directamente aquí porque arrastra Qt; `py_compile` valida sintaxis.

- [ ] **Step 9: (Opcional recomendado) build de humo del bundle (PowerShell).**
```powershell
python -m PyInstaller V-Metric.spec --noconfirm
```
Salida esperada: `Building EXE ... completed successfully` y `dist/V-Metric.exe` generado. (Puede diferirse al smoke-test de Task 7 si no hay recursos.)

- [ ] **Step 10: Commit (Bash).**
```bash
cd /c/Users/juana/GMT/proyectos/v-metric && git add -A && git commit -m "chore: eliminar firebase_auth muerto y artefactos Firebase del repo/bundle

V-Metric ya no depende de Firebase para autenticar; usa el JWT propio del backend.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Smoke-test manual — login contra Railway + cubicación end-to-end

**Files:** ninguno (verificación manual). Requisitos previos: servicio `api` en Railway con `AUTH_JWT_SECRET` seteado, admin sembrado (`admin@gmt.cl / <ADMIN_PASSWORD>`) y un reservorio con permiso de medición para ese usuario.

- [ ] **Step 1: Apuntar V-Metric a Railway (PowerShell).** Editar `C:/Users/juana/GMT/proyectos/v-metric/.env`, con `<API_URL_RAILWAY>` del Step 1 de Task 5, para que la línea `VMETRIC_GMT_LINK_API_URL` quede:
```
VMETRIC_GMT_LINK_API_URL=<API_URL_RAILWAY>/metrics
```
Verificar:
```powershell
Set-Location C:\Users\juana\GMT\proyectos\v-metric
$env:VMETRIC_GMT_LINK_API_URL="<API_URL_RAILWAY>/metrics"
python -c "import poza.firebase_config as c; print('AUTH base:', c.AUTH_API_BASE_URL)"
```
Salida esperada: `AUTH base: <API_URL_RAILWAY>`.

- [ ] **Step 2: Probar `login` + `me` contra Railway por CLI (PowerShell).**
```powershell
python -c "from poza import gmt_auth; t=gmt_auth.login('admin@gmt.cl','<ADMIN_PASSWORD>'); print('token len', len(t)); s=gmt_auth.me(t); print('me:', s.email, s.rol, s.activo)"
```
Salida esperada: `token len <n>` (JWT no vacío) y `me: admin@gmt.cl admin True`. Un `GmtAuthError status_code=401` indica credenciales/seed o `AUTH_JWT_SECRET` mal configurados.

- [ ] **Step 3: Verificar persistencia keyring (PowerShell).**
```powershell
python -c "from poza import gmt_auth, credential_store as cs; t=gmt_auth.login('admin@gmt.cl','<ADMIN_PASSWORD>'); cs.save_token('admin@gmt.cl', t); print('guardado?', cs.load_token('admin@gmt.cl') is not None); print('last', cs.load_last_email())"
```
Salida esperada: `guardado? True` y `last admin@gmt.cl`. Confirmar en Windows: "Administrador de credenciales" → Credenciales de Windows → entrada `V-Metric`.

- [ ] **Step 4: Login por la UI (PowerShell).**
```powershell
python app.py
```
Verificación: el correo aparece autocompletado; login con `admin@gmt.cl / <ADMIN_PASSWORD>` abre la ventana principal sin errores en consola; al cerrar y reabrir entra **directo** (sesión restaurada vía `/auth/me`).

- [ ] **Step 5: Cubicación end-to-end.** En la app, abrir el Workspace de un reservorio con permiso, forzar descarga del DEM (`getLatestDem` → `getDemDownloadUrl`) y guardar una cubicación (`saveCubicacion`). Verificación:
- La cubicación se guarda sin "Se requiere una sesión autenticada." ni 401. (Esto confirma que `GmtSession.id_token` habilita `firebase_sync`.)
- Logs de Railway:
```powershell
railway logs --service api
```
Salida esperada: `POST /metrics/getLatestDem` y `POST /metrics/saveCubicacion` con `200`, sin `401`.
- Confirmar en la web o BD que la cubicación quedó con `userId` = id del admin.

- [ ] **Step 6: Verificar re-login ante 401 (token inválido).** Con la app cerrada, invalidar el token persistido:
```powershell
python -c "from poza import credential_store as cs; cs.save_token('admin@gmt.cl','token-invalido-forzado')"
python app.py
```
Verificación: `try_restore_session` recibe 401 de `/auth/me`, limpia la credencial caduca y muestra el `LoginDialog` (sin crash ni bucle); tras reingresar credenciales entra normal.

- [ ] **Step 7: Confirmar ausencia de rutas Firebase activas (PowerShell).**
```powershell
Get-ChildItem -Path poza -Recurse -Filter *.py | Select-String -Pattern "identitytoolkit|securetoken|signInWithPassword" | Select-Object Path, LineNumber
```
Salida esperada: **sin coincidencias**.

- [ ] **Step 8: (Cierre) suite completa (PowerShell).**
```powershell
python -m pytest -q
```
Salida esperada: `18 passed`. Fase 3 cerrada: V-Metric autentica exclusivamente con el JWT propio en Railway, persistido con keyring, con re-login explícito ante 401 y sin dependencia de Firebase.


---


## Apéndice — Correcciones del verificador adversarial


### Fase 1 — Gate de seguridad de producción


- CRÍTICO — Task 1, test roto: el borrador construía ThrottlerGuard a mano y llamaba canActivate() sin invocar onModuleInit(). Verificado en el código compilado de @nestjs/throttler v6 que this.throttlers (y los defaults getTracker/generateKey) SOLO se pueblan en onModuleInit(); sin él canActivate lanza 'TypeError: this.throttlers is not iterable', no ThrottlerException. El test nunca pasaría. Corregido: makeGuard() ahora es async y llama 'await guard.onModuleInit()'.

- Task 1, test: el fake req del borrador incluía 'ips: []' innecesario y comentaba que el guard usa req.ips. Verificado que el getTracker por defecto de v6 devuelve solo req.ip. Simplificado el req a { ip, headers, method, url } (no cambia el resultado, pero elimina una suposición incorrecta sobre la API).

- OBLIGATORIO — Task 4: el borrador dejaba el arreglo de tsconfig.test.json como paso condicional/verificación ('si no resuelve, añadir prisma'). Verificado que tsconfig.test.json tiene include ['src','test'] SIN 'prisma', y el nuevo spec importa ../../prisma/seed-admin, por lo que typecheck:test (parte de 'pnpm test') FALLA con certeza. Convertido en Step 1 obligatorio y explícito: cambiar include a ['src','test','prisma'].

- Task 4, spec: los objetos de entorno pasados a resolveAdminSeed ({ NODE_ENV: ... }) no satisfacen el tipo NodeJS.ProcessEnv que exige la firma. Añadido 'as NodeJS.ProcessEnv' en cada llamada del spec para que typecheck:test compile.

- Nombre de script fga:bootstrap: el borrador de docs usaba 'pnpm ... run fga:bootstrap'. Verificado en package.json que el script existe como 'fga:bootstrap' (apunta a scripts/fga-bootstrap.ts, que existe). Normalizado a 'pnpm --filter @gmt-platform/backend-central fga:bootstrap' (el 'run' es opcional pero se quitó por consistencia).

- Task 5, numeración de secciones del doc: el borrador referenciaba '§7' para la migración a Albemarle pero esa sección estaba numerada §5; también '§8' inexistente. Corregidas las referencias cruzadas internas (migración = §5) para consistencia.

- Rama de trabajo: se documentó que la rama actual es 'feat/modulos-1-4' (no 'main'); los commits caen en esa rama y el auto-deploy de Railway desde 'main' es un merge posterior fuera de alcance. Evita la suposición implícita del borrador de estar en main.

- Ubicación de pnpm-lock.yaml aclarada: está en la raíz del monorepo (gmt-link/pnpm-lock.yaml), no en nodes/backend-central. Los git add de Tasks 1 y 2 ya lo referencian correctamente desde la raíz; se documentó explícitamente.

- Verificaciones que requieren Postgres (Task 2 Step 4 cabeceras helmet, Task 3 Step 6 arranque completo, Task 4 Step 7 seed en dev) se marcaron como opcionales/condicionadas a BD disponible, con la nota de que build+tests unitarios ya cubren la corrección; así ningún paso queda bloqueado si no hay BD (no son placeholders, son pasos de verificación explícitos).

- Versión de throttler: el borrador pinaba ^6.4.0; verificado en el registry que la última v6 es 6.5.0 (compatible con Nest 11, misma API). Actualizado el pin a ^6.5.0 para instalar la última v6 con la misma firma verificada.



### Fase 2 — Deploy single-DB en Railway


- Task 3 Step 4 (CRÍTICO): el comando primario `railway run --service api pnpm ... fga:bootstrap` FALLA. Verificado con `railway run --help`: 'Run a LOCAL command using variables from the active environment' — corre en la máquina local, no en el contenedor, por lo que `FGA_API_URL=http://openfga.railway.internal:8080` no es resoluble. Además faltaba el separador `--`. Corregido: se promueve el dominio público temporal de OpenFGA a camino PRIMARIO (era 'alternativa').

- Task 3 Step 4: `fga:bootstrap` hace `readFileSync('../../.env')` en `updateEnv()`; si el `.env` de la raíz no existe, lanza ENOENT y el script muere antes de imprimir los IDs. Añadido paso 4a que crea el `.env` si falta. Verificado que `.dockerignore` excluye `.env`/`.env.*`, confirmando que dentro del contenedor NO existe (por eso no se puede correr ahí).

- Task 3 Step 4: la salida esperada hardcodeaba `(creado)`. Verificado en el script: imprime `(creado)` O `(existente)` según si el store ya existía. Corregido el bloque de salida esperada.

- Todos los `railway logs --service X`: verificado que `railway logs` hace STREAMING por defecto (bloquea la terminal). Añadido `--lines N` en todas las invocaciones (Tasks 3, 6) para traer histórico sin colgar la sesión.

- Setear variables dispara un deploy por defecto (verificado en `railway variable set` help: flag `--skip-deploys`). El plan seteaba muchas variables seguidas provocando redeploys repetidos. Añadido `--skip-deploys` en todos los `--set` intermedios (Tasks 3, 4, 5) y se deja que el ÚLTIMO cambio relevante dispare el deploy.

- Task 6 Step 2: la nota decía esperar que NO aparezca 'AUTH_JWT_SECRET is required' en el arranque. Verificado en `src/common/jwt.ts`: `AUTH_JWT_SECRET` se valida de forma PEREZOSA (lanza sólo al firmar/verificar un token, no al boot). El server arranca sin la variable; el fallo es 500 en login/me. Corregida la expectativa.

- Task 8 Step 1: verificado que `POST /auth/login` devuelve `{ token }` (campo `token`), por lo que `$r.token` es correcto. Confirmado también que login NO gatea por `status` (sólo email+passwordHash), y que `/auth/me` sí depende de FGA (`resolveCanManageRoles`). Ajustadas las notas de diagnóstico (401 vs 500).

- Task 4 Step 4: el plan afirmaba 'NO se setea ninguna variable Firebase'. Verificado en `nodes/web/Dockerfile`: existen ARGs `VITE_FIREBASE_*` con default vacío; dejarlos sin setear los deja como cadena vacía (correcto). Aclarado en el contexto para que no se interprete como que hay que borrarlos.

- Task 1/Task 2: verificado que `railway status --json` no tiene esquema garantizado; el plan hacía `Select-Object -ExpandProperty services` sobre el JSON. Sustituido por `railway status` (humano) y marcado como paso de verificación, sin asumir el shape del JSON.

- Railway CLI: verificado que `railway variables --set` es LEGACY (documentado así en el help) pero funcional; la forma preferida es `railway variable set K=V`. Se mantiene `--set` (funciona) y se documenta la alternativa. Verificado también que `railway variables` (plural) es alias de `railway variable`, y que `--kv` da salida `KEY=value` (usada ahora en los greps de verificación en vez de la tabla por defecto).

- Ítem 3 del alcance de revisión (throttler/helmet): verificado en `nodes/backend-central/package.json` que NO existen `@nestjs/throttler` ni `helmet` como dependencias y el plan no los usa — no había API errónea que corregir. `keyring` es de v-metric (repo aparte), no aplica a esta fase.

- Task 7: añadido paso de verificación explícito de que `psql`/`pg_dump` existen en Windows; si no, correr todo dentro de WSL. Reforzada la protección del admin en la poda con `AND email <> 'admin@gmt.cl'` en el propio DELETE (antes sólo lo decía la nota). Añadido `PGPASSWORD` explícito en los comandos WSL y verificación del nombre de la base local.

- Task 7 Step 6: el plan mencionaba exportar los `FGA_*` 'en el mismo bloque' sin mostrarlos. Completado con los `railway domain` temporal, los `$env:FGA_*` explícitos y el `railway domain delete` de cierre, y advertencia sobre precedencia dotenv vs env del proceso.

- Rama/remote: confirmado `feat/modulos-1-4` (git branch --show-current) y remote `https://github.com/japalmo/GMT-Link.git`. Los filtros pnpm y nombres de script del plan coinciden con los package.json reales.



### Fase 3 — V-Metric a la auth propia


- CRÍTICO — GmtSession sin id_token rompería TODAS las llamadas a datos: poza/firebase_sync.py (líneas 39 y 44) exige getattr(session, 'id_token', ...) truthy en `available` y `_get_session()`. El borrador definía GmtSession solo con `.token`, así que set_session(session) habilitaría la sesión pero _get_session() lanzaría RuntimeError('Firebase requiere una sesión autenticada.') en cada saveCubicacion/getLatestDem. Corregido: GmtSession expone `id_token` como @property que devuelve `token`, y se añadió aserción en el test de me().

- Task 4 listaba `Modify: app.py` pero main() NO está en app.py — está en poza/gui_qt.py (líneas 375-388). app.py (13 líneas) solo hace init_db()+main(). Eliminado app.py de los Files de Task 4; la reescritura de main() se hace en gui_qt.py.

- Task 6 Step 4 hacía `git rm firebase-key.json` pero ese archivo NO está trackeado por git (verificado con git ls-files) — el comando abortaría entero por un pathspec inexistente. Separado: `git rm` solo para los trackeados (firebase.json, firestore.rules, storage.rules, functions/) y un paso `rm -f firebase-key.json` aparte para borrarlo del disco.

- Task 4 Step 8b decía reemplazar 'el cuerpo de _try_login (líneas 187-223)' pero también reescribía _load_saved_credentials, que es la línea 186 (fuera del rango). Corregido el rango exacto a líneas 186-223 e incluido el old_string real (`def _load_saved_credentials(self): pass` ... `self.accept() # Mock bypass for testing shell`).

- La verificación de importadores de firebase_auth (Task 6 Step 1) usaba `Select-String -Path poza\*.py` que es NO-recursivo y NO escanea poza/db/ ni poza/views/. Cambiado a `Get-ChildItem -Recurse`. Verificado que poza/db/repository.py menciona firebase_auth solo en un comentario (línea 117), no lo importa, así que borrar el módulo es seguro.

- Los greps de verificación de Firebase (Task 6 Steps 1/2 y Task 7 Step 7) eran no-recursivos; se hicieron recursivos con Get-ChildItem -Recurse para que la afirmación 'sin coincidencias' sea confiable en todo el árbol de poza/.

- El _try_login del borrador usaba `os.getenv('VMETRIC_FIREBASE_FUNCTIONS_BASE_URL', ...)` para el theme sync; se unificó a `VMETRIC_GMT_LINK_API_URL` (la variable canónica que define _GMT_LINK_API_DEFAULT en firebase_config.py línea 22) para coherencia con el resto de la fase.

- Task 1 Step 1 asumía condicionalmente la instalación de pytest; verificado que pytest NO está en el venv (ModuleNotFoundError), así que el paso ahora instala de forma determinista con un one-liner PowerShell que corre `pip install` cuando falta.

- Task 5 Step 4: se precisó el punto de inserción exacto de AUTH_API_BASE_URL (tras la línea 28, antes de la 29 `_SHEETS_CREDS_RAW`) y se confirmó que `_GMT_LINK_API_DEFAULT` existe (firebase_config.py línea 22) — el borrador lo usaba sin confirmar su nombre.

- Task 5 Step 6: se ajustó el old_string real del .env.example (el bloque real es líneas 12-26 con comentarios 'Identidad (Firebase)' + 'Backend de datos' + VMETRIC_FIRESTORE_DATABASE, más la nota final líneas 36-37), citando el contenido textual leído del archivo en vez de una descripción aproximada.

- Se añadieron pasos de verificación de sintaxis con `python -m py_compile poza\gui_qt.py` (Task 4 Step 14 y Task 6 Step 8) porque las ediciones de gui_qt.py no se cubren con pytest (arrastra Qt) — evita afirmar 'ejecutable' sin evidencia.

- Task 6 Step 8 evita `import poza.gui_qt` (arrastra Qt/side-effects); se usa py_compile + import de los módulos no-Qt (firebase_sync, firebase_http, credential_store, gmt_auth), que es lo verificable sin display.

- Confirmado contra el backend real: shape de /auth/me {id,email,firstName,lastName,status,modules,canManageRoles} y que la regla admin del plan (canManageRoles→admin) coincide con auth.controller.ts; endpoints /metrics (saveCubicacion, getLatestDem, etc.) verificados como @Post; SessionMiddleware valida el Bearer JWT propio. keyring.errors expone NoKeyringError/PasswordDeleteError (tests válidos). themes.fetch_remote_theme_tokens existe (línea 441). user_info usa la clave 'username' (línea 229) → el _logout la lee correctamente.


