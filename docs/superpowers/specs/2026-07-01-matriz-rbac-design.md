# Diseño — Matriz RBAC (roles dinámicos con permisos por proyecto)

**Fecha:** 2026-07-01
**Estado:** aprobado (diseño) — pendiente revisión del spec antes del plan de implementación.
**Relacionado:** ADR-0001 (RBAC dinámico / PermissionService), `docs/GMT_LINK_PLAN_MAESTRO.md` §4.3/§8, `docs/superpowers/specs/2026-06-26-auth-propia-jwt-design.md`.

## 1. Contexto y objetivo

Hoy los roles son un **catálogo sembrado** (`prisma/seed.ts`: 8 roles del sistema, 36 permisos atómicos, 72 grants `RolePermission`) y `ROLE_KEYS` es una **unión cerrada** en `packages/contracts`. El `org_admin` puede crear usuarios y asignarles roles **existentes**, pero no puede **crear roles nuevos** ni ajustar qué permisos tiene cada rol.

Objetivo: que el `org_admin` **cree y edite roles dinámicos** desde la UI (una "matriz" de roles × permisos), componiendo cualquier combinación de permisos del catálogo — **incluidos los permisos structural de proyecto** — y que esos roles **enforcen de verdad** vía OpenFGA + Postgres. Tres capas, todas en esta iteración:

1. **Definición** — CRUD de roles + editor de permisos por rol.
2. **Enforcement dinámico** — los permisos structural se vuelven asignables directo en OpenFGA; asignar/editar un rol sincroniza tuplas.
3. **Asignación por scope** — asignar un rol a un usuario en un **proyecto/departamento** concreto (hoy la asignación es solo organización).

Autoridad del plan maestro: los módulos ensamblan primitivas §5; toda decisión de permiso pasa por el guard/`PermissionService`; por cada permiso nuevo → entrada en catálogo (§8) + relación OpenFGA (§4.3).

## 2. Decisiones (cerradas)

| Tema | Decisión |
| :-- | :-- |
| Mecanismo de enforcement | **Permiso asignable directo + rol = bundle en Postgres.** En `model.fga`, cada permiso atómico org/proyecto pasa a ser `define can_x: [user] or <derivaciones existentes>`. Un rol es `Role` + sus `RolePermission`; al **asignarlo** se expande a **una tupla por permiso structural** sobre el objeto del scope. Los FUNCTIONAL se resuelven en Postgres (sin tupla), como hoy. |
| Roles del sistema | **Solo lectura + clonar** (`isSystem=true`). No se editan ni borran; su enforcement por relación-átomo (`operator`, `viewer`…) queda intacto → sin migración de lo existente. Para modificarlos se **clonan** a un rol personalizado. |
| Roles personalizados | CRUD completo (`isSystem=false`, `createdById` = admin). Sus permisos structural enforcen por **tuplas-directas**. |
| Catálogo de permisos | **Fijo** (atado a código/FGA). El admin **compone** roles con esos permisos; no crea permisos nuevos desde la UI. |
| Gate | Relación FGA `can_manage_roles` en `organization` (derivada de `admin`); el guard la resuelve en OpenFGA. **No** requiere permiso de catálogo (solo el admin gestiona roles). |
| Alcance de composición | Permisos FUNCTIONAL + STRUCTURAL con objeto `organization` o `project` + las 6 **capacidades de proyecto** (`viewer/operator/qa/finance/project_creator/client_ito`) como ítems componibles (traen sus derivaciones sub-proyecto: servicio/documento/activo). Ver §5. |

## 3. Dos conceptos de "scope" (no confundir)

1. **`RolePermission.scope`** (`OWN` / `PROJECT` / `GLOBAL`) — propiedad de cada par (rol, permiso). Para permisos **FUNCTIONAL** define el filtro de filas que aplica `PermissionService` (propios / proyectos asociados / todo). Se setea en el editor de la matriz, por permiso.
2. **Scope de asignación** (`Membership.scopeType` ∈ ORGANIZATION/DEPARTMENT/PROJECT/SERVICE + `scopeId`) — **dónde** se asigna el rol a un usuario (en qué proyecto/depto lo tiene). Determina sobre qué objeto FGA se escriben las tuplas de los permisos structural. Se elige al asignar.

Estos son ortogonales. Ejemplo: rol "Inspector" con `can_view` (structural) + `directory:view:extended` (functional, scope GLOBAL). Asignado en `PROJECT:P` → tupla `user:U can_view project:P` **y** el permiso de directorio se resuelve global en Postgres.

## 4. Modelo de datos — sin cambios de schema

El schema ya soporta todo esto (verificado):
- `Role { key @unique, label, description?, isSystem @default(false), createdById?, permissions[] }`
- `Permission { key @unique, label, module, kind (FUNCTIONAL|STRUCTURAL), fgaRelation?, scopeable }`
- `RolePermission { roleId, permissionId, scope (OWN|PROJECT|GLOBAL), @@id([roleId, permissionId]) }` (cascade)
- `Membership { userId, roleKey (string, NO FK), scopeType, scopeId, @@unique([userId, roleKey, scopeType, scopeId]) }`

No hay migración de tablas. Nota de integridad: `Membership.roleKey` sigue siendo string; al **borrar** un rol personalizado se valida que no tenga memberships (ver §6).

## 5. OpenFGA (`fga/model.fga`)

Cambios (requieren re-bootstrap → nuevo `FGA_MODEL_ID`):

1. **Permisos org asignables directo:**
   ```
   type organization
     relations
       define admin: [user]
       define member: [user] or admin
       define can_manage_users: [user] or admin
       define can_manage_roles: [user] or admin        # NUEVO
       define can_view_directory_extended: [user] or admin
       define can_review_documents: [user] or admin
       define can_manage_finance: [user] or admin
   ```
2. **Permisos de proyecto asignables directo** (agregar `[user] or` a cada `can_*`):
   ```
   define can_view: [user] or viewer or operator or qa or finance or project_creator or client_ito
   define can_create_task: [user] or operator or project_creator
   define can_assign_task: [user] or project_creator or admin from department
   define can_define_kpi: [user] or project_creator
   define can_create_service: [user] or project_creator
   define can_submit_measurements: [user] or operator or qa or project_creator
   ```
3. Las **capacidades de proyecto** (`viewer/operator/qa/finance/project_creator/client_ito`) siguen igual: son relaciones `[user]` que derivan permisos sub-proyecto (servicio/documento/activo) por herencia (`can_sign_qa: qa from service`, etc.). Incluir una capacidad en un rol escribe su tupla-átomo y las derivaciones fluyen como hoy — así cubrimos lo sub-proyecto sin tuplas por-documento.

Las derivaciones cruzadas (`service.can_view: can_view from project`) siguen funcionando: un tuple directo `can_view` en el proyecto satisface `can_view from project` en el servicio.

**Catálogo componible en la matriz** = permisos FUNCTIONAL + permisos STRUCTURAL con `fgaRelation` en `organization`/`project` + las 6 capacidades de proyecto. Los permisos con `fgaRelation` en `service/document/asset` **no** se componen individualmente en esta iteración (se cubren vía las capacidades de proyecto); documentado en §11.

## 6. Backend — `RolesModule` (NestJS)

Todos los endpoints admin gateados por `@RequirePermission('can_manage_roles', { type: 'organization', id: ORG_ID })`.

### 6.1 Lectura
- `GET /permissions` → catálogo componible agrupado por módulo: `PermissionCatalogItem[]` `{ key, label, module, kind, scopeable, fgaObjectType?: 'organization'|'project'|null, isCapability: boolean }`.
- `GET /roles` → `RoleDetail[]` `{ key, label, description, isSystem, grants: { permissionKey, scope }[] }` (sistema + personalizados).
- `GET /roles/:key` → `RoleDetail`.

### 6.2 Escritura (personalizados)
- `POST /roles` `{ label, description?, grants: { permissionKey, scope }[] }` → genera `key` slug-único (`c_<slug>`), `isSystem=false`, `createdById`. Crea `Role` + `RolePermission[]` en transacción. Valida cada `permissionKey` contra el catálogo y cada `scope` contra `scopeable`.
- `PATCH /roles/:key` `{ label?, description?, grants? }` → 403 si `isSystem`. Reemplaza grants; **re-sincroniza FGA** de todos los usuarios con ese rol (`resyncRole`, §6.4).
- `DELETE /roles/:key` → 403 si `isSystem`; 409 si tiene memberships (hay que desasignarlo primero). Borra `Role` (cascade a `RolePermission`).
- `POST /roles/:key/clone` `{ label }` → copia grants (incluye clonar roles del sistema) a un rol personalizado nuevo.

### 6.3 Asignación por scope
- `POST /users/:id/roles` `{ roleKey, scopeType, scopeId }` (reemplaza el assign solo-org actual; default `ORGANIZATION`/`gmt` para compatibilidad). Crea `Membership` + `syncRoleAssignment(op='create')`.
- `DELETE /users/:id/roles/:roleKey?scopeType=&scopeId=` → borra `Membership` + `syncRoleAssignment(op='delete')`.
- **Validación de coherencia:** si el rol incluye permisos/ capacidades de nivel proyecto, el scope de asignación debe ser `PROJECT` o `DEPARTMENT` (no `ORGANIZATION`). Si solo tiene permisos org/functional, `ORGANIZATION`. La UI ofrece solo scopes válidos para el rol.

### 6.4 Sincronización FGA (`FgaService`)
- `syncRoleAssignment(membership, op)`: resuelve los grants **structural** del rol y, por cada uno, arma la tupla:
  - permiso org (`fgaObjectType='organization'`) → `user:U <fgaRelation> organization:gmt`.
  - permiso/capacidad de proyecto → objeto según el scope de asignación:
    - `PROJECT:P` → sobre `project:P`.
    - `DEPARTMENT:D` → una tupla por cada proyecto del depto D.
  - `write`/`delete` según `op`. Idempotente (tolera "ya existe").
- `resyncRole(roleKey)`: para cada `Membership` con ese `roleKey`, recomputa el set de tuplas structural deseado y aplica el delta (write faltantes, delete sobrantes). Se llama tras `PATCH /roles/:key`.
- Roles del sistema mantienen el camino actual (`syncMembershipToFGA` vía `MEMBERSHIP_RELATION_MAP`); roles personalizados usan la expansión por-permiso. El discriminante es `Role.isSystem`.

## 7. Contracts (`packages/contracts`)

- `RoleKey` deja de ser unión cerrada de 12 → `type RoleKey = string` (validación real contra tabla `Role`). Se conserva `ROLE_KEYS` como lista de **roles del sistema conocidos** (para labels/orden), no como fuente de verdad de validación.
- Se relaja `@IsIn([...ROLE_KEYS])` en `create-user.dto.ts` / `assign-role.dto.ts` → `@IsString` + validación en `RolesService`/`UsersService.validateRoleKeys` contra la BD (ya hace el `role.findMany`; se quita el pre-check `isRoleKey` por forma).
- Tipos nuevos: `PermissionCatalogItem`, `RoleDetail`, `RoleGrant { permissionKey; scope }`, `CreateRoleDto`, `UpdateRoleDto`, `AssignRoleDto` extendido con `scopeType`/`scopeId`.

## 8. Frontend (`nodes/web`)

- **Página `/roles`** (entrada de nav admin-only; visibilidad por el patrón admin existente — sonda 403 o flag `isAdmin` en `/auth/me`): 
  - Columna izquierda: lista de roles (sección "Del sistema" con candado; "Personalizados" editables) + botón "Nuevo rol".
  - Panel derecho: editor del rol seleccionado — nombre, descripción y **permisos agrupados por módulo** con checkbox por permiso y **selector de alcance** (`OWN/PROJECT/GLOBAL`) donde el permiso es `scopeable`. Roles del sistema: campos en solo-lectura + botón "Clonar".
  - Ensambla primitivas existentes (`Modal`, `Table`, checkboxes shadcn); no reimplementa lógica de permisos.
- **Asignación con scope** en `/usuarios` (`roles-dialog.tsx`): al asignar un rol se elige el alcance (organización / departamento / proyecto) con un selector de destino; la UI ofrece solo los scopes válidos para ese rol (§6.3).
- **`api.ts`**: `getPermissionsCatalog`, `listRoles`, `getRole`, `createRole`, `updateRole`, `deleteRole`, `cloneRole`, `assignUserRole(id, { roleKey, scopeType, scopeId })`, `removeUserRole(...)`.
- Nav: nueva entrada "Roles" en `nav-items.ts` (bajo administración), gateada por el permiso.
- Estados vacío/carga/error siempre; mobile-first; iconos `lucide-react`.

## 9. Seed y despliegue

- `model.fga` agrega la relación `can_manage_roles` (derivada de `admin`). No requiere permiso de catálogo nuevo (el gate es la relación FGA, resuelta por el guard).
- Re-bootstrap del modelo FGA (`fga:bootstrap`) → nuevo `FGA_MODEL_ID`; actualizar en el backend (local `.env` y variable de Railway). El `org_admin` deriva `can_manage_roles` de su tupla `admin organization:gmt` (ya sembrada) — sin tupla extra.
- Sin migración de schema Prisma.

## 10. Seguridad

- Solo `can_manage_roles` (derivado de `admin` org) crea/edita roles y asigna con scope. El guard resuelve en OpenFGA (§3.1 plan maestro).
- Un admin puede otorgar cualquier permiso del catálogo a un rol (es el admin); no hay escalamiento porque ya tiene todo.
- `DELETE /roles/:key` bloqueado si hay memberships → evita `roleKey` colgados (integridad, dado que no es FK).
- Editar un rol re-sincroniza tuplas de forma transaccional-lógica (delta); si falla la parte FGA, se revierte el cambio de grants (o se marca para re-sync) — el spec del plan detalla el manejo de error.

## 11. Fuera de alcance

- Editar el **catálogo de permisos** (permisos fijos, atados a código/FGA).
- Componer individualmente permisos de nivel **servicio/documento/activo** (se cubren vía las capacidades de proyecto; per-objeto queda para otra etapa).
- Audit-log de cambios de rol / historial de asignaciones.
- Workflow de aprobación para cambios de rol (el módulo `permission-requests` ya cubre solicitudes de usuarios; esto es distinto).
- Migrar el enforcement de los **roles del sistema** a tuplas-directas (se quedan con relación-átomo).

## 12. Tests (criterios)

- `RolesService`: crear/editar/borrar/clonar; 403 en roles del sistema; 409 al borrar rol en uso; validación de `permissionKey`/`scope`.
- `FgaService.syncRoleAssignment`: org → tupla en `organization:gmt`; proyecto → tupla en `project:P`; depto → una por proyecto; delete borra.
- `resyncRole`: al quitar un permiso del rol se borran las tuplas correspondientes de todos los asignados; al agregarlo se escriben.
- `PermissionService`: sigue resolviendo FUNCTIONAL en Postgres y STRUCTURAL en FGA para roles personalizados (grant directo pasa el `can()`); scope más fuerte gana.
- `model.fga`: `can_x: [user] or …` — un tuple directo satisface el guard y las derivaciones cruzadas.
- Guard `can_manage_roles`: admin permite; no-admin 403.
- E2E: admin crea rol "Inspector" (can_view + can_create_task, scope PROJECT) → lo asigna a un usuario en `project:P` → el usuario pasa el guard de crear tarea en P y NO en otro proyecto.

## 13. Criterio de aceptación (demo)

1. El admin entra a `/roles`, crea un rol personalizado eligiendo permisos por módulo y su alcance.
2. Lo asigna a un usuario **en un proyecto concreto**; el usuario obtiene exactamente esos permisos ahí (y no en otros proyectos).
3. El admin edita el rol (agrega/quita un permiso) → el cambio se refleja en el enforcement del usuario ya asignado.
4. Los roles del sistema se ven y se pueden clonar, pero no editar/borrar.
