# Fase 1b — Auth: login por username + emails institucional/personal

**Fecha:** 2026-07-10
**Spec autoridad:** `docs/superpowers/specs/2026-07-10-deploy-finanzas-roles-design.md` §4 (fuente de verdad del alcance).
**Rama:** `feat/finanzas-roles-deploy`.

## Goal

Migrar la identidad de `User` de **email** a **username** como credencial de login, agregando
`emailInstitucional` (único, opcional) y `emailPersonal` (opcional) con la regla **≥1 email**. El
`username` se autosugiere del prefijo del email institucional y es editable por el admin. El campo
`email` legacy **se conserva** (compat, siempre poblado). Login pasa a resolver por `username`;
creación de usuarios (form + CSV) suma username + emails; la clave provisoria se sigue mostrando en UI
(sin envío de email hasta Fase 3).

## Architecture

- **Backend** `nodes/backend-central` (NestJS + Prisma). Login inline en `AuthController` (no hay
  `auth.service`). Provisión de usuarios en `UsersService`. Migración Prisma **aditiva** con backfill
  SQL hand-editado (username = prefijo del email actual, deduplicado; email → emailInstitucional).
- **Frontend** `nodes/web` (React 19 + Vite + shadcn). `login.tsx`, `auth-context.tsx`, `lib/api.ts`,
  `new-user-dialog.tsx`, `import-users-dialog.tsx`, `credential-dialog.tsx`, `usuarios/index.tsx`.
- **Contratos** `packages/contracts` (`ProvisionedUser`, `UserMembership`) y sus espejos en
  `web/src/lib/api.ts` / `backend/.../users.types.ts`.

### Decisión de diseño D1 (retro-compatibilidad — LEER antes de ejecutar)

El spec §4.1 dice "conservar `email` (compat) relajando `@unique`/obligatoriedad". La lectura literal
(hacer `email` **nullable**) cascada un `string | null` sobre **~15 sitios** que hoy asumen `email:
string` (`UserRef`, `DirectoryEntry`, `overtime/reimbursements/projects/faenas/tasks/liquidations/
permission-requests` selects, `session.middleware`, `metrics` OTP). Como `web` y `web-dev` comparten
la misma api/BD (spec §Arquitectura → todo cambio debe ser **retrocompatible**), este plan realiza la
"relajación de obligatoriedad" **a nivel DTO/UX** y **conserva la columna `email` como `String @unique`
NOT NULL**, siempre poblada por el servicio (`email = emailInstitucional ?? emailPersonal`). Así:

- El admin **ya no ingresa `email`** directamente (lo deriva el backend) → obligatoriedad relajada en el flujo.
- Login deja de usar `email` → deja de ser la identidad.
- `email` sigue NOT NULL en BD → **cero ripple** de nullability en los 15 sitios.

Si el controlador/owner prefiere estrictamente la semántica nullable del spec, es un cambio de una
línea en el schema (`email String? @unique`) + resolver el ripple TS; se deja anotado pero **NO** es
el camino por defecto de este plan.

### Contrato compartido (NO redefinir)

El `permissions: string[]` en `GET /auth/me`, el hook `useHasPermission(perm)` y el guard de ruta son
propiedad del plan de **roles/gating (Fase 1a)** (spec §2/§3). Este plan **no** toca `/auth/me` salvo
lo mínimo, y **no** define permisos ni bundles.

## Tech Stack

Prisma 5 (migrate dev), class-validator, Vitest (backend + web), bcrypt (`common/password`), CSPRNG
(`common/provisional-password`), `@nestjs/throttler`.

---

## File Structure

**Crear:**
- `nodes/backend-central/src/modules/users/dto/at-least-one-email.validator.ts` — decorador
  class-validator `@AtLeastOneEmail` (regla ≥1 email para form + CSV).
- `nodes/backend-central/test/modules/users/dto/create-user.dto.spec.ts` — tests de validación del DTO
  (username formato/único-nivel-forma, ≥1 email).
- `nodes/backend-central/prisma/migrations/<timestamp>_add_user_username_emails/migration.sql`
  (generado y hand-editado en Task 2).

**Modificar (backend):**
- `prisma/schema.prisma` — `User`: `username @unique`, `emailInstitucional @unique?`, `emailPersonal?`.
- `src/auth/dto/login.dto.ts` — `email @IsEmail` → `username @IsString`.
- `src/auth/auth.controller.ts` — `login()` resuelve `where: { username }`; mensaje 401.
- `src/modules/users/dto/create-user.dto.ts` — quita `email`, agrega `username` + emails + `@AtLeastOneEmail`.
- `src/modules/users/users.service.ts` — unicidad username, deriva `email`, persiste campos, P2002 por target, proyecciones.
- `src/modules/users/users.types.ts` — `UserListItem` suma username/emails; `ImportCreatedRow` suma username.
- `prisma/seed-admin.core.ts`, `prisma/seed-auth-dev.ts`, `prisma/seed-capstone.ts` — username/emailInstitucional en cada `user.create/upsert`.

**Modificar (contratos):**
- `packages/contracts/src/index.ts` — `ProvisionedUser` suma username/emails.

**Modificar (frontend):**
- `src/lib/api.ts` — `login(username,...)`; `CreateUserDto`/`UserListItem`/`CreateUserResponse`/`ImportedUser` suman campos.
- `src/context/auth-context.tsx` — `login(username, password)`.
- `src/pages/login.tsx` — campo "Usuario".
- `src/pages/usuarios/new-user-dialog.tsx` — username (autosugerido) + emails.
- `src/pages/usuarios/import-users-dialog.tsx` — columnas CSV username/emails + autosugerencia.
- `src/pages/usuarios/credential-dialog.tsx` — muestra username junto al password.
- `src/pages/usuarios/index.tsx` — columna/credencial por username.

**Tests a actualizar:**
- `test/auth/login.spec.ts` — `{ username }` en vez de `{ email }`.
- `test/modules/users.service.spec.ts` — DTOs con username/emails + conflicto de username.

---

## FASE A — Schema, migración y seeds

### Task 1 — Agregar campos al modelo `User` en el schema

**Files:**
- modify: `nodes/backend-central/prisma/schema.prisma`

Pasos:
- [ ] En el bloque `model User` (línea 20, tras `email String @unique`), insertar los tres campos.
  Reemplazar la línea `  email                  String                    @unique` por:

```prisma
  email                  String                    @unique // compat (§4.1 D1): siempre poblado = emailInstitucional ?? emailPersonal
  username               String                    @unique // login por username (default = prefijo del email institucional)
  emailInstitucional     String?                   @unique // uno de {emailInstitucional, emailPersonal} obligatorio
  emailPersonal          String?
```

- [ ] Verificar el formato del schema:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx prisma format
```

  Output esperado: `Formatted prisma/schema.prisma in ...ms 🚀` sin errores de validación.

- [ ] Commit:

```bash
git add nodes/backend-central/prisma/schema.prisma
git commit -m "feat(auth): agrega username/emailInstitucional/emailPersonal a User (schema)"
```

### Task 2 — Migración aditiva + backfill (username deduplicado, email→institucional)

**Files:**
- create: `nodes/backend-central/prisma/migrations/<timestamp>_add_user_username_emails/migration.sql`

Pasos:
- [ ] Generar la migración SIN aplicarla (para poder hand-editar el SQL de backfill):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx prisma migrate dev --name add_user_username_emails --create-only
```

  Output esperado: crea `prisma/migrations/<timestamp>_add_user_username_emails/migration.sql`
  (con `ADD COLUMN "username" TEXT NOT NULL` + índices únicos). **No** la aplica todavía.

- [ ] Reemplazar TODO el contenido del `migration.sql` generado por este SQL (agrega columnas como
  nullable, backfilea, deduplica y recién entonces impone NOT NULL + únicos):

```sql
-- AlterTable: columnas nuevas como NULLABLE para poder backfilear filas existentes
ALTER TABLE "User" ADD COLUMN     "username" TEXT;
ALTER TABLE "User" ADD COLUMN     "emailInstitucional" TEXT;
ALTER TABLE "User" ADD COLUMN     "emailPersonal" TEXT;

-- Backfill: el email actual pasa a institucional (§4.1)
UPDATE "User" SET "emailInstitucional" = "email" WHERE "emailInstitucional" IS NULL;

-- Backfill: username = prefijo del email, deduplicado con sufijo numérico determinístico.
-- Dos emails con el mismo prefijo (p.ej. operador@capstone.cl / operador@albemarle.cl) → operador, operador1.
WITH ranked AS (
  SELECT
    "id",
    lower(split_part("email", '@', 1)) AS base,
    row_number() OVER (
      PARTITION BY lower(split_part("email", '@', 1))
      ORDER BY "createdAt", "id"
    ) AS rn
  FROM "User"
)
UPDATE "User" u
SET "username" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || (r.rn - 1)::text END
FROM ranked r
WHERE u."id" = r."id";

-- Ahora sí: NOT NULL + índices únicos
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_emailInstitucional_key" ON "User"("emailInstitucional");
```

  Nota: el sufijo numérico podría colisionar en teoría con un prefijo real ya existente
  (`ana`,`ana1` + un email `ana1@…`); en el dataset de seeds actual no ocurre. Si el `CREATE UNIQUE
  INDEX` fallara por colisión, editar manualmente el username conflictivo antes de re-aplicar.

- [ ] Aplicar la migración editada:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx prisma migrate dev
```

  Output esperado: `The following migration(s) have been applied` con
  `<timestamp>_add_user_username_emails` y `✔ Generated Prisma Client`. Si el puerto 5432 no responde,
  despertar WSL (ver CLAUDE.md) y reintentar.

- [ ] Verificar el backfill (no debe haber usernames nulos ni duplicados):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx prisma db execute --stdin <<'SQL'
SELECT count(*) AS nulos FROM "User" WHERE "username" IS NULL;
SELECT "username", count(*) FROM "User" GROUP BY "username" HAVING count(*) > 1;
SQL
```

  Output esperado: `nulos = 0` y cero filas duplicadas.

- [ ] Commit:

```bash
git add nodes/backend-central/prisma/migrations
git commit -m "feat(auth): migración aditiva username/emails + backfill (email->institucional, username=prefijo)"
```

### Task 3 — Patch de los seeds que crean usuarios (username obligatorio)

`username` NOT NULL rompe la compilación/ejecución de todo `user.create/upsert` que lo omita. Sitios
(grep confirmado): `seed-admin.core.ts`, `seed-auth-dev.ts`, `seed-capstone.ts`.

**Files:**
- modify: `nodes/backend-central/prisma/seed-admin.core.ts`
- modify: `nodes/backend-central/prisma/seed-auth-dev.ts`
- modify: `nodes/backend-central/prisma/seed-capstone.ts`

Pasos:
- [ ] `seed-admin.core.ts`: agregar `username` a la constante `ADMIN` y a los dos caminos de escritura.
  Reemplazar el bloque `export const ADMIN = {...}` (líneas 20-25) por:

```ts
export const ADMIN = {
  email: 'admin@gmt.cl',
  username: 'admin',
  firstName: 'Admin',
  lastName: 'GMT',
  roleKey: 'org_admin',
} as const;
```

  En `ensurePostgresUser`, en el `prisma.user.upsert` (bloque `create:` línea ~104-111), agregar
  `username` y `emailInstitucional`:

```ts
    create: {
      email: ADMIN.email,
      username: ADMIN.username,
      emailInstitucional: ADMIN.email,
      firstName: ADMIN.firstName,
      lastName: ADMIN.lastName,
      status: statusValue,
      isClientUser: false,
      passwordHash,
    },
```

- [ ] `seed-auth-dev.ts`: agregar `username` al `TEST_USER` y al `create`. Reemplazar la const
  `TEST_USER` (líneas 19-25) por:

```ts
const TEST_USER = {
  email: 'colaborador@gmt.cl',
  username: 'colaborador',
  emailInstitucional: 'colaborador@gmt.cl',
  firstName: 'Colaborador',
  lastName: 'Prueba',
  status: UserStatus.PENDING_FIRST_LOGIN,
  isClientUser: false,
} as const;
```

  El `create: { ...TEST_USER }` (línea 36) ya propaga los campos nuevos: sin más cambios.

- [ ] `seed-capstone.ts`: derivar username del prefijo del email en el `upsert` de usuarios MVP
  (líneas 362-373). Reemplazar el bloque `create:` por:

```ts
      create: {
        email: u.email,
        username: u.email.split('@')[0]?.toLowerCase() ?? u.email,
        emailInstitucional: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        status: UserStatus.ACTIVE,
        isClientUser: u.roleKey === 'ito',
      },
```

  Nota: los prefijos de capstone/albemarle colisionan (`operador@capstone.cl` vs
  `operador@albemarle.cl`). Como `seed-capstone` es data de MVP y no corre en el flujo Fase 1b (se
  usará el seed de mockups de Fase 1b, spec §6), es aceptable que el 2.º upsert falle por username
  duplicado; si se necesita correr, sufijar manualmente en la lista `USERS`. Documentar en el commit.

- [ ] Typecheck del backend (compila sin errores de campo faltante):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx tsc --noEmit
```

  Output esperado: sin errores (exit 0).

- [ ] Commit:

```bash
git add nodes/backend-central/prisma/seed-admin.core.ts nodes/backend-central/prisma/seed-auth-dev.ts nodes/backend-central/prisma/seed-capstone.ts
git commit -m "feat(auth): seeds pueblan username/emailInstitucional (username NOT NULL)"
```

---

## FASE B — Login por username (TDD)

### Task 4 — Test rojo: login resuelve por username

**Files:**
- modify: `nodes/backend-central/test/auth/login.spec.ts`

Pasos:
- [ ] Reemplazar las 3 llamadas `ctrl.login({ email: ..., password })` por `{ username: ..., password }`
  y renombrar la aserción del mock. El nuevo archivo:

```ts
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from '../../src/auth/auth.controller';
import { hashPassword } from '../../src/common/password';

beforeAll(() => { process.env.AUTH_JWT_SECRET = 'test-secret-para-vitest-32bytes-min'; });

function makeController(user: { id: string; passwordHash: string | null } | null) {
  const findUnique = vi.fn().mockResolvedValue(user);
  const prisma = { user: { findUnique } };
  return { ctrl: new AuthController(prisma as never, undefined as never, undefined as never), findUnique };
}

describe('AuthController.login', () => {
  it('devuelve un token con credenciales válidas y resuelve por username', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl, findUnique } = makeController({ id: 'u1', passwordHash: hash });
    const res = await ctrl.login({ username: 'jperez', password: 'Secreta123' });
    expect(typeof res.token).toBe('string');
    expect(res.token.length).toBeGreaterThan(10);
    expect(findUnique).toHaveBeenCalledWith({
      where: { username: 'jperez' },
      select: { id: true, passwordHash: true },
    });
  });
  it('401 si la contraseña es incorrecta', async () => {
    const hash = await hashPassword('Secreta123');
    const { ctrl } = makeController({ id: 'u1', passwordHash: hash });
    await expect(ctrl.login({ username: 'jperez', password: 'mala' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('401 si el usuario no existe', async () => {
    const { ctrl } = makeController(null);
    await expect(ctrl.login({ username: 'nadie', password: 'lo-que-sea' })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
```

- [ ] Correr el test (debe fallar en rojo — `LoginDto` aún tiene `email`, controller busca por email):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx vitest run test/auth/login.spec.ts
```

  Output esperado: FAIL (la aserción `where: { username: ... }` no matchea `where: { email: ... }`).

### Task 5 — Verde: `LoginDto` y `AuthController.login` por username

**Files:**
- modify: `nodes/backend-central/src/auth/dto/login.dto.ts`
- modify: `nodes/backend-central/src/auth/auth.controller.ts`

Pasos:
- [ ] Reemplazar `login.dto.ts` completo por:

```ts
import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'Ingresa tu usuario.' })
  username!: string;

  @IsString()
  @MinLength(1, { message: 'Ingresa tu contraseña.' })
  password!: string;
}
```

- [ ] En `auth.controller.ts`, en `login()` (líneas 85-95), cambiar el `where` y el mensaje 401.
  Reemplazar:

```ts
    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, passwordHash: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }
```

  por:

```ts
    const user = await this.prisma.user.findUnique({
      where: { username: body.username },
      select: { id: true, passwordHash: true },
    });
    const ok = user?.passwordHash ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !ok) {
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    }
```

- [ ] Correr los tests de auth (deben pasar):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx vitest run test/auth/
```

  Output esperado: PASS de `login.spec.ts`, `auth.controller.spec.ts` (no toca login), `throttle-login.spec.ts`
  (usa `AuthController.prototype.login` sin body → sin cambios).

- [ ] Commit:

```bash
git add nodes/backend-central/src/auth/dto/login.dto.ts nodes/backend-central/src/auth/auth.controller.ts nodes/backend-central/test/auth/login.spec.ts
git commit -m "feat(auth): login resuelve por username (LoginDto + AuthController)"
```

### Task 6 — Front: login por usuario (api + context + pantalla)

**Files:**
- modify: `nodes/web/src/lib/api.ts`
- modify: `nodes/web/src/context/auth-context.tsx`
- modify: `nodes/web/src/pages/login.tsx`

Pasos:
- [ ] `api.ts` — `login()` (líneas 219-224) envía `{ username }`. Reemplazar por:

```ts
/** `POST /auth/login` — valida credenciales (username) y devuelve nuestro JWT. */
export function login(username: string, password: string): Promise<{ token: string }> {
  return request<{ token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}
```

- [ ] `auth-context.tsx` — renombrar el parámetro en la interfaz y el callback. En `AuthContextValue`
  (línea 9): `login: (username: string, password: string) => Promise<void>;`. En el `useCallback`
  (líneas 38-49):

```ts
  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const { token } = await apiLogin(username, password);
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
```

- [ ] `login.tsx` — cambiar estado, validación, textos y el input a "Usuario". Cambios puntuales:
  - Estado (línea 33): `const [username, setUsername] = useState('');`
  - `authErrorMessage` (línea 19): `if (error.status === 401) return 'Usuario o contraseña incorrectos.';`
  - `handleSubmit` (líneas 42-50): reemplazar por:

```ts
    if (!username.trim() || !password) {
      setError('Ingresa tu usuario y contraseña.');
      return;
    }

    setSubmitting(true);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
```

  - `CardDescription` (línea 68): `Accede con tu usuario.`
  - El bloque del input de email (líneas 72-86) por:

```tsx
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-username">Usuario</Label>
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  placeholder="tu.usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  disabled={submitting}
                  autoFocus
                />
              </div>
```

- [ ] Typecheck web:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/web && npx tsc --noEmit
```

  Output esperado: exit 0.

- [ ] Commit:

```bash
git add nodes/web/src/lib/api.ts nodes/web/src/context/auth-context.tsx nodes/web/src/pages/login.tsx
git commit -m "feat(auth): pantalla de login por usuario (web)"
```

---

## FASE C — Creación de usuarios con username + emails (TDD)

### Task 7 — Contratos: `ProvisionedUser` suma username/emails

**Files:**
- modify: `packages/contracts/src/index.ts`

Pasos:
- [ ] Reemplazar `ProvisionedUser` (líneas 48-55) por:

```ts
/** Vista pública de un usuario provisionado (respuesta de creación, §1.1). */
export interface ProvisionedUser {
  id: string;
  email: string;
  username: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  firstName: string;
  lastName: string;
  status: UserStatus;
  roleKeys: RoleKey[];
}
```

- [ ] Build de contracts (lo consume back y front):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/packages/contracts && npm run build
```

  Output esperado: build ok (genera `dist/`). Si no hay script `build`, `npx tsc -p tsconfig.json`.

- [ ] Commit:

```bash
git add packages/contracts/src/index.ts
git commit -m "feat(auth): ProvisionedUser suma username/emailInstitucional/emailPersonal (contracts)"
```

### Task 8 — Decorador `@AtLeastOneEmail` + `CreateUserDto`

**Files:**
- create: `nodes/backend-central/src/modules/users/dto/at-least-one-email.validator.ts`
- modify: `nodes/backend-central/src/modules/users/dto/create-user.dto.ts`

Pasos:
- [ ] Crear el validador:

```ts
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Regla de negocio §4.1: un usuario debe tener AL MENOS uno de {emailInstitucional, emailPersonal}.
 * Se aplica sobre una propiedad SIEMPRE presente (username) para que no la corte un `@IsOptional`
 * de los propios campos email. Sirve al form individual y al lote CSV (ambos validan el mismo DTO).
 */
export function AtLeastOneEmail(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'atLeastOneEmail',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(_value: unknown, args: ValidationArguments): boolean {
          const o = args.object as { emailInstitucional?: string; emailPersonal?: string };
          return Boolean(o.emailInstitucional?.trim() || o.emailPersonal?.trim());
        },
        defaultMessage(): string {
          return 'Debe indicar al menos un email (institucional o personal).';
        },
      },
    });
  };
}
```

- [ ] Reemplazar `create-user.dto.ts` completo por (quita `email`, agrega username + emails):

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { RoleKey } from '../../../common/role-keys';
import { AtLeastOneEmail } from './at-least-one-email.validator';

/** Tope defensivo de roles por usuario en un solo request (no ligado a ROLE_KEYS). */
const MAX_ROLE_KEYS_PER_REQUEST = 20;

/** username: 3-30 chars, minúsculas/dígitos/punto/guion/guion bajo (default = prefijo del email institucional). */
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/**
 * Body de `POST /users` (§1.1, §4.3). El admin provisiona un colaborador o cliente.
 * Identidad de login = `username` (único). Debe traer ≥1 email (institucional/personal); el `email`
 * legacy lo deriva `UsersService` (D1). Validación dura de `roleKeys` contra `Role` la hace el service.
 */
export class CreateUserDto {
  @IsString()
  @MinLength(1, { message: 'El nombre es obligatorio.' })
  @MaxLength(80)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondName?: string;

  @IsString()
  @MinLength(1, { message: 'El apellido es obligatorio.' })
  @MaxLength(80)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondLastName?: string;

  @IsString()
  @Matches(USERNAME_RE, {
    message: 'El usuario debe tener 3-30 caracteres: minúsculas, dígitos, punto, guion o guion bajo.',
  })
  @AtLeastOneEmail()
  username!: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email institucional no es válido.' })
  emailInstitucional?: string;

  @IsOptional()
  @IsEmail({}, { message: 'El email personal no es válido.' })
  emailPersonal?: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Debe asignar al menos un rol.' })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROLE_KEYS_PER_REQUEST)
  @IsString({ each: true, message: 'Cada rol debe ser un texto no vacío.' })
  @MinLength(1, { each: true, message: 'Cada rol debe ser un texto no vacío.' })
  roleKeys!: RoleKey[];

  @IsOptional()
  @IsBoolean()
  isClientUser?: boolean;
}
```

- [ ] Commit:

```bash
git add nodes/backend-central/src/modules/users/dto/at-least-one-email.validator.ts nodes/backend-central/src/modules/users/dto/create-user.dto.ts
git commit -m "feat(auth): CreateUserDto con username + emails + @AtLeastOneEmail"
```

### Task 9 — Test de validación del DTO (username / ≥1 email)

**Files:**
- create: `nodes/backend-central/test/modules/users/dto/create-user.dto.spec.ts`

Pasos:
- [ ] Crear el test:

```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from '../../../../src/modules/users/dto/create-user.dto';

function make(overrides: Record<string, unknown>) {
  return plainToInstance(CreateUserDto, {
    firstName: 'Ana',
    lastName: 'Pérez',
    username: 'ana.perez',
    emailInstitucional: 'ana.perez@gmt.cl',
    roleKeys: ['viewer'],
    ...overrides,
  });
}

async function keys(dto: object): Promise<string[]> {
  const failures = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return failures.map((f) => f.property);
}

describe('CreateUserDto', () => {
  it('acepta username válido + email institucional', async () => {
    expect(await keys(make({}))).toEqual([]);
  });
  it('acepta solo email personal (≥1 email)', async () => {
    expect(await keys(make({ emailInstitucional: undefined, emailPersonal: 'ana@gmail.com' }))).toEqual([]);
  });
  it('rechaza cuando faltan ambos emails', async () => {
    expect(await keys(make({ emailInstitucional: undefined, emailPersonal: undefined }))).toContain('username');
  });
  it('rechaza username con mayúsculas/espacios', async () => {
    expect(await keys(make({ username: 'Ana Perez' }))).toContain('username');
  });
  it('rechaza username < 3 chars', async () => {
    expect(await keys(make({ username: 'ab' }))).toContain('username');
  });
  it('rechaza email institucional inválido', async () => {
    expect(await keys(make({ emailInstitucional: 'no-es-email' }))).toContain('emailInstitucional');
  });
});
```

- [ ] Correr:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx vitest run test/modules/users/dto/create-user.dto.spec.ts
```

  Output esperado: 6 passed.

- [ ] Commit:

```bash
git add nodes/backend-central/test/modules/users/dto/create-user.dto.spec.ts
git commit -m "test(auth): validación de CreateUserDto (username + >=1 email)"
```

### Task 10 — `UsersService`: unicidad de username, derivar email, persistir, P2002

**Files:**
- modify: `nodes/backend-central/src/modules/users/users.service.ts`
- modify: `nodes/backend-central/src/modules/users/users.types.ts`

Pasos:
- [ ] `users.types.ts` — `UserListItem` (líneas 36-48) suma username/emails; `ImportCreatedRow`
  (líneas 16-20) suma username. Reemplazar ambos:

```ts
/** Fila creada con éxito en una importación de lote. */
export interface ImportCreatedRow {
  id: string;
  email: string;
  username: string;
  provisionalPassword: string;
}
```

```ts
/** Item de lista / detalle de usuario (datos para `RoleScopedList`, §5). Sin campos sensibles. */
export interface UserListItem {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  username: string;
  emailInstitucional: string | null;
  emailPersonal: string | null;
  status: string;
  isClientUser: boolean;
  roleKeys: RoleKey[];
  memberships: UserMembership[];
  createdAt: string;
}
```

- [ ] `users.service.ts` — cambios:

  (a) En `create()` (líneas 74-104), reemplazar la validación de email por la de identificadores y
  pasar el email derivado a la persistencia. Reemplazar las líneas 75-83:

```ts
    const roleKeys = await this.validateRoleKeys(dto.roleKeys);
    const email = (dto.emailInstitucional ?? dto.emailPersonal ?? '').trim();
    await this.assertUsernameFree(dto.username);
    await this.assertEmailFree(email);

    const provisionalPassword = generateProvisionalPassword();
    const passwordHash = await hashPassword(provisionalPassword);

    let user: UserWithMemberships;
    try {
      user = await this.persistUserWithMemberships(dto, roleKeys, passwordHash, email);
    } catch (error: unknown) {
      const conflict = this.uniqueConflictField(error);
      if (conflict) {
        throw new ConflictException(conflict);
      }
      throw error;
    }
```

  (b) En `importBatch()` (líneas 124-129), incluir `username` en la fila creada:

```ts
        const result = await this.create(validation.dto);
        created.push({
          id: result.user.id,
          email: result.user.email,
          username: result.user.username,
          provisionalPassword: result.provisionalPassword,
        });
```

  (c) Agregar `assertUsernameFree` junto a `assertEmailFree` (tras la línea 492):

```ts
  /** 409 si el username ya está en Postgres (pre-chequeo; el @unique cubre la carrera). */
  private async assertUsernameFree(username: string): Promise<void> {
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new ConflictException(`Ya existe un usuario con el usuario "${username}".`);
    }
  }
```

  (d) Reemplazar `persistUserWithMemberships` (líneas 501-530) para recibir `email` y setear los campos:

```ts
  /** Crea User + Memberships en una transacción Postgres (espejo §4.1, sin FGA aquí). */
  private async persistUserWithMemberships(
    dto: CreateUserDto,
    roleKeys: RoleKey[],
    passwordHash: string,
    email: string,
  ): Promise<UserWithMemberships> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: dto.firstName,
          secondName: dto.secondName ?? null,
          lastName: dto.lastName,
          secondLastName: dto.secondLastName ?? null,
          email, // compat (D1): = emailInstitucional ?? emailPersonal
          username: dto.username,
          emailInstitucional: dto.emailInstitucional ?? null,
          emailPersonal: dto.emailPersonal ?? null,
          passwordHash,
          isClientUser: dto.isClientUser ?? false,
          status: 'PENDING_FIRST_LOGIN',
          memberships: {
            create: roleKeys.map((roleKey) => ({
              roleKey,
              scopeType: 'ORGANIZATION' as const,
              scopeId: ORG_ID,
            })),
          },
        },
        include: { memberships: true },
      });
      return user;
    });
  }
```

  (e) Reemplazar el helper `isUniqueEmailViolation` (líneas 623-631) por uno que mapee el target de
  P2002 a un mensaje (username / email / institucional):

```ts
  /** Si el error es P2002 (unicidad), devuelve un mensaje por campo; si no, null. */
  private uniqueConflictField(error: unknown): string | null {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      (error as { code?: unknown }).code !== 'P2002'
    ) {
      return null;
    }
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    if (fields.some((f) => f.includes('username'))) return 'Ya existe un usuario con ese nombre de usuario.';
    if (fields.some((f) => f.includes('emailInstitucional'))) return 'Ya existe un usuario con ese email institucional.';
    return 'Ya existe un usuario con ese email.';
  }
```

  (f) Actualizar `toProvisionedUser` (líneas 593-605) y `toListItem` (líneas 607-621) para exponer
  los campos nuevos:

```ts
  private toProvisionedUser(user: User, roleKeys: RoleKey[]): CreateUserResponse['user'] {
    return {
      id: user.id,
      email: user.email,
      username: user.username,
      emailInstitucional: user.emailInstitucional,
      emailPersonal: user.emailPersonal,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      roleKeys,
    };
  }

  private toListItem(user: UserWithMemberships): UserListItem {
    return {
      id: user.id,
      firstName: user.firstName,
      secondName: user.secondName,
      lastName: user.lastName,
      secondLastName: user.secondLastName,
      email: user.email,
      username: user.username,
      emailInstitucional: user.emailInstitucional,
      emailPersonal: user.emailPersonal,
      status: user.status,
      isClientUser: user.isClientUser,
      roleKeys: this.collectRoleKeys(user.memberships.map((m) => m.roleKey)),
      memberships: user.memberships.map((m) => this.toUserMembership(m)),
      createdAt: user.createdAt.toISOString(),
    };
  }
```

  (g) `list()` (líneas 162-184): agregar `username` al `OR` de búsqueda. Añadir dentro del array
  `OR` (línea ~172): `{ username: { contains: trimmed, mode: 'insensitive' } },`.

  (h) `extractEmail` helper (líneas 679-685): si no hay `email`, usar `emailInstitucional`/
  `emailPersonal`/`username` para etiquetar errores de importación. Reemplazar por:

```ts
/** Etiqueta para errores de import: email institucional/personal/legacy o username (`''` si nada). */
function extractEmail(row: unknown): string {
  if (typeof row === 'object' && row !== null) {
    const r = row as Record<string, unknown>;
    for (const key of ['emailInstitucional', 'emailPersonal', 'email', 'username']) {
      const value = r[key];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  return '';
}
```

- [ ] Typecheck backend:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx tsc --noEmit
```

  Output esperado: exit 0 (si falla en `users.service.spec.ts` por tipos de mock, se corrige en Task 11).

- [ ] Commit:

```bash
git add nodes/backend-central/src/modules/users/users.service.ts nodes/backend-central/src/modules/users/users.types.ts
git commit -m "feat(auth): UsersService persiste username/emails, deriva email y mapea P2002"
```

### Task 11 — Actualizar `users.service.spec.ts` (mocks con username/emails + conflicto username)

**Files:**
- modify: `nodes/backend-central/test/modules/users.service.spec.ts`

Pasos:
- [ ] Leer el archivo completo primero (para adaptar todos los `FakeUserRow`/DTOs). Cambios mínimos requeridos:
  - `FakeUserRow` (líneas 16-28): agregar `username: string; emailInstitucional: string | null; emailPersonal: string | null;`.
  - En el mock `userCreate` (líneas 49-...): reflejar en la `row` devuelta los nuevos campos
    (`username: args.data.username`, `emailInstitucional: args.data.emailInstitucional ?? null`,
    `emailPersonal: args.data.emailPersonal ?? null`), y ampliar el tipo del `args.data` con esos campos.
  - En `PrismaState` reemplazar `emailExists: boolean` por dos flags o generalizar: agregar
    `usernameExists: boolean`. El mock de `user.findUnique` debe distinguir la consulta por
    `where.username` (→ `usernameExists`) de la de `where.email` (→ `emailExists`).
  - Todo DTO de entrada de los tests (`create({...})`) debe incluir `username` + `emailInstitucional`
    (o `emailPersonal`). Ejemplo de DTO base a usar en los tests:

```ts
const BASE_DTO = {
  firstName: 'Ana',
  lastName: 'Pérez',
  username: 'ana.perez',
  emailInstitucional: 'ana.perez@gmt.cl',
  roleKeys: ['viewer'],
} as unknown as CreateUserDto;
```

  - Agregar un test nuevo de conflicto de username (P2002 con `meta.target: ['username']` → 409):

```ts
  it('lanza 409 si el username ya existe (P2002 username)', async () => {
    const { service } = buildService({ ...defaultState, usernameExists: true });
    await expect(service.create(BASE_DTO)).rejects.toBeInstanceOf(ConflictException);
  });
```

  (Adaptar `buildService`/`defaultState` a los helpers reales del archivo; los nombres exactos se
  confirman al leerlo.)

- [ ] Correr la suite de users:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx vitest run test/modules/users.service.spec.ts test/modules/users.controller.spec.ts
```

  Output esperado: PASS.

- [ ] Commit:

```bash
git add nodes/backend-central/test/modules/users.service.spec.ts
git commit -m "test(auth): users.service cubre username/emails y conflicto de username"
```

### Task 12 — Front `api.ts`: tipos de creación/lista con username/emails

**Files:**
- modify: `nodes/web/src/lib/api.ts`

Pasos:
- [ ] `CreateUserDto` (líneas 247-255) — quitar `email`, agregar username + emails:

```ts
/** DTO para crear un usuario (contrato con `POST /users`). */
export interface CreateUserDto {
  firstName: string;
  secondName?: string;
  lastName: string;
  secondLastName?: string;
  username: string;
  emailInstitucional?: string;
  emailPersonal?: string;
  roleKeys: RoleKey[];
  isClientUser?: boolean;
}
```

- [ ] `UserListItem` (líneas 258-271) — agregar `username`, `emailInstitucional`, `emailPersonal`
  (junto a `email`).
- [ ] `CreateUserResponse.user` (líneas 274-283) — agregar `username`, `emailInstitucional: string | null`,
  `emailPersonal: string | null`.
- [ ] `ImportedUser` (líneas 287-291) — agregar `username: string`.
- [ ] Typecheck web (fallará hasta actualizar los componentes de Tasks 13-15; se corre igualmente para ver el alcance):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/web && npx tsc --noEmit
```

  Output esperado: errores SOLO en `new-user-dialog.tsx` / `import-users-dialog.tsx` / `credential-dialog.tsx` /
  `usuarios/index.tsx` (los que se arreglan a continuación).

- [ ] Commit:

```bash
git add nodes/web/src/lib/api.ts
git commit -m "feat(auth): tipos web de creación/lista con username/emails"
```

### Task 13 — `new-user-dialog.tsx`: username autosugerido + emails

**Files:**
- modify: `nodes/web/src/pages/usuarios/new-user-dialog.tsx`

Pasos:
- [ ] `FormState` (líneas 11-19) y `EMPTY` (21-29): quitar `email`, agregar
  `username`, `emailInstitucional`, `emailPersonal`, y un flag `usernameTouched` para la autosugerencia.

```ts
interface FormState {
  firstName: string;
  secondName: string;
  lastName: string;
  secondLastName: string;
  username: string;
  emailInstitucional: string;
  emailPersonal: string;
  usernameTouched: boolean;
  roleKeys: RoleKey[];
  isClientUser: boolean;
}

const EMPTY: FormState = {
  firstName: '',
  secondName: '',
  lastName: '',
  secondLastName: '',
  username: '',
  emailInstitucional: '',
  emailPersonal: '',
  usernameTouched: false,
  roleKeys: [],
  isClientUser: false,
};

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** Deriva un username sugerido del prefijo del email institucional (minúsculas, chars válidos). */
function suggestUsername(email: string): string {
  return (email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30);
}
```

- [ ] `toDto` (líneas 34-44) — mapear los campos nuevos:

```ts
function toDto(form: FormState): CreateUserDto {
  return {
    firstName: form.firstName.trim(),
    secondName: form.secondName.trim() || undefined,
    lastName: form.lastName.trim(),
    secondLastName: form.secondLastName.trim() || undefined,
    username: form.username.trim(),
    emailInstitucional: form.emailInstitucional.trim() || undefined,
    emailPersonal: form.emailPersonal.trim() || undefined,
    roleKeys: form.roleKeys,
    isClientUser: form.isClientUser,
  };
}
```

- [ ] `localError` (líneas 107-113) — validar username + ≥1 email:

```ts
  function localError(): string | null {
    if (form.firstName.trim().length === 0) return 'El nombre es obligatorio.';
    if (form.lastName.trim().length === 0) return 'El apellido es obligatorio.';
    if (!USERNAME_RE.test(form.username.trim())) return 'El usuario debe tener 3-30 caracteres (minúsculas, dígitos, . _ -).';
    if (!form.emailInstitucional.trim() && !form.emailPersonal.trim()) return 'Indica al menos un email (institucional o personal).';
    if (form.emailInstitucional.trim() && !EMAIL_RE.test(form.emailInstitucional.trim())) return 'Email institucional inválido.';
    if (form.emailPersonal.trim() && !EMAIL_RE.test(form.emailPersonal.trim())) return 'Email personal inválido.';
    if (form.roleKeys.length === 0) return 'Selecciona al menos un rol.';
    return null;
  }
```

- [ ] Reemplazar el campo de correo (líneas 209-216) por institucional (con autosugerencia de
  username), username editable y email personal:

```tsx
          <Field label="Email institucional">
            <Input
              type="email"
              value={form.emailInstitucional}
              onChange={(e) => {
                const value = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  emailInstitucional: value,
                  username: prev.usernameTouched ? prev.username : suggestUsername(value),
                }));
              }}
              autoComplete="off"
            />
          </Field>

          <Field label="Usuario (login)" required>
            <Input
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value, usernameTouched: true }))}
              autoComplete="off"
              placeholder="ej: ana.perez"
            />
          </Field>

          <Field label="Email personal">
            <Input
              type="email"
              value={form.emailPersonal}
              onChange={(e) => update('emailPersonal', e.target.value)}
              autoComplete="off"
            />
          </Field>
```

- [ ] Typecheck web:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/web && npx tsc --noEmit
```

  Output esperado: desaparecen los errores de `new-user-dialog.tsx`.

- [ ] Commit:

```bash
git add nodes/web/src/pages/usuarios/new-user-dialog.tsx
git commit -m "feat(auth): alta de usuario con username autosugerido + emails (web)"
```

### Task 14 — `import-users-dialog.tsx`: columnas CSV username/emails

**Files:**
- modify: `nodes/web/src/pages/usuarios/import-users-dialog.tsx`

Pasos:
- [ ] `TEMPLATE_COLUMNS` (líneas 8-15): reemplazar la columna `email` por `username`,
  `emailInstitucional`, `emailPersonal`:

```ts
const TEMPLATE_COLUMNS: ImportTemplateColumn[] = [
  { key: 'firstName', label: 'Primer nombre', example: 'Ana' },
  { key: 'secondName', label: 'Segundo nombre', example: 'María' },
  { key: 'lastName', label: 'Apellido paterno', example: 'Pérez' },
  { key: 'secondLastName', label: 'Apellido materno', example: 'Soto' },
  { key: 'username', label: 'Usuario (opcional; se autogenera del email institucional)', example: 'ana.perez' },
  { key: 'emailInstitucional', label: 'Email institucional', example: 'ana.perez@gmt.cl' },
  { key: 'emailPersonal', label: 'Email personal', example: 'ana@gmail.com' },
  { key: 'roleKeys', label: 'Roles (separados por ;)', example: 'operator;viewer' },
];

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** Deriva un username sugerido del prefijo del email institucional. */
function suggestUsername(email: string): string {
  return (email.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 30);
}
```

- [ ] En `parseFile` (líneas 97-154): actualizar `required` y el armado de cada fila. Reemplazar:
  - `const required = ['firstName', 'lastName', 'email', 'roleKeys'];` por
    `const required = ['firstName', 'lastName', 'roleKeys'];`
  - El cuerpo del `for` (líneas 122-151) por:

```ts
      const raw = matrix[i] ?? [];
      const rowNo = i + 1;
      const firstName = cell(raw, 'firstName');
      const lastName = cell(raw, 'lastName');
      const emailInstitucional = cell(raw, 'emailInstitucional');
      const emailPersonal = cell(raw, 'emailPersonal');
      const username = cell(raw, 'username') || suggestUsername(emailInstitucional);
      const { roles, invalid } = parseRoles(cell(raw, 'roleKeys'));

      const problems: string[] = [];
      if (firstName.length === 0) problems.push('falta el primer nombre');
      if (lastName.length === 0) problems.push('falta el apellido paterno');
      if (!USERNAME_RE.test(username)) problems.push('usuario inválido (3-30, minúsculas . _ -)');
      if (!emailInstitucional && !emailPersonal) problems.push('falta al menos un email');
      if (emailInstitucional && !EMAIL_RE.test(emailInstitucional)) problems.push('email institucional inválido');
      if (emailPersonal && !EMAIL_RE.test(emailPersonal)) problems.push('email personal inválido');
      if (invalid.length > 0) problems.push(`roles desconocidos: ${invalid.join(', ')}`);
      if (roles.length === 0) problems.push('sin roles válidos');

      if (problems.length > 0) {
        errors.push({ row: rowNo, message: problems.join('; ') });
        continue;
      }

      const secondName = cell(raw, 'secondName');
      const secondLastName = cell(raw, 'secondLastName');
      rows.push({
        firstName,
        lastName,
        username,
        emailInstitucional: emailInstitucional || undefined,
        emailPersonal: emailPersonal || undefined,
        roleKeys: roles,
        secondName: secondName.length > 0 ? secondName : undefined,
        secondLastName: secondLastName.length > 0 ? secondLastName : undefined,
      });
```

- [ ] `previewColumns` (líneas 170-180): reemplazar la columna "Correo" por "Usuario"/"Email":

```tsx
        { header: 'Usuario', render: (r) => r.username },
        { header: 'Email', render: (r) => r.emailInstitucional ?? r.emailPersonal ?? '—' },
```

- [ ] Commit:

```bash
git add nodes/web/src/pages/usuarios/import-users-dialog.tsx
git commit -m "feat(auth): import CSV de usuarios con username/emails (web)"
```

### Task 15 — `credential-dialog.tsx` + `usuarios/index.tsx`: mostrar username

**Files:**
- modify: `nodes/web/src/pages/usuarios/credential-dialog.tsx`
- modify: `nodes/web/src/pages/usuarios/index.tsx`

Pasos:
- [ ] `credential-dialog.tsx` — `ProvisionalCredential` (líneas 16-19) suma `username`; la lista
  muestra el username como identidad de login. Reemplazar:

```ts
/** Una credencial provisoria a mostrar (usuario + clave generada). */
export interface ProvisionalCredential {
  username: string;
  email: string;
  provisionalPassword: string;
}
```

  Y el `<li>` (líneas 84-99): usar `cred.username` como `key` y título, con el email como subtítulo:

```tsx
            <li
              key={cred.username}
              className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{cred.username}</p>
                <p className="truncate text-xs text-muted-foreground">{cred.email}</p>
                <p className="flex items-center gap-1.5 font-mono text-sm text-muted-foreground">
                  <KeyRound className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{cred.provisionalPassword}</span>
                </p>
              </div>
              <CopyButton
                value={cred.provisionalPassword}
                label={`Copiar la clave de ${cred.username}`}
              />
            </li>
```

- [ ] `index.tsx` — poblar `username` al construir credenciales (líneas 52 y 63) y mostrar la columna
  usuario. Reemplazar:
  - Línea 52: `{ username: res.user.username, email: res.user.email, provisionalPassword: res.provisionalPassword },`
  - Línea 63: `result.created.map((c) => ({ username: c.username, email: c.email, provisionalPassword: c.provisionalPassword })),`
  - Columna de tabla (líneas 84-86): agregar/renombrar una columna "Usuario":

```tsx
      accessor: (u) => u.username,
      render: (u) => <span className="font-medium">{u.username}</span>,
```

  (Mantener la columna email existente como dato secundario si el diseño de la tabla lo permite; el
  detalle exacto de columnas se ajusta al leer `index.tsx` completo.)

- [ ] Typecheck web (debe quedar limpio):

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/web && npx tsc --noEmit
```

  Output esperado: exit 0.

- [ ] Commit:

```bash
git add nodes/web/src/pages/usuarios/credential-dialog.tsx nodes/web/src/pages/usuarios/index.tsx
git commit -m "feat(auth): credenciales y tabla de usuarios muestran username (web)"
```

---

## FASE D — Verificación integral

### Task 16 — Suite backend + lint + build web

**Files:** (sin cambios; verificación)

Pasos:
- [ ] Suite completa backend:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx vitest run
```

  Output esperado: todos los archivos PASS (en especial `test/auth/*`, `test/modules/users*`,
  `test/modules/users/dto/create-user.dto.spec.ts`, `test/prisma/seed-admin.spec.ts`).

- [ ] Lint raíz:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link && pnpm lint
```

  Output esperado: sin errores.

- [ ] Build web (Vite) para confirmar que nada quedó roto:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/web && npx tsc --noEmit && npx vite build
```

  Output esperado: `✓ built in ...` sin errores.

- [ ] Si `test/prisma/seed-admin.spec.ts` falla por el nuevo `username` en `ADMIN`/`create`, ajustar
  las expectativas del test al objeto con `username`/`emailInstitucional` (leer el spec del seed y
  actualizar el `toEqual`/`objectContaining`).

- [ ] Commit final de ajustes de verificación (si hubo):

```bash
git add -A
git commit -m "test(auth): ajustes de verificación fase 1b (username + emails)"
```

### Task 17 — Smoke manual (local; Railway lo hace el controlador)

Pasos:
- [ ] Regenerar seeds locales y probar login por username:

```bash
cd C:/Users/juana/GMT/proyectos/gmt-link/nodes/backend-central && npx tsx prisma/seed-admin.ts && npx tsx prisma/seed-auth-dev.ts
```

  Output esperado: admin con `username=admin`, usuario de prueba `username=colaborador`.

- [ ] Levantar `pnpm dev` (raíz) y en `http://localhost:5173` iniciar sesión con **usuario** `admin`
  y la clave dev (`AdminGmt2026`). Verificar que entra (identidad por username, no email).
- [ ] Crear un usuario desde la UI: verificar autosugerencia de username al tipear el email
  institucional, la validación ≥1 email, y que la credencial mostrada trae **usuario** + clave.
- [ ] Importar un CSV de 2 filas (una con username explícito, otra sin → autogenerado) y verificar el
  preview + credenciales.

Notas de cierre:
- El envío de email de credenciales queda **desactivado** (spec §4.3 / Fase 3): la clave se ve en UI.
- `GET /auth/me` NO se modifica aquí; la adición de `permissions:string[]` es del plan de gating (Fase 1a).
- Deviación registrada: **D1** (email conservado NOT NULL por retro-compat). Confirmar con el owner si
  se prefiere la semántica nullable estricta del spec §4.1.
