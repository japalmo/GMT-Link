# Diseño — Matriz RBAC (roles dinámicos con permisos por proyecto)

**Fecha:** 2026-07-01
**Estado:** aprobado (diseño); revisado adversarialmente (3 críticos). Pendiente revisión del spec antes del plan.
**Relacionado:** ADR-0001 (RBAC dinámico / PermissionService), `docs/GMT_LINK_PLAN_MAESTRO.md` §4.3/§8, `docs/superpowers/specs/2026-06-26-auth-propia-jwt-design.md`.

## 1. Contexto y objetivo

Hoy los roles son un **catálogo sembrado** (`prisma/seed.ts`: 8 roles del sistema, 36 permisos, 72 grants `RolePermission`) y `ROLE_KEYS` es una **unión cerrada** en `packages/contracts`. El `org_admin` asigna roles **existentes**, pero no puede **crear roles nuevos** ni ajustar sus permisos.

Objetivo: que el `org_admin` **cree y edite roles dinámicos** desde la UI (matriz roles × permisos), componiendo permisos del catálogo — **incluidos los structural de proyecto** — con enforcement real vía OpenFGA + Postgres. Tres capas en esta iteración: (1) definición/CRUD, (2) enforcement dinámico, (3) asignación por scope.

## 2. Decisiones (cerradas)

| Tema | Decisión |
| :-- | :-- |
| Enforcement | **Permiso asignable directo + rol = bundle en Postgres.** En `model.fga`, cada permiso atómico org/proyecto pasa a `define can_x: [user] or <derivaciones>`. Un rol es `Role` + `RolePermission[]`; al asignarlo se expande a **una tupla por permiso structural** sobre el objeto del scope. Los FUNCTIONAL se resuelven en Postgres (sin tupla), como hoy. |
| Roles del sistema | **Solo lectura + clonar** (`isSystem=true`). Mantienen su enforcement por relación-átomo (`syncMembershipToFGA` + `MEMBERSHIP_RELATION_MAP`) → sin migración. |
| Roles personalizados | CRUD (`isSystem=false`, `createdById`). Structural → tuplas-directas. |
| Catálogo de permisos | **Fijo.** El admin compone; no crea permisos. |
| Catálogo **componible** | FUNCTIONAL + STRUCTURAL con `fgaRelation` en `organization` o `project`. Los STRUCTURAL de `service/document/asset` **no** son componibles esta iteración (flag `composable=false`, se muestran deshabilitados). Ver §11. |
| Scopes de asignación | **ORGANIZATION** y **PROJECT** esta iteración. **DEPARTMENT se difiere** (topología dinámica; §11). |
| Homogeneidad de scope por rol | Los grants **structural** de un rol deben ser **todos org o todos proyecto** (no mezclar). Determina el scope de asignación permitido. Validado al crear/editar. |
| Gate | Relación FGA `can_manage_roles` en `organization` (derivada de `admin`); el guard la resuelve en OpenFGA. Sin permiso de catálogo. |

## 3. Dos conceptos de "scope" (ortogonales)

1. **`RolePermission.scope`** (`OWN`/`PROJECT`/`GLOBAL`) — por par (rol, permiso). Para **FUNCTIONAL** define el filtro de filas de `PermissionService` (propios / proyectos asociados / todo). Se setea en el editor, por permiso.
2. **Scope de asignación** (`Membership.scopeType`+`scopeId`) — **dónde** se asigna el rol. Determina sobre qué objeto FGA se escriben las tuplas structural.

Ejemplo: rol "Inspector" (`project:read` structural + `directory:view:extended` functional GLOBAL), asignado en `PROJECT:P` → tupla `user:U can_view project:P`; el permiso de directorio se resuelve global en Postgres.

**Resolución FUNCTIONAL (sin cambios respecto de hoy):** `PermissionService.scopeFilter` lee memberships → roleKeys → `RolePermission` del permiso; gana el scope más fuerte (`GLOBAL`>`PROJECT`>`OWN`). `GLOBAL`→`{kind:'none'}` (todo); `PROJECT`→`{kind:'projects', ids: projectIdsForUser}`; `OWN`→filtro `createdById`. La capa de roles dinámicos **no** cambia esta lógica.

## 4. Modelo de datos — sin cambios de schema

Ya soporta todo (verificado): `Role{key@unique,label,description?,isSystem,createdById?}`, `Permission{key@unique,label,module,kind,fgaRelation?,scopeable}`, `RolePermission{roleId,permissionId,scope,@@id}`, `Membership{userId,roleKey(string,no-FK),scopeType,scopeId,@@unique}`. Sin migración Prisma.

## 5. OpenFGA (`fga/model.fga`)

Cambios (re-bootstrap → nuevo `FGA_MODEL_ID`). El nuevo modelo es una **versión más en el mismo store**: las tuplas ya existentes persisten (son independientes del modelo) y siguen válidas — no hay migración de tuplas. Los cambios son retro-compatibles (`[user] or …` amplía, no rompe).

1. `type organization` — agregar `define can_manage_roles: [user] or admin`.
2. `type project` — a cada permiso atómico anteponer `[user] or`:
   ```
   define can_view: [user] or viewer or operator or qa or finance or project_creator or client_ito
   define can_create_task: [user] or operator or project_creator
   define can_assign_task: [user] or project_creator or admin from department
   define can_define_kpi: [user] or project_creator
   define can_create_service: [user] or project_creator
   define can_submit_measurements: [user] or operator or qa or project_creator
   ```
   (Los permisos org — `can_view_directory_extended`, `can_review_documents`, `can_manage_finance` — ya son `[user] or admin`, o se les agrega `[user]` si hiciera falta para hacerlos componibles.)

**Semántica (Zanzibar):** con `define can_x: [user] or …`, una tupla `(user:U, can_x, project:P)` satisface la rama `[user]` → `check(user:U, can_x, project:P)=true`. Las derivaciones cruzadas siguen: `service.can_view: can_view from project` se satisface por la tupla directa en el proyecto. Test obligatorio (§12): escribir la tupla directa y verificar `check=true`.

`can_manage_roles` lo **deriva** el `org_admin` de su tupla `admin organization:gmt` (ya sembrada) — sin tupla extra.

## 6. Backend — `RolesModule` (NestJS)

Endpoints admin gateados por `@RequirePermission('can_manage_roles', { type:'organization', id: ORG_ID })`.

### 6.1 Lectura
- `GET /permissions` → `{ module: string; items: PermissionCatalogItem[] }[]`. `PermissionCatalogItem = { key, label, module, kind, scopeable, fgaObjectType: 'organization'|'project'|null, composable: boolean }`. Orden: módulo (alfabético) → dentro, STRUCTURAL antes que FUNCTIONAL → alfabético por label.
- `GET /roles` → `RoleDetail[]`; `GET /roles/:key` → `RoleDetail`. `RoleDetail = { key, label, description, isSystem, allowedScopeTypes: ScopeType[], grants: { permissionKey, scope }[] }`. `allowedScopeTypes` se deriva de los grants structural (§6.3).

### 6.2 Escritura (personalizados; `isSystem` → 403)
- `POST /roles` `CreateRoleDto` → transacción Prisma: crea `Role` + `RolePermission[]`. Genera `key`.
- `PATCH /roles/:key` `UpdateRoleDto` → reemplaza grants + `resyncRole` (§6.4).
- `DELETE /roles/:key` → 409 si tiene memberships; borra `Role` (cascade).
- `POST /roles/:key/clone` `{ label }` → copia grants (incluso de roles del sistema) a un personalizado nuevo.

**Generación de `key`:** `slugify(label)` (minúsculas, sin acentos, `[^a-z0-9]`→`_`, colapsar `_`, máx 40) con prefijo `c_`. Colisión (`Role.key` existe) → append `_2`, `_3`, … hasta libre. Determinístico + legible.

**Validaciones POST/PATCH:** cada `permissionKey` existe en el catálogo y es `composable`; `scope` válido solo si `scopeable`; los grants structural son **homogéneos** (todos `fgaObjectType='organization'` o todos `'project'`) — si se mezclan, 400 `{ code:'MIXED_SCOPE_LEVELS' }`.

**Códigos de error:** 400 (validación: `permissionKey` inexistente/no-componible, scope inválido, scopes mezclados), 403 (sin `can_manage_roles` o rol `isSystem` en escritura), 404 (`key` no existe), 409 `{ code:'ROLE_IN_USE' }` (delete con memberships). Body: `{ error: string, code?: string }`.

### 6.3 Asignación por scope
- `POST /users/:id/roles` `{ roleKey, scopeType, scopeId }` (default `ORGANIZATION`/`gmt`) → crea `Membership` + `syncRoleAssignment(op:'create')`.
- `DELETE /users/:id/roles` (query `?roleKey=&scopeType=&scopeId=`) → borra `Membership` + `syncRoleAssignment(op:'delete')`.
- **`allowedScopeTypes` de un rol** = `['PROJECT']` si tiene algún grant structural de proyecto; `['ORGANIZATION']` si solo tiene structural org y/o functional. (No mezcla, por §2.)
- **Validaciones:** `scopeType ∈ allowedScopeTypes` del rol (si no, 400 `{ code:'INVALID_SCOPE_FOR_ROLE', allowedScopeTypes }`); si `scopeType='PROJECT'`, `scopeId` debe existir (`Project`), si no 400 `{ code:'INVALID_SCOPE_ID' }`.

### 6.4 Sincronización FGA (`FgaService`)
- `syncRoleAssignment(membership, op)`: lee los grants **structural** del rol (join `RolePermission`→`Permission` con `fgaRelation`), arma tuplas:
  - `fgaObjectType='organization'` → `(user:U, fgaRelation, organization:gmt)`.
  - `fgaObjectType='project'` (membership `PROJECT:P`) → `(user:U, fgaRelation, project:P)`.
  - `op='create'`→`write`; `op='delete'`→`delete`. Idempotente (tolera "ya existe"/"no existe").
- `resyncRole(roleKey)`: por cada `Membership` con ese `roleKey`, computa el set structural deseado y aplica el **delta** (write faltantes, delete sobrantes). **Síncrono** esta iteración (el `PATCH` retorna al terminar; cola diferida queda para C+ si N es grande).
- **Atomicidad / fallo parcial:** el `PATCH /roles/:key` abre transacción Prisma para los grants; luego ejecuta el delta FGA. Si FGA falla, se hace **rollback** de la transacción Prisma (los grants vuelven al estado previo) y se responde 502 `{ code:'FGA_SYNC_FAILED' }`. Como todas las escrituras FGA son idempotentes, un reintento del `PATCH` es seguro (recomputa el set ideal). Igual criterio para `POST /users/:id/roles`.
- Roles del sistema: siguen usando `syncMembershipToFGA` (relación-átomo). Discriminante: `Role.isSystem`.

## 7. Contracts (`packages/contracts`)

- `RoleKey` deja de ser unión cerrada → `type RoleKey = string`. `ROLE_KEYS` se conserva **solo** como lista de roles del sistema conocidos (labels/orden), no como validación.
- Relajar `@IsIn([...ROLE_KEYS])` → `@IsString()` en `create-user.dto.ts`/`assign-role.dto.ts`; la validación real la hace `validateRoleKeys` contra la tabla `Role` (ya lo hace; se quita el pre-check `isRoleKey` por forma).
- Tipos nuevos:
  - `PermissionCatalogItem { key; label; module; kind; scopeable; fgaObjectType: 'organization'|'project'|null; composable: boolean }`
  - `RoleGrant { permissionKey: string; scope: PermissionScopeValue }`
  - `RoleDetail { key; label; description: string|null; isSystem: boolean; allowedScopeTypes: ScopeType[]; grants: RoleGrant[] }`
  - `CreateRoleDto { label: string /*1..80*/; description?: string /*..255*/; grants: RoleGrant[] /*1..50*/ }`
  - `UpdateRoleDto { label?; description?; grants?: RoleGrant[] }`
  - `AssignRoleDto { roleKey: string; scopeType: ScopeType; scopeId: string }`

## 8. Frontend (`nodes/web`)

- **`/auth/me`** agrega `canManageRoles: boolean` (el backend hace un `fga.check(can_manage_roles, organization:gmt)` para el usuario). El nav muestra "Roles" solo si `true`.
- **Página `/roles`** (nav admin-only): izquierda lista de roles (secciones "Del sistema" con candado / "Personalizados"); derecha el editor — nombre, descripción, permisos **agrupados por módulo** con checkbox + selector de alcance (`OWN/PROJECT/GLOBAL`) cuando `scopeable`; ítems `composable=false` deshabilitados con tooltip. Roles del sistema: solo lectura + "Clonar". Estados vacío/carga/error; mobile-first; iconos `lucide-react`. Ensambla primitivas §5 (Modal/Table/checkbox), no reimplementa lógica.
- **Asignación con scope** en `/usuarios` (`roles-dialog.tsx`): selector de alcance limitado a `role.allowedScopeTypes`; si incluye `PROJECT`, un selector de proyecto (lista de `Project`). 
- **`api.ts`:** `getPermissionsCatalog`, `listRoles`, `getRole`, `createRole`, `updateRole`, `deleteRole`, `cloneRole`, `assignUserRole(id,{roleKey,scopeType,scopeId})`, `removeUserRole(id,{roleKey,scopeType,scopeId})`. Nav: entrada "Roles" en `nav-items.ts`.

## 9. Seed y despliegue

- `model.fga` con `can_manage_roles` + `[user] or` en permisos de proyecto. Re-bootstrap (`fga:bootstrap`) → nuevo `FGA_MODEL_ID` en `.env` local y variable de Railway. Las tuplas del store persisten (no se migran). Verificación post-bootstrap: `check(admin, can_manage_roles, organization:gmt)=true` (deriva de `admin`).
- Sin migración Prisma. Sin permiso de catálogo nuevo.

## 10. Seguridad

- Solo `can_manage_roles` (derivado de `admin` org) gestiona roles/asigna con scope; el guard resuelve en OpenFGA.
- El admin puede otorgar cualquier permiso **componible** a un rol (es el admin; no hay escalamiento).
- `DELETE /roles/:key` bloqueado con memberships → evita `roleKey` colgados (no es FK).
- **Coexistencia de roles:** un usuario puede tener roles del sistema y personalizados a la vez; OpenFGA resuelve la **unión** (más asignaciones = más acceso). Borrar/editar un rol solo afecta sus propias tuplas; el acceso otorgado por otro rol persiste. Documentado para no esperar "revocación total" al borrar un rol.

## 11. Fuera de alcance (esta iteración)

- Editar el **catálogo de permisos** (fijo, atado a código/FGA).
- Componer permisos de nivel **servicio/documento/activo** (`composable=false`): requieren tuplas por-objeto; se cubren asignando roles del sistema (qa/operator). 
- Scope de asignación **DEPARTMENT** (expansión a proyectos + re-sync ante topología dinámica).
- Roles con grants structural **mixtos** org+proyecto (se rechazan; se hacen dos roles).
- Audit-log de cambios de rol (el schema ya tiene `createdById/createdAt/updatedAt`; historial detallado = C+).
- Migrar el enforcement de roles del sistema a tuplas-directas (se quedan con relación-átomo).

## 12. Tests (criterios)

- `RolesService`: crear/editar/borrar/clonar; slug + colisión; 403 en `isSystem`; 409 al borrar en uso; 400 `permissionKey` inexistente/no-componible; 400 scopes structural mezclados.
- Asignación: 400 si `scopeType ∉ allowedScopeTypes`; 400 si `scopeId` inexistente; org-only en `PROJECT` y project-level en `ORGANIZATION` rechazados.
- `FgaService.syncRoleAssignment`: org→tupla en `organization:gmt`; proyecto→tupla en `project:P`; delete borra; idempotencia (delete de tupla inexistente no falla).
- `resyncRole`: quitar un permiso borra sus tuplas en todos los asignados; agregarlo las escribe. Fallo FGA → rollback de grants Postgres (502).
- `PermissionService`: FUNCTIONAL en Postgres y STRUCTURAL en FGA para roles personalizados (grant directo pasa `can()`); scope más fuerte gana (sin regresión).
- `model.fga`: `check(user:U, can_view, project:P)=true` tras escribir la tupla directa; derivación cruzada a servicio. `check(admin, can_manage_roles, organization:gmt)=true`.
- Guard `can_manage_roles`: admin permite; no-admin 403. `/auth/me.canManageRoles` refleja el check.
- E2E: admin crea rol "Inspector" (`project:read`+`task:create`, PROJECT) → lo asigna a un usuario en `project:P` → el usuario pasa el guard de crear tarea en P y **no** en otro proyecto; editar el rol (quitar `task:create`) revoca en P.

## 13. Criterio de aceptación (demo)

1. El admin entra a `/roles`, crea un rol personalizado eligiendo permisos por módulo y su alcance.
2. Lo asigna a un usuario **en un proyecto concreto**; el usuario obtiene exactamente esos permisos ahí (y no en otros).
3. El admin edita el rol (agrega/quita un permiso) → el enforcement del usuario asignado cambia acorde.
4. Los roles del sistema se ven y se clonan, pero no se editan/borran.
