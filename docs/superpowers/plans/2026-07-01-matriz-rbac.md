# Matriz RBAC — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan task-by-task. Los pasos usan checkbox (`- [ ]`).

**Goal:** Permitir que el `org_admin` cree/edite roles dinámicos (matriz roles × permisos) que enforcen de verdad, incluidos permisos de proyecto, vía OpenFGA + Postgres.

**Architecture:** Un rol personalizado es `Role` + `RolePermission[]` en Postgres; sus permisos STRUCTURAL se materializan como **tuplas-directas** en OpenFGA al asignarse a un usuario en un scope (el modelo FGA hace cada permiso atómico `[user] or …`). Los FUNCTIONAL se resuelven en Postgres (`PermissionService`, sin cambios). Roles del sistema = solo lectura, mantienen su enforcement por relación-átomo. Gate: relación FGA `can_manage_roles` (derivada de `admin`).

**Tech Stack:** Monorepo pnpm · NestJS 11 + Prisma 6 + OpenFGA (`nodes/backend-central`) · React + Vite + TS + Tailwind + shadcn (`nodes/web`) · `@gmt-platform/contracts` · vitest · TS estricto (cero `any`).

**Spec fuente:** `docs/superpowers/specs/2026-07-01-matriz-rbac-design.md`.

**Entorno de comandos:** node/pnpm/tsc/vitest por **PowerShell**; git por **Bash** (Git Bash no corre node en esta máquina).

---

## Convenciones canónicas (spine — usar estos nombres exactos en todas las fases)

**Contracts** (`packages/contracts/src/index.ts`): `RoleKey = string` (antes unión cerrada; `ROLE_KEYS` queda solo para labels/orden de roles del sistema). Tipos nuevos: `PermissionKind`, `FgaObjectType` (`'organization'|'project'`), `PermissionCatalogItem`, `PermissionCatalogGroup`, `RoleGrant`, `RoleDetail`, `CreateRoleInput`, `UpdateRoleInput`, `AssignRoleInput`.

**Map componible** (`nodes/backend-central/src/modules/roles/composable-permissions.ts`): `COMPOSABLE_STRUCTURAL` mapea las STRUCTURAL org/proyecto a su object type. `composable(p) = kind==='FUNCTIONAL' || key ∈ COMPOSABLE_STRUCTURAL`. Un STRUCTURAL fuera del map ⇒ `composable=false`.

**RolesService**: `listPermissions`, `listRoles`, `getRole`, `createRole(input, createdById)`, `updateRole(key, input)` (403 si `isSystem`; llama `fga.resyncRole`), `deleteRole(key)` (403 `isSystem`; 409 `ROLE_IN_USE`), `cloneRole(key, label)`, `allowedScopeTypes(grants)`, priv. `slugKey(label)` (`c_<slug>`, colisión→`_2`…), `validateGrants` (existe+`composable`; scope solo si `scopeable`; STRUCTURAL homogéneos org|proyecto).

**FgaService** (nuevos): `syncRoleAssignment({userId,roleKey,scopeType,scopeId}, op)`, `resyncRole(roleKey)`.

**Endpoints**: `RolesController` gate `@RequirePermission('can_manage_roles', {type:'organization', id: ORG_ID})` → `GET /permissions`, `GET /roles`, `GET /roles/:key`, `POST /roles`, `PATCH /roles/:key`, `DELETE /roles/:key`, `POST /roles/:key/clone`. Asignación (gate `can_manage_users`): `POST /users/:id/roles` (body `AssignRoleInput`), `DELETE /users/:id/roles?roleKey=&scopeType=&scopeId=`. `GET /auth/me` += `canManageRoles: boolean`.

**FGA** (`fga/model.fga`): `organization` += `define can_manage_roles: [user] or admin`; cada `can_*` de `project` += `[user] or`. Re-bootstrap → nuevo `FGA_MODEL_ID`.

**Códigos de error**: 400 `{code: MIXED_SCOPE_LEVELS | NOT_COMPOSABLE | INVALID_SCOPE_FOR_ROLE | INVALID_SCOPE_ID}`, 403 (isSystem escritura / sin gate), 404, 409 `{code: ROLE_IN_USE}`, 502 `{code: FGA_SYNC_FAILED}`.

---

## Fase 1: Contracts + relajación de validación + modelo FGA base

### Task 1.1: `RoleKey` deja de ser unión cerrada + tipos nuevos del SPINE en contracts

**Files:**
- Modify: `C:/Users/juana/GMT Link/packages/contracts/src/index.ts`
- Test: `C:/Users/juana/GMT Link/packages/contracts/test/index.spec.ts` (nuevo — el paquete no tiene runner de test; se agrega vitest mínimo solo para este chequeo de forma/compilación)

Contexto: hoy `RoleKey` es `(typeof ROLE_KEYS)[number]` (unión cerrada). El spec (§7) exige `RoleKey = string` para que roles personalizados (`c_xxx`) tipen sin fricción; `ROLE_KEYS` se conserva solo como lista de labels/orden de los roles del sistema.

- [ ] 1. Escribir el test que falla. `packages/contracts` no tiene `vitest` instalado ni carpeta `test/`; agregar el devDependency y el script antes de escribir el test (si no, "correr y ver que falla" no es posible). Editar `C:/Users/juana/GMT Link/packages/contracts/package.json`:

  ```json
  {
    "name": "@gmt-platform/contracts",
    "version": "0.1.0",
    "private": true,
    "description": "Tipos compartidos entre nodes/backend-central y nodes/web",
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
    "devDependencies": {
      "typescript": "^5.7.3",
      "vitest": "^4.1.8"
    }
  }
  ```

  Crear `C:/Users/juana/GMT Link/packages/contracts/vitest.config.ts`:

  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      include: ['test/**/*.spec.ts'],
      environment: 'node',
    },
  });
  ```

  Crear `C:/Users/juana/GMT Link/packages/contracts/test/index.spec.ts`:

  ```ts
  /**
   * Contrato de forma del SPINE RBAC dinámico (§7 del design doc). Verifica en
   * runtime que los tipos nuevos existen con la forma esperada — el chequeo de
   * TIPOS estricto lo hace `tsc --noEmit` (Task 1.6), este spec cubre valores
   * de runtime (ROLE_KEYS) y sirve de humo si alguien vuelve `RoleKey` a unión
   * cerrada por accidente (dejaría de compilar el `const check` de abajo).
   */
  import { describe, expect, it } from 'vitest';
  import { ROLE_KEYS } from '../src/index';
  import type {
    AssignRoleInput,
    CreateRoleInput,
    FgaObjectType,
    PermissionCatalogGroup,
    PermissionCatalogItem,
    PermissionKind,
    RoleDetail,
    RoleGrant,
    RoleKey,
    UpdateRoleInput,
  } from '../src/index';

  describe('RoleKey — unión abierta (§7)', () => {
    it('acepta cualquier string, no solo ROLE_KEYS (rol personalizado c_xxx)', () => {
      const custom: RoleKey = 'c_inspector_de_campo';
      expect(typeof custom).toBe('string');
      expect(ROLE_KEYS.includes(custom as (typeof ROLE_KEYS)[number])).toBe(false);
    });

    it('ROLE_KEYS se conserva como lista de roles del sistema', () => {
      expect(ROLE_KEYS).toContain('org_admin');
      expect(ROLE_KEYS).toContain('client_ito');
    });
  });

  describe('Tipos nuevos del SPINE — forma mínima (§7)', () => {
    it('PermissionCatalogItem/Group componen', () => {
      const item: PermissionCatalogItem = {
        key: 'project:read',
        label: 'Ver proyectos',
        module: 'proyectos',
        kind: 'STRUCTURAL' as PermissionKind,
        scopeable: true,
        fgaObjectType: 'project' as FgaObjectType,
        composable: true,
      };
      const group: PermissionCatalogGroup = { module: 'proyectos', items: [item] };
      expect(group.items[0]?.key).toBe('project:read');
    });

    it('RoleDetail/RoleGrant/CreateRoleInput/UpdateRoleInput/AssignRoleInput componen', () => {
      const grant: RoleGrant = { permissionKey: 'project:read', scope: 'PROJECT' };
      const detail: RoleDetail = {
        key: 'c_inspector',
        label: 'Inspector',
        description: null,
        isSystem: false,
        allowedScopeTypes: ['PROJECT'],
        grants: [grant],
      };
      const createInput: CreateRoleInput = { label: 'Inspector', grants: [grant] };
      const updateInput: UpdateRoleInput = { grants: [grant] };
      const assignInput: AssignRoleInput = {
        roleKey: 'c_inspector',
        scopeType: 'PROJECT',
        scopeId: 'p1',
      };
      expect(detail.grants).toHaveLength(1);
      expect(createInput.label).toBe('Inspector');
      expect(updateInput.grants).toHaveLength(1);
      expect(assignInput.scopeType).toBe('PROJECT');
    });
  });
  ```

- [ ] 2. Correr y ver que falla (los tipos nuevos no existen todavía → error de compilación de vitest/esbuild):
  ```powershell
  pnpm --filter "@gmt-platform/contracts" install
  pnpm --filter "@gmt-platform/contracts" test
  ```

- [ ] 3. Implementación mínima. Editar `C:/Users/juana/GMT Link/packages/contracts/src/index.ts`:

  Reemplazar:
  ```ts
  /** Unión de claves de rol válidas. */
  export type RoleKey = (typeof ROLE_KEYS)[number];
  ```
  por:
  ```ts
  /**
   * Clave de rol. Antes unión cerrada sobre `ROLE_KEYS`; con roles dinámicos
   * (§7 design doc RBAC) cualquier string es válido (incluye roles personalizados
   * `c_xxx`). La validación dura contra la tabla `Role` la hace el backend
   * (`UsersService.validateRoleKeys` / `RolesService`), no el tipo.
   */
  export type RoleKey = string;
  ```

  Agregar al final del archivo (después de `PermissionScopeValue`):
  ```ts
  // ============ Roles dinámicos — matriz RBAC (design doc 2026-07-01) ============

  /** Naturaleza de un permiso del catálogo (§8): resuelto en Postgres o en OpenFGA. */
  export type PermissionKind = 'FUNCTIONAL' | 'STRUCTURAL';

  /** Tipo de objeto FGA sobre el que se materializa un permiso STRUCTURAL componible. */
  export type FgaObjectType = 'organization' | 'project';

  /** Item del catálogo de permisos servido por `GET /permissions`. */
  export interface PermissionCatalogItem {
    key: string;
    label: string;
    module: string;
    kind: PermissionKind;
    scopeable: boolean;
    fgaObjectType: FgaObjectType | null;
    composable: boolean;
  }

  /** Catálogo de permisos agrupado por módulo (orden: alfabético por `module`). */
  export interface PermissionCatalogGroup {
    module: string;
    items: PermissionCatalogItem[];
  }

  /** Un grant dentro de un rol: permiso + alcance de resolución FUNCTIONAL. */
  export interface RoleGrant {
    permissionKey: string;
    scope: PermissionScopeValue;
  }

  /** Detalle completo de un rol (sistema o personalizado). */
  export interface RoleDetail {
    key: string;
    label: string;
    description: string | null;
    isSystem: boolean;
    allowedScopeTypes: ScopeType[];
    grants: RoleGrant[];
  }

  /** Body de `POST /roles`. */
  export interface CreateRoleInput {
    label: string;
    description?: string;
    grants: RoleGrant[];
  }

  /** Body de `PATCH /roles/:key`. */
  export interface UpdateRoleInput {
    label?: string;
    description?: string;
    grants?: RoleGrant[];
  }

  /** Body de `POST /users/:id/roles` (asignación por scope). */
  export interface AssignRoleInput {
    roleKey: string;
    scopeType: ScopeType;
    scopeId: string;
  }
  ```

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/contracts" test
  pnpm --filter "@gmt-platform/contracts" build
  ```

- [ ] 5. Commit:
  ```bash
  git add packages/contracts/src/index.ts packages/contracts/package.json packages/contracts/vitest.config.ts packages/contracts/test/index.spec.ts
  git commit -m "feat(contracts): RoleKey abierto (string) + tipos SPINE de roles dinámicos"
  ```

---

### Task 1.2: `role-keys.ts` — `isRoleKey` deja de ser gate de forma (documentar el cambio de contrato)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/common/role-keys.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/common/role-keys.spec.ts` (nuevo)

Contexto: con `RoleKey = string`, `isRoleKey()` (`typeof value === 'string' && ROLE_KEY_SET.has(value)`) deja de ser un chequeo de "forma válida" — pasaría a ser un chequeo de "¿es uno de los 12 roles *sembrados*?", que es semánticamente distinto de "¿es un rol *que existe en la tabla Role*?" (puede ser uno personalizado `c_xxx`). Este helper ya NO debe usarse para validar `roleKeys` entrantes (esa validación pasa a la BD en Task 1.3); se mantiene únicamente como filtro defensivo de UI para separar "roles del sistema conocidos" en `directory.service.ts`/`profile.service.ts` (uso no tocado en esta fase, documentado explícitamente para que no se reintroduzca como validación de entrada).

- [ ] 1. Escribir el test que falla:
  ```ts
  /**
   * `isRoleKey` ya NO es una barrera de validación de entrada (§7 design doc RBAC):
   * con `RoleKey = string` cualquier string es una RoleKey válida por TIPO. Este
   * helper ahora es un filtro semántico ("¿es uno de los roles SEMBRADOS?") usado
   * solo para UI defensiva (directory/profile), nunca para rechazar `roleKeys`
   * entrantes — esa validación es responsabilidad de `UsersService.validateRoleKeys`
   * contra la tabla `Role` (Task 1.3).
   */
  import { describe, expect, it } from 'vitest';
  import { isRoleKey, ROLE_KEYS } from '../../src/common/role-keys';

  describe('isRoleKey — filtro de roles sembrados (no validación de entrada)', () => {
    it('true para un rol sembrado', () => {
      expect(isRoleKey('org_admin')).toBe(true);
    });

    it('false para un rol personalizado (c_xxx) aunque sea una RoleKey válida por tipo', () => {
      expect(isRoleKey('c_inspector_de_campo')).toBe(false);
    });

    it('false para valores no-string', () => {
      expect(isRoleKey(42)).toBe(false);
      expect(isRoleKey(null)).toBe(false);
    });

    it('ROLE_KEYS sigue exportando la lista de roles del sistema', () => {
      expect(ROLE_KEYS.length).toBeGreaterThan(0);
    });
  });
  ```

- [ ] 2. Correr y ver que pasa o falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/common/role-keys.spec.ts
  ```
  (El comportamiento de runtime de `isRoleKey` no cambia en este task — el test debería pasar ya con el código actual. Si pasa en el primer intento, es señal correcta: este task es de **documentación/contrato**, no de lógica. Continuar al paso 3 igual, para dejar el comentario del archivo alineado con el nuevo contrato.)

- [ ] 3. Implementación mínima — actualizar el comentario de cabecera para que no induzca a usarlo como validador de entrada:

  ```ts
  /**
   * Re-export del contrato de claves de rol compartido (§4.3 / §6-0.2).
   * Vive en `@gmt-platform/contracts` para que back y front compartan la misma
   * lista; aquí se re-exporta y se añade un helper de filtro de runtime.
   *
   * IMPORTANTE (matriz RBAC dinámica, design doc 2026-07-01 §7): desde que
   * `RoleKey` es `string` (unión abierta), `isRoleKey()` YA NO es una barrera de
   * validación de entrada — cualquier string es una `RoleKey` válida por tipo,
   * incluidos roles personalizados (`c_xxx`). Este helper solo sirve para
   * filtrar "¿es uno de los roles SEMBRADOS (ROLE_KEYS)?", útil en UI defensiva
   * (`directory.service.ts`, `profile.service.ts` listan roles conocidos).
   * La validación dura de `roleKeys` entrantes (¿existe en la tabla `Role`?) es
   * responsabilidad exclusiva de `UsersService.validateRoleKeys` / `RolesService`
   * contra Postgres — NO usar `isRoleKey` para esa validación.
   */
  import { ROLE_KEYS } from '@gmt-platform/contracts';
  import type { RoleKey } from '@gmt-platform/contracts';

  export { ROLE_KEYS };
  export type { RoleKey };

  /** Set para lookups O(1) sobre los roles SEMBRADOS (no el universo de RoleKey). */
  const ROLE_KEY_SET: ReadonlySet<string> = new Set(ROLE_KEYS);

  /** ¿`value` es uno de los roles SEMBRADOS conocidos (ROLE_KEYS)? NO es un validador de entrada. */
  export function isRoleKey(value: unknown): value is RoleKey {
    return typeof value === 'string' && ROLE_KEY_SET.has(value);
  }
  ```

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/common/role-keys.spec.ts
  ```

- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/common/role-keys.ts nodes/backend-central/test/common/role-keys.spec.ts
  git commit -m "docs(backend/role-keys): aclara que isRoleKey ya no valida entrada (RoleKey=string)"
  ```

---

### Task 1.3: `UsersService.validateRoleKeys` valida contra la tabla `Role`, no por forma

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/users/users.service.spec.ts` (nuevo)

Contexto: hoy `validateRoleKeys` rechaza con 400 cualquier `roleKey` que no esté en `ROLE_KEYS` (vía `isRoleKey`), lo que bloquearía roles personalizados (`c_xxx`) creados por `RolesService` en fases posteriores. Debe validar contra `prisma.role.findMany({ where: { key: { in: roleKeys } } })` y rechazar solo los que **no existen en la BD**. `assignRole`/`removeRole` llaman a este mismo método — no se tocan sus firmas.

- [ ] 1. Escribir el test que falla. Este service usa Prisma real; seguir el patrón de instanciar `UsersService` con dependencias fake mínimas (no hay tests previos de este service — se define aquí un fake mínimo de `PrismaService`/`FgaService`/`StorageService` acotado a lo que usa `validateRoleKeys`, expuesto vía casting a `any` **solo dentro del test**, ya que el resto de dependencias no se ejercitan en este test). Verificar primero la forma exacta de `PrismaService` para el fake:

  ```ts
  /**
   * `UsersService.validateRoleKeys` (privado, ejercitado vía `assignRole`) debe
   * validar `roleKeys` contra la tabla `Role` de Postgres, no por forma
   * (`isRoleKey`/`ROLE_KEYS`). Un rol personalizado (`c_xxx`, no sembrado) debe
   * aceptarse si existe en la BD; un rol inexistente en la BD debe rechazarse
   * aunque tenga forma válida.
   */
  import { BadRequestException } from '@nestjs/common';
  import { beforeEach, describe, expect, it, vi } from 'vitest';
  import { UsersService } from '../../../src/modules/users/users.service';

  /** Fake mínimo de PrismaService — solo los métodos que toca assignRole/validateRoleKeys. */
  function createPrismaFake(existingRoleKeys: readonly string[]) {
    return {
      role: {
        findMany: vi.fn(async ({ where }: { where: { key: { in: string[] } } }) =>
          where.key.in
            .filter((k) => existingRoleKeys.includes(k))
            .map((key) => ({ key })),
        ),
      },
      user: {
        findUnique: vi.fn(async () => ({ id: 'u1' })),
      },
      membership: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => ({})),
        findMany: vi.fn(async () => []),
      },
    };
  }

  function createFgaFake() {
    return { writeTuples: vi.fn(async () => undefined), deleteTuples: vi.fn(async () => undefined) };
  }

  function createStorageFake() {
    return {};
  }

  describe('UsersService.validateRoleKeys (vía assignRole) — valida contra Role, no por forma', () => {
    let prisma: ReturnType<typeof createPrismaFake>;
    let fga: ReturnType<typeof createFgaFake>;

    beforeEach(() => {
      prisma = createPrismaFake(['org_admin', 'c_inspector_de_campo']);
      fga = createFgaFake();
    });

    it('acepta un rol personalizado (c_xxx) que SÍ existe en la tabla Role', async () => {
      const service = new UsersService(prisma as never, fga as never, createStorageFake() as never);
      await expect(service.assignRole('u1', 'c_inspector_de_campo')).resolves.toBeDefined();
    });

    it('rechaza un roleKey con forma válida pero que NO existe en la tabla Role', async () => {
      const service = new UsersService(prisma as never, fga as never, createStorageFake() as never);
      await expect(service.assignRole('u1', 'c_no_existe')).rejects.toThrow(BadRequestException);
    });

    it('acepta un rol sembrado clásico (org_admin) como antes', async () => {
      const service = new UsersService(prisma as never, fga as never, createStorageFake() as never);
      await expect(service.assignRole('u1', 'org_admin')).resolves.toBeDefined();
    });
  });
  ```

- [ ] 2. Correr y ver que falla (hoy `validateRoleKeys` usa `isRoleKey`, que rechaza `c_inspector_de_campo` por no estar en `ROLE_KEYS` aunque el fake de Prisma lo reporte como existente):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users/users.service.spec.ts
  ```

- [ ] 3. Implementación mínima. En `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.service.ts`:

  Quitar el import de `isRoleKey` (ya no se usa como validador de forma; sigue habiendo un uso legítimo del contrato `RoleKey` como tipo, así que se conserva el import de tipo):
  ```ts
  import { isRoleKey } from '../../common/role-keys';
  import type { RoleKey } from '../../common/role-keys';
  ```
  →
  ```ts
  import type { RoleKey } from '../../common/role-keys';
  ```

  Reemplazar el método privado:
  ```ts
  /**
   * Valida `roleKeys` contra forma (RoleKey) y contra la tabla Role (§4.1).
   * Deduplica preservando orden. 400 si hay claves desconocidas en la BD.
   */
  private async validateRoleKeys(roleKeys: readonly string[]): Promise<RoleKey[]> {
    const unique: RoleKey[] = [];
    for (const raw of roleKeys) {
      if (!isRoleKey(raw)) {
        throw new BadRequestException(`Rol desconocido: "${raw}".`);
      }
      if (!unique.includes(raw)) {
        unique.push(raw);
      }
    }
    if (unique.length === 0) {
      throw new BadRequestException('Debe asignar al menos un rol.');
    }
  ```
  por:
  ```ts
  /**
   * Valida `roleKeys` contra la tabla `Role` de Postgres (§4.1, matriz RBAC
   * dinámica §7): acepta cualquier string que exista como `Role.key`, incluidos
   * roles personalizados (`c_xxx`) creados por `RolesService`. Deduplica
   * preservando orden. 400 si hay claves que no existen en la BD.
   */
  private async validateRoleKeys(roleKeys: readonly string[]): Promise<RoleKey[]> {
    const uniqueInput: string[] = [];
    for (const raw of roleKeys) {
      if (!uniqueInput.includes(raw)) {
        uniqueInput.push(raw);
      }
    }
    if (uniqueInput.length === 0) {
      throw new BadRequestException('Debe asignar al menos un rol.');
    }
    const existing = await this.prisma.role.findMany({
      where: { key: { in: uniqueInput } },
      select: { key: true },
    });
    const existingKeys = new Set(existing.map((r) => r.key));
    const missing = uniqueInput.filter((k) => !existingKeys.has(k));
    if (missing.length > 0) {
      throw new BadRequestException(`Rol desconocido: "${missing.join(', ')}".`);
    }
    const unique: RoleKey[] = uniqueInput;
  ```

  (El resto del cuerpo del método —que sigue tras la validación de `unique.length === 0` en el original— no cambia; queda igual a continuación de este bloque.)

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users/users.service.spec.ts
  ```

- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/users/users.service.ts nodes/backend-central/test/modules/users/users.service.spec.ts
  git commit -m "fix(backend/users): validateRoleKeys valida contra tabla Role, no por forma (isRoleKey)"
  ```

---

### Task 1.4: Relajar `@IsIn([...ROLE_KEYS])` → `@IsString()` en los DTOs de roles

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/dto/create-user.dto.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/dto/assign-role.dto.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/users/dto/role-dtos.spec.ts` (nuevo)

Contexto: `class-validator` con `@IsIn([...ROLE_KEYS])` rechaza en la capa de DTO (antes de llegar al service) cualquier `roleKey` fuera de los 12 sembrados — bloquearía roles personalizados. La validación real ya la hace `UsersService.validateRoleKeys` contra la BD (Task 1.3); el DTO solo debe garantizar que sea texto no vacío.

- [ ] 1. Escribir el test que falla:
  ```ts
  /**
   * Los DTOs de roleKeys ya NO restringen a ROLE_KEYS (§7 design doc RBAC): un
   * rol personalizado (c_xxx) debe pasar la validación de forma; la validación
   * dura contra la BD vive en UsersService (Task 1.3). Se mantiene el rechazo
   * de valores no-string / vacíos.
   */
  import { plainToInstance } from 'class-transformer';
  import { validate } from 'class-validator';
  import { describe, expect, it } from 'vitest';
  import { AssignRoleDto } from '../../../../src/modules/users/dto/assign-role.dto';
  import { CreateUserDto } from '../../../../src/modules/users/dto/create-user.dto';

  describe('CreateUserDto.roleKeys — acepta roles personalizados', () => {
    it('un rol personalizado (c_xxx) pasa la validación de forma', async () => {
      const dto = plainToInstance(CreateUserDto, {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@gmt.cl',
        roleKeys: ['c_inspector_de_campo'],
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('un roleKey vacío o no-string sigue siendo rechazado', async () => {
      const dto = plainToInstance(CreateUserDto, {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana@gmt.cl',
        roleKeys: [42],
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  describe('AssignRoleDto.roleKey — acepta un rol personalizado', () => {
    it('un rol personalizado (c_xxx) pasa la validación de forma', async () => {
      const dto = plainToInstance(AssignRoleDto, { roleKey: 'c_inspector_de_campo' });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('un roleKey no-string es rechazado', async () => {
      const dto = plainToInstance(AssignRoleDto, { roleKey: 42 });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    });
  });
  ```

- [ ] 2. Correr y ver que falla (hoy `@IsIn([...ROLE_KEYS])` rechaza `c_inspector_de_campo`):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users/dto/role-dtos.spec.ts
  ```

- [ ] 3. Implementación mínima.

  En `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/dto/create-user.dto.ts`:
  ```ts
  import {
    ArrayMaxSize,
    ArrayMinSize,
    ArrayNotEmpty,
    IsArray,
    IsBoolean,
    IsEmail,
    IsIn,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
  } from 'class-validator';
  import { ROLE_KEYS } from '../../../common/role-keys';
  import type { RoleKey } from '../../../common/role-keys';
  ```
  →
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
    MaxLength,
    MinLength,
  } from 'class-validator';
  import type { RoleKey } from '../../../common/role-keys';

  /** Tope defensivo de roles por usuario en un solo request (no ligado a ROLE_KEYS). */
  const MAX_ROLE_KEYS_PER_REQUEST = 20;
  ```

  Reemplazar:
  ```ts
    @IsArray()
    @ArrayNotEmpty({ message: 'Debe asignar al menos un rol.' })
    @ArrayMinSize(1)
    @ArrayMaxSize(ROLE_KEYS.length)
    @IsIn([...ROLE_KEYS], {
      each: true,
      message: `Cada rol debe ser uno de: ${ROLE_KEYS.join(', ')}.`,
    })
    roleKeys!: RoleKey[];
  ```
  por:
  ```ts
    @IsArray()
    @ArrayNotEmpty({ message: 'Debe asignar al menos un rol.' })
    @ArrayMinSize(1)
    @ArrayMaxSize(MAX_ROLE_KEYS_PER_REQUEST)
    @IsString({ each: true, message: 'Cada rol debe ser un texto no vacío.' })
    @MinLength(1, { each: true, message: 'Cada rol debe ser un texto no vacío.' })
    roleKeys!: RoleKey[];
  ```

  Actualizar también el comentario de cabecera de la clase (menciona hoy el spread defensivo de `ROLE_KEYS`, que ya no aplica):
  ```ts
  /**
   * Body de `POST /users` (§1.1). El admin provisiona un colaborador o cliente.
   * Validación de forma vía class-validator; la validación dura de `roleKeys`
   * contra la tabla Role la hace `UsersService` (espejo §4.1).
   * `ROLE_KEYS` es un readonly tuple; class-validator pide un array mutable de
   * valores permitidos, de ahí el spread defensivo.
   */
  ```
  →
  ```ts
  /**
   * Body de `POST /users` (§1.1). El admin provisiona un colaborador o cliente.
   * Validación de forma vía class-validator (solo exige texto no vacío); la
   * validación dura de `roleKeys` contra la tabla `Role` la hace `UsersService`
   * (§4.1, matriz RBAC dinámica §7 — acepta roles personalizados `c_xxx`).
   */
  ```

  En `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/dto/assign-role.dto.ts`:
  ```ts
  import { IsIn, IsString } from 'class-validator';
  import { ROLE_KEYS } from '../../../common/role-keys';
  import type { RoleKey } from '../../../common/role-keys';

  /**
   * Body de `POST /users/:id/roles` (§1.1). Asigna un rol org-scope a un usuario.
   * El borrado usa el roleKey por path param (`DELETE /users/:id/roles/:roleKey`),
   * por lo que no necesita DTO de body.
   */
  export class AssignRoleDto {
    @IsString()
    @IsIn([...ROLE_KEYS], {
      message: `El rol debe ser uno de: ${ROLE_KEYS.join(', ')}.`,
    })
    roleKey!: RoleKey;
  }
  ```
  →
  ```ts
  import { IsString, MinLength } from 'class-validator';
  import type { RoleKey } from '../../../common/role-keys';

  /**
   * Body de `POST /users/:id/roles` (§1.1). Asigna un rol org-scope a un usuario.
   * El borrado usa el roleKey por path param (`DELETE /users/:id/roles/:roleKey`),
   * por lo que no necesita DTO de body. Validación de forma vía class-validator
   * (texto no vacío); la validación dura contra la tabla `Role` la hace
   * `UsersService` (§4.1, matriz RBAC dinámica §7 — acepta roles personalizados).
   */
  export class AssignRoleDto {
    @IsString()
    @MinLength(1, { message: 'El rol es obligatorio.' })
    roleKey!: RoleKey;
  }
  ```

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users/dto/role-dtos.spec.ts
  ```

- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/users/dto/create-user.dto.ts nodes/backend-central/src/modules/users/dto/assign-role.dto.ts nodes/backend-central/test/modules/users/dto/role-dtos.spec.ts
  git commit -m "feat(backend/users): relaja @IsIn(ROLE_KEYS)->@IsString en DTOs de rol (roles dinámicos)"
  ```

---

### Task 1.5: `model.fga` — `can_manage_roles` + `[user] or` en permisos de proyecto

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/fga/model.fga`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga-model.spec.ts` (modificar — agregar tests al describe existente "Modelo OpenFGA §4.3 — derivaciones")

Contexto: §5 del design doc. `organization` gana `can_manage_roles: [user] or admin` (gate de `RolesController`, sin tupla extra: lo deriva `admin`). Cada permiso atómico de `project` pasa a admitir tupla directa `[user] or <derivaciones existentes>` — así un grant STRUCTURAL de un rol personalizado se materializa como una tupla directa sobre el usuario y el `check` la satisface sin pasar por los roles bundle.

- [ ] 1. Escribir el test que falla. Agregar estos `it()` al describe `'Modelo OpenFGA §4.3 — derivaciones'` en `test/fga-model.spec.ts` (no se toca `beforeAll`/`afterAll`; se agregan nuevas tuplas ad-hoc dentro de cada test vía `client.write`, ya que estas relaciones nuevas no están en la carga inicial):

  ```ts
    it('j) can_manage_roles: admin de organización lo deriva; un no-admin no (§5)', async () => {
      expect(await allowed('user:anna', 'can_manage_roles', 'organization:gmt')).toBe(true);
      expect(await allowed('user:bob', 'can_manage_roles', 'organization:gmt')).toBe(false);
    });

    it('k) tupla directa [user] en project.can_view pasa el check aunque no tenga ningún rol bundle (§5)', async () => {
      // 'gina' no tiene viewer/operator/qa/finance/project_creator/client_ito en p1.
      expect(await allowed('user:gina', 'can_view', 'project:p1')).toBe(false);
      await client.write({
        writes: [{ user: 'user:gina', relation: 'can_view', object: 'project:p1' }],
      });
      expect(await allowed('user:gina', 'can_view', 'project:p1')).toBe(true);
      // Aislamiento: la tupla directa en p1 no da acceso a p2 (§3.4).
      expect(await allowed('user:gina', 'can_view', 'project:p2')).toBe(false);
    });

    it('l) tupla directa [user] en project.can_create_task pasa el check (§5)', async () => {
      expect(await allowed('user:henry', 'can_create_task', 'project:p1')).toBe(false);
      await client.write({
        writes: [{ user: 'user:henry', relation: 'can_create_task', object: 'project:p1' }],
      });
      expect(await allowed('user:henry', 'can_create_task', 'project:p1')).toBe(true);
    });
  ```

- [ ] 2. Correr y ver que falla. Requiere OpenFGA local corriendo en WSL (`FGA_API_URL` del `.env` raíz); si el puerto no responde, levantar WSL primero (ver CLAUDE.md "Infraestructura local"):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga-model.spec.ts
  ```
  Debe fallar en `j` (`can_manage_roles` no existe en el modelo actual → error de relación desconocida) y en `k`/`l` (`can_view`/`can_create_task` no aceptan `[user]` directo → el `write` de la tupla directa falla o el check da `false`).

- [ ] 3. Implementación mínima. Editar `C:/Users/juana/GMT Link/nodes/backend-central/fga/model.fga`:

  En `type organization`, agregar la relación nueva:
  ```
  type organization
    relations
      define admin: [user]
      define member: [user] or admin
      # permisos atómicos org-scope (§3.1 "rol chico por método")
      define can_manage_users: admin
      # datos extendidos de directorio (§8 directory:view:extended, §6-1.6) — derivado de admin
      define can_view_directory_extended: admin
      # revisión de documentos personales (§8 document:review, §6-1.5) — derivado de admin
      define can_review_documents: admin
      # gestión de finanzas (§8 finance:manage, §6-3.1/3.3) — derivado de admin
      define can_manage_finance: admin
  ```
  →
  ```
  type organization
    relations
      define admin: [user]
      define member: [user] or admin
      # permisos atómicos org-scope (§3.1 "rol chico por método")
      define can_manage_users: admin
      # datos extendidos de directorio (§8 directory:view:extended, §6-1.6) — derivado de admin
      define can_view_directory_extended: admin
      # revisión de documentos personales (§8 document:review, §6-1.5) — derivado de admin
      define can_review_documents: admin
      # gestión de finanzas (§8 finance:manage, §6-3.1/3.3) — derivado de admin
      define can_manage_finance: admin
      # gestión de roles dinámicos (matriz RBAC, design doc 2026-07-01 §5) — gate de RolesController
      define can_manage_roles: [user] or admin
  ```

  En `type project`, anteponer `[user] or` a cada permiso atómico:
  ```
    # permisos atómicos (derivados)
    define can_view: viewer or operator or qa or finance or project_creator or client_ito
    define can_create_task: operator or project_creator
    define can_assign_task: project_creator or admin from department
    define can_define_kpi: project_creator
    define can_create_service: project_creator
    define can_submit_measurements: operator or qa or project_creator
  ```
  →
  ```
    # permisos atómicos (derivados). "[user] or ..." los hace componibles: un rol
    # personalizado (matriz RBAC, design doc 2026-07-01 §5) se materializa como
    # tupla directa (user:U, can_x, project:P) y el check la satisface directo.
    define can_view: [user] or viewer or operator or qa or finance or project_creator or client_ito
    define can_create_task: [user] or operator or project_creator
    define can_assign_task: [user] or project_creator or admin from department
    define can_define_kpi: [user] or project_creator
    define can_create_service: [user] or project_creator
    define can_submit_measurements: [user] or operator or qa or project_creator
  ```

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga-model.spec.ts
  ```

- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/fga/model.fga nodes/backend-central/test/fga-model.spec.ts
  git commit -m "feat(fga): can_manage_roles en organization + [user] or en permisos de proyecto (§5)"
  ```

---

### Task 1.6: Verificación de compilación del monorepo (contracts + backend-central)

**Files:**
- Test: ninguno nuevo (verificación de tipos de los archivos tocados en 1.1–1.5)

- [ ] 1. No aplica "test que falla" — este task es una puerta de verificación tipográfica sobre los cambios previos, no introduce comportamiento nuevo. Ejecutar primero para confirmar que **antes** de revisar manualmente ya compila (si falla, es señal de un error introducido en 1.1–1.4 que hay que resolver antes de seguir):
  ```powershell
  pnpm --filter "@gmt-platform/contracts" build
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 2. Si `tsc --noEmit` falla, revisar el error puntual (probablemente un uso remanente de `ROLE_KEYS`/`IsIn` en algún DTO no tocado, o un import roto de `isRoleKey`) y corregirlo con un fix mínimo y quirúrgico en el archivo señalado por el compilador — no tocar archivos fuera de los de esta fase salvo que el error de tipos los involucre directamente.
- [ ] 3. Implementación: N/A (paso de verificación).
- [ ] 4. Correr y confirmar verde:
  ```powershell
  pnpm --filter "@gmt-platform/contracts" build
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  pnpm --filter "@gmt-platform/backend-central" exec vitest run
  ```
- [ ] 5. Commit (solo si el paso 2 requirió cambios; si todo compiló limpio en el paso 1, no hay nada que commitear en este task):
  ```bash
  git add -A
  git commit -m "fix(backend/contracts): ajustes de tipos tras RoleKey=string (verificación tsc)"
  ```

---

### Task 1.7: Re-bootstrap de OpenFGA local + nota para Railway

**Files:**
- Modify: `C:/Users/juana/GMT Link/.env` (raíz del monorepo — `FGA_MODEL_ID` lo reescribe el script, no a mano)
- Test: ninguno nuevo (la verificación es el propio `fga-model.spec.ts` de Task 1.5, que ya corre contra el modelo recién publicado)

Contexto: `fga:bootstrap` (`nodes/backend-central/scripts/fga-bootstrap.ts`) sube el DSL de `fga/model.fga` como una **nueva versión** del authorization model en el store existente (`gmt-link`) y reescribe `FGA_STORE_ID`/`FGA_MODEL_ID` en el `.env` raíz. Las tuplas ya escritas persisten (independientes del modelo); no hay migración de datos.

- [ ] 1. Verificar que WSL/OpenFGA local están arriba antes de correr el bootstrap (si el puerto 5432/8080 no responde, levantar WSL primero — ver CLAUDE.md "Infraestructura local"):
  ```powershell
  # Si OpenFGA local no responde, ver nota de WSL en CLAUDE.md antes de continuar.
  Invoke-WebRequest -Uri "$($env:FGA_API_URL)/healthz" -UseBasicParsing
  ```
- [ ] 2. Correr el bootstrap (re-publica el modelo con `can_manage_roles` + `[user] or` de Task 1.5):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" run fga:bootstrap
  ```
- [ ] 3. Confirmar que el `.env` raíz quedó con el `FGA_MODEL_ID` nuevo (el script lo reescribe automáticamente — no editar a mano) y correr el spec de modelo contra él:
  ```powershell
  Select-String -Path ".env" -Pattern "FGA_MODEL_ID"
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga-model.spec.ts
  ```
- [ ] 4. Verificación manual del criterio de aceptación del design doc §9 (`check(admin, can_manage_roles, organization:gmt)=true`) — ya cubierta por el test `j)` de Task 1.5; confirmar que sigue en verde con el `FGA_MODEL_ID` nuevo (no el efímero del test, sino el real del store `gmt-link`) si se quiere doble chequeo manual:
  ```powershell
  # Opcional, verificación manual contra el store real (no el store de test):
  # usar el SDK o `fga query check` si está disponible; el spec automatizado ya cubre el caso equivalente.
  ```
- [ ] 5. Nota para Railway (acción manual del usuario, NO automatizable desde este entorno): tras mergear esta fase, actualizar la variable de entorno `FGA_MODEL_ID` en el servicio de backend-central en Railway con el valor nuevo escrito en el `.env` local (paso 3), y re-desplegar. El `FGA_STORE_ID` de Railway no cambia (mismo store, nueva versión de modelo). No hay commit de código para este paso — es una tarea de infraestructura pendiente para quien tenga acceso al dashboard de Railway (marcada como pendiente, no bloqueante para el resto de la Fase 1/2 en local).
- [ ] 6. Commit (el único artefacto de código que cambia es el `.env` raíz, que normalmente está gitignored — verificar antes de intentar commitear):
  ```bash
  git status --short .env
  # Si .env está trackeado (no debería estarlo), NO commitear credenciales/IDs de store sin revisar con el usuario.
  # Si está gitignored (esperado), no hay nada que commitear en este task.
  ```

---

## Fase 2: RolesModule — lectura + CRUD

### Task 2.1: Contracts — tipos de catálogo, rol y grants

**Files:**
- Modify: `C:/Users/juana/GMT Link/packages/contracts/src/index.ts`
- Test: `C:/Users/juana/GMT Link/packages/contracts/src/index.spec.ts` (crear si no existe)

- [ ] 1. Escribir el test que falla (`packages/contracts/src/index.spec.ts`):

```ts
import { describe, expect, it } from 'vitest';
import { ROLE_KEYS } from './index';
import type {
  AssignRoleInput,
  CreateRoleInput,
  FgaObjectType,
  PermissionCatalogGroup,
  PermissionCatalogItem,
  PermissionKind,
  RoleDetail,
  RoleGrant,
  RoleKey,
  UpdateRoleInput,
} from './index';

describe('contracts RBAC dinámico (Módulo 4 Fase 2)', () => {
  it('RoleKey acepta cualquier string (rol custom incluido)', () => {
    const key: RoleKey = 'c_supervisor_norte';
    expect(typeof key).toBe('string');
  });

  it('ROLE_KEYS sigue existiendo como lista de roles del sistema', () => {
    expect(ROLE_KEYS).toContain('org_admin');
    expect(ROLE_KEYS.length).toBeGreaterThan(0);
  });

  it('PermissionCatalogItem tiene la forma esperada', () => {
    const item: PermissionCatalogItem = {
      key: 'project:read',
      label: 'Ver proyectos',
      module: 'proyectos',
      kind: 'STRUCTURAL' as PermissionKind,
      scopeable: true,
      fgaObjectType: 'project' as FgaObjectType,
      composable: true,
    };
    expect(item.key).toBe('project:read');
  });

  it('PermissionCatalogGroup agrupa items por módulo', () => {
    const group: PermissionCatalogGroup = {
      module: 'proyectos',
      items: [],
    };
    expect(group.items).toEqual([]);
  });

  it('RoleGrant liga permiso + scope', () => {
    const grant: RoleGrant = { permissionKey: 'task:read', scope: 'PROJECT' };
    expect(grant.scope).toBe('PROJECT');
  });

  it('RoleDetail describe un rol completo con grants', () => {
    const detail: RoleDetail = {
      key: 'c_demo',
      label: 'Demo',
      description: null,
      isSystem: false,
      allowedScopeTypes: ['PROJECT'],
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    };
    expect(detail.grants).toHaveLength(1);
  });

  it('CreateRoleInput y UpdateRoleInput tienen los campos opcionales correctos', () => {
    const create: CreateRoleInput = { label: 'Demo', grants: [] };
    const update: UpdateRoleInput = {};
    expect(create.label).toBe('Demo');
    expect(update).toEqual({});
  });

  it('AssignRoleInput liga roleKey + scope', () => {
    const input: AssignRoleInput = { roleKey: 'c_demo', scopeType: 'PROJECT', scopeId: 'proj_1' };
    expect(input.scopeId).toBe('proj_1');
  });
});
```

- [ ] 2. Correr y ver que falla (los tipos nuevos no existen todavía):
  `pnpm --filter "@gmt-platform/contracts" exec vitest run src/index.spec.ts`

- [ ] 3. Implementación mínima. En `packages/contracts/src/index.ts`, cambiar la declaración de `RoleKey` y agregar los tipos nuevos justo debajo del bloque `PermissionScopeValue` existente:

Reemplazar:
```ts
/** Unión de claves de rol válidas. */
export type RoleKey = (typeof ROLE_KEYS)[number];
```
por:
```ts
/**
 * Clave de rol. Antes era la unión cerrada de `ROLE_KEYS`; desde el RBAC
 * dinámico (Módulo 4 Fase 2) el admin puede crear roles custom (`c_...`), así
 * que el tipo es `string`. `ROLE_KEYS` se conserva como lista de los roles
 * DEL SISTEMA (sembrados, no editables) para labels/orden en la UI.
 */
export type RoleKey = string;
```

Agregar al final del archivo (después de `PermissionScopeValue`):
```ts
// ============ RBAC dinámico — catálogo y CRUD de roles (Módulo 4 Fase 2) ============

/** Cómo se enforcea un permiso: filtro de datos (FUNCTIONAL) vs. relación FGA (STRUCTURAL). */
export type PermissionKind = 'FUNCTIONAL' | 'STRUCTURAL';

/** Tipo de objeto OpenFGA sobre el que aplica un permiso STRUCTURAL (§4.3). */
export type FgaObjectType = 'organization' | 'project';

/**
 * Entrada del catálogo de permisos para la matriz RBAC (GET /permissions).
 * `composable` indica si el permiso puede incluirse en un rol CUSTOM: siempre
 * true para FUNCTIONAL; para STRUCTURAL solo si está en el mapa composable del
 * backend (`COMPOSABLE_STRUCTURAL`). `fgaObjectType` es `null` para FUNCTIONAL
 * y para STRUCTURAL fuera del mapa composable.
 */
export interface PermissionCatalogItem {
  key: string;
  label: string;
  module: string;
  kind: PermissionKind;
  scopeable: boolean;
  fgaObjectType: FgaObjectType | null;
  composable: boolean;
}

/** Agrupador de permisos por módulo, para pintar la matriz por secciones. */
export interface PermissionCatalogGroup {
  module: string;
  items: PermissionCatalogItem[];
}

/** Un grant dentro de un rol: permiso + su scope asignado. */
export interface RoleGrant {
  permissionKey: string;
  scope: PermissionScopeValue;
}

/**
 * Vista completa de un rol (GET /roles, GET /roles/:key). `allowedScopeTypes`
 * es derivado (no se persiste): PROJECT si algún grant STRUCTURAL es de
 * proyecto, si no ORGANIZATION.
 */
export interface RoleDetail {
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  allowedScopeTypes: ScopeType[];
  grants: RoleGrant[];
}

/** Body de `POST /roles`. */
export interface CreateRoleInput {
  label: string;
  description?: string;
  grants: RoleGrant[];
}

/** Body de `PATCH /roles/:key`. Todos los campos opcionales. */
export interface UpdateRoleInput {
  label?: string;
  description?: string;
  grants?: RoleGrant[];
}

/** Body de `POST /users/:id/roles` (asignación de rol por scope, Fase 3). */
export interface AssignRoleInput {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
}
```

- [ ] 4. Correr y ver que pasa: `pnpm --filter "@gmt-platform/contracts" exec vitest run src/index.spec.ts`
      Además compilar el resto del monorepo para detectar breakage por el cambio de `RoleKey` de unión cerrada a `string`:
      `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit` y `pnpm --filter "@gmt-platform/web" exec tsc --noEmit` (si algo rompe por asumir la unión cerrada, es esperado que siga compilando porque `string` es más permisivo — no debería romper nada; si rompe, es una señal real a investigar, no ignorar).

- [ ] 5. Commit:
  ```bash
  git add "packages/contracts/src/index.ts" "packages/contracts/src/index.spec.ts"
  git commit -m "feat(contracts): RoleKey abierto + tipos de catálogo/CRUD de roles (Fase 2)"
  ```

---

### Task 2.2: composable-permissions.ts — mapa SPINE + helpers

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/composable-permissions.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/composable-permissions.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
import { describe, expect, it } from 'vitest';
import { COMPOSABLE_STRUCTURAL, composable, fgaObjectTypeOf } from './composable-permissions';
import type { PermissionKind } from '@gmt-platform/contracts';

interface FakePermission {
  key: string;
  kind: PermissionKind;
}

describe('composable-permissions (SPINE Fase 2)', () => {
  it('COMPOSABLE_STRUCTURAL contiene exactamente el mapa del SPINE', () => {
    expect(COMPOSABLE_STRUCTURAL).toEqual({
      'directory:view:extended': 'organization',
      'document:review': 'organization',
      'finance:manage': 'organization',
      'project:read': 'project',
      'project:kpi:define': 'project',
      'service:create': 'project',
      'measurement:submit': 'project',
      'measurement:read': 'project',
      'task:read': 'project',
      'task:create': 'project',
      'task:assign': 'project',
    });
  });

  it('composable() es true para cualquier permiso FUNCTIONAL', () => {
    const p: FakePermission = { key: 'user:create', kind: 'FUNCTIONAL' };
    expect(composable(p)).toBe(true);
  });

  it('composable() es true para STRUCTURAL dentro del mapa', () => {
    const p: FakePermission = { key: 'task:read', kind: 'STRUCTURAL' };
    expect(composable(p)).toBe(true);
  });

  it('composable() es false para STRUCTURAL fuera del mapa', () => {
    const p: FakePermission = { key: 'document:sign:qa', kind: 'STRUCTURAL' };
    expect(composable(p)).toBe(false);
  });

  it('fgaObjectTypeOf() es null para FUNCTIONAL', () => {
    const p: FakePermission = { key: 'user:create', kind: 'FUNCTIONAL' };
    expect(fgaObjectTypeOf(p)).toBeNull();
  });

  it('fgaObjectTypeOf() devuelve "organization" para STRUCTURAL org-level', () => {
    const p: FakePermission = { key: 'finance:manage', kind: 'STRUCTURAL' };
    expect(fgaObjectTypeOf(p)).toBe('organization');
  });

  it('fgaObjectTypeOf() devuelve "project" para STRUCTURAL project-level', () => {
    const p: FakePermission = { key: 'task:assign', kind: 'STRUCTURAL' };
    expect(fgaObjectTypeOf(p)).toBe('project');
  });

  it('fgaObjectTypeOf() es null para STRUCTURAL fuera del mapa', () => {
    const p: FakePermission = { key: 'document:sign:client', kind: 'STRUCTURAL' };
    expect(fgaObjectTypeOf(p)).toBeNull();
  });
});
```

- [ ] 2. Correr y ver que falla (el módulo no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/composable-permissions.spec.ts`

- [ ] 3. Implementación mínima. Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/composable-permissions.ts`:

```ts
import type { FgaObjectType, PermissionKind } from '@gmt-platform/contracts';

/** Forma mínima de un Permission necesaria para decidir composabilidad. */
export interface ComposablePermissionInput {
  key: string;
  kind: PermissionKind;
}

/**
 * Mapa SPINE (§ diseño RBAC dinámico, Fase 2): qué permisos STRUCTURAL pueden
 * incluirse en un rol CUSTOM y sobre qué tipo de objeto FGA aplican. Un
 * permiso STRUCTURAL que NO está en este mapa (p. ej. document:sign:qa,
 * asset:*) es exclusivo de los roles del sistema (isSystem=true): el admin no
 * puede componerlo en un rol propio porque su relación FGA depende de tuplas
 * que este módulo no sabe sincronizar de forma genérica (§4.3).
 *
 * Ampliar este mapa es la ÚNICA forma de habilitar un permiso STRUCTURAL
 * nuevo para roles custom; añadirlo aquí y en el modelo FGA (`[user] or ...`)
 * son los dos lados de la misma decisión.
 */
export const COMPOSABLE_STRUCTURAL: Readonly<Record<string, FgaObjectType>> = {
  'directory:view:extended': 'organization',
  'document:review': 'organization',
  'finance:manage': 'organization',
  'project:read': 'project',
  'project:kpi:define': 'project',
  'service:create': 'project',
  'measurement:submit': 'project',
  'measurement:read': 'project',
  'task:read': 'project',
  'task:create': 'project',
  'task:assign': 'project',
};

/**
 * ¿Puede `permission` incluirse en los grants de un rol CUSTOM?
 * FUNCTIONAL: siempre sí (se enforcea con filtro de datos, sin tocar FGA).
 * STRUCTURAL: solo si está en `COMPOSABLE_STRUCTURAL`.
 */
export function composable(permission: ComposablePermissionInput): boolean {
  return permission.kind === 'FUNCTIONAL' || permission.key in COMPOSABLE_STRUCTURAL;
}

/**
 * Tipo de objeto FGA sobre el que aplica `permission`, o `null` si no aplica
 * (FUNCTIONAL, o STRUCTURAL fuera del mapa composable).
 */
export function fgaObjectTypeOf(permission: ComposablePermissionInput): FgaObjectType | null {
  if (permission.kind === 'FUNCTIONAL') return null;
  return COMPOSABLE_STRUCTURAL[permission.key] ?? null;
}
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/composable-permissions.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/composable-permissions.ts" "nodes/backend-central/src/modules/roles/composable-permissions.spec.ts"
  git commit -m "feat(roles): mapa COMPOSABLE_STRUCTURAL + helpers composable()/fgaObjectTypeOf()"
  ```

---

### Task 2.3: DTOs de creación y actualización de rol

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/create-role.dto.ts`
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/update-role.dto.ts`
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/role-grant.dto.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/create-role.dto.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateRoleDto } from './create-role.dto';
import { UpdateRoleDto } from './update-role.dto';

async function validateDto<T extends object>(cls: new () => T, plain: unknown): Promise<string[]> {
  const instance = plainToInstance(cls, plain, {});
  const failures = await validate(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return failures.flatMap((f) => Object.values(f.constraints ?? {}));
}

describe('CreateRoleDto', () => {
  it('acepta un payload válido mínimo', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Supervisor Norte',
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    expect(errors).toEqual([]);
  });

  it('rechaza label vacío', async () => {
    const errors = await validateDto(CreateRoleDto, { label: '', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza label > 80 chars', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'a'.repeat(81),
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza description > 255 chars', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Demo',
      description: 'a'.repeat(256),
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza grants vacío (mínimo 1)', async () => {
    const errors = await validateDto(CreateRoleDto, { label: 'Demo', grants: [] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza más de 50 grants', async () => {
    const grants = Array.from({ length: 51 }, (_, i) => ({ permissionKey: `perm:${i}`, scope: 'PROJECT' }));
    const errors = await validateDto(CreateRoleDto, { label: 'Demo', grants });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza scope inválido dentro de un grant', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Demo',
      grants: [{ permissionKey: 'task:read', scope: 'BOGUS' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza campos extra (whitelist)', async () => {
    const errors = await validateDto(CreateRoleDto, {
      label: 'Demo',
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
      isSystem: true,
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateRoleDto', () => {
  it('acepta payload vacío (todos los campos opcionales)', async () => {
    const errors = await validateDto(UpdateRoleDto, {});
    expect(errors).toEqual([]);
  });

  it('acepta solo label', async () => {
    const errors = await validateDto(UpdateRoleDto, { label: 'Nuevo nombre' });
    expect(errors).toEqual([]);
  });

  it('acepta solo grants', async () => {
    const errors = await validateDto(UpdateRoleDto, {
      grants: [{ permissionKey: 'task:read', scope: 'GLOBAL' }],
    });
    expect(errors).toEqual([]);
  });

  it('rechaza label vacío si viene presente', async () => {
    const errors = await validateDto(UpdateRoleDto, { label: '' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] 2. Correr y ver que falla:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/dto/create-role.dto.spec.ts`

- [ ] 3. Implementación mínima.

Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/role-grant.dto.ts`:
```ts
import { IsIn, IsString, MinLength } from 'class-validator';
import type { PermissionScopeValue } from '@gmt-platform/contracts';

const SCOPE_VALUES: readonly PermissionScopeValue[] = ['OWN', 'PROJECT', 'GLOBAL'];

/**
 * Un grant dentro del body de crear/editar rol (§ diseño RBAC dinámico Fase 2).
 * La validación SEMÁNTICA (¿el permiso existe? ¿es composable? ¿scope
 * permitido para ese permiso? ¿scope homogéneo entre grants STRUCTURAL?) la
 * hace `RolesService.validateGrants`; aquí solo se valida la FORMA.
 */
export class RoleGrantDto {
  @IsString()
  @MinLength(1, { message: 'El permiso del grant es obligatorio.' })
  permissionKey!: string;

  @IsIn(SCOPE_VALUES, { message: `El scope debe ser uno de: ${SCOPE_VALUES.join(', ')}.` })
  scope!: PermissionScopeValue;
}
```

Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/create-role.dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RoleGrantDto } from './role-grant.dto';

/**
 * Body de `POST /roles` (RBAC dinámico, Fase 2). Crea un rol CUSTOM
 * (`isSystem=false`); la clave (`key`) se deriva del label vía `slugKey`
 * (RolesService), no viene en el body.
 */
export class CreateRoleDto {
  @IsString()
  @MinLength(1, { message: 'El nombre del rol es obligatorio.' })
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Debe incluir al menos un permiso.' })
  @ArrayMaxSize(50, { message: 'Un rol admite como máximo 50 permisos.' })
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  grants!: RoleGrantDto[];
}
```

Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/update-role.dto.ts`:
```ts
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { RoleGrantDto } from './role-grant.dto';

/**
 * Body de `PATCH /roles/:key` (RBAC dinámico, Fase 2). Todos los campos son
 * opcionales (actualización parcial); si `grants` viene, REEMPLAZA el set
 * completo de grants del rol (no hace merge). 403 en el service si el rol es
 * `isSystem`.
 */
export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'El nombre del rol no puede quedar vacío.' })
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'Debe incluir al menos un permiso.' })
  @ArrayMaxSize(50, { message: 'Un rol admite como máximo 50 permisos.' })
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  grants?: RoleGrantDto[];
}
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/dto/create-role.dto.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/dto/"
  git commit -m "feat(roles): DTOs create-role/update-role/role-grant con class-validator"
  ```

---

### Task 2.4: RolesService — listPermissions

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

- [ ] 1. Escribir el test que falla. Este primer test fija el patrón de mocks para todo el archivo (fake de `PrismaService` y `FgaService`):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service';
import type { FgaService } from '../../fga/fga.service';
import { RolesService } from './roles.service';

/** Fake mínimo de PrismaService: solo los métodos que RolesService usa. */
function makePrismaMock() {
  return {
    permission: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    role: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    rolePermission: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    membership: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(makePrismaMock())),
  };
}

function makeFgaMock() {
  return {
    resyncRole: vi.fn(async () => undefined),
  };
}

describe('RolesService.listPermissions', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('agrupa permisos por módulo y calcula composable/fgaObjectType', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'user:create', label: 'Crear usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
    ]);

    const groups = await service.listPermissions();

    expect(groups).toEqual([
      {
        module: 'sistema',
        items: [
          {
            key: 'user:create',
            label: 'Crear usuarios',
            module: 'sistema',
            kind: 'FUNCTIONAL',
            scopeable: false,
            fgaObjectType: null,
            composable: true,
          },
        ],
      },
      {
        module: 'tareas',
        items: [
          {
            key: 'task:read',
            label: 'Ver tareas',
            module: 'tareas',
            kind: 'STRUCTURAL',
            scopeable: true,
            fgaObjectType: 'project',
            composable: true,
          },
        ],
      },
      {
        module: 'documentos',
        items: [
          {
            key: 'document:sign:qa',
            label: 'Firmar QA',
            module: 'documentos',
            kind: 'STRUCTURAL',
            scopeable: true,
            fgaObjectType: null,
            composable: false,
          },
        ],
      },
    ]);
  });

  it('devuelve lista vacía si no hay permisos', async () => {
    prisma.permission.findMany.mockResolvedValue([]);
    const groups = await service.listPermissions();
    expect(groups).toEqual([]);
  });
});
```

- [ ] 2. Correr y ver que falla (el módulo no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts` (versión inicial con solo `listPermissions` + esqueleto; los demás métodos se completan en las tasks siguientes de esta misma clase):

```ts
import { Injectable } from '@nestjs/common';
import type { Permission } from '@prisma/client';
import type { PermissionCatalogGroup, PermissionCatalogItem } from '@gmt-platform/contracts';
import { FgaService } from '../../fga/fga.service';
import { PrismaService } from '../../prisma/prisma.service';
import { composable, fgaObjectTypeOf } from './composable-permissions';

/**
 * CRUD de roles dinámicos (RBAC dinámico, Fase 2 del diseño). Lee/escribe el
 * catálogo `Permission` y los roles `Role`+`RolePermission` de Postgres.
 * La sincronización hacia OpenFGA (`resyncRole`) es responsabilidad de
 * `FgaService` (Fase 3): este service solo la INVOCA tras cambiar grants.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
  ) {}

  /** Catálogo de permisos agrupado por módulo, con composable/fgaObjectType resueltos. */
  async listPermissions(): Promise<PermissionCatalogGroup[]> {
    const permissions = await this.prisma.permission.findMany({ orderBy: { module: 'asc' } });
    const groups: PermissionCatalogGroup[] = [];
    const indexByModule = new Map<string, number>();

    for (const permission of permissions) {
      const item = this.toCatalogItem(permission);
      const existingIndex = indexByModule.get(permission.module);
      if (existingIndex === undefined) {
        indexByModule.set(permission.module, groups.length);
        groups.push({ module: permission.module, items: [item] });
      } else {
        groups[existingIndex].items.push(item);
      }
    }
    return groups;
  }

  private toCatalogItem(permission: Permission): PermissionCatalogItem {
    return {
      key: permission.key,
      label: permission.label,
      module: permission.module,
      kind: permission.kind,
      scopeable: permission.scopeable,
      fgaObjectType: fgaObjectTypeOf(permission),
      composable: composable(permission),
    };
  }
}
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.listPermissions (catálogo agrupado por módulo)"
  ```

---

### Task 2.5: RolesService — slugKey (privado) y colisión

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

`slugKey` es privado; se testea indirectamente a través de `createRole` (que sí lo expone en el `key` del `RoleDetail` devuelto). Esta task adelanta el test de `createRole` centrado en la generación de `key`, y la implementación mínima de `slugKey` + un `createRole` todavía simplificado (sin `validateGrants` real, que llega en la Task 2.6).

- [ ] 1. Escribir el test que falla (agregar `describe` nuevo en el mismo spec file):

```ts
describe('RolesService.createRole — slugKey', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
    // Catálogo mínimo para que validateGrants (aún no implementado del todo) no falle en esta task:
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
  });

  it('genera key "c_"+slug en minúsculas sin acentos', async () => {
    prisma.role.findMany.mockResolvedValue([]); // sin colisión
    prisma.role.create.mockResolvedValue({
      id: 'role_1',
      key: 'c_supervisor_norte',
      label: 'Supervisor Norte',
      description: null,
      isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    const detail = await service.createRole(
      { label: 'Supervisor Norte', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }] },
      'user_admin_1',
    );

    expect(detail.key).toBe('c_supervisor_norte');
  });

  it('colapsa caracteres no [a-z0-9] a "_" y trunca a 40 chars', async () => {
    prisma.role.findMany.mockResolvedValue([]);
    let createdKey = '';
    prisma.role.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      createdKey = data.key;
      return { id: 'role_2', key: data.key, label: 'x', description: null, isSystem: false };
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    await service.createRole(
      {
        label: 'Ñoño!! Supervisor  de   Zona--Muy-Larga-Que-Excede-Los-Cuarenta-Caracteres',
        grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
      },
      'user_admin_1',
    );

    expect(createdKey.startsWith('c_')).toBe(true);
    expect(createdKey.length).toBeLessThanOrEqual(40);
    expect(createdKey).not.toMatch(/[^a-z0-9_]/);
    expect(createdKey).not.toMatch(/__/);
  });

  it('agrega sufijo _2 si el slug colisiona con un rol existente', async () => {
    prisma.role.findMany.mockResolvedValue([{ key: 'c_supervisor_norte' }]);
    let createdKey = '';
    prisma.role.create.mockImplementation(async ({ data }: { data: { key: string } }) => {
      createdKey = data.key;
      return { id: 'role_3', key: data.key, label: 'x', description: null, isSystem: false };
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    await service.createRole(
      { label: 'Supervisor Norte', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }] },
      'user_admin_1',
    );

    expect(createdKey).toBe('c_supervisor_norte_2');
  });
});
```

- [ ] 2. Correr y ver que falla (`createRole` no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar a `RolesService` (import de `Permission`/`RolePermission` de Prisma y de los tipos de contracts ya usados; agregar los nuevos):

```ts
// agregar a los imports existentes:
import type { CreateRoleInput, RoleDetail } from '@gmt-platform/contracts';
```

Agregar los métodos (público `createRole` provisional — se completa con `validateGrants` real en la Task 2.6 — y el privado `slugKey`):

```ts
  /** Crea un rol CUSTOM (`isSystem=false`) a partir de label + grants. */
  async createRole(input: CreateRoleInput, createdById: string): Promise<RoleDetail> {
    const key = await this.slugKey(input.label);

    const role = await this.prisma.role.create({
      data: {
        key,
        label: input.label,
        description: input.description ?? null,
        isSystem: false,
        createdById,
        permissions: {
          create: input.grants.map((grant) => ({
            scope: grant.scope,
            permission: { connect: { key: grant.permissionKey } },
          })),
        },
      },
    });

    return this.getRole(role.key);
  }

  /**
   * Deriva una `key` única tipo `c_<slug>` desde `label`: minúsculas, sin
   * acentos, `[^a-z0-9]`→`_`, colapsa `_` repetidos, recorta a 40 chars. Si
   * colisiona con una key existente agrega sufijo `_2`, `_3`, ...
   */
  private async slugKey(label: string): Promise<string> {
    const base = this.slugify(label);
    const existing = await this.prisma.role.findMany({ select: { key: true } });
    const existingKeys = new Set(existing.map((r) => r.key));

    if (!existingKeys.has(base)) {
      return base;
    }
    let suffix = 2;
    let candidate = this.withSuffix(base, suffix);
    while (existingKeys.has(candidate)) {
      suffix += 1;
      candidate = this.withSuffix(base, suffix);
    }
    return candidate;
  }

  private slugify(label: string): string {
    const normalized = label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // quita acentos/diacríticos
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    const withPrefix = `c_${normalized}`;
    return withPrefix.slice(0, 40).replace(/_+$/g, '');
  }

  private withSuffix(base: string, suffix: number): string {
    const suffixStr = `_${suffix}`;
    const trimmed = base.slice(0, 40 - suffixStr.length).replace(/_+$/g, '');
    return `${trimmed}${suffixStr}`;
  }
```

Nota: `getRole` todavía no existe (llega en la Task 2.6). Para que este archivo compile en esta task, agregar un `getRole` provisional mínimo (se reemplaza/completa en 2.6):

```ts
  /** Detalle de un rol por key. 404 si no existe (placeholder Task 2.6). */
  async getRole(key: string): Promise<RoleDetail> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { key } });
    const grantsRaw = await this.prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    });
    const grants = grantsRaw.map((g) => ({ permissionKey: g.permission.key, scope: g.scope }));
    return {
      key: role.key,
      label: role.label,
      description: role.description,
      isSystem: role.isSystem,
      allowedScopeTypes: this.allowedScopeTypes(grants),
      grants,
    };
  }

  /** ['PROJECT'] si algún grant STRUCTURAL es de proyecto (placeholder Task 2.6, ver allowedScopeTypes). */
  allowedScopeTypes(grants: ReadonlyArray<{ permissionKey: string; scope: string }>): ('ORGANIZATION' | 'PROJECT')[] {
    return grants.length > 0 ? ['ORGANIZATION'] : ['ORGANIZATION'];
  }
```

(Este `allowedScopeTypes` placeholder se reemplaza por la lógica real en la Task 2.9; aquí solo se agrega para que el archivo compile y los tests de esta task pasen.)

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.createRole con slugKey (slug+colisión) y getRole base"
  ```

---

### Task 2.6: RolesService — validateGrants (composable, scope, homogeneidad)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
describe('RolesService.createRole — validateGrants', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
    prisma.role.findMany.mockResolvedValue([]);
  });

  it('rechaza con 400 NOT_COMPOSABLE si un permiso no existe en el catálogo', async () => {
    prisma.permission.findMany.mockResolvedValue([]);

    await expect(
      service.createRole(
        { label: 'Demo', grants: [{ permissionKey: 'no:existe', scope: 'PROJECT' }] },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
  });

  it('rechaza con 400 NOT_COMPOSABLE si el permiso es STRUCTURAL fuera del mapa composable', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
    ]);

    await expect(
      service.createRole(
        { label: 'Demo', grants: [{ permissionKey: 'document:sign:qa', scope: 'PROJECT' }] },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
  });

  it('rechaza con 400 MIXED_SCOPE_LEVELS si mezcla STRUCTURAL org-level y project-level', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'finance:manage', label: 'Gestionar finanzas', module: 'finanzas', kind: 'STRUCTURAL', scopeable: false },
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);

    await expect(
      service.createRole(
        {
          label: 'Demo',
          grants: [
            { permissionKey: 'finance:manage', scope: 'GLOBAL' },
            { permissionKey: 'task:read', scope: 'PROJECT' },
          ],
        },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'MIXED_SCOPE_LEVELS' } });
  });

  it('acepta grants FUNCTIONAL + STRUCTURAL homogéneos (todos project-level)', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:read', label: 'Ver tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { key: 'task:update', label: 'Editar tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
    ]);
    prisma.role.create.mockResolvedValue({
      id: 'role_1', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
      { permission: { key: 'task:update' }, scope: 'PROJECT' },
    ]);

    const detail = await service.createRole(
      {
        label: 'Demo',
        grants: [
          { permissionKey: 'task:read', scope: 'PROJECT' },
          { permissionKey: 'task:update', scope: 'PROJECT' },
        ],
      },
      'user_1',
    );

    expect(detail.grants).toHaveLength(2);
  });

  it('rechaza scope no permitido para un permiso no scopeable (scopeable=false exige el scope declarado en catálogo, aquí GLOBAL)', async () => {
    prisma.permission.findMany.mockResolvedValue([
      { key: 'finance:manage', label: 'Gestionar finanzas', module: 'finanzas', kind: 'STRUCTURAL', scopeable: false },
    ]);

    await expect(
      service.createRole(
        { label: 'Demo', grants: [{ permissionKey: 'finance:manage', scope: 'PROJECT' }] },
        'user_1',
      ),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
  });
});
```

- [ ] 2. Correr y ver que falla:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar import de excepciones y de `RoleGrant`, y el método privado `validateGrants`; llamarlo desde `createRole` antes de `slugKey`/`prisma.role.create`:

```ts
// agregar a los imports:
import { BadRequestException } from '@nestjs/common';
import type { RoleGrant } from '@gmt-platform/contracts';
```

Modificar `createRole` para validar antes de crear:
```ts
  async createRole(input: CreateRoleInput, createdById: string): Promise<RoleDetail> {
    await this.validateGrants(input.grants);
    const key = await this.slugKey(input.label);

    const role = await this.prisma.role.create({
      data: {
        key,
        label: input.label,
        description: input.description ?? null,
        isSystem: false,
        createdById,
        permissions: {
          create: input.grants.map((grant) => ({
            scope: grant.scope,
            permission: { connect: { key: grant.permissionKey } },
          })),
        },
      },
    });

    return this.getRole(role.key);
  }
```

Agregar el método privado `validateGrants`:
```ts
  /**
   * Valida un array de grants antes de persistirlo:
   *  1. cada `permissionKey` existe en el catálogo,
   *  2. es `composable` (FUNCTIONAL siempre; STRUCTURAL solo si está en
   *     `COMPOSABLE_STRUCTURAL`), y si no lo es → 400 NOT_COMPOSABLE,
   *  3. si el permiso NO es `scopeable`, el scope del grant debe ser 'GLOBAL'
   *     (si no → 400 NOT_COMPOSABLE, mismo code: el grant no es válido para
   *     ese permiso),
   *  4. los permisos STRUCTURAL del set deben ser homogéneos en su nivel FGA
   *     (todos 'organization' o todos 'project'; mezclarlos → 400
   *     MIXED_SCOPE_LEVELS). Los FUNCTIONAL no participan de esta regla.
   */
  private async validateGrants(grants: readonly RoleGrant[]): Promise<void> {
    const keys = grants.map((g) => g.permissionKey);
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    const byKey = new Map(permissions.map((p) => [p.key, p]));

    const structuralLevels = new Set<'organization' | 'project'>();

    for (const grant of grants) {
      const permission = byKey.get(grant.permissionKey);
      if (!permission || !composable(permission)) {
        throw new BadRequestException({
          code: 'NOT_COMPOSABLE',
          message: `El permiso "${grant.permissionKey}" no existe o no puede incluirse en un rol custom.`,
        });
      }
      if (!permission.scopeable && grant.scope !== 'GLOBAL') {
        throw new BadRequestException({
          code: 'NOT_COMPOSABLE',
          message: `El permiso "${grant.permissionKey}" no admite scope: debe ir con scope GLOBAL.`,
        });
      }
      if (permission.kind === 'STRUCTURAL') {
        const objectType = fgaObjectTypeOf(permission);
        if (objectType) {
          structuralLevels.add(objectType);
        }
      }
    }

    if (structuralLevels.size > 1) {
      throw new BadRequestException({
        code: 'MIXED_SCOPE_LEVELS',
        message: 'Los permisos estructurales del rol deben ser todos de organización o todos de proyecto, no una mezcla.',
      });
    }
  }
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): validateGrants (composable, scopeable, homogeneidad estructural)"
  ```

---

### Task 2.7: RolesService — listRoles y getRole (404)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
describe('RolesService.listRoles / getRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('listRoles devuelve todos los roles con sus grants', async () => {
    prisma.role.findMany.mockResolvedValue([
      { id: 'role_1', key: 'org_admin', label: 'Admin', description: null, isSystem: true },
      { id: 'role_2', key: 'c_demo', label: 'Demo', description: 'custom', isSystem: false },
    ]);
    prisma.rolePermission.findMany.mockImplementation(async ({ where }: { where: { roleId: string } }) => {
      if (where.roleId === 'role_1') {
        return [{ permission: { key: 'user:create' }, scope: 'GLOBAL' }];
      }
      return [{ permission: { key: 'task:read' }, scope: 'PROJECT' }];
    });

    const roles = await service.listRoles();

    expect(roles).toHaveLength(2);
    expect(roles[0]).toMatchObject({ key: 'org_admin', isSystem: true });
    expect(roles[1]).toMatchObject({ key: 'c_demo', isSystem: false, description: 'custom' });
  });

  it('getRole devuelve el detalle de un rol existente', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    const detail = await service.getRole('c_demo');

    expect(detail.key).toBe('c_demo');
    expect(detail.grants).toEqual([{ permissionKey: 'task:read', scope: 'PROJECT' }]);
  });

  it('getRole lanza 404 si el rol no existe', async () => {
    prisma.role.findUniqueOrThrow.mockRejectedValue(new Error('not found'));

    await expect(service.getRole('c_no_existe')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] 2. Correr y ver que falla (falta `listRoles`; `getRole` no maneja el 404 todavía):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Reemplazar el `getRole` placeholder y agregar `listRoles`:

```ts
// agregar a los imports:
import { NotFoundException } from '@nestjs/common';
import type { Role } from '@prisma/client';
```

```ts
  /** Todos los roles (sistema + custom) con sus grants resueltos. */
  async listRoles(): Promise<RoleDetail[]> {
    const roles = await this.prisma.role.findMany({ orderBy: { createdAt: 'asc' } });
    return Promise.all(roles.map((role) => this.toRoleDetail(role)));
  }

  /** Detalle de un rol por key. 404 si no existe. */
  async getRole(key: string): Promise<RoleDetail> {
    const role = await this.findRoleOrThrow(key);
    return this.toRoleDetail(role);
  }

  private async findRoleOrThrow(key: string): Promise<Role> {
    try {
      return await this.prisma.role.findUniqueOrThrow({ where: { key } });
    } catch {
      throw new NotFoundException(`No existe un rol con key "${key}".`);
    }
  }

  private async toRoleDetail(role: Role): Promise<RoleDetail> {
    const grantsRaw = await this.prisma.rolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    });
    const grants: RoleGrant[] = grantsRaw.map((g) => ({
      permissionKey: g.permission.key,
      scope: g.scope,
    }));
    return {
      key: role.key,
      label: role.label,
      description: role.description,
      isSystem: role.isSystem,
      allowedScopeTypes: this.allowedScopeTypes(grants),
      grants,
    };
  }
```

Y en `createRole`, reemplazar la llamada final `return this.getRole(role.key);` (sigue igual, ahora usando el `getRole` real). Eliminar el `getRole` placeholder duplicado si quedó de la Task 2.5.

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.listRoles + getRole con 404"
  ```

---

### Task 2.8: RolesService — updateRole (403 isSystem, resyncRole)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
describe('RolesService.updateRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('rechaza con 403 si el rol es isSystem', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_1', key: 'org_admin', label: 'Admin', description: null, isSystem: true,
    });

    await expect(service.updateRole('org_admin', { label: 'Otro nombre' })).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.role.update).not.toHaveBeenCalled();
  });

  it('actualiza label/description sin tocar grants ni llamar a fga.resyncRole', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.role.update.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo actualizado', description: 'nueva desc', isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:read' }, scope: 'PROJECT' },
    ]);

    const detail = await service.updateRole('c_demo', { label: 'Demo actualizado', description: 'nueva desc' });

    expect(detail.label).toBe('Demo actualizado');
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(fga.resyncRole).not.toHaveBeenCalled();
  });

  it('al cambiar grants: valida, reemplaza el set y llama fga.resyncRole', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.update.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([
      { permission: { key: 'task:assign' }, scope: 'PROJECT' },
    ]);

    const detail = await service.updateRole('c_demo', {
      grants: [{ permissionKey: 'task:assign', scope: 'PROJECT' }],
    });

    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role_2' } });
    expect(fga.resyncRole).toHaveBeenCalledWith('c_demo');
    expect(detail.grants).toEqual([{ permissionKey: 'task:assign', scope: 'PROJECT' }]);
  });

  it('rechaza grants inválidos en update con 400 NOT_COMPOSABLE (misma regla que create)', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([]);

    await expect(
      service.updateRole('c_demo', { grants: [{ permissionKey: 'no:existe', scope: 'PROJECT' }] }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
  });
});
```

- [ ] 2. Correr y ver que falla (`updateRole` no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar import de `ForbiddenException` y `UpdateRoleInput`, y el método `updateRole`:

```ts
// agregar a los imports:
import { ForbiddenException } from '@nestjs/common';
import type { UpdateRoleInput } from '@gmt-platform/contracts';
```

```ts
  /**
   * Actualiza label/description/grants de un rol CUSTOM. 403 si `isSystem`
   * (los roles sembrados no son editables por el admin). Si `grants` viene en
   * el input, se valida y REEMPLAZA el set completo (delete+create), y se
   * dispara `fga.resyncRole` para que la Fase 3 reconcilie las tuplas FGA de
   * todos los usuarios con este rol asignado.
   */
  async updateRole(key: string, input: UpdateRoleInput): Promise<RoleDetail> {
    const role = await this.findRoleOrThrow(key);
    if (role.isSystem) {
      throw new ForbiddenException(`El rol "${key}" es del sistema y no se puede editar.`);
    }

    if (input.grants) {
      await this.validateGrants(input.grants);
    }

    await this.prisma.role.update({
      where: { id: role.id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });

    if (input.grants) {
      await this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await this.prisma.rolePermission.createMany({
        data: await this.grantsToRolePermissionRows(role.id, input.grants),
      });
      await this.fga.resyncRole(key);
    }

    return this.getRole(key);
  }

  /** Traduce RoleGrant[] a filas de RolePermission (resuelve permissionId por key). */
  private async grantsToRolePermissionRows(
    roleId: string,
    grants: readonly RoleGrant[],
  ): Promise<Array<{ roleId: string; permissionId: string; scope: RoleGrant['scope'] }>> {
    const keys = grants.map((g) => g.permissionKey);
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
    return grants.map((grant) => ({
      roleId,
      permissionId: idByKey.get(grant.permissionKey) as string,
      scope: grant.scope,
    }));
  }
```

Nota: `FgaService.resyncRole` aún no existe en `fga.service.ts` (lo implementa la Fase 3); para que este archivo compile, agregar en esta misma task un stub mínimo en `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts`:

```ts
  /** Reconcilia las tuplas FGA de todos los usuarios con `roleKey` asignado (implementación real: Fase 3). */
  async resyncRole(_roleKey: string): Promise<void> {
    // Fase 3: leer grants STRUCTURAL del rol + Memberships y aplicar delta de tuplas.
  }
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts" "nodes/backend-central/src/fga/fga.service.ts"
  git commit -m "feat(roles): RolesService.updateRole (403 isSystem, reemplazo de grants + fga.resyncRole)"
  ```

---

### Task 2.9: RolesService — allowedScopeTypes (homogeneidad real)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
describe('RolesService.allowedScopeTypes', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('devuelve ["PROJECT"] si algún grant STRUCTURAL es project-level', () => {
    const result = service.allowedScopeTypes([
      { permissionKey: 'task:read', scope: 'PROJECT' },
      { permissionKey: 'user:create', scope: 'GLOBAL' },
    ]);
    expect(result).toEqual(['PROJECT']);
  });

  it('devuelve ["ORGANIZATION"] si los STRUCTURAL son org-level', () => {
    const result = service.allowedScopeTypes([
      { permissionKey: 'finance:manage', scope: 'GLOBAL' },
    ]);
    expect(result).toEqual(['ORGANIZATION']);
  });

  it('devuelve ["ORGANIZATION"] si no hay grants STRUCTURAL (solo FUNCTIONAL)', () => {
    const result = service.allowedScopeTypes([
      { permissionKey: 'user:create', scope: 'GLOBAL' },
    ]);
    expect(result).toEqual(['ORGANIZATION']);
  });

  it('devuelve ["ORGANIZATION"] para grants vacíos', () => {
    expect(service.allowedScopeTypes([])).toEqual(['ORGANIZATION']);
  });
});
```

- [ ] 2. Correr y ver que falla (el placeholder actual siempre devuelve `['ORGANIZATION']`, así que el primer test — el caso PROJECT — falla):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Reemplazar el `allowedScopeTypes` placeholder por la lógica real. Como la firma pública opera sobre `RoleGrant[]` (sin `kind`/`fgaObjectType` resueltos), reconstruye el nivel a partir de `COMPOSABLE_STRUCTURAL` usando `permissionKey` directamente (evita otra consulta a Prisma: es un cálculo puro sobre el mapa SPINE):

```ts
  /**
   * ['PROJECT'] si algún grant coincide con un permiso STRUCTURAL project-level
   * del mapa `COMPOSABLE_STRUCTURAL`; si no, ['ORGANIZATION'] (incluye el caso
   * sin grants STRUCTURAL, o STRUCTURAL org-level). Los permisos FUNCTIONAL no
   * participan de este cálculo: no acotan el scope asignable del rol.
   */
  allowedScopeTypes(grants: readonly RoleGrant[]): ScopeType[] {
    const hasProjectLevel = grants.some(
      (grant) => COMPOSABLE_STRUCTURAL[grant.permissionKey] === 'project',
    );
    return hasProjectLevel ? ['PROJECT'] : ['ORGANIZATION'];
  }
```

Agregar el import de `ScopeType` y `COMPOSABLE_STRUCTURAL` (ya importado `composable`/`fgaObjectTypeOf` desde `./composable-permissions`, ahora se agrega también `COMPOSABLE_STRUCTURAL`):
```ts
import type { PermissionCatalogGroup, PermissionCatalogItem, RoleGrant, ScopeType } from '@gmt-platform/contracts';
import { COMPOSABLE_STRUCTURAL, composable, fgaObjectTypeOf } from './composable-permissions';
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): allowedScopeTypes real vía COMPOSABLE_STRUCTURAL"
  ```

---

### Task 2.10: RolesService — deleteRole (403 isSystem, 409 en uso)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
describe('RolesService.deleteRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('rechaza con 403 si el rol es isSystem', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_1', key: 'org_admin', label: 'Admin', description: null, isSystem: true,
    });

    await expect(service.deleteRole('org_admin')).rejects.toMatchObject({ status: 403 });
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('rechaza con 409 ROLE_IN_USE si tiene memberships', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.membership.count.mockResolvedValue(3);

    await expect(service.deleteRole('c_demo')).rejects.toMatchObject({
      status: 409,
      response: { code: 'ROLE_IN_USE' },
    });
    expect(prisma.role.delete).not.toHaveBeenCalled();
  });

  it('borra el rol si es custom y no tiene memberships', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.membership.count.mockResolvedValue(0);

    await service.deleteRole('c_demo');

    expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'role_2' } });
  });
});
```

- [ ] 2. Correr y ver que falla (`deleteRole` no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar import de `ConflictException` y el método:

```ts
// agregar a los imports:
import { ConflictException } from '@nestjs/common';
```

```ts
  /**
   * Borra un rol CUSTOM. 403 si `isSystem`. 409 {code:'ROLE_IN_USE'} si tiene
   * al menos una `Membership` con ese `roleKey` (cualquier scope): borrarlo
   * dejaría usuarios con un rol fantasma. El admin debe reasignar/quitar el
   * rol de esos usuarios antes de poder eliminarlo.
   */
  async deleteRole(key: string): Promise<void> {
    const role = await this.findRoleOrThrow(key);
    if (role.isSystem) {
      throw new ForbiddenException(`El rol "${key}" es del sistema y no se puede eliminar.`);
    }

    const membershipCount = await this.prisma.membership.count({ where: { roleKey: key } });
    if (membershipCount > 0) {
      throw new ConflictException({
        code: 'ROLE_IN_USE',
        message: `El rol "${key}" está asignado a ${membershipCount} usuario(s) y no se puede eliminar.`,
      });
    }

    await this.prisma.role.delete({ where: { id: role.id } });
  }
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.deleteRole (403 isSystem, 409 ROLE_IN_USE)"
  ```

---

### Task 2.11: RolesService — cloneRole

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
describe('RolesService.cloneRole', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let fga: ReturnType<typeof makeFgaMock>;
  let service: RolesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    fga = makeFgaMock();
    service = new RolesService(prisma as unknown as PrismaService, fga as unknown as FgaService);
  });

  it('clona un rol del sistema como rol custom con el nuevo label, mismos grants', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_qa', key: 'qa', label: 'QA', description: null, isSystem: true,
    });
    prisma.rolePermission.findMany
      .mockResolvedValueOnce([
        { permission: { key: 'document:read' }, scope: 'PROJECT' },
        { permission: { key: 'document:sign:qa' }, scope: 'PROJECT' },
      ])
      // segunda llamada: dentro de getRole() para el rol recién clonado
      .mockResolvedValueOnce([
        { permission: { key: 'document:read' }, scope: 'PROJECT' },
        { permission: { key: 'document:sign:qa' }, scope: 'PROJECT' },
      ]);
    prisma.permission.findMany.mockResolvedValue([
      { key: 'document:read', label: 'Ver documentos', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
      { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.create.mockResolvedValue({
      id: 'role_new', key: 'c_qa_norte', label: 'QA Norte', description: null, isSystem: false,
    });

    const detail = await service.cloneRole('qa', 'QA Norte');

    expect(detail.key).toBe('c_qa_norte');
    expect(detail.isSystem).toBe(false);
    expect(detail.label).toBe('QA Norte');
  });

  it('lanza 404 si el rol origen no existe', async () => {
    prisma.role.findUniqueOrThrow.mockRejectedValue(new Error('not found'));

    await expect(service.cloneRole('c_no_existe', 'Nuevo')).rejects.toMatchObject({ status: 404 });
  });

  it('rechaza con 400 NOT_COMPOSABLE si el rol origen tiene grants no clonables (STRUCTURAL fuera del mapa)', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_qa', key: 'qa', label: 'QA', description: null, isSystem: true,
    });
    prisma.rolePermission.findMany.mockResolvedValueOnce([
      { permission: { key: 'document:sign:qa' }, scope: 'PROJECT' },
    ]);
    prisma.permission.findMany.mockResolvedValue([
      { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
    ]);

    await expect(service.cloneRole('qa', 'QA Norte')).rejects.toMatchObject({
      status: 400,
      response: { code: 'NOT_COMPOSABLE' },
    });
  });
});
```

Nota: como se ve en el segundo test (rol `qa` sembrado con `document:sign:qa`, que está fuera de `COMPOSABLE_STRUCTURAL`), clonar un rol del sistema que use permisos exclusivos-de-sistema debe fallar con la misma regla `validateGrants` que create/update — es la conducta correcta y esperada, no un caso a "arreglar" evitando la validación.

- [ ] 2. Correr y ver que falla (`cloneRole` no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima:

```ts
  /**
   * Clona un rol EXISTENTE (sistema o custom) como un rol CUSTOM nuevo con
   * `label` propio y los mismos grants. Reutiliza `validateGrants` (si el
   * origen tiene un permiso no composable, el clon falla igual que un create
   * manual con esos mismos grants: 400 NOT_COMPOSABLE) y `slugKey` para la key.
   */
  async cloneRole(key: string, label: string): Promise<RoleDetail> {
    const source = await this.findRoleOrThrow(key);
    const sourceGrantsRaw = await this.prisma.rolePermission.findMany({
      where: { roleId: source.id },
      include: { permission: true },
    });
    const grants: RoleGrant[] = sourceGrantsRaw.map((g) => ({
      permissionKey: g.permission.key,
      scope: g.scope,
    }));

    return this.createRole({ label, description: source.description ?? undefined, grants }, source.createdById ?? undefined as unknown as string);
  }
```

Ajuste necesario: `createRole` exige `createdById: string`, pero un clon no siempre tiene un `createdById` de origen útil ni el caller siempre lo pasa aquí. Para mantener la firma del SPINE (`cloneRole(key, label)`, sin `createdById`), cambiar `createRole` para aceptar `createdById: string | null` en su firma interna, o mejor: como el controller es quien conoce al usuario actual, ajustar `cloneRole` para recibir el `createdById` del llamador también. Pero el SPINE fija `cloneRole(key: string, label: string): Promise<RoleDetail>` sin ese parámetro — se resuelve usando `null` como creador (equivalente a "creado por clonación, sin admin explícito atribuible en esta fase"; el controller de la Task 2.13 seguirá pudiendo registrar auditoría en Fases futuras si se decide). Ajustar así:

```ts
  async createRole(input: CreateRoleInput, createdById: string | null): Promise<RoleDetail> {
    // ... (sin cambios en el cuerpo, solo el tipo del parámetro)
```

Y en `cloneRole`:
```ts
    return this.createRole({ label, description: source.description ?? undefined, grants }, source.createdById);
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`
  También correr el suite completo del archivo para confirmar que el cambio de tipo de `createdById` en `createRole` no rompe los tests previos (2.4–2.10):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/src/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.cloneRole reutilizando createRole+validateGrants"
  ```

---

### Task 2.12: RolesController — endpoints con gate can_manage_roles

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.controller.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.controller.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
import { describe, expect, it, vi } from 'vitest';
import { RolesController } from './roles.controller';
import type { RolesService } from './roles.service';

function makeServiceMock() {
  return {
    listPermissions: vi.fn(),
    listRoles: vi.fn(),
    getRole: vi.fn(),
    createRole: vi.fn(),
    updateRole: vi.fn(),
    deleteRole: vi.fn(),
    cloneRole: vi.fn(),
  };
}

describe('RolesController', () => {
  it('GET /permissions delega en rolesService.listPermissions', async () => {
    const service = makeServiceMock();
    service.listPermissions.mockResolvedValue([{ module: 'tareas', items: [] }]);
    const controller = new RolesController(service as unknown as RolesService);

    const result = await controller.listPermissions();

    expect(result).toEqual([{ module: 'tareas', items: [] }]);
  });

  it('GET /roles delega en rolesService.listRoles', async () => {
    const service = makeServiceMock();
    service.listRoles.mockResolvedValue([]);
    const controller = new RolesController(service as unknown as RolesService);

    await controller.listRoles();

    expect(service.listRoles).toHaveBeenCalled();
  });

  it('GET /roles/:key delega en rolesService.getRole con el key del path', async () => {
    const service = makeServiceMock();
    service.getRole.mockResolvedValue({ key: 'c_demo' });
    const controller = new RolesController(service as unknown as RolesService);

    await controller.getRole('c_demo');

    expect(service.getRole).toHaveBeenCalledWith('c_demo');
  });

  it('POST /roles delega en rolesService.createRole con el usuario autenticado', async () => {
    const service = makeServiceMock();
    service.createRole.mockResolvedValue({ key: 'c_demo' });
    const controller = new RolesController(service as unknown as RolesService);
    const dto = { label: 'Demo', grants: [{ permissionKey: 'task:read', scope: 'PROJECT' as const }] };

    await controller.createRole(dto, { id: 'user_1' } as never);

    expect(service.createRole).toHaveBeenCalledWith(dto, 'user_1');
  });

  it('PATCH /roles/:key delega en rolesService.updateRole', async () => {
    const service = makeServiceMock();
    service.updateRole.mockResolvedValue({ key: 'c_demo' });
    const controller = new RolesController(service as unknown as RolesService);
    const dto = { label: 'Nuevo' };

    await controller.updateRole('c_demo', dto);

    expect(service.updateRole).toHaveBeenCalledWith('c_demo', dto);
  });

  it('DELETE /roles/:key delega en rolesService.deleteRole', async () => {
    const service = makeServiceMock();
    const controller = new RolesController(service as unknown as RolesService);

    await controller.deleteRole('c_demo');

    expect(service.deleteRole).toHaveBeenCalledWith('c_demo');
  });

  it('POST /roles/:key/clone delega en rolesService.cloneRole con label del body', async () => {
    const service = makeServiceMock();
    service.cloneRole.mockResolvedValue({ key: 'c_demo_2' });
    const controller = new RolesController(service as unknown as RolesService);

    await controller.cloneRole('c_demo', { label: 'Demo copia' });

    expect(service.cloneRole).toHaveBeenCalledWith('c_demo', 'Demo copia');
  });
});
```

- [ ] 2. Correr y ver que falla (el controller no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.controller.spec.ts`

- [ ] 3. Implementación mínima. Primero crear el DTO auxiliar para el body de clonar en `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/clone-role.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body de `POST /roles/:key/clone`. */
export class CloneRoleDto {
  @IsString()
  @MinLength(1, { message: 'El nombre del rol clonado es obligatorio.' })
  @MaxLength(80)
  label!: string;
}
```

Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import type { PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';
import { ORG_ID } from '../../common/org.constant';
import { RequirePermission } from '../../authz/require-permission.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../authz/auth-user.types';
import { CloneRoleDto } from './dto/clone-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService } from './roles.service';

/**
 * CRUD de roles dinámicos (RBAC dinámico, Fase 2). TODOS los endpoints exigen
 * `can_manage_roles` sobre `organization:gmt` (recurso estático, igual que
 * `UsersController` con `can_manage_users`, §3.1).
 */
@Controller()
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /** Catálogo de permisos agrupado por módulo (para pintar la matriz). */
  @Get('permissions')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  listPermissions(): Promise<PermissionCatalogGroup[]> {
    return this.rolesService.listPermissions();
  }

  /** Todos los roles (sistema + custom). */
  @Get('roles')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  listRoles(): Promise<RoleDetail[]> {
    return this.rolesService.listRoles();
  }

  /** Detalle de un rol. */
  @Get('roles/:key')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  getRole(@Param('key') key: string): Promise<RoleDetail> {
    return this.rolesService.getRole(key);
  }

  /** Crea un rol custom. */
  @Post('roles')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() authUser: AuthUser): Promise<RoleDetail> {
    return this.rolesService.createRole(dto, authUser.id);
  }

  /** Actualiza label/description/grants de un rol custom. 403 si es del sistema. */
  @Patch('roles/:key')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  updateRole(@Param('key') key: string, @Body() dto: UpdateRoleDto): Promise<RoleDetail> {
    return this.rolesService.updateRole(key, dto);
  }

  /** Elimina un rol custom. 403 si es del sistema; 409 si está en uso. */
  @Delete('roles/:key')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  deleteRole(@Param('key') key: string): Promise<void> {
    return this.rolesService.deleteRole(key);
  }

  /** Clona un rol (sistema o custom) como un rol custom nuevo. */
  @Post('roles/:key/clone')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  cloneRole(@Param('key') key: string, @Body() dto: CloneRoleDto): Promise<RoleDetail> {
    return this.rolesService.cloneRole(key, dto.label);
  }
}
```

Nota de verificación: confirmar contra `C:/Users/juana/GMT Link/nodes/backend-central/src/auth/current-user.decorator.ts` que `CurrentUser()` sin argumentos devuelve `AuthUser` (no `| undefined`) en un endpoint que ya pasó el guard de auth; si su tipo es `AuthUser | undefined` (como en `uploadAvatar` de `UsersController`), ajustar `createRole` para aceptar ese `undefined` con un guard explícito:
```ts
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() authUser: AuthUser | undefined): Promise<RoleDetail> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
    return this.rolesService.createRole(dto, authUser.id);
  }
```
(agregar el import de `UnauthorizedException` si se toma esta rama).

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles/roles.controller.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.controller.ts" "nodes/backend-central/src/modules/roles/roles.controller.spec.ts" "nodes/backend-central/src/modules/roles/dto/clone-role.dto.ts"
  git commit -m "feat(roles): RolesController con gate can_manage_roles (GET/POST/PATCH/DELETE/clone)"
  ```

---

### Task 2.13: RolesModule — wiring

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.module.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/app.module.ts` (o el módulo raíz donde se registra `UsersModule`; verificar ruta exacta antes de editar)
- Test: ninguno nuevo (este wiring se cubre por el `tsc --noEmit` + arranque de Nest; no amerita spec propio, igual que `UsersModule` no tiene uno)

- [ ] 1. Verificar dónde se importa `UsersModule` hoy:
  `Grep -n "UsersModule" nodes/backend-central/src/app.module.ts` (ajustar ruta si el módulo raíz tiene otro nombre; buscar con `Glob "nodes/backend-central/src/app.module.ts"` primero si hay dudas).

- [ ] 2. (No aplica "correr y ver que falla" con test unitario aquí; en su lugar, el chequeo previo es correr `tsc --noEmit` ANTES de crear el módulo para confirmar que `RolesController`/`RolesService` aún no están registrados en ningún `@Module`, lo cual es el estado esperado — no hay error de compilación por esto, así que el "fallo" a observar es funcional: si arrancaras la app ahora, `/roles` y `/permissions` no responderían. No es necesario levantar el server; basta con el paso 3 y verificar con tsc.)

- [ ] 3. Implementación. Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/**
 * Módulo de CRUD de roles dinámicos (RBAC dinámico, Fase 2).
 * Consume `PrismaService` (global) y `FgaService` (global, vía `FgaModule`).
 * `PermissionsGuard` es global (APP_GUARD en AppModule), por lo que los
 * `@RequirePermission` de `RolesController` se aplican sin registrar nada
 * extra aquí (mismo patrón que `UsersModule`).
 */
@Module({
  imports: [PrismaModule],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class RolesModule {}
```

Registrar `RolesModule` en el módulo raíz junto a `UsersModule` (mismo archivo, mismo patrón de import):
```ts
import { RolesModule } from './modules/roles/roles.module';
// ...
@Module({
  imports: [
    // ...módulos existentes, incluyendo UsersModule...
    RolesModule,
  ],
  // ...
})
```

- [ ] 4. Correr y ver que pasa (compila y el módulo queda registrado):
  `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit`
  Correr también el suite completo del módulo roles para confirmar que nada quedó roto por el wiring:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run src/modules/roles`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.module.ts" "nodes/backend-central/src/app.module.ts"
  git commit -m "feat(roles): registrar RolesModule en el módulo raíz"
  ```

---

### Task 2.14: Verificación final de Fase 2

**Files:** ninguno (solo verificación, sin cambios de código)

- [ ] 1. Correr el suite completo del backend para confirmar que Fase 2 no rompió nada existente:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run`
- [ ] 2. Correr `tsc --noEmit` en backend y en web (por el cambio de `RoleKey` en contracts):
  `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit`
  `pnpm --filter "@gmt-platform/web" exec tsc --noEmit`
- [ ] 3. Correr `pnpm lint` en la raíz del monorepo y confirmar cero errores nuevos atribuibles a `modules/roles`.
- [ ] 4. Si todo pasa, no se requiere commit adicional (task de verificación, sin cambios). Si algo falla, volver a la task correspondiente y corregir antes de dar la Fase 2 por cerrada.

---

## Fase 3: Sincronización FgaService + asignación de roles por scope

### Task 3.1: `FgaModule` inyecta `PrismaService` en `FgaService`

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.module.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts` (solo el constructor por ahora)
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga/fga.service.spec.ts` (nuevo archivo — no existe hoy; crea el directorio `test/fga/`)

`FgaService` hoy solo depende de `FGA_CLIENT`. Las tasks 3.2/3.3 necesitan leer `Role`/`RolePermission`/`Permission` vía Prisma, así que primero hay que darle acceso a `PrismaService`. `FgaModule` es `@Global()` pero solo importa lo necesario para construir `FGA_CLIENT`; `PrismaModule` también es global (lo confirma `UsersModule`, que no lo re-importa explícitamente salvo para tipos), así que Nest resuelve la dependencia sin más cambios de imports, pero hay que declararla explícitamente para que quede claro y typado.

- [ ] 1. Escribir el test que falla: en `test/fga/fga.service.spec.ts`, instanciar `new FgaService(fakeClient, fakePrisma)` (2 argumentos) y comprobar que compila / no explota al construirse:

```typescript
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaClientLike } from '../../src/fga/fga.types';
import { FgaService } from '../../src/fga/fga.service';

function buildClient(): FgaClientLike {
  return {
    check: vi.fn(() => Promise.resolve({ allowed: false })),
    write: vi.fn(() => Promise.resolve(undefined)),
  };
}

function buildPrisma(): PrismaService {
  return {
    role: { findUnique: vi.fn(), findMany: vi.fn() },
    membership: { findMany: vi.fn() },
  } as unknown as PrismaService;
}

describe('FgaService — constructor con PrismaService', () => {
  it('se construye recibiendo (client, prisma) sin lanzar', () => {
    expect(() => new FgaService(buildClient(), buildPrisma())).not.toThrow();
  });
});
```

- [ ] 2. Correr y ver que falla (el constructor actual solo acepta 1 argumento — TS marcará error de exceso de argumentos, o si `tsc` no corre en vitest, el mock de prisma quedará "unused" pero el objetivo real es que falle por firma):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga/fga.service.spec.ts
  ```
- [ ] 3. Implementación mínima. En `fga.service.ts`, agregar el segundo parámetro inyectado:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  FGA_CLIENT,
  MEMBERSHIP_RELATION_MAP,
  SCOPE_OBJECT_TYPE,
} from './fga.types';
import type {
  FgaClientLike,
  MembershipInput,
  MembershipSyncOp,
  TupleKey,
} from './fga.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class FgaService {
  constructor(
    @Inject(FGA_CLIENT) private readonly client: FgaClientLike,
    private readonly prisma: PrismaService,
  ) {}

  // ... resto de métodos existentes sin cambios (se completan en 3.2/3.3)
```

  En `fga.module.ts`, importar `PrismaModule` explícitamente para que la dependencia quede declarada (aunque sea global, es la práctica ya usada por `UsersModule`):

```typescript
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenFgaClient } from '@openfga/sdk';
import { FgaService } from './fga.service';
import { FGA_CLIENT } from './fga.types';
import type { FgaClientLike } from './fga.types';
import { PrismaModule } from '../prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: FGA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FgaClientLike => {
        const apiUrl = config.get<string>('FGA_API_URL') ?? 'http://localhost:8080';
        const storeId = config.get<string>('FGA_STORE_ID');
        const authorizationModelId = config.get<string>('FGA_MODEL_ID') || undefined;

        if (!storeId) {
          const notConfigured = (): never => {
            throw new Error(
              'OpenFGA no inicializado: FGA_STORE_ID vacío. Ejecuta `pnpm --filter @gmt-platform/backend-central fga:bootstrap`.',
            );
          };
          return { check: notConfigured, write: notConfigured };
        }

        return new OpenFgaClient({ apiUrl, storeId, authorizationModelId });
      },
    },
    FgaService,
  ],
  exports: [FgaService],
})
export class FgaModule {}
```

  Nota: todos los sitios que hacen `new FgaService(client)` en tests existentes (si los hubiera) quedarán rotos; verificar con grep que no hay otros construtores directos fuera de los que tocaremos en esta fase.

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga/fga.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/fga/fga.module.ts nodes/backend-central/src/fga/fga.service.ts nodes/backend-central/test/fga/fga.service.spec.ts
  git commit -m "feat(fga): inyecta PrismaService en FgaService"
  ```

---

### Task 3.2: `composable-permissions.ts` (mapa STRUCTURAL → object type)

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/composable-permissions.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/composable-permissions.spec.ts` (nuevo)

Este mapa es consumido por `RolesService` (Fase 4, no en esta fase) y por `FgaService.resyncRole`/`syncRoleAssignment` (Task 3.3) para saber a qué tipo de objeto FGA (`organization` | `project`) corresponde cada permiso `STRUCTURAL` composable. Se crea en esta fase porque `FgaService` lo necesita ya.

- [ ] 1. Escribir el test que falla:

```typescript
import { describe, expect, it } from 'vitest';
import { COMPOSABLE_STRUCTURAL } from '../../src/modules/roles/composable-permissions';

describe('COMPOSABLE_STRUCTURAL', () => {
  it('mapea los permisos STRUCTURAL compuestos por rol custom a su object type FGA', () => {
    expect(COMPOSABLE_STRUCTURAL['directory:view:extended']).toBe('organization');
    expect(COMPOSABLE_STRUCTURAL['document:review']).toBe('organization');
    expect(COMPOSABLE_STRUCTURAL['finance:manage']).toBe('organization');
    expect(COMPOSABLE_STRUCTURAL['project:read']).toBe('project');
    expect(COMPOSABLE_STRUCTURAL['project:kpi:define']).toBe('project');
    expect(COMPOSABLE_STRUCTURAL['service:create']).toBe('project');
    expect(COMPOSABLE_STRUCTURAL['measurement:submit']).toBe('project');
    expect(COMPOSABLE_STRUCTURAL['measurement:read']).toBe('project');
    expect(COMPOSABLE_STRUCTURAL['task:read']).toBe('project');
    expect(COMPOSABLE_STRUCTURAL['task:create']).toBe('project');
    expect(COMPOSABLE_STRUCTURAL['task:assign']).toBe('project');
  });

  it('un permiso fuera del mapa es undefined (no composable)', () => {
    expect(COMPOSABLE_STRUCTURAL['no:existe']).toBeUndefined();
  });
});
```

- [ ] 2. Correr y ver que falla (el módulo no existe):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/composable-permissions.spec.ts
  ```
- [ ] 3. Implementación mínima:

```typescript
import type { FgaObjectType } from '@gmt-platform/contracts';

/**
 * Permisos STRUCTURAL que un rol CUSTOM puede componer y su tipo de objeto FGA
 * (§ diseño matriz RBAC — Fase 3/4). Un STRUCTURAL fuera de este mapa no es
 * componible: `RolesService.validateGrants` lo rechaza con 400 NOT_COMPOSABLE.
 */
export const COMPOSABLE_STRUCTURAL: Readonly<Record<string, FgaObjectType>> = {
  'directory:view:extended': 'organization',
  'document:review': 'organization',
  'finance:manage': 'organization',
  'project:read': 'project',
  'project:kpi:define': 'project',
  'service:create': 'project',
  'measurement:submit': 'project',
  'measurement:read': 'project',
  'task:read': 'project',
  'task:create': 'project',
  'task:assign': 'project',
};
```

  (Este archivo depende de que `packages/contracts` ya exponga `FgaObjectType` — si la Fase 1/2 de este mismo diseño aún no agregó ese tipo al contrato, usar temporalmente el tipo inline `'organization' | 'project'` y ajustar cuando el contrato esté disponible; no bloquear esta task por eso.)

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/composable-permissions.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/roles/composable-permissions.ts nodes/backend-central/test/modules/composable-permissions.spec.ts
  git commit -m "feat(roles): mapa COMPOSABLE_STRUCTURAL permiso→object type FGA"
  ```

---

### Task 3.3: `FgaService.syncRoleAssignment` (tupla directa create/delete para un rol custom)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga/fga.service.spec.ts` (extiende el de Task 3.1)

`syncRoleAssignment` traduce "el usuario U tiene el rol custom R en el scope S" a las tuplas FGA de sus grants `STRUCTURAL`. Lee `RolePermission` del rol filtrando `permission.kind = 'STRUCTURAL'` y `permission.fgaRelation` no nulo, cruza cada `permission.key` contra `COMPOSABLE_STRUCTURAL` para saber el object type, y solo escribe/borra la tupla si el object type coincide con el `scopeType` de la asignación (ORGANIZATION→organization:gmt, PROJECT→project:scopeId). Grants cuyo `permission.key` no está en el mapa se ignoran (defensivo: `RolesService.validateGrants`, Fase 4, ya impide guardarlos, pero `FgaService` no debe asumirlo).

- [ ] 1. Escribir el test que falla, agregando estos casos a `test/fga/fga.service.spec.ts`:

```typescript
// ---- agregar en el mismo archivo, tras el describe de Task 3.1 ----
import { ORG_ID } from '../../src/common/org.constant';

interface RoleGrantRow {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

function buildPrismaForSync(grants: RoleGrantRow[]): PrismaService {
  return {
    role: {
      findUnique: vi.fn(() =>
        Promise.resolve({ key: 'c_auditor', permissions: grants }),
      ),
    },
    membership: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;
}

describe('FgaService.syncRoleAssignment', () => {
  it('op create: escribe tupla organization para un grant STRUCTURAL org-level', async () => {
    const prisma = buildPrismaForSync([
      {
        scope: 'GLOBAL',
        permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
      },
    ]);
    const client = buildClient();
    const svc = new FgaService(client, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID },
      'create',
    );

    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_review_documents', object: `organization:${ORG_ID}` }],
    });
  });

  it('op delete: borra la tupla project para un grant STRUCTURAL project-level', async () => {
    const prisma = buildPrismaForSync([
      {
        scope: 'PROJECT',
        permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' },
      },
    ]);
    const client = buildClient();
    const svc = new FgaService(client, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'delete',
    );

    expect(client.write).toHaveBeenCalledWith({
      deletes: [{ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' }],
    });
  });

  it('ignora grants FUNCTIONAL (no tienen fgaRelation)', async () => {
    const prisma = buildPrismaForSync([
      { scope: 'PROJECT', permission: { key: 'task:time:log', kind: 'FUNCTIONAL', fgaRelation: null } },
    ]);
    const client = buildClient();
    const svc = new FgaService(client, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('ignora grants STRUCTURAL cuyo object type no coincide con el scopeType de la asignación', async () => {
    // 'project:read' es de tipo 'project'; se asigna a nivel ORGANIZATION → no aplica.
    const prisma = buildPrismaForSync([
      { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
    ]);
    const client = buildClient();
    const svc = new FgaService(client, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('lista vacía de tuplas → no llama write (idempotente/no-op)', async () => {
    const prisma = buildPrismaForSync([]);
    const client = buildClient();
    const svc = new FgaService(client, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('rol inexistente: no lanza y no escribe tuplas', async () => {
    const client = buildClient();
    const prisma = {
      role: { findUnique: vi.fn(() => Promise.resolve(null)) },
      membership: { findMany: vi.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;
    const svc = new FgaService(client, prisma);

    await expect(
      svc.syncRoleAssignment(
        { userId: 'u1', roleKey: 'no_existe', scopeType: 'PROJECT', scopeId: 'p1' },
        'create',
      ),
    ).resolves.toBeUndefined();
    expect(client.write).not.toHaveBeenCalled();
  });
});
```

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga/fga.service.spec.ts
  ```
- [ ] 3. Implementación mínima. Agregar a `fga.service.ts`:

```typescript
import { COMPOSABLE_STRUCTURAL } from '../modules/roles/composable-permissions';
import { ORG_ID } from '../common/org.constant';

// tipo del grant que necesita este método (evita `any`)
interface StructuralGrant {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

// dentro de la clase FgaService:

  /**
   * Sincroniza la asignación de un rol CUSTOM a un usuario en un scope dado
   * (org o project) hacia OpenFGA: por cada grant STRUCTURAL del rol cuyo
   * object type (vía COMPOSABLE_STRUCTURAL) coincide con `scopeType`, escribe
   * o borra la tupla directa `(user, fgaRelation, objectType:scopeId)`.
   * Idempotente: sin grants aplicables → no-op (writeTuples/deleteTuples ya
   * son no-op con lista vacía).
   */
  async syncRoleAssignment(
    input: { userId: string; roleKey: string; scopeType: FgaScopeType; scopeId: string },
    op: MembershipSyncOp,
  ): Promise<void> {
    const tuples = await this.tuplesForAssignment(input);
    if (op === 'create') {
      await this.writeTuples(tuples);
    } else {
      await this.deleteTuples(tuples);
    }
  }

  /** Recorre las Membership del rol y aplica el delta necesario para que FGA refleje sus grants actuales. */
  async resyncRole(roleKey: string): Promise<void> {
    const memberships = await this.prisma.membership.findMany({ where: { roleKey } });
    for (const membership of memberships) {
      const scopeType = membership.scopeType as FgaScopeType;
      if (scopeType !== 'ORGANIZATION' && scopeType !== 'PROJECT') continue;
      await this.syncRoleAssignment(
        { userId: membership.userId, roleKey, scopeType, scopeId: membership.scopeId },
        'create',
      );
    }
  }

  /** Grants STRUCTURAL del rol cuyo object type coincide con `scopeType` → tuplas FGA. */
  private async tuplesForAssignment(input: {
    userId: string;
    roleKey: string;
    scopeType: FgaScopeType;
    scopeId: string;
  }): Promise<TupleKey[]> {
    const role = await this.prisma.role.findUnique({
      where: { key: input.roleKey },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) return [];

    const objectType = input.scopeType === 'ORGANIZATION' ? 'organization' : 'project';
    const objectId = input.scopeType === 'ORGANIZATION' ? ORG_ID : input.scopeId;

    const tuples: TupleKey[] = [];
    for (const grant of role.permissions as unknown as StructuralGrant[]) {
      const { permission } = grant;
      if (permission.kind !== 'STRUCTURAL' || !permission.fgaRelation) continue;
      const grantObjectType = COMPOSABLE_STRUCTURAL[permission.key];
      if (grantObjectType !== objectType) continue;
      tuples.push({
        user: `user:${input.userId}`,
        relation: permission.fgaRelation,
        object: `${objectType}:${objectId}`,
      });
    }
    return tuples;
  }
```

  Nota de import circular: `composable-permissions.ts` no importa nada de `fga/`, así que no hay ciclo. Verificar que `Role.findUnique` con `include: { permissions: { include: { permission: true } } }` compila contra el schema Prisma (relación `Role.permissions: RolePermission[]` y `RolePermission.permission: Permission`).

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga/fga.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/fga/fga.service.ts nodes/backend-central/test/fga/fga.service.spec.ts
  git commit -m "feat(fga): syncRoleAssignment + resyncRole para roles custom"
  ```

---

### Task 3.4: `resyncRole` — agrega y quita tuplas al cambiar grants (delta real, no solo "create" repetido)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga/fga.service.spec.ts`

La implementación mínima de 3.3 solo vuelve a escribir (`create`) las tuplas vigentes tras un cambio de grants, pero si `RolesService.updateRole` QUITA un grant STRUCTURAL, la tupla vieja queda huérfana en FGA. `resyncRole` debe leer el estado FGA-relevante actual del rol (grants vigentes) y no puede "adivinar" qué tuplas viejas borrar sin state adicional — la estrategia acordada en el SPINE es: dado que las relaciones FGA por permiso son estables (un `fgaRelation` fijo por `permission.key` en `COMPOSABLE_STRUCTURAL`), y el catálogo completo de permisos composables es conocido y pequeño, `resyncRole` calcula el set deseado (grants vigentes) y el set de "todas las relaciones posibles" del catálogo composable para ese rol+scope, y borra las que ya no correspondan.

- [ ] 1. Escribir el test que falla, agregando a `test/fga/fga.service.spec.ts`:

```typescript
describe('FgaService.resyncRole — delta real', () => {
  it('si el rol perdió un grant STRUCTURAL, resyncRole borra la tupla vieja de los miembros existentes', async () => {
    // Rol c_auditor HOY solo tiene 'document:review' (perdió 'finance:manage').
    const prisma = {
      role: {
        findUnique: vi.fn(() =>
          Promise.resolve({
            key: 'c_auditor',
            permissions: [
              {
                scope: 'GLOBAL',
                permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
              },
            ],
          }),
        ),
      },
      membership: {
        findMany: vi.fn(() =>
          Promise.resolve([
            { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID },
          ]),
        ),
      },
    } as unknown as PrismaService;
    const client = buildClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    // Escribe la tupla vigente (document:review)...
    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_review_documents', object: `organization:${ORG_ID}` }],
    });
    // ...y borra la de finance:manage, que ya no es grant del rol pero es composable en ese object type.
    expect(client.write).toHaveBeenCalledWith({
      deletes: [{ user: 'user:u1', relation: 'can_manage_finance', object: `organization:${ORG_ID}` }],
    });
  });

  it('sin memberships del rol → no llama write', async () => {
    const prisma = {
      role: { findUnique: vi.fn(() => Promise.resolve({ key: 'c_auditor', permissions: [] })) },
      membership: { findMany: vi.fn(() => Promise.resolve([])) },
    } as unknown as PrismaService;
    const client = buildClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    expect(client.write).not.toHaveBeenCalled();
  });
});
```

  Nota: este test asume que `finance:manage` mapea a la relación FGA `can_manage_finance` — como el catálogo de `Permission.fgaRelation` vive en Postgres (seed), en el test lo simulamos vía un segundo objeto en el catálogo compuesto que la implementación consulta (ver paso 3). Ajustar el nombre de relación si la seed real usa otro (buscar en `prisma/seed.ts` o migraciones de Permission antes de fijar el string; si no existe aún la seed de `finance:manage`, usar el nombre `can_manage_finance` como convención y dejarlo documentado en el catálogo interno del método).

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga/fga.service.spec.ts
  ```
- [ ] 3. Implementación. `resyncRole` necesita saber, para el object type de cada membership, cuáles son TODAS las relaciones FGA posibles de permisos composables de ese tipo (para poder borrar las que ya no están vigentes). Esa info vive en Postgres (`Permission` con `kind='STRUCTURAL'` y `key` en `COMPOSABLE_STRUCTURAL`), no hace falta hardcodear nada nuevo:

```typescript
  /**
   * Recorre las Membership del rol y aplica el delta (altas + bajas) necesario
   * para que FGA refleje exactamente sus grants STRUCTURAL vigentes.
   * Por cada membership: calcula el set deseado (grants vigentes que aplican
   * a su scopeType) y el set "posible" (todas las relaciones STRUCTURAL
   * composables de ese object type, según el catálogo Permission) — las que
   * están en "posible" pero no en "deseado" se borran (ya no son grant).
   */
  async resyncRole(roleKey: string): Promise<void> {
    const memberships = await this.prisma.membership.findMany({ where: { roleKey } });
    if (memberships.length === 0) return;

    const role = await this.prisma.role.findUnique({
      where: { key: roleKey },
      include: { permissions: { include: { permission: true } } },
    });
    const grants = (role?.permissions ?? []) as unknown as StructuralGrant[];

    for (const membership of memberships) {
      const scopeType = membership.scopeType as FgaScopeType;
      if (scopeType !== 'ORGANIZATION' && scopeType !== 'PROJECT') continue;
      const objectType = scopeType === 'ORGANIZATION' ? 'organization' : 'project';
      const objectId = scopeType === 'ORGANIZATION' ? ORG_ID : membership.scopeId;

      const desiredRelations = new Set(
        grants
          .filter((g) => g.permission.kind === 'STRUCTURAL' && g.permission.fgaRelation)
          .filter((g) => COMPOSABLE_STRUCTURAL[g.permission.key] === objectType)
          .map((g) => g.permission.fgaRelation as string),
      );

      const possibleRelations = await this.possibleRelationsFor(objectType);

      const writes: TupleKey[] = [...desiredRelations].map((relation) => ({
        user: `user:${membership.userId}`,
        relation,
        object: `${objectType}:${objectId}`,
      }));
      const deletes: TupleKey[] = [...possibleRelations]
        .filter((relation) => !desiredRelations.has(relation))
        .map((relation) => ({
          user: `user:${membership.userId}`,
          relation,
          object: `${objectType}:${objectId}`,
        }));

      await this.writeTuples(writes);
      await this.deleteTuples(deletes);
    }
  }

  /** Todas las relaciones FGA de permisos STRUCTURAL composables para un object type (catálogo Postgres). */
  private async possibleRelationsFor(objectType: 'organization' | 'project'): Promise<Set<string>> {
    const keys = Object.entries(COMPOSABLE_STRUCTURAL)
      .filter(([, type]) => type === objectType)
      .map(([key]) => key);
    if (keys.length === 0) return new Set();
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: keys }, kind: 'STRUCTURAL' },
      select: { fgaRelation: true },
    });
    return new Set(
      permissions
        .map((p) => p.fgaRelation)
        .filter((r): r is string => r !== null && r !== undefined),
    );
  }
```

  Ajustar el mock de `prisma.permission.findMany` en el test del paso 1 para devolver `[{ fgaRelation: 'can_review_documents' }, { fgaRelation: 'can_manage_finance' }]` cuando se consulten las keys de tipo `organization` (agregar `permission: { findMany: vi.fn(...) }` al prisma mock del test).

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga/fga.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/fga/fga.service.ts nodes/backend-central/test/fga/fga.service.spec.ts
  git commit -m "feat(fga): resyncRole calcula delta real (altas y bajas) de tuplas"
  ```

---

### Task 3.5: `RolesService.updateRole` llama a `fga.resyncRole` con rollback en 502

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts` (asumir que ya existe de la Fase 4 en curso; si no existe todavía en el momento de ejecutar esta task, saltarla y anotar el bloqueo — ver nota abajo)
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles.service.spec.ts`

**Nota de dependencia:** esta task asume que `RolesService.updateRole(key, input)` ya existe (Fase 4 del SPINE define su firma completa: `createRole/updateRole/deleteRole/...`). Si al ejecutar esta fase `roles.service.ts` aún no existe, crear solo el método mínimo necesario para este test (`updateRole` que persiste `grants` vía `RolePermission` y llama `resyncRole`) dejando el resto (`createRole`, `listRoles`, etc.) para la Fase 4; no dupliques lógica si Fase 4 ya corrió antes — en ese caso solo AGREGA la llamada a `fga.resyncRole` dentro del `updateRole` existente.

- [ ] 1. Escribir el test que falla:

```typescript
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { FgaService } from '../../src/fga/fga.service';
import { RolesService } from '../../src/modules/roles/roles.service';

function buildPrisma(over: { role?: unknown; isSystem?: boolean } = {}): {
  prisma: PrismaService;
  setGrants: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  createMany: ReturnType<typeof vi.fn>;
} {
  const setGrants = vi.fn();
  const deleteMany = vi.fn(() => Promise.resolve(undefined));
  const createMany = vi.fn(() => Promise.resolve(undefined));
  const role = over.role ?? {
    id: 'role-1',
    key: 'c_auditor',
    label: 'Auditor',
    description: null,
    isSystem: over.isSystem ?? false,
    permissions: [],
  };
  const prismaLike = {
    role: {
      findUnique: vi.fn(() => Promise.resolve(role)),
      update: vi.fn((args: unknown) => {
        setGrants(args);
        return Promise.resolve(role);
      }),
    },
    rolePermission: {
      deleteMany,
      createMany,
    },
    permission: {
      findMany: vi.fn(() => Promise.resolve([{ key: 'document:review', kind: 'STRUCTURAL', scopeable: true }])),
    },
    $transaction: vi.fn(<T>(cb: (tx: unknown) => Promise<T>) => cb(prismaLike)),
  };
  return { prisma: prismaLike as unknown as PrismaService, setGrants, deleteMany, createMany };
}

function buildFga(opts: { fail?: boolean } = {}): { fga: FgaService; resyncRole: ReturnType<typeof vi.fn> } {
  const resyncRole = vi.fn(() =>
    opts.fail ? Promise.reject(new Error('fga caída')) : Promise.resolve(undefined),
  );
  return { fga: { resyncRole } as unknown as FgaService, resyncRole };
}

describe('RolesService.updateRole — sync FGA', () => {
  it('tras actualizar grants, llama fga.resyncRole(key)', async () => {
    const { prisma } = buildPrisma();
    const { fga, resyncRole } = buildFga();
    const svc = new RolesService(prisma, fga);

    await svc.updateRole('c_auditor', { grants: [{ permissionKey: 'document:review', scope: 'GLOBAL' }] });

    expect(resyncRole).toHaveBeenCalledWith('c_auditor');
  });

  it('403 si el rol es isSystem (no llama a Postgres ni a FGA)', async () => {
    const { prisma } = buildPrisma({ isSystem: true });
    const { fga, resyncRole } = buildFga();
    const svc = new RolesService(prisma, fga);

    await expect(
      svc.updateRole('org_admin', { grants: [{ permissionKey: 'document:review', scope: 'GLOBAL' }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(resyncRole).not.toHaveBeenCalled();
  });

  it('502 FGA_SYNC_FAILED si resyncRole falla: hace rollback de los grants en Postgres', async () => {
    const { prisma, deleteMany, createMany } = buildPrisma();
    const { fga } = buildFga({ fail: true });
    const svc = new RolesService(prisma, fga);

    await expect(
      svc.updateRole('c_auditor', { grants: [{ permissionKey: 'document:review', scope: 'GLOBAL' }] }),
    ).rejects.toMatchObject({
      status: 502,
      response: { code: 'FGA_SYNC_FAILED' },
    });
    // Se intentó escribir el grant nuevo y luego revertir (al menos 2 pasadas de deleteMany/createMany:
    // 1 al aplicar el cambio, 1 al revertir al estado previo).
    expect(deleteMany.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles.service.spec.ts
  ```
- [ ] 3. Implementación mínima (solo la porción relevante a esta task; el resto de `RolesService` —`listPermissions`, `createRole`, etc.— pertenece a Fase 4 y no se reimplementa aquí si ya existe):

```typescript
  /**
   * Actualiza label/description/grants de un rol CUSTOM. 403 si isSystem.
   * Tras persistir los nuevos grants en Postgres, sincroniza OpenFGA
   * (`fga.resyncRole`); si la sync falla, revierte los grants al estado
   * previo y responde 502 FGA_SYNC_FAILED (Postgres nunca queda con grants
   * que OpenFGA no refleja).
   */
  async updateRole(key: string, input: UpdateRoleInput): Promise<RoleDetail> {
    const role = await this.prisma.role.findUnique({
      where: { key },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new NotFoundException(`No existe un rol con key "${key}".`);
    }
    if (role.isSystem) {
      throw new ForbiddenException('Los roles del sistema no son editables.');
    }

    const previousGrants: RoleGrant[] = role.permissions.map((p) => ({
      permissionKey: p.permission.key,
      scope: p.scope as PermissionScopeValue,
    }));

    if (input.label !== undefined || input.description !== undefined) {
      await this.prisma.role.update({
        where: { key },
        data: { label: input.label, description: input.description },
      });
    }

    if (input.grants !== undefined) {
      await this.validateGrants(input.grants);
      await this.replaceGrants(role.id, input.grants);
    }

    try {
      await this.fga.resyncRole(key);
    } catch (error: unknown) {
      // Rollback: Postgres vuelve a reflejar exactamente los grants previos.
      if (input.grants !== undefined) {
        await this.replaceGrants(role.id, previousGrants);
      }
      throw new HttpException(
        { code: 'FGA_SYNC_FAILED', message: 'No se pudo sincronizar OpenFGA; se revirtieron los cambios.' },
        502,
      );
    }

    return this.getRole(key);
  }

  /** Reemplaza los RolePermission de un rol por el set dado (delete-all + create). */
  private async replaceGrants(roleId: string, grants: RoleGrant[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (grants.length > 0) {
        const permissions = await tx.permission.findMany({
          where: { key: { in: grants.map((g) => g.permissionKey) } },
          select: { id: true, key: true },
        });
        const idByKey = new Map(permissions.map((p) => [p.key, p.id]));
        await tx.rolePermission.createMany({
          data: grants.map((g) => ({
            roleId,
            permissionId: idByKey.get(g.permissionKey) as string,
            scope: g.scope,
          })),
        });
      }
    });
  }
```

  Imports nuevos requeridos en `roles.service.ts`: `HttpException`, `ForbiddenException`, `NotFoundException` de `@nestjs/common`; `RoleGrant`, `RoleDetail`, `UpdateRoleInput`, `PermissionScopeValue` de `@gmt-platform/contracts`; `FgaService` de `../../fga/fga.service`.

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/roles/roles.service.ts nodes/backend-central/test/modules/roles.service.spec.ts
  git commit -m "feat(roles): updateRole sincroniza FGA (resyncRole) con rollback en 502"
  ```

---

### Task 3.6: DTO `AssignRoleScopedDto` + `UsersService.assignRoleScoped`

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/dto/assign-role-scoped.dto.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/users.service.spec.ts` (extiende el existente)

`assignRoleScoped` reemplaza/convive con `assignRole` (org-only, ya existente) agregando soporte de scope PROJECT y roles custom. Reglas: valida que `scopeType` esté en `allowedScopeTypes` del rol (vía `RolesService`, inyectado); si `scopeType === 'PROJECT'`, valida que `scopeId` exista en `Project`; crea `Membership`; si `Role.isSystem` usa `fga.syncMembershipToFGA` (camino ya existente), si es custom usa `fga.syncRoleAssignment`.

- [ ] 1. Escribir el test que falla. Primero el DTO (crear el archivo vacío de esqueleto no cuenta; el test debe fallar por falta de implementación real):

```typescript
// test/modules/dto/assign-role-scoped.dto.spec.ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AssignRoleScopedDto } from '../../../src/modules/users/dto/assign-role-scoped.dto';

describe('AssignRoleScopedDto', () => {
  it('acepta roleKey/scopeType/scopeId válidos', async () => {
    const dto = plainToInstance(AssignRoleScopedDto, {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors).toHaveLength(0);
  });

  it('rechaza scopeType fuera de ORGANIZATION|PROJECT', async () => {
    const dto = plainToInstance(AssignRoleScopedDto, {
      roleKey: 'c_auditor',
      scopeType: 'SERVICE',
      scopeId: 's1',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rechaza campos extra', async () => {
    const dto = plainToInstance(AssignRoleScopedDto, {
      roleKey: 'c_auditor',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
      extra: 'no',
    });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

  Y en `test/modules/users.service.spec.ts`, agregar (import de `RolesService` como tipo, y de `AssignRoleScopedDto` si aplica al firmar el método):

```typescript
import type { RolesService } from '../../src/modules/roles/roles.service';

function buildRolesMock(over: {
  allowedScopeTypes?: string[];
  isSystem?: boolean;
  roleKey?: string;
} = {}): RolesService {
  return {
    getRole: vi.fn(() =>
      Promise.resolve({
        key: over.roleKey ?? 'c_auditor',
        label: 'Auditor',
        description: null,
        isSystem: over.isSystem ?? false,
        allowedScopeTypes: over.allowedScopeTypes ?? ['ORGANIZATION', 'PROJECT'],
        grants: [],
      }),
    ),
  } as unknown as RolesService;
}

describe('UsersService.assignRoleScoped / removeRoleScoped', () => {
  it('asigna un rol custom en scope PROJECT: crea Membership y llama fga.syncRoleAssignment', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
    };
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );

    const fga = buildFgaMock();
    const syncRoleAssignment = vi.fn(() => Promise.resolve(undefined));
    (fga.fga as unknown as { syncRoleAssignment: typeof syncRoleAssignment }).syncRoleAssignment =
      syncRoleAssignment;

    const roles = buildRolesMock({ allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' });

    expect(syncRoleAssignment).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );
  });

  it('400 INVALID_SCOPE_FOR_ROLE si scopeType no está en allowedScopeTypes del rol', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_SCOPE_FOR_ROLE' } });
  });

  it('400 INVALID_SCOPE_ID si scopeType=PROJECT y el proyecto no existe', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve(null)),
    };
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'no-existe' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'INVALID_SCOPE_ID' } });
  });

  it('rol isSystem usa fga.syncMembershipToFGA (camino legacy), no syncRoleAssignment', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const syncMembershipToFGA = vi.fn(() => Promise.resolve(undefined));
    const syncRoleAssignment = vi.fn(() => Promise.resolve(undefined));
    (fga.fga as unknown as { syncMembershipToFGA: typeof syncMembershipToFGA }).syncMembershipToFGA =
      syncMembershipToFGA;
    (fga.fga as unknown as { syncRoleAssignment: typeof syncRoleAssignment }).syncRoleAssignment =
      syncRoleAssignment;

    const roles = buildRolesMock({ isSystem: true, roleKey: 'operator', allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await service.assignRoleScoped('u1', { roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' });

    expect(syncMembershipToFGA).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );
    expect(syncRoleAssignment).not.toHaveBeenCalled();
  });

  it('idempotencia: 409 si la Membership ya existe para userId+roleKey+scopeType+scopeId', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'existing' })),
      create: vi.fn(),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('removeRoleScoped borra la Membership y llama al sync de delete correspondiente', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    const membershipDelete = vi.fn(() => Promise.resolve(undefined));
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })),
      delete: membershipDelete,
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const syncRoleAssignment = vi.fn(() => Promise.resolve(undefined));
    (fga.fga as unknown as { syncRoleAssignment: typeof syncRoleAssignment }).syncRoleAssignment =
      syncRoleAssignment;
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await service.removeRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' });

    expect(membershipDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(syncRoleAssignment).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      'delete',
    );
  });

  it('removeRoleScoped: 404 si la Membership no existe', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    const roles = buildRolesMock({ allowedScopeTypes: ['ORGANIZATION'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await expect(
      service.removeRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

  (Los tests existentes de `UsersService.create`/`importBatch` en el mismo archivo instancian `new UsersService(prisma, fga.fga, buildStorageMock())` con 3 argumentos — al agregar el 4º parámetro `roles` estos constructores quedan sin ese argumento; como es una dependencia nueva agregada al final, TypeScript no fallará si se define opcional-con-default en el constructor NO es aceptable en Nest DI real, así que en el paso 3 se actualizan también esos `new UsersService(...)` existentes agregando `roles` — ver nota en el paso 3.)

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.service.spec.ts test/modules/dto/assign-role-scoped.dto.spec.ts
  ```
- [ ] 3. Implementación mínima.

  DTO nuevo:

```typescript
import { IsIn, IsString } from 'class-validator';
import type { ScopeType } from '@gmt-platform/contracts';

const ASSIGNABLE_SCOPE_TYPES: readonly ScopeType[] = ['ORGANIZATION', 'PROJECT'];

/**
 * Body de `POST /users/:id/roles` y query de `DELETE /users/:id/roles` (diseño
 * matriz RBAC, Fase 3). A diferencia de `AssignRoleDto` (legacy, org-only),
 * este DTO soporta scope PROJECT y roleKeys arbitrarios (roles custom
 * incluidos) — la validación semántica (¿el rol existe? ¿el scopeType es
 * uno de sus allowedScopeTypes?) la hace `UsersService.assignRoleScoped`
 * contra `RolesService`, no este DTO.
 */
export class AssignRoleScopedDto {
  @IsString()
  roleKey!: string;

  @IsIn(ASSIGNABLE_SCOPE_TYPES, {
    message: `scopeType debe ser uno de: ${ASSIGNABLE_SCOPE_TYPES.join(', ')}.`,
  })
  scopeType!: ScopeType;

  @IsString()
  scopeId!: string;
}
```

  En `users.service.ts`: agregar el import de `RolesService`, inyectarlo en el constructor, y agregar los dos métodos nuevos:

```typescript
import { HttpException } from '@nestjs/common';
import type { AssignRoleInput } from '@gmt-platform/contracts';
import { RolesService } from '../roles/roles.service';

// constructor:
  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
    private readonly storage: StorageService,
    private readonly roles: RolesService,
  ) {}

// métodos nuevos:

  /**
   * Asigna un rol (sistema o custom) a un usuario en un scope arbitrario
   * (ORGANIZATION|PROJECT). Valida scopeType contra `allowedScopeTypes` del
   * rol y, si es PROJECT, que `scopeId` exista. Crea la Membership y
   * sincroniza FGA por el camino correcto según `Role.isSystem`.
   */
  async assignRoleScoped(userId: string, input: AssignRoleInput): Promise<void> {
    await this.assertUserExists(userId);
    const role = await this.roles.getRole(input.roleKey);
    this.assertScopeAllowed(role, input.scopeType);
    if (input.scopeType === 'PROJECT') {
      await this.assertProjectExists(input.scopeId);
    }

    const existing = await this.prisma.membership.findUnique({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: input.roleKey,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      },
    });
    if (existing) {
      throw new ConflictException(
        `El usuario ya tiene el rol "${input.roleKey}" en ese scope.`,
      );
    }

    await this.prisma.membership.create({
      data: {
        userId,
        roleKey: input.roleKey,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
    });

    await this.syncScopedAssignment(role.isSystem, {
      userId,
      roleKey: input.roleKey,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    }, 'create');
  }

  /** Quita un rol (sistema o custom) de un usuario en un scope arbitrario. 404 si no existe la Membership. */
  async removeRoleScoped(userId: string, input: AssignRoleInput): Promise<void> {
    await this.assertUserExists(userId);
    const role = await this.roles.getRole(input.roleKey);

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_roleKey_scopeType_scopeId: {
          userId,
          roleKey: input.roleKey,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
        },
      },
    });
    if (!membership) {
      throw new NotFoundException('El usuario no tiene ese rol en ese scope.');
    }

    await this.prisma.membership.delete({ where: { id: membership.id } });

    await this.syncScopedAssignment(role.isSystem, {
      userId,
      roleKey: input.roleKey,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
    }, 'delete');
  }

  /** 400 INVALID_SCOPE_FOR_ROLE si scopeType no está en los allowedScopeTypes del rol. */
  private assertScopeAllowed(role: { allowedScopeTypes: string[] }, scopeType: string): void {
    if (!role.allowedScopeTypes.includes(scopeType)) {
      throw new HttpException(
        { code: 'INVALID_SCOPE_FOR_ROLE', message: `El rol no admite el scope "${scopeType}".` },
        400,
      );
    }
  }

  /** 400 INVALID_SCOPE_ID si el proyecto no existe. */
  private async assertProjectExists(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new HttpException(
        { code: 'INVALID_SCOPE_ID', message: `No existe un proyecto con id "${projectId}".` },
        400,
      );
    }
  }

  /** Roles isSystem usan el camino legacy (Membership→relación fija); custom usan syncRoleAssignment. */
  private async syncScopedAssignment(
    isSystem: boolean,
    input: { userId: string; roleKey: string; scopeType: 'ORGANIZATION' | 'PROJECT'; scopeId: string },
    op: 'create' | 'delete',
  ): Promise<void> {
    if (isSystem) {
      await this.fga.syncMembershipToFGA(input, op);
    } else {
      await this.fga.syncRoleAssignment(input, op);
    }
  }
```

  Actualizar TODAS las instanciaciones existentes de `new UsersService(...)` en `test/modules/users.service.spec.ts` (los describes de `create`/`importBatch`) agregando un 4º argumento `buildRolesMock()` mínimo (puede ser un stub vacío ya que esos tests no llaman a `assignRoleScoped`):

```typescript
// helper agregado al spec, reusado por los tests viejos:
function buildRolesStub(): RolesService {
  return {} as unknown as RolesService;
}
// y reemplazar cada `new UsersService(prisma, fga.fga, buildStorageMock())`
// por `new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub())`.
```

  Actualizar también `UsersModule` para importar `RolesModule` (Fase 4) — si `RolesModule` aún no existe en el momento de ejecutar esta task, dejar el import comentado con un TODO explícito y anotarlo como bloqueante para la integración final; no bloquea el test unitario porque `RolesService` se inyecta directo en el `new UsersService(...)` del test.

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.service.spec.ts test/modules/dto/assign-role-scoped.dto.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/users/dto/assign-role-scoped.dto.ts nodes/backend-central/src/modules/users/users.service.ts nodes/backend-central/test/modules/users.service.spec.ts nodes/backend-central/test/modules/dto/assign-role-scoped.dto.spec.ts
  git commit -m "feat(users): assignRoleScoped/removeRoleScoped con validación de scope y sync FGA"
  ```

---

### Task 3.7: Endpoints `POST /users/:id/roles` y `DELETE /users/:id/roles` (query) en `UsersController`

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.controller.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/users.controller.spec.ts` (nuevo — hoy no hay spec de controller; seguir el patrón de `test/authz/permissions.guard.spec.ts` para invocar el handler directo sin bootstrap de Nest)

El SPINE reemplaza `POST /users/:id/roles` (body `AssignRoleDto`, org-only) por el nuevo endpoint con `AssignRoleScopedDto`/`AssignRoleInput`, y agrega `DELETE /users/:id/roles?roleKey=&scopeType=&scopeId=` (querystring, no path param, porque `scopeId` puede contener `/` en teoría — se usa query por consistencia con el SPINE). El endpoint legacy `DELETE /users/:id/roles/:roleKey` (org-only) se mantiene sin tocar para no romper llamadores existentes de Etapa 1; el nuevo vive en la misma ruta base pero método `DELETE` sin el `:roleKey` en el path.

- [ ] 1. Escribir el test que falla:

```typescript
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { UsersService } from '../../src/modules/users/users.service';
import { UsersController } from '../../src/modules/users/users.controller';
import { AssignRoleScopedDto } from '../../src/modules/users/dto/assign-role-scoped.dto';

function buildService(): { service: UsersService; assignRoleScoped: ReturnType<typeof vi.fn>; removeRoleScoped: ReturnType<typeof vi.fn> } {
  const assignRoleScoped = vi.fn(() => Promise.resolve(undefined));
  const removeRoleScoped = vi.fn(() => Promise.resolve(undefined));
  return {
    service: { assignRoleScoped, removeRoleScoped } as unknown as UsersService,
    assignRoleScoped,
    removeRoleScoped,
  };
}

describe('UsersController — asignación por scope', () => {
  it('POST /users/:id/roles delega en usersService.assignRoleScoped(userId, dto)', async () => {
    const { service, assignRoleScoped } = buildService();
    const controller = new UsersController(service);
    const dto: AssignRoleScopedDto = { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' };

    await controller.assignRoleScoped('u1', dto);

    expect(assignRoleScoped).toHaveBeenCalledWith('u1', dto);
  });

  it('DELETE /users/:id/roles delega en usersService.removeRoleScoped(userId, query)', async () => {
    const { service, removeRoleScoped } = buildService();
    const controller = new UsersController(service);

    await controller.removeRoleScoped('u1', 'c_auditor', 'PROJECT', 'p1');

    expect(removeRoleScoped).toHaveBeenCalledWith('u1', {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });
  });
});
```

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.controller.spec.ts
  ```
- [ ] 3. Implementación mínima. Agregar a `users.controller.ts` (junto a los métodos legacy `assignRole`/`removeRole`, que quedan intactos):

```typescript
import { AssignRoleScopedDto } from './dto/assign-role-scoped.dto';
import type { AssignRoleInput, ScopeType } from '@gmt-platform/contracts';

  /** Asigna un rol (sistema o custom) a un usuario en un scope arbitrario (§ Fase 3 matriz RBAC). */
  @Post(':id/roles')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  assignRoleScoped(
    @Param('id') id: string,
    @Body() dto: AssignRoleScopedDto,
  ): Promise<void> {
    return this.usersService.assignRoleScoped(id, dto);
  }

  /** Quita un rol (sistema o custom) de un usuario en un scope arbitrario, vía querystring. */
  @Delete(':id/roles')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  removeRoleScoped(
    @Param('id') id: string,
    @Query('roleKey') roleKey: string,
    @Query('scopeType') scopeType: ScopeType,
    @Query('scopeId') scopeId: string,
  ): Promise<void> {
    const input: AssignRoleInput = { roleKey, scopeType, scopeId };
    return this.usersService.removeRoleScoped(id, input);
  }
```

  Nota de colisión de rutas: Nest resuelve `@Post(':id/roles')` nuevo reemplazando el método existente del mismo path+verbo — como el SPINE dice "extiende UsersController", el `assignRole`/`AssignRoleDto` legacy (org-only, sin scope) queda REDUNDANTE con el nuevo. Para evitar dos handlers en el mismo `POST :id/roles`, este paso ELIMINA el método legacy `assignRole` (y su uso de `AssignRoleDto`) y lo reemplaza por `assignRoleScoped`; el legacy `removeRole` con `:roleKey` en el path (`DELETE :id/roles/:roleKey`) se mantiene intacto porque su path es distinto (`/roles/:roleKey` vs `/roles`), así ambos coexisten sin colisión. Si algún llamador front dependía del `POST :id/roles` legacy con `{roleKey}` sin scope, seguirá funcionando porque `AssignRoleScopedDto` con solo `roleKey` fallará validación (`scopeType`/`scopeId` son requeridos) — anotar esto como ítem de migración del front en la lista de pendientes, no bloquea esta task de backend.

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.controller.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/users/users.controller.ts nodes/backend-central/test/modules/users.controller.spec.ts
  git commit -m "feat(users): endpoints POST/DELETE /users/:id/roles con scope (AssignRoleInput)"
  ```

---

### Task 3.8: Test end-to-end-ish del flujo completo (assign custom role → resync tras updateRole → remove)

**Files:**
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/rbac-scoped-flow.spec.ts` (nuevo)

Test de integración liviano (sin HTTP real, sin BD real — todo con los mismos mocks de Prisma/FGA usados en las tasks anteriores) que ejercita la secuencia completa: crear rol custom → asignarlo a un usuario en un proyecto → cambiar sus grants (`updateRole`, dispara `resyncRole`) → verificar que las tuplas FGA reflejan el nuevo set → remover la asignación.

- [ ] 1. Escribir el test que falla:

```typescript
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FgaService } from '../../src/fga/fga.service';
import { RolesService } from '../../src/modules/roles/roles.service';
import { UsersService } from '../../src/modules/users/users.service';
import type { FgaClientLike } from '../../src/fga/fga.types';
import type { StorageService } from '../../src/common/storage/storage.service';

/**
 * Estado compartido en memoria: simula la parte de Postgres relevante a este
 * flujo (Role/RolePermission/Membership/Project/User) para poder verificar
 * el efecto de encadenar RolesService + UsersService + FgaService reales
 * (no mocks de esas 3 clases — solo Prisma y el cliente FGA son fakes).
 */
function buildInMemoryPrisma() {
  const roleRow = {
    id: 'role-1',
    key: 'c_auditor',
    label: 'Auditor',
    description: null,
    isSystem: false,
    permissions: [
      { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_read_task' } },
      { scope: 'PROJECT', permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' } },
    ],
  };
  const memberships: Array<{ id: string; userId: string; roleKey: string; scopeType: string; scopeId: string }> = [];

  const prisma = {
    user: { findUnique: vi.fn(() => Promise.resolve({ id: 'u1' })) },
    project: { findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    role: {
      findUnique: vi.fn(() => Promise.resolve(roleRow)),
    },
    permission: {
      findMany: vi.fn((args: { where: { key: { in: string[] } } }) =>
        Promise.resolve(
          [
            { key: 'task:read', fgaRelation: 'can_read_task' },
            { key: 'task:assign', fgaRelation: 'can_assign_task' },
          ].filter((p) => args.where.key.in.includes(p.key)),
        ),
      ),
    },
    membership: {
      findUnique: vi.fn(
        (args: {
          where: { userId_roleKey_scopeType_scopeId: { userId: string; roleKey: string; scopeType: string; scopeId: string } };
        }) => {
          const k = args.where.userId_roleKey_scopeType_scopeId;
          const found = memberships.find(
            (m) => m.userId === k.userId && m.roleKey === k.roleKey && m.scopeType === k.scopeType && m.scopeId === k.scopeId,
          );
          return Promise.resolve(found ?? null);
        },
      ),
      create: vi.fn((args: { data: { userId: string; roleKey: string; scopeType: string; scopeId: string } }) => {
        const row = { id: `m-${memberships.length + 1}`, ...args.data };
        memberships.push(row);
        return Promise.resolve(row);
      }),
      delete: vi.fn((args: { where: { id: string } }) => {
        const idx = memberships.findIndex((m) => m.id === args.where.id);
        if (idx >= 0) memberships.splice(idx, 1);
        return Promise.resolve(undefined);
      }),
      findMany: vi.fn((args: { where: { roleKey: string } }) =>
        Promise.resolve(memberships.filter((m) => m.roleKey === args.where.roleKey)),
      ),
    },
    rolePermission: {
      deleteMany: vi.fn(() => {
        roleRow.permissions = [];
        return Promise.resolve(undefined);
      }),
      createMany: vi.fn((args: { data: Array<{ roleId: string; permissionId: string; scope: string }> }) => {
        const byId: Record<string, { key: string; fgaRelation: string }> = {
          'perm-task:read': { key: 'task:read', fgaRelation: 'can_read_task' },
        };
        roleRow.permissions = args.data.map((d) => ({
          scope: d.scope,
          permission: {
            key: byId[d.permissionId]?.key ?? d.permissionId,
            kind: 'STRUCTURAL',
            fgaRelation: byId[d.permissionId]?.fgaRelation ?? null,
          },
        })) as unknown as typeof roleRow.permissions;
        return Promise.resolve(undefined);
      }),
    },
    $transaction: vi.fn(<T>(cb: (tx: unknown) => Promise<T>) => cb(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, roleRow };
}

function buildFgaClient(): { client: FgaClientLike; writes: unknown[]; deletes: unknown[] } {
  const writes: unknown[] = [];
  const deletes: unknown[] = [];
  const client: FgaClientLike = {
    check: vi.fn(() => Promise.resolve({ allowed: false })),
    write: vi.fn((body: { writes?: unknown[]; deletes?: unknown[] }) => {
      if (body.writes) writes.push(...body.writes);
      if (body.deletes) deletes.push(...body.deletes);
      return Promise.resolve(undefined);
    }),
  };
  return { client, writes, deletes };
}

describe('Flujo: rol custom → asignación por scope → resync → remove', () => {
  it('asigna, resincroniza tras perder un grant, y remueve limpiando la tupla', async () => {
    const { prisma, roleRow } = buildInMemoryPrisma();
    const { client, writes, deletes } = buildFgaClient();
    const fga = new FgaService(client, prisma);
    const roles = new RolesService(prisma, fga);
    const storage = { save: vi.fn() } as unknown as StorageService;
    const users = new UsersService(prisma, fga, storage, roles);

    // 1) Asignar el rol custom a u1 en el proyecto p1.
    await users.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' });
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_read_task', object: 'project:p1' });
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });

    writes.length = 0;
    deletes.length = 0;

    // 2) El rol pierde el grant 'task:assign' (updateRole → resyncRole).
    await roles.updateRole('c_auditor', {
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_read_task', object: 'project:p1' });
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });

    writes.length = 0;
    deletes.length = 0;

    // 3) Remover la asignación: borra la Membership y limpia la tupla vigente (can_read_task).
    await users.removeRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' });
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_read_task', object: 'project:p1' });

    void roleRow; // referenciado solo para tipado del fixture
  });
});
```

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/rbac-scoped-flow.spec.ts
  ```
- [ ] 3. Este test NO requiere código nuevo si las Tasks 3.1–3.7 ya están implementadas correctamente — es puramente de verificación de integración entre las piezas. Si falla, el fallo apunta a un defecto de integración entre `FgaService`, `RolesService` y `UsersService` (p. ej. `RolesService.getRole` no expone `allowedScopeTypes` con el shape esperado, o `permission.findMany` en `replaceGrants` no resuelve bien los ids). Ajustar la implementación de las tasks anteriores según lo que este test revele — no agregar lógica nueva "solo para pasar este test": si hace falta un cambio, es porque una task anterior quedó incompleta respecto al SPINE.
- [ ] 4. Correr y ver que pasa (junto con toda la suite de la fase, para asegurar que no se rompió nada):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga/fga.service.spec.ts test/modules/roles.service.spec.ts test/modules/users.service.spec.ts test/modules/users.controller.spec.ts test/modules/rbac-scoped-flow.spec.ts test/modules/composable-permissions.spec.ts test/modules/dto/assign-role-scoped.dto.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/test/modules/rbac-scoped-flow.spec.ts
  git commit -m "test(rbac): flujo integrado assign→resync→remove entre Fga/Roles/UsersService"
  ```

---

## Fase 4: `canManageRoles` en `/auth/me` + registro de `RolesModule`

### Task 4.1: `MeResponse.canManageRoles` — test que falla

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/test/auth/auth.controller.spec.ts`
- Modify (bajo test): `C:/Users/juana/GMT Link/nodes/backend-central/src/auth/auth.controller.ts`

- [ ] 1. En `test/auth/auth.controller.spec.ts`, extendé `Mocks`/`buildController` para poder inyectar un mock de `FgaService` (nuevo tercer parámetro del constructor) y agregá los casos que fallan. Reemplazá el archivo completo por:

```ts
import 'reflect-metadata';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../src/auth/auth.controller';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { AuthUser } from '../../src/authz/auth-user.types';
import { CompleteFirstLoginDto } from '../../src/auth/dto/complete-first-login.dto';
import { verifyPassword } from '../../src/common/password';
import '../../src/auth/auth-request.types';
import type { GamificationService } from '../../src/modules/gamification/gamification.service';
import type { FgaService } from '../../src/fga/fga.service';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
}

interface Mocks {
  controller: AuthController;
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  awardPoints: ReturnType<typeof vi.fn>;
  fgaCheck: ReturnType<typeof vi.fn>;
}

function buildController(options: {
  user?: UserRow | { status: string } | null;
  canManageRoles?: boolean;
}): Mocks {
  const findUnique = vi.fn(() => Promise.resolve(options.user ?? null));
  const update = vi.fn(() => Promise.resolve({}));
  const awardPoints = vi.fn(() => Promise.resolve());
  const fgaCheck = vi.fn(() => Promise.resolve(options.canManageRoles ?? false));

  const prisma = {
    user: { findUnique, update },
    membership: { findMany: vi.fn(() => Promise.resolve([])) },
    project: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;
  const gamification = { awardPoints } as unknown as GamificationService;
  const fga = { check: fgaCheck } as unknown as FgaService;

  return {
    controller: new AuthController(prisma, gamification, fga),
    findUnique,
    update,
    awardPoints,
    fgaCheck,
  };
}

function dto(newPassword: string): CompleteFirstLoginDto {
  const d = new CompleteFirstLoginDto();
  d.newPassword = newPassword;
  return d;
}

const ACTIVE_USER: AuthUser = { id: 'u1', email: 'colaborador@gmt.cl' };

describe('AuthController · GET /auth/me', () => {
  it('lanza 401 cuando no hay authUser', async () => {
    const { controller } = buildController({});
    await expect(controller.me(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('retorna los datos públicos del usuario cuando hay sesión', async () => {
    const { controller, findUnique } = buildController({
      user: {
        id: 'u1',
        email: 'colaborador@gmt.cl',
        firstName: 'Colaborador',
        lastName: 'Prueba',
        status: 'ACTIVE',
      },
      canManageRoles: false,
    });

    const result = await controller.me(ACTIVE_USER);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'u1' },
      select: { id: true, email: true, firstName: true, lastName: true, status: true },
    });
    expect(result).toEqual({
      id: 'u1',
      email: 'colaborador@gmt.cl',
      firstName: 'Colaborador',
      lastName: 'Prueba',
      status: 'ACTIVE',
      // sin memberships → todos los módulos (no se restringe el acceso)
      modules: ['dashboard', 'usuarios', 'directorio', 'finanzas', 'operaciones', 'recursos', 'herramientas', 'v-metric'],
      canManageRoles: false,
    });
  });

  it('incluye canManageRoles=true consultando FGA (can_manage_roles sobre organization:gmt)', async () => {
    const { controller, fgaCheck } = buildController({
      user: {
        id: 'u1',
        email: 'admin@gmt.cl',
        firstName: 'Admin',
        lastName: 'GMT',
        status: 'ACTIVE',
      },
      canManageRoles: true,
    });

    const result = await controller.me(ACTIVE_USER);

    expect(fgaCheck).toHaveBeenCalledWith({
      user: 'user:u1',
      relation: 'can_manage_roles',
      object: 'organization:gmt',
    });
    expect(result.canManageRoles).toBe(true);
  });
});

describe('AuthController · POST /auth/first-login/complete', () => {
  it('lanza 401 cuando no hay authUser', async () => {
    const { controller } = buildController({});
    await expect(
      controller.completeFirstLogin(undefined, dto('password123')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lanza 401 cuando el usuario de la sesión ya no existe', async () => {
    const { controller, update } = buildController({ user: null });
    await expect(
      controller.completeFirstLogin(ACTIVE_USER, dto('password123')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
  });

  it('lanza Conflict cuando el usuario ya está ACTIVE', async () => {
    const { controller, update } = buildController({ user: { status: 'ACTIVE' } });
    await expect(
      controller.completeFirstLogin(ACTIVE_USER, dto('password123')),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('camino feliz: PENDING → fija passwordHash (bcrypt) y activa el usuario', async () => {
    const { controller, update, awardPoints } = buildController({
      user: { status: 'PENDING_FIRST_LOGIN' },
    });

    const result = await controller.completeFirstLogin(ACTIVE_USER, dto('password123'));

    expect(update).toHaveBeenCalledTimes(1);
    const call = update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { passwordHash: string; status: string };
    };
    expect(call.where).toEqual({ id: 'u1' });
    expect(call.data.status).toBe('ACTIVE');
    expect(typeof call.data.passwordHash).toBe('string');
    expect(call.data.passwordHash.length).toBeGreaterThan(0);
    // el hash almacenado verifica contra la contraseña en claro
    await expect(verifyPassword('password123', call.data.passwordHash)).resolves.toBe(true);
    expect(awardPoints).toHaveBeenCalledWith('u1', 'FIRST_LOGIN');
    expect(result).toEqual({ status: 'ACTIVE' });
  });
});
```

- [ ] 2. Corré el test y verificá que falla (el controller aún no acepta un tercer parámetro `FgaService` ni devuelve `canManageRoles`):
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run test/auth/auth.controller.spec.ts
```
Falla esperada: error de tipos/runtime porque `AuthController` solo toma 2 argumentos y `MeResponse` no tiene `canManageRoles`.

- [ ] 3. Implementación mínima en `C:/Users/juana/GMT Link/nodes/backend-central/src/auth/auth.controller.ts`: inyectá `FgaService`, agregá el campo a `MeResponse` y calculá el check en `me()`.

Reemplazá el bloque de imports y la interfaz `MeResponse`:
```ts
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GamificationService } from '../modules/gamification/gamification.service';
import { FgaService } from '../fga/fga.service';
import { ORG_ID, ORG_OBJECT_TYPE } from '../common/org.constant';
import type { AuthUser } from '../authz/auth-user.types';
import { CurrentUser } from './current-user.decorator';
import { CompleteFirstLoginDto } from './dto/complete-first-login.dto';
import { LoginDto } from './dto/login.dto';
import { hashPassword, verifyPassword } from '../common/password';
import { signToken } from '../common/jwt';
import './auth-request.types';

/** Vista pública del usuario autenticado. Nunca expone campos internos. */
interface MeResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: string;
  /** Módulos del sidebar visibles para este usuario (derivados de su cliente). */
  modules: string[];
  /** true si el usuario tiene `can_manage_roles` sobre `organization:gmt` (§8, Fase 4 RBAC). */
  canManageRoles: boolean;
}
```

Actualizá el constructor y `me()`:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly gamification: GamificationService,
    private readonly fga: FgaService,
  ) {}
```

```ts
  /** Datos del usuario autenticado. 401 si no hay sesión. */
  @Get('me')
  async me(@CurrentUser() authUser: AuthUser | undefined): Promise<MeResponse> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        status: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('El usuario de la sesión ya no existe.');
    }

    const canManageRoles = await this.fga.check({
      user: `user:${authUser.id}`,
      relation: 'can_manage_roles',
      object: `${ORG_OBJECT_TYPE}:${ORG_ID}`,
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      status: user.status,
      modules: await this.resolveModules(user.id),
      canManageRoles,
    };
  }
```

- [ ] 4. Corré el test y verificá que pasa:
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run test/auth/auth.controller.spec.ts
```

- [ ] 5. Commit:
```bash
git add "nodes/backend-central/src/auth/auth.controller.ts" "nodes/backend-central/test/auth/auth.controller.spec.ts" && git commit -m "feat(auth): canManageRoles en GET /auth/me vía FgaService.check"
```

---

### Task 4.2: `MeResponse` compartido en `@gmt-platform/contracts`

**Files:**
- Modify: `C:/Users/juana/GMT Link/packages/contracts/src/index.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/auth/auth.controller.spec.ts` (ya cubre el shape; este task solo agrega el tipo compartido si `MeResponse` ya está exportado desde contracts — verificar antes de escribir)

- [ ] 1. Revisá si `MeResponse` (o equivalente) ya existe en `packages/contracts/src/index.ts`:
```powershell
Select-String -Path "C:/Users/juana/GMT Link/packages/contracts/src/index.ts" -Pattern "MeResponse"
```
  - Si NO existe ninguna definición de `MeResponse` en contracts (el tipo vive solo local al controller, como se confirmó al leer `auth.controller.ts`), no hay contrato compartido que romper: saltar a Task 4.3. Esta task queda como no-op documentado — el tipo `MeResponse` de Fase 4 permanece privado en `auth.controller.ts` (ya extendido en Task 4.1). No dupliques la interfaz en contracts salvo que el frontend la consuma tipada desde ahí (no es el caso hoy: `nodes/web` consume `/auth/me` sin tipo compartido).
  - Si SÍ existe, agregale `canManageRoles: boolean;` al final de la interfaz y corré `tsc --noEmit` en ambos paquetes para confirmar que no rompe consumidores:
```powershell
pnpm --filter "@gmt-platform/contracts" exec tsc --noEmit
pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
pnpm --filter "@gmt-platform/web" exec tsc --noEmit
```
- [ ] 2. (Solo si hubo cambio) Commit:
```bash
git add "packages/contracts/src/index.ts" && git commit -m "feat(contracts): canManageRoles en MeResponse"
```

---

### Task 4.3: Registrar `RolesModule` en `AppModule`

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/app.module.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/app.module.spec.ts` (nuevo)

> Precondición: `RolesModule` (Fase 2/3 del spec, `nodes/backend-central/src/modules/roles/roles.module.ts` exportando `RolesController` + `RolesService`) ya debe existir. Si esta task se ejecuta antes de esas fases, el import fallará en compilación — en ese caso, verificar el orden de fases con el usuario antes de continuar.

- [ ] 1. Creá `test/app.module.spec.ts` con un test que falla (verifica que `RolesModule` está entre los `imports` del `AppModule`, sin necesidad de bootear Nest completo):
```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RolesModule } from '../src/modules/roles/roles.module';

/** Lee los `imports` declarados en el decorador @Module de una clase. */
function getModuleImports(moduleClass: unknown): unknown[] {
  const meta = Reflect.getMetadata('imports', moduleClass) as unknown[] | undefined;
  return meta ?? [];
}

describe('AppModule', () => {
  it('registra RolesModule (Fase 4 RBAC matriz)', () => {
    void new Reflector(); // fuerza carga de reflect-metadata en runtime de test
    const imports = getModuleImports(AppModule);
    expect(imports).toContain(RolesModule);
  });
});
```

- [ ] 2. Corré el test y verificá que falla:
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run test/app.module.spec.ts
```
Falla esperada: `RolesModule` no está en `imports` (y/o el import del archivo aún no existe si `roles.module.ts` no fue creado en Fase 2/3 — confirmar esa dependencia antes de seguir).

- [ ] 3. Implementación mínima: agregá el import y registrá el módulo en `C:/Users/juana/GMT Link/nodes/backend-central/src/app.module.ts`.

Agregá junto a los demás imports de `modules/*`:
```ts
import { RolesModule } from './modules/roles/roles.module';
```

Agregá `RolesModule` al arreglo `imports` (después de `UsersModule`, junto a los módulos de autorización/directorio, para mantener el agrupamiento existente):
```ts
    UsersModule,
    RolesModule,
    ProfileModule,
```

- [ ] 4. Corré el test y verificá que pasa:
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run test/app.module.spec.ts
```

- [ ] 5. Commit:
```bash
git add "nodes/backend-central/src/app.module.ts" "nodes/backend-central/test/app.module.spec.ts" && git commit -m "feat(app): registra RolesModule en AppModule"
```

---

### Task 4.4: Verificación del guard con `can_manage_roles` (403 no-admin / 200 admin)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/test/authz/permissions.guard.static.spec.ts`

> `PermissionsGuard` es genérico (no conoce relaciones específicas): ya está cubierto por `permissions.guard.static.spec.ts` para el patrón de recurso de id estático (`organization:gmt`) que usa `can_manage_roles`. Esta task añade el caso concreto de `can_manage_roles` para dejar registrado el contrato exacto que usará `RolesController` (Fase 2) y `AuthController.me()` (Task 4.1), sin acoplar el guard a un permiso particular.

- [ ] 1. Agregá un `describe` adicional al final de `test/authz/permissions.guard.static.spec.ts` (después del bloque existente) con el caso `can_manage_roles`:
```ts
describe('PermissionsGuard — can_manage_roles sobre organization:gmt (Fase 4 RBAC matriz)', () => {
  class RolesFixtureController {
    @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
    manageRoles(): string {
      return 'ok';
    }
  }

  function createRolesContext(request: RequestLike): ExecutionContext {
    const partialContext = {
      getHandler: (): HandlerRef => RolesFixtureController.prototype.manageRoles,
      getClass: (): typeof RolesFixtureController => RolesFixtureController,
      switchToHttp: (): { getRequest: () => RequestLike } => ({
        getRequest: (): RequestLike => request,
      }),
    };
    return partialContext as unknown as ExecutionContext;
  }

  it('200: admin con can_manage_roles=true accede', async () => {
    const { guard, check } = createGuard(true);
    const context = createRolesContext({ authUser: { id: 'admin1' }, params: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(check).toHaveBeenCalledWith({
      user: 'user:admin1',
      relation: 'can_manage_roles',
      object: `organization:${ORG_ID}`,
    });
  });

  it('403: usuario sin can_manage_roles es rechazado', async () => {
    const { guard, check } = createGuard(false);
    const context = createRolesContext({ authUser: { id: 'noadmin' }, params: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(check).toHaveBeenCalledTimes(1);
  });
});
```
Nota: el archivo ya importa `ForbiddenException`, `UnauthorizedException`, `ExecutionContext`, `RequestLike`, `HandlerRef`, `createGuard`, `RequirePermission` y define `ORG_ID = 'gmt'` — no dupliques esas declaraciones, solo agregá el `describe` nuevo.

- [ ] 2. Corré el test y verificá que falla (el `describe` nuevo aún no existe hasta escribirlo; si ya escribiste el archivo completo en el paso 1, este paso confirma que compila y pasa en rojo→verde de una: corré primero comentando mentalmente que es agregado puro, así que directamente validá que pasa):
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run test/authz/permissions.guard.static.spec.ts
```

- [ ] 3. Si pasa en verde de inmediato (es un test aditivo sobre comportamiento genérico ya implementado, no requiere cambios de código), confirmá igualmente corriendo la suite completa de auth/authz para descartar regresiones:
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run test/authz/permissions.guard.static.spec.ts test/authz/permissions.guard.spec.ts test/auth/auth.controller.spec.ts
```

- [ ] 4. Commit:
```bash
git add "nodes/backend-central/test/authz/permissions.guard.static.spec.ts" && git commit -m "test(authz): cubre can_manage_roles sobre organization:gmt en PermissionsGuard"
```

---

### Task 4.5: Verificación integral de la Fase 4

**Files:** ninguno (solo comandos de verificación)

- [ ] 1. Typecheck completo del backend:
```powershell
pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
```
- [ ] 2. Suite completa de tests del backend:
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run
```
- [ ] 3. Lint:
```powershell
pnpm lint
```
- [ ] 4. Si todo pasa, no se requiere commit adicional (los commits ya se hicieron por task). Si algo falla, arreglar y crear un nuevo commit puntual (no amend).

---

## Fase 5: Frontend — Roles dinámicos (React + Vite + TS + Tailwind + shadcn)

### Task 5.1: Contracts frontend-visibles — tipos de catálogo y rol (`RoleGrant`, `RoleDetail`, `PermissionCatalogItem`, etc.)

**Files:**
- Modify: `C:/Users/juana/GMT Link/packages/contracts/src/index.ts`
- Test: `C:/Users/juana/GMT Link/packages/contracts/src/index.test.ts` (crear si no existe; si el paquete no tiene tests, crear el archivo con este único test de "shape")

Nota: si `@gmt-platform/contracts` ya recibió estos tipos en una fase de backend anterior (Fase 1-4 de este mismo spine), este task se vuelve un **no-op verificado**: correr el test igual y saltar al commit solo si hubo cambios.

- [ ] Escribir el test que falla — verifica que los tipos nuevos existen y son asignables (test de compilación, no de runtime; usamos un `it` que solo ejercita valores literales):

```ts
// packages/contracts/src/index.test.ts
import { describe, it, expect } from 'vitest';
import type {
  PermissionKind,
  FgaObjectType,
  PermissionCatalogItem,
  PermissionCatalogGroup,
  RoleGrant,
  RoleDetail,
  CreateRoleInput,
  UpdateRoleInput,
  AssignRoleInput,
} from './index';
import { ROLE_KEYS, type RoleKey } from './index';

describe('contracts — tipos de roles dinámicos (§Fase 5)', () => {
  it('RoleKey es string (unión abierta) y ROLE_KEYS sigue disponible para labels', () => {
    const k: RoleKey = 'c_inspector_terreno';
    expect(typeof k).toBe('string');
    expect(ROLE_KEYS.length).toBeGreaterThan(0);
  });

  it('PermissionCatalogItem / PermissionCatalogGroup tienen la forma esperada', () => {
    const item: PermissionCatalogItem = {
      key: 'project:read',
      label: 'Ver proyecto',
      module: 'operaciones',
      kind: 'STRUCTURAL' as PermissionKind,
      scopeable: false,
      fgaObjectType: 'project' as FgaObjectType,
      composable: true,
    };
    const group: PermissionCatalogGroup = { module: 'operaciones', items: [item] };
    expect(group.items[0]).toEqual(item);
  });

  it('RoleDetail / RoleGrant / Create-Update-AssignRoleInput tienen la forma esperada', () => {
    const grant: RoleGrant = { permissionKey: 'project:read', scope: 'GLOBAL' };
    const detail: RoleDetail = {
      key: 'c_inspector',
      label: 'Inspector',
      description: null,
      isSystem: false,
      allowedScopeTypes: ['PROJECT'],
      grants: [grant],
    };
    const create: CreateRoleInput = { label: 'Inspector', grants: [grant] };
    const update: UpdateRoleInput = { label: 'Inspector v2' };
    const assign: AssignRoleInput = { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' };
    expect(detail.grants[0]).toEqual(grant);
    expect(create.grants[0]).toEqual(grant);
    expect(update.label).toBe('Inspector v2');
    expect(assign.roleKey).toBe('c_inspector');
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/contracts" exec vitest run src/index.test.ts` (falla porque los tipos no existen todavía → error de compilación TS, no de aserción)
- [ ] Implementación mínima — agregar al final de `packages/contracts/src/index.ts` (después del bloque donde vive `PermissionScopeValue`, sin tocar `RoleKey`/`ROLE_KEYS` si ya están abiertos por una fase previa; si `RoleKey` todavía es unión cerrada, cambiarlo aquí):

```ts
// Si RoleKey aún es unión cerrada de una fase anterior, reemplazar por:
// export type RoleKey = string;
// y dejar ROLE_KEYS como const solo para labels/orden de roles del sistema.

/** Naturaleza de un permiso del catálogo (§4.3): FUNCTIONAL (Postgres) o STRUCTURAL (tupla FGA). */
export type PermissionKind = 'FUNCTIONAL' | 'STRUCTURAL';

/** Tipo de objeto FGA sobre el que se escribe la tupla de un permiso STRUCTURAL componible. */
export type FgaObjectType = 'organization' | 'project';

/** Ítem del catálogo de permisos (`GET /permissions`). */
export interface PermissionCatalogItem {
  key: string;
  label: string;
  module: string;
  kind: PermissionKind;
  scopeable: boolean;
  fgaObjectType: FgaObjectType | null;
  composable: boolean;
}

/** Agrupación del catálogo por módulo, en el orden que devuelve el backend. */
export interface PermissionCatalogGroup {
  module: string;
  items: PermissionCatalogItem[];
}

/** Par (permiso, alcance funcional) que compone un rol. */
export interface RoleGrant {
  permissionKey: string;
  scope: PermissionScopeValue;
}

/** Detalle completo de un rol (sistema o personalizado). */
export interface RoleDetail {
  key: string;
  label: string;
  description: string | null;
  isSystem: boolean;
  allowedScopeTypes: ScopeType[];
  grants: RoleGrant[];
}

/** Body de `POST /roles`. */
export interface CreateRoleInput {
  label: string;
  description?: string;
  grants: RoleGrant[];
}

/** Body de `PATCH /roles/:key`. */
export interface UpdateRoleInput {
  label?: string;
  description?: string;
  grants?: RoleGrant[];
}

/** Body de `POST /users/:id/roles` (asignación con alcance). */
export interface AssignRoleInput {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
}
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/contracts" exec vitest run src/index.test.ts` y `pnpm --filter "@gmt-platform/contracts" exec tsc --noEmit`
- [ ] Commit:
```bash
git add packages/contracts/src/index.ts packages/contracts/src/index.test.ts && git commit -m "feat(contracts): tipos de catálogo de permisos y roles dinámicos"
```

---

### Task 5.2: `AuthedUser.canManageRoles` en tipos y auth-context

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/types/auth.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/context/auth-context.tsx` (sin cambios de lógica: el campo ya viaja en `AuthedUser` devuelto por `getMe()`; solo se documenta)
- Test: `C:/Users/juana/GMT Link/nodes/web/src/context/auth-context.test.tsx` (si no existe, crearlo; si ya existe uno, agregar el `it`)

- [ ] Escribir el test que falla:

```tsx
// nodes/web/src/context/auth-context.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/context/auth-context';

const { mockGetToken } = vi.hoisted(() => ({ mockGetToken: vi.fn() }));
vi.mock('@/lib/auth-token', () => ({
  getToken: mockGetToken,
  setToken: vi.fn(),
  clearToken: vi.fn(),
}));

const { mockGetMe } = vi.hoisted(() => ({ mockGetMe: vi.fn() }));
vi.mock('@/lib/api', () => ({
  getMe: mockGetMe,
  login: vi.fn(),
  completeFirstLogin: vi.fn(),
}));

function Probe() {
  const { user, loading } = useAuth();
  if (loading) return <span>cargando</span>;
  return <span>canManageRoles:{String(user?.canManageRoles)}</span>;
}

describe('AuthProvider — expone canManageRoles del /auth/me', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetMe.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('propaga canManageRoles=true cuando el backend lo devuelve', async () => {
    mockGetToken.mockReturnValue('tok');
    mockGetMe.mockResolvedValue({
      id: 'u1',
      email: 'a@b.cl',
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'ACTIVE',
      modules: ['dashboard'],
      canManageRoles: true,
    });

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => screen.getByText('canManageRoles:true'));
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- auth-context` (falla en tipos: `canManageRoles` no existe en `AuthedUser`)
- [ ] Implementación mínima — agregar el campo al tipo (`auth-context.tsx` no necesita cambios de código, ya reenvía el objeto completo de `getMe()`; se agrega solo un comentario):

```ts
// nodes/web/src/types/auth.ts
export interface AuthedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  /** Módulos del sidebar visibles para este usuario (derivados de su cliente). */
  modules: string[];
  /** `true` si el usuario tiene la relación FGA `can_manage_roles` (org_admin). Gatea `/roles` en el nav. */
  canManageRoles: boolean;
}
```

```tsx
// nodes/web/src/context/auth-context.tsx
// (sin cambios funcionales: user ya es el AuthedUser completo devuelto por getMe(),
// que ahora incluye canManageRoles gracias al tipo actualizado arriba)
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- auth-context`
- [ ] Commit:
```bash
git add nodes/web/src/types/auth.ts nodes/web/src/context/auth-context.test.tsx && git commit -m "feat(web/auth): expone canManageRoles en AuthedUser"
```

---

### Task 5.3: `api.ts` — métodos del módulo de roles (catálogo + CRUD + clonar)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.ts`
- Test: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.test.ts`

- [ ] Escribir el test que falla — agregar al final de `api.test.ts` (mismo patrón `res()`/`vi.stubGlobal('fetch', …)` que el resto del archivo):

```ts
// agregar a nodes/web/src/lib/api.test.ts
import {
  getPermissionsCatalog,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  cloneRole,
} from '@/lib/api';
import type { PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

describe('api — módulo de roles dinámicos (catálogo + CRUD)', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockReturnValue('tok');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const group: PermissionCatalogGroup = {
    module: 'operaciones',
    items: [
      {
        key: 'project:read',
        label: 'Ver proyecto',
        module: 'operaciones',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: 'project',
        composable: true,
      },
    ],
  };

  const roleDetail: RoleDetail = {
    key: 'c_inspector',
    label: 'Inspector',
    description: null,
    isSystem: false,
    allowedScopeTypes: ['PROJECT'],
    grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
  };

  it('getPermissionsCatalog — GET /permissions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res([group]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getPermissionsCatalog();

    expect(result).toEqual([group]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/permissions');
    expect(init.method ?? 'GET').toBe('GET');
  });

  it('listRoles — GET /roles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res([roleDetail]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await listRoles();

    expect(result).toEqual([roleDetail]);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/roles');
  });

  it('getRole — GET /roles/:key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(roleDetail));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getRole('c_inspector');

    expect(result).toEqual(roleDetail);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/roles/c_inspector');
  });

  it('createRole — POST /roles con el body serializado', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(roleDetail));
    vi.stubGlobal('fetch', fetchMock);

    const result = await createRole({ label: 'Inspector', grants: roleDetail.grants });

    expect(result).toEqual(roleDetail);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Inspector', grants: roleDetail.grants });
  });

  it('updateRole — PATCH /roles/:key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(roleDetail));
    vi.stubGlobal('fetch', fetchMock);

    const result = await updateRole('c_inspector', { label: 'Inspector v2' });

    expect(result).toEqual(roleDetail);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Inspector v2' });
  });

  it('deleteRole — DELETE /roles/:key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: () => Promise.reject(new Error('no debería parsearse')) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteRole('c_inspector')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector');
    expect(init.method).toBe('DELETE');
  });

  it('deleteRole — 409 ROLE_IN_USE propaga ApiError con status 409', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res({ message: 'Rol en uso', code: 'ROLE_IN_USE' }, false, 409)));

    const err = await deleteRole('c_inspector').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });

  it('cloneRole — POST /roles/:key/clone', async () => {
    const cloned = { ...roleDetail, key: 'c_inspector_2', label: 'Inspector (copia)' };
    const fetchMock = vi.fn().mockResolvedValue(res(cloned));
    vi.stubGlobal('fetch', fetchMock);

    const result = await cloneRole('c_inspector', 'Inspector (copia)');

    expect(result).toEqual(cloned);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector/clone');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Inspector (copia)' });
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- api.test`
- [ ] Implementación mínima — agregar a `nodes/web/src/lib/api.ts`:

Actualizar el import de contracts:

```ts
import type {
  DirectoryEntry,
  DirectoryEntryExtended,
  PermissionCatalogGroup,
  ProfileMe,
  RoleDetail,
  RoleKey,
  CreateRoleInput,
  UpdateRoleInput,
  UpdateProfileInput,
  UserStatus,
} from '@gmt-platform/contracts';
```

Agregar la sección nueva (después de `/* Usuarios (§6-1.1) … */` o al final del archivo, antes de Métricas Jerárquicas — cualquier posición al nivel de módulo sirve; se sugiere después del bloque de Usuarios):

```ts
/* -------------------------------------------------------------------------- */
/* Roles dinámicos (§Fase 5 — matriz RBAC)                                    */
/* -------------------------------------------------------------------------- */

/** `GET /permissions` — catálogo de permisos agrupado por módulo. */
export function getPermissionsCatalog(): Promise<PermissionCatalogGroup[]> {
  return request<PermissionCatalogGroup[]>('/permissions');
}

/** `GET /roles` — todos los roles (sistema + personalizados). */
export function listRoles(): Promise<RoleDetail[]> {
  return request<RoleDetail[]>('/roles');
}

/** `GET /roles/:key` — detalle de un rol. 404 si no existe. */
export function getRole(key: string): Promise<RoleDetail> {
  return request<RoleDetail>(`/roles/${encodeURIComponent(key)}`);
}

/** `POST /roles` — crea un rol personalizado. 400 en validaciones de grants. */
export function createRole(input: CreateRoleInput): Promise<RoleDetail> {
  return request<RoleDetail>('/roles', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `PATCH /roles/:key` — edita un rol personalizado. 403 si es del sistema. */
export function updateRole(key: string, input: UpdateRoleInput): Promise<RoleDetail> {
  return request<RoleDetail>(`/roles/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** `DELETE /roles/:key` — elimina un rol. 403 si es del sistema; 409 si está en uso. */
export function deleteRole(key: string): Promise<void> {
  return request<void>(`/roles/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

/** `POST /roles/:key/clone` — clona un rol (incluye del sistema) a uno personalizado nuevo. */
export function cloneRole(key: string, label: string): Promise<RoleDetail> {
  return request<RoleDetail>(`/roles/${encodeURIComponent(key)}/clone`, {
    method: 'POST',
    body: JSON.stringify({ label }),
  });
}
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- api.test`
- [ ] Commit:
```bash
git add nodes/web/src/lib/api.ts nodes/web/src/lib/api.test.ts && git commit -m "feat(web/api): métodos de catálogo de permisos y CRUD de roles"
```

---

### Task 5.4: `api.ts` — asignación por scope (`assignUserRole`/`removeUserRole` con `AssignRoleInput`)

Este task **reemplaza la firma existente** de `assignUserRole`/`removeUserRole` (antes `(id, roleKey)`) por la firma con alcance del spine. Esto rompe `use-users.ts` y `roles-dialog.tsx` — se actualizan en 5.5 y 5.7 respectivamente; hasta entonces el build queda roto a propósito (TDD), se corrige en la misma sesión antes de cerrar la fase.

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.ts`
- Test: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.test.ts`

- [ ] Escribir el test que falla — reemplazar los tests viejos de `assignUserRole`/`removeUserRole` si existen (no hay en el archivo actual, así que se agregan) por:

```ts
// agregar a nodes/web/src/lib/api.test.ts
import { assignUserRole, removeUserRole } from '@/lib/api';
import type { AssignRoleInput, UserRolesResponse } from '@/lib/api'; // UserRolesResponse ya vive en api.ts

describe('api — asignación de roles por alcance', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockReturnValue('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  const userRoles: UserRolesResponse = { id: 'u1', roleKeys: ['c_inspector'] };

  it('assignUserRole — POST /users/:id/roles con { roleKey, scopeType, scopeId }', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(userRoles));
    vi.stubGlobal('fetch', fetchMock);
    const input: AssignRoleInput = { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' };

    const result = await assignUserRole('u1', input);

    expect(result).toEqual(userRoles);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/users/u1/roles');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(input);
  });

  it('assignUserRole — 400 INVALID_SCOPE_FOR_ROLE propaga ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(res({ message: 'Alcance inválido', code: 'INVALID_SCOPE_FOR_ROLE' }, false, 400)),
    );
    const input: AssignRoleInput = { roleKey: 'c_inspector', scopeType: 'ORGANIZATION', scopeId: 'gmt' };

    const err = await assignUserRole('u1', input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });

  it('removeUserRole — DELETE /users/:id/roles?roleKey=&scopeType=&scopeId=', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(userRoles));
    vi.stubGlobal('fetch', fetchMock);

    const result = await removeUserRole('u1', { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' });

    expect(result).toEqual(userRoles);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3001/users/u1/roles?roleKey=c_inspector&scopeType=PROJECT&scopeId=p1',
    );
    expect(init.method).toBe('DELETE');
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- api.test` (falla porque la firma vieja de `assignUserRole(id, roleKey)` no coincide con `AssignRoleInput`)
- [ ] Implementación mínima — **reemplazar** en `nodes/web/src/lib/api.ts` las funciones existentes:

```ts
import type { AssignRoleInput } from '@gmt-platform/contracts'; // sumar al import ya existente de contracts
```

```ts
/** `POST /users/:id/roles` — asigna un rol con alcance. 400 si el scope no es válido para el rol. */
export function assignUserRole(id: string, input: AssignRoleInput): Promise<UserRolesResponse> {
  return request<UserRolesResponse>(`/users/${encodeURIComponent(id)}/roles`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `DELETE /users/:id/roles?roleKey=&scopeType=&scopeId=` — quita un rol de un alcance concreto. */
export function removeUserRole(
  id: string,
  params: { roleKey: string; scopeType: string; scopeId: string },
): Promise<UserRolesResponse> {
  const query = new URLSearchParams({
    roleKey: params.roleKey,
    scopeType: params.scopeType,
    scopeId: params.scopeId,
  });
  return request<UserRolesResponse>(
    `/users/${encodeURIComponent(id)}/roles?${query.toString()}`,
    { method: 'DELETE' },
  );
}
```

(Elimina las funciones viejas `assignUserRole(id, roleKey)` / `removeUserRole(id, roleKey)` del archivo — quedan reemplazadas por estas.)

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- api.test` (nota: `use-users.ts` y `roles-dialog.tsx` quedarán con error de tipos hasta el Task 5.5/5.7 — es esperado; no correr `tsc --noEmit` global todavía)
- [ ] Commit:
```bash
git add nodes/web/src/lib/api.ts nodes/web/src/lib/api.test.ts && git commit -m "feat(web/api): assignUserRole/removeUserRole con alcance (AssignRoleInput)"
```

---

### Task 5.5: `use-roles.ts` — hook de datos del módulo de roles

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/web/src/hooks/use-roles.ts`
- Test: `C:/Users/juana/GMT Link/nodes/web/src/hooks/use-roles.test.ts`

- [ ] Escribir el test que falla:

```ts
// nodes/web/src/hooks/use-roles.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

const {
  mockGetPermissionsCatalog,
  mockListRoles,
  mockGetRole,
  mockCreateRole,
  mockUpdateRole,
  mockDeleteRole,
  mockCloneRole,
} = vi.hoisted(() => ({
  mockGetPermissionsCatalog: vi.fn(),
  mockListRoles: vi.fn(),
  mockGetRole: vi.fn(),
  mockCreateRole: vi.fn(),
  mockUpdateRole: vi.fn(),
  mockDeleteRole: vi.fn(),
  mockCloneRole: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getPermissionsCatalog: mockGetPermissionsCatalog,
  listRoles: mockListRoles,
  getRole: mockGetRole,
  createRole: mockCreateRole,
  updateRole: mockUpdateRole,
  deleteRole: mockDeleteRole,
  cloneRole: mockCloneRole,
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { useRoles } from '@/hooks/use-roles';

const group: PermissionCatalogGroup = {
  module: 'operaciones',
  items: [
    {
      key: 'project:read',
      label: 'Ver proyecto',
      module: 'operaciones',
      kind: 'STRUCTURAL',
      scopeable: false,
      fgaObjectType: 'project',
      composable: true,
    },
  ],
};

const systemRole: RoleDetail = {
  key: 'org_admin',
  label: 'Administrador de organización',
  description: null,
  isSystem: true,
  allowedScopeTypes: ['ORGANIZATION'],
  grants: [],
};

const customRole: RoleDetail = {
  key: 'c_inspector',
  label: 'Inspector',
  description: null,
  isSystem: false,
  allowedScopeTypes: ['PROJECT'],
  grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
};

describe('useRoles', () => {
  beforeEach(() => {
    mockGetPermissionsCatalog.mockReset().mockResolvedValue([group]);
    mockListRoles.mockReset().mockResolvedValue([systemRole, customRole]);
    mockGetRole.mockReset();
    mockCreateRole.mockReset();
    mockUpdateRole.mockReset();
    mockDeleteRole.mockReset();
    mockCloneRole.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('carga catálogo y roles al montar; separa sistema/personalizados', async () => {
    const { result } = renderHook(() => useRoles());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.catalog).toEqual([group]);
    expect(result.current.systemRoles).toEqual([systemRole]);
    expect(result.current.customRoles).toEqual([customRole]);
    expect(result.current.error).toBeNull();
  });

  it('error de carga se refleja en error y no rompe', async () => {
    mockListRoles.mockRejectedValue(new Error('caído'));
    const { result } = renderHook(() => useRoles());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('caído');
  });

  it('createRole delega en la API y refresca la lista', async () => {
    mockCreateRole.mockResolvedValue(customRole);
    mockListRoles.mockResolvedValueOnce([systemRole]).mockResolvedValueOnce([systemRole, customRole]);
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createRole({ label: 'Inspector', grants: customRole.grants });
    });

    expect(mockCreateRole).toHaveBeenCalledWith({ label: 'Inspector', grants: customRole.grants });
    await waitFor(() => expect(result.current.customRoles).toEqual([customRole]));
  });

  it('deleteRole delega y refresca', async () => {
    mockDeleteRole.mockResolvedValue(undefined);
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteRole('c_inspector');
    });

    expect(mockDeleteRole).toHaveBeenCalledWith('c_inspector');
  });

  it('cloneRole delega en la API', async () => {
    const cloned = { ...customRole, key: 'c_inspector_2', label: 'Inspector (copia)' };
    mockCloneRole.mockResolvedValue(cloned);
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: RoleDetail | undefined;
    await act(async () => {
      returned = await result.current.cloneRole('org_admin', 'Inspector (copia)');
    });

    expect(mockCloneRole).toHaveBeenCalledWith('org_admin', 'Inspector (copia)');
    expect(returned).toEqual(cloned);
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- use-roles.test` (el módulo `@/hooks/use-roles` no existe)
- [ ] Implementación mínima:

```ts
// nodes/web/src/hooks/use-roles.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CreateRoleInput, PermissionCatalogGroup, RoleDetail, UpdateRoleInput } from '@gmt-platform/contracts';
import {
  ApiError,
  cloneRole as apiCloneRole,
  createRole as apiCreateRole,
  deleteRole as apiDeleteRole,
  getPermissionsCatalog,
  getRole as apiGetRole,
  listRoles,
  updateRole as apiUpdateRole,
} from '@/lib/api';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useRoles}. */
export interface UseRolesResult {
  /** Catálogo de permisos agrupado por módulo. */
  catalog: PermissionCatalogGroup[];
  /** Todos los roles (sin separar). */
  roles: RoleDetail[];
  /** Roles del sistema (`isSystem=true`) — solo lectura + clonar. */
  systemRoles: RoleDetail[];
  /** Roles personalizados (`isSystem=false`) — CRUD completo. */
  customRoles: RoleDetail[];
  /** `true` mientras se carga catálogo + roles. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null`. */
  error: string | null;
  /** Recarga catálogo + roles. */
  refetch: () => Promise<void>;
  /** Trae el detalle actualizado de un rol (para abrir el editor con datos frescos). */
  getRole: (key: string) => Promise<RoleDetail>;
  /** Crea un rol personalizado y refresca la lista. */
  createRole: (input: CreateRoleInput) => Promise<RoleDetail>;
  /** Edita un rol personalizado y refresca la lista. */
  updateRole: (key: string, input: UpdateRoleInput) => Promise<RoleDetail>;
  /** Elimina un rol y refresca la lista. */
  deleteRole: (key: string) => Promise<void>;
  /** Clona cualquier rol (incluso del sistema) a uno personalizado nuevo y refresca la lista. */
  cloneRole: (key: string, label: string) => Promise<RoleDetail>;
}

/**
 * Hook de datos de la página `/roles` (§Fase 5 — matriz RBAC). Envuelve el
 * catálogo de permisos y el CRUD de roles de `lib/api.ts`. Cada mutación
 * refresca la lista para reflejar el estado real del backend (incluye
 * `resyncRole` disparado del lado del servidor).
 */
export function useRoles(): UseRolesResult {
  const [catalog, setCatalog] = useState<PermissionCatalogGroup[]>([]);
  const [roles, setRoles] = useState<RoleDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [catalogData, rolesData] = await Promise.all([getPermissionsCatalog(), listRoles()]);
      if (mountedRef.current) {
        setCatalog(catalogData);
        setRoles(rolesData);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los roles.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const getRole = useCallback((key: string): Promise<RoleDetail> => apiGetRole(key), []);

  const createRole = useCallback(
    async (input: CreateRoleInput): Promise<RoleDetail> => {
      const created = await apiCreateRole(input);
      await load();
      return created;
    },
    [load],
  );

  const updateRole = useCallback(
    async (key: string, input: UpdateRoleInput): Promise<RoleDetail> => {
      const updated = await apiUpdateRole(key, input);
      await load();
      return updated;
    },
    [load],
  );

  const deleteRole = useCallback(
    async (key: string): Promise<void> => {
      await apiDeleteRole(key);
      await load();
    },
    [load],
  );

  const cloneRole = useCallback(
    async (key: string, label: string): Promise<RoleDetail> => {
      const cloned = await apiCloneRole(key, label);
      await load();
      return cloned;
    },
    [load],
  );

  return {
    catalog,
    roles,
    systemRoles: roles.filter((r) => r.isSystem),
    customRoles: roles.filter((r) => !r.isSystem),
    loading,
    error,
    refetch: load,
    getRole,
    createRole,
    updateRole,
    deleteRole,
    cloneRole,
  };
}
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- use-roles.test`
- [ ] Commit:
```bash
git add nodes/web/src/hooks/use-roles.ts nodes/web/src/hooks/use-roles.test.ts && git commit -m "feat(web/roles): hook use-roles para catálogo y CRUD de roles"
```

---

### Task 5.6: `role-editor.tsx` — editor de rol (nombre, descripción, permisos agrupados por módulo con alcance)

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/web/src/pages/roles/role-editor.tsx`
- Test: `C:/Users/juana/GMT Link/nodes/web/src/pages/roles/role-editor.test.tsx`

- [ ] Escribir el test que falla:

```tsx
// nodes/web/src/pages/roles/role-editor.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';
import { RoleEditor } from '@/pages/roles/role-editor';

const catalog: PermissionCatalogGroup[] = [
  {
    module: 'operaciones',
    items: [
      {
        key: 'project:read',
        label: 'Ver proyecto',
        module: 'operaciones',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: 'project',
        composable: true,
      },
      {
        key: 'task:create',
        label: 'Crear tarea',
        module: 'operaciones',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: 'project',
        composable: true,
      },
      {
        key: 'document:review',
        label: 'Revisar documentos',
        module: 'documentos',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: null,
        composable: false,
      },
    ],
  },
  {
    module: 'directorio',
    items: [
      {
        key: 'directory:view:extended',
        label: 'Ver directorio extendido',
        module: 'directorio',
        kind: 'STRUCTURAL',
        scopeable: true,
        fgaObjectType: 'organization',
        composable: true,
      },
    ],
  },
];

const customRole: RoleDetail = {
  key: 'c_inspector',
  label: 'Inspector',
  description: 'Inspecciona avance en terreno',
  isSystem: false,
  allowedScopeTypes: ['PROJECT'],
  grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
};

const systemRole: RoleDetail = {
  key: 'org_admin',
  label: 'Administrador de organización',
  description: null,
  isSystem: true,
  allowedScopeTypes: ['ORGANIZATION'],
  grants: [{ permissionKey: 'directory:view:extended', scope: 'GLOBAL' }],
};

describe('RoleEditor', () => {
  it('rol personalizado: permite editar nombre, descripción y toggles de permisos', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleEditor role={customRole} catalog={catalog} onSave={onSave} onClone={vi.fn()} />);

    expect(screen.getByDisplayValue('Inspector')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ver proyecto/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Crear tarea/i })).not.toBeChecked();

    fireEvent.click(screen.getByRole('checkbox', { name: /Crear tarea/i }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [, input] = onSave.mock.calls[0] as [string, { grants: Array<{ permissionKey: string }> }];
    const keys = input.grants.map((g) => g.permissionKey).sort();
    expect(keys).toEqual(['project:read', 'task:create']);
  });

  it('ítems composable=false aparecen deshabilitados', () => {
    render(<RoleEditor role={customRole} catalog={catalog} onSave={vi.fn()} onClone={vi.fn()} />);

    expect(screen.getByRole('checkbox', { name: /Revisar documentos/i })).toBeDisabled();
  });

  it('rol del sistema: solo lectura, sin botón Guardar, con botón Clonar', () => {
    const onClone = vi.fn();
    render(<RoleEditor role={systemRole} catalog={catalog} onSave={vi.fn()} onClone={onClone} />);

    expect(screen.queryByRole('button', { name: /Guardar/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Ver directorio extendido/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Clonar/i }));
    expect(onClone).toHaveBeenCalledWith('org_admin');
  });

  it('permiso scopeable muestra selector de alcance (OWN/PROJECT/GLOBAL)', () => {
    render(<RoleEditor role={customRole} catalog={catalog} onSave={vi.fn()} onClone={vi.fn()} />);

    expect(screen.getByLabelText(/Alcance de Ver directorio extendido/i)).toBeInTheDocument();
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- role-editor.test` (el módulo no existe)
- [ ] Implementación mínima:

```tsx
// nodes/web/src/pages/roles/role-editor.tsx
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Copy, Lock } from 'lucide-react';
import type {
  CreateRoleInput,
  PermissionCatalogGroup,
  PermissionScopeValue,
  RoleDetail,
  RoleGrant,
  UpdateRoleInput,
} from '@gmt-platform/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SCOPE_OPTIONS: ReadonlyArray<{ value: PermissionScopeValue; label: string }> = [
  { value: 'OWN', label: 'Solo propio' },
  { value: 'PROJECT', label: 'Proyectos asociados' },
  { value: 'GLOBAL', label: 'Todo' },
];

/** Estado local de edición: mapa permissionKey -> { checked, scope }. */
interface GrantDraft {
  checked: boolean;
  scope: PermissionScopeValue;
}

function buildInitialDrafts(grants: readonly RoleGrant[]): Map<string, GrantDraft> {
  const map = new Map<string, GrantDraft>();
  for (const g of grants) {
    map.set(g.permissionKey, { checked: true, scope: g.scope });
  }
  return map;
}

/**
 * Editor de un rol (§Fase 5 — matriz RBAC). Para roles personalizados permite
 * editar nombre/descripción y componer permisos del catálogo agrupados por
 * módulo, con checkbox + selector de alcance cuando el permiso es
 * `scopeable`. Los ítems `composable=false` quedan deshabilitados. Los roles
 * del sistema (`isSystem=true`) se muestran en modo solo lectura con la
 * acción "Clonar".
 */
export function RoleEditor({
  role,
  catalog,
  onSave,
  onClone,
}: {
  role: RoleDetail;
  catalog: PermissionCatalogGroup[];
  onSave: (key: string, input: UpdateRoleInput | CreateRoleInput) => Promise<void>;
  onClone: (key: string) => void;
}): ReactNode {
  const [label, setLabel] = useState(role.label);
  const [description, setDescription] = useState(role.description ?? '');
  const [drafts, setDrafts] = useState<Map<string, GrantDraft>>(() => buildInitialDrafts(role.grants));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const groupId = useId();

  useEffect(() => {
    setLabel(role.label);
    setDescription(role.description ?? '');
    setDrafts(buildInitialDrafts(role.grants));
    setError(null);
  }, [role]);

  const readOnly = role.isSystem;

  function toggle(permissionKey: string, checked: boolean, defaultScope: PermissionScopeValue): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      if (checked) {
        const existing = next.get(permissionKey);
        next.set(permissionKey, { checked: true, scope: existing?.scope ?? defaultScope });
      } else {
        next.delete(permissionKey);
      }
      return next;
    });
  }

  function setScope(permissionKey: string, scope: PermissionScopeValue): void {
    setDrafts((prev) => {
      const next = new Map(prev);
      const existing = next.get(permissionKey);
      if (existing) next.set(permissionKey, { ...existing, scope });
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    const grants: RoleGrant[] = Array.from(drafts.entries()).map(([permissionKey, draft]) => ({
      permissionKey,
      scope: draft.scope,
    }));
    try {
      await onSave(role.key, { label, description: description || undefined, grants });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el rol.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium leading-none">Nombre</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={readOnly}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium leading-none">Descripción</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
            />
          </label>
        </div>

        {readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Lock className="size-3" aria-hidden />
              Rol del sistema
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => onClone(role.key)}>
              <Copy aria-hidden />
              Clonar
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-5">
        {catalog.map((group) => (
          <fieldset key={group.module} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group.module}
            </legend>
            <div className="flex flex-col gap-1.5">
              {group.items.map((item) => {
                const draft = drafts.get(item.key);
                const checked = draft?.checked ?? false;
                const disabled = readOnly || !item.composable;
                const checkboxId = `${groupId}-${item.key}`;
                return (
                  <div
                    key={item.key}
                    className={cn(
                      'flex flex-col gap-2 rounded-md border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between',
                      checked && 'border-primary/40 bg-primary/5',
                      disabled && 'opacity-60',
                    )}
                    title={!item.composable ? 'Este permiso no es componible en roles personalizados.' : undefined}
                  >
                    <label htmlFor={checkboxId} className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(e) => toggle(item.key, e.target.checked, 'GLOBAL')}
                        className="size-4 rounded border-input accent-primary outline-none"
                      />
                      {item.label}
                    </label>

                    {item.scopeable && checked && (
                      <label
                        htmlFor={`${checkboxId}-scope`}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        {`Alcance de ${item.label}`}
                        <select
                          id={`${checkboxId}-scope`}
                          value={draft?.scope ?? 'GLOBAL'}
                          disabled={readOnly}
                          onChange={(e) => setScope(item.key, e.target.value as PermissionScopeValue)}
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                        >
                          {SCOPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {!readOnly && (
        <div className="flex justify-end">
          <Button type="button" onClick={() => void handleSave()} disabled={saving}>
            Guardar
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- role-editor.test`
- [ ] Commit:
```bash
git add nodes/web/src/pages/roles/role-editor.tsx nodes/web/src/pages/roles/role-editor.test.tsx && git commit -m "feat(web/roles): RoleEditor con permisos agrupados por módulo y alcance"
```

---

### Task 5.7: `pages/roles/index.tsx` — lista (sistema/personalizados) + orquestación con crear/clonar/borrar

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/web/src/pages/roles/index.tsx`
- Create: `C:/Users/juana/GMT Link/nodes/web/src/pages/roles/new-role-dialog.tsx`
- Test: `C:/Users/juana/GMT Link/nodes/web/src/pages/roles/index.test.tsx`

- [ ] Escribir el test que falla:

```tsx
// nodes/web/src/pages/roles/index.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

const { mockUseRoles } = vi.hoisted(() => ({ mockUseRoles: vi.fn() }));
vi.mock('@/hooks/use-roles', () => ({ useRoles: mockUseRoles }));

import RolesPage from '@/pages/roles/index';

const catalog: PermissionCatalogGroup[] = [
  {
    module: 'operaciones',
    items: [
      {
        key: 'project:read',
        label: 'Ver proyecto',
        module: 'operaciones',
        kind: 'STRUCTURAL',
        scopeable: false,
        fgaObjectType: 'project',
        composable: true,
      },
    ],
  },
];

const systemRole: RoleDetail = {
  key: 'org_admin',
  label: 'Administrador de organización',
  description: null,
  isSystem: true,
  allowedScopeTypes: ['ORGANIZATION'],
  grants: [],
};

const customRole: RoleDetail = {
  key: 'c_inspector',
  label: 'Inspector',
  description: null,
  isSystem: false,
  allowedScopeTypes: ['PROJECT'],
  grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
};

function baseHook(overrides: Partial<ReturnType<typeof mockUseRoles>> = {}) {
  return {
    catalog,
    roles: [systemRole, customRole],
    systemRoles: [systemRole],
    customRoles: [customRole],
    loading: false,
    error: null,
    refetch: vi.fn(),
    getRole: vi.fn().mockResolvedValue(customRole),
    createRole: vi.fn().mockResolvedValue(customRole),
    updateRole: vi.fn().mockResolvedValue(customRole),
    deleteRole: vi.fn().mockResolvedValue(undefined),
    cloneRole: vi.fn().mockResolvedValue({ ...customRole, key: 'c_inspector_2' }),
    ...overrides,
  };
}

describe('RolesPage', () => {
  beforeEach(() => {
    mockUseRoles.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('lista roles del sistema y personalizados en secciones separadas', () => {
    mockUseRoles.mockReturnValue(baseHook());
    render(<RolesPage />);

    expect(screen.getByText(/Del sistema/i)).toBeInTheDocument();
    expect(screen.getByText(/Personalizados/i)).toBeInTheDocument();
    expect(screen.getByText('Administrador de organización')).toBeInTheDocument();
    expect(screen.getByText('Inspector')).toBeInTheDocument();
  });

  it('estado de carga muestra el loader', () => {
    mockUseRoles.mockReturnValue(baseHook({ loading: true, roles: [], systemRoles: [], customRoles: [] }));
    render(<RolesPage />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('estado de error muestra el mensaje', () => {
    mockUseRoles.mockReturnValue(baseHook({ error: 'No se pudo cargar', roles: [], systemRoles: [], customRoles: [] }));
    render(<RolesPage />);

    expect(screen.getByText('No se pudo cargar')).toBeInTheDocument();
  });

  it('estado vacío cuando no hay roles personalizados', () => {
    mockUseRoles.mockReturnValue(baseHook({ customRoles: [] }));
    render(<RolesPage />);

    expect(screen.getByText(/No hay roles personalizados/i)).toBeInTheDocument();
  });

  it('seleccionar un rol personalizado abre su editor', async () => {
    const hook = baseHook();
    mockUseRoles.mockReturnValue(hook);
    render(<RolesPage />);

    fireEvent.click(screen.getByText('Inspector'));

    await waitFor(() => expect(hook.getRole).toHaveBeenCalledWith('c_inspector'));
  });

  it('botón Nuevo rol abre el diálogo de creación', () => {
    mockUseRoles.mockReturnValue(baseHook());
    render(<RolesPage />);

    fireEvent.click(screen.getByRole('button', { name: /Nuevo rol/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- pages/roles/index.test` (los módulos no existen)
- [ ] Implementación mínima:

```tsx
// nodes/web/src/pages/roles/new-role-dialog.tsx
import { useState, type ReactNode } from 'react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';

/** Diálogo mínimo para nombrar un rol personalizado nuevo (sin permisos: se editan después en el editor). */
export function NewRoleDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (label: string) => Promise<void>;
}): ReactNode {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    if (label.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(label.trim());
      setLabel('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el rol.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="sm:max-w-sm">
        <ModalHeader>
          <ModalTitle>Nuevo rol</ModalTitle>
          <ModalDescription>Elige un nombre; los permisos se configuran después.</ModalDescription>
        </ModalHeader>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium leading-none">Nombre</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            disabled={busy}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
          />
        </label>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <ModalFooter>
          <Button type="button" onClick={() => void handleCreate()} disabled={busy || label.trim().length === 0}>
            Crear
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
```

```tsx
// nodes/web/src/pages/roles/index.tsx
import { useState, type ReactNode } from 'react';
import { Plus, Lock } from 'lucide-react';
import type { RoleDetail } from '@gmt-platform/contracts';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRoles } from '@/hooks/use-roles';
import { RoleEditor } from './role-editor';
import { NewRoleDialog } from './new-role-dialog';

function RoleRow({
  role,
  active,
  onSelect,
}: {
  role: RoleDetail;
  active: boolean;
  onSelect: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ' +
        (active ? 'bg-primary/10 text-primary' : 'hover:bg-accent')
      }
    >
      <span className="truncate">{role.label}</span>
      {role.isSystem && <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
}

/**
 * Página de administración de Roles (§Fase 5 — matriz RBAC). Ensambla
 * `useRoles` + `RoleEditor`: a la izquierda la lista separada en "Del
 * sistema" (candado, solo lectura + clonar) y "Personalizados" (CRUD); a la
 * derecha el editor del rol seleccionado. Gateada en el nav por
 * `canManageRoles`.
 */
export default function RolesPage(): ReactNode {
  const { catalog, systemRoles, customRoles, loading, error, refetch, getRole, createRole, updateRole, deleteRole, cloneRole } =
    useRoles();
  const [selected, setSelected] = useState<RoleDetail | null>(null);
  const [newRoleOpen, setNewRoleOpen] = useState(false);

  async function selectRole(key: string): Promise<void> {
    try {
      const detail = await getRole(key);
      setSelected(detail);
    } catch {
      toast.error('No se pudo cargar el rol.');
    }
  }

  async function handleSave(key: string, input: Parameters<typeof updateRole>[1]): Promise<void> {
    const updated = await updateRole(key, input);
    setSelected(updated);
    toast.success('Rol actualizado.');
  }

  async function handleClone(key: string): Promise<void> {
    const source = [...systemRoles, ...customRoles].find((r) => r.key === key);
    const label = source ? `${source.label} (copia)` : 'Copia de rol';
    try {
      const cloned = await cloneRole(key, label);
      setSelected(cloned);
      toast.success('Rol clonado. Ya puedes editarlo.');
    } catch {
      toast.error('No se pudo clonar el rol.');
    }
  }

  async function handleCreate(label: string): Promise<void> {
    const created = await createRole({ label, grants: [] });
    setSelected(created);
  }

  async function handleDelete(key: string): Promise<void> {
    try {
      await deleteRole(key);
      if (selected?.key === key) setSelected(null);
      toast.success('Rol eliminado.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo eliminar el rol.');
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6" role="status" aria-label="Cargando roles">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => void refetch()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 sm:p-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground">
            Crea roles personalizados componiendo permisos del catálogo por módulo.
          </p>
        </div>
        <Button onClick={() => setNewRoleOpen(true)}>
          <Plus aria-hidden />
          Nuevo rol
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-4">
          <div>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Del sistema
            </p>
            <div className="flex flex-col gap-0.5">
              {systemRoles.map((r) => (
                <RoleRow key={r.key} role={r} active={selected?.key === r.key} onSelect={() => void selectRole(r.key)} />
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Personalizados
            </p>
            {customRoles.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">
                No hay roles personalizados todavía. Crea el primero.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {customRoles.map((r) => (
                  <div key={r.key} className="flex items-center gap-1">
                    <div className="flex-1">
                      <RoleRow role={r} active={selected?.key === r.key} onSelect={() => void selectRole(r.key)} />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Eliminar rol ${r.label}`}
                      onClick={() => void handleDelete(r.key)}
                    >
                      Eliminar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section>
          {selected ? (
            <RoleEditor role={selected} catalog={catalog} onSave={handleSave} onClone={handleClone} />
          ) : (
            <p className="text-sm text-muted-foreground">Selecciona un rol para ver o editar sus permisos.</p>
          )}
        </section>
      </div>

      <NewRoleDialog open={newRoleOpen} onOpenChange={setNewRoleOpen} onCreate={handleCreate} />
    </div>
  );
}
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- pages/roles/index.test`
- [ ] Commit:
```bash
git add nodes/web/src/pages/roles/index.tsx nodes/web/src/pages/roles/new-role-dialog.tsx nodes/web/src/pages/roles/index.test.tsx && git commit -m "feat(web/roles): página /roles con lista sistema/personalizados y editor"
```

---

### Task 5.8: `roles-dialog.tsx` — selector de alcance limitado a `allowedScopeTypes` + selector de proyecto

Este task actualiza el diálogo de asignación de roles en `/usuarios` para usar la firma nueva de `assignUserRole`/`removeUserRole` (Task 5.4) y el catálogo de roles dinámicos (en vez de `ROLE_KEYS` fijo).

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/pages/usuarios/roles-dialog.tsx`
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/hooks/use-users.ts` (actualizar `assignRole`/`removeRole` a la firma nueva)
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/pages/usuarios/index.tsx` (actualizar las llamadas a `assignRole`/`removeRole`)
- Test: `C:/Users/juana/GMT Link/nodes/web/src/pages/usuarios/roles-dialog.test.tsx`

- [ ] Escribir el test que falla:

```tsx
// nodes/web/src/pages/usuarios/roles-dialog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RoleDetail } from '@gmt-platform/contracts';

const { mockListRoles, mockListProjects } = vi.hoisted(() => ({
  mockListRoles: vi.fn(),
  mockListProjects: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ listRoles: mockListRoles, listProjects: mockListProjects }));

import { RolesDialog } from '@/pages/usuarios/roles-dialog';
import type { UserListItem } from '@/lib/api';

const orgRole: RoleDetail = {
  key: 'org_admin',
  label: 'Administrador de organización',
  description: null,
  isSystem: true,
  allowedScopeTypes: ['ORGANIZATION'],
  grants: [],
};

const projectRole: RoleDetail = {
  key: 'c_inspector',
  label: 'Inspector',
  description: null,
  isSystem: false,
  allowedScopeTypes: ['PROJECT'],
  grants: [{ permissionKey: 'project:read', scope: 'GLOBAL' }],
};

const user: UserListItem = {
  id: 'u1',
  firstName: 'Ada',
  secondName: null,
  lastName: 'Lovelace',
  secondLastName: null,
  email: 'ada@gmt.cl',
  status: 'ACTIVE',
  isClientUser: false,
  roleKeys: [],
  createdAt: new Date().toISOString(),
};

describe('RolesDialog — asignación con alcance', () => {
  beforeEach(() => {
    mockListRoles.mockReset().mockResolvedValue([orgRole, projectRole]);
    mockListProjects.mockReset().mockResolvedValue([{ id: 'p1', code: 'P-001', name: 'Proyecto Uno' }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('al elegir un rol PROJECT-only, exige seleccionar proyecto antes de habilitar Agregar', async () => {
    const onAssign = vi.fn().mockResolvedValue({ id: 'u1', roleKeys: ['c_inspector'] });
    render(
      <RolesDialog
        user={user}
        onOpenChange={vi.fn()}
        onAssign={onAssign}
        onRemove={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /Agregar rol/i })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /Agregar rol/i }), { target: { value: 'c_inspector' } });

    // El selector de alcance queda limitado a PROJECT (único allowedScopeTypes del rol).
    expect(screen.getByRole('combobox', { name: /Alcance/i })).toHaveValue('PROJECT');
    // Y aparece el selector de proyecto.
    expect(await screen.findByRole('combobox', { name: /Proyecto/i })).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /Agregar/i })).toBeDisabled();

    fireEvent.change(screen.getByRole('combobox', { name: /Proyecto/i }), { target: { value: 'p1' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar/i }));

    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledWith('u1', { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' }),
    );
  });

  it('rol ORGANIZATION-only no muestra selector de proyecto y asigna directo', async () => {
    const onAssign = vi.fn().mockResolvedValue({ id: 'u1', roleKeys: ['org_admin'] });
    render(
      <RolesDialog
        user={user}
        onOpenChange={vi.fn()}
        onAssign={onAssign}
        onRemove={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByRole('combobox', { name: /Agregar rol/i })).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox', { name: /Agregar rol/i }), { target: { value: 'org_admin' } });

    expect(screen.queryByRole('combobox', { name: /Proyecto/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Agregar/i }));

    await waitFor(() =>
      expect(onAssign).toHaveBeenCalledWith('u1', { roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
    );
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- roles-dialog.test` (el componente todavía usa `ROLE_KEYS`/firma vieja)
- [ ] Implementación mínima — reescribir `roles-dialog.tsx`:

```tsx
// nodes/web/src/pages/usuarios/roles-dialog.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { AssignRoleInput, RoleDetail, ScopeType } from '@gmt-platform/contracts';
import { Modal, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { listProjects, listRoles, type UserListItem, type UserRolesResponse } from '@/lib/api';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';

const ORG_SCOPE_ID = 'gmt';

interface RoleRemoval {
  roleKey: string;
  scopeType: ScopeType;
  scopeId: string;
  label: string;
}

/**
 * Diálogo de asignación de roles por alcance de un usuario (§Fase 5). El
 * selector de alcance queda limitado a `role.allowedScopeTypes` del rol
 * elegido; si incluye `PROJECT`, se exige elegir un proyecto concreto antes
 * de habilitar "Agregar". Cada acción llama al backend con
 * `AssignRoleInput`/`{roleKey,scopeType,scopeId}` y notifica al padre.
 */
export function RolesDialog({
  user,
  onOpenChange,
  onAssign,
  onRemove,
  onChanged,
}: {
  user: UserListItem | null;
  onOpenChange: (open: boolean) => void;
  onAssign: (id: string, input: AssignRoleInput) => Promise<UserRolesResponse>;
  onRemove: (id: string, params: { roleKey: string; scopeType: ScopeType; scopeId: string }) => Promise<UserRolesResponse>;
  onChanged: () => void;
}): ReactNode {
  const [roles, setRoles] = useState<RoleDetail[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [toAdd, setToAdd] = useState<string>('');
  const [scopeType, setScopeType] = useState<ScopeType | ''>('');
  const [scopeId, setScopeId] = useState<string>('');
  const [current, setCurrent] = useState<string[]>([]);
  const [toRemove, setToRemove] = useState<RoleRemoval | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!user) return;
    void listRoles().then(setRoles);
    void listProjects().then((ps) => setProjects(ps.map((p) => ({ id: p.id, name: p.name, code: p.code }))));
  }, [user]);

  useEffect(() => {
    setCurrent(user ? [...user.roleKeys] : []);
    setToAdd('');
    setScopeType('');
    setScopeId('');
    setToRemove(null);
    setError(null);
    setDirty(false);
  }, [user]);

  const selectedRole = roles.find((r) => r.key === toAdd) ?? null;

  function handleSelectRole(key: string): void {
    setToAdd(key);
    const role = roles.find((r) => r.key === key);
    if (!role) {
      setScopeType('');
      setScopeId('');
      return;
    }
    const defaultScope = role.allowedScopeTypes[0];
    setScopeType(defaultScope);
    setScopeId(defaultScope === 'ORGANIZATION' ? ORG_SCOPE_ID : '');
  }

  const needsProject = scopeType === 'PROJECT';
  const canAdd = toAdd !== '' && scopeType !== '' && (!needsProject || scopeId !== '');

  async function add(): Promise<void> {
    if (!user || !canAdd || scopeType === '') return;
    setBusy(true);
    setError(null);
    try {
      const input: AssignRoleInput = { roleKey: toAdd, scopeType, scopeId: scopeId || ORG_SCOPE_ID };
      const res = await onAssign(user.id, input);
      setCurrent(res.roleKeys);
      setToAdd('');
      setScopeType('');
      setScopeId('');
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo asignar el rol.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(removal: RoleRemoval): Promise<void> {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await onRemove(user.id, removal);
      setCurrent(res.roleKeys);
      setDirty(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo quitar el rol.');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  function close(): void {
    if (dirty) onChanged();
    onOpenChange(false);
  }

  function roleLabelFor(key: string): string {
    return roles.find((r) => r.key === key)?.label ?? key;
  }

  return (
    <>
      <Modal open={user !== null} onOpenChange={(next) => (next ? undefined : close())}>
        <ModalContent className="sm:max-w-md">
          <ModalHeader>
            <ModalTitle>Roles de {user ? `${user.firstName} ${user.lastName}` : ''}</ModalTitle>
            <ModalDescription>Roles asignados y su alcance (organización o proyecto).</ModalDescription>
          </ModalHeader>

          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {current.length === 0 && (
                <span className="text-sm text-muted-foreground">Sin roles asignados.</span>
              )}
              {current.map((role) => (
                <span
                  key={role}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs font-medium text-secondary-foreground"
                >
                  {roleLabelFor(role)}
                  <button
                    type="button"
                    onClick={() =>
                      setToRemove({ roleKey: role, scopeType: 'ORGANIZATION', scopeId: ORG_SCOPE_ID, label: roleLabelFor(role) })
                    }
                    disabled={busy}
                    aria-label={`Quitar rol ${roleLabelFor(role)}`}
                    className="rounded-full p-0.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium leading-none">Agregar rol</span>
                <select
                  aria-label="Agregar rol"
                  value={toAdd}
                  onChange={(e) => handleSelectRole(e.target.value)}
                  disabled={busy}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                >
                  <option value="">Selecciona un rol…</option>
                  {roles.map((role) => (
                    <option key={role.key} value={role.key}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedRole && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">Alcance</span>
                  <select
                    aria-label="Alcance"
                    value={scopeType}
                    onChange={(e) => {
                      const next = e.target.value as ScopeType;
                      setScopeType(next);
                      setScopeId(next === 'ORGANIZATION' ? ORG_SCOPE_ID : '');
                    }}
                    disabled={busy || selectedRole.allowedScopeTypes.length <= 1}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                  >
                    {selectedRole.allowedScopeTypes.map((st) => (
                      <option key={st} value={st}>
                        {st === 'ORGANIZATION' ? 'Organización' : 'Proyecto'}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {needsProject && (
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium leading-none">Proyecto</span>
                  <select
                    aria-label="Proyecto"
                    value={scopeId}
                    onChange={(e) => setScopeId(e.target.value)}
                    disabled={busy}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                  >
                    <option value="">Selecciona un proyecto…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="flex justify-end">
                <Button type="button" onClick={() => void add()} disabled={busy || !canAdd}>
                  <Plus aria-hidden />
                  Agregar
                </Button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <ModalFooter>
            <Button type="button" onClick={close} disabled={busy}>
              Listo
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(open) => !open && setToRemove(null)}
        title="¿Quitar rol?"
        description={
          toRemove ? (
            <>
              ¿Seguro que deseas quitar el rol <strong>{toRemove.label}</strong> a{' '}
              <strong>{user ? `${user.firstName} ${user.lastName}` : ''}</strong>?
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Quitar rol"
        onConfirm={async () => {
          if (toRemove) {
            await remove(toRemove);
          }
        }}
      />
    </>
  );
}
```

Actualizar `use-users.ts` (firma nueva de `assignRole`/`removeRole`):

```ts
// nodes/web/src/hooks/use-users.ts — reemplazar imports y las funciones assignRole/removeRole
import type { AssignRoleInput, ScopeType } from '@gmt-platform/contracts';
import {
  ApiError,
  assignUserRole,
  createUser,
  importUsers,
  listUsers,
  removeUserRole,
  type CreateUserDto,
  type CreateUserResponse,
  type ImportUsersResponse,
  type UserListItem,
  type UserRolesResponse,
} from '@/lib/api';
```

```ts
  /** Asigna un rol a un usuario en un alcance concreto. */
  assignRole: (id: string, input: AssignRoleInput) => Promise<UserRolesResponse>;
  /** Quita un rol de un usuario en un alcance concreto. */
  removeRole: (id: string, params: { roleKey: string; scopeType: ScopeType; scopeId: string }) => Promise<UserRolesResponse>;
```

```ts
  const assignRole = useCallback(
    (id: string, input: AssignRoleInput): Promise<UserRolesResponse> => assignUserRole(id, input),
    [],
  );

  const removeRole = useCallback(
    (id: string, params: { roleKey: string; scopeType: ScopeType; scopeId: string }): Promise<UserRolesResponse> =>
      removeUserRole(id, params),
    [],
  );
```

Actualizar `pages/usuarios/index.tsx` (las llamadas ya delegan tal cual al hook; solo cambia el tipo del callback pasado a `RolesDialog`):

```tsx
// nodes/web/src/pages/usuarios/index.tsx — reemplazar el bloque <RolesDialog .../>
      <RolesDialog
        user={rolesUser}
        onOpenChange={(open) => (open ? undefined : setRolesUser(null))}
        onAssign={(id, input) => assignRole(id, input)}
        onRemove={(id, params) => removeRole(id, params)}
        onChanged={() => void refetch()}
      />
```

(Quitar el import `RoleKey` de `pages/usuarios/index.tsx` si queda sin uso.)

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- roles-dialog.test use-users.test index.test` y `pnpm --filter "@gmt-platform/web" exec tsc --noEmit`
- [ ] Commit:
```bash
git add nodes/web/src/pages/usuarios/roles-dialog.tsx nodes/web/src/hooks/use-users.ts nodes/web/src/pages/usuarios/index.tsx nodes/web/src/pages/usuarios/roles-dialog.test.tsx && git commit -m "feat(web/usuarios): asignación de roles con alcance limitado a allowedScopeTypes"
```

---

### Task 5.9: Nav gating por `canManageRoles` + ruta `/roles`

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/components/layout/nav-items.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/components/layout/sidebar.tsx`
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/App.tsx`
- Test: `C:/Users/juana/GMT Link/nodes/web/src/components/layout/sidebar.test.tsx` (crear si no existe)

- [ ] Escribir el test que falla:

```tsx
// nodes/web/src/components/layout/sidebar.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SidebarContent } from '@/components/layout/sidebar';

const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));
vi.mock('@/context/auth-context', () => ({ useAuth: mockUseAuth }));
vi.mock('@/components/layout/use-sidebar', () => ({
  useSidebar: () => ({ collapsed: false, toggleCollapsed: vi.fn() }),
}));
vi.mock('@/components/notifications/notification-bell', () => ({
  NotificationBell: () => null,
}));

function baseUser(overrides: Partial<{ modules: string[]; canManageRoles: boolean }> = {}) {
  return {
    id: 'u1',
    email: 'a@b.cl',
    firstName: 'Ada',
    lastName: 'Lovelace',
    status: 'ACTIVE' as const,
    modules: ['dashboard', 'usuarios'],
    canManageRoles: false,
    ...overrides,
  };
}

describe('SidebarContent — gating de "Roles" por canManageRoles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('no muestra "Roles" si canManageRoles=false', () => {
    mockUseAuth.mockReturnValue({ user: baseUser({ canManageRoles: false }), logout: vi.fn() });
    render(<MemoryRouter><SidebarContent /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: /Roles/i })).not.toBeInTheDocument();
  });

  it('muestra "Roles" si canManageRoles=true', () => {
    mockUseAuth.mockReturnValue({ user: baseUser({ canManageRoles: true }), logout: vi.fn() });
    render(<MemoryRouter><SidebarContent /></MemoryRouter>);

    expect(screen.getByRole('link', { name: /Roles/i })).toBeInTheDocument();
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- sidebar.test` (no hay entrada "Roles" ni gating por `canManageRoles`)
- [ ] Implementación mínima:

```ts
// nodes/web/src/components/layout/nav-items.ts — agregar import ShieldCheck y la entrada
import {
  LayoutDashboard,
  Users,
  Contact,
  Wallet,
  Boxes,
  Package,
  Wrench,
  Gauge,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
```

```ts
/** Ítem de navegación del sidebar. */
export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Clave de módulo para filtrar la visibilidad por cliente (ver GET /auth/me). */
  module: string;
  /** Marca placeholders aún no implementados (etapas posteriores). */
  placeholder?: boolean;
  /** Si es `true`, solo se muestra cuando `user.canManageRoles` es `true` (además del filtro de módulo). */
  requiresManageRoles?: boolean;
}
```

```ts
export const PRIMARY_NAV: ReadonlyArray<NavItem> = [
  { label: 'Inicio', to: '/', icon: LayoutDashboard, module: 'dashboard' },
  { label: 'Usuarios', to: '/usuarios', icon: Users, module: 'usuarios' },
  { label: 'Roles', to: '/roles', icon: ShieldCheck, module: 'usuarios', requiresManageRoles: true },
  { label: 'Directorio', to: '/directorio', icon: Contact, module: 'directorio' },
  { label: 'Finanzas', to: '/finanzas', icon: Wallet, module: 'finanzas' },
  { label: 'Operaciones', to: '/operaciones', icon: Boxes, module: 'operaciones' },
  { label: 'Recursos', to: '/recursos', icon: Package, module: 'recursos' },
];
```

```tsx
// nodes/web/src/components/layout/sidebar.tsx — extender el filtro existente
  // Visibilidad de módulos por cliente (Módulo 5) + gating de "Roles" por canManageRoles (§Fase 5).
  const allowedModules = user?.modules;
  const canSeeModule = (item: NavItem): boolean => {
    if (!allowedModules || !allowedModules.includes(item.module)) {
      if (allowedModules) return false;
    }
    if (item.requiresManageRoles && !user?.canManageRoles) return false;
    return true;
  };
```

(Reemplaza la línea `const canSeeModule = (item: NavItem): boolean => !allowedModules || allowedModules.includes(item.module);` existente por el bloque de arriba.)

```tsx
// nodes/web/src/App.tsx — agregar lazy import y ruta
const RolesPage = lazy(() => import('@/pages/roles'));
```

```tsx
          { path: '/usuarios', element: lazyRoute(<UsuariosPage />) },
          { path: '/roles', element: lazyRoute(<RolesPage />) },
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- sidebar.test`
- [ ] Commit:
```bash
git add nodes/web/src/components/layout/nav-items.ts nodes/web/src/components/layout/sidebar.tsx nodes/web/src/App.tsx nodes/web/src/components/layout/sidebar.test.tsx && git commit -m "feat(web/nav): entrada Roles gateada por canManageRoles + ruta /roles"
```

---

### Task 5.10: Verificación integral de la fase

**Files:** ninguno (solo comandos de verificación)

- [ ] Correr suite completa del frontend: `pnpm --filter "@gmt-platform/web" test`
- [ ] Correr suite de contracts: `pnpm --filter "@gmt-platform/contracts" exec vitest run`
- [ ] Chequeo de tipos estricto: `pnpm --filter "@gmt-platform/web" exec tsc --noEmit` y `pnpm --filter "@gmt-platform/contracts" exec tsc --noEmit`
- [ ] Lint: `pnpm lint`
- [ ] Si algo falla, arreglar con un fix mínimo y commitear aparte (no mezclar con tasks anteriores ya commiteadas)
- [ ] Commit final solo si hubo fixes:
```bash
git add -A && git commit -m "fix(web/roles): ajustes de verificación integral Fase 5"
```
