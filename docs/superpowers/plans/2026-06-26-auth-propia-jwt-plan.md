# Autenticación propia (JWT) — Plan de implementación (Bloque 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar Firebase Auth por autenticación propia (login email+contraseña → JWT HS256 firmado por el backend, hashing bcrypt en Postgres), desplegar todo en Railway (incl. OpenFGA) y dejar una URL pública con login funcionando (un admin sembrado que crea usuarios).

**Architecture:** El backend gana helpers puros `common/password.ts` (bcryptjs) y `common/jwt.ts` (jsonwebtoken, secreto `AUTH_JWT_SECRET`). `POST /auth/login` valida contra `User.passwordHash` y emite el JWT. `SessionMiddleware` verifica NUESTRO JWT (payload `{sub:userId}`) y busca el `User` por id. Los flujos de provisión / primer-login / cambio-de-clave pasan a hashear en Postgres. Firebase se elimina. La web guarda el JWT en `localStorage` y lo adjunta en cada request. OpenFGA se despliega en Railway con datastore Postgres.

**Tech Stack:** NestJS 11 · Prisma 6 · bcryptjs · jsonwebtoken · React/Vite · vitest · Railway CLI · OpenFGA.

**Spec:** [docs/superpowers/specs/2026-06-26-auth-propia-jwt-design.md](../specs/2026-06-26-auth-propia-jwt-design.md)

---

## Decisiones (fijas para todo el plan)

- **Hashing:** `bcryptjs` (JS puro, sin build nativo), `SALT_ROUNDS = 12`. Helper `common/password.ts`.
- **JWT:** `jsonwebtoken`, HS256, TTL `7d`, payload `{ sub: userId }`, secreto `process.env.AUTH_JWT_SECRET`. Helper `common/jwt.ts` (funciones puras, sin DI — el middleware las llama directo).
- **Login:** `POST /auth/login {email,password}` → `{ token }`. 401 genérico si no matchea. Cualquier `status` puede loguear (el routing del front maneja PENDING/SUSPENDED).
- **Contrato web↔back:** el JWT solo lleva `sub`; `status`/roles/módulos se releen en `/auth/me`. Tras first-login (status→ACTIVE) el MISMO token sigue válido; la web solo re-llama `getMe()`.
- **Admin sembrado:** `admin@gmt.cl` / `AdminGmt2026` (ya definido en `seed-admin.ts`), rol `org_admin` (grants GLOBAL de todo el catálogo).
- **Shell (esta máquina):** Bash para `git`; **PowerShell** para `pnpm`/`tsc`/`vitest`/`railway`/`node` (Git Bash no corre node). Ramas: trabajo en `feat/modulos-1-4` (= `main` remoto).

## Estructura de archivos

**Crear:**
- `nodes/backend-central/src/common/password.ts` — `hashPassword`/`verifyPassword` (bcryptjs).
- `nodes/backend-central/src/common/jwt.ts` — `signToken`/`verifyToken` (jsonwebtoken).
- `nodes/backend-central/src/auth/dto/login.dto.ts` — DTO de login.
- `nodes/backend-central/test/common/password.spec.ts`, `test/common/jwt.spec.ts`, `test/auth/login.spec.ts` — tests unitarios.
- `nodes/web/src/lib/auth-token.ts` — token store en localStorage.

**Modificar (backend):** `prisma/schema.prisma` (+`passwordHash`), `src/auth/session.middleware.ts`, `src/auth/auth.controller.ts` (login + first-login), `src/auth/auth.module.ts`, `src/auth/auth-request.types.ts`, `src/authz/auth-user.types.ts` (JSDoc), `src/modules/profile/profile.service.ts` + `profile.controller.ts` + `profile.module.ts`, `src/modules/users/users.service.ts` + `users.module.ts`, `prisma/seed-admin.ts`, `package.json`.

**Eliminar (backend):** `src/auth/firebase.service.ts` + dep `firebase-admin`.

**Modificar (web):** `src/lib/api.ts`, `src/context/auth-context.tsx`, `src/pages/login.tsx`, `src/lib/api.test.ts`, `package.json` (quitar `firebase`). **Eliminar:** `src/lib/firebase.ts`.

**Deploy:** servicio `openfga` en Railway; variables `AUTH_JWT_SECRET`, `FGA_*` en `backend-central`; seed de la Postgres de Railway.

---

## Tarea 1: Migración Prisma — `User.passwordHash`

**Files:** Modify `nodes/backend-central/prisma/schema.prisma`; Create migración.

- [ ] **Step 1: Añadir la columna.** En `model User` (después de `avatarUrl String?`), agregar:
```prisma
  passwordHash   String?    // hash bcrypt de la contraseña; null hasta que el usuario fija su clave
```
- [ ] **Step 2: Generar la migración (PowerShell, backend levantado contra la Postgres local WSL).**
Run: `pnpm --filter "@gmt-platform/backend-central" exec prisma migrate dev --name add_user_password_hash`
Expected: crea `prisma/migrations/<ts>_add_user_password_hash/` y regenera el cliente. La columna queda nullable (no rompe filas existentes).
- [ ] **Step 3: Commit.**
```bash
git add nodes/backend-central/prisma/schema.prisma nodes/backend-central/prisma/migrations
git commit -m "feat(auth): agrega User.passwordHash (migración)"
```

## Tarea 2: Helper de contraseñas (`common/password.ts`) — TDD

**Files:** Create `src/common/password.ts`, `test/common/password.spec.ts`; Modify `package.json`.

- [ ] **Step 1: Instalar bcryptjs (PowerShell).**
Run: `pnpm --filter "@gmt-platform/backend-central" add bcryptjs && pnpm --filter "@gmt-platform/backend-central" add -D @types/bcryptjs`
- [ ] **Step 2: Test que falla** — `nodes/backend-central/test/common/password.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/common/password';

describe('password helper', () => {
  it('hashea y verifica la misma contraseña', async () => {
    const hash = await hashPassword('Secreta123');
    expect(hash).not.toBe('Secreta123');
    expect(await verifyPassword('Secreta123', hash)).toBe(true);
  });
  it('rechaza una contraseña distinta', async () => {
    const hash = await hashPassword('Secreta123');
    expect(await verifyPassword('otra', hash)).toBe(false);
  });
});
```
- [ ] **Step 3: Verlo fallar.** Run: `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/common/password.spec.ts` → FAIL (módulo no existe).
- [ ] **Step 4: Implementar** — `nodes/backend-central/src/common/password.ts`:
```ts
import bcrypt from 'bcryptjs';

/** Coste de bcrypt. 12 ≈ ~250ms/hash: buen balance seguridad/latencia. */
const SALT_ROUNDS = 12;

/** Hashea una contraseña en claro. */
export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/** Compara una contraseña en claro contra su hash bcrypt. */
export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```
- [ ] **Step 5: Verde.** Run: `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/common/password.spec.ts` → 2 passed.
- [ ] **Step 6: Commit.**
```bash
git add nodes/backend-central/src/common/password.ts nodes/backend-central/test/common/password.spec.ts nodes/backend-central/package.json ../../pnpm-lock.yaml
git commit -m "feat(auth): helper de hashing de contraseñas (bcryptjs) + tests"
```

## Tarea 3: Helper de JWT (`common/jwt.ts`) — TDD

**Files:** Create `src/common/jwt.ts`, `test/common/jwt.spec.ts`; Modify `package.json`.

- [ ] **Step 1: Instalar jsonwebtoken (PowerShell).**
Run: `pnpm --filter "@gmt-platform/backend-central" add jsonwebtoken && pnpm --filter "@gmt-platform/backend-central" add -D @types/jsonwebtoken`
- [ ] **Step 2: Test que falla** — `nodes/backend-central/test/common/jwt.spec.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { signToken, verifyToken } from '../../src/common/jwt';

beforeAll(() => {
  process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min';
});

describe('jwt helper', () => {
  it('firma y verifica devolviendo el sub', () => {
    const token = signToken('user-123');
    expect(verifyToken(token)).toEqual({ sub: 'user-123' });
  });
  it('devuelve null ante un token inválido', () => {
    expect(verifyToken('no-es-un-jwt')).toBeNull();
  });
  it('devuelve null ante firma con otro secreto', () => {
    const token = signToken('user-123');
    process.env.AUTH_JWT_SECRET = 'otro-secreto-distinto-cualquiera-x';
    expect(verifyToken(token)).toBeNull();
    process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min';
  });
});
```
- [ ] **Step 3: Verlo fallar.** Run: `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/common/jwt.spec.ts` → FAIL.
- [ ] **Step 4: Implementar** — `nodes/backend-central/src/common/jwt.ts`:
```ts
import jwt from 'jsonwebtoken';

/** Vida del token de sesión (cómodo para la demo; sin refresh tokens). */
const TTL = '7d';

/** Claim que llevamos: solo el id del usuario. El resto se relee de Postgres. */
export interface AuthTokenPayload {
  sub: string;
}

function secret(): string {
  const s = process.env.AUTH_JWT_SECRET;
  if (!s) throw new Error('AUTH_JWT_SECRET no está configurado.');
  return s;
}

/** Firma un JWT HS256 con `sub = userId`. */
export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, secret(), { algorithm: 'HS256', expiresIn: TTL });
}

/** Verifica firma + expiración. Devuelve `{ sub }` o `null` si es inválido. */
export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'object' && decoded !== null) {
      const sub = (decoded as jwt.JwtPayload).sub;
      if (typeof sub === 'string' && sub.length > 0) return { sub };
    }
    return null;
  } catch {
    return null;
  }
}
```
- [ ] **Step 5: Verde.** Run: `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/common/jwt.spec.ts` → 3 passed.
- [ ] **Step 6: Commit.**
```bash
git add nodes/backend-central/src/common/jwt.ts nodes/backend-central/test/common/jwt.spec.ts nodes/backend-central/package.json ../../pnpm-lock.yaml
git commit -m "feat(auth): helper de firma/verificación de JWT propio + tests"
```

## Tarea 4: `POST /auth/login` — TDD

**Files:** Create `src/auth/dto/login.dto.ts`, `test/auth/login.spec.ts`; Modify `src/auth/auth.controller.ts`.

- [ ] **Step 1: DTO** — `nodes/backend-central/src/auth/dto/login.dto.ts`:
```ts
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Correo inválido.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Ingresa tu contraseña.' })
  password!: string;
}
```
- [ ] **Step 2: Test que falla** — `nodes/backend-central/test/auth/login.spec.ts` (mockea Prisma; usa el helper real de password para generar el hash):
```ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';
import { hashPassword } from '../../src/common/password';

beforeAll(() => { process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min'; });

function makeController(user: { id: string; passwordHash: string | null } | null) {
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(user) } };
  // gamification/firebase no se usan en login:
  return new AuthController(prisma as never, undefined as never, undefined as never);
}

describe('AuthController.login', () => {
  it('devuelve un token con credenciales válidas', async () => {
    const hash = await hashPassword('Secreta123');
    const ctrl = makeController({ id: 'u1', passwordHash: hash });
    const res = await ctrl.login({ email: 'a@b.cl', password: 'Secreta123' });
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(10);
  });
  it('401 si la contraseña es incorrecta', async () => {
    const hash = await hashPassword('Secreta123');
    const ctrl = makeController({ id: 'u1', passwordHash: hash });
    await expect(ctrl.login({ email: 'a@b.cl', password: 'mala' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('401 si el usuario no existe', async () => {
    const ctrl = makeController(null);
    await expect(ctrl.login({ email: 'x@y.cl', password: 'lo-que-sea' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```
- [ ] **Step 3: Verlo fallar.** Run: `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/auth/login.spec.ts` → FAIL (`login` no existe).
- [ ] **Step 4: Implementar el handler.** En `auth.controller.ts`: añadir imports `import { verifyPassword } from '../common/password';` y `import { signToken } from '../common/jwt';` y `import { LoginDto } from './dto/login.dto';`. Añadir el método al controller (antes de `me()`):
```ts
  /** Login propio: valida email+contraseña y emite nuestro JWT. 401 genérico si no matchea. */
  @Post('login')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async login(@Body() body: LoginDto): Promise<{ token: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, passwordHash: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
    return { token: signToken(user.id) };
  }
```
(`Post`, `Body`, `UsePipes`, `ValidationPipe`, `UnauthorizedException` ya están importados en el controller.)
- [ ] **Step 5: Verde.** Run: `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/auth/login.spec.ts` → 3 passed.
- [ ] **Step 6: Commit.**
```bash
git add nodes/backend-central/src/auth/dto/login.dto.ts nodes/backend-central/src/auth/auth.controller.ts nodes/backend-central/test/auth/login.spec.ts
git commit -m "feat(auth): endpoint POST /auth/login (JWT propio) + tests"
```

## Tarea 5: `SessionMiddleware` verifica el JWT propio

**Files:** Modify `src/auth/session.middleware.ts`.

- [ ] **Step 1: Reescribir el middleware** — reemplazar el cuerpo de la clase por (quita `FirebaseService`, verifica nuestro JWT, busca por id):
```ts
import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { verifyToken } from '../common/jwt';
import './auth-request.types';

/**
 * Middleware de sesión (auth propia). Lee `Authorization: Bearer <jwt>`, verifica
 * NUESTRO JWT (firma + exp) y, si es válido, busca el `User` por id y setea
 * `req.authUser = { id, email }`. Token ausente/ inválido → sigue sin authUser
 * (fail-open; el guard responde 401 donde corresponda).
 */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = SessionMiddleware.extractBearer(req.header('authorization'));
    if (!token) {
      next();
      return;
    }
    const payload = verifyToken(token);
    if (payload) {
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, email: true },
      });
      if (user) {
        req.authUser = { id: user.id, email: user.email };
      }
    }
    next();
  }

  /** Extrae el token de un header "Bearer <token>"; null si no aplica. */
  private static extractBearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return null;
    return value;
  }
}
```
- [ ] **Step 2: Typecheck.** Run: `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit` → puede quedar 1 error temporal: `req.firebaseUid` sigue usado en `auth.controller.ts`/`profile.controller.ts` (se arregla en Tareas 6–7) y `auth-request.types` aún declara `firebaseUid`. Continuar; el verde total llega tras la Tarea 9. (Si prefieres verde por tarea, haz 5→6→7 seguidas antes de correr tsc.)
- [ ] **Step 3: Commit.**
```bash
git add nodes/backend-central/src/auth/session.middleware.ts
git commit -m "feat(auth): SessionMiddleware verifica el JWT propio (por userId)"
```

## Tarea 6: `first-login/complete` con hashing propio

**Files:** Modify `src/auth/auth.controller.ts`.

- [ ] **Step 1: Reescribir `completeFirstLogin`.** Importar `import { hashPassword } from '../common/password';`. Reemplazar el método (quita `@Req() req`, `req.firebaseUid` y `this.firebase.setPassword`):
```ts
  @Post('first-login/complete')
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async completeFirstLogin(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() body: CompleteFirstLoginDto,
  ): Promise<FirstLoginCompleteResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: { status: true },
    });
    if (!user) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }
    if (user.status !== 'PENDING_FIRST_LOGIN') {
      throw new ConflictException('El primer login ya fue completado.');
    }
    const passwordHash = await hashPassword(body.newPassword);
    await this.prisma.user.update({
      where: { id: authUser.id },
      data: { passwordHash, status: 'ACTIVE' },
    });
    void this.gamification.awardPoints(authUser.id, 'FIRST_LOGIN');
    return { status: 'ACTIVE' };
  }
```
- [ ] **Step 2: Limpiar imports muertos.** Si `@Req`/`Request` ya no se usan en el controller, quitarlos de los imports de `@nestjs/common`/`express`. (`me()` no usa `@Req`; login tampoco. Confirmar con tsc.)
- [ ] **Step 3: Commit.**
```bash
git add nodes/backend-central/src/auth/auth.controller.ts
git commit -m "feat(auth): first-login fija passwordHash (bcrypt) + ACTIVE, sin Firebase"
```

## Tarea 7: Cambio de contraseña propio con hashing

**Files:** Modify `src/modules/profile/profile.service.ts`, `profile.controller.ts`, `profile.module.ts`.

- [ ] **Step 1: `profile.service.ts`.** Quitar `import { FirebaseService }` y el param `firebase` del constructor. Importar `import { hashPassword } from '../../common/password';`. Reescribir:
```ts
  async changePassword(userId: string, newPassword: string): Promise<ChangePasswordResponse> {
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    return { ok: true };
  }
```
- [ ] **Step 2: `profile.controller.ts`.** En la ruta `change-password`, quitar `@Req() req`/`req.firebaseUid`/el 401 de firebaseUid y llamar con el id:
```ts
  @Post('change-password')
  changePassword(
    @CurrentUser() authUser: AuthUser | undefined,
    @Body() dto: ChangePasswordDto,
  ): Promise<ChangePasswordResponse> {
    const userId = this.requireUserId(authUser);
    return this.profileService.changePassword(userId, dto.newPassword);
  }
```
Quitar los imports `Req`/`Request`/`import '../../auth/auth-request.types'` si quedan sin uso en el archivo.
- [ ] **Step 3: `profile.module.ts`.** Quitar `AuthModule` de `imports` (ya no se necesita FirebaseService); dejar `PrismaModule`.
- [ ] **Step 4: Typecheck.** Run: `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit` (aún puede fallar por provisioning/firebase.service hasta la Tarea 9).
- [ ] **Step 5: Commit.**
```bash
git add nodes/backend-central/src/modules/profile/
git commit -m "feat(auth): cambio de contraseña propio (bcrypt → passwordHash), sin Firebase"
```

## Tarea 8: Provisión de usuarios con hashing (users.service)

**Files:** Modify `src/modules/users/users.service.ts`, `users.module.ts`.

- [ ] **Step 1: `users.service.ts` — imports.** Quitar `import { FirebaseService }`. Importar `import { hashPassword } from '../../common/password';`. Quitar `firebase` del constructor.
- [ ] **Step 2: `create()` — hashear en vez de crear en Firebase.** Reemplazar el bloque que hace `firebase.createUser` + la compensación:
```ts
    const provisionalPassword = generateProvisionalPassword();
    const passwordHash = await hashPassword(provisionalPassword);

    let user: UserWithMemberships;
    try {
      user = await this.persistUserWithMemberships(dto, roleKeys, passwordHash);
    } catch (error: unknown) {
      if (this.isUniqueEmailViolation(error)) {
        throw new ConflictException(`Ya existe un usuario con el email "${dto.email}".`);
      }
      throw error;
    }

    // Acceso org en FGA: member siempre; admin además si trae org_admin.
    try {
      const orgWrites: TupleKey[] = [this.orgAccessTuple(user.id, 'member')];
      if (roleKeys.includes(ORG_ADMIN_ROLE)) {
        orgWrites.push(this.orgAccessTuple(user.id, 'admin'));
      }
      await this.fga.writeTuples(orgWrites);
    } catch (error: unknown) {
      await this.compensateUser(user.id);
      throw error;
    }

    return { user: this.toProvisionedUser(user, roleKeys), provisionalPassword };
```
- [ ] **Step 3: `persistUserWithMemberships` — recibir y guardar el hash.** Cambiar la firma a `(dto, roleKeys, passwordHash: string)` y añadir `passwordHash` al `tx.user.create({ data: { ... , passwordHash, ... } })`.
- [ ] **Step 4: Compensación — solo Postgres.** Simplificar `compensateUser` a `(userId: string)` (borra membership + user, ya lo hace) y **eliminar** el método `compensateFirebase` y todo el hilo del `uid`. Quitar el `import` de firebase si quedara.
- [ ] **Step 5: `users.module.ts`.** Si `AuthModule` se importaba solo por FirebaseService, quitarlo (dejar `PrismaModule` y lo demás que use). Verificar que no rompa otras deps del módulo.
- [ ] **Step 6: Typecheck.** Run: `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit` → ahora sí debería quedar 0 (los últimos consumidores de Firebase migrados). Si queda error por `firebase.service.ts` importado en algún lado, se resuelve en la Tarea 9.
- [ ] **Step 7: Commit.**
```bash
git add nodes/backend-central/src/modules/users/
git commit -m "feat(auth): provisión guarda passwordHash (bcrypt), sin Firebase ni compensación"
```

## Tarea 9: Eliminar Firebase del backend

**Files:** Delete `src/auth/firebase.service.ts`; Modify `src/auth/auth.module.ts`, `src/auth/auth-request.types.ts`, `src/authz/auth-user.types.ts` (JSDoc), `package.json`.

- [ ] **Step 1: Confirmar que no quedan usos (Bash).**
```bash
git grep -n "firebase" nodes/backend-central/src -i | grep -viE "^\s*//|comentario" || echo "sin usos de firebase en src"
```
Expected: 0 usos reales (solo comentarios, si acaso).
- [ ] **Step 2: Borrar el servicio + quitarlo del módulo.** `rm nodes/backend-central/src/auth/firebase.service.ts` (Bash). En `auth.module.ts` quitar `import { FirebaseService }`, y sacarlo de `providers`/`exports`:
```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GamificationModule } from '../modules/gamification/gamification.module';
import { AuthController } from './auth.controller';

@Module({
  imports: [PrismaModule, GamificationModule],
  controllers: [AuthController],
})
export class AuthModule {}
```
- [ ] **Step 2b: Limpiar `AuthController`.** Quitar el import de `FirebaseService` y el param `firebase` de su constructor (ya no se usa tras la Tarea 6; queda `constructor(private readonly prisma: PrismaService, private readonly gamification: GamificationService)`). Ajustar `test/auth/login.spec.ts` (y cualquier spec de first-login) a construirlo con 2 args: `new AuthController(prisma as never, undefined as never)`.
- [ ] **Step 3: `auth-request.types.ts`.** Quitar la augmentación `firebaseUid` (dejar el archivo como `export {};`). Revisar los `import './auth-request.types'` (session.middleware ya no lo necesita — quitar si molesta; es inocuo).
- [ ] **Step 4: JSDoc.** En `authz/auth-user.types.ts` y `current-user.decorator.ts`, actualizar comentarios que dicen "Firebase Auth" → "JWT propio". (Cosmético.)
- [ ] **Step 5: Desinstalar firebase-admin (PowerShell).** Run: `pnpm --filter "@gmt-platform/backend-central" remove firebase-admin`
- [ ] **Step 6: Verde total.** Run:
```
pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
pnpm --filter "@gmt-platform/backend-central" exec vitest run --exclude "**/fga-model.spec.ts"
```
Expected: tsc 0. Tests: **los specs que mockeaban Firebase fallarán** — `test/modules/users.service.spec.ts` (assertions de `firebase.createUser/deleteUser`) y cualquier `auth.controller.spec.ts`/`profile` que stubbee Firebase. Arreglarlos en el Step 7.
- [ ] **Step 7: Arreglar specs afectados.** Reescribir los specs que dependían de Firebase para: (users.service) no inyectar FirebaseService y afirmar que `prisma.user.create` recibió `passwordHash` (string no vacío) + que `provisionalPassword` se devuelve; (auth.controller/profile) usar los helpers reales de password/jwt. Correr hasta verde:
`pnpm --filter "@gmt-platform/backend-central" exec vitest run --exclude "**/fga-model.spec.ts"` → todos verdes.
- [ ] **Step 8: Commit.**
```bash
git add -A
git commit -m "refactor(auth): elimina Firebase del backend (firebase-admin + FirebaseService) y ajusta specs"
```

## Tarea 10: Seed del admin sin Firebase

**Files:** Modify `nodes/backend-central/prisma/seed-admin.ts`.

- [ ] **Step 1: Reescribir el credential.** Quitar los imports de `firebase-admin/app` y `firebase-admin/auth` y la función `ensureFirebaseUser()` + su llamada en `main()`. Importar `import { hashPassword } from '../src/common/password';`. En `ensurePostgresUser()`, hashear y guardar `passwordHash` en el `upsert` (create Y update, para que re-sembrar resetee la clave):
```ts
async function ensurePostgresUser(): Promise<string> {
  const passwordHash = await hashPassword(ADMIN.password);
  const user = await prisma.user.upsert({
    where: { email: ADMIN.email },
    update: { firstName: ADMIN.firstName, lastName: ADMIN.lastName, status: UserStatus.ACTIVE, passwordHash },
    create: {
      email: ADMIN.email,
      firstName: ADMIN.firstName,
      lastName: ADMIN.lastName,
      status: UserStatus.ACTIVE,
      isClientUser: false,
      passwordHash,
    },
  });
  return user.id;
}
```
`main()` queda: `ensurePostgresUser()` → `ensureMembership(userId)` → `ensureFgaTuple(userId)` (esta ya no-opea si `FGA_STORE_ID` está vacío). Mantener el `console.log` de credenciales.
- [ ] **Step 2: Probar el seed local (PowerShell, Postgres WSL levantada).**
Run: `pnpm --filter "@gmt-platform/backend-central" exec tsx prisma/seed.ts` (catálogo) y luego `pnpm --filter "@gmt-platform/backend-central" exec tsx prisma/seed-admin.ts`
Expected: imprime las credenciales; crea/actualiza `admin@gmt.cl` ACTIVE con `passwordHash`.
- [ ] **Step 3: Verificar login local end-to-end (PowerShell, backend `pnpm dev` corriendo en 3001).**
Run: `Invoke-RestMethod -Method Post -Uri http://localhost:3001/auth/login -ContentType application/json -Body (@{email='admin@gmt.cl';password='AdminGmt2026'} | ConvertTo-Json)`
Expected: `{ token = <jwt> }`. Luego `Invoke-RestMethod http://localhost:3001/auth/me -Headers @{ Authorization = "Bearer <token>" }` → devuelve el admin ACTIVE con módulos.
- [ ] **Step 4: Commit.**
```bash
git add nodes/backend-central/prisma/seed-admin.ts
git commit -m "feat(auth): seed-admin fija passwordHash (bcrypt), sin Firebase"
```

## Tarea 11: Token store en la web (`lib/auth-token.ts`)

**Files:** Create `nodes/web/src/lib/auth-token.ts`.

- [ ] **Step 1: Implementar.**
```ts
const KEY = 'gmt_token';

/** JWT de sesión guardado en localStorage. `null` si no hay sesión. */
export function getToken(): string | null {
  return localStorage.getItem(KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(KEY);
}
```
- [ ] **Step 2: Commit.**
```bash
git add nodes/web/src/lib/auth-token.ts
git commit -m "feat(web/auth): token store en localStorage"
```

## Tarea 12: `api.ts` — token desde el store + `login()`

**Files:** Modify `nodes/web/src/lib/api.ts`.

- [ ] **Step 1: Imports.** Reemplazar `import { auth } from '@/lib/firebase';` por `import { getToken } from '@/lib/auth-token';`.
- [ ] **Step 2: Los 3 sitios del token.** En `request()` (línea ~104), `uploadRequest()` (~144) y `downloadReimbursementsPdf()` (~795), reemplazar `const token = await auth.currentUser?.getIdToken();` por `const token = getToken();` (sincrónico).
- [ ] **Step 3: Añadir `login()`** (junto a `getMe`):
```ts
/** `POST /auth/login` — valida credenciales y devuelve nuestro JWT. */
export function login(email: string, password: string): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}
```
- [ ] **Step 4: Typecheck.** Run: `pnpm --filter "@gmt-platform/web" exec tsc --noEmit` → fallará mientras `auth-context.tsx`/`login.tsx`/`api.test.ts` sigan importando firebase (se arreglan en 13–15).
- [ ] **Step 5: Commit.**
```bash
git add nodes/web/src/lib/api.ts
git commit -m "feat(web/auth): api adjunta el JWT del store + POST /auth/login"
```

## Tarea 13: `auth-context.tsx` — sin Firebase

**Files:** Modify `nodes/web/src/context/auth-context.tsx`.

- [ ] **Step 1: Reescribir el provider.** Quitar todos los imports de firebase. Nuevo contenido del provider (mantiene la misma interfaz `{user, loading, login, logout, completeFirstLogin}`):
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { login as apiLogin, getMe, completeFirstLogin as apiCompleteFirstLogin } from '@/lib/api';
import { getToken, setToken, clearToken } from '@/lib/auth-token';
import type { AuthedUser } from '@/types/auth';

interface AuthContextValue {
  user: AuthedUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeFirstLogin: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: si hay token guardado, validarlo trayendo el perfil.
  useEffect(() => {
    let active = true;
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    getMe()
      .then((me) => { if (active) setUser(me); })
      .catch(() => { if (active) { clearToken(); setUser(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const { token } = await apiLogin(email, password);
    setToken(token);
    try {
      const me = await getMe();
      setUser(me);
    } catch (err) {
      clearToken();
      setUser(null);
      throw err;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    clearToken();
    setUser(null);
  }, []);

  // Tras fijar la clave, el MISMO token sigue válido (solo cambia el status); refrescamos el perfil.
  const completeFirstLogin = useCallback(async (newPassword: string): Promise<void> => {
    await apiCompleteFirstLogin(newPassword);
    const me = await getMe();
    setUser(me);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, completeFirstLogin }),
    [user, loading, login, logout, completeFirstLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
}
```
- [ ] **Step 2: Commit.**
```bash
git add nodes/web/src/context/auth-context.tsx
git commit -m "feat(web/auth): AuthProvider usa JWT propio (localStorage), sin Firebase"
```

## Tarea 14: `login.tsx` — errores por ApiError

**Files:** Modify `nodes/web/src/pages/login.tsx`.

- [ ] **Step 1: Reemplazar `authErrorMessage`.** Quitar `import { FirebaseError } from 'firebase/app';`, importar `import { ApiError } from '@/lib/api';`, y:
```tsx
function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Correo o contraseña incorrectos.';
    if (error.status === 0) return 'Sin conexión con el servidor.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}
```
El resto del componente (form, `handleSubmit` que llama `login()`) queda igual.
- [ ] **Step 2: Commit.**
```bash
git add nodes/web/src/pages/login.tsx
git commit -m "feat(web/auth): mensajes de login desde ApiError (sin FirebaseError)"
```

## Tarea 15: Borrar Firebase de la web

**Files:** Delete `nodes/web/src/lib/firebase.ts`; Modify `src/lib/api.test.ts`, `package.json`.

- [ ] **Step 1: Borrar.** `rm nodes/web/src/lib/firebase.ts` (Bash).
- [ ] **Step 2: `api.test.ts`.** Reemplazar el mock de firebase por el del token store:
```ts
const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({ getToken: mockGetToken, setToken: vi.fn(), clearToken: vi.fn() }));
import { getMe, deleteTask, uploadUserAvatar, ApiError } from '@/lib/api';
```
Ajustar cualquier `mockGetIdToken.mockResolvedValue(...)` a `mockGetToken.mockReturnValue('token-x')` (ya no es async).
- [ ] **Step 3: Quitar la dep firebase (PowerShell).** Run: `pnpm --filter "@gmt-platform/web" remove firebase`
- [ ] **Step 4: Verde web.** Run:
```
pnpm --filter "@gmt-platform/web" exec tsc --noEmit
pnpm --filter "@gmt-platform/web" test
```
Expected: tsc 0; tests verdes (grep previo: `git grep -n "firebase" nodes/web/src -i` → 0). Las `VITE_FIREBASE_*` quedan muertas (no se borran del .env, se ignoran).
- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "refactor(web/auth): elimina Firebase de la web (lib/firebase + dep) y ajusta test"
```

## Tarea 16: Verificación integral local + smoke del flujo demo

**Files:** ninguno (verificación).

- [ ] **Step 1: SV backend + web.**
```
pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
pnpm --filter "@gmt-platform/web" exec tsc --noEmit
pnpm --filter "@gmt-platform/backend-central" exec vitest run --exclude "**/fga-model.spec.ts"
pnpm --filter "@gmt-platform/web" test
pnpm lint
```
Expected: todo verde (excepto el spec de OpenFGA que necesita FGA vivo).
- [ ] **Step 2: Smoke UI (preview o pnpm dev).** Levantar backend+web, abrir el login, entrar como `admin@gmt.cl` / `AdminGmt2026` → dashboard. Ir a Usuarios → crear un usuario → aparece la clave provisoria. Cerrar sesión, entrar con el nuevo usuario + clave provisoria → pantalla de primer login → fijar clave → entra ACTIVE. Confirmar en consola/red que NO hay llamadas a Firebase.
- [ ] **Step 3: Commit (si hubo ajustes).** `git commit -am "test(auth): verificación integral del flujo propio"` (o skip si no hubo cambios).

## Tarea 17: Desplegar OpenFGA en Railway (datastore Postgres)

**Files:** ninguno (infra Railway, PowerShell; token en env-var). ⚠️ Parte más incierta; iterar leyendo logs.

- [ ] **Step 1: Datastore.** Añadir una Postgres dedicada para OpenFGA (aísla sus tablas de la app):
`railway status --json | Out-Null; railway add --database postgres --service openfga-db`
(Alternativa: reusar la Postgres existente con otra base; la dedicada es más limpia.)
- [ ] **Step 2: Servicio OpenFGA.** `railway add --service openfga --image openfga/openfga:latest --variables "OPENFGA_DATASTORE_ENGINE=postgres" --variables 'OPENFGA_DATASTORE_URI=${{openfga-db.DATABASE_URL}}' --variables "OPENFGA_HTTP_ADDR=0.0.0.0:8080"`
- [ ] **Step 3: migrate + run.** OpenFGA necesita `openfga migrate` (crea el esquema) antes de `openfga run`. Setear el **start command** del servicio a `sh -c "openfga migrate && openfga run"`. Si la imagen no trae `sh`, usar el "pre-deploy command" de Railway (`openfga migrate`) + command `run`. Verificar en logs `starting openfga service` y que escuche en 8080. Disparar deploy: `railway redeploy --service openfga --from-source -y` (o `up`).
- [ ] **Step 4: Dominio interno.** El backend llega a OpenFGA por la URL **interna** de Railway. Obtener el host interno (`openfga.railway.internal:8080`) → `FGA_API_URL=http://openfga.railway.internal:8080`.
- [ ] **Step 5: Verificar.** `railway logs --service openfga` → sin errores de migración; healthy.

## Tarea 18: Cablear secretos, sembrar Railway y publicar la demo

**Files:** ninguno (Railway + seed).

- [ ] **Step 1: `AUTH_JWT_SECRET` (genero uno fuerte).**
```
$secret = -join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
railway variables --service backend-central --set "AUTH_JWT_SECRET=$secret"
```
- [ ] **Step 2: `FGA_*` en el backend.** Correr el bootstrap contra la OpenFGA de Railway y setear los IDs (el script imprime STORE/MODEL id; en Railway NO escribe .env → se setean a mano):
  - Obtener la URL **pública** temporal de OpenFGA o usar `railway run --service backend-central` para ejecutar el bootstrap con `FGA_API_URL` interna. Ejecutar `fga:bootstrap`, leer del log `FGA_STORE_ID`/`FGA_MODEL_ID`.
  - `railway variables --service backend-central --set "FGA_API_URL=http://openfga.railway.internal:8080" --set "FGA_STORE_ID=<id>" --set "FGA_MODEL_ID=<id>"`.
- [ ] **Step 3: Push del código.** `git push origin feat/modulos-1-4:main` → dispara auto-deploy del backend y la web (o `railway redeploy --service backend-central --from-source -y` y `--service web`).
- [ ] **Step 4: Migrar + sembrar la Postgres de Railway.** El Dockerfile del backend ya corre `prisma migrate deploy` al iniciar (aplica `add_user_password_hash`). Sembrar catálogo + admin contra la DB de Railway: obtener `DATABASE_PUBLIC_URL` de la Postgres (proxy TCP) y correr local:
```
$env:DATABASE_URL = "<DATABASE_PUBLIC_URL de la Postgres de Railway>"
pnpm --filter "@gmt-platform/backend-central" exec tsx prisma/seed.ts
pnpm --filter "@gmt-platform/backend-central" exec tsx prisma/seed-admin.ts
```
(La `DATABASE_PUBLIC_URL` es el camino fiable desde local: `railway run` inyecta la `DATABASE_URL` **interna** `postgres.railway.internal`, que NO es alcanzable fuera de Railway. Si no hubiera proxy público, correr el seed como comando one-off dentro del contenedor del backend.)
- [ ] **Step 5: Verificar el login en producción.**
```
$BE = "backend-central-production-698d.up.railway.app"
$r = Invoke-RestMethod -Method Post -Uri ("https://" + $BE + "/auth/login") -ContentType application/json -Body (@{email='admin@gmt.cl';password='AdminGmt2026'} | ConvertTo-Json)
Invoke-RestMethod -Uri ("https://" + $BE + "/auth/me") -Headers @{ Authorization = "Bearer " + $r.token }
```
Expected: token emitido; `/auth/me` devuelve el admin ACTIVE con módulos.
- [ ] **Step 6: Entregar la URL.** Abrir **https://web-production-83ed62.up.railway.app**, entrar como `admin@gmt.cl` / `AdminGmt2026`, crear un usuario, verificar el flujo completo en vivo. Entregar URL + credencial al usuario.

---

## Self-Review (autor del plan)

**1. Cobertura del spec:**
- §3 modelo (passwordHash) → Tarea 1. §4.1 helpers + login → Tareas 2–4. §4.2 login → Tarea 4. §4.3 middleware → Tarea 5. §4.4 first-login/provisión/cambio-clave → Tareas 6, 8, 7. §4 quitar Firebase → Tarea 9. §5 web → Tareas 11–15. §6 seed un admin → Tarea 10 + 18.4. §7 deploy (AUTH_JWT_SECRET, OpenFGA, seed Railway) → Tareas 17–18. §9 tests → 2,3,4 + 9.7. Cubierto.
- OpenFGA (decisión del usuario de conservarlo) → Tareas 17–18. Marcado como la parte más incierta.

**2. Placeholders:** sin "TBD/etc."; cada paso trae el código o el comando exacto. Los específicos de Railway que dependen de valores runtime (STORE/MODEL id, DATABASE_PUBLIC_URL) están marcados como "leer del log/panel" — inevitable en infra, no es un placeholder de diseño.

**3. Consistencia de nombres:** helpers `hashPassword`/`verifyPassword`, `signToken`/`verifyToken`; store `getToken`/`setToken`/`clearToken`; `api.login` → `{token}`; `AuthedUser`/`AuthUser` sin cambios de forma; `req.authUser = {id,email}` preservado; se elimina `req.firebaseUid` de forma consistente (middleware, auth-request.types, auth.controller, profile.controller).

**Riesgos conocidos:** (a) OpenFGA en Railway (migrate+run, shell de la imagen, red interna) puede requerir iteración — Tarea 17 lo aísla. (b) Los specs que mockeaban Firebase deben reescribirse (Tarea 9.7) — esperado. (c) El admin trabaja sin FGA (grants GLOBAL), así que el flujo demo no queda bloqueado si OpenFGA tarda.
