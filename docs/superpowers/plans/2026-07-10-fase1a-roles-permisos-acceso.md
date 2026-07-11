# Fase 1a — Roles, Permisos y Acceso (Fundaciones)

**Fecha:** 2026-07-10
**Rama:** `feat/finanzas-roles-deploy`
**Spec autoridad:** `docs/superpowers/specs/2026-07-10-deploy-finanzas-roles-design.md` (§2 modelo de roles→permisos, §3 control de acceso)
**Contrato compartido:** `GET /auth/me` expone `permissions: string[]`; front `useHasPermission(perm)` (lee `auth-context.user.permissions`); guard de ruta `RequireModule`/`RequirePermission`.

## Goal

Sentar las FUNDACIONES del control de acceso **por permiso** (no por nombre de rol) para toda la Fase 1:
1. Extender el catálogo de permisos en `prisma/seed.ts` con los permisos nuevos (finanzas, proyectos, sistema) y sembrar los **10 roles de sistema** con sus bundles (spec §2.2/§2.3). Resolver las claves huérfanas.
2. Exponer `permissions: string[]` en `GET /auth/me`, derivados de `PermissionService`.
3. Derivar `modules` del sidebar **de permisos** (mapa permiso→módulo; default Inicio/Finanzas + Config/Perfil de footer) en `auth.controller.resolveModules` — eliminar el hardcode `CLIENT_MODULES`.
4. Front: hook `useHasPermission`, guards de ruta `RequireModule`/`RequirePermission`, migrar todas las consts `*_ROLES` a checks por permiso, sidebar por `modules` (ya lo hace, ahora derivado de permisos).
5. Banner de beta para `system:beta:full`.

Es la base de la que dependen los planes de Finanzas (Fase 1) y de login/username/emails (§4, plan aparte — **fuera de alcance de este plan**).

## Architecture

- **Retrocompatibilidad estricta** (spec §Arquitectura): todo es **aditivo**. No hay cambio de schema Prisma en este plan — los modelos `Permission`/`Role`/`RolePermission`/`Membership` ya existen. La "migración" es el **seed idempotente** (upsert). Los permisos nuevos son gates FUNCTIONAL org-scope (`scopeable:false`, siempre GLOBAL): **no** tocan OpenFGA ni el enforcement existente por endpoint; solo alimentan la visibilidad de UI/módulos y los bundles de rol.
- **`PermissionService` (ADR-0001)** sigue siendo la fachada única. Se le agrega un método de **lectura** `permissionKeysForUser(userId)` que devuelve las claves de permiso efectivas del usuario (union de los grants de sus roles), consumido por `/auth/me`. El enforcement fino (scope OWN/PROJECT, STRUCTURAL→FGA) NO cambia.
- **Front**: `useHasPermission` lee de `auth-context` (`GET /auth/me` → `user.permissions`), por el contrato compartido — NO de `useProfile`. Se elimina `useHasRole` (gating por rol) tras migrar sus 8 consumidores.

## Tech Stack

NestJS + Prisma + Postgres (`nodes/backend-central`); React 19 + Vite + React Router + Tailwind (`nodes/web`); tipos compartidos en `packages/contracts`; Vitest en ambos nodos. PowerShell + pnpm workspace.

---

## Decisiones cerradas de este plan (leer antes de ejecutar)

1. **Roles existentes se CONSERVAN.** `org_admin, department_admin, project_creator, operator, qa, finance, viewer, client_ito` siguen sembrados (los usa FGA, `seed-capstone`, asignaciones de proyecto y tests). Los 10 roles del spec §2.3 se **agregan** como roles de sistema nuevos.
2. **`admin_ti` = superadmin de sistema** (spec §2.3): su bundle es **todo el catálogo a GLOBAL, EXCEPTO `system:beta:full`**. Mismo criterio que `org_admin` (que también se recalcula a "todo el catálogo GLOBAL menos `system:beta:full`"). Motivo: `system:beta:full` es la señal del **banner de beta** (gerencias) — TI/admin no debe verlo. `admin_ti` obtiene grants en Postgres; la relación FGA `can_manage_roles` sigue viniendo de la membresía `org_admin` en FGA (sin cambios: `admin_ti` no habilita `/roles` salvo que además tenga `org_admin` en FGA — aceptable en Fase 1a).
3. **`project:manage`** es un permiso **umbrella FUNCTIONAL** nuevo (spec §2.2 "se agrupa"): puro gate de UI/módulo + bundle. El enforcement real de crear cliente/faena/proyecto/equipo sigue en los endpoints existentes (sin cambios). Igual criterio para los `finance:*` nuevos: se siembran y se exponen, pero su enforcement en endpoints de finanzas es del **plan de Finanzas** (spec §2.4), no de éste.
4. **Claves huérfanas (`supervisor`, `operador`, `ito`, `adm_contrato`).** Se **quitan del contrato org-asignable `ROLE_KEYS`** (`packages/contracts`) — nunca tuvieron bundle ni deben ofrecerse al provisionar usuarios. **Se conservan** en el front `ROLE_LABELS` como etiquetas de presentación porque `pages/operaciones/backlog.tsx`, `pages/proyectos/vista-proyecto.tsx` y `prisma/seed-capstone.ts` las usan como **roleKey de trabajador a nivel PROJECT** (string, sin FK a `Role`, scope PROJECT — no son bundles de organización). Así se cumple "sin bundle → no es rol de sistema" sin romper labels de Fase 2.
5. **`modules` derivados de permisos.** Default para todo usuario autenticado: `['dashboard','finanzas']` (Inicio + Finanzas). Config y Perfil son links de footer (siempre visibles, sin módulo). `org_admin` (membresía) o `system:beta:full` ⇒ **todos** los módulos (incluye `herramientas`, que no tiene permiso dedicado). El resto se enciende por el mapa `PERMISSION_MODULE`.

### Mapa permiso→módulo (`PERMISSION_MODULE`, auth.controller)

| permiso | módulo |
|---|---|
| `project:view:all`, `project:manage` | `proyectos` |
| `user:read`, `user:create`, `user:update` | `usuarios` |
| `directory:view:extended` | `directorio` |
| `task:read`, `task:create` | `operaciones` |
| `asset:manage`, `asset:fields:edit` | `recursos` |
| `vmetric:view` | `v-metric` |

(`herramientas` sin permiso dedicado → solo vía `org_admin`/`system:beta:full`.)

### Mapa de migración de consts `*_ROLES` (front)

| archivo | const actual | nuevo check |
|---|---|---|
| `pages/finanzas/index.tsx` | `FINANCE_MANAGER_ROLES` | `useHasPermission('finance:request:view:all')` |
| `pages/bodegas/index.tsx` | `useHasRole(['org_admin','department_admin'])` | `useHasPermission('warehouse:access')` |
| `pages/recursos/index.tsx` (l.89) | `useHasRole(['org_admin','department_admin'])` | `useHasPermission('warehouse:access')` |
| `pages/recursos/index.tsx` (l.181) | `useHasRole(['org_admin','department_admin','project_creator'])` | `useHasPermission('asset:manage')` |
| `pages/proyectos/vista-proyecto.tsx` | `TEAM_MANAGER_ROLES`, `SERVICE_CREATE_ROLES` | `useHasPermission('project:manage')` (ambos) |
| `pages/proyectos/faena-proyectos.tsx` | `PROJECT_CREATE_ROLES` | `useHasPermission('project:manage')` |
| `pages/proyectos/index.tsx` | `CLIENT_CREATE_ROLES` | `useHasPermission('project:manage')` |
| `pages/proyectos/faenas.tsx` | `FAENA_CREATE_ROLES` | `useHasPermission('project:manage')` |
| `components/gated-action.tsx` | prop `roles` + `useHasRole` | prop `permissions` + `useHasPermission` |

---

## File Structure

**Backend (`nodes/backend-central`)**

| archivo | acción | responsabilidad |
|---|---|---|
| `prisma/rbac-catalog.ts` | **crear** | Exportar `PERMISSIONS`, `ROLES` (+ tipos, helper `g`, `ALL_GLOBAL_EXCEPT_BETA`). Fuente de verdad testeable del catálogo. |
| `prisma/seed.ts` | **modificar** | Importar `PERMISSIONS`/`ROLES` de `rbac-catalog.ts` (dejar de definirlos inline). Lógica de upsert intacta. |
| `src/authz/permission.service.ts` | **modificar** | Agregar `permissionKeysForUser(userId): Promise<string[]>`. |
| `src/auth/auth.controller.ts` | **modificar** | Inyectar `PermissionService`; agregar `permissions` a `MeResponse`; reescribir `resolveModules` (permiso→módulo); borrar `CLIENT_MODULES`. |
| `test/prisma/rbac-catalog.spec.ts` | **crear** | Invariantes del catálogo (grants válidos, 10 roles, bundles). |
| `test/authz/permission.service.spec.ts` | **modificar** | Tests de `permissionKeysForUser`. |
| `test/auth/auth.controller.spec.ts` | **modificar** | Ajustar expectativas de `modules` + tests de `permissions`/derivación. |

**Contracts (`packages/contracts`)**

| archivo | acción | responsabilidad |
|---|---|---|
| `src/index.ts` | **modificar** | `ROLE_KEYS`: quitar 4 huérfanas, agregar 10 roles nuevos. `ProfileMe` sin cambios. |

**Front (`nodes/web`)**

| archivo | acción | responsabilidad |
|---|---|---|
| `src/types/auth.ts` | **modificar** | `AuthedUser.permissions: string[]`. |
| `src/lib/api.ts` | **modificar** | `getMe` normaliza `permissions: me.permissions ?? []`. |
| `src/hooks/use-has-permission.ts` | **crear** | Hook `useHasPermission(perm)` (lee `auth-context`). |
| `src/hooks/use-has-role.ts` | **eliminar** | Tras migrar consumidores. |
| `src/routes/require-access.tsx` | **crear** | `RequireModule` y `RequirePermission` (redirigen a `/`). |
| `src/components/gated-action.tsx` | **modificar** | prop `permissions` + `useHasPermission`. |
| `src/components/layout/beta-banner.tsx` | **crear** | Banner beta si `system:beta:full`. |
| `src/components/layout/app-shell.tsx` | **modificar** | Montar `<BetaBanner/>` sobre el `<Outlet/>`. |
| `src/lib/role-labels.ts` | **modificar** | Agregar labels de los 10 roles nuevos (conservar huérfanas como legacy PROJECT). |
| `src/App.tsx` | **modificar** | Envolver rutas de módulo en `RequireModule`. |
| `src/pages/{finanzas,bodegas,recursos}/index.tsx`, `src/pages/proyectos/{index,faenas,faena-proyectos,vista-proyecto}.tsx` | **modificar** | Migrar `*_ROLES`/`useHasRole` a `useHasPermission` (tabla arriba). |
| `src/hooks/use-has-permission.test.tsx` | **crear** | Test del hook. |
| `src/routes/require-access.test.tsx` | **crear** | Test de los guards. |
| `src/components/layout/sidebar.test.tsx` | **modificar** | `baseUser` incluye `permissions: []`. |

---

## Tasks

### Task 1 — Extraer el catálogo RBAC a un módulo testeable

**Files:**
- create: `nodes/backend-central/prisma/rbac-catalog.ts`
- modify: `nodes/backend-central/prisma/seed.ts`

Pasos:

- [ ] Crear `nodes/backend-central/prisma/rbac-catalog.ts` con los tipos y el catálogo ACTUAL (copiar `PermDef`, `Scope`, `PERMISSIONS`, `RoleDef`, `g`, `ROLES` tal cual están hoy en `seed.ts` líneas 21–147), exportándolos:

```ts
/**
 * Catálogo RBAC (permisos + bundles de rol) — fuente de verdad testeable.
 * `seed.ts` lo importa y hace el upsert idempotente; los tests validan invariantes
 * sin tocar la BD. Convención de claves: `:` (consistente con §8).
 */
export type Kind = 'FUNCTIONAL' | 'STRUCTURAL';
export type Scope = 'OWN' | 'PROJECT' | 'GLOBAL';

export interface PermDef {
  key: string;
  label: string;
  module: string;
  kind: Kind;
  fgaRelation?: string;
  scopeable: boolean;
}

export interface RoleDef {
  key: string;
  label: string;
  grants: ReadonlyArray<{ perm: string; scope: Scope }>;
}

/** Helper: grant con scope (default PROJECT). */
export const g = (perm: string, scope: Scope = 'PROJECT'): { perm: string; scope: Scope } => ({ perm, scope });

export const PERMISSIONS: ReadonlyArray<PermDef> = [
  // … (pegar el array PERMISSIONS actual de seed.ts, sin cambios) …
];

export const ROLES: ReadonlyArray<RoleDef> = [
  // … (pegar el array ROLES actual de seed.ts, sin cambios) …
];
```

- [ ] En `nodes/backend-central/prisma/seed.ts`: borrar las definiciones inline de `Kind`, `Scope`, `PermDef`, `PERMISSIONS`, `RoleDef`, `g`, `ROLES` (líneas 21–147) y reemplazarlas por el import:

```ts
import { PERMISSIONS, ROLES } from './rbac-catalog';
```

Dejar intactos: los imports de dotenv/prisma, `DEPARTMENTS`, `main()` y el bloque de ejecución.

- [ ] Verificar que compila:

```powershell
cd nodes/backend-central; pnpm run typecheck:test
```
Esperado: sin errores (exit 0).

- [ ] Commit:
```powershell
git add nodes/backend-central/prisma/rbac-catalog.ts nodes/backend-central/prisma/seed.ts
git commit -m "refactor(seed): extraer catálogo RBAC a rbac-catalog.ts (testeable)"
```

---

### Task 2 — Agregar los permisos nuevos al catálogo (spec §2.2)

**Files:**
- modify: `nodes/backend-central/prisma/rbac-catalog.ts`

- [ ] En `PERMISSIONS`, dentro del bloque `// ── finanzas ──` (después de `finance:print:batch`), agregar los permisos de finanzas nuevos (FUNCTIONAL, `scopeable:false` = siempre GLOBAL):

```ts
  { key: 'finance:request:create', label: 'Crear solicitudes propias (reembolso + horas extra)', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:overtime:create:onbehalf', label: 'Crear horas extra en nombre de otro (sin restricción de fecha)', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:request:view:all', label: 'Ver todas las solicitudes', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:overtime:view:all', label: 'Ver todas las horas extra', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:request:approve', label: 'Aprobar / rechazar solicitudes', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'finance:payment:register', label: 'Registrar pago', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
```

- [ ] En el bloque `// ── proyectos ──`, agregar (FUNCTIONAL, `scopeable:false` — simplificado GLOBAL para Fase 1, se refina en Fase 2 por spec §2.3):

```ts
  { key: 'project:view:all', label: 'Ver toda la sección proyectos (solo lectura)', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:manage', label: 'Gestionar proyectos (cliente/faena/proyecto + equipo)', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:doc:upload:worker', label: 'Subir documentación de trabajadores', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:doc:upload:project', label: 'Subir documentación del proyecto', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project:doc:upload:hse', label: 'Subir documentación HSE', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
```

- [ ] En el bloque `// ── sistema / rbac ──` (o al final del array), agregar:

```ts
  { key: 'system:beta:full', label: 'Acceso completo con alerta de beta', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
```

- [ ] Verificar que `finance:print:batch` NO se duplica (ya existe en el bloque finanzas; se conserva tal cual). `grep -n "finance:print:batch" prisma/rbac-catalog.ts` debe dar 1 sola línea.

- [ ] Commit:
```powershell
git add nodes/backend-central/prisma/rbac-catalog.ts
git commit -m "feat(rbac): agregar permisos finanzas/proyectos/sistema (spec §2.2)"
```

---

### Task 3 — Sembrar los 10 roles de sistema + recalcular org_admin (spec §2.3)

**Files:**
- modify: `nodes/backend-central/prisma/rbac-catalog.ts`

- [ ] Al inicio del bloque `ROLES` (antes de la entrada `org_admin`), agregar el helper de bundle "todo menos beta" arriba del array:

```ts
/** Todo el catálogo a GLOBAL EXCEPTO system:beta:full (org_admin / admin_ti). */
const ALL_GLOBAL_EXCEPT_BETA = (): ReadonlyArray<{ perm: string; scope: Scope }> =>
  PERMISSIONS.filter((p) => p.key !== 'system:beta:full').map((p) => g(p.key, 'GLOBAL'));
```

- [ ] Reemplazar la entrada actual de `org_admin` (línea `{ key: 'org_admin', ... grants: PERMISSIONS.map((p) => g(p.key, 'GLOBAL')) }`) por:

```ts
  { key: 'org_admin', label: 'Administrador de organización', grants: ALL_GLOBAL_EXCEPT_BETA() },
```

- [ ] Al final del array `ROLES` (después de `client_ito`), agregar los 10 roles de sistema del spec §2.3:

```ts
  // ── Roles de sistema Fase 1 (spec §2.3) — bundles GLOBAL ──
  { key: 'trabajador', label: 'Trabajador', grants: [g('finance:request:create', 'GLOBAL')] },
  {
    key: 'admin_contrato',
    label: 'Administrador de Contrato',
    grants: [
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:request:approve', 'GLOBAL'),
      g('finance:overtime:create:onbehalf', 'GLOBAL'),
      g('project:manage', 'GLOBAL'),
    ],
  },
  {
    key: 'admin_finanzas',
    label: 'Administrador de Finanzas',
    grants: [
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:request:approve', 'GLOBAL'),
      g('finance:payment:register', 'GLOBAL'),
      g('finance:print:batch', 'GLOBAL'),
      g('project:view:all', 'GLOBAL'),
      g('project:doc:upload:worker', 'GLOBAL'),
      g('project:doc:upload:project', 'GLOBAL'),
    ],
  },
  {
    key: 'analista_rh',
    label: 'Analista de RH',
    grants: [
      g('finance:overtime:view:all', 'GLOBAL'),
      g('project:view:all', 'GLOBAL'),
      g('project:doc:upload:worker', 'GLOBAL'),
    ],
  },
  {
    key: 'analista_finanzas',
    label: 'Analista de Finanzas',
    grants: [
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:payment:register', 'GLOBAL'),
      g('finance:print:batch', 'GLOBAL'),
    ],
  },
  {
    key: 'asesor_hse',
    label: 'Asesor HSE',
    grants: [g('project:view:all', 'GLOBAL'), g('project:doc:upload:hse', 'GLOBAL')],
  },
  {
    key: 'gerencia_proyectos',
    label: 'Gerencia de Proyectos',
    grants: [
      g('finance:request:view:all', 'GLOBAL'),
      g('finance:request:approve', 'GLOBAL'),
      g('finance:overtime:create:onbehalf', 'GLOBAL'),
      g('project:manage', 'GLOBAL'),
    ],
  },
  { key: 'gerencia_rh', label: 'Gerencia de RH', grants: [g('system:beta:full', 'GLOBAL')] },
  { key: 'gerencia_general', label: 'Gerencia General', grants: [g('system:beta:full', 'GLOBAL')] },
  { key: 'admin_ti', label: 'Administrador TI', grants: ALL_GLOBAL_EXCEPT_BETA() },
```

- [ ] `pnpm run typecheck:test` (desde `nodes/backend-central`) → exit 0.

- [ ] Commit:
```powershell
git add nodes/backend-central/prisma/rbac-catalog.ts
git commit -m "feat(rbac): sembrar 10 roles de sistema + recalcular org_admin (spec §2.3)"
```

---

### Task 4 — Test de invariantes del catálogo RBAC

**Files:**
- create: `nodes/backend-central/test/prisma/rbac-catalog.spec.ts`

- [ ] Crear el test (no toca BD; valida el catálogo en memoria):

```ts
import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES } from '../../prisma/rbac-catalog';

const permKeys = new Set(PERMISSIONS.map((p) => p.key));
const roleByKey = new Map(ROLES.map((r) => [r.key, r]));

describe('rbac-catalog — invariantes', () => {
  it('todas las claves de permiso son únicas', () => {
    expect(permKeys.size).toBe(PERMISSIONS.length);
  });

  it('los 6 permisos nuevos de finanzas + 5 de proyectos + system:beta:full existen', () => {
    for (const k of [
      'finance:request:create',
      'finance:overtime:create:onbehalf',
      'finance:request:view:all',
      'finance:overtime:view:all',
      'finance:request:approve',
      'finance:payment:register',
      'project:view:all',
      'project:manage',
      'project:doc:upload:worker',
      'project:doc:upload:project',
      'project:doc:upload:hse',
      'system:beta:full',
    ]) {
      expect(permKeys.has(k)).toBe(true);
    }
  });

  it('cada grant de cada rol referencia un permiso existente', () => {
    for (const role of ROLES) {
      for (const grant of role.grants) {
        expect(permKeys.has(grant.perm)).toBe(true);
      }
    }
  });

  it('los 10 roles de sistema de Fase 1 están sembrados', () => {
    for (const k of [
      'trabajador',
      'admin_contrato',
      'admin_finanzas',
      'analista_rh',
      'analista_finanzas',
      'asesor_hse',
      'gerencia_proyectos',
      'gerencia_general',
      'gerencia_rh',
      'admin_ti',
    ]) {
      expect(roleByKey.has(k)).toBe(true);
    }
  });

  it('admin_contrato y gerencia_proyectos tienen bundles idénticos', () => {
    const a = roleByKey.get('admin_contrato')!.grants;
    const b = roleByKey.get('gerencia_proyectos')!.grants;
    expect(new Set(a.map((x) => x.perm))).toEqual(new Set(b.map((x) => x.perm)));
  });

  it('gerencia_rh y gerencia_general otorgan system:beta:full', () => {
    for (const k of ['gerencia_rh', 'gerencia_general']) {
      expect(roleByKey.get(k)!.grants.some((x) => x.perm === 'system:beta:full')).toBe(true);
    }
  });

  it('org_admin y admin_ti NO otorgan system:beta:full (no ven el banner beta)', () => {
    for (const k of ['org_admin', 'admin_ti']) {
      expect(roleByKey.get(k)!.grants.some((x) => x.perm === 'system:beta:full')).toBe(false);
    }
  });

  it('trabajador otorga finance:request:create a GLOBAL', () => {
    const t = roleByKey.get('trabajador')!.grants;
    expect(t).toEqual([{ perm: 'finance:request:create', scope: 'GLOBAL' }]);
  });
});
```

- [ ] Correr:
```powershell
cd nodes/backend-central; pnpm exec vitest run test/prisma/rbac-catalog.spec.ts
```
Esperado: `8 passed`.

- [ ] Commit:
```powershell
git add nodes/backend-central/test/prisma/rbac-catalog.spec.ts
git commit -m "test(rbac): invariantes del catálogo (permisos, bundles, 10 roles)"
```

---

### Task 5 — `PermissionService.permissionKeysForUser`

**Files:**
- modify: `nodes/backend-central/src/authz/permission.service.ts`
- modify: `nodes/backend-central/test/authz/permission.service.spec.ts`

- [ ] En `permission.service.ts`, agregar el método (después de `usersWithPermissionOnProject`, antes de `projectIdsForUser`):

```ts
  /**
   * Claves de permiso EFECTIVAS del usuario (union de los grants de todos sus
   * roles, cualquier scope). Lectura coarse para el gating de UI (`GET /auth/me`)
   * — el enforcement fino (OWN/PROJECT/STRUCTURAL→FGA) sigue en `can`/`scopeFilter`.
   * SuperAdmin (env) recibe TODO el catálogo. Sin memberships → `[]`.
   */
  async permissionKeysForUser(userId: string): Promise<string[]> {
    if (this.superAdminIds.includes(userId)) {
      const all = await this.prisma.permission.findMany({ select: { key: true } });
      return all.map((p) => p.key);
    }
    const memberships = await this.prisma.membership.findMany({ where: { userId } });
    if (memberships.length === 0) return [];
    const roleKeys = [...new Set(memberships.map((m) => m.roleKey))];
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { key: { in: roleKeys } } },
      include: { permission: { select: { key: true } } },
    });
    return [...new Set(grants.map((row) => row.permission.key))];
  }
```

- [ ] En `test/authz/permission.service.spec.ts`, extender el `PrismaMock` para que `rolePermission.findMany` y `permission.findMany` acepten los shapes nuevos. El `buildPrisma` actual ya mockea `rolePermission.findMany` (grants) y `permission.findUnique`. Agregar `permission.findMany` al mock:

En `interface PrismaMock` agregar:
```ts
  permissionFindMany?: ReturnType<typeof vi.fn>;
```
y en `buildPrisma`, dentro del objeto `mock`, agregar:
```ts
    permission: {
      findUnique: vi.fn(() => Promise.resolve(over.permission ?? null)),
      findMany: vi.fn(() => Promise.resolve(over.allPermissions ?? [])),
    },
```
(reemplazando la línea `permission: { findUnique: ... }` existente) y extender el tipo de `over` con `allPermissions?: unknown[]`.

- [ ] Agregar el bloque de tests al final del `describe('PermissionService', ...)`:

```ts
  describe('permissionKeysForUser', () => {
    it('SuperAdmin → todo el catálogo', async () => {
      const { prisma } = buildPrisma({ allPermissions: [{ key: 'a' }, { key: 'b' }] });
      const svc = new PermissionService(prisma, buildFga().fga, ['super']);
      expect(await svc.permissionKeysForUser('super')).toEqual(['a', 'b']);
    });

    it('sin memberships → []', async () => {
      const { prisma } = buildPrisma({ memberships: [] });
      const svc = new PermissionService(prisma, buildFga().fga, []);
      expect(await svc.permissionKeysForUser('u1')).toEqual([]);
    });

    it('union deduplicada de los grants de sus roles', async () => {
      const { prisma } = buildPrisma({
        memberships: [orgMember],
        grants: [
          { permission: { key: 'finance:request:create' } },
          { permission: { key: 'project:manage' } },
          { permission: { key: 'finance:request:create' } },
        ],
      });
      const svc = new PermissionService(prisma, buildFga().fga, []);
      const keys = await svc.permissionKeysForUser('u1');
      expect(new Set(keys)).toEqual(new Set(['finance:request:create', 'project:manage']));
    });
  });
```

- [ ] Correr:
```powershell
cd nodes/backend-central; pnpm exec vitest run test/authz/permission.service.spec.ts
```
Esperado: todos verdes (incl. los 3 nuevos).

- [ ] Commit:
```powershell
git add nodes/backend-central/src/authz/permission.service.ts nodes/backend-central/test/authz/permission.service.spec.ts
git commit -m "feat(authz): permissionKeysForUser para gating por permiso en /auth/me"
```

---

### Task 6 — `GET /auth/me` expone `permissions` + `resolveModules` por permiso

**Files:**
- modify: `nodes/backend-central/src/auth/auth.controller.ts`

- [ ] Import de `PermissionService` (agregar a los imports):

```ts
import { PermissionService } from '../authz/permission.service';
```

- [ ] En `MeResponse`, agregar el campo (después de `modules`):

```ts
  /** Permisos efectivos del usuario (para gating por permiso en el front). */
  permissions: string[];
```

- [ ] Reemplazar `ALL_MODULES` + `CLIENT_MODULES` por `ALL_MODULES` + defaults + mapa permiso→módulo. Borrar el bloque `CLIENT_MODULES` (líneas 51–59) y dejar:

```ts
/** Todos los módulos del sidebar. */
const ALL_MODULES = [
  'dashboard',
  'usuarios',
  'directorio',
  'finanzas',
  'operaciones',
  'proyectos',
  'recursos',
  'herramientas',
  'v-metric',
] as const;

/** Módulos visibles para TODO usuario autenticado (Inicio + Finanzas; Config/Perfil son footer). */
const DEFAULT_MODULES: readonly string[] = ['dashboard', 'finanzas'];

/** Mapa permiso→módulo: tener el permiso enciende el módulo (spec §3.1). */
const PERMISSION_MODULE: Readonly<Record<string, string>> = {
  'project:view:all': 'proyectos',
  'project:manage': 'proyectos',
  'user:read': 'usuarios',
  'user:create': 'usuarios',
  'user:update': 'usuarios',
  'directory:view:extended': 'directorio',
  'task:read': 'operaciones',
  'task:create': 'operaciones',
  'asset:manage': 'recursos',
  'asset:fields:edit': 'recursos',
  'vmetric:view': 'v-metric',
};
```

- [ ] Inyectar `PermissionService` en el constructor:

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly fga: FgaService,
    private readonly permissions: PermissionService,
  ) {}
```
(`AuthzModule` es `@Global`, así que no hace falta tocar `auth.module.ts`.)

- [ ] Reescribir el cuerpo de `me()` (bloque `Promise.all` + `return`) para calcular `permissions` y derivar `modules` de ahí:

```ts
    const [permissions, canManageRoles] = await Promise.all([
      this.permissions.permissionKeysForUser(user.id),
      this.resolveCanManageRoles(authUser.id),
    ]);
    const modules = await this.resolveModules(user.id, permissions);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      modules,
      permissions,
      canManageRoles,
    };
```

- [ ] Reemplazar `resolveModules` completo por la versión derivada de permisos:

```ts
  /**
   * Módulos visibles del usuario, DERIVADOS de sus permisos (spec §3.1).
   * - org_admin (membresía) o `system:beta:full` → todos los módulos.
   * - resto → DEFAULT_MODULES (Inicio + Finanzas) + los que encienda PERMISSION_MODULE.
   * Config y Perfil no son módulos (links de footer, siempre visibles).
   */
  private async resolveModules(userId: string, permissions: string[]): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({ where: { userId } });
    const isOrgAdmin = memberships.some((m) => m.roleKey === 'org_admin');
    if (isOrgAdmin || permissions.includes('system:beta:full')) {
      return [...ALL_MODULES];
    }
    const set = new Set<string>(DEFAULT_MODULES);
    for (const perm of permissions) {
      const mod = PERMISSION_MODULE[perm];
      if (mod !== undefined) set.add(mod);
    }
    return [...set];
  }
```

- [ ] `pnpm run typecheck:test` (desde `nodes/backend-central`) → exit 0.

- [ ] Commit:
```powershell
git add nodes/backend-central/src/auth/auth.controller.ts
git commit -m "feat(auth): /auth/me expone permissions + modules derivados de permisos (spec §3.1)"
```

---

### Task 7 — Ajustar `auth.controller.spec.ts`

**Files:**
- modify: `nodes/backend-central/test/auth/auth.controller.spec.ts`

- [ ] En `interface Mocks` agregar `permissionKeys: ReturnType<typeof vi.fn>;`.

- [ ] En `buildController`, aceptar `permissions?: string[]` en `options`, crear el mock del `PermissionService` y pasarlo al constructor (4º arg). Agregar antes del `return`:

```ts
  const permissionKeys = vi.fn(() => Promise.resolve(options.permissions ?? []));
  const permissionService = { permissionKeysForUser: permissionKeys } as unknown as import('../../src/authz/permission.service').PermissionService;
```
y cambiar la construcción:
```ts
    controller: new AuthController(prisma, gamification, fga, permissionService),
```
y añadir `permissionKeys` al objeto retornado.

- [ ] Actualizar la firma de `options` de `buildController` para incluir `permissions?: string[]`.

- [ ] Reemplazar la expectativa del test "retorna los datos públicos del usuario cuando hay sesión": ahora sin memberships → `modules: ['dashboard', 'finanzas']` y `permissions: []`:

```ts
    expect(result).toEqual({
      id: 'u1',
      email: 'colaborador@gmt.cl',
      firstName: 'Colaborador',
      lastName: 'Prueba',
      status: 'ACTIVE',
      modules: ['dashboard', 'finanzas'],
      permissions: [],
      canManageRoles: false,
    });
```

- [ ] Agregar tests nuevos dentro de `describe('AuthController · GET /auth/me', ...)`:

```ts
  it('deriva el módulo "proyectos" cuando el usuario tiene project:manage', async () => {
    const { controller } = buildController({
      user: { id: 'u1', email: 'x@gmt.cl', firstName: 'X', lastName: 'Y', status: 'ACTIVE' },
      permissions: ['project:manage'],
    });
    const result = await controller.me(ACTIVE_USER);
    expect(result.permissions).toEqual(['project:manage']);
    expect(result.modules).toEqual(expect.arrayContaining(['dashboard', 'finanzas', 'proyectos']));
    expect(result.modules).not.toContain('usuarios');
  });

  it('system:beta:full → todos los módulos', async () => {
    const { controller } = buildController({
      user: { id: 'u1', email: 'x@gmt.cl', firstName: 'X', lastName: 'Y', status: 'ACTIVE' },
      permissions: ['system:beta:full'],
    });
    const result = await controller.me(ACTIVE_USER);
    expect(result.modules).toEqual([
      'dashboard', 'usuarios', 'directorio', 'finanzas', 'operaciones', 'proyectos', 'recursos', 'herramientas', 'v-metric',
    ]);
  });
```

- [ ] Correr:
```powershell
cd nodes/backend-central; pnpm exec vitest run test/auth/auth.controller.spec.ts
```
Esperado: todos verdes.

- [ ] Commit:
```powershell
git add nodes/backend-central/test/auth/auth.controller.spec.ts
git commit -m "test(auth): /auth/me con permissions y modules derivados"
```

---

### Task 8 — Contract `ROLE_KEYS`: resolver huérfanas + agregar roles nuevos

**Files:**
- modify: `packages/contracts/src/index.ts`

- [ ] Reemplazar el array `ROLE_KEYS` (líneas 21–34) por la lista sin huérfanas y con los 10 roles nuevos:

```ts
export const ROLE_KEYS = [
  // Roles funcionales/estructurales heredados (siguen sembrados en seed.ts).
  'org_admin',
  'department_admin',
  'project_creator',
  'operator',
  'qa',
  'finance',
  'viewer',
  'client_ito',
  // Roles de sistema Fase 1 (spec §2.3).
  'trabajador',
  'admin_contrato',
  'admin_finanzas',
  'analista_rh',
  'analista_finanzas',
  'asesor_hse',
  'gerencia_proyectos',
  'gerencia_rh',
  'gerencia_general',
  'admin_ti',
] as const;
```
(Se eliminan `supervisor`, `operador`, `ito`, `adm_contrato`: nunca tuvieron bundle; ver Decisión 4. Su uso como roleKey de trabajador a nivel PROJECT no pasa por este contrato.)

- [ ] Rebuild del paquete de contracts (lo consumen back y front):
```powershell
cd packages/contracts; pnpm build
```
Esperado: genera `dist/` sin errores.

- [ ] Commit:
```powershell
git add packages/contracts/src/index.ts packages/contracts/dist
git commit -m "feat(contracts): ROLE_KEYS sin huérfanas + 10 roles de sistema (spec §2.3)"
```

---

### Task 9 — Front: tipo `AuthedUser.permissions` + `getMe`

**Files:**
- modify: `nodes/web/src/types/auth.ts`
- modify: `nodes/web/src/lib/api.ts`

- [ ] En `src/types/auth.ts`, agregar a `AuthedUser` (después de `modules`):

```ts
  /** Permisos efectivos del usuario (gating por permiso en el front). */
  permissions: string[];
```

- [ ] En `src/lib/api.ts`, `getMe` — normalizar `permissions` igual que `canManageRoles`:

```ts
  return { ...me, canManageRoles: me.canManageRoles ?? false, permissions: me.permissions ?? [] };
```

- [ ] `pnpm run typecheck` desde la raíz o `nodes/web` (ver comando real en Task 15). Por ahora seguir; se compila junto al resto.

- [ ] Commit:
```powershell
git add nodes/web/src/types/auth.ts nodes/web/src/lib/api.ts
git commit -m "feat(web): AuthedUser.permissions desde /auth/me"
```

---

### Task 10 — Hook `useHasPermission` + eliminar `useHasRole`

**Files:**
- create: `nodes/web/src/hooks/use-has-permission.ts`
- create: `nodes/web/src/hooks/use-has-permission.test.tsx`

- [ ] Crear `src/hooks/use-has-permission.ts`:

```ts
import { useAuth } from '@/context/auth-context';

/**
 * Gating por permiso (contrato compartido §3.2). Devuelve `true` si el usuario
 * autenticado tiene `permission` entre sus `permissions` (derivados de sus roles
 * en `GET /auth/me`). Mientras la sesión carga (`user` null) → `false`
 * (fail-closed): los controles quedan ocultos hasta confirmar el permiso.
 *
 * La autorización REAL la aplica el backend en cada endpoint; este hook solo
 * decide visibilidad de UI.
 */
export function useHasPermission(permission: string): boolean {
  const { user } = useAuth();
  return (user?.permissions ?? []).includes(permission);
}
```

- [ ] Crear el test `src/hooks/use-has-permission.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHasPermission } from '@/hooks/use-has-permission';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('@/context/auth-context', () => ({ useAuth: mockUseAuth }));

describe('useHasPermission', () => {
  afterEach(() => vi.restoreAllMocks());

  it('true si el permiso está en user.permissions', () => {
    mockUseAuth.mockReturnValue({ user: { permissions: ['project:manage'] } });
    expect(renderHook(() => useHasPermission('project:manage')).result.current).toBe(true);
  });

  it('false si no está', () => {
    mockUseAuth.mockReturnValue({ user: { permissions: ['finance:request:create'] } });
    expect(renderHook(() => useHasPermission('project:manage')).result.current).toBe(false);
  });

  it('false (fail-closed) si no hay usuario', () => {
    mockUseAuth.mockReturnValue({ user: null });
    expect(renderHook(() => useHasPermission('x')).result.current).toBe(false);
  });
});
```

- [ ] Correr:
```powershell
cd nodes/web; pnpm exec vitest run src/hooks/use-has-permission.test.tsx
```
Esperado: `3 passed`.

- [ ] Commit:
```powershell
git add nodes/web/src/hooks/use-has-permission.ts nodes/web/src/hooks/use-has-permission.test.tsx
git commit -m "feat(web): hook useHasPermission (lee auth-context)"
```

---

### Task 11 — Migrar `gated-action` y las 7 páginas con `*_ROLES`

**Files:**
- modify: `nodes/web/src/components/gated-action.tsx`
- modify: `nodes/web/src/pages/finanzas/index.tsx`
- modify: `nodes/web/src/pages/bodegas/index.tsx`
- modify: `nodes/web/src/pages/recursos/index.tsx`
- modify: `nodes/web/src/pages/proyectos/index.tsx`
- modify: `nodes/web/src/pages/proyectos/faenas.tsx`
- modify: `nodes/web/src/pages/proyectos/faena-proyectos.tsx`
- modify: `nodes/web/src/pages/proyectos/vista-proyecto.tsx`
- delete: `nodes/web/src/hooks/use-has-role.ts`

- [ ] `gated-action.tsx`: cambiar prop `roles` → `permissions` y usar `auth-context` directo (any-of; `GatedAction` no tiene consumidores hoy — grep sin usos fuera del propio archivo —, se mantiene la API para futuros usos):

```tsx
import type { ReactNode } from 'react';
import { useAuth } from '@/context/auth-context';

export interface GatedActionProps {
  /** Permisos que habilitan la acción. Basta con tener uno (OR). */
  permissions: string[];
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Envoltorio declarativo para ocultar acciones especiales a usuarios sin el
 * permiso requerido (gating de UI). La autorización real la aplica el backend.
 */
export function GatedAction({ permissions, children, fallback = null }: GatedActionProps) {
  const { user } = useAuth();
  const owned = new Set<string>(user?.permissions ?? []);
  const allowed = permissions.some((p) => owned.has(p));
  return <>{allowed ? children : fallback}</>;
}
```

- [ ] `pages/finanzas/index.tsx`:
  - Cambiar import `import { useHasRole } from '@/hooks/use-has-role';` → `import { useHasPermission } from '@/hooks/use-has-permission';`.
  - Borrar la const `FINANCE_MANAGER_ROLES` (línea 20) y actualizar el comentario que la referencia.
  - Cambiar `const canManageFinance = useHasRole(FINANCE_MANAGER_ROLES);` → `const canManageFinance = useHasPermission('finance:request:view:all');`.

- [ ] `pages/bodegas/index.tsx`:
  - Import `useHasPermission` (reemplaza `useHasRole`).
  - `const canManageSupplyChain = useHasRole(['org_admin', 'department_admin']);` → `const canManageSupplyChain = useHasPermission('warehouse:access');`.

- [ ] `pages/recursos/index.tsx`:
  - Import `useHasPermission` (reemplaza `useHasRole`).
  - Línea 89: `useHasRole(['org_admin', 'department_admin'])` → `useHasPermission('warehouse:access')`.
  - Línea 181: `useHasRole(['org_admin', 'department_admin', 'project_creator'])` → `useHasPermission('asset:manage')`.

- [ ] `pages/proyectos/index.tsx`:
  - Import `useHasPermission`.
  - Borrar `CLIENT_CREATE_ROLES`; `const canCreate = useHasRole(CLIENT_CREATE_ROLES);` → `const canCreate = useHasPermission('project:manage');`.

- [ ] `pages/proyectos/faenas.tsx`:
  - Import `useHasPermission`.
  - Borrar `FAENA_CREATE_ROLES`; `useHasRole(FAENA_CREATE_ROLES)` → `useHasPermission('project:manage')`.

- [ ] `pages/proyectos/faena-proyectos.tsx`:
  - Import `useHasPermission`.
  - Borrar `PROJECT_CREATE_ROLES`; `useHasRole(PROJECT_CREATE_ROLES)` → `useHasPermission('project:manage')`.

- [ ] `pages/proyectos/vista-proyecto.tsx`:
  - Import `useHasPermission`.
  - Borrar `TEAM_MANAGER_ROLES` y `SERVICE_CREATE_ROLES`.
  - `const canManageTeam = useHasRole(TEAM_MANAGER_ROLES);` → `const canManageTeam = useHasPermission('project:manage');`.
  - `const canCreateService = useHasRole(SERVICE_CREATE_ROLES);` → `const canCreateService = useHasPermission('project:manage');`.
  - (Las consts locales `'supervisor'|'ito'|'adm_contrato'` de líneas 114–116 son etiquetas de rol de trabajador PROJECT: **no** tocarlas.)

- [ ] Verificar que no quedan usos de `useHasRole`:
```powershell
cd nodes/web; Select-String -Path src -Pattern "useHasRole" -Recurse
```
Esperado: sin resultados.

- [ ] Eliminar el hook viejo:
```powershell
Remove-Item nodes/web/src/hooks/use-has-role.ts
```

- [ ] Commit:
```powershell
git add nodes/web/src
git rm nodes/web/src/hooks/use-has-role.ts
git commit -m "refactor(web): migrar gating de rol→permiso (useHasPermission) y borrar useHasRole"
```

---

### Task 12 — Guards de ruta `RequireModule` / `RequirePermission`

**Files:**
- create: `nodes/web/src/routes/require-access.tsx`
- create: `nodes/web/src/routes/require-access.test.tsx`
- modify: `nodes/web/src/App.tsx`

- [ ] Crear `src/routes/require-access.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';

/**
 * Guard de sección por MÓDULO (spec §3.2). Si el usuario entra por URL a una
 * sección cuyo módulo no está en `user.modules`, redirige a Inicio. Mientras la
 * sesión carga (`user` null) deja pasar: `ProtectedRoute` ya cubrió el gate de
 * sesión aguas arriba, y `modules` llega junto con el usuario.
 */
export function RequireModule({ module, children }: { module: string; children: ReactNode }) {
  const { user } = useAuth();
  if (user && !user.modules.includes(module)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Guard de sección por PERMISO. Redirige a Inicio si falta el permiso. */
export function RequirePermission({ permission, children }: { permission: string; children: ReactNode }) {
  const { user } = useAuth();
  if (user && !user.permissions.includes(permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] Crear el test `src/routes/require-access.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireModule } from '@/routes/require-access';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('@/context/auth-context', () => ({ useAuth: mockUseAuth }));

function renderAt(modules: string[]) {
  mockUseAuth.mockReturnValue({ user: { modules, permissions: [] } });
  return render(
    <MemoryRouter initialEntries={['/proyectos']}>
      <Routes>
        <Route path="/" element={<div>inicio</div>} />
        <Route
          path="/proyectos"
          element={<RequireModule module="proyectos"><div>proyectos</div></RequireModule>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireModule', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renderiza la sección si el módulo está permitido', () => {
    renderAt(['dashboard', 'proyectos']);
    expect(screen.getByText('proyectos')).toBeInTheDocument();
  });

  it('redirige a Inicio si el módulo no está permitido', () => {
    renderAt(['dashboard', 'finanzas']);
    expect(screen.getByText('inicio')).toBeInTheDocument();
  });
});
```

- [ ] En `src/App.tsx`, importar los guards:
```tsx
import { RequireModule } from '@/routes/require-access';
```

- [ ] Envolver los elementos de las rutas de módulo con `RequireModule`. Reemplazar cada línea de ruta indicada por su versión envuelta (dejar `/`, `/perfil*`, `/notificaciones`, `/configuracion`, `/roles`, `/design`, `/primitives/*` como están — Inicio/Perfil/Config son siempre visibles; `/roles` ya se gatea por `canManageRoles` en el nav):

```tsx
          { path: '/usuarios', element: <RequireModule module="usuarios">{lazyRoute(<UsuariosPage />)}</RequireModule> },
          { path: '/directorio', element: <RequireModule module="directorio">{lazyRoute(<DirectorioPage />)}</RequireModule> },
          { path: '/finanzas', element: <RequireModule module="finanzas">{lazyRoute(<FinanzasPage />)}</RequireModule> },
          { path: '/finanzas/:tab', element: <RequireModule module="finanzas">{lazyRoute(<FinanzasPage />)}</RequireModule> },
          { path: '/operaciones', element: <RequireModule module="operaciones">{lazyRoute(<OperacionesPage />)}</RequireModule> },
          { path: '/operaciones/:tab', element: <RequireModule module="operaciones">{lazyRoute(<OperacionesPage />)}</RequireModule> },
          { path: '/proyectos', element: <RequireModule module="proyectos">{lazyRoute(<ProyectosClientesPage />)}</RequireModule> },
          { path: '/proyectos/cliente/:clientId', element: <RequireModule module="proyectos">{lazyRoute(<ProyectosFaenasPage />)}</RequireModule> },
          { path: '/proyectos/cliente/:clientId/faena/:faenaId', element: <RequireModule module="proyectos">{lazyRoute(<ProyectosListaPage />)}</RequireModule> },
          { path: '/proyectos/proyecto/:projectId', element: <RequireModule module="proyectos">{lazyRoute(<ProyectoDetallePage />)}</RequireModule> },
          { path: '/recursos', element: <RequireModule module="recursos">{lazyRoute(<RecursosPage />)}</RequireModule> },
          { path: '/herramientas', element: <RequireModule module="herramientas">{lazyRoute(<GisToolsPage />)}</RequireModule> },
          { path: '/v-metric', element: <RequireModule module="v-metric">{lazyRoute(<MetricsDashboard />)}</RequireModule> },
```

- [ ] Correr:
```powershell
cd nodes/web; pnpm exec vitest run src/routes/require-access.test.tsx
```
Esperado: `2 passed`.

- [ ] Commit:
```powershell
git add nodes/web/src/routes/require-access.tsx nodes/web/src/routes/require-access.test.tsx nodes/web/src/App.tsx
git commit -m "feat(web): guards de ruta RequireModule/RequirePermission por sección"
```

---

### Task 13 — Banner de beta (`system:beta:full`)

**Files:**
- create: `nodes/web/src/components/layout/beta-banner.tsx`
- modify: `nodes/web/src/components/layout/app-shell.tsx`

- [ ] Crear `src/components/layout/beta-banner.tsx`:

```tsx
import { AlertTriangle } from 'lucide-react';
import { useHasPermission } from '@/hooks/use-has-permission';

/**
 * Banner no intrusivo para usuarios con `system:beta:full` (gerencias RH/general,
 * spec §3.2). Advierte que la versión está en desarrollo. Se oculta para el resto
 * (incluidos org_admin/admin_ti, que NO reciben system:beta:full).
 */
export function BetaBanner() {
  const isBeta = useHasPermission('system:beta:full');
  if (!isBeta) return null;
  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>
        Versión beta en desarrollo. Se sugiere no realizar cambios sin consultar con el
        administrador del sistema.
      </span>
    </div>
  );
}
```

- [ ] En `src/components/layout/app-shell.tsx`, importar y montar el banner arriba del `<Outlet/>` dentro de `<main>`:
  - Agregar import: `import { BetaBanner } from '@/components/layout/beta-banner';`.
  - En `ShellLayout`, dentro de `<main id="main" ...>`, envolver:

```tsx
        <main id="main" className="flex-1 overflow-x-hidden">
          <BetaBanner />
          <Outlet />
        </main>
```

- [ ] `pnpm exec vitest run` no cubre el banner (opcional); basta con typecheck en Task 15.

- [ ] Commit:
```powershell
git add nodes/web/src/components/layout/beta-banner.tsx nodes/web/src/components/layout/app-shell.tsx
git commit -m "feat(web): banner de beta para system:beta:full (spec §3.2)"
```

---

### Task 14 — Labels de roles nuevos + fix de tests de sidebar

**Files:**
- modify: `nodes/web/src/lib/role-labels.ts`
- modify: `nodes/web/src/components/layout/sidebar.test.tsx`

- [ ] En `src/lib/role-labels.ts`, agregar los 10 roles nuevos a `ROLE_LABELS` (conservar las 4 huérfanas como legacy de rol PROJECT — ver Decisión 4):

```ts
export const ROLE_LABELS: Record<RoleKey, string> = {
  org_admin: 'Administrador de organización',
  department_admin: 'Administrador de departamento',
  project_creator: 'Creador de proyectos',
  operator: 'Operador',
  qa: 'Control de calidad (QA)',
  finance: 'Finanzas',
  viewer: 'Visor',
  client_ito: 'Cliente ITO',
  // Roles de sistema Fase 1 (spec §2.3).
  trabajador: 'Trabajador',
  admin_contrato: 'Administrador de Contrato',
  admin_finanzas: 'Administrador de Finanzas',
  analista_rh: 'Analista de RH',
  analista_finanzas: 'Analista de Finanzas',
  asesor_hse: 'Asesor HSE',
  gerencia_proyectos: 'Gerencia de Proyectos',
  gerencia_rh: 'Gerencia de RH',
  gerencia_general: 'Gerencia General',
  admin_ti: 'Administrador TI',
  // Legacy: etiquetas de rol de trabajador a nivel PROYECTO (no bundles de org).
  supervisor: 'Supervisor',
  operador: 'Operador',
  ito: 'Inspector Técnico (ITO)',
  adm_contrato: 'Administrador de Contrato',
};
```
> `Record<RoleKey, string>` con `RoleKey = string` acepta cualquier clave; el índice es abierto, así que agregar/quitar claves no rompe el tipo.

- [ ] En `src/components/layout/sidebar.test.tsx`, agregar `permissions: []` al `baseUser` para satisfacer el tipo `AuthedUser`:

En la función `baseUser`, dentro del objeto retornado agregar `permissions: [] as string[],` (junto a `modules`/`canManageRoles`).

- [ ] Correr:
```powershell
cd nodes/web; pnpm exec vitest run src/components/layout/sidebar.test.tsx
```
Esperado: `2 passed`.

- [ ] Commit:
```powershell
git add nodes/web/src/lib/role-labels.ts nodes/web/src/components/layout/sidebar.test.tsx
git commit -m "feat(web): labels de roles nuevos + fix tipo en sidebar.test"
```

---

### Task 15 — Verificación integral (backend + front + lint)

**Files:** (ninguno nuevo — verificación)

- [ ] Backend: typecheck de test + suite completa:
```powershell
cd nodes/backend-central; pnpm test
```
Esperado: `typecheck:test` sin errores + toda la suite Vitest verde (incl. `rbac-catalog`, `permission.service`, `auth.controller`).

- [ ] Front: suite completa:
```powershell
cd nodes/web; pnpm test
```
Esperado: verde (incl. `use-has-permission`, `require-access`, `sidebar`, y los tests existentes de roles/auth-context sin regresión).

- [ ] Front typecheck (build de tipos) desde la raíz:
```powershell
cd C:/Users/juana/GMT/proyectos/gmt-link; pnpm build
```
Esperado: `packages/contracts`, `nodes/backend-central` y `nodes/web` compilan sin errores de tipo (verifica que la migración de `useHasRole` y `permissions` cierra a nivel de tipos).

- [ ] Lint raíz:
```powershell
cd C:/Users/juana/GMT/proyectos/gmt-link; pnpm lint
```
Esperado: sin errores. (Si `gated-action.tsx` reprueba por el `require`, aplicar la variante `useAuth` de la nota en Task 11.)

- [ ] Seed idempotente contra la BD local (WSL Postgres `gmt_link`): correr DOS veces y confirmar que la segunda no falla ni duplica:
```powershell
cd nodes/backend-central; pnpm db:seed; pnpm db:seed
```
Esperado (ambas corridas): `Permisos asegurados: N` (N = total del catálogo, mayor que antes), `Roles asegurados: org_admin, ..., admin_ti` (incluye los 10 nuevos), `Departamentos asegurados: 3`, y un conteo de `Bundles rol→permiso` estable entre corridas. Si el puerto 5432 no responde, despertar WSL (ver `CLAUDE.md`).

- [ ] Verificación funcional en vivo (política QA + Railway, `feedback_qa_gates_railway.md`): con `pnpm dev` levantado, loguear con un usuario `org_admin` y confirmar que `GET /auth/me` (DevTools → Network) trae `permissions` no vacío y `modules` completo; y con un mockup sin permisos, que solo aparecen Inicio y Finanzas en el sidebar y que entrar por URL a `/usuarios` redirige a `/`. (Los mockups por rol los crea el plan de Fase 1b; si aún no existen, validar con `org_admin` + un usuario `trabajador` sembrado manualmente.)

- [ ] Commit final (si hubo ajustes de verificación):
```powershell
git add -A
git commit -m "chore(fase1a): verificación integral roles/permisos/acceso"
```

---

## Fuera de alcance (otros planes de Fase 1)

- **Login por username + emails institucional/personal + migración de `User`** (spec §4): plan aparte. Este plan **no** toca `login.dto`, `login.tsx`, `auth.service` ni el modelo `User`.
- **Rework de Finanzas** (spec §5) y **enforcement** de los permisos `finance:*`/`project:*` en endpoints (spec §2.4): planes de Finanzas y Proyectos. Aquí solo se **siembran y exponen** los permisos.
- **Usuarios de prueba / mockups por rol** (spec §6, Fase 1b): plan aparte (consume los 10 roles sembrados acá).
- **Infra/seguridad/Git** (spec §7) y **V-Metric** (spec §8): tracks paralelos.

## Riesgos

- **`resolveModules` deja de usar `CLIENT_MODULES`**: usuarios cuyo acceso dependía del código de cliente (CAP/ALB) ahora ven módulos según **permisos**. Es el comportamiento buscado (spec §3.1), pero conviene validar en vivo (Task 15) que los usuarios demo existentes conservan el acceso esperado; si falta, se corrige asignándoles el rol/permiso correcto (no volviendo al hardcode).
- **Doble query de memberships en `/me`** (`permissionKeysForUser` + `resolveModules`): aceptable para Fase 1; si el `/me` se vuelve caliente, unificar en una sola lectura de memberships es una optimización posterior (YAGNI ahora).
