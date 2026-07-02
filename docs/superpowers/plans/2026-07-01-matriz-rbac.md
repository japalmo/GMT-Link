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

Contexto: hoy `RoleKey` es `(typeof ROLE_KEYS)[number]` (unión cerrada). El spec (§7) exige `RoleKey = string` para que roles personalizados (`c_xxx`) tipen sin fricción; `ROLE_KEYS` se conserva solo como lista de labels/orden de los roles del sistema. Además de los tipos del SPINE, contracts gana `UserMembership` (A4) y `CloneRoleResponse` (A7).

> **Nota (A4):** `UserRolesResponse` y `UserListItem` NO viven en contracts — viven en `nodes/backend-central/src/modules/users/users.types.ts` (con espejo en `nodes/web/src/lib/api.ts`). Su extensión con `memberships: UserMembership[]` se hace en la **Fase 3** (backend) y **Fase 5** (web), importando `UserMembership` desde `@gmt-platform/contracts`. Este task solo aporta el tipo `UserMembership` compartido.
>
> **Nota (A8):** este task es la ÚNICA fuente de tests de contracts (`test/index.spec.ts` + `vitest.config.ts` con `include: ['test/**/*.spec.ts']`). Las Tasks 2.1 y 5.1 son SOLO verificación (tsc + confirmar exports); no crean archivos de test ni re-implementan nada.

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
    CloneRoleResponse,
    CreateRoleInput,
    FgaObjectType,
    PermissionCatalogGroup,
    PermissionCatalogItem,
    PermissionKind,
    RoleDetail,
    RoleGrant,
    RoleKey,
    UpdateRoleInput,
    UserMembership,
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

    it('UserMembership/CloneRoleResponse componen (A4/A7)', () => {
      const membership: UserMembership = {
        roleKey: 'c_inspector',
        scopeType: 'PROJECT',
        scopeId: 'p1',
      };
      const clone: CloneRoleResponse = {
        role: {
          key: 'c_qa_copia',
          label: 'QA (copia)',
          description: null,
          isSystem: false,
          allowedScopeTypes: ['PROJECT'],
          grants: [],
        },
        omittedPermissionKeys: ['document:sign:qa'],
      };
      expect(membership.scopeType).toBe('PROJECT');
      expect(clone.omittedPermissionKeys).toHaveLength(1);
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

  /**
   * Membership de un usuario (rol + scope), A4. Lo consumen las respuestas de
   * asignación (`UserRolesResponse` extendida) y `UserListItem` — esos dos tipos
   * viven en el backend (`users.types.ts`) y en `nodes/web/src/lib/api.ts`; se
   * extienden con `memberships: UserMembership[]` en Fase 3 (backend) y Fase 5 (web).
   */
  export interface UserMembership {
    roleKey: string;
    scopeType: ScopeType;
    scopeId: string;
  }

  /**
   * Respuesta de `POST /roles/:key/clone` (A7): el rol clonado + las claves de
   * permisos omitidos por NO ser componibles (así clonar roles del sistema
   * funciona y la UI puede avisar qué quedó afuera, spec §6.2/§13.4).
   */
  export interface CloneRoleResponse {
    role: RoleDetail;
    omittedPermissionKeys: string[];
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
  git commit -m "feat(contracts): RoleKey abierto (string) + tipos SPINE + UserMembership + CloneRoleResponse"
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

### Task 1.3: `UsersService` deja de filtrar por forma (`isRoleKey`): acepta roles `c_xxx` que existan en la tabla `Role`

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.service.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/users.service.spec.ts` (**YA EXISTE** — A9: NO crear `test/modules/users/users.service.spec.ts`; los tests nuevos se agregan a este archivo)

Contexto (verificado contra el repo): `validateRoleKeys` **ya valida contra la BD** — tiene un `prisma.role.findMany({ where: { key: { in: unique } } })` que rechaza con 400 las claves que no existen en la tabla `Role` (y el spec existente ya lo cubre: "rechaza (400) roleKeys que no existen en el catálogo de la BD"). El problema es que ANTES de esa consulta hay un gate de forma `if (!isRoleKey(raw)) throw BadRequest` que corta cualquier rol personalizado (`c_xxx`) aunque exista en la BD. Además, `collectRoleKeys` (usado por `toListItem` y `currentRoles`) filtra con `isRoleKey`, así que un rol `c_xxx` asignado quedaría **oculto** en las respuestas (`UserListItem.roleKeys` / `UserRolesResponse.roleKeys`). El fix es doble: quitar el gate de forma de `validateRoleKeys` (la consulta a BD que ya existe pasa a ser la única validación) y quitar el filtro de `collectRoleKeys` (queda solo el dedupe). `assignRole`/`removeRole` no cambian de firma. (A9: la Task 3.6 actualizará ESTE MISMO spec cuando `UsersService` gane `RolesService` en el constructor.)

- [ ] 1. Escribir los tests que fallan. `test/modules/users.service.spec.ts` ya trae `buildPrismaMock` (con `role.findMany` respaldado por `state.rolesInCatalog`), `buildFgaMock`, `buildStorageMock`, `validDto` y `ALL_ROLES` — se reusan. Tres ediciones en ese archivo:

  (a) En `buildPrismaMock`, agregar estado de memberships org (para `assignRole`/`currentRoles`). Justo después de `let created: FakeUserRow | null = null;`:

  ```ts
  // Memberships ORGANIZATION creadas vía assignRole (respaldan membership.findMany).
  const orgMemberships: Array<{ roleKey: string }> = [];
  ```

  (b) En el mismo `buildPrismaMock`, `user.findUnique` hoy solo modela `assertEmailFree` (busca por email); `assignRole` también lo llama vía `assertUserExists` (busca por id). Distinguir por la forma del `where`. Reemplazar:

  ```ts
      findUnique: vi.fn(
        (): Promise<{ id: string } | null> =>
          Promise.resolve(state.emailExists ? { id: 'existing' } : null),
      ),
  ```
  por:
  ```ts
      findUnique: vi.fn(
        (args: { where: { id?: string; email?: string } }): Promise<{ id: string } | null> => {
          if (args.where.id !== undefined) {
            // assertUserExists (assignRole/removeRole): el usuario del test existe.
            return Promise.resolve({ id: args.where.id });
          }
          // assertEmailFree (create): controlado por el estado del test.
          return Promise.resolve(state.emailExists ? { id: 'existing' } : null);
        },
      ),
  ```

  y ampliar el objeto `membership` (hoy solo tiene `deleteMany`):

  ```ts
    membership: {
      deleteMany: membershipDeleteMany,
      findUnique: vi.fn((): Promise<unknown> => Promise.resolve(null)),
      create: vi.fn(
        (args: {
          data: { userId: string; roleKey: string; scopeType: string; scopeId: string };
        }): Promise<unknown> => {
          orgMemberships.push({ roleKey: args.data.roleKey });
          return Promise.resolve(args.data);
        },
      ),
      findMany: vi.fn(
        (): Promise<Array<{ roleKey: string }>> => Promise.resolve([...orgMemberships]),
      ),
    },
  ```

  (c) Agregar al final del archivo el describe nuevo:

  ```ts
  describe('UsersService — roles dinámicos (§7, matriz RBAC): valida contra Role, no por forma', () => {
    let state: PrismaState;

    beforeEach(() => {
      state = {
        // El catálogo de la BD incluye un rol personalizado NO sembrado en ROLE_KEYS.
        rolesInCatalog: new Set([...ALL_ROLES, 'c_inspector_de_campo']),
        emailExists: false,
        failPersist: false,
      };
    });

    it('create acepta un rol personalizado (c_xxx) que SÍ existe en la tabla Role', async () => {
      const { prisma } = buildPrismaMock(state);
      const fga = buildFgaMock();
      const service = new UsersService(prisma, fga.fga, buildStorageMock());

      const result = await service.create(validDto({ roleKeys: ['c_inspector_de_campo'] }));

      // El rol c_xxx aparece en la respuesta (nada lo filtra por forma).
      expect(result.user.roleKeys).toEqual(['c_inspector_de_campo']);
    });

    it('create rechaza (400) un roleKey de forma libre que NO existe en la tabla Role', async () => {
      const { prisma } = buildPrismaMock(state);
      const fga = buildFgaMock();
      const service = new UsersService(prisma, fga.fga, buildStorageMock());

      await expect(
        service.create(validDto({ roleKeys: ['c_no_existe'] })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('assignRole acepta un rol personalizado y lo refleja en roleKeys (collectRoleKeys ya no filtra)', async () => {
      const { prisma } = buildPrismaMock(state);
      const fga = buildFgaMock();
      const service = new UsersService(prisma, fga.fga, buildStorageMock());

      const result = await service.assignRole('u1', 'c_inspector_de_campo');

      expect(result.id).toBe('u1');
      expect(result.roleKeys).toContain('c_inspector_de_campo');
      // Un rol funcional (no org_admin) no toca FGA en la asignación org (decisión §9).
      expect(fga.writeTuples).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] 2. Correr y ver que falla. Deben fallar los tests 1 y 3 (hoy el gate `isRoleKey` rechaza `c_inspector_de_campo` antes de consultar la BD, y `collectRoleKeys` lo filtraría de la respuesta); el test 2 pasa ya (la validación contra BD existe) y queda como guardia. Los tests preexistentes del archivo deben seguir en verde:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.service.spec.ts
  ```

- [ ] 3. Implementación mínima. En `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.service.ts` (tres ediciones; la consulta `role.findMany` que ya existe dentro de `validateRoleKeys` NO se toca):

  Quitar el import de `isRoleKey` (queda solo el import de tipo — tras estas ediciones no queda ningún uso de `isRoleKey` en este archivo):
  ```ts
  import { isRoleKey } from '../../common/role-keys';
  import type { RoleKey } from '../../common/role-keys';
  ```
  →
  ```ts
  import type { RoleKey } from '../../common/role-keys';
  ```

  En `validateRoleKeys`, quitar el gate de forma del loop de dedupe (el resto del método — `findMany` + `missing` + `return unique` — ya validaba contra la BD y no cambia):
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
  ```
  →
  ```ts
  /**
   * Valida `roleKeys` contra la tabla `Role` de Postgres (§4.1, matriz RBAC
   * dinámica §7): acepta cualquier string que exista como `Role.key`, incluidos
   * roles personalizados (`c_xxx`) creados por `RolesService`. El gate de forma
   * (`isRoleKey`) se eliminó — la consulta `role.findMany` de abajo es la única
   * validación. Deduplica preservando orden. 400 si hay claves fuera de la BD.
   */
  private async validateRoleKeys(roleKeys: readonly string[]): Promise<RoleKey[]> {
    const unique: RoleKey[] = [];
    for (const raw of roleKeys) {
      if (!unique.includes(raw)) {
        unique.push(raw);
      }
    }
  ```

  Reemplazar `collectRoleKeys` (dedupe sin filtro de forma):
  ```ts
  /** Filtra a RoleKey conocidas (defensivo: la BD podría tener legacy). */
  private collectRoleKeys(raw: readonly string[]): RoleKey[] {
    const out: RoleKey[] = [];
    for (const key of raw) {
      if (isRoleKey(key) && !out.includes(key)) {
        out.push(key);
      }
    }
    return out;
  }
  ```
  →
  ```ts
  /**
   * Deduplica roleKeys preservando orden. Ya NO filtra por `isRoleKey` (matriz
   * RBAC §7): los roles personalizados (`c_xxx`) son válidos y deben aparecer
   * en las respuestas (`UserListItem`/`UserRolesResponse`); ocultarlos rompería
   * la UI de roles dinámicos.
   */
  private collectRoleKeys(raw: readonly string[]): RoleKey[] {
    const out: RoleKey[] = [];
    for (const key of raw) {
      if (!out.includes(key)) {
        out.push(key);
      }
    }
    return out;
  }
  ```

- [ ] 4. Correr y ver que pasa (el archivo completo, incluidos los tests preexistentes):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.service.spec.ts
  ```

- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/users/users.service.ts nodes/backend-central/test/modules/users.service.spec.ts
  git commit -m "fix(backend/users): quita gate isRoleKey (validacion queda en tabla Role) y deja de ocultar roles c_xxx"
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

### Task 1.5: `model.fga` — `can_manage_roles` + `[user] or` en permisos de proyecto Y en las 3 relaciones org componibles

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/fga/model.fga`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga-model.spec.ts` (modificar — agregar tests al describe existente "Modelo OpenFGA §4.3 — derivaciones")

Contexto: §5 del design doc. `organization` gana `can_manage_roles: [user] or admin` (gate de `RolesController`, sin tupla extra: lo deriva `admin`). Además (A1), las 3 relaciones org **componibles** también reciben asignación directa — `can_view_directory_extended`, `can_review_documents` y `can_manage_finance` pasan de `admin` a `[user] or admin` — para que un grant STRUCTURAL org-scope de un rol personalizado se materialice como tupla directa. Y cada permiso atómico de `project` pasa a admitir tupla directa `[user] or <derivaciones existentes>` — así un grant STRUCTURAL de un rol personalizado se materializa como una tupla directa sobre el usuario y el `check` la satisface sin pasar por los roles bundle. Nota de derivación cruzada (A14a): `service.can_view` es `can_view from project`, así que la tupla directa sobre el proyecto también habilita los checks aguas abajo en servicios de ese proyecto — se testea explícitamente.

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

    it('m) tupla directa [user] en las 3 relaciones org componibles pasa el check (A1)', async () => {
      // 'kevin' no es admin de la org: sin tupla directa, ningún can_* org le da true.
      expect(await allowed('user:kevin', 'can_review_documents', 'organization:gmt')).toBe(false);
      await client.write({
        writes: [
          { user: 'user:kevin', relation: 'can_review_documents', object: 'organization:gmt' },
          { user: 'user:kevin', relation: 'can_view_directory_extended', object: 'organization:gmt' },
          { user: 'user:kevin', relation: 'can_manage_finance', object: 'organization:gmt' },
        ],
      });
      expect(await allowed('user:kevin', 'can_review_documents', 'organization:gmt')).toBe(true);
      expect(await allowed('user:kevin', 'can_view_directory_extended', 'organization:gmt')).toBe(true);
      expect(await allowed('user:kevin', 'can_manage_finance', 'organization:gmt')).toBe(true);
      // can_manage_users NO es componible: sigue siendo solo derivado de admin.
      expect(await allowed('user:kevin', 'can_manage_users', 'organization:gmt')).toBe(false);
    });

    it('n) derivación cruzada §12 (A14a): tupla directa can_view sobre project:P satisface can_view en service con service.project = P', async () => {
      // 'iris' no tiene ningún rol ni tupla: no ve el servicio s1 (que cuelga de p1).
      expect(await allowed('user:iris', 'can_view', 'service:s1')).toBe(false);
      await client.write({
        writes: [{ user: 'user:iris', relation: 'can_view', object: 'project:p1' }],
      });
      // service.can_view = can_view from project → la tupla directa en p1 alcanza a s1.
      expect(await allowed('user:iris', 'can_view', 'service:s1')).toBe(true);
      expect(await allowed('user:iris', 'can_view', 'project:p1')).toBe(true);
    });
  ```

- [ ] 2. Correr y ver que falla. Requiere OpenFGA local corriendo en WSL (`FGA_API_URL` del `.env` raíz); si el puerto no responde, levantar WSL primero (ver CLAUDE.md "Infraestructura local"):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga-model.spec.ts
  ```
  Debe fallar en `j` (`can_manage_roles` no existe en el modelo actual → error de relación desconocida), en `k`/`l`/`n` (`can_view`/`can_create_task` no aceptan `[user]` directo → el `write` de la tupla directa falla o el check da `false`) y en `m` (las relaciones org componibles hoy son solo `admin` → el `write` directo falla).

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
      # Las 3 relaciones org COMPONIBLES (A1) admiten tupla directa "[user] or":
      # un grant STRUCTURAL org-scope de un rol personalizado se materializa como
      # tupla directa (user:U, can_x, organization:gmt). can_manage_users NO es
      # componible: sigue solo derivado de admin.
      # datos extendidos de directorio (§8 directory:view:extended, §6-1.6)
      define can_view_directory_extended: [user] or admin
      # revisión de documentos personales (§8 document:review, §6-1.5)
      define can_review_documents: [user] or admin
      # gestión de finanzas (§8 finance:manage, §6-3.1/3.3)
      define can_manage_finance: [user] or admin
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
  git commit -m "feat(fga): can_manage_roles + [user] or en can_* de proyecto y en las 3 org componibles (§5, A1)"
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

> **Convención de tests (verificada contra el repo):** el `vitest.config.ts` de `nodes/backend-central` incluye SOLO `test/**/*.spec.ts` — los specs NO viven junto al código en `src/`. Los specs de esta fase van en `nodes/backend-central/test/modules/roles/` (imports relativos `../../../src/...`, con `import 'reflect-metadata';` al inicio, igual que `test/modules/users.service.spec.ts`). El spec de FgaService canónico es `test/fga.service.spec.ts` (A10): NO crear un spec paralelo.

### Task 2.1: Contracts — verificación de tipos (creados en Fase 1; A8)

**Files:** ninguno (solo verificación — los tipos y su spec ya existen de la Task 1.1; NO crear archivos nuevos ni re-implementar).

Los tipos `RoleKey = string`, `PermissionKind`, `FgaObjectType`, `PermissionCatalogItem`, `PermissionCatalogGroup`, `RoleGrant`, `RoleDetail`, `CreateRoleInput`, `UpdateRoleInput`, `AssignRoleInput`, `UserMembership` y `CloneRoleResponse` se crearon (con su test en `packages/contracts/test/index.spec.ts`) en la **Fase 1, Task 1.1** (A8). Esta task solo confirma que Fase 2 puede consumirlos.

- [ ] 1. Confirmar que los exports existen en `C:/Users/juana/GMT Link/packages/contracts/src/index.ts` (PowerShell):
  ```powershell
  Select-String -Path "packages/contracts/src/index.ts" -Pattern 'export (type|interface) (RoleKey|PermissionKind|FgaObjectType|PermissionCatalogItem|PermissionCatalogGroup|RoleGrant|RoleDetail|CreateRoleInput|UpdateRoleInput|AssignRoleInput|UserMembership|CloneRoleResponse)\b'
  ```
  Deben aparecer los 12. En particular, Fase 2 consume: `RoleKey`, `PermissionKind`, `FgaObjectType`, `PermissionCatalogItem`, `PermissionCatalogGroup`, `RoleGrant`, `RoleDetail`, `CreateRoleInput`, `UpdateRoleInput` y `CloneRoleResponse` (A7: `{ role: RoleDetail; omittedPermissionKeys: string[] }`).

- [ ] 2. Correr el suite de contracts (el spec de la Task 1.1) y ver que está en verde:
  `pnpm --filter "@gmt-platform/contracts" exec vitest run`

- [ ] 3. Compilar contracts y los consumidores (chequeo de breakage por `RoleKey = string`):
  `pnpm --filter "@gmt-platform/contracts" exec tsc --noEmit`
  `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit`
  `pnpm --filter "@gmt-platform/web" exec tsc --noEmit`

- [ ] 4. Si algo falta o falla, el defecto es de la **Task 1.1 (Fase 1)** — volver allí y corregir. No parchear tipos desde esta fase.

- [ ] 5. Sin commit (task de verificación, sin cambios).

---

### Task 2.2: composable-permissions.ts — mapa SPINE + helpers (A3: se crea UNA sola vez aquí)

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/composable-permissions.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/composable-permissions.spec.ts`

> **A3:** este archivo se crea UNA sola vez, en esta task. La Task 3.2 de la Fase 3 pasa a ser **verificación** (confirmar exports; NO volver a crear).

- [ ] 1. Escribir el test que falla (`test/modules/roles/composable-permissions.spec.ts`):

```ts
import { describe, expect, it } from 'vitest';
import {
  COMPOSABLE_STRUCTURAL,
  composable,
  fgaObjectTypeOf,
} from '../../../src/modules/roles/composable-permissions';
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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/composable-permissions.spec.ts`

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
 * son los dos lados de la misma decisión (A1: las 3 relaciones org componibles
 * también reciben asignación directa `[user]`).
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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/composable-permissions.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/composable-permissions.ts" "nodes/backend-central/test/modules/roles/composable-permissions.spec.ts"
  git commit -m "feat(roles): mapa COMPOSABLE_STRUCTURAL + helpers composable()/fgaObjectTypeOf()"
  ```

---

### Task 2.3: DTOs de creación y actualización de rol (A6: `grants: []` es válido)

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/create-role.dto.ts`
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/update-role.dto.ts`
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/role-grant.dto.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/create-role.dto.spec.ts`

> **A6:** `CreateRoleDto` acepta `grants: []` — `@IsArray` + `@ArrayMaxSize(50)`, **SIN** `@ArrayMinSize`; `ValidateNested` igual. El flujo UI "Nuevo rol" crea con `[]` y edita después. Por consistencia, `UpdateRoleDto` también acepta `grants: []` (dejar un rol sin permisos es una edición válida).

- [ ] 1. Escribir el test que falla (`test/modules/roles/create-role.dto.spec.ts`):

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateRoleDto } from '../../../src/modules/roles/dto/create-role.dto';
import { UpdateRoleDto } from '../../../src/modules/roles/dto/update-role.dto';

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

  it('acepta grants: [] (A6 — el rol se crea vacío y se edita después)', async () => {
    const errors = await validateDto(CreateRoleDto, { label: 'Demo', grants: [] });
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

  it('rechaza grants ausente (el campo es obligatorio, aunque pueda ser [])', async () => {
    const errors = await validateDto(CreateRoleDto, { label: 'Demo' });
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

  it('acepta grants: [] (A6 — dejar el rol sin permisos es una edición válida)', async () => {
    const errors = await validateDto(UpdateRoleDto, { grants: [] });
    expect(errors).toEqual([]);
  });

  it('rechaza label vacío si viene presente', async () => {
    const errors = await validateDto(UpdateRoleDto, { label: '' });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] 2. Correr y ver que falla:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/create-role.dto.spec.ts`

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
 * (RolesService), no viene en el body. `grants: []` es VÁLIDO (A6): el flujo
 * UI "Nuevo rol" crea vacío y edita después.
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
 * opcionales (actualización parcial); si `grants` viene (aunque sea `[]`),
 * REEMPLAZA el set completo de grants del rol (no hace merge). 403 en el
 * service si el rol es `isSystem`.
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
  @ArrayMaxSize(50, { message: 'Un rol admite como máximo 50 permisos.' })
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  grants?: RoleGrantDto[];
}
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/create-role.dto.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/dto/" "nodes/backend-central/test/modules/roles/create-role.dto.spec.ts"
  git commit -m "feat(roles): DTOs create-role/update-role/role-grant (grants:[] valido, A6)"
  ```

---

### Task 2.4: RolesService — listPermissions (orden A14c)

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

> **A14c:** el catálogo se devuelve ordenado: `module` ascendente; dentro de cada módulo, primero los `STRUCTURAL` y después los `FUNCTIONAL`; dentro de cada kind, alfabético por `label`. El orden se garantiza EN CÓDIGO (no depende del `orderBy` de la BD) y el test lo exige con entrada desordenada.

- [ ] 1. Escribir el test que falla. Este primer test fija el patrón de mocks para todo el archivo (fake de `PrismaService` y `FgaService`; el `$transaction` es auto-referencial para que los asserts sobre llamadas dentro de la transacción funcionen en la Task 2.8):

```ts
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../src/prisma/prisma.service';
import type { FgaService } from '../../../src/fga/fga.service';
import { RolesService } from '../../../src/modules/roles/roles.service';

/** Fake mínimo de PrismaService: solo los métodos que RolesService usa. */
function makePrismaMock() {
  const mock = {
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
    $transaction: vi.fn(),
  };
  // El callback de $transaction recibe el MISMO mock (auto-referencial): así
  // los asserts sobre role.update/deleteMany/createMany "dentro" de la
  // transacción (Task 2.8) se observan en este mismo objeto.
  mock.$transaction.mockImplementation(async (fn: (tx: typeof mock) => unknown) => fn(mock));
  return mock;
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

  it('agrupa por módulo y ordena: module asc; STRUCTURAL antes que FUNCTIONAL; alfabético por label (A14c)', async () => {
    // Entrada deliberadamente DESORDENADA: el orden de salida debe salir del código.
    prisma.permission.findMany.mockResolvedValue([
      { key: 'task:update', label: 'Mover / editar tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
      { key: 'user:create', label: 'Crear usuarios', module: 'sistema', kind: 'FUNCTIONAL', scopeable: false },
      { key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { key: 'document:sign:qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', scopeable: true },
      { key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);

    const groups = await service.listPermissions();

    expect(groups).toEqual([
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
          // STRUCTURAL primero, alfabético por label:
          {
            key: 'task:assign',
            label: 'Asignar tareas',
            module: 'tareas',
            kind: 'STRUCTURAL',
            scopeable: true,
            fgaObjectType: 'project',
            composable: true,
          },
          {
            key: 'task:read',
            label: 'Ver tareas / backlog',
            module: 'tareas',
            kind: 'STRUCTURAL',
            scopeable: true,
            fgaObjectType: 'project',
            composable: true,
          },
          // FUNCTIONAL después:
          {
            key: 'task:update',
            label: 'Mover / editar tareas',
            module: 'tareas',
            kind: 'FUNCTIONAL',
            scopeable: true,
            fgaObjectType: null,
            composable: true,
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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

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
 * `FgaService` (stub en Fase 2, implementación real en Fase 3): este service
 * solo la INVOCA tras cambiar grants.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fga: FgaService,
  ) {}

  /**
   * Catálogo de permisos agrupado por módulo, con composable/fgaObjectType
   * resueltos. Orden (A14c, garantizado en código): módulos asc; dentro de
   * cada módulo STRUCTURAL antes que FUNCTIONAL; dentro de cada kind,
   * alfabético por label.
   */
  async listPermissions(): Promise<PermissionCatalogGroup[]> {
    const permissions = await this.prisma.permission.findMany();

    const itemsByModule = new Map<string, PermissionCatalogItem[]>();
    for (const permission of permissions) {
      const item = this.toCatalogItem(permission);
      const bucket = itemsByModule.get(permission.module);
      if (bucket === undefined) {
        itemsByModule.set(permission.module, [item]);
      } else {
        bucket.push(item);
      }
    }

    return [...itemsByModule.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'es'))
      .map(([module, items]) => ({
        module,
        items: [...items].sort((a, b) => {
          if (a.kind !== b.kind) {
            return a.kind === 'STRUCTURAL' ? -1 : 1;
          }
          return a.label.localeCompare(b.label, 'es');
        }),
      }));
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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.listPermissions (catalogo ordenado: modulo asc, STRUCTURAL>FUNCTIONAL, label)"
  ```

---

### Task 2.5: RolesService — slugKey (privado) y colisión

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

`slugKey` es privado; se testea indirectamente a través de `createRole` (que sí lo expone en el `key` del `RoleDetail` devuelto). Esta task adelanta el test de `createRole` centrado en la generación de `key`, y la implementación mínima de `slugKey` + un `createRole` todavía simplificado (sin `validateGrants` real, que llega en la Task 2.6). La firma es `createRole(input, createdById: string | null)` desde el inicio: `Role.createdById` es nullable en el schema (`null` = clonado/semilla sin admin atribuible), y así `cloneRole` (Task 2.11) puede reutilizarla sin cambios de firma posteriores.

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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar a `RolesService`:

```ts
// agregar a los imports existentes:
import type { CreateRoleInput, RoleDetail } from '@gmt-platform/contracts';
```

Agregar los métodos (público `createRole` provisional — se completa con `validateGrants` real en la Task 2.6 — y el privado `slugKey`):

```ts
  /**
   * Crea un rol CUSTOM (`isSystem=false`) a partir de label + grants
   * (`grants: []` es válido, A6). `createdById: null` = sin admin atribuible
   * (p. ej. clonación, Task 2.11).
   */
  async createRole(input: CreateRoleInput, createdById: string | null): Promise<RoleDetail> {
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

Nota: `getRole` todavía no existe (llega en la Task 2.7). Para que este archivo compile en esta task, agregar un `getRole` provisional mínimo (se reemplaza/completa en 2.7):

```ts
  /** Detalle de un rol por key. 404 si no existe (placeholder Task 2.7). */
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

  /** Placeholder: la lógica real (['PROJECT'] si hay STRUCTURAL project-level) llega en la Task 2.9. */
  allowedScopeTypes(_grants: ReadonlyArray<{ permissionKey: string; scope: string }>): ('ORGANIZATION' | 'PROJECT')[] {
    return ['ORGANIZATION'];
  }
```

(Este `allowedScopeTypes` placeholder se reemplaza por la lógica real en la Task 2.9; aquí solo se agrega para que el archivo compile y los tests de esta task pasen. Nótese que con A6 el caso `[]` ya devuelve `['ORGANIZATION']`, coherente con la lógica final.)

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.createRole con slugKey (slug+colision) y getRole base"
  ```

---

### Task 2.6: RolesService — validateGrants (composable, scope, homogeneidad; acepta `[]` por A6)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

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

  it('acepta grants: [] — crea un rol vacío (A6)', async () => {
    prisma.permission.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue({
      id: 'role_1', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([]);

    const detail = await service.createRole({ label: 'Demo', grants: [] }, 'user_1');

    expect(detail.grants).toEqual([]);
    expect(detail.allowedScopeTypes).toEqual(['ORGANIZATION']);
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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar import de excepciones y de `RoleGrant`, y el método privado `validateGrants`; llamarlo desde `createRole` antes de `slugKey`/`prisma.role.create`:

```ts
// agregar a los imports:
import { BadRequestException } from '@nestjs/common';
import type { RoleGrant } from '@gmt-platform/contracts';
```

Modificar `createRole` para validar antes de crear:
```ts
  async createRole(input: CreateRoleInput, createdById: string | null): Promise<RoleDetail> {
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
   * Valida un array de grants antes de persistirlo (`[]` pasa trivialmente, A6):
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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): validateGrants (composable, scopeable, homogeneidad estructural; [] valido)"
  ```

---

### Task 2.7: RolesService — listRoles y getRole (404)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

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

  it('getRole de un rol sin grants devuelve grants: [] y scope ORGANIZATION (A6)', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_3', key: 'c_vacio', label: 'Vacío', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValue([]);

    const detail = await service.getRole('c_vacio');

    expect(detail.grants).toEqual([]);
    expect(detail.allowedScopeTypes).toEqual(['ORGANIZATION']);
  });

  it('getRole lanza 404 si el rol no existe', async () => {
    prisma.role.findUniqueOrThrow.mockRejectedValue(new Error('not found'));

    await expect(service.getRole('c_no_existe')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] 2. Correr y ver que falla (falta `listRoles`; `getRole` no maneja el 404 todavía):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.listRoles + getRole con 404"
  ```

---

### Task 2.8a: FgaService.resyncRole — STUB explícito (A2; prerequisito de la Task 2.8)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga.service.spec.ts` (**Modify** — es el spec canónico existente de FgaService, A10; NO crear un spec paralelo)

> **A2:** para que la Fase 2 compile y `RolesService.updateRole` (Task 2.8) pueda invocar `this.fga.resyncRole(key)`, `FgaService` gana ahora el método `resyncRole(roleKey: string): Promise<void>` como **STUB explícito** (no-op con `Logger.warn`). La **Fase 3 REEMPLAZA el cuerpo del stub** por la implementación real con la semántica de unión multi-rol (A5) — es un **Modify**, no un Create.

- [ ] 1. Escribir el test que falla. Agregar al final del `describe('FgaService', ...)` de `test/fga.service.spec.ts` (el archivo ya existe; su `buildClient()` de la línea ~11 construye `new FgaService(client)` — no cambia en esta task):

```ts
  describe('resyncRole (stub Fase 2 — implementación real en Fase 3)', () => {
    it('resuelve sin tocar el cliente FGA (no escribe ni chequea tuplas)', async () => {
      await expect(service.resyncRole('c_demo')).resolves.toBeUndefined();
      expect(client.write).not.toHaveBeenCalled();
      expect(client.check).not.toHaveBeenCalled();
    });
  });
```

- [ ] 2. Correr y ver que falla (`resyncRole` no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts`

- [ ] 3. Implementación mínima en `src/fga/fga.service.ts`. Ampliar el import de `@nestjs/common` y agregar el logger + el stub:

```ts
// primera línea del archivo, ampliar:
import { Inject, Injectable, Logger } from '@nestjs/common';
```

Dentro de la clase (debajo del constructor):

```ts
  private readonly logger = new Logger(FgaService.name);

  /**
   * Reconcilia las tuplas FGA de TODOS los usuarios que tienen `roleKey`
   * asignado: el set deseado por (usuario, objeto) es la UNIÓN de los grants
   * STRUCTURAL de todos sus roles custom sobre ese objeto (A5).
   *
   * STUB en Fase 2 (A2): no-op para que `RolesService.updateRole` compile y
   * se pueda testear el contrato de invocación/rollback. La Fase 3 REEMPLAZA
   * este cuerpo por la implementación real (Modify, no Create).
   */
  async resyncRole(roleKey: string): Promise<void> {
    this.logger.warn(`resyncRole('${roleKey}'): stub, se implementa en Fase 3`);
  }
```

- [ ] 4. Correr y ver que pasa (todo el spec canónico, no solo el test nuevo):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/fga/fga.service.ts" "nodes/backend-central/test/fga.service.spec.ts"
  git commit -m "feat(fga): stub FgaService.resyncRole (no-op + warn; implementacion real en Fase 3)"
  ```

---

### Task 2.8: RolesService — updateRole CANÓNICO (403 isSystem, $transaction, resyncRole + rollback 502) (A2)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

> **A2 — implementación CANÓNICA y ÚNICA de `updateRole` (la Fase 3 NO la reescribe):**
> 1. 403 si `isSystem`.
> 2. Si `input.grants === undefined` (label/description-only): update simple, **SIN** transacción de grants y **SIN** `resyncRole`.
> 3. Si `input.grants !== undefined` (aunque sea `[]`): valida, y dentro de un `$transaction` reemplaza el set completo (`deleteMany`+`createMany` sobre `tx`); después llama `await this.fga.resyncRole(key)`.
> 4. Si `resyncRole` lanza: restaura los grants viejos en Postgres, reintenta `resyncRole` best-effort con los grants viejos, y responde **502 `{code:'FGA_SYNC_FAILED'}`**.

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

  it('label/description-only: update simple, sin $transaction, sin tocar grants y SIN fga.resyncRole (A2)', async () => {
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
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
    expect(fga.resyncRole).not.toHaveBeenCalled();
  });

  it('al cambiar grants: valida, reemplaza el set dentro de $transaction y llama fga.resyncRole', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([
      { id: 'perm_assign', key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.update.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany
      // 1ª llamada: lectura de los grants PREVIOS (filas crudas, para poder restaurar)
      .mockResolvedValueOnce([{ roleId: 'role_2', permissionId: 'perm_read', scope: 'PROJECT' }])
      // 2ª llamada: getRole final (include permission)
      .mockResolvedValueOnce([{ permission: { key: 'task:assign' }, scope: 'PROJECT' }]);

    const detail = await service.updateRole('c_demo', {
      grants: [{ permissionKey: 'task:assign', scope: 'PROJECT' }],
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'role_2' } });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [{ roleId: 'role_2', permissionId: 'perm_assign', scope: 'PROJECT' }],
    });
    expect(fga.resyncRole).toHaveBeenCalledTimes(1);
    expect(fga.resyncRole).toHaveBeenCalledWith('c_demo');
    expect(detail.grants).toEqual([{ permissionKey: 'task:assign', scope: 'PROJECT' }]);
  });

  it('si resyncRole falla: restaura los grants previos, reintenta resync best-effort y responde 502 FGA_SYNC_FAILED (A2)', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([
      { id: 'perm_assign', key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.update.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.rolePermission.findMany.mockResolvedValueOnce([
      { roleId: 'role_2', permissionId: 'perm_read', scope: 'PROJECT' },
    ]);
    // El primer resync falla; el reintento best-effort (con los grants viejos) resuelve.
    fga.resyncRole.mockRejectedValueOnce(new Error('FGA caído'));

    await expect(
      service.updateRole('c_demo', { grants: [{ permissionKey: 'task:assign', scope: 'PROJECT' }] }),
    ).rejects.toMatchObject({ status: 502, response: { code: 'FGA_SYNC_FAILED' } });

    // Rollback: el ÚLTIMO createMany reescribe exactamente los grants previos.
    expect(prisma.rolePermission.createMany).toHaveBeenLastCalledWith({
      data: [{ roleId: 'role_2', permissionId: 'perm_read', scope: 'PROJECT' }],
    });
    // Dos transacciones: reemplazo + restauración.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    // Best-effort: segundo resyncRole tras restaurar.
    expect(fga.resyncRole).toHaveBeenCalledTimes(2);
  });

  it('rechaza grants inválidos en update con 400 NOT_COMPOSABLE (misma regla que create) sin tocar la BD', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_2', key: 'c_demo', label: 'Demo', description: null, isSystem: false,
    });
    prisma.permission.findMany.mockResolvedValue([]);

    await expect(
      service.updateRole('c_demo', { grants: [{ permissionKey: 'no:existe', scope: 'PROJECT' }] }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'NOT_COMPOSABLE' } });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(fga.resyncRole).not.toHaveBeenCalled();
  });
});
```

- [ ] 2. Correr y ver que falla (`updateRole` no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar imports y los métodos `updateRole` + `grantsToRolePermissionRows`:

```ts
// agregar a los imports:
import { BadGatewayException, ForbiddenException } from '@nestjs/common';
import type { UpdateRoleInput } from '@gmt-platform/contracts';
```

```ts
  /**
   * Implementación CANÓNICA de updateRole (A2 — la Fase 3 no la reescribe).
   * Actualiza label/description/grants de un rol CUSTOM. 403 si `isSystem`.
   * - `input.grants === undefined` → update simple de label/description,
   *   SIN transacción de grants y SIN `fga.resyncRole`.
   * - `input.grants` definido (incluso `[]`) → valida y REEMPLAZA el set
   *   completo (deleteMany+createMany) dentro de `$transaction`, y luego llama
   *   `fga.resyncRole(key)` para que se reconcilien las tuplas FGA de todos
   *   los usuarios con este rol (stub en Fase 2, real en Fase 3).
   * - Si `resyncRole` lanza: restaura los grants previos en Postgres, reintenta
   *   `resyncRole` best-effort con los grants viejos y responde
   *   502 {code:'FGA_SYNC_FAILED'}.
   */
  async updateRole(key: string, input: UpdateRoleInput): Promise<RoleDetail> {
    const role = await this.findRoleOrThrow(key);
    if (role.isSystem) {
      throw new ForbiddenException(`El rol "${key}" es del sistema y no se puede editar.`);
    }

    const labelDescriptionData = {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    };

    const newGrants = input.grants;
    if (newGrants === undefined) {
      // Solo label/description: no cambia el set de grants → no hay nada que
      // sincronizar en FGA (A2).
      await this.prisma.role.update({ where: { id: role.id }, data: labelDescriptionData });
      return this.getRole(key);
    }

    await this.validateGrants(newGrants);

    // Filas crudas previas (roleId/permissionId/scope) para poder restaurar si FGA falla.
    const previousRows = (
      await this.prisma.rolePermission.findMany({ where: { roleId: role.id } })
    ).map((row) => ({ roleId: row.roleId, permissionId: row.permissionId, scope: row.scope }));
    const newRows = await this.grantsToRolePermissionRows(role.id, newGrants);

    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id: role.id }, data: labelDescriptionData });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: newRows });
    });

    try {
      await this.fga.resyncRole(key);
    } catch {
      // Rollback: restaurar los grants previos en Postgres…
      await this.prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({ data: previousRows });
      });
      // …y reintentar la sincronización FGA con los grants viejos (best-effort:
      // si también falla, Postgres ya quedó consistente con el estado previo).
      try {
        await this.fga.resyncRole(key);
      } catch {
        // best-effort intencional
      }
      throw new BadGatewayException({
        code: 'FGA_SYNC_FAILED',
        message: 'No se pudo sincronizar el rol con OpenFGA; se restauraron los permisos previos.',
      });
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

(El stub `FgaService.resyncRole` ya existe desde la Task 2.8a, así que este archivo compila sin tocar `fga.service.ts`.)

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): updateRole canonico (403 isSystem, \$transaction, resyncRole + rollback 502 FGA_SYNC_FAILED)"
  ```

---

### Task 2.9: RolesService — allowedScopeTypes (homogeneidad real)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

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

  it('devuelve ["ORGANIZATION"] para grants vacíos (A6)', () => {
    expect(service.allowedScopeTypes([])).toEqual(['ORGANIZATION']);
  });
});
```

- [ ] 2. Correr y ver que falla (el placeholder actual siempre devuelve `['ORGANIZATION']`, así que el primer test — el caso PROJECT — falla):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Reemplazar el `allowedScopeTypes` placeholder por la lógica real. Como la firma pública opera sobre `RoleGrant[]` (sin `kind`/`fgaObjectType` resueltos), reconstruye el nivel a partir de `COMPOSABLE_STRUCTURAL` usando `permissionKey` directamente (evita otra consulta a Prisma: es un cálculo puro sobre el mapa SPINE):

```ts
  /**
   * ['PROJECT'] si algún grant coincide con un permiso STRUCTURAL project-level
   * del mapa `COMPOSABLE_STRUCTURAL`; si no, ['ORGANIZATION'] (incluye el caso
   * sin grants — `[]` es un rol recién creado por el flujo A6 —, solo
   * FUNCTIONAL, o STRUCTURAL org-level). Los permisos FUNCTIONAL no participan
   * de este cálculo: no acotan el scope asignable del rol.
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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): allowedScopeTypes real via COMPOSABLE_STRUCTURAL"
  ```

---

### Task 2.10: RolesService — deleteRole (403 isSystem, 409 en uso)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): RolesService.deleteRole (403 isSystem, 409 ROLE_IN_USE)"
  ```

---

### Task 2.11: RolesService — cloneRole (A7: filtra no-componibles y devuelve `omittedPermissionKeys`)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.service.spec.ts`

> **A7:** `cloneRole` NO falla cuando el rol origen tiene grants no componibles: los **FILTRA** (omite) y devuelve `CloneRoleResponse = { role: RoleDetail; omittedPermissionKeys: string[] }` para que la UI muestre el aviso. Así clonar los roles del sistema **funciona** (spec §6.2/§13.4). Verificado contra el seed real (`nodes/backend-central/prisma/seed.ts`): el rol `qa` tiene `document:read` + `document:sign:qa` (STRUCTURAL fuera de `COMPOSABLE_STRUCTURAL` → se omiten) y `task:read` + `measurement:read` (componibles → se clonan). Si TODOS los grants se omiten, el clon queda con `grants: []` (válido por A6). Caso borde que SÍ sigue fallando: un origen cuyos grants componibles mezclan STRUCTURAL org y project (p. ej. `org_admin`) → 400 `MIXED_SCOPE_LEVELS` de `validateGrants`, correcto por diseño.

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

  it('clona el rol del sistema "qa" (grants reales del seed) omitiendo los no componibles y reportándolos (A7)', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_qa', key: 'qa', label: 'QA', description: null, isSystem: true, createdById: null,
    });
    prisma.rolePermission.findMany
      // 1ª llamada: grants del ORIGEN (los 4 del seed para 'qa')
      .mockResolvedValueOnce([
        { permission: { key: 'document:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
        { permission: { key: 'document:sign:qa', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
        { permission: { key: 'task:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
        { permission: { key: 'measurement:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' },
      ])
      // 2ª llamada: getRole() del rol recién clonado (solo los componibles)
      .mockResolvedValueOnce([
        { permission: { key: 'task:read' }, scope: 'PROJECT' },
        { permission: { key: 'measurement:read' }, scope: 'PROJECT' },
      ]);
    // Catálogo para validateGrants/grantsToRolePermissionRows del clon (solo los que sobreviven al filtro):
    prisma.permission.findMany.mockResolvedValue([
      { id: 'p_task_read', key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
      { id: 'p_meas_read', key: 'measurement:read', label: 'Ver mediciones', module: 'proyectos', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.findMany.mockResolvedValue([]); // slugKey: sin colisión
    prisma.role.create.mockResolvedValue({
      id: 'role_new', key: 'c_qa_norte', label: 'QA Norte', description: null, isSystem: false,
    });

    const result = await service.cloneRole('qa', 'QA Norte');

    expect(result.role.key).toBe('c_qa_norte');
    expect(result.role.isSystem).toBe(false);
    expect(result.role.label).toBe('QA Norte');
    expect(result.role.grants).toEqual([
      { permissionKey: 'task:read', scope: 'PROJECT' },
      { permissionKey: 'measurement:read', scope: 'PROJECT' },
    ]);
    expect(result.omittedPermissionKeys).toEqual(['document:read', 'document:sign:qa']);
  });

  it('clona sin omisiones cuando todos los grants son componibles y atribuye el createdById del origen', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_src', key: 'c_origen', label: 'Origen', description: 'desc', isSystem: false, createdById: 'user_9',
    });
    prisma.rolePermission.findMany
      .mockResolvedValueOnce([{ permission: { key: 'task:read', kind: 'STRUCTURAL' }, scope: 'PROJECT' }])
      .mockResolvedValueOnce([{ permission: { key: 'task:read' }, scope: 'PROJECT' }]);
    prisma.permission.findMany.mockResolvedValue([
      { id: 'p_task_read', key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', scopeable: true },
    ]);
    prisma.role.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue({
      id: 'role_new', key: 'c_copia', label: 'Copia', description: 'desc', isSystem: false,
    });

    const result = await service.cloneRole('c_origen', 'Copia');

    expect(result.omittedPermissionKeys).toEqual([]);
    expect(result.role.grants).toEqual([{ permissionKey: 'task:read', scope: 'PROJECT' }]);
    expect(prisma.role.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ createdById: 'user_9' }) }),
    );
  });

  it('si TODOS los grants del origen son no componibles, crea un clon vacío y los reporta (A6+A7)', async () => {
    prisma.role.findUniqueOrThrow.mockResolvedValue({
      id: 'role_qa', key: 'qa', label: 'QA', description: null, isSystem: true, createdById: null,
    });
    prisma.rolePermission.findMany
      .mockResolvedValueOnce([{ permission: { key: 'document:sign:qa', kind: 'STRUCTURAL' }, scope: 'PROJECT' }])
      .mockResolvedValueOnce([]); // getRole del clon vacío
    prisma.permission.findMany.mockResolvedValue([]);
    prisma.role.findMany.mockResolvedValue([]);
    prisma.role.create.mockResolvedValue({
      id: 'role_new', key: 'c_qa_norte', label: 'QA Norte', description: null, isSystem: false,
    });

    const result = await service.cloneRole('qa', 'QA Norte');

    expect(result.role.grants).toEqual([]);
    expect(result.omittedPermissionKeys).toEqual(['document:sign:qa']);
  });

  it('lanza 404 si el rol origen no existe', async () => {
    prisma.role.findUniqueOrThrow.mockRejectedValue(new Error('not found'));

    await expect(service.cloneRole('c_no_existe', 'Nuevo')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] 2. Correr y ver que falla (`cloneRole` no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 3. Implementación mínima. Agregar `CloneRoleResponse` a los imports de contracts y el método:

```ts
// ampliar el import de tipos de contracts:
import type { CloneRoleResponse } from '@gmt-platform/contracts';
```

```ts
  /**
   * Clona un rol EXISTENTE (sistema o custom) como rol CUSTOM nuevo con
   * `label` propio (A7, spec §6.2/§13.4). Los grants NO componibles
   * (STRUCTURAL fuera de `COMPOSABLE_STRUCTURAL`, p. ej. `document:sign:qa`
   * del rol 'qa' sembrado) se OMITEN del clon y se devuelven en
   * `omittedPermissionKeys` para que la UI los avise. Si todos se omiten, el
   * clon queda con `grants: []` (válido por A6). Los grants restantes pasan
   * igual por `validateGrants` dentro de `createRole` (p. ej. clonar
   * `org_admin`, que mezcla STRUCTURAL org y project componibles, sigue
   * fallando con 400 MIXED_SCOPE_LEVELS — correcto por diseño). Atribución:
   * se reutiliza `source.createdById` (null para roles sembrados).
   */
  async cloneRole(key: string, label: string): Promise<CloneRoleResponse> {
    const source = await this.findRoleOrThrow(key);
    const sourceGrantsRaw = await this.prisma.rolePermission.findMany({
      where: { roleId: source.id },
      include: { permission: true },
    });

    const grants: RoleGrant[] = [];
    const omittedPermissionKeys: string[] = [];
    for (const grantRaw of sourceGrantsRaw) {
      if (composable(grantRaw.permission)) {
        grants.push({ permissionKey: grantRaw.permission.key, scope: grantRaw.scope });
      } else {
        omittedPermissionKeys.push(grantRaw.permission.key);
      }
    }

    const role = await this.createRole(
      { label, description: source.description ?? undefined, grants },
      source.createdById,
    );
    return { role, omittedPermissionKeys };
  }
```

(No hay que tocar la firma de `createRole`: acepta `createdById: string | null` desde la Task 2.5, y `Role.createdById` es `String?` en el schema.)

- [ ] 4. Correr y ver que pasa — el suite completo del archivo, para confirmar que nada previo (2.4–2.10) se rompió:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.service.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.service.ts" "nodes/backend-central/test/modules/roles/roles.service.spec.ts"
  git commit -m "feat(roles): cloneRole filtra grants no componibles y reporta omittedPermissionKeys (A7)"
  ```

---

### Task 2.12: RolesController — endpoints con gate can_manage_roles

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.controller.ts`
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/dto/clone-role.dto.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles/roles.controller.spec.ts`

- [ ] 1. Escribir el test que falla:

```ts
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { RolesController } from '../../../src/modules/roles/roles.controller';
import type { RolesService } from '../../../src/modules/roles/roles.service';

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

  it('POST /roles sin usuario autenticado responde 401 (CurrentUser devuelve undefined)', async () => {
    const service = makeServiceMock();
    const controller = new RolesController(service as unknown as RolesService);

    await expect(controller.createRole({ label: 'Demo', grants: [] }, undefined)).rejects.toMatchObject({
      status: 401,
    });
    expect(service.createRole).not.toHaveBeenCalled();
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

  it('POST /roles/:key/clone delega en rolesService.cloneRole y devuelve role + omittedPermissionKeys (A7)', async () => {
    const service = makeServiceMock();
    service.cloneRole.mockResolvedValue({
      role: { key: 'c_demo_2' },
      omittedPermissionKeys: ['document:sign:qa'],
    });
    const controller = new RolesController(service as unknown as RolesService);

    const result = await controller.cloneRole('c_demo', { label: 'Demo copia' });

    expect(service.cloneRole).toHaveBeenCalledWith('c_demo', 'Demo copia');
    expect(result).toEqual({ role: { key: 'c_demo_2' }, omittedPermissionKeys: ['document:sign:qa'] });
  });
});
```

- [ ] 2. Correr y ver que falla (el controller no existe):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.controller.spec.ts`

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

Crear `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.controller.ts` (verificado contra el repo: `CurrentUser` — `src/auth/current-user.decorator.ts` — devuelve `AuthUser | undefined`, así que el guard explícito de 401 es necesario; `ORG_ID = 'gmt'` vive en `src/common/org.constant.ts`):

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { CloneRoleResponse, PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';
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

  /** Crea un rol custom (grants: [] es válido, A6). */
  @Post('roles')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() authUser: AuthUser | undefined,
  ): Promise<RoleDetail> {
    if (!authUser) {
      throw new UnauthorizedException('Se requiere un usuario autenticado.');
    }
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

  /** Clona un rol (sistema o custom); devuelve el rol nuevo + permisos omitidos (A7). */
  @Post('roles/:key/clone')
  @RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })
  cloneRole(@Param('key') key: string, @Body() dto: CloneRoleDto): Promise<CloneRoleResponse> {
    return this.rolesService.cloneRole(key, dto.label);
  }
}
```

- [ ] 4. Correr y ver que pasa:
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles/roles.controller.spec.ts`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.controller.ts" "nodes/backend-central/test/modules/roles/roles.controller.spec.ts" "nodes/backend-central/src/modules/roles/dto/clone-role.dto.ts"
  git commit -m "feat(roles): RolesController con gate can_manage_roles (GET/POST/PATCH/DELETE/clone)"
  ```

---

### Task 2.13: RolesModule — wiring

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/roles/roles.module.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/app.module.ts` (o el módulo raíz donde se registra `UsersModule`; verificar ruta exacta antes de editar)
- Test: ninguno nuevo (este wiring se cubre por el `tsc --noEmit` + arranque de Nest; no amerita spec propio, igual que `UsersModule` no tiene uno)

> **A12:** el registro de `RolesModule` en el módulo raíz se hace AQUÍ (Fase 2). La Task 4.3 de la Fase 4 es solo una verificación de que este registro existe — no re-registra nada.

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
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles`

- [ ] 5. Commit:
  ```bash
  git add "nodes/backend-central/src/modules/roles/roles.module.ts" "nodes/backend-central/src/app.module.ts"
  git commit -m "feat(roles): registrar RolesModule en el modulo raiz"
  ```

---

### Task 2.14: Verificación final de Fase 2

**Files:** ninguno (solo verificación, sin cambios de código)

- [ ] 1. Correr el suite completo del backend para confirmar que Fase 2 no rompió nada existente (incluye `test/fga.service.spec.ts` con el stub de la Task 2.8a y los specs nuevos de `test/modules/roles/`):
  `pnpm --filter "@gmt-platform/backend-central" exec vitest run`
- [ ] 2. Correr `tsc --noEmit` en backend y en web (por el cambio de `RoleKey` en contracts):
  `pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit`
  `pnpm --filter "@gmt-platform/web" exec tsc --noEmit`
- [ ] 3. Correr `pnpm lint` en la raíz del monorepo y confirmar cero errores nuevos atribuibles a `modules/roles`.
- [ ] 4. Si todo pasa, no se requiere commit adicional (task de verificación, sin cambios). Si algo falla, volver a la task correspondiente y corregir antes de dar la Fase 2 por cerrada.

---

## Fase 3: Sincronización FgaService + asignación de roles por scope

> **Contexto de orden (enmienda A13):** el orden real de fases es 1→2→3→4→5. Cuando esta fase corre, la Fase 2 YA entregó: `RolesModule`/`RolesService` (CRUD completo, `updateRole` canónico con rollback 502 — Task 2.8), `composable-permissions.ts` (Task 2.2) y el **stub** `FgaService.resyncRole` (no-op con `Logger.warn`). Esta fase entrega: `FgaService` con Prisma, `syncRoleAssignment` (unión multi-rol + dedupe, enmienda A5), el `resyncRole` REAL (reemplaza el stub, enmienda A2), y la asignación de roles por scope en `UsersService`/`UsersController` con respuesta extendida (enmienda A4).

### Task 3.1: `FgaModule` inyecta `PrismaService` en `FgaService`

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.module.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts` (solo el constructor por ahora)
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga.service.spec.ts` (spec EXISTENTE — línea ~11 hace `new FgaService(client as unknown as FgaClientLike)`; se actualiza al nuevo constructor. NO crear `test/fga/fga.service.spec.ts` paralelo: un solo spec canónico por service — enmienda A10)
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga-model.spec.ts` (3 construcciones directas `new FgaService(recorder.client)` en las líneas ~183/195/207)

`FgaService` hoy solo depende de `FGA_CLIENT`. Las tasks 3.3/3.4 necesitan leer `Role`/`RolePermission`/`Permission`/`Membership` vía Prisma, así que primero hay que darle acceso a `PrismaService`. `PrismaModule` es global, pero se declara el import explícito en `FgaModule` para que la dependencia quede clara y tipada (práctica ya usada por `UsersModule`).

- [ ] 1. Escribir el test que falla: en `test/fga.service.spec.ts` (el EXISTENTE, en la raíz de `test/`), agregar el helper `buildPrismaStub()` y un `describe` nuevo que instancia `new FgaService(client, prisma)` (2 argumentos):

```typescript
// ---- agregar a test/fga.service.spec.ts (imports arriba, describe al final) ----
import type { PrismaService } from '../src/prisma/prisma.service';

function buildPrismaStub(): PrismaService {
  return {
    role: { findUnique: vi.fn(), findMany: vi.fn() },
    membership: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
  } as unknown as PrismaService;
}

describe('FgaService — constructor con PrismaService', () => {
  it('se construye recibiendo (client, prisma) sin lanzar', () => {
    const client = {
      check: vi.fn(() => Promise.resolve({ allowed: false })),
      write: vi.fn(() => Promise.resolve({})),
    };
    expect(
      () => new FgaService(client as unknown as FgaClientLike, buildPrismaStub()),
    ).not.toThrow();
  });
});
```

- [ ] 2. Correr y ver que falla. Ojo: vitest (esbuild) no chequea tipos, así que el "rojo" real de esta task es `tsc` (TS2554: exceso de argumentos con el constructor actual de 1 parámetro):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 3. Implementación mínima. En `fga.service.ts`, agregar el segundo parámetro inyectado (el stub `resyncRole` de Fase 2 queda intacto por ahora; se reemplaza en la Task 3.4):

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

  // ... resto de métodos existentes sin cambios (check, writeTuples, deleteTuples,
  // syncMembershipToFGA, y el stub resyncRole de Fase 2; se completan en 3.3/3.4)
```

  En `fga.module.ts`, importar `PrismaModule` explícitamente:

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

  Actualizar TODOS los call-sites de `new FgaService(...)` en tests (verificado con grep: son `test/fga.service.spec.ts` línea ~11 y `test/fga-model.spec.ts` líneas ~183/195/207):

  - `test/fga.service.spec.ts`, helper `buildClient()`:

```typescript
function buildClient() {
  const client = {
    check: vi.fn(() => Promise.resolve({ allowed: true })),
    write: vi.fn(() => Promise.resolve({})),
  };
  return {
    client,
    service: new FgaService(client as unknown as FgaClientLike, buildPrismaStub()),
  };
}
```

  - `test/fga-model.spec.ts`: agregar un stub local sin `vi.fn` (ese spec no lo necesita) y usarlo en las 3 construcciones:

```typescript
import type { PrismaService } from '../src/prisma/prisma.service';

/** Stub mínimo: los tests de mapeo de syncMembershipToFGA no tocan Prisma. */
function buildPrismaStub(): PrismaService {
  return {
    role: { findUnique: () => Promise.resolve(null), findMany: () => Promise.resolve([]) },
    membership: { findMany: () => Promise.resolve([]) },
    permission: { findMany: () => Promise.resolve([]) },
  } as unknown as PrismaService;
}

// y en cada test:  const service = new FgaService(recorder.client, buildPrismaStub());
```

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts test/fga-model.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/fga/fga.module.ts nodes/backend-central/src/fga/fga.service.ts nodes/backend-central/test/fga.service.spec.ts nodes/backend-central/test/fga-model.spec.ts
  git commit -m "feat(fga): inyecta PrismaService en FgaService"
  ```

---

### Task 3.2: VERIFICACIÓN — `composable-permissions.ts` ya existe (Fase 2, Task 2.2)

**Files:** ninguno (verificación; enmienda A3 — NO crear archivos)

El mapa `COMPOSABLE_STRUCTURAL` y los helpers `composable()` / `fgaObjectTypeOf()` se crearon UNA sola vez en la **Fase 2 (Task 2.2)**, con su test. Esta task solo confirma que están disponibles para `FgaService` (Tasks 3.3/3.4) y que su test sigue en verde. Contexto del seed real (`prisma/seed.ts`): **5 permisos comparten la relación `can_view`** (`project:read`, `service:read`, `measurement:read`, `task:read`, `document:read`) — por eso las Tasks 3.3/3.4 deduplican tuplas.

- [ ] 1. Confirmar los exports de Fase 2:
  ```powershell
  Select-String -Path "nodes/backend-central/src/modules/roles/composable-permissions.ts" -Pattern "export const COMPOSABLE_STRUCTURAL|export function composable|export function fgaObjectTypeOf"
  ```
  Deben aparecer los tres. Si falta alguno, la Fase 2 (Task 2.2) quedó incompleta: volver a esa task antes de seguir (no re-implementar aquí).
- [ ] 2. Correr el test de Fase 2 y el typecheck en verde:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/composable-permissions.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 3. Sin commit (no hay cambios).

---

### Task 3.3: `FgaService.syncRoleAssignment` — tuplas create/delete con unión multi-rol y dedupe

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga.service.spec.ts` (extiende el spec canónico de Task 3.1)

`syncRoleAssignment` traduce "el usuario U tiene el rol custom R en el scope S" a tuplas FGA de sus grants `STRUCTURAL`. Semántica (enmienda A5): el set deseado de tuplas para `(usuario, objeto)` es la **UNIÓN** de los grants STRUCTURAL de TODOS los roles custom (`isSystem=false`) que el usuario tiene asignados sobre ESE objeto. Por eso:

- **Dedupe** por `Set` con clave `"user|relation|object"`: 5 permisos del seed comparten `can_view`, así que un rol con `project:read` + `task:read` genera UNA sola tupla `can_view`.
- **`delete` nunca revoca lo que otro rol custom sigue otorgando**: antes de borrar, se resta la unión de los DEMÁS roles custom del usuario sobre el mismo objeto.
- **`create` no re-escribe tuplas ya sostenidas por otro rol** (el `write` de OpenFGA no es idempotente: re-escribir una tupla existente falla).

Grants cuyo `permission.key` no está en `COMPOSABLE_STRUCTURAL` se ignoran (defensivo: `RolesService.validateGrants` — **Fase 2** — ya impide guardarlos, pero `FgaService` no debe asumirlo).

- [ ] 1. Escribir el test que falla, agregando estos casos a `test/fga.service.spec.ts`:

```typescript
// ---- agregar en el mismo archivo ----
import { ORG_ID } from '../src/common/org.constant';

interface RoleGrantRow {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

interface OtherRoleRow {
  key: string;
  isSystem: boolean;
  permissions: RoleGrantRow[];
}

function buildPrismaForSync(opts: {
  grants: RoleGrantRow[] | null; // null = el rol no existe
  otherMemberships?: Array<{ roleKey: string }>;
  otherRoles?: OtherRoleRow[];
}): PrismaService {
  return {
    role: {
      findUnique: vi.fn(() =>
        Promise.resolve(
          opts.grants === null
            ? null
            : { key: 'c_auditor', isSystem: false, permissions: opts.grants },
        ),
      ),
      findMany: vi.fn(() => Promise.resolve(opts.otherRoles ?? [])),
    },
    membership: { findMany: vi.fn(() => Promise.resolve(opts.otherMemberships ?? [])) },
    permission: { findMany: vi.fn(() => Promise.resolve([])) },
  } as unknown as PrismaService;
}

function buildBareClient() {
  return {
    check: vi.fn(() => Promise.resolve({ allowed: false })),
    write: vi.fn(() => Promise.resolve({})),
  };
}

describe('FgaService.syncRoleAssignment', () => {
  it('op create: escribe tupla organization para un grant STRUCTURAL org-level', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID },
      'create',
    );

    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_review_documents', object: `organization:${ORG_ID}` }],
    });
  });

  it('op delete: borra la tupla project para un grant STRUCTURAL project-level', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        {
          scope: 'PROJECT',
          permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' },
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'delete',
    );

    expect(client.write).toHaveBeenCalledWith({
      deletes: [{ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' }],
    });
  });

  it('dedupe: project:read + task:read + measurement:read comparten can_view → UNA sola tupla', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
        { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
        { scope: 'PROJECT', permission: { key: 'measurement:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_view', object: 'project:p1' }],
    });
  });

  it('delete NO borra una tupla que otra membership custom del usuario sigue sosteniendo', async () => {
    // c_auditor otorga can_view vía task:read; c_reporte (también asignado a u1 en p1)
    // sigue otorgando can_view vía project:read → el delete no debe tocar la tupla.
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      ],
      otherMemberships: [{ roleKey: 'c_reporte' }],
      otherRoles: [
        {
          key: 'c_reporte',
          isSystem: false,
          permissions: [
            { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
          ],
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'delete',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('create NO re-escribe una tupla ya sostenida por otro rol custom (write FGA no idempotente)', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
        { scope: 'PROJECT', permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' } },
      ],
      otherMemberships: [{ roleKey: 'c_reporte' }],
      otherRoles: [
        {
          key: 'c_reporte',
          isSystem: false,
          permissions: [
            { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
          ],
        },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    // Solo se escribe can_assign_task; can_view ya existe (lo sostiene c_reporte).
    expect(client.write).toHaveBeenCalledTimes(1);
    expect(client.write).toHaveBeenCalledWith({
      writes: [{ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' }],
    });
  });

  it('ignora grants FUNCTIONAL (no tienen fgaRelation)', async () => {
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'task:time:log', kind: 'FUNCTIONAL', fgaRelation: null } },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('ignora grants STRUCTURAL cuyo object type no coincide con el scopeType de la asignación', async () => {
    // 'project:read' es de tipo 'project'; se asigna a nivel ORGANIZATION → no aplica.
    const prisma = buildPrismaForSync({
      grants: [
        { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      ],
    });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('lista vacía de tuplas → no llama write (no-op)', async () => {
    const prisma = buildPrismaForSync({ grants: [] });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

    await svc.syncRoleAssignment(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );

    expect(client.write).not.toHaveBeenCalled();
  });

  it('rol inexistente: no lanza y no escribe tuplas', async () => {
    const prisma = buildPrismaForSync({ grants: null });
    const client = buildBareClient();
    const svc = new FgaService(client as unknown as FgaClientLike, prisma);

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
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts
  ```
- [ ] 3. Implementación. Agregar a `fga.service.ts` (el stub `resyncRole` de Fase 2 sigue intacto; se reemplaza en 3.4):

```typescript
import { COMPOSABLE_STRUCTURAL } from '../modules/roles/composable-permissions';
import { ORG_ID } from '../common/org.constant';

/** Scopes admitidos para asignaciones de roles custom (matriz RBAC). */
type AssignableScopeType = 'ORGANIZATION' | 'PROJECT';

/** Asignación (usuario, rol, scope) a sincronizar con FGA. */
interface RoleAssignmentInput {
  userId: string;
  roleKey: string;
  scopeType: AssignableScopeType;
  scopeId: string;
}

/** Forma del grant que consumen estos métodos (evita `any`). */
interface StructuralGrant {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

/** organization:gmt | project:<scopeId> según el scope de la asignación. */
function objectOf(
  scopeType: AssignableScopeType,
  scopeId: string,
): { objectType: 'organization' | 'project'; object: string } {
  return scopeType === 'ORGANIZATION'
    ? { objectType: 'organization', object: `organization:${ORG_ID}` }
    : { objectType: 'project', object: `project:${scopeId}` };
}

/** Clave canónica de tupla para sets de dedupe/unión (enmienda A5). */
function tupleId(t: TupleKey): string {
  return `${t.user}|${t.relation}|${t.object}`;
}

// dentro de la clase FgaService:

  /**
   * Sincroniza la asignación de un rol CUSTOM a un usuario en un scope dado
   * (org o project) hacia OpenFGA: por cada grant STRUCTURAL del rol cuyo
   * object type (vía COMPOSABLE_STRUCTURAL) coincide con `scopeType`, escribe
   * o borra la tupla directa `(user, fgaRelation, objectType:scopeId)`.
   *
   * Semántica multi-rol (A5): el set FGA deseado para (usuario, objeto) es la
   * UNIÓN de los grants STRUCTURAL de TODOS sus roles custom sobre ese objeto.
   * Las tuplas que otro rol custom sigue sosteniendo NO se borran en 'delete'
   * ni se re-escriben en 'create' (el write de OpenFGA no es idempotente).
   * Tuplas deduplicadas por "user|relation|object" (5 permisos comparten can_view).
   */
  async syncRoleAssignment(input: RoleAssignmentInput, op: MembershipSyncOp): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { key: input.roleKey },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) return;

    const { objectType, object } = objectOf(input.scopeType, input.scopeId);
    const tuples = this.dedupeTuples(
      this.tuplesFromGrants(
        role.permissions as unknown as StructuralGrant[],
        input.userId,
        objectType,
        object,
      ),
    );
    if (tuples.length === 0) return;

    const sustained = await this.tuplesSustainedByOtherCustomRoles(input);
    const effective = tuples.filter((t) => !sustained.has(tupleId(t)));

    if (op === 'create') {
      await this.writeTuples(effective);
    } else {
      await this.deleteTuples(effective);
    }
  }

  /** Grants STRUCTURAL composables de un rol → tuplas FGA sobre `object` (sin dedupe). */
  private tuplesFromGrants(
    grants: StructuralGrant[],
    userId: string,
    objectType: 'organization' | 'project',
    object: string,
  ): TupleKey[] {
    const out: TupleKey[] = [];
    for (const grant of grants) {
      const { permission } = grant;
      if (permission.kind !== 'STRUCTURAL' || !permission.fgaRelation) continue;
      if (COMPOSABLE_STRUCTURAL[permission.key] !== objectType) continue;
      out.push({ user: `user:${userId}`, relation: permission.fgaRelation, object });
    }
    return out;
  }

  /** Dedupe por "user|relation|object" (varios permisos pueden compartir relación, p.ej. can_view). */
  private dedupeTuples(tuples: TupleKey[]): TupleKey[] {
    const seen = new Set<string>();
    const out: TupleKey[] = [];
    for (const tuple of tuples) {
      const id = tupleId(tuple);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(tuple);
    }
    return out;
  }

  /**
   * Set "user|relation|object" con la unión de grants STRUCTURAL de los DEMÁS
   * roles custom (isSystem=false) que el usuario tiene asignados sobre el
   * MISMO objeto. Funciona igual para create (la Membership nueva ya existe en
   * Postgres pero se excluye por roleKey) y delete (la Membership ya se borró).
   */
  private async tuplesSustainedByOtherCustomRoles(input: RoleAssignmentInput): Promise<Set<string>> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: input.userId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        roleKey: { not: input.roleKey },
      },
    });
    const otherKeys = [...new Set(memberships.map((m) => m.roleKey))];
    if (otherKeys.length === 0) return new Set();

    const roles = await this.prisma.role.findMany({
      where: { key: { in: otherKeys }, isSystem: false },
      include: { permissions: { include: { permission: true } } },
    });

    const { objectType, object } = objectOf(input.scopeType, input.scopeId);
    const sustained = new Set<string>();
    for (const role of roles) {
      const tuples = this.tuplesFromGrants(
        role.permissions as unknown as StructuralGrant[],
        input.userId,
        objectType,
        object,
      );
      for (const tuple of tuples) {
        sustained.add(tupleId(tuple));
      }
    }
    return sustained;
  }
```

  Nota de import circular: `composable-permissions.ts` (Fase 2) no importa nada de `fga/`, así que no hay ciclo. Verificar que `role.findUnique` con `include: { permissions: { include: { permission: true } } }` compila contra el schema Prisma (relaciones `Role.permissions: RolePermission[]` y `RolePermission.permission: Permission` — confirmadas en `prisma/schema.prisma`). `Membership` NO tiene relación Prisma con `Role` (solo `roleKey` string): por eso la unión se resuelve en dos queries (memberships → `role.findMany` por keys).

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/fga/fga.service.ts nodes/backend-central/test/fga.service.spec.ts
  git commit -m "feat(fga): syncRoleAssignment con unión multi-rol y dedupe de tuplas"
  ```

---

### Task 3.4: `resyncRole` REAL — reemplaza el stub de Fase 2 con el delta (altas + bajas, respetando la unión multi-rol)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/fga/fga.service.ts` (REEMPLAZA el stub `resyncRole` que dejó la Fase 2 — enmienda A2; Modify, no Create)
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/fga.service.spec.ts`

La Fase 2 (Task 2.8) dejó `resyncRole(roleKey)` como stub (no-op con `Logger.warn`) para que `updateRole` compilara. Esta task lo reemplaza por la implementación real: si `RolesService.updateRole` QUITA un grant STRUCTURAL, la tupla vieja debe borrarse de todos los miembros. Estrategia del SPINE: las relaciones FGA por permiso son estables (`fgaRelation` fijo por `permission.key`), y el catálogo composable es conocido y pequeño → `resyncRole` calcula el set **deseado** (grants vigentes) y el set **posible** (todas las relaciones STRUCTURAL composables de ese object type según el catálogo `Permission`), y borra las posibles que ya no correspondan.

Dos restricciones (enmienda A5 + realidad OpenFGA):
1. **Unión multi-rol**: nunca borrar (ni re-escribir) una tupla que OTRO rol custom del usuario sigue sosteniendo sobre el mismo objeto.
2. **Tolerancia a no-ops**: contra OpenFGA real, `write` de una tupla existente y `delete` de una inexistente FALLAN. Como el delta se calcula sin leer el estado FGA (el set "posible" incluye relaciones que el rol quizá nunca escribió, y el set "deseado" incluye relaciones que ya existen), el resync escribe/borra **de a una tupla** tolerando esos dos errores (`already exists` / `does not exist`); cualquier otro error se propaga para que `updateRole` (Fase 2) haga rollback + 502.

- [ ] 1. Escribir el test que falla, agregando a `test/fga.service.spec.ts`:

```typescript
function buildRecordingClient(): { client: FgaClientLike; writes: TupleKey[]; deletes: TupleKey[] } {
  const writes: TupleKey[] = [];
  const deletes: TupleKey[] = [];
  const client: FgaClientLike = {
    check: vi.fn(() => Promise.resolve({ allowed: false })),
    write: vi.fn((body: { writes?: TupleKey[]; deletes?: TupleKey[] }) => {
      if (body.writes) writes.push(...body.writes);
      if (body.deletes) deletes.push(...body.deletes);
      return Promise.resolve(undefined);
    }),
  };
  return { client, writes, deletes };
}

function buildPrismaForResync(opts: {
  grants: RoleGrantRow[];
  memberships: Array<{ userId: string; roleKey: string; scopeType: string; scopeId: string }>;
  catalogRelations: string[]; // relaciones STRUCTURAL composables del object type (catálogo Permission)
  otherMemberships?: Array<{ roleKey: string }>;
  otherRoles?: OtherRoleRow[];
}): PrismaService {
  return {
    role: {
      findUnique: vi.fn(() =>
        Promise.resolve({ key: 'c_auditor', isSystem: false, permissions: opts.grants }),
      ),
      findMany: vi.fn(() => Promise.resolve(opts.otherRoles ?? [])),
    },
    membership: {
      // where.roleKey string → memberships del rol (resync);
      // where.roleKey {not} → memberships de OTROS roles (unión multi-rol).
      findMany: vi.fn((args: { where: { roleKey?: unknown } }) =>
        typeof args.where.roleKey === 'string'
          ? Promise.resolve(opts.memberships)
          : Promise.resolve(opts.otherMemberships ?? []),
      ),
    },
    permission: {
      findMany: vi.fn(() =>
        Promise.resolve(opts.catalogRelations.map((fgaRelation) => ({ fgaRelation }))),
      ),
    },
  } as unknown as PrismaService;
}

describe('FgaService.resyncRole — delta real', () => {
  it('si el rol perdió un grant STRUCTURAL, borra la tupla vieja de los miembros existentes', async () => {
    // c_auditor HOY solo tiene 'document:review' (perdió 'finance:manage').
    const prisma = buildPrismaForResync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID }],
      // Catálogo org real del seed: 3 relaciones composables org-level.
      catalogRelations: ['can_view_directory_extended', 'can_review_documents', 'can_manage_finance'],
    });
    const { client, writes, deletes } = buildRecordingClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    // Escribe la tupla vigente (document:review)...
    expect(writes).toContainEqual({
      user: 'user:u1',
      relation: 'can_review_documents',
      object: `organization:${ORG_ID}`,
    });
    // ...borra la de finance:manage, que ya no es grant del rol...
    expect(deletes).toContainEqual({
      user: 'user:u1',
      relation: 'can_manage_finance',
      object: `organization:${ORG_ID}`,
    });
    // ...y NUNCA borra una relación vigente.
    expect(deletes).not.toContainEqual({
      user: 'user:u1',
      relation: 'can_review_documents',
      object: `organization:${ORG_ID}`,
    });
  });

  it('editar el rol A no revoca lo que el rol B sigue otorgando (unión multi-rol)', async () => {
    // c_auditor perdió task:read (grants: []). u1 también tiene c_reporte en p1,
    // que otorga can_view vía project:read → resyncRole NO debe borrar can_view.
    const prisma = buildPrismaForResync({
      grants: [],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }],
      catalogRelations: ['can_view', 'can_create_task', 'can_assign_task'],
      otherMemberships: [{ roleKey: 'c_reporte' }],
      otherRoles: [
        {
          key: 'c_reporte',
          isSystem: false,
          permissions: [
            { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
          ],
        },
      ],
    });
    const { client, deletes } = buildRecordingClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    expect(deletes).not.toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
    // Las relaciones que nadie sostiene sí se limpian (tolerante si no existían).
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });
  });

  it('sin memberships del rol → no llama write', async () => {
    const prisma = buildPrismaForResync({ grants: [], memberships: [], catalogRelations: [] });
    const { client } = buildRecordingClient();
    const svc = new FgaService(client, prisma);

    await svc.resyncRole('c_auditor');

    expect(client.write).not.toHaveBeenCalled();
  });

  it('tolera los no-ops de FGA: "already exists" en write y "does not exist" en delete', async () => {
    const prisma = buildPrismaForResync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID }],
      catalogRelations: ['can_review_documents', 'can_manage_finance'],
    });
    const client: FgaClientLike = {
      check: vi.fn(() => Promise.resolve({ allowed: false })),
      write: vi.fn((body: { writes?: TupleKey[]; deletes?: TupleKey[] }) =>
        Promise.reject(
          new Error(
            body.writes
              ? 'cannot write a tuple which already exists'
              : 'cannot delete a tuple which does not exist',
          ),
        ),
      ),
    };
    const svc = new FgaService(client, prisma);

    await expect(svc.resyncRole('c_auditor')).resolves.toBeUndefined();
  });

  it('otros errores FGA SÍ se propagan (para que updateRole haga rollback + 502)', async () => {
    const prisma = buildPrismaForResync({
      grants: [
        {
          scope: 'GLOBAL',
          permission: { key: 'document:review', kind: 'STRUCTURAL', fgaRelation: 'can_review_documents' },
        },
      ],
      memberships: [{ userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: ORG_ID }],
      catalogRelations: ['can_review_documents'],
    });
    const client: FgaClientLike = {
      check: vi.fn(() => Promise.resolve({ allowed: false })),
      write: vi.fn(() => Promise.reject(new Error('connection refused'))),
    };
    const svc = new FgaService(client, prisma);

    await expect(svc.resyncRole('c_auditor')).rejects.toThrow(/connection refused/);
  });
});
```

- [ ] 2. Correr y ver que falla (el stub de Fase 2 es no-op: no escribe ni borra nada):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts
  ```
- [ ] 3. Implementación: **reemplazar** el cuerpo del stub `resyncRole` (borrar el `Logger.warn('resyncRole: stub, se implementa en Fase 3')` de Fase 2) por:

```typescript
  /**
   * Recorre las Membership del rol y aplica el delta (altas + bajas) para que
   * FGA refleje exactamente sus grants STRUCTURAL vigentes (spec §6.4).
   * Por cada membership: set deseado = grants vigentes que aplican a su
   * scopeType; set posible = todas las relaciones STRUCTURAL composables de
   * ese object type (catálogo Permission). posible − deseado se borra, salvo
   * lo que OTRO rol custom del usuario siga sosteniendo (unión, A5).
   * Escribe/borra de a una tupla tolerando los no-ops de OpenFGA
   * (already exists / does not exist); otros errores se propagan.
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
      const scopeType = membership.scopeType as string;
      if (scopeType !== 'ORGANIZATION' && scopeType !== 'PROJECT') continue;
      const assignScope = scopeType as AssignableScopeType;
      const { objectType, object } = objectOf(assignScope, membership.scopeId);

      const desired = this.dedupeTuples(
        this.tuplesFromGrants(grants, membership.userId, objectType, object),
      );
      const desiredIds = new Set(desired.map(tupleId));

      const possibleRelations = await this.possibleRelationsFor(objectType);
      const sustained = await this.tuplesSustainedByOtherCustomRoles({
        userId: membership.userId,
        roleKey,
        scopeType: assignScope,
        scopeId: membership.scopeId,
      });

      const writes = desired.filter((t) => !sustained.has(tupleId(t)));
      const deletes: TupleKey[] = [...possibleRelations]
        .map((relation) => ({ user: `user:${membership.userId}`, relation, object }))
        .filter((t) => !desiredIds.has(tupleId(t)) && !sustained.has(tupleId(t)));

      await this.writeTuplesTolerant(writes);
      await this.deleteTuplesTolerant(deletes);
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

  /** write de a una tupla, tolerando "already exists" (write FGA no idempotente). */
  private async writeTuplesTolerant(tuples: TupleKey[]): Promise<void> {
    for (const tuple of tuples) {
      try {
        await this.client.write({ writes: [tuple] });
      } catch (error: unknown) {
        if (!isTupleNoopError(error)) throw error;
      }
    }
  }

  /** delete de a una tupla, tolerando "does not exist". */
  private async deleteTuplesTolerant(tuples: TupleKey[]): Promise<void> {
    for (const tuple of tuples) {
      try {
        await this.client.write({ deletes: [tuple] });
      } catch (error: unknown) {
        if (!isTupleNoopError(error)) throw error;
      }
    }
  }
```

  Y a nivel de módulo (junto a `objectOf`/`tupleId`):

```typescript
/** ¿El error de OpenFGA es un no-op tolerable (tupla ya existe / no existe)? */
function isTupleNoopError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already exists|does not exist/i.test(message);
}
```

  Si el stub de Fase 2 dejó en `test/fga.service.spec.ts` un test del comportamiento stub (p.ej. que `resyncRole` no llama a `write`, o que loguea el warn), ELIMINARLO en este paso: queda reemplazado por los tests del delta real.

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/fga/fga.service.ts nodes/backend-central/test/fga.service.spec.ts
  git commit -m "feat(fga): resyncRole real (delta altas/bajas, unión multi-rol, tolerante a no-ops)"
  ```

---

### Task 3.5: VERIFICACIÓN — `updateRole` (canónico en Fase 2) dispara el `resyncRole` real

**Files:**
- Posible Modify: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/roles.service.spec.ts` (solo si Fase 2 dejó tests atados al stub)

**Enmienda A2:** `updateRole` tiene UNA sola implementación canónica y vive en la **Fase 2 (Task 2.8)**: `$transaction` que reemplaza grants, llama `await this.fga.resyncRole(key)` SOLO cuando `input.grants !== undefined`, y ante fallo restaura los grants viejos + resync best-effort + 502 `{code:'FGA_SYNC_FAILED'}`. **Esta task NO re-implementa nada de eso.** Con la Task 3.4 el stub quedó reemplazado, así que `updateRole` ya sincroniza de verdad sin tocar `roles.service.ts`.

- [ ] 1. Verificar (lectura) que `roles.service.ts` cumple el contrato de Fase 2: `resyncRole` se llama solo con `input.grants !== undefined`, y el rollback + 502 están intactos. No editar.
- [ ] 2. Revisar `test/modules/roles.service.spec.ts` (Fase 2): sus tests mockean `fga.resyncRole`, así que normalmente NO cambian. Si algún test aserta el comportamiento del STUB (p.ej. espía el `Logger.warn` o asume que `resyncRole` real es no-op), actualizarlo/eliminarlo aquí.
- [ ] 3. Correr en verde la intersección de ambas fases:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/roles.service.spec.ts test/fga.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 4. Commit SOLO si hubo cambios de tests en el paso 2:
  ```bash
  git add nodes/backend-central/test/modules/roles.service.spec.ts
  git commit -m "test(roles): actualiza tests del stub resyncRole al comportamiento real"
  ```

---

### Task 3.6: DTO `AssignRoleScopedDto` + `UsersService.assignRoleScoped/removeRoleScoped` (respuesta extendida A4 + rollback A11) + `memberships` en `UserListItem`

**Files:**
- Create: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/dto/assign-role-scoped.dto.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.service.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.types.ts`
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.module.ts` (importa `RolesModule`, de **Fase 2**)
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/users.service.spec.ts` (el MISMO archivo existente que ya tocó la Fase 1 — enmienda A9; extiende, no crea)
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/dto/assign-role-scoped.dto.spec.ts` (nuevo)

`assignRoleScoped` convive con `assignRole` (org-only, legacy) agregando scope PROJECT y roles custom. Reglas: valida `scopeType` contra `allowedScopeTypes` del rol (vía `RolesService`, **Fase 2**, inyectado); si `scopeType === 'PROJECT'`, valida que `scopeId` exista en `Project`; crea `Membership`; si `Role.isSystem` usa `fga.syncMembershipToFGA` (camino existente), si es custom usa `fga.syncRoleAssignment` (Task 3.3).

**Contrato de respuesta (enmienda A4):** ambos métodos devuelven `UserRolesResponse` EXTENDIDA — `{ id, roleKeys, memberships: { roleKey, scopeType, scopeId }[] }` — para que la UI pueda remover asignaciones con el scope exacto. `UserMembership` viene de `@gmt-platform/contracts` (agregado en Fase 1, enmienda A4). Además (H13), `UserListItem` gana `memberships: UserMembership[]` para que `GET /users` y `GET /users/:id` los expongan (el `include: { memberships: true }` YA existe en `list`/`getById`).

**Rollback (enmienda A11):** si el sync FGA falla tras crear la `Membership`, se borra la `Membership` creada y se responde 502 `{code:'FGA_SYNC_FAILED'}`.

- [ ] 1. Escribir los tests que fallan.

  DTO (`test/modules/dto/assign-role-scoped.dto.spec.ts`, nuevo):

```typescript
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

  Y en `test/modules/users.service.spec.ts` (agregar `NotFoundException` al import de `@nestjs/common` existente):

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
  it('asigna un rol custom en scope PROJECT: crea Membership, llama fga.syncRoleAssignment y devuelve la respuesta extendida', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
      findMany: vi.fn(() =>
        Promise.resolve([{ roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }]),
      ),
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

    const result = await service.assignRoleScoped('u1', {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });

    expect(syncRoleAssignment).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
      'create',
    );
    // Respuesta extendida (A4): id + roleKeys + memberships con scope exacto.
    expect(result).toEqual({
      id: 'u1',
      roleKeys: [],
      memberships: [{ roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }],
    });
  });

  it('502 FGA_SYNC_FAILED si el sync FGA falla tras crear la Membership: borra la Membership creada (A11)', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    const membershipDelete = vi.fn(() => Promise.resolve(undefined));
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve(null)),
      create: vi.fn(() => Promise.resolve({ id: 'm1' })),
      delete: membershipDelete,
      findMany: vi.fn(() => Promise.resolve([])),
    };
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })),
    };
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({ id: 'u1' }),
    );
    const fga = buildFgaMock();
    (fga.fga as unknown as { syncRoleAssignment: unknown }).syncRoleAssignment = vi.fn(() =>
      Promise.reject(new Error('fga caída')),
    );
    const roles = buildRolesMock({ allowedScopeTypes: ['PROJECT'] });
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), roles);

    await expect(
      service.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }),
    ).rejects.toMatchObject({ status: 502, response: { code: 'FGA_SYNC_FAILED' } });
    expect(membershipDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
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
      findMany: vi.fn(() =>
        Promise.resolve([{ roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' }]),
      ),
    };
    (prisma as unknown as { project: Record<string, unknown> }).project = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })),
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

  it('removeRoleScoped borra la Membership, llama al sync de delete y devuelve la respuesta extendida', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    const membershipDelete = vi.fn(() => Promise.resolve(undefined));
    (prisma as unknown as { membership: Record<string, unknown> }).membership = {
      findUnique: vi.fn(() => Promise.resolve({ id: 'm1' })),
      delete: membershipDelete,
      findMany: vi.fn(() => Promise.resolve([])),
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

    const result = await service.removeRoleScoped('u1', {
      roleKey: 'c_auditor',
      scopeType: 'ORGANIZATION',
      scopeId: 'gmt',
    });

    expect(membershipDelete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(syncRoleAssignment).toHaveBeenCalledWith(
      { userId: 'u1', roleKey: 'c_auditor', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      'delete',
    );
    expect(result).toEqual({ id: 'u1', roleKeys: [], memberships: [] });
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

describe('UsersService — memberships en UserListItem (H13)', () => {
  it('getById expone memberships (roleKey, scopeType, scopeId) para la UI', async () => {
    const state: PrismaState = { rolesInCatalog: new Set(['operator']), emailExists: false, failPersist: false };
    const { prisma } = buildPrismaMock(state);
    (prisma as unknown as { user: { findUnique: ReturnType<typeof vi.fn> } }).user.findUnique = vi.fn(() =>
      Promise.resolve({
        id: 'u1',
        firstName: 'Ana',
        secondName: null,
        lastName: 'Pérez',
        secondLastName: null,
        email: 'ana@gmt.cl',
        status: 'ACTIVE',
        isClientUser: false,
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
        memberships: [
          { roleKey: 'operator', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
          { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
        ],
      }),
    );
    const fga = buildFgaMock();
    const service = new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesMock());

    const item = await service.getById('u1');

    expect(item.memberships).toEqual([
      { roleKey: 'operator', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' },
    ]);
  });
});
```

  (Los tests existentes de `UsersService.create`/`importBatch` en el mismo archivo instancian `new UsersService(prisma, fga.fga, buildStorageMock())` con 3 argumentos — al agregar el 4º parámetro `roles` esos call-sites se actualizan en el paso 3. Un default opcional en el constructor NO es aceptable en Nest DI real.)

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.service.spec.ts test/modules/dto/assign-role-scoped.dto.spec.ts
  ```
- [ ] 3. Implementación.

  DTO nuevo (`src/modules/users/dto/assign-role-scoped.dto.ts`):

```typescript
import { IsIn, IsString } from 'class-validator';
import type { ScopeType } from '@gmt-platform/contracts';

const ASSIGNABLE_SCOPE_TYPES: readonly ScopeType[] = ['ORGANIZATION', 'PROJECT'];

/**
 * Body de `POST /users/:id/roles` (diseño matriz RBAC, Fase 3). A diferencia
 * de `AssignRoleDto` (legacy, org-only), soporta scope PROJECT y roleKeys
 * arbitrarios (roles custom incluidos) — la validación semántica (¿el rol
 * existe? ¿el scopeType es uno de sus allowedScopeTypes?) la hace
 * `UsersService.assignRoleScoped` contra `RolesService` (Fase 2), no este DTO.
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

  `users.types.ts` (enmienda A4 — `UserMembership` viene de `@gmt-platform/contracts`, agregado en Fase 1):

```typescript
import type { ProvisionedUser, RoleKey, UserMembership } from '@gmt-platform/contracts';

export type { ProvisionedUser, RoleKey, UserMembership };

// ... (CreateUserResponse, ImportCreatedRow, ImportErrorRow, ImportUsersResponse sin cambios)

/** Item de lista / detalle de usuario (datos para `RoleScopedList`, §5). Sin campos sensibles. */
export interface UserListItem {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  status: string;
  isClientUser: boolean;
  roleKeys: RoleKey[];
  memberships: UserMembership[];
  createdAt: string;
}

/** Respuesta de asignar / quitar rol — EXTENDIDA (enmienda A4). */
export interface UserRolesResponse {
  id: string;
  roleKeys: RoleKey[];
  memberships: UserMembership[];
}
```

  En `users.service.ts`: agregar imports, inyectar `RolesService` (Fase 2) y agregar los métodos nuevos:

```typescript
import { HttpException } from '@nestjs/common';
import type { AssignRoleInput, ScopeType, UserMembership } from '@gmt-platform/contracts';
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
   * sincroniza FGA por el camino correcto según `Role.isSystem`. Si el sync
   * FGA falla, borra la Membership creada y responde 502 (enmienda A11).
   */
  async assignRoleScoped(userId: string, input: AssignRoleInput): Promise<UserRolesResponse> {
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

    const membership = await this.prisma.membership.create({
      data: {
        userId,
        roleKey: input.roleKey,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
    });

    try {
      await this.syncScopedAssignment(role.isSystem, {
        userId,
        roleKey: input.roleKey,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      }, 'create');
    } catch (error: unknown) {
      // A11: FGA falló → revertir la Membership recién creada y responder 502.
      try {
        await this.prisma.membership.delete({ where: { id: membership.id } });
      } catch (cleanupError: unknown) {
        this.logger.error(
          `Rollback parcial: no se pudo borrar la Membership ${membership.id} tras fallo FGA. Causa: ${this.errorMessage(cleanupError)}`,
        );
      }
      this.logger.error(`Sync FGA falló al asignar rol: ${this.errorMessage(error)}`);
      throw new HttpException(
        { code: 'FGA_SYNC_FAILED', message: 'No se pudo sincronizar OpenFGA; se revirtió la asignación.' },
        502,
      );
    }

    return this.currentRoles(userId);
  }

  /** Quita un rol (sistema o custom) de un usuario en un scope arbitrario. 404 si no existe la Membership. */
  async removeRoleScoped(userId: string, input: AssignRoleInput): Promise<UserRolesResponse> {
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

    return this.currentRoles(userId);
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

  Actualizar `currentRoles` para la respuesta extendida (A4): trae TODAS las memberships del usuario; `roleKeys` conserva la semántica legacy (roles a nivel org, para el directorio):

```typescript
  private async currentRoles(userId: string): Promise<UserRolesResponse> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      select: { roleKey: true, scopeType: true, scopeId: true },
    });
    const orgRoleKeys = memberships
      .filter((m) => m.scopeType === 'ORGANIZATION' && m.scopeId === ORG_ID)
      .map((m) => m.roleKey);
    return {
      id: userId,
      roleKeys: this.collectRoleKeys(orgRoleKeys),
      memberships: memberships.map((m) => this.toUserMembership(m)),
    };
  }

  /** Proyección pública de una Membership (contrato UserMembership, A4). */
  private toUserMembership(m: { roleKey: string; scopeType: string; scopeId: string }): UserMembership {
    return { roleKey: m.roleKey, scopeType: m.scopeType as ScopeType, scopeId: m.scopeId };
  }
```

  Y `toListItem` (H13 — el include de memberships ya existe en `list`/`getById`):

```typescript
  private toListItem(user: UserWithMemberships): UserListItem {
    return {
      id: user.id,
      firstName: user.firstName,
      secondName: user.secondName,
      lastName: user.lastName,
      secondLastName: user.secondLastName,
      email: user.email,
      status: user.status,
      isClientUser: user.isClientUser,
      roleKeys: this.collectRoleKeys(user.memberships.map((m) => m.roleKey)),
      memberships: user.memberships.map((m) => this.toUserMembership(m)),
      createdAt: user.createdAt.toISOString(),
    };
  }
```

  Nota `collectRoleKeys`: con `RoleKey = string` (Fase 1), el filtro `isRoleKey` contra la unión cerrada dejaría afuera a los roles custom (`c_*`). Si la Fase 1 ya relajó `collectRoleKeys` a "dedupe sin filtrar", no tocar; si sigue filtrando por la unión cerrada, cambiarlo aquí a dedupe simple preservando orden.

  Actualizar TODAS las instanciaciones existentes de `new UsersService(...)` en `test/modules/users.service.spec.ts` (los describes de `create`/`importBatch`) agregando un 4º argumento (stub vacío, esos tests no llaman a `assignRoleScoped`):

```typescript
// helper agregado al spec, reusado por los tests viejos:
function buildRolesStub(): RolesService {
  return {} as unknown as RolesService;
}
// y reemplazar cada `new UsersService(prisma, fga.fga, buildStorageMock())`
// por `new UsersService(prisma, fga.fga, buildStorageMock(), buildRolesStub())`.
```

  Actualizar `users.module.ts` para importar `RolesModule` (**Fase 2** — ya existe cuando corre esta fase; la Task 2.13 lo registró en `AppModule`). Verificar que `RolesModule` tenga `exports: [RolesService]`; si Fase 2 no lo exportó, agregar el export en esta task:

```typescript
import { RolesModule } from '../roles/roles.module';
// en @Module: imports: [RolesModule, ...los imports existentes]
```

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.service.spec.ts test/modules/dto/assign-role-scoped.dto.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/users/dto/assign-role-scoped.dto.ts nodes/backend-central/src/modules/users/users.service.ts nodes/backend-central/src/modules/users/users.types.ts nodes/backend-central/src/modules/users/users.module.ts nodes/backend-central/test/modules/users.service.spec.ts nodes/backend-central/test/modules/dto/assign-role-scoped.dto.spec.ts
  git commit -m "feat(users): assignRoleScoped/removeRoleScoped con respuesta extendida, rollback FGA y memberships en UserListItem"
  ```

---

### Task 3.7: Endpoints `POST /users/:id/roles` y `DELETE /users/:id/roles` (query) en `UsersController`

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/src/modules/users/users.controller.ts`
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/users.controller.spec.ts` (nuevo — hoy no hay spec de controller; seguir el patrón de `test/authz/permissions.guard.spec.ts` para invocar el handler directo sin bootstrap de Nest)

El SPINE reemplaza `POST /users/:id/roles` (body `AssignRoleDto`, org-only) por el nuevo endpoint con `AssignRoleScopedDto`/`AssignRoleInput`, y agrega `DELETE /users/:id/roles?roleKey=&scopeType=&scopeId=` (querystring). Ambos devuelven la `UserRolesResponse` EXTENDIDA (enmienda A4) para que la UI actualice roles y memberships sin re-fetch.

- [ ] 1. Escribir el test que falla:

```typescript
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { UsersService } from '../../src/modules/users/users.service';
import type { UserRolesResponse } from '../../src/modules/users/users.types';
import { UsersController } from '../../src/modules/users/users.controller';
import { AssignRoleScopedDto } from '../../src/modules/users/dto/assign-role-scoped.dto';

const response: UserRolesResponse = {
  id: 'u1',
  roleKeys: [],
  memberships: [{ roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' }],
};

function buildService(): {
  service: UsersService;
  assignRoleScoped: ReturnType<typeof vi.fn>;
  removeRoleScoped: ReturnType<typeof vi.fn>;
} {
  const assignRoleScoped = vi.fn(() => Promise.resolve(response));
  const removeRoleScoped = vi.fn(() => Promise.resolve(response));
  return {
    service: { assignRoleScoped, removeRoleScoped } as unknown as UsersService,
    assignRoleScoped,
    removeRoleScoped,
  };
}

describe('UsersController — asignación por scope', () => {
  it('POST /users/:id/roles delega en usersService.assignRoleScoped(userId, dto) y devuelve la respuesta extendida', async () => {
    const { service, assignRoleScoped } = buildService();
    const controller = new UsersController(service);
    const dto: AssignRoleScopedDto = { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' };

    const result = await controller.assignRoleScoped('u1', dto);

    expect(assignRoleScoped).toHaveBeenCalledWith('u1', dto);
    expect(result).toBe(response);
  });

  it('DELETE /users/:id/roles delega en usersService.removeRoleScoped(userId, query) y devuelve la respuesta extendida', async () => {
    const { service, removeRoleScoped } = buildService();
    const controller = new UsersController(service);

    const result = await controller.removeRoleScoped('u1', 'c_auditor', 'PROJECT', 'p1');

    expect(removeRoleScoped).toHaveBeenCalledWith('u1', {
      roleKey: 'c_auditor',
      scopeType: 'PROJECT',
      scopeId: 'p1',
    });
    expect(result).toBe(response);
  });
});
```

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.controller.spec.ts
  ```
- [ ] 3. Implementación mínima. Agregar a `users.controller.ts`:

```typescript
import { AssignRoleScopedDto } from './dto/assign-role-scoped.dto';
import type { AssignRoleInput, ScopeType } from '@gmt-platform/contracts';
import type { UserRolesResponse } from './users.types';

  /** Asigna un rol (sistema o custom) a un usuario en un scope arbitrario (§ Fase 3 matriz RBAC). */
  @Post(':id/roles')
  @RequirePermission('can_manage_users', { type: 'organization', id: ORG_ID })
  assignRoleScoped(
    @Param('id') id: string,
    @Body() dto: AssignRoleScopedDto,
  ): Promise<UserRolesResponse> {
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
  ): Promise<UserRolesResponse> {
    const input: AssignRoleInput = { roleKey, scopeType, scopeId };
    return this.usersService.removeRoleScoped(id, input);
  }
```

  Nota de colisión de rutas: para evitar dos handlers en el mismo `POST :id/roles`, este paso ELIMINA el método legacy `assignRole` (y su uso de `AssignRoleDto`) y lo reemplaza por `assignRoleScoped`. El legacy `removeRole` con `:roleKey` en el path (`DELETE :id/roles/:roleKey`) se mantiene intacto porque su path es distinto (`/roles/:roleKey` vs `/roles`), así ambos coexisten. Los call-sites del front que dependían del `POST :id/roles` legacy con `{roleKey}` sin scope se migran en la **Fase 5** (enmienda A15) — anotarlo como ítem de migración, no bloquea esta task de backend.

- [ ] 4. Correr y ver que pasa:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/users.controller.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/src/modules/users/users.controller.ts nodes/backend-central/test/modules/users.controller.spec.ts
  git commit -m "feat(users): endpoints POST/DELETE /users/:id/roles con scope (AssignRoleInput, respuesta extendida)"
  ```

---

### Task 3.8: Test end-to-end-ish del flujo completo (assign custom role → resync tras updateRole → remove) con el mapeo REAL del seed

**Files:**
- Test: `C:/Users/juana/GMT Link/nodes/backend-central/test/modules/rbac-scoped-flow.spec.ts` (nuevo)

Test de integración liviano (sin HTTP real, sin BD real) que encadena `RolesService` (Fase 2), `UsersService` y `FgaService` REALES — solo Prisma y el cliente FGA son fakes. **Enmienda A16:** el fixture usa el mapeo permiso→relación REAL de `prisma/seed.ts` (verificado): `task:read → can_view`, `project:read → can_view`, `task:create → can_create_task`, `task:assign → can_assign_task`. Ojo: `can_view` es COMPARTIDA por 5 permisos del seed — el flujo aprovecha eso para verificar el dedupe.

Secuencia: asignar rol custom (grants `task:read` + `project:read` + `task:assign`) a un usuario en un proyecto → tuplas `can_view` (UNA sola, dedupe) + `can_assign_task` → `updateRole` deja solo `task:read` (dispara `resyncRole`) → FGA conserva `can_view` y borra `can_assign_task` → remover la asignación limpia `can_view`.

- [ ] 1. Escribir el test que falla:

```typescript
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { FgaService } from '../../src/fga/fga.service';
import { RolesService } from '../../src/modules/roles/roles.service';
import { UsersService } from '../../src/modules/users/users.service';
import type { FgaClientLike, TupleKey } from '../../src/fga/fga.types';
import type { StorageService } from '../../src/common/storage/storage.service';

/** Catálogo con el mapeo permiso→relación REAL del seed (prisma/seed.ts, A16). */
const PERMS = [
  { id: 'perm-project:read', key: 'project:read', label: 'Ver proyectos', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { id: 'perm-task:read', key: 'task:read', label: 'Ver tareas / backlog', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { id: 'perm-task:create', key: 'task:create', label: 'Crear tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_create_task', scopeable: true },
  { id: 'perm-task:assign', key: 'task:assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task', scopeable: true },
] as const;

type PermRow = (typeof PERMS)[number];

function permByKey(key: string): PermRow | undefined {
  return PERMS.find((p) => p.key === key);
}
function permById(id: string): PermRow | undefined {
  return PERMS.find((p) => p.id === id);
}

interface GrantRow {
  scope: string;
  permission: { key: string; kind: string; fgaRelation: string | null };
}

/**
 * Estado compartido en memoria: simula la parte de Postgres relevante a este
 * flujo (Role/RolePermission/Permission/Membership/Project/User) para poder
 * verificar el efecto de encadenar RolesService + UsersService + FgaService
 * reales (no mocks de esas 3 clases — solo Prisma y el cliente FGA son fakes).
 */
function buildInMemoryPrisma() {
  const roleRow: {
    id: string;
    key: string;
    label: string;
    description: string | null;
    isSystem: boolean;
    createdById: string | null;
    permissions: GrantRow[];
  } = {
    id: 'role-1',
    key: 'c_auditor',
    label: 'Auditor',
    description: null,
    isSystem: false,
    createdById: null,
    permissions: [
      { scope: 'PROJECT', permission: { key: 'task:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      { scope: 'PROJECT', permission: { key: 'project:read', kind: 'STRUCTURAL', fgaRelation: 'can_view' } },
      { scope: 'PROJECT', permission: { key: 'task:assign', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task' } },
    ],
  };
  const memberships: Array<{ id: string; userId: string; roleKey: string; scopeType: string; scopeId: string }> = [];

  const prisma = {
    user: { findUnique: vi.fn(() => Promise.resolve({ id: 'u1' })) },
    project: { findUnique: vi.fn(() => Promise.resolve({ id: 'p1' })) },
    role: {
      findUnique: vi.fn(() => Promise.resolve(roleRow)),
      // Unión multi-rol (Task 3.3): no hay otros roles custom en este flujo.
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve(roleRow)),
    },
    permission: {
      findMany: vi.fn((args: { where?: { key?: { in?: string[] } } }) => {
        const keys = args.where?.key?.in;
        const rows = keys === undefined ? [...PERMS] : PERMS.filter((p) => keys.includes(p.key));
        return Promise.resolve(rows);
      }),
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
      // Soporta los tres shapes de where usados por el código real:
      //  - { roleKey: 'c_auditor' }                       → resyncRole
      //  - { userId, scopeType, scopeId, roleKey: {not} } → unión multi-rol
      //  - { userId }                                     → currentRoles
      findMany: vi.fn((args: { where: Record<string, unknown> }) => {
        const w = args.where as {
          roleKey?: string | { not: string };
          userId?: string;
          scopeType?: string;
          scopeId?: string;
        };
        return Promise.resolve(
          memberships.filter(
            (m) =>
              (typeof w.roleKey !== 'string' || m.roleKey === w.roleKey) &&
              (typeof w.roleKey !== 'object' || w.roleKey === null || m.roleKey !== w.roleKey.not) &&
              (w.userId === undefined || m.userId === w.userId) &&
              (w.scopeType === undefined || m.scopeType === w.scopeType) &&
              (w.scopeId === undefined || m.scopeId === w.scopeId),
          ),
        );
      }),
    },
    rolePermission: {
      deleteMany: vi.fn(() => {
        roleRow.permissions = [];
        return Promise.resolve(undefined);
      }),
      createMany: vi.fn((args: { data: Array<{ roleId: string; permissionId: string; scope: string }> }) => {
        roleRow.permissions = args.data.map((d) => {
          const perm = permById(d.permissionId) ?? permByKey(d.permissionId);
          return {
            scope: d.scope,
            permission: {
              key: perm?.key ?? d.permissionId,
              kind: perm?.kind ?? 'STRUCTURAL',
              fgaRelation: perm?.fgaRelation ?? null,
            },
          };
        });
        return Promise.resolve(undefined);
      }),
    },
    $transaction: vi.fn(<T>(cb: (tx: unknown) => Promise<T>) => cb(prisma)),
  };
  return { prisma: prisma as unknown as PrismaService, roleRow, memberships };
}

function buildFgaClient(): { client: FgaClientLike; writes: TupleKey[]; deletes: TupleKey[] } {
  const writes: TupleKey[] = [];
  const deletes: TupleKey[] = [];
  const client: FgaClientLike = {
    check: vi.fn(() => Promise.resolve({ allowed: false })),
    write: vi.fn((body: { writes?: TupleKey[]; deletes?: TupleKey[] }) => {
      if (body.writes) writes.push(...body.writes);
      if (body.deletes) deletes.push(...body.deletes);
      return Promise.resolve(undefined);
    }),
  };
  return { client, writes, deletes };
}

describe('Flujo: rol custom → asignación por scope → resync → remove (mapeo real del seed)', () => {
  it('asigna con dedupe de can_view, resincroniza tras perder task:assign, y remueve limpiando can_view', async () => {
    const { prisma } = buildInMemoryPrisma();
    const { client, writes, deletes } = buildFgaClient();
    const fga = new FgaService(client, prisma);
    const roles = new RolesService(prisma, fga);
    const storage = { save: vi.fn() } as unknown as StorageService;
    const users = new UsersService(prisma, fga, storage, roles);

    // 1) Asignar el rol custom a u1 en el proyecto p1.
    //    3 grants pero solo 2 tuplas: task:read y project:read comparten can_view (dedupe A5).
    await users.assignRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' });
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });
    expect(writes).toHaveLength(2);

    writes.length = 0;
    deletes.length = 0;

    // 2) El rol pierde 'project:read' y 'task:assign' (updateRole de Fase 2 → resyncRole real de Task 3.4).
    await roles.updateRole('c_auditor', {
      grants: [{ permissionKey: 'task:read', scope: 'PROJECT' }],
    });
    // can_view sigue deseada (task:read la sostiene) → se re-escribe tolerante, nunca se borra.
    expect(writes).toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_assign_task', object: 'project:p1' });
    expect(deletes).not.toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });

    writes.length = 0;
    deletes.length = 0;

    // 3) Remover la asignación: borra la Membership y limpia la tupla vigente (can_view).
    await users.removeRoleScoped('u1', { roleKey: 'c_auditor', scopeType: 'PROJECT', scopeId: 'p1' });
    expect(deletes).toContainEqual({ user: 'user:u1', relation: 'can_view', object: 'project:p1' });
  });
});
```

- [ ] 2. Correr y ver que falla:
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/modules/rbac-scoped-flow.spec.ts
  ```
- [ ] 3. Este test NO requiere código nuevo si las Tasks 3.1–3.7 (y la Fase 2) están implementadas correctamente — es puramente de verificación de integración. Si falla, apunta a un defecto de integración entre `FgaService`, `RolesService` y `UsersService` (p. ej. `RolesService.getRole` no expone `allowedScopeTypes` con el shape esperado, `permission.findMany` en `replaceGrants` no resuelve bien los ids, o el fixture no cubre un campo que `getRole` de Fase 2 sí lee — en ese caso extender el `roleRow` del fixture, no la lógica). No agregar lógica "solo para pasar este test": si hace falta un cambio de producto, es porque una task anterior quedó incompleta respecto al SPINE.
- [ ] 4. Correr y ver que pasa (junto con toda la suite de la fase, para asegurar que no se rompió nada):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/fga.service.spec.ts test/fga-model.spec.ts test/modules/roles.service.spec.ts test/modules/users.service.spec.ts test/modules/users.controller.spec.ts test/modules/rbac-scoped-flow.spec.ts test/modules/composable-permissions.spec.ts test/modules/dto/assign-role-scoped.dto.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
- [ ] 5. Commit:
  ```bash
  git add nodes/backend-central/test/modules/rbac-scoped-flow.spec.ts
  git commit -m "test(rbac): flujo integrado assign→resync→remove con mapeo real del seed"
  ```

---

### Task 3.9: Spec de `PermissionService` — grants FUNCTIONAL de roles custom + "scope más fuerte gana" (enmienda A14b)

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/backend-central/test/authz/permission.service.spec.ts` (extiende el spec EXISTENTE; mismo estilo `buildPrisma`/`buildFga` que ya usa)

`PermissionService.can()` resuelve los grants por `membership.roleKey` (string) contra `RolePermission`, sin distinguir roles del sistema de roles custom — por diseño NO requiere cambios para la matriz RBAC (spec §7: "Los FUNCTIONAL se resuelven en Postgres, sin cambios"). Esta task fija ese contrato con tests de REGRESIÓN: un grant FUNCTIONAL de un rol custom pasa `can()`, y "scope más fuerte gana" sigue funcionando al mezclar rol custom + rol del sistema. **Deben pasar EN VERDE sin tocar `permission.service.ts`**; si alguno falla, hay una regresión introducida por Fase 2/3 que corregir antes de commitear.

- [ ] 1. Agregar al final de `test/authz/permission.service.spec.ts`:

```typescript
describe('PermissionService — roles custom (matriz RBAC, §12)', () => {
  it('un grant FUNCTIONAL de un rol custom pasa can() (GLOBAL → allow / filtro none)', async () => {
    const { prisma } = buildPrisma({
      memberships: [{ roleKey: 'c_reporteria', scopeType: 'ORGANIZATION', scopeId: 'gmt' }],
      grants: [{ scope: 'GLOBAL' }],
      permission: { kind: 'FUNCTIONAL', fgaRelation: null },
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.can('u1', 'finance:print:batch')).toEqual({
      effect: 'allow',
      filter: { kind: 'none' },
    });
  });

  it('grant FUNCTIONAL PROJECT de un rol custom: allow en el proyecto asignado, deny fuera', async () => {
    const { prisma } = buildPrisma({
      memberships: [{ roleKey: 'c_reporteria', scopeType: 'PROJECT', scopeId: 'p1' }],
      grants: [{ scope: 'PROJECT' }],
      permission: { kind: 'FUNCTIONAL', fgaRelation: null },
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect((await svc.can('u1', 'task:time:read', { projectId: 'p1' })).effect).toBe('allow');
    expect((await svc.can('u1', 'task:time:read', { projectId: 'p2' })).effect).toBe('deny');
  });

  it('scope más fuerte gana también mezclando rol custom y rol del sistema (GLOBAL > PROJECT)', async () => {
    const { prisma } = buildPrisma({
      memberships: [
        { roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' },
        { roleKey: 'c_reporteria', scopeType: 'ORGANIZATION', scopeId: 'gmt' },
      ],
      grants: [{ scope: 'PROJECT' }, { scope: 'GLOBAL' }],
    });
    const svc = new PermissionService(prisma, buildFga().fga, []);
    expect(await svc.scopeFilter('u1', 'task:time:read')).toEqual({ kind: 'none' });
  });
});
```

- [ ] 2. Correr — deben pasar EN VERDE directo (son de regresión; el mock de `rolePermission.findMany` del spec ya ignora el `where`, así que los roleKeys custom fluyen igual que los del sistema):
  ```powershell
  pnpm --filter "@gmt-platform/backend-central" exec vitest run test/authz/permission.service.spec.ts
  pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
  ```
  Si alguno falla: es una regresión real de `PermissionService` (o un cambio de firma de Fase 2/3 que lo rompió) — corregir la regresión SIN debilitar los tests existentes del spec.
- [ ] 3. Commit:
  ```bash
  git add nodes/backend-central/test/authz/permission.service.spec.ts
  git commit -m "test(authz): PermissionService cubre grants FUNCTIONAL de roles custom y scope mas fuerte"
  ```

---

## Fase 4: `canManageRoles` en `/auth/me` + verificación de registro de `RolesModule`

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

### Task 4.3: Verificación — `RolesModule` ya registrado en `AppModule` (hecho en Fase 2, Task 2.13)

**Files:** ninguno (solo verificación en verde; sin "test que falla", sin archivos nuevos, sin commit)

> El registro de `RolesModule` en `AppModule` se hizo en la **Fase 2, Task 2.13** (junto con la creación de `roles.module.ts`). Esta task solo confirma que ese registro sigue vigente antes de continuar. Si alguno de los pasos falla, el problema está en la Fase 2 — no lo "arregles" acá: volvé a la Task 2.13.

- [ ] 1. Confirmá que `RolesModule` está importado y registrado en `C:/Users/juana/GMT Link/nodes/backend-central/src/app.module.ts` (se esperan **2** coincidencias: la línea `import { RolesModule } from './modules/roles/roles.module';` y la entrada `RolesModule,` dentro del arreglo `imports`, después de `UsersModule`):
```powershell
Select-String -Path "C:/Users/juana/GMT Link/nodes/backend-central/src/app.module.ts" -Pattern "RolesModule"
```

- [ ] 2. Typecheck en verde (confirma que el import resuelve y el módulo compila):
```powershell
pnpm --filter "@gmt-platform/backend-central" exec tsc --noEmit
```

- [ ] 3. Corré en verde los specs de roles que dejó la Fase 2 (controller + service; cubren el wiring del módulo). El argumento posicional de vitest filtra por substring de ruta, así que matchea tanto `test/modules/roles.*.spec.ts` como un eventual `test/modules/roles/*.spec.ts`:
```powershell
pnpm --filter "@gmt-platform/backend-central" exec vitest run roles
```

- [ ] 4. No hay commit: esta task no modifica archivos. Si los pasos 1–3 pasan, seguí a la Task 4.4.

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

### Task 5.1: Verificación — los tipos de contracts ya existen (no-op, enmienda A8)

Los tipos frontend-visibles (`PermissionKind`, `FgaObjectType`, `PermissionCatalogItem`, `PermissionCatalogGroup`, `RoleGrant`, `RoleDetail`, `CreateRoleInput`, `UpdateRoleInput`, `AssignRoleInput`) se crearon en la **Fase 1 (Task 1.1)**, junto con `packages/contracts/test/index.spec.ts` y `vitest.config.ts` (include: `test/**/*.spec.ts`). Las fases posteriores sumaron `UserMembership` (enmienda A4) y `CloneRoleResponse` (enmienda A7). Esta task NO crea archivos nuevos ni re-implementa tipos: es solo **verificación en verde** (su paso "test que falla" queda eliminado por A8).

**Files:** ninguno (solo comandos de verificación)

- [ ] Confirmar que `C:/Users/juana/GMT Link/packages/contracts/src/index.ts` exporta: `PermissionKind`, `FgaObjectType`, `PermissionCatalogItem`, `PermissionCatalogGroup`, `RoleGrant`, `RoleDetail`, `CreateRoleInput`, `UpdateRoleInput`, `AssignRoleInput`, `UserMembership`, `CloneRoleResponse`; que `RoleKey` es `string` (unión abierta) y que `ROLE_KEYS` sigue exportado para labels/orden de roles del sistema.
- [ ] Chequeo de tipos: `pnpm --filter "@gmt-platform/contracts" exec tsc --noEmit`
- [ ] Correr el spec canónico creado en la Task 1.1 (único archivo de tests de contracts — NO crear otros): `pnpm --filter "@gmt-platform/contracts" exec vitest run`
- [ ] Si falta algún export, NO agregarlo aquí: la fase que debía crearlo (1-4) quedó incompleta — volver a esa fase y completarla allí.
- [ ] Sin commit (esta task no cambia archivos).

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
import type { CloneRoleResponse, PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

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

  it('cloneRole — POST /roles/:key/clone devuelve CloneRoleResponse (role + omittedPermissionKeys)', async () => {
    const cloned: CloneRoleResponse = {
      role: { ...roleDetail, key: 'c_inspector_2', label: 'Inspector (copia)' },
      omittedPermissionKeys: ['document:review'],
    };
    const fetchMock = vi.fn().mockResolvedValue(res(cloned));
    vi.stubGlobal('fetch', fetchMock);

    const result = await cloneRole('c_inspector', 'Inspector (copia)');

    expect(result).toEqual(cloned);
    expect(result.omittedPermissionKeys).toEqual(['document:review']);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/roles/c_inspector/clone');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ label: 'Inspector (copia)' });
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- api.test`
- [ ] Implementación mínima — agregar a `nodes/web/src/lib/api.ts`:

Actualizar el import de contracts (el archivo real ya tiene un único bloque `import type { … } from '@gmt-platform/contracts'` con `DirectoryEntry`, `DirectoryEntryExtended`, `ProfileMe`, `RoleKey`, `UpdateProfileInput`, `UserStatus` — sumarle los tipos nuevos):

```ts
import type {
  CloneRoleResponse,
  CreateRoleInput,
  DirectoryEntry,
  DirectoryEntryExtended,
  PermissionCatalogGroup,
  ProfileMe,
  RoleDetail,
  RoleKey,
  UpdateProfileInput,
  UpdateRoleInput,
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

/**
 * `POST /roles/:key/clone` — clona un rol (incluye del sistema) a uno
 * personalizado nuevo. El backend filtra los grants NO componibles y los
 * reporta en `omittedPermissionKeys` (enmienda A7 — así clonar roles del
 * sistema como qa/operator/viewer/client_ito funciona; spec §6.2/§13.4).
 */
export function cloneRole(key: string, label: string): Promise<CloneRoleResponse> {
  return request<CloneRoleResponse>(`/roles/${encodeURIComponent(key)}/clone`, {
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

### Task 5.4: `api.ts` — `UserRolesResponse` extendida con `memberships` + `UserListItem.memberships` (aditivo, build verde)

Enmienda A4: `POST /users/:id/roles` y `DELETE /users/:id/roles` devuelven la `UserRolesResponse` EXTENDIDA `{ id, roleKeys, memberships }`, y `UserListItem` gana `memberships: UserMembership[]` (el include de memberships ya existe en `UsersService.toListItem` del backend). Esta task es **solo aditiva** (enmienda A15): NO toca la firma legacy `assignUserRole(id, roleKey)` / `removeUserRole(id, roleKey)` — el switch atómico a la firma con alcance, junto con TODOS sus call-sites (`use-users.ts`, `roles-dialog.tsx`, `role-chips.tsx`, `pages/usuarios/index.tsx`), ocurre en la Task 5.8. Así **cada commit deja el build web compilando**.

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.ts`
- Test: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.test.ts`

- [ ] Escribir el test que falla — ojo: la señal de fallo acá es de **tipos** (vitest transpila con esbuild y no chequea tipos), así que el "ver que falla" se hace con `tsc --noEmit`:

```ts
// agregar a nodes/web/src/lib/api.test.ts
import { listUsers } from '@/lib/api';
import type { UserListItem, UserRolesResponse } from '@/lib/api';
import type { UserMembership } from '@gmt-platform/contracts';

describe('api — UserRolesResponse/UserListItem extendidos con memberships (A4)', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockReturnValue('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  const membership: UserMembership = { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' };

  it('UserRolesResponse incluye memberships[] y UserListItem las trae del backend', async () => {
    const rolesResponse: UserRolesResponse = {
      id: 'u1',
      roleKeys: ['c_inspector'],
      memberships: [membership],
    };
    expect(rolesResponse.memberships).toEqual([membership]);

    const row: UserListItem = {
      id: 'u1',
      firstName: 'Ada',
      secondName: null,
      lastName: 'Lovelace',
      secondLastName: null,
      email: 'ada@gmt.cl',
      status: 'ACTIVE',
      isClientUser: false,
      roleKeys: ['c_inspector'],
      memberships: [membership],
      createdAt: new Date().toISOString(),
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res([row])));

    const result = await listUsers();

    expect(result[0]?.memberships).toEqual([membership]);
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" exec tsc --noEmit` (TS2353: `memberships` no existe en `UserRolesResponse` ni en `UserListItem`)
- [ ] Implementación mínima — en `nodes/web/src/lib/api.ts`:

Sumar `AssignRoleInput` y `UserMembership` al bloque `import type { … } from '@gmt-platform/contracts'` existente (`CloneRoleResponse` ya se sumó en la Task 5.3) y re-exportarlos para los consumidores del front (enmienda A15: los tipos viven en `@gmt-platform/contracts`; `api.ts` solo re-exporta):

```ts
export type { AssignRoleInput, CloneRoleResponse, UserMembership } from '@gmt-platform/contracts';
```

Extender los dos tipos existentes (sin tocar ninguna función):

```ts
/** Respuesta de asignar/quitar un rol: id, roleKeys y memberships resultantes (A4). */
export interface UserRolesResponse {
  id: string;
  roleKeys: RoleKey[];
  memberships: UserMembership[];
}
```

```ts
/** Fila del directorio de usuarios (`GET /users`). */
export interface UserListItem {
  id: string;
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  email: string;
  status: UserStatus;
  isClientUser: boolean;
  roleKeys: RoleKey[];
  /** Membresías (rol + alcance) del usuario — chips por membership (H13). */
  memberships: UserMembership[];
  createdAt: string;
}
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- api.test` **y** `pnpm --filter "@gmt-platform/web" exec tsc --noEmit` (los cambios son aditivos: ningún archivo de la web construye estos literales fuera de los tests nuevos, el build queda verde)
- [ ] Commit:
```bash
git add nodes/web/src/lib/api.ts nodes/web/src/lib/api.test.ts && git commit -m "feat(web/api): UserRolesResponse y UserListItem con memberships (A4)"
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
import type { CloneRoleResponse, PermissionCatalogGroup, RoleDetail } from '@gmt-platform/contracts';

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

  it('cloneRole delega en la API y devuelve el CloneRoleResponse (role + omittedPermissionKeys)', async () => {
    const cloned: CloneRoleResponse = {
      role: { ...customRole, key: 'c_inspector_2', label: 'Inspector (copia)' },
      omittedPermissionKeys: ['document:review'],
    };
    mockCloneRole.mockResolvedValue(cloned);
    const { result } = renderHook(() => useRoles());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: CloneRoleResponse | undefined;
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
import type {
  CloneRoleResponse,
  CreateRoleInput,
  PermissionCatalogGroup,
  RoleDetail,
  UpdateRoleInput,
} from '@gmt-platform/contracts';
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
  /**
   * Clona cualquier rol (incluso del sistema) a uno personalizado nuevo y
   * refresca la lista. Devuelve el `CloneRoleResponse` completo para que la UI
   * muestre los `omittedPermissionKeys` (grants no componibles filtrados — A7).
   */
  cloneRole: (key: string, label: string) => Promise<CloneRoleResponse>;
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
    async (key: string, label: string): Promise<CloneRoleResponse> => {
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

Notas de enmiendas: (A6) "Nuevo rol" crea con `grants: []` — ahora es un body válido (el DTO de `createRole` no exige `ArrayMinSize`), sin ningún workaround: el flujo es **crear vacío → editar permisos** en el editor. (A7) clonar consume `CloneRoleResponse { role, omittedPermissionKeys }` y muestra un aviso (toast) listando los permisos no componibles que el backend omitió.

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

const { mockUseRoles, mockToast } = vi.hoisted(() => ({
  mockUseRoles: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/hooks/use-roles', () => ({ useRoles: mockUseRoles }));
vi.mock('sonner', () => ({ toast: mockToast }));

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
    cloneRole: vi
      .fn()
      .mockResolvedValue({ role: { ...customRole, key: 'c_inspector_2' }, omittedPermissionKeys: [] }),
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

  it('crear desde "Nuevo rol" llama createRole con grants: [] (flujo crear→editar, A6)', async () => {
    const hook = baseHook();
    mockUseRoles.mockReturnValue(hook);
    render(<RolesPage />);

    fireEvent.click(screen.getByRole('button', { name: /Nuevo rol/i }));
    fireEvent.change(screen.getByLabelText(/Nombre/i), { target: { value: 'Inspector terreno' } });
    fireEvent.click(screen.getByRole('button', { name: /^Crear$/i }));

    await waitFor(() =>
      expect(hook.createRole).toHaveBeenCalledWith({ label: 'Inspector terreno', grants: [] }),
    );
  });

  it('clonar muestra un aviso listando los permisos omitidos (A7)', async () => {
    const hook = baseHook({
      getRole: vi.fn().mockResolvedValue(systemRole),
      cloneRole: vi.fn().mockResolvedValue({
        role: { ...customRole, key: 'c_administrador_de_organizacion_copia' },
        omittedPermissionKeys: ['directory:view:extended', 'document:review'],
      }),
    });
    mockUseRoles.mockReturnValue(hook);
    render(<RolesPage />);

    fireEvent.click(screen.getByText('Administrador de organización'));
    await waitFor(() => screen.getByRole('button', { name: /Clonar/i }));
    fireEvent.click(screen.getByRole('button', { name: /Clonar/i }));

    await waitFor(() => expect(hook.cloneRole).toHaveBeenCalled());
    expect(mockToast.warning).toHaveBeenCalledWith(expect.stringContaining('directory:view:extended'));
    expect(mockToast.warning).toHaveBeenCalledWith(expect.stringContaining('document:review'));
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
      // A7: el backend filtra los grants NO componibles al clonar y los reporta.
      const { role: cloned, omittedPermissionKeys } = await cloneRole(key, label);
      setSelected(cloned);
      if (omittedPermissionKeys.length > 0) {
        toast.warning(
          `Rol clonado sin ${omittedPermissionKeys.length} permiso(s) no componible(s): ${omittedPermissionKeys.join(', ')}.`,
        );
      } else {
        toast.success('Rol clonado. Ya puedes editarlo.');
      }
    } catch {
      toast.error('No se pudo clonar el rol.');
    }
  }

  async function handleCreate(label: string): Promise<void> {
    // A6: grants: [] es un body válido (DTO sin ArrayMinSize) — flujo crear→editar:
    // se crea el rol vacío y se abre el editor para componer sus permisos.
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

### Task 5.8: Switch atómico a asignación por alcance — `api.ts` + `use-users` + `roles-dialog` + chips por membership

Este task hace el **switch atómico** (enmienda A15): reemplaza la firma legacy de `assignUserRole(id, roleKey)`/`removeUserRole(id, roleKey)` en `api.ts` Y migra en el MISMO commit todos sus call-sites (`use-users.ts`, `roles-dialog.tsx`, `pages/usuarios/index.tsx`), de modo que el build web compile al commitear. Además (H13): los chips de roles en `/usuarios` — tanto en la columna "Roles" (`role-chips.tsx`) como en el diálogo — se renderizan **por membership** (rol + badge de alcance: "Organización" / "Proyecto X"), y el quitar pasa el `{roleKey, scopeType, scopeId}` EXACTO de esa membership (nada hardcodeado a `ORGANIZATION`/`gmt` en el remove). Las memberships vienen de `UserListItem.memberships` y de la `UserRolesResponse` extendida (A4, Task 5.4). `AssignRoleInput`/`UserMembership` se importan desde `@gmt-platform/contracts` (A15; `api.ts` ya los re-exporta desde la Task 5.4).

**Files:**
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.ts` (reemplaza la firma de `assignUserRole`/`removeUserRole`)
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/lib/api.test.ts` (tests de la firma nueva)
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/hooks/use-users.ts` (actualizar `assignRole`/`removeRole` a la firma nueva)
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/pages/usuarios/roles-dialog.tsx` (reescritura: chips por membership + alcance)
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/pages/usuarios/role-chips.tsx` (chips por membership con badge de alcance)
- Modify: `C:/Users/juana/GMT Link/nodes/web/src/pages/usuarios/index.tsx` (columna Roles + callbacks del diálogo)
- Test: `C:/Users/juana/GMT Link/nodes/web/src/pages/usuarios/roles-dialog.test.tsx` (crear)

- [ ] Escribir los tests que fallan — primero la firma nueva en `api.test.ts` (sumar `AssignRoleInput` al `import type` de `@gmt-platform/contracts` agregado en la Task 5.4):

```ts
// agregar a nodes/web/src/lib/api.test.ts
import { assignUserRole, removeUserRole } from '@/lib/api';

describe('api — asignación de roles por alcance (switch atómico, Task 5.8)', () => {
  beforeEach(() => {
    mockGetToken.mockReset();
    mockGetToken.mockReturnValue('tok');
  });
  afterEach(() => vi.unstubAllGlobals());

  const userRoles: UserRolesResponse = {
    id: 'u1',
    roleKeys: ['c_inspector'],
    memberships: [{ roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' }],
  };

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

  it('removeUserRole — DELETE /users/:id/roles?roleKey=&scopeType=&scopeId= (membership exacta)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ...userRoles, roleKeys: [], memberships: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await removeUserRole('u1', { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' });

    expect(result.memberships).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'http://localhost:3001/users/u1/roles?roleKey=c_inspector&scopeType=PROJECT&scopeId=p1',
    );
    expect(init.method).toBe('DELETE');
  });
});
```

Y después el test del diálogo (archivo nuevo):

```tsx
// nodes/web/src/pages/usuarios/roles-dialog.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RoleDetail, UserMembership } from '@gmt-platform/contracts';

const { mockListRoles, mockListProjects } = vi.hoisted(() => ({
  mockListRoles: vi.fn(),
  mockListProjects: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ listRoles: mockListRoles, listProjects: mockListProjects }));

import { RolesDialog } from '@/pages/usuarios/roles-dialog';
import type { UserListItem, UserRolesResponse } from '@/lib/api';

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

const orgMembership: UserMembership = { roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' };
const projMembership: UserMembership = { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' };

const user: UserListItem = {
  id: 'u1',
  firstName: 'Ada',
  secondName: null,
  lastName: 'Lovelace',
  secondLastName: null,
  email: 'ada@gmt.cl',
  status: 'ACTIVE',
  isClientUser: false,
  roleKeys: ['org_admin', 'c_inspector'],
  memberships: [orgMembership, projMembership],
  createdAt: new Date().toISOString(),
};

const emptyUser: UserListItem = { ...user, id: 'u2', roleKeys: [], memberships: [] };

describe('RolesDialog — chips por membership + asignación con alcance', () => {
  beforeEach(() => {
    mockListRoles.mockReset().mockResolvedValue([orgRole, projectRole]);
    mockListProjects.mockReset().mockResolvedValue([{ id: 'p1', code: 'P-001', name: 'Proyecto Uno' }]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('renderiza un chip POR MEMBERSHIP con badge de alcance (Organización / Proyecto X)', async () => {
    render(
      <RolesDialog
        user={user}
        onOpenChange={vi.fn()}
        onAssign={vi.fn()}
        onRemove={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    // Las etiquetas de rol aparecen cuando listRoles resuelve; el nombre del
    // proyecto cuando listProjects resuelve.
    expect(await screen.findByText('Administrador de organización')).toBeInTheDocument();
    expect(screen.getByText('Organización')).toBeInTheDocument();
    expect(await screen.findByText('P-001 — Proyecto Uno')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Quitar rol Inspector \(P-001 — Proyecto Uno\)/i }),
    ).toBeInTheDocument();
  });

  it('quitar pasa {roleKey, scopeType, scopeId} EXACTOS de la membership (H13, nada hardcodeado)', async () => {
    const onRemove = vi.fn().mockResolvedValue({
      id: 'u1',
      roleKeys: ['org_admin'],
      memberships: [orgMembership],
    } satisfies UserRolesResponse);
    render(
      <RolesDialog
        user={user}
        onOpenChange={vi.fn()}
        onAssign={vi.fn()}
        onRemove={onRemove}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Quitar rol Inspector/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Quitar rol$/ })); // confirmar

    await waitFor(() =>
      expect(onRemove).toHaveBeenCalledWith('u1', { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' }),
    );
    // El chip de esa membership desaparece con la respuesta del backend.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Quitar rol Inspector/i })).not.toBeInTheDocument(),
    );
  });

  it('al elegir un rol PROJECT-only, exige seleccionar proyecto antes de habilitar Agregar', async () => {
    const onAssign = vi.fn().mockResolvedValue({
      id: 'u2',
      roleKeys: ['c_inspector'],
      memberships: [projMembership],
    } satisfies UserRolesResponse);
    render(
      <RolesDialog
        user={emptyUser}
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
      expect(onAssign).toHaveBeenCalledWith('u2', { roleKey: 'c_inspector', scopeType: 'PROJECT', scopeId: 'p1' }),
    );
  });

  it('rol ORGANIZATION-only no muestra selector de proyecto y asigna directo', async () => {
    const onAssign = vi.fn().mockResolvedValue({
      id: 'u2',
      roleKeys: ['org_admin'],
      memberships: [orgMembership],
    } satisfies UserRolesResponse);
    render(
      <RolesDialog
        user={emptyUser}
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
      expect(onAssign).toHaveBeenCalledWith('u2', { roleKey: 'org_admin', scopeType: 'ORGANIZATION', scopeId: 'gmt' }),
    );
  });
});
```

- [ ] Correr y ver que falla: `pnpm --filter "@gmt-platform/web" test -- api.test roles-dialog.test` (la firma vieja de `assignUserRole(id, roleKey)` no acepta `AssignRoleInput`; el diálogo todavía usa `ROLE_KEYS`/firma vieja)
- [ ] Implementación — todo en esta MISMA task (switch atómico A15; el build debe quedar verde al final):

**1) `api.ts` — reemplazar las funciones legacy** (eliminar `assignUserRole(id, roleKey)` / `removeUserRole(id, roleKey)`; `AssignRoleInput` y `UserMembership` ya están importados/re-exportados desde la Task 5.4):

```ts
/**
 * `POST /users/:id/roles` — asigna un rol con alcance (`AssignRoleInput`).
 * 400 `INVALID_SCOPE_FOR_ROLE`/`INVALID_SCOPE_ID` si el alcance no es válido
 * para el rol. Devuelve la `UserRolesResponse` extendida (A4).
 */
export function assignUserRole(id: string, input: AssignRoleInput): Promise<UserRolesResponse> {
  return request<UserRolesResponse>(`/users/${encodeURIComponent(id)}/roles`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * `DELETE /users/:id/roles?roleKey=&scopeType=&scopeId=` — quita la membership
 * EXACTA indicada (H13: sin defaults de organización en el remove).
 */
export function removeUserRole(id: string, membership: UserMembership): Promise<UserRolesResponse> {
  const query = new URLSearchParams({
    roleKey: membership.roleKey,
    scopeType: membership.scopeType,
    scopeId: membership.scopeId,
  });
  return request<UserRolesResponse>(
    `/users/${encodeURIComponent(id)}/roles?${query.toString()}`,
    { method: 'DELETE' },
  );
}
```

**2) `roles-dialog.tsx` — reescritura completa (chips por membership):**

```tsx
// nodes/web/src/pages/usuarios/roles-dialog.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { AssignRoleInput, RoleDetail, ScopeType, UserMembership } from '@gmt-platform/contracts';
import { Modal, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { listProjects, listRoles, type UserListItem, type UserRolesResponse } from '@/lib/api';
import { ConfirmDialog } from '@/pages/perfil/confirm-dialog';

/** Id del objeto organización (única org actual) — SOLO como default de asignación org. */
const ORG_SCOPE_ID = 'gmt';

interface ProjectOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Diálogo de asignación de roles por alcance de un usuario (§Fase 5 — H13).
 * Los chips se renderizan POR MEMBERSHIP (rol + badge de alcance:
 * "Organización" / "P-001 — Proyecto Uno") a partir de `user.memberships`, y
 * quitar pasa el `{roleKey, scopeType, scopeId}` EXACTO de esa membership —
 * nada hardcodeado en el remove. El selector de alcance queda limitado a
 * `role.allowedScopeTypes` del rol elegido; si el alcance es `PROJECT` se
 * exige elegir un proyecto concreto antes de habilitar "Agregar".
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
  onRemove: (id: string, membership: UserMembership) => Promise<UserRolesResponse>;
  onChanged: () => void;
}): ReactNode {
  const [roles, setRoles] = useState<RoleDetail[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [memberships, setMemberships] = useState<UserMembership[]>([]);
  const [toAdd, setToAdd] = useState<string>('');
  const [scopeType, setScopeType] = useState<ScopeType | ''>('');
  const [scopeId, setScopeId] = useState<string>('');
  const [toRemove, setToRemove] = useState<UserMembership | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!user) return;
    void listRoles().then(setRoles);
    void listProjects().then((ps) => setProjects(ps.map((p) => ({ id: p.id, code: p.code, name: p.name }))));
  }, [user]);

  useEffect(() => {
    setMemberships(user ? [...user.memberships] : []);
    setToAdd('');
    setScopeType('');
    setScopeId('');
    setToRemove(null);
    setError(null);
    setDirty(false);
  }, [user]);

  const selectedRole = roles.find((r) => r.key === toAdd) ?? null;

  function roleLabelFor(key: string): string {
    return roles.find((r) => r.key === key)?.label ?? key;
  }

  /** Badge de alcance de una membership: "Organización" o "P-001 — Proyecto Uno". */
  function scopeLabelFor(m: UserMembership): string {
    if (m.scopeType === 'ORGANIZATION') return 'Organización';
    const project = projects.find((p) => p.id === m.scopeId);
    return project ? `${project.code} — ${project.name}` : `Proyecto ${m.scopeId}`;
  }

  function handleSelectRole(key: string): void {
    setToAdd(key);
    const role = roles.find((r) => r.key === key);
    if (!role) {
      setScopeType('');
      setScopeId('');
      return;
    }
    const defaultScope = role.allowedScopeTypes[0] ?? 'ORGANIZATION';
    setScopeType(defaultScope);
    setScopeId(defaultScope === 'ORGANIZATION' ? ORG_SCOPE_ID : '');
  }

  const needsProject = scopeType === 'PROJECT';
  const canAdd = toAdd !== '' && scopeType !== '' && scopeId !== '';

  async function add(): Promise<void> {
    if (!user || !canAdd || scopeType === '') return;
    setBusy(true);
    setError(null);
    try {
      const input: AssignRoleInput = { roleKey: toAdd, scopeType, scopeId };
      const res = await onAssign(user.id, input);
      setMemberships(res.memberships);
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

  async function remove(membership: UserMembership): Promise<void> {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      // H13: se pasa la membership EXACTA (roleKey + scopeType + scopeId), sin defaults.
      const res = await onRemove(user.id, membership);
      setMemberships(res.memberships);
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
              {memberships.length === 0 && (
                <span className="text-sm text-muted-foreground">Sin roles asignados.</span>
              )}
              {memberships.map((m) => (
                <span
                  key={`${m.roleKey}|${m.scopeType}|${m.scopeId}`}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pl-2.5 pr-1 text-xs font-medium text-secondary-foreground"
                >
                  {roleLabelFor(m.roleKey)}
                  <span className="rounded-full bg-background/60 px-1.5 py-px text-[10px] font-normal text-muted-foreground">
                    {scopeLabelFor(m)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setToRemove(m)}
                    disabled={busy}
                    aria-label={`Quitar rol ${roleLabelFor(m.roleKey)} (${scopeLabelFor(m)})`}
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
              ¿Seguro que deseas quitar el rol <strong>{roleLabelFor(toRemove.roleKey)}</strong> (
              {scopeLabelFor(toRemove)}) a{' '}
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
            setToRemove(null);
          }
        }}
      />
    </>
  );
}
```

**3) `use-users.ts` — firma nueva de `assignRole`/`removeRole`** (los tipos vienen de `@gmt-platform/contracts` — A15):

```ts
// nodes/web/src/hooks/use-users.ts — reemplazar imports y las funciones assignRole/removeRole
import type { AssignRoleInput, UserMembership } from '@gmt-platform/contracts';
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
  /** Quita la membership exacta (rol + alcance) de un usuario. */
  removeRole: (id: string, membership: UserMembership) => Promise<UserRolesResponse>;
```

```ts
  const assignRole = useCallback(
    (id: string, input: AssignRoleInput): Promise<UserRolesResponse> => assignUserRole(id, input),
    [],
  );

  const removeRole = useCallback(
    (id: string, membership: UserMembership): Promise<UserRolesResponse> =>
      removeUserRole(id, membership),
    [],
  );
```

**4) `role-chips.tsx` — chips por membership con badge de alcance (H13)** (reescritura; único consumidor: `pages/usuarios/index.tsx`):

```tsx
// nodes/web/src/pages/usuarios/role-chips.tsx
import type { ReactNode } from 'react';
import type { UserMembership } from '@gmt-platform/contracts';
import { roleLabel } from '@/lib/role-labels';

/** Badge por defecto del alcance (sin catálogo de proyectos a mano). */
function defaultScopeLabel(m: UserMembership): string {
  return m.scopeType === 'ORGANIZATION' ? 'Organización' : `Proyecto ${m.scopeId}`;
}

/**
 * Chips de roles POR MEMBERSHIP (H13): un chip por (rol, alcance), con badge
 * "Organización" / "Proyecto X". `scopeLabel` permite al llamador resolver
 * nombres de proyecto si los tiene cargados. Sin memberships → guion apagado.
 */
export function RoleChips({
  memberships,
  scopeLabel = defaultScopeLabel,
}: {
  memberships: readonly UserMembership[];
  scopeLabel?: (m: UserMembership) => string;
}): ReactNode {
  if (memberships.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {memberships.map((m) => (
        <span
          key={`${m.roleKey}|${m.scopeType}|${m.scopeId}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
        >
          {roleLabel(m.roleKey)}
          <span className="rounded-full bg-background/60 px-1.5 py-px text-[10px] font-normal text-muted-foreground">
            {scopeLabel(m)}
          </span>
        </span>
      ))}
    </div>
  );
}
```

**5) `pages/usuarios/index.tsx` — cambios puntuales:**

- Quitar `import type { RoleKey } from '@gmt-platform/contracts';` (queda sin uso).
- Columna "Roles" del directorio: chips por membership (H13):

```tsx
    {
      id: 'roles',
      header: 'Roles',
      render: (u) => <RoleChips memberships={u.memberships} />,
    },
```

- Reemplazar el bloque `<RolesDialog .../>` (los callbacks delegan tal cual al hook):

```tsx
      <RolesDialog
        user={rolesUser}
        onOpenChange={(open) => (open ? undefined : setRolesUser(null))}
        onAssign={(id, input) => assignRole(id, input)}
        onRemove={(id, membership) => removeRole(id, membership)}
        onChanged={() => void refetch()}
      />
```

- [ ] Correr y ver que pasa: `pnpm --filter "@gmt-platform/web" test -- api.test roles-dialog.test` y **`pnpm --filter "@gmt-platform/web" exec tsc --noEmit` en verde** (el switch fue atómico: no queda ningún call-site con la firma vieja)
- [ ] Commit:
```bash
git add nodes/web/src/lib/api.ts nodes/web/src/lib/api.test.ts nodes/web/src/hooks/use-users.ts nodes/web/src/pages/usuarios/roles-dialog.tsx nodes/web/src/pages/usuarios/role-chips.tsx nodes/web/src/pages/usuarios/index.tsx nodes/web/src/pages/usuarios/roles-dialog.test.tsx && git commit -m "feat(web/usuarios): switch atómico a asignación por alcance + chips por membership"
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
