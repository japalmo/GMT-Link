# Fase 1e — Usuarios MOCKUP (seed de prueba por rol + data de juguete)

**Fecha:** 2026-07-10
**Spec autoridad:** `docs/superpowers/specs/2026-07-10-deploy-finanzas-roles-design.md` (§6 alcance; §2 modelo de roles; §3 acceso por permiso; §4 login username).
**Rama:** `feat/finanzas-roles-deploy`

## Goal

Sembrar, **solo bajo demanda en `web-dev`** (guard `SEED_MOCKUPS=on`), **1 usuario MOCKUP FICTICIO por rol** del modelo de la spec §2.3 (10 usuarios, emails `@example.test`, clave conocida, `Membership` ORGANIZATION con su `roleKey`) **+ solicitudes de reembolso/HE de ejemplo** (data de juguete) para poblar el dashboard de Finanzas. Idempotente. **NUNCA** en identidades reales (Humberto Leiva, John Santa, etc. — esas viven en Fase 3, diferidas). El owner ingresa con cada mockup para validar permisos/UX por rol.

## Architecture

- El acceso es **por permiso** (spec §3). Un mockup obtiene sus permisos porque `PermissionService.scopeFilter` deriva permisos **puramente desde `Membership` → `roleKey` → `RolePermission.scope`** (ver `src/authz/permission.service.ts:33-51`). Por eso **basta** crear el `User` + una `Membership` ORGANIZATION con el `roleKey` correcto: los permisos FUNCTIONAL de finanzas (GLOBAL) resuelven sin tocar OpenFGA. FGA solo se necesita para el superadmin (`org_admin`) y los STRUCTURAL.
- **Guard por env, NO por `NODE_ENV`.** Según la spec (Arquitectura), `web` y `web-dev` comparten **una sola api y una sola BD** en el environment Railway `production` → la api corre con `NODE_ENV=production` también para `web-dev`. Gatear por `NODE_ENV` bloquearía `web-dev`. El guard correcto es el flag explícito `SEED_MOCKUPS` (spec §6), que solo se activa al poblar el entorno de pruebas a mano.
- Patrón de seed **espejo del repo**: lógica pura y testeable en `seed-mockups.core.ts` (sin crear `PrismaClient`, sin efectos) + entrypoint `seed-mockups.ts` que inyecta Prisma y orquesta. Idéntico a `seed-admin.core.ts` / `seed-admin.ts`.
- Idempotencia: `user.upsert` por `username` (clave de login única, spec §4.1); `membership.upsert` por su unique compuesto; data de finanzas con **delete-then-create acotado a los ids de mockups** (esos modelos no tienen clave natural).

## Tech Stack

Prisma 6 + `@prisma/client` · `tsx` para correr seeds · `bcryptjs` (`hashPassword`, `src/common/password.ts`) · `@openfga/sdk` (best-effort, patrón `makeFgaClient` de `seed-capstone.ts`) · Vitest para los tests unitarios de la lógica pura.

## Contrato compartido (referenciado, NO redefinido)

- **Permisos nuevos + bundles por rol:** spec §2.2/§2.3. Los define y siembra el **plan de roles/permisos (Fase 1a)** en `prisma/seed.ts`. Este plan **consume** esos roles: crea `Membership` con esos `roleKey`.
- **Acceso por permiso:** `GET /auth/me` expone `permissions:string[]`; front `useHasPermission(perm)`; guard de ruta. Lo entrega el **plan de acceso/gating (Fase 1)**. Este plan no lo toca; el owner valida su efecto entrando con cada mockup.
- **Login por username + emails:** spec §4.1/§4.2. Los campos `username @unique`, `emailInstitucional? @unique`, `emailPersonal?` y el login por username los agrega el **plan de auth (Fase 1)**. Este plan **usa** esos campos.

## Prerequisites (dependencias duras — verificar en Task 1)

Este seed **no compila ni corre** hasta que estén aplicados, sobre `feat/finanzas-roles-deploy`:

1. **Plan de auth (spec §4.1):** migración aditiva que agrega a `User` los campos `username String @unique`, `emailInstitucional String? @unique`, `emailPersonal String?`. Hoy **no existen** en `prisma/schema.prisma` (verificado 2026-07-10).
2. **Plan de roles (spec §2.3):** `prisma/seed.ts` sembró como `Role.isSystem=true` las claves: `trabajador`, `admin_contrato`, `admin_finanzas`, `analista_rh`, `analista_finanzas`, `asesor_hse`, `gerencia_proyectos`, `gerencia_rh`, `gerencia_general`. Hoy **no existen** (verificado 2026-07-10; `org_admin` sí existe). `Membership.roleKey` es FK a `Role.key` con `onDelete: Restrict` (`schema.prisma:211`) → crear una Membership con un `roleKey` inexistente revienta con P2003. Por eso el catálogo de roles debe estar sembrado antes (`pnpm db:seed`).

Orden de ejecución en `web-dev`: `prisma migrate deploy` → `pnpm db:seed` (catálogo + roles) → `pnpm seed:admin` → **`SEED_MOCKUPS=on pnpm seed:mockups`** (este plan).

## Mapeo mockup → rol (spec §6 + §2.3)

| username (login) | email institucional ficticio | roleKey de la Membership |
|---|---|---|
| `mock_admin_contrato` | `mock_admin_contrato@example.test` | `admin_contrato` |
| `mock_trabajador` | `mock_trabajador@example.test` | `trabajador` |
| `mock_admin_finanzas` | `mock_admin_finanzas@example.test` | `admin_finanzas` |
| `mock_analista_rh` | `mock_analista_rh@example.test` | `analista_rh` |
| `mock_analista_finanzas` | `mock_analista_finanzas@example.test` | `analista_finanzas` |
| `mock_asesor_hse` | `mock_asesor_hse@example.test` | `asesor_hse` |
| `mock_gerencia_proyectos` | `mock_gerencia_proyectos@example.test` | `gerencia_proyectos` |
| `mock_gerencia_rh` | `mock_gerencia_rh@example.test` | `gerencia_rh` |
| `mock_gerencia_general` | `mock_gerencia_general@example.test` | `gerencia_general` |
| `mock_admin_ti` | `mock_admin_ti@example.test` | `org_admin` |

**Decisión (admin_ti → `org_admin`):** la spec §2.3 mapea `admin_ti` → `org_admin` (superadmin, todo el catálogo GLOBAL). En vez de inventar un rol `admin_ti`, la Membership de `mock_admin_ti` usa el rol `org_admin` ya existente (`seed.ts:123`) — hereda el catálogo completo y recibe además la tupla FGA `admin` (igual que hace `UsersService.create` para `org_admin`, `users.service.ts:94-96`).

Clave conocida compartida por todos los mockups: **`Mockup2026!`**. `status = ACTIVE` (no `PENDING_FIRST_LOGIN`) → el owner entra directo, sin el flujo de primer login. El endpoint `/auth/login` no valida complejidad (`auth.controller.ts:85-95`), así que la clave sirve tal cual.

## Cómo ingresa el owner con cada mockup

- **Vía login por username (spec §4.2, ruta principal una vez desplegado el plan de auth):** en `/login` → **Usuario** = el `username` de la tabla (p.ej. `mock_admin_finanzas`), **Clave** = `Mockup2026!`.
- **Fallback (si en `web-dev` aún está el login por email):** el endpoint actual valida `email` (`auth.controller.ts:86-89`, DTO `@IsEmail`). Usar el **email institucional ficticio** (`mock_admin_finanzas@example.test`) + `Mockup2026!`. `@example.test` pasa `@IsEmail` (validator.js no restringe el TLD).
- El seed imprime la tabla completa de credenciales al terminar (§ resumen del entrypoint).

## Data de juguete (poblar dashboard Finanzas §5.2)

Solicitudes de ejemplo con **solo columnas del esquema actual** (`Reimbursement`: `userId, amount:Int, date, concept, category?, status, decidedById?, decidedAt?` — `schema.prisma:403-421`; `OvertimeRequest`: `userId, date, hours:Float, reason, status, decidedById?, decidedAt?` — `schema.prisma:424-440`). Requesters = los propios mockups. Estados variados (`PENDIENTE/APROBADO/PAGADO/RECHAZADO`) y fechas repartidas (incluye una a >20 días para ejercer el cierre mensual del plan de finanzas) para que las cards muestren pendientes, aprobados-pend-pago y rankings por trabajador.

**Fuera de alcance de este seed:** cards **por proyecto** (spec §5.2) → `Reimbursement`/`OvertimeRequest` **no tienen `projectId` hoy**; ese campo lo agrega el plan de finanzas (schema). Y los campos `rejectionReason`/`printedAt` (spec §2.4) tampoco existen aún → no se usan. Cuando esas migraciones estén, enriquecer es trivial (nota en Task 2), pero este seed queda auto-contenido contra el esquema actual + los campos de auth.

---

## File Structure

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `nodes/backend-central/prisma/seed-mockups.core.ts` | **crear** | Lógica pura y testeable: `MOCKUPS`, `mockupEmail`, guard `isMockupSeedEnabled`, catálogos `REIMBURSEMENT_SAMPLES`/`OVERTIME_SAMPLES` y builders `buildReimbursements`/`buildOvertime`. Sin `PrismaClient`, sin efectos. |
| `nodes/backend-central/test/prisma/seed-mockups.spec.ts` | **crear** | Tests unitarios (Vitest) del módulo core: guard, integridad de `MOCKUPS`, forma de la data de juguete. |
| `nodes/backend-central/prisma/seed-mockups.ts` | **crear** | Entrypoint: carga `.env`, aplica el guard, crea `PrismaClient`, valida prerequisitos (roles), orquesta users + memberships + FGA best-effort + finanzas, imprime resumen/credenciales. |
| `nodes/backend-central/package.json` | **modificar** | Agregar script `"seed:mockups": "tsx prisma/seed-mockups.ts"`. |

Convención de paths de los seeds: corren con `cwd = nodes/backend-central` y cargan el `.env` raíz vía `config({ path: path.resolve(process.cwd(), '../../.env') })` (igual que `seed.ts:17`, `seed-capstone.ts:34`).

---

## Task 1 — Tests del core (TDD, rojo)

**Files:**
- create/test: `nodes/backend-central/test/prisma/seed-mockups.spec.ts`

- [ ] Crear el archivo de test importando el módulo core que aún no existe (queda rojo por "module not found"):

```ts
import { describe, it, expect } from 'vitest';
import { FinanceStatus } from '@prisma/client';
import {
  MOCKUPS,
  ORG_ADMIN_ROLE,
  MOCKUP_PASSWORD,
  mockupEmail,
  isMockupSeedEnabled,
  buildReimbursements,
  buildOvertime,
  REIMBURSEMENT_SAMPLES,
  OVERTIME_SAMPLES,
} from '../../prisma/seed-mockups.core';

describe('isMockupSeedEnabled', () => {
  it('true solo con SEED_MOCKUPS on/1/true (case-insensitive)', () => {
    for (const v of ['on', '1', 'true', 'TRUE', ' On ']) {
      expect(isMockupSeedEnabled({ SEED_MOCKUPS: v } as NodeJS.ProcessEnv)).toBe(true);
    }
  });
  it('false si falta o está apagado (no depende de NODE_ENV)', () => {
    expect(isMockupSeedEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isMockupSeedEnabled({ SEED_MOCKUPS: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isMockupSeedEnabled({ SEED_MOCKUPS: '0' } as NodeJS.ProcessEnv)).toBe(false);
    // NODE_ENV=production NO habilita por sí solo (web-dev comparte api prod).
    expect(isMockupSeedEnabled({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('MOCKUPS', () => {
  it('son 10, uno por rol de la spec §6', () => {
    expect(MOCKUPS).toHaveLength(10);
  });
  it('usernames únicos, con prefijo mock_ y email @example.test', () => {
    const usernames = MOCKUPS.map((m) => m.username);
    expect(new Set(usernames).size).toBe(10);
    for (const m of MOCKUPS) {
      expect(m.username.startsWith('mock_')).toBe(true);
      expect(mockupEmail(m.username)).toBe(`${m.username}@example.test`);
    }
  });
  it('cubre exactamente los roleKeys esperados (admin_ti → org_admin)', () => {
    const roleKeys = MOCKUPS.map((m) => m.roleKey).sort();
    expect(roleKeys).toEqual(
      [
        'admin_contrato',
        'admin_finanzas',
        'analista_finanzas',
        'analista_rh',
        'asesor_hse',
        'gerencia_general',
        'gerencia_proyectos',
        'gerencia_rh',
        'org_admin',
        'trabajador',
      ].sort(),
    );
    expect(MOCKUPS.find((m) => m.username === 'mock_admin_ti')?.roleKey).toBe(ORG_ADMIN_ROLE);
  });
  it('clave conocida definida', () => {
    expect(MOCKUP_PASSWORD.length).toBeGreaterThanOrEqual(8);
  });
});

describe('buildReimbursements / buildOvertime', () => {
  const now = new Date('2026-07-10T12:00:00Z');
  const idByUsername = new Map(MOCKUPS.map((m, i) => [m.username, `id-${i}`]));

  it('reembolsos: un row por sample, userId resuelto, decidedBy solo en estados decididos', () => {
    const rows = buildReimbursements(idByUsername, now);
    expect(rows).toHaveLength(REIMBURSEMENT_SAMPLES.length);
    for (const r of rows) {
      expect([...idByUsername.values()]).toContain(r.userId);
      expect(r.amount).toBeGreaterThan(0);
      expect(Number.isInteger(r.amount)).toBe(true);
      const decided =
        r.status === FinanceStatus.APROBADO ||
        r.status === FinanceStatus.PAGADO ||
        r.status === FinanceStatus.RECHAZADO;
      expect(r.decidedById !== null).toBe(decided);
      expect(r.decidedAt !== null).toBe(decided);
      if (r.decidedById) expect([...idByUsername.values()]).toContain(r.decidedById);
      expect(r.date.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('horas extra: un row por sample, hours>0, mismas invariantes de decisión', () => {
    const rows = buildOvertime(idByUsername, now);
    expect(rows).toHaveLength(OVERTIME_SAMPLES.length);
    for (const r of rows) {
      expect([...idByUsername.values()]).toContain(r.userId);
      expect(r.hours).toBeGreaterThan(0);
      const decided =
        r.status === FinanceStatus.APROBADO ||
        r.status === FinanceStatus.PAGADO ||
        r.status === FinanceStatus.RECHAZADO;
      expect(r.decidedById !== null).toBe(decided);
    }
  });

  it('lanza si un requester no está en el mapa de ids', () => {
    expect(() => buildReimbursements(new Map(), now)).toThrow();
  });
});
```

- [ ] Correr y confirmar rojo (módulo aún no existe):

```powershell
pnpm --filter @gmt-platform/backend-central exec vitest run test/prisma/seed-mockups.spec.ts
```

Output esperado: falla al resolver `../../prisma/seed-mockups.core` (Error: Failed to load / Cannot find module). Confirma que el test corre y aún no hay implementación.

- [ ] Commit: `test(seed): mockups core specs (rojo)`

---

## Task 2 — Implementar `seed-mockups.core.ts` (TDD, verde)

**Files:**
- create: `nodes/backend-central/prisma/seed-mockups.core.ts`
- test: `nodes/backend-central/test/prisma/seed-mockups.spec.ts` (ya creado en Task 1)

- [ ] Crear el módulo core con la lógica pura:

```ts
/**
 * Lógica PURA y testeable del seed de usuarios MOCKUP (Fase 1e, spec §6).
 * No crea PrismaClient ni ejecuta efectos al importarse: el entrypoint
 * `seed-mockups.ts` inyecta Prisma y orquesta. Espejo de `seed-admin.core.ts`.
 *
 * ⚠️ Estos son mockups FICTICIOS de prueba (identidades @example.test), solo
 * para validar roles en web-dev. NUNCA cuentas reales (esas viven en Fase 3).
 */
import { FinanceStatus } from '@prisma/client';

/** ORG id (espejo de src/common/org.constant.ts — ORG_ID = 'gmt'). */
export const ORG_ID = 'gmt';

/** Clave conocida compartida por TODOS los mockups (solo web-dev). */
export const MOCKUP_PASSWORD = 'Mockup2026!';

/** Dominio ficticio reservado — jamás una identidad real. */
export const MOCKUP_EMAIL_DOMAIN = 'example.test';

/** roleKey del superadmin: además requiere la tupla FGA `admin` sobre la org. */
export const ORG_ADMIN_ROLE = 'org_admin';

export interface MockupDef {
  /** username de login (spec §4.2). */
  username: string;
  /** roleKey de la Membership ORGANIZATION (spec §2.3). */
  roleKey: string;
  firstName: string;
  lastName: string;
}

/**
 * 1 mockup por rol (spec §6). username = `mock_<rol>`; email institucional
 * ficticio = `<username>@example.test`. `admin_ti` se materializa con el rol
 * `org_admin` (superadmin, spec §2.3) para heredar el catálogo GLOBAL + FGA admin.
 */
export const MOCKUPS: readonly MockupDef[] = [
  { username: 'mock_admin_contrato', roleKey: 'admin_contrato', firstName: 'Mock', lastName: 'Admin Contrato' },
  { username: 'mock_trabajador', roleKey: 'trabajador', firstName: 'Mock', lastName: 'Trabajador' },
  { username: 'mock_admin_finanzas', roleKey: 'admin_finanzas', firstName: 'Mock', lastName: 'Admin Finanzas' },
  { username: 'mock_analista_rh', roleKey: 'analista_rh', firstName: 'Mock', lastName: 'Analista RH' },
  { username: 'mock_analista_finanzas', roleKey: 'analista_finanzas', firstName: 'Mock', lastName: 'Analista Finanzas' },
  { username: 'mock_asesor_hse', roleKey: 'asesor_hse', firstName: 'Mock', lastName: 'Asesor HSE' },
  { username: 'mock_gerencia_proyectos', roleKey: 'gerencia_proyectos', firstName: 'Mock', lastName: 'Gerencia Proyectos' },
  { username: 'mock_gerencia_rh', roleKey: 'gerencia_rh', firstName: 'Mock', lastName: 'Gerencia RH' },
  { username: 'mock_gerencia_general', roleKey: 'gerencia_general', firstName: 'Mock', lastName: 'Gerencia General' },
  { username: 'mock_admin_ti', roleKey: ORG_ADMIN_ROLE, firstName: 'Mock', lastName: 'Admin TI' },
] as const;

/** Email institucional ficticio del mockup. */
export function mockupEmail(username: string): string {
  return `${username}@${MOCKUP_EMAIL_DOMAIN}`;
}

/**
 * Guard de entorno: los mockups SOLO se siembran con SEED_MOCKUPS activado.
 * NO se gatea por NODE_ENV: `web` y `web-dev` comparten la api prod y la BD
 * (spec Arquitectura), así que gatear por NODE_ENV bloquearía web-dev.
 */
export function isMockupSeedEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SEED_MOCKUPS?.trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// Data de juguete para poblar el dashboard de Finanzas (spec §5.2).
// Solo columnas del esquema actual. Sin projectId/rejectionReason/printedAt
// (esos los agregan los planes de finanzas; ver nota en el plan).
// ─────────────────────────────────────────────────────────────────────────────

/** Estados en los que la solicitud ya fue decidida (llevan decidedBy/decidedAt). */
const DECIDED_STATUSES: ReadonlySet<FinanceStatus> = new Set([
  FinanceStatus.APROBADO,
  FinanceStatus.PAGADO,
  FinanceStatus.RECHAZADO,
]);

interface ReimbursementSample {
  requester: string; // username
  amount: number; // CLP entero
  daysAgo: number; // fecha de la boleta = now - daysAgo
  concept: string;
  category: string;
  status: FinanceStatus;
  decidedBy?: string; // username de quien decidió (obligatorio si status decidido)
}

interface OvertimeSample {
  requester: string;
  hours: number;
  daysAgo: number;
  reason: string;
  status: FinanceStatus;
  decidedBy?: string;
}

export const REIMBURSEMENT_SAMPLES: readonly ReimbursementSample[] = [
  { requester: 'mock_trabajador', amount: 18990, daysAgo: 2, concept: 'Almuerzo en terreno', category: 'Alimentación', status: FinanceStatus.PENDIENTE },
  { requester: 'mock_trabajador', amount: 32000, daysAgo: 6, concept: 'Bencina camioneta', category: 'Transporte', status: FinanceStatus.APROBADO, decidedBy: 'mock_admin_finanzas' },
  { requester: 'mock_trabajador', amount: 12500, daysAgo: 25, concept: 'Peaje ruta 5', category: 'Transporte', status: FinanceStatus.PAGADO, decidedBy: 'mock_admin_finanzas' },
  { requester: 'mock_analista_rh', amount: 45990, daysAgo: 3, concept: 'Materiales de oficina', category: 'Otro', status: FinanceStatus.PENDIENTE },
  { requester: 'mock_asesor_hse', amount: 78000, daysAgo: 10, concept: 'Repuesto de EPP', category: 'Otro', status: FinanceStatus.APROBADO, decidedBy: 'mock_admin_finanzas' },
  { requester: 'mock_admin_contrato', amount: 9990, daysAgo: 1, concept: 'Café reunión con cliente', category: 'Alimentación', status: FinanceStatus.RECHAZADO, decidedBy: 'mock_admin_finanzas' },
];

export const OVERTIME_SAMPLES: readonly OvertimeSample[] = [
  { requester: 'mock_trabajador', hours: 2.5, daysAgo: 1, reason: 'Cierre de avance mensual', status: FinanceStatus.PENDIENTE },
  { requester: 'mock_trabajador', hours: 3, daysAgo: 8, reason: 'Emergencia en faena', status: FinanceStatus.APROBADO, decidedBy: 'mock_admin_contrato' },
  { requester: 'mock_analista_rh', hours: 1.5, daysAgo: 22, reason: 'Carga de datos de RH', status: FinanceStatus.PENDIENTE },
  { requester: 'mock_asesor_hse', hours: 4, daysAgo: 15, reason: 'Auditoría HSE nocturna', status: FinanceStatus.APROBADO, decidedBy: 'mock_gerencia_proyectos' },
  { requester: 'mock_admin_contrato', hours: 2, daysAgo: 30, reason: 'Revisión de contratos', status: FinanceStatus.RECHAZADO, decidedBy: 'mock_gerencia_proyectos' },
];

export interface BuiltReimbursement {
  userId: string;
  amount: number;
  date: Date;
  concept: string;
  category: string;
  status: FinanceStatus;
  decidedById: string | null;
  decidedAt: Date | null;
}

export interface BuiltOvertime {
  userId: string;
  date: Date;
  hours: number;
  reason: string;
  status: FinanceStatus;
  decidedById: string | null;
  decidedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateDaysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Resuelve un username→id o lanza (defensivo: el mapa debe traer todos los mockups). */
function requireId(idByUsername: ReadonlyMap<string, string>, username: string): string {
  const id = idByUsername.get(username);
  if (id === undefined) {
    throw new Error(`Mockup sin id resuelto: "${username}". ¿Se sembraron los usuarios antes que la data de finanzas?`);
  }
  return id;
}

/** Fecha de decisión: un día después de la boleta (nunca en el futuro respecto de now). */
function decidedAtFor(now: Date, daysAgo: number, decided: boolean): Date | null {
  return decided ? dateDaysAgo(now, Math.max(0, daysAgo - 1)) : null;
}

export function buildReimbursements(idByUsername: ReadonlyMap<string, string>, now: Date): BuiltReimbursement[] {
  return REIMBURSEMENT_SAMPLES.map((s) => {
    const decided = DECIDED_STATUSES.has(s.status);
    return {
      userId: requireId(idByUsername, s.requester),
      amount: s.amount,
      date: dateDaysAgo(now, s.daysAgo),
      concept: s.concept,
      category: s.category,
      status: s.status,
      decidedById: decided && s.decidedBy ? requireId(idByUsername, s.decidedBy) : null,
      decidedAt: decidedAtFor(now, s.daysAgo, decided),
    };
  });
}

export function buildOvertime(idByUsername: ReadonlyMap<string, string>, now: Date): BuiltOvertime[] {
  return OVERTIME_SAMPLES.map((s) => {
    const decided = DECIDED_STATUSES.has(s.status);
    return {
      userId: requireId(idByUsername, s.requester),
      date: dateDaysAgo(now, s.daysAgo),
      hours: s.hours,
      reason: s.reason,
      status: s.status,
      decidedById: decided && s.decidedBy ? requireId(idByUsername, s.decidedBy) : null,
      decidedAt: decidedAtFor(now, s.daysAgo, decided),
    };
  });
}
```

- [ ] Correr los tests y confirmar verde:

```powershell
pnpm --filter @gmt-platform/backend-central exec vitest run test/prisma/seed-mockups.spec.ts
```

Output esperado: `Test Files 1 passed`, `Tests 8 passed` (2 guard + 4 MOCKUPS + 3 builders; ajustar al total real de `it`).

- [ ] Typecheck de tests (incluye el core al importarlo):

```powershell
pnpm --filter @gmt-platform/backend-central run typecheck:test
```

Output esperado: sin errores (exit 0).

- [ ] Commit: `feat(seed): mockups core (usuarios por rol + data de juguete)`

> Nota (enriquecimiento futuro, NO ahora — YAGNI): cuando el plan de finanzas agregue `projectId` a `Reimbursement`/`OvertimeRequest` y `rejectionReason`/`printedAt` (spec §2.4/§5.2), extender los samples con esos campos para poblar las cards por proyecto. Hoy quedan fuera para mantener el seed auto-contenido.

---

## Task 3 — Entrypoint `seed-mockups.ts` (orquestación)

**Files:**
- create: `nodes/backend-central/prisma/seed-mockups.ts`

- [ ] Crear el entrypoint. Aplica el guard, valida que los roles existan (FK `Membership.roleKey`), upserta usuarios (por `username`), memberships, escribe FGA best-effort y siembra la data de finanzas con delete-then-create acotado:

```ts
/**
 * Entrypoint del seed de usuarios MOCKUP (Fase 1e, spec §6).
 *
 * ⚠️ Mockups FICTICIOS de prueba (@example.test), SOLO para validar roles en
 * web-dev. Guardado por SEED_MOCKUPS (no por NODE_ENV: web-dev comparte api
 * prod). NUNCA cuentas reales — esas viven en Fase 3.
 *
 * Idempotente:
 *  - user.upsert por `username` (clave de login única, spec §4.1).
 *  - membership.upsert por su unique compuesto.
 *  - finanzas: delete-then-create acotado a los ids de los mockups.
 *
 * Requiere (ver plan §Prerequisites): campos username/emailInstitucional en User
 * (plan de auth) y los roles de la spec §2.3 sembrados (`pnpm db:seed`).
 *
 * Ejecutar:  $env:SEED_MOCKUPS='on'; pnpm --filter @gmt-platform/backend-central seed:mockups
 */
import path from 'node:path';
import { config } from 'dotenv';
import { OpenFgaClient } from '@openfga/sdk';
import { PrismaClient, ScopeType, UserStatus } from '@prisma/client';
import { hashPassword } from '../src/common/password';
import {
  MOCKUPS,
  ORG_ID,
  ORG_ADMIN_ROLE,
  MOCKUP_PASSWORD,
  mockupEmail,
  isMockupSeedEnabled,
  buildReimbursements,
  buildOvertime,
} from './seed-mockups.core';

// Al correr con tsx hay que cargar el .env raíz manualmente (igual que seed.ts:17).
config({ path: path.resolve(process.cwd(), '../../.env') });

/** Cliente FGA opcional (best-effort). null si no hay store configurado. */
function makeFgaClient(): OpenFgaClient | null {
  const storeId = process.env.FGA_STORE_ID;
  if (!storeId) return null;
  const apiUrl = process.env.FGA_API_URL ?? 'http://localhost:8080';
  const modelId = process.env.FGA_MODEL_ID || undefined;
  return new OpenFgaClient({ apiUrl, storeId, authorizationModelId: modelId });
}

/** Escribe una tupla de acceso org (member|admin) tolerando el "ya existe". */
async function writeOrgTuple(
  client: OpenFgaClient,
  userId: string,
  relation: 'admin' | 'member',
): Promise<void> {
  const tuple = { user: `user:${userId}`, relation, object: `organization:${ORG_ID}` };
  try {
    await client.write({ writes: [tuple] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|write_failed_due_to_invalid_input|duplicate/i.test(message)) {
      console.warn(`  FGA: no se pudo escribir ${relation} para ${userId}: ${message}`);
    }
  }
}

async function main(): Promise<void> {
  if (!isMockupSeedEnabled(process.env)) {
    console.log(
      'seed:mockups OMITIDO — SEED_MOCKUPS no está activado. ' +
        "Para poblar web-dev: \"$env:SEED_MOCKUPS='on'; pnpm --filter @gmt-platform/backend-central seed:mockups\".",
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    // ── 0. Prerequisito: los roles de la spec §2.3 deben existir (FK Membership.roleKey). ──
    const neededRoles = [...new Set(MOCKUPS.map((m) => m.roleKey))];
    const foundRoles = await prisma.role.findMany({
      where: { key: { in: neededRoles } },
      select: { key: true },
    });
    const missing = neededRoles.filter((k) => !foundRoles.some((r) => r.key === k));
    if (missing.length > 0) {
      throw new Error(
        `Faltan roles en el catálogo: ${missing.join(', ')}. ` +
          'Corré `pnpm db:seed` (plan de roles, spec §2.3) antes de sembrar los mockups.',
      );
    }

    const passwordHash = await hashPassword(MOCKUP_PASSWORD);

    // ── 1. Usuarios MOCKUP (upsert por username). ──
    const idByUsername = new Map<string, string>();
    for (const m of MOCKUPS) {
      const email = mockupEmail(m.username);
      const user = await prisma.user.upsert({
        where: { username: m.username },
        update: {
          firstName: m.firstName,
          lastName: m.lastName,
          email,
          emailInstitucional: email,
          status: UserStatus.ACTIVE,
          passwordHash,
        },
        create: {
          username: m.username,
          email,
          emailInstitucional: email,
          firstName: m.firstName,
          lastName: m.lastName,
          status: UserStatus.ACTIVE,
          isClientUser: false,
          passwordHash,
        },
      });
      idByUsername.set(m.username, user.id);
    }
    console.log(`Usuarios MOCKUP asegurados: ${MOCKUPS.length}`);

    // ── 2. Membership ORGANIZATION por rol. ──
    for (const m of MOCKUPS) {
      const userId = idByUsername.get(m.username)!;
      await prisma.membership.upsert({
        where: {
          userId_roleKey_scopeType_scopeId: {
            userId,
            roleKey: m.roleKey,
            scopeType: ScopeType.ORGANIZATION,
            scopeId: ORG_ID,
          },
        },
        update: {},
        create: { userId, roleKey: m.roleKey, scopeType: ScopeType.ORGANIZATION, scopeId: ORG_ID },
      });
    }
    console.log(`Memberships ORGANIZATION aseguradas: ${MOCKUPS.length}`);

    // ── 3. Acceso FGA (best-effort): member para todos; admin para org_admin. ──
    const fga = makeFgaClient();
    if (!fga) {
      console.warn('OpenFGA: FGA_STORE_ID vacío — se omiten las tuplas de acceso (los permisos FUNCTIONAL no dependen de FGA).');
    } else {
      for (const m of MOCKUPS) {
        const userId = idByUsername.get(m.username)!;
        await writeOrgTuple(fga, userId, 'member');
        if (m.roleKey === ORG_ADMIN_ROLE) {
          await writeOrgTuple(fga, userId, 'admin');
        }
      }
      console.log('OpenFGA: tuplas de acceso org aseguradas (best-effort).');
    }

    // ── 4. Data de juguete de finanzas (delete-then-create acotado a los mockups). ──
    const mockUserIds = [...idByUsername.values()];
    await prisma.reimbursement.deleteMany({ where: { userId: { in: mockUserIds } } });
    await prisma.overtimeRequest.deleteMany({ where: { userId: { in: mockUserIds } } });

    const now = new Date();
    const reimbursements = buildReimbursements(idByUsername, now);
    const overtime = buildOvertime(idByUsername, now);
    await prisma.reimbursement.createMany({ data: reimbursements });
    await prisma.overtimeRequest.createMany({ data: overtime });
    console.log(`Finanzas: ${reimbursements.length} reembolsos + ${overtime.length} horas extra de ejemplo.`);

    // ── 5. Resumen + credenciales para el owner. ──
    console.log('\n=== Usuarios MOCKUP (web-dev) — clave: ' + MOCKUP_PASSWORD + ' ===');
    console.log('  (login por username; fallback email institucional @example.test)');
    for (const m of MOCKUPS) {
      console.log(`  ${m.username.padEnd(24)} rol=${m.roleKey.padEnd(20)} email=${mockupEmail(m.username)}`);
    }
    console.log('=====================================================================');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
```

- [ ] Verificar que el entrypoint compila con tsx en modo guard-apagado (no toca la BD; solo imprime el skip). No requiere Postgres:

```powershell
pnpm --filter @gmt-platform/backend-central exec tsx prisma/seed-mockups.ts
```

Output esperado: una sola línea `seed:mockups OMITIDO — SEED_MOCKUPS no está activado. ...` y exit 0. Confirma que el archivo compila/typechea vía tsx sin errores.

- [ ] Commit: `feat(seed): entrypoint seed-mockups (guard + users + memberships + fga + finanzas)`

---

## Task 4 — Script `seed:mockups` en package.json

**Files:**
- modify: `nodes/backend-central/package.json`

- [ ] Agregar el script junto a los demás `seed:*` (después de `seed:capstone`, línea 16):

```jsonc
    "seed:capstone": "tsx prisma/seed-capstone.ts",
    "seed:mockups": "tsx prisma/seed-mockups.ts",
    "test": "pnpm run typecheck:test && vitest run",
```

- [ ] Confirmar que el script quedó registrado:

```powershell
pnpm --filter @gmt-platform/backend-central run 2>&1 | Select-String "seed:mockups"
```

Output esperado: la línea `seed:mockups` listada entre los scripts disponibles.

- [ ] Commit: `chore(seed): script seed:mockups`

---

## Task 5 — Verificación end-to-end contra la BD (guard, siembra, idempotencia, login)

Requiere Postgres arriba (WSL Ubuntu, `gmt_link`; ver CLAUDE.md) + catálogo/roles sembrados (`pnpm db:seed`). Ejecutar desde `nodes/backend-central`.

**Files:** (ninguno; verificación)

- [ ] **Guard apagado** — sin el flag no siembra nada:

```powershell
Remove-Item Env:SEED_MOCKUPS -ErrorAction SilentlyContinue
pnpm --filter @gmt-platform/backend-central seed:mockups
```

Output esperado: `seed:mockups OMITIDO — SEED_MOCKUPS no está activado. ...`, exit 0. (Verifica que en `web` producción, sin el flag, jamás se crean mockups.)

- [ ] **Siembra** — con el flag, crea los 10 usuarios + data:

```powershell
$env:SEED_MOCKUPS = 'on'
pnpm --filter @gmt-platform/backend-central seed:mockups
```

Output esperado (en orden): `Usuarios MOCKUP asegurados: 10`, `Memberships ORGANIZATION aseguradas: 10`, línea de FGA (tuplas o `omiten`), `Finanzas: 6 reembolsos + 5 horas extra de ejemplo.`, y la tabla de credenciales con los 10 `mock_*`.

- [ ] **Idempotencia** — correr de nuevo no duplica:

```powershell
$env:SEED_MOCKUPS = 'on'
pnpm --filter @gmt-platform/backend-central seed:mockups
node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const u=await p.user.count({where:{username:{startsWith:'mock_'}}});const ids=(await p.user.findMany({where:{username:{startsWith:'mock_'}},select:{id:true}})).map(x=>x.id);const r=await p.reimbursement.count({where:{userId:{in:ids}}});const o=await p.overtimeRequest.count({where:{userId:{in:ids}}});const m=await p.membership.count({where:{userId:{in:ids}}});console.log(JSON.stringify({usuarios:u,memberships:m,reembolsos:r,horasExtra:o}));await p.\$disconnect();})()"
```

Output esperado: `{"usuarios":10,"memberships":10,"reembolsos":6,"horasExtra":5}` (misma cardinalidad tras la 2ª corrida → idempotente; los reembolsos/HE no se duplicaron gracias al delete-then-create).

- [ ] **Login del owner** — validar entrada con un mockup (levantar api en 3001 si no corre: `pnpm --filter @gmt-platform/backend-central dev`). Login por email institucional (funciona con el login actual y con el de username):

```powershell
$body = @{ email = 'mock_admin_finanzas@example.test'; password = 'Mockup2026!' } | ConvertTo-Json
$r = Invoke-RestMethod -Uri 'http://localhost:3001/auth/login' -Method Post -ContentType 'application/json' -Body $body
$me = Invoke-RestMethod -Uri 'http://localhost:3001/auth/me' -Headers @{ Authorization = "Bearer $($r.token)" }
$me | ConvertTo-Json -Depth 5
```

Output esperado: `login` devuelve `{ token }`; `/auth/me` devuelve el usuario con `status: 'ACTIVE'` y (una vez desplegado el plan de gating, spec §3.1) `permissions` con los del rol `admin_finanzas` (`finance:request:view:all`, `finance:request:approve`, `finance:payment:register`, `finance:print:batch`, ...). El owner repite con cada `mock_*` para validar visibilidad de secciones/botones por permiso.

- [ ] Limpiar la variable de entorno de la sesión:

```powershell
Remove-Item Env:SEED_MOCKUPS
```

- [ ] Commit (si hubo ajustes de verificación): `test(seed): verificación e2e de mockups en web-dev`

---

## Checklist de cierre

- [ ] `pnpm --filter @gmt-platform/backend-central test` en verde (typecheck:test + vitest, incluye `seed-mockups.spec.ts`).
- [ ] Guard: sin `SEED_MOCKUPS` el seed es no-op (verificado).
- [ ] 10 mockups `@example.test` + 6 reembolsos + 5 HE, idempotentes (verificado con conteos).
- [ ] Sin identidades reales, sin envío de emails (spec §6): confirmado — todo `@example.test`, ninguna llamada a `SmtpEmailService`.
- [ ] El owner puede ingresar con cada mockup y validar su rol por permiso.
- [ ] NO se editó código de la app (solo `prisma/seed-mockups*.ts`, su test y el script en `package.json`). NO se commiteó a `main` (lo hace el controlador).
</content>
</invoke>
