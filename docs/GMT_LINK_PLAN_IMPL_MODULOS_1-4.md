# Plan de Implementación — GMT Link Módulos 1-5 (cierre de gaps)

> **For agentic workers:** REQUIRED SUB-SKILL: usar `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkbox (`- [ ]`).
>
> **Multi-subsistema:** este documento es el **roadmap maestro** + la **Fase 1 detallada (bite-sized)**. Cada fase 2-6 es un subsistema independiente y se **expande a su propio plan granular** (corriendo `superpowers:writing-plans`) cuando se inicie. No ejecutar 2-6 desde el detalle de aquí sin antes expandirlas.

**Goal:** Cerrar los gaps de los 4 módulos (builder dinámico de servicios, template builder de informes, RRHH/logística, RBAC dinámico) sobre la base ya existente, sin romper el cliente PyQt ni el contrato HTTP de `metrics`.

**Architecture:** Una **fachada de autorización única** (`PermissionService.can`) gobierna los 3 scopes (Propios/Proyecto/Todo) de forma idéntica en los 4 módulos: estructura vía OpenFGA, "propios" vía predicado SQL `createdById`, funcional vía grants Postgres con columna `scope`. Sobre esa base se construye un **meta-modelo de servicios** (ServiceType→Level→FieldDef + InstanceNode/FieldValue) que reemplaza la jerarquía fija de metrics, y un **template builder** (ReportTemplate/TemplateBlock con binding por `fieldKey` y snapshot al generar).

**Tech Stack:** NestJS + Prisma + PostgreSQL + OpenFGA (`@openfga/sdk`) · React + Vite + TS + Tailwind + shadcn/ui · `@gmt-link/shared-types` · Firebase Auth · StorageService (disco local→R2) · `class-validator` DTOs · Vitest/Jest (mocks a mano estilo `assets.service.spec.ts`).

**Decisión de arquitectura:** ver [ADR-0001](adr/0001-rbac-dinamico-permission-service.md) (RBAC dinámico, fachada B-ahora/C-listo, *accepted*).

---

## 0. Diseño de referencia (self-contained)

### 0.1 Contrato de scope (la pieza que unifica los 4 módulos)

```ts
// packages/shared-types/src/authz.ts
export type ScopeFilter =
  | { kind: 'none' }                       // GLOBAL  → sin restricción de fila
  | { kind: 'own' }                        // OWN     → WHERE createdById = userId
  | { kind: 'projects'; ids: string[] };   // PROJECT → WHERE projectId IN (ids del usuario)

export interface PermissionDecision { effect: 'allow' | 'deny'; filter: ScopeFilter; }
export interface ResourceRef { projectId?: string; createdById?: string; }
```

Fachada (único punto de decisión):
- `can(userId, permissionKey, resource?): Promise<PermissionDecision>` — 1 recurso.
- `scopeFilter(userId, permissionKey): Promise<ScopeFilter | null>` — listas (`null` = denegado).
- `usersWithPermissionOnProject(permissionKey, projectId): Promise<string[]>` — dropdown autorizador (M3).

**Resolución de `can`:** (1) SuperAdmin → `{allow,{none}}`. (2) Cargar grants del usuario para `permissionKey` vía `Membership→Role→RolePermission(scope)`. (3) Vacío → `{deny}`. (4) Gana el scope más fuerte (GLOBAL>PROJECT>OWN). (5) Construir filtro: GLOBAL→`{none}`; PROJECT→`{projects, ids}` (ids = proyectos del usuario); OWN→`{own}`. (6) Si llega `resource`: STRUCTURAL+PROJECT delega en `fga.check(fgaRelation, project:resource.projectId)`; FUNCTIONAL+PROJECT verifica `resource.projectId ∈ ids`; OWN verifica `resource.createdById === userId`. **Garantía dura:** el filtro se aplica server-side; un `projectId` del body solo se intersecta, nunca amplía.

### 0.2 Deltas de esquema (reuso/agrega/reemplaza)

| Entidad | Acción |
|---|---|
| `Role`, `Permission` | reusa + amplía (cols nullable/default) |
| `RolePermission` | reusa + **agrega `scope`** |
| `Membership`, `ScopeType` | reusa sin cambio |
| `MEMBERSHIP_RELATION_MAP` | reduce a roles estructurales (código) |
| `ServiceType/Level/FieldDef`, `InstanceNode`, `FieldValue`, `DocumentSequence` | agrega (nuevas) |
| `Phase`, `Variable`, `DataPoint` | reemplaza (expand-contract) |
| `ReportTemplate`, `TemplateBlock` | agrega |
| `ProjectDocument` | reusa + agrega `templateId?`, `renderSnapshot?` |
| `OvertimeRequest` | modifica (expand-contract) |
| `VehicleUseRequest` | agrega |
| `Asset` | reusa + agrega `createdById?` |
| `Element`, `Reimbursement`, FGA estructural | reusa sin cambio |

### 0.3 Catálogo de permisos (seed, ~70) — resumen

10 grupos: `system/rbac`, `directorio`, `proyectos/builder` (M1), `tareas`, `documentos/plantillas` (M2), `finanzas`, `horas-extra` (M3b), `activos/vehículos` (M3c), `insumos/proveedores/bodegas`, `herramientas/dashboard`. `kind=STRUCTURAL` reusa relaciones FGA existentes; `kind=FUNCTIONAL` = filtro de datos. Catálogo completo en el array `PERMISSION_CATALOG` de la Tarea 1.2.

### 0.4 Restricción dura

El cliente **PyQt de escritorio** consume los endpoints de `metrics` — **ningún cambio de path, método HTTP ni forma de body/response**. Todos los fixes de autz son aditivos (un 403 nuevo se vuelve posible). El shim de compatibilidad de la Fase 2 resuelve `variableCode → FieldDef`.

---

## Gaps → Fases

| Gap (hoy roto/ausente) | Fase | Prioridad |
|---|---|---|
| RBAC dinámico inexistente; `Asset` sin `createdById`; logo chico | **F1** | ✅ hecho |
| **MVP Capstone**: Tarea sin tiempos de ejecución; backlog Kanban/Tabla; flujo Supervisor→Operador→ITO | **M5-A** | **1ª** |
| **MVP Albemarle**: visor 3D de DEM (no existe); visibilidad de módulos por cliente | **M5-B** | **2ª** |
| Seeders por cliente + deploy Railway | **M5-C** | **3ª** |
| Builder M1: jerarquía fija, sin meta-modelo, nomenclatura no por servicio | F2 | post-MVP |
| UI matriz de roles / asignación (M4) | F3 | post-MVP |
| Horas extra / vehículo / capture reembolso (M3) | F4 | post-MVP |
| Bloques visuales de informe (M2) | F5 | post-MVP |
| Reverse-queries con herencia (Opción C) | F6 | opcional |

**Re-secuenciación (decisión del usuario, 2026-06-22): Módulo 5 primero.** Sobre la fachada RBAC ya construida (F1 ✅), se entregan los 2 flujos MVP por cliente (Capstone tareas/tiempos + Albemarle visor 3D) + seeders + Railway, ANTES del builder dinámico completo y el template builder. **Dependencias:** F1 ✅ desbloquea todo; M5-A/M5-B consumen `PermissionService` + `usersWithPermissionOnProject` de F1; M5-C tras A/B; F2-F6 (post-MVP) después.

---

## MÓDULO 5 + TAREA — diseño (PRIORITARIO)

> Las secciones FASE 1-6 más abajo son la **fundación + post-MVP**. La **prioridad actual** es el Módulo 5, detallado aquí (FASE M5-A/B/C).

### Decisiones cerradas (usuario, 2026-06-22)
1. **Tarea = wrapper de ejecución/tiempos; captura de datos SEPARADA** — la `Task` NO posee los `DataPoint`; link opcional `DataPoint.taskId` para traza.
2. **Visor 3D = three.js + heightmap** desde un raster simplificado.
3. **El cliente PyQt sube el raster simplificado** (contrato aditivo; el seeder provee una muestra para la demo mientras el binario no se actualiza).
4. **Módulo 5 primero** (MVP por cliente sobre la fundación RBAC).

### Esquema (deltas)

```prisma
// Tarea como instancia de ejecución (Task EXISTE — se extiende)
model Task {
  // ...id, name, description, status, projectId, serviceId?, assignedToId?, createdById, clientUserId?, recurrence?...
  phaseId   String?       // contexto de captura (opcional, soft-link)
  elementId String?       // poza/sector objetivo (opcional)
  dataSpec  Json?         // "datos a obtener" que define el Supervisor (lista de variable codes + labels)
  timeLogs  TaskTimeLog[]
}

model TaskTimeLog {        // NUEVO — inicio/fin de actividad (append-only; soporta pausas/reanudaciones)
  id        String    @id @default(cuid())
  taskId    String
  task      Task      @relation(fields: [taskId], references: [id], onDelete: Cascade)
  userId    String    // el operador que ejecuta
  startedAt DateTime
  endedAt   DateTime? // null = en curso
  note      String?
  createdAt DateTime  @default(now())
  @@index([taskId])
  @@index([userId])
}
// DataPoint (metrics): + taskId String?   // traza OPCIONAL, sin FK dura de requerimiento → respeta "separadas"

// Visor 3D DEM (Albemarle): el PyQt sube el raster simplificado
model DemRaster {          // NUEVO
  id            String   @id @default(cuid())
  elementId     String
  element       Element  @relation(fields: [elementId], references: [id], onDelete: Cascade)
  phaseId       String?                        // periodo de monitoreo (comparación temporal)
  label         String
  originalUrl   String?                        // DEM crudo (referencia)
  simplifiedUrl String                         // grid de elevaciones reducido que consume el visor
  gridWidth     Int
  gridHeight    Int
  bbox          Json                           // [minX,minY,maxX,maxY] coords del proyecto
  minZ          Float
  maxZ          Float
  noData        Float?
  createdById   String
  createdAt     DateTime @default(now())
  @@index([elementId, phaseId])
}
// Client: + enabledModules String[]   // visibilidad de módulos por cliente, p.ej. ["inicio","v-metric","operaciones"]
```

### Permisos (deltas) + roles seed
Permisos nuevos (convención `:`): `task:read` · `task:create` · `task:assign` · `task:update` · `task:time:log` · `task:time:read` · `vmetric:view` · `vmetric:dem:view` · `vmetric:dem:compare`.

| Rol seed (compartido por ambos clientes) | Permisos clave → scope |
|---|---|
| **Adm_Contrato** | project:read/update, task:* , document:* , directory:view, reimbursement/overtime approve, role:assign → **Proyecto** |
| **Supervisor** | task:create/assign/read, task:time:read, service:read, measurement:read → **Proyecto** (define `dataSpec`; asigna vía `usersWithPermissionOnProject`) |
| **Operador** | task:read → **Propio** · task:time:log → **Propio** · measurement:submit, document:upload → **Proyecto** |
| **ITO** | task:read, task:time:read, document:read → **Proyecto** (read-only) · vmetric:view/dem:view/dem:compare → **Proyecto** |

Visibilidad de módulos = `Client.enabledModules` (Albemarle: inicio+v-metric+operaciones · Capstone: inicio+operaciones) **∩** permisos efectivos (`GET /me/permissions`).

### UI/UX
- **Gestión de Tareas — 2 vistas fijas.** **Tabla**: Tarea · Servicio · Asignado · Estado · Inicio · Fin · Duración; filtros (estado/asignado/servicio/fecha) + búsqueda. **Kanban**: 4 columnas = `TaskStatus` (Pendiente/En progreso/Revisado/Completado); cards con asignado + tiempos; drag mueve estado (Supervisor/Adm).
- **Supervisor → crear tarea (wizard):** Servicio → Fase/Element → *Datos a obtener* (`dataSpec`) → Asignar personal (dropdown filtrado a operadores del proyecto) → Confirmar.
- **Operador → backlog:** selecciona actividad → lee descripción/`dataSpec` → **[Iniciar]** (time-log start) → **[Finalizar]** (end) → (opcional) captura datos vía metrics.
- **ITO:** Tabla + Kanban **read-only**.
- **Visor 3D DEM:** selector Element + DEM → canvas three.js (OrbitControls) → toolbar: **Perfil** (línea → muestreo de elevaciones → gráfico de corte) · **Comparar** (2 DEMs del mismo Element → overlay/diff ΔZ) · reset cámara. Estados vacío/carga/error; mobile-first.

### Visor 3D — estrategia técnica (three.js heightmap)
`PlaneGeometry(gridW-1, gridH-1)` con desplazamiento Z de vértices desde el grid → malla; `OrbitControls` + colormap por elevación. **Perfil** = 2 puntos XY → muestreo bilineal a lo largo de la línea → serie → gráfico 2D (recharts/uplot). **Comparación** = 2da malla semitransparente o diff ΔZ en colormap. Datos = `simplifiedUrl` (grid PNG16/Float32 + `bbox` + `minZ/maxZ`), grid acotado ≤512² (sin servidor de tiles). Antes de actualizar el PyQt: el seeder sube un raster simplificado de muestra.

### Seeders (Módulo 5) — por cliente, idempotentes (upsert)
`Client(+enabledModules)` → `Department` → `Project` → `Service(s)` → 1 `User` por rol → `Membership(rol@proyecto)` + sync FGA → (Albemarle) `Element` pozas + `DemRaster` muestra → (Capstone) `Task`s de ejemplo. Los 4 `Role` (definiciones + bundles con `scope`) se siembran una vez, compartidos.

---

## FASE M5-A — MVP Capstone (Operaciones: tareas/tiempos) — DETALLADA

**Objetivo:** el flujo Supervisor→Operador→ITO sobre `Task` con tiempos de ejecución y vistas Kanban/Tabla, scopeado por `PermissionService`. **DoD:** Supervisor crea tarea con `dataSpec` y la asigna; Operador registra inicio/fin; ITO ve Tabla+Kanban read-only; `pnpm --filter api test` verde.

### Task A.1: Esquema — `TaskTimeLog` + deltas `Task` + `DataPoint.taskId`
**Files:** Modify `apps/api/prisma/schema.prisma`; migración `m5a_task_execution`.
- [ ] Agregar `model TaskTimeLog`, los campos `phaseId/elementId/dataSpec` en `Task`, y `taskId String?` en `DataPoint` (todo aditivo/nullable).
- [ ] `npx prisma migrate dev --name m5a_task_execution` (con DB arriba) + `prisma generate`.
- [ ] Commit `feat(tasks): TaskTimeLog + execution context on Task`.

### Task A.2: Endpoints de tareas + time-log + asignables
**Files:** `apps/api/src/modules/tasks/*` (service/controller/dto).
- [ ] DTOs `class-validator`: `CreateTaskDto { name, description?, serviceId, phaseId?, elementId?, dataSpec?, assignedToId? }`, `StartTaskDto`/`FinishTaskDto` (taskId), `AssignTaskDto`.
- [ ] `POST /tasks/:id/time/start` → crea `TaskTimeLog{startedAt:now}` (rechaza si hay uno en curso del mismo user); `POST /tasks/:id/time/finish` → setea `endedAt`. Gate: `task:time:log` + dueño/asignado.
- [ ] `GET /projects/:id/assignees?perm=task:read` → `permissionService.usersWithPermissionOnProject('task:read', projectId)` (poblar el dropdown de asignación del wizard).
- [ ] Commit `feat(tasks): time-log endpoints + project assignees`.

### Task A.3: Wiring de `PermissionService` en tasks
**Files:** `apps/api/src/modules/tasks/tasks.service.ts` (list/read/create/assign).
- [ ] `list`: `const f = await permissions.scopeFilter(userId,'task:read')` → `where` Prisma (`none`/`own`→`{assignedToId:userId}` o `{createdById:userId}` según rol/`{projectId in ids}`). `create`/`assign`: `permissions.can(userId,'task:create'|'task:assign',{projectId})`.
- [ ] Test (mock Prisma/Fga) del scoping. Commit `feat(tasks): authorize via PermissionService`.

### Task A.4: Web — Kanban + Tabla + wizard + iniciar/finalizar
**Files:** `apps/web/src/pages/operaciones/tareas/*` (vistas + wizard), hooks.
- [ ] Toggle Tabla/Kanban (2 vistas fijas). Tabla con filtros+búsqueda; Kanban 4 columnas por `TaskStatus` con drag (Supervisor/Adm).
- [ ] Wizard crear-tarea (Servicio→Fase/Element→dataSpec→asignar→confirmar). Operador: botones Iniciar/Finalizar (llaman time/start|finish). ITO: read-only (sin acciones).
- [ ] Verificación visual con la app (cuando el stack corra). Commit `feat(web/operaciones): tasks Kanban+Table + execution flow`.

### Task A.5: Seeder Capstone
**Files:** `apps/api/prisma/seed-capstone.ts` (+ invocar desde seed).
- [ ] `Client "Capstone Copper" (enabledModules: inicio,operaciones)` → `Project "Mantos Blancos"` → `Service "Topografía"` → 1 user por rol (ITO/Operador/Supervisor/Adm_Contrato) → `Membership(rol@proyecto)` + sync FGA → 2-3 `Task` de ejemplo. Idempotente.
- [ ] Correr `db:seed`; verificar. Commit `feat(seed): Capstone Mantos Blancos flow`.

---

## FASE M5-B — MVP Albemarle (V-metric: visor 3D)

**Objetivo:** el ITO abre poza→DEM→visor 3D, dibuja perfil y compara; visibilidad de módulos por cliente. **DoD:** visor 3D interactivo con perfil y comparación sobre el `DemRaster` de muestra.

**Files (crear):** `model DemRaster` + `apps/api/src/modules/metrics/*` (endpoint aditivo `POST /metrics/dem-raster` + `GET /metrics/dem-raster?elementId=`); `apps/web/src/pages/v-metric/dem-viewer/*` (three.js); `apps/api/prisma/seed-albemarle.ts`.
**Files (modificar):** `Client.enabledModules`; nav del front (renderiza módulos según `enabledModules` ∩ permisos).
**Tareas (expandir a granular al ejecutar):** (1) `DemRaster` + migración + endpoints aditivos (no rompen al PyQt). (2) `Client.enabledModules` + gating de nav. (3) componente three.js: heightmap desde grid, OrbitControls, herramienta perfil (raycast/muestreo→gráfico 2D), comparación (2 mallas/diff). (4) dep `three` en `apps/web`. (5) seeder Albemarle (Salar de Atacama, pozas `Element`, `DemRaster` de muestra, roles+users). Permisos `vmetric:*` ya en el catálogo.

---

## FASE M5-C — Seeders + Railway deploy

**Objetivo:** ambos flujos demostrables en Railway. **DoD:** deploy reproducible que corre migraciones + seeders y sirve los 2 flujos.
**Tareas:** (1) consolidar seeders por cliente idempotentes + un `seed:mvp` que corre ambos. (2) `Dockerfile` api + build web; OpenFGA como servicio Railway (o contenedor in-memory + `fga:bootstrap` en release). (3) Postgres managed de Railway (`DATABASE_URL`), networking privado para la DB (DEVOPS-01). (4) release command: `prisma migrate deploy && pnpm db:seed`. (5) variables de entorno (Firebase real o emulador según ambiente).

---

## FASE 1 — Cimiento RBAC + Seeders (DETALLADA)

**Objetivo:** la fachada `PermissionService` funcionando, el catálogo+roles sembrados, `Asset.createdById`, seeders de mockup, y el fix del logo. **DoD global:** un admin crea un rol con scope vía API y el filtro se aplica server-side; `pnpm --filter api test` verde; seeders pueblan sin error.

### Task 1.1: Esquema Prisma — enums + columnas RBAC + Asset.createdById

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (modelos `Role`, `Permission`, `RolePermission`, `Asset`)
- Create (migración): `apps/api/prisma/migrations/<ts>_rbac_dynamic_scope/migration.sql` (vía Prisma)

- [ ] **Step 1: Editar `schema.prisma`** — agregar enums y columnas:

```prisma
enum PermissionScope { OWN  PROJECT  GLOBAL }
enum PermissionKind  { FUNCTIONAL  STRUCTURAL }

model Role {
  id          String           @id @default(cuid())
  key         String           @unique
  label       String
  description String?
  isSystem    Boolean          @default(false)
  createdById String?
  permissions RolePermission[]
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}

model Permission {
  id          String           @id @default(cuid())
  key         String           @unique
  label       String
  module      String           @default("system")
  kind        PermissionKind   @default(FUNCTIONAL)
  fgaRelation String?
  scopeable   Boolean          @default(true)
  roles       RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  scope        PermissionScope @default(PROJECT)
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
}
```
En `model Asset { ... }` agregar: `createdById String?` (nullable para no reescribir filas existentes).

- [ ] **Step 2: Generar la migración**

Run: `cd apps/api && npx prisma migrate dev --name rbac_dynamic_scope`
Expected: migración creada y aplicada; `prisma generate` regenera el cliente sin error.

- [ ] **Step 3: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(rbac): add PermissionScope/Kind, RolePermission.scope, Permission metadata, Asset.createdById"
```

### Task 1.2: Seed del catálogo de permisos + roles funcionales + SuperAdmin

**Files:**
- Create: `apps/api/prisma/seed-rbac.ts`
- Modify: `apps/api/prisma/seed.ts` (invocar `seedRbac`)

- [ ] **Step 1: Crear `seed-rbac.ts`** con el catálogo y el mapeo de roles existentes a grants. Estructura (formato `{ key, label, module, kind, fgaRelation?, scopeable }`):

```ts
import { PrismaClient, PermissionKind, PermissionScope } from '@prisma/client';

export const PERMISSION_CATALOG = [
  // system / rbac
  { key: 'user.create', label: 'Crear usuarios', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'user.update', label: 'Editar usuarios', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'user.suspend', label: 'Suspender/reactivar usuarios', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'role.create', label: 'Crear roles', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'role.update', label: 'Editar roles', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'role.delete', label: 'Eliminar roles', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'role.assign', label: 'Asignar roles', module: 'system', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'permission.matrix.view', label: 'Ver matriz de permisos', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'system.audit.view', label: 'Ver auditoría', module: 'system', kind: 'FUNCTIONAL', scopeable: false },
  // directorio
  { key: 'directory.view', label: 'Ver directorio', module: 'directorio', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'directory.view.extended', label: 'Ver datos extendidos', module: 'directorio', kind: 'STRUCTURAL', fgaRelation: 'can_view_directory_extended', scopeable: true },
  // proyectos / builder (M1)
  { key: 'project.create', label: 'Crear proyectos', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'project.read', label: 'Ver proyectos', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { key: 'project.update', label: 'Editar proyecto', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'project.kpi.define', label: 'Definir KPIs', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_define_kpi', scopeable: true },
  { key: 'servicetype.create', label: 'Crear tipo de servicio', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'servicetype.update', label: 'Editar tipo de servicio', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'servicetype.publish', label: 'Publicar tipo de servicio', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'service.create', label: 'Crear servicios', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_create_service', scopeable: true },
  { key: 'service.naming.configure', label: 'Configurar nomenclatura', module: 'proyectos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'measurement.submit', label: 'Subir mediciones', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_submit_measurements', scopeable: true },
  { key: 'measurement.read', label: 'Ver mediciones', module: 'proyectos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  // tareas
  { key: 'task.create', label: 'Crear tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_create_task', scopeable: true },
  { key: 'task.assign', label: 'Asignar tareas', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_assign_task', scopeable: true },
  { key: 'task.update', label: 'Mover/editar tareas', module: 'tareas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'task.read', label: 'Ver backlog', module: 'tareas', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  // documentos / plantillas (M2)
  { key: 'document.read', label: 'Ver documentos', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_view', scopeable: true },
  { key: 'document.upload', label: 'Subir documento', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_upload_revision', scopeable: true },
  { key: 'document.generate', label: 'Generar desde plantilla', module: 'documentos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'document.sign.qa', label: 'Firmar QA', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_sign_qa', scopeable: true },
  { key: 'document.sign.client', label: 'Firmar cliente', module: 'documentos', kind: 'STRUCTURAL', fgaRelation: 'can_sign_client', scopeable: true },
  { key: 'document.reject', label: 'Rechazar documento', module: 'documentos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'template.create', label: 'Crear plantillas', module: 'documentos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'template.update', label: 'Editar plantillas', module: 'documentos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'template.publish', label: 'Publicar plantillas', module: 'documentos', kind: 'FUNCTIONAL', scopeable: true },
  // finanzas
  { key: 'reimbursement.create', label: 'Crear reembolso', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'reimbursement.read', label: 'Ver reembolsos', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'reimbursement.approve', label: 'Aprobar reembolsos', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'reimbursement.import', label: 'Importar reembolsos', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'finance.print.batch', label: 'Impresión en lote', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'liquidation.read', label: 'Ver liquidaciones', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'liquidation.manage', label: 'Gestionar liquidaciones', module: 'finanzas', kind: 'FUNCTIONAL', scopeable: false },
  // horas extra (M3b)
  { key: 'overtime.create', label: 'Crear horas extra', module: 'horas-extra', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'overtime.read', label: 'Ver horas extra', module: 'horas-extra', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'overtime.authorize', label: 'Autorizar horas extra', module: 'horas-extra', kind: 'STRUCTURAL', fgaRelation: 'can_authorize_overtime', scopeable: true },
  // activos / vehículos (M3c)
  { key: 'asset.read', label: 'Ver activos', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_view_list', scopeable: true },
  { key: 'asset.create', label: 'Crear activos', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_create', scopeable: true },
  { key: 'asset.checklist.run', label: 'Ejecutar checklist', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_run_checklist', scopeable: true },
  { key: 'asset.location.view', label: 'Ver ubicación', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_view_location', scopeable: true },
  { key: 'asset.history.view', label: 'Ver históricos', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_view_history', scopeable: true },
  { key: 'asset.doc.upload', label: 'Subir doc de activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_upload_doc', scopeable: true },
  { key: 'asset.doc.approve', label: 'Aprobar doc de activo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_upload_and_approve_doc', scopeable: true },
  { key: 'vehicle.use.request', label: 'Solicitar uso de vehículo', module: 'activos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'vehicle.use.authorize', label: 'Autorizar uso de vehículo', module: 'activos', kind: 'STRUCTURAL', fgaRelation: 'can_authorize_use', scopeable: true },
  { key: 'checklist.template.manage', label: 'Editar plantillas de checklist', module: 'activos', kind: 'FUNCTIONAL', scopeable: true },
  // insumos / proveedores / bodegas
  { key: 'supply.read', label: 'Ver insumos', module: 'recursos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'supply.manage', label: 'Gestionar insumos', module: 'recursos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'provider.read', label: 'Ver proveedores', module: 'recursos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'provider.manage', label: 'Gestionar proveedores', module: 'recursos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'provider.rate', label: 'Evaluar proveedores', module: 'recursos', kind: 'FUNCTIONAL', scopeable: false },
  { key: 'warehouse.read', label: 'Ver bodegas', module: 'recursos', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'warehouse.manage', label: 'Gestionar bodegas', module: 'recursos', kind: 'FUNCTIONAL', scopeable: true },
  // herramientas / dashboard
  { key: 'tool.coords.use', label: 'Transformación de coordenadas', module: 'herramientas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'tool.edge.detect', label: 'Detección de orilla IA', module: 'herramientas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'dashboard.configure', label: 'Configurar dashboard', module: 'herramientas', kind: 'FUNCTIONAL', scopeable: true },
  { key: 'gamification.view', label: 'Ver ranking/logros', module: 'herramientas', kind: 'FUNCTIONAL', scopeable: true },
] as const;

// Roles funcionales existentes → grants (scope por defecto PROJECT salvo nota)
export const SEED_ROLES: Record<string, { label: string; grants: Array<[string, PermissionScope]> }> = {
  operator:       { label: 'Operador',        grants: [['measurement.submit','PROJECT'],['measurement.read','PROJECT'],['task.create','PROJECT'],['task.read','PROJECT'],['document.upload','PROJECT'],['asset.read','PROJECT']] },
  qa:             { label: 'QA',              grants: [['measurement.read','PROJECT'],['document.read','PROJECT'],['document.sign.qa','PROJECT'],['task.read','PROJECT']] },
  finance:        { label: 'Finanzas',        grants: [['reimbursement.read','PROJECT'],['reimbursement.approve','PROJECT'],['liquidation.read','PROJECT']] },
  viewer:         { label: 'Observador',      grants: [['project.read','PROJECT'],['document.read','PROJECT'],['task.read','PROJECT']] },
  client_ito:     { label: 'Cliente / ITO',   grants: [['project.read','PROJECT'],['document.read','PROJECT'],['document.sign.client','PROJECT']] },
  project_creator:{ label: 'Creador de proyecto', grants: [['service.create','PROJECT'],['project.kpi.define','PROJECT'],['task.assign','PROJECT'],['measurement.submit','PROJECT'],['servicetype.create','GLOBAL']] },
};
// SuperAdmin: rol isSystem sin grants explícitos; PermissionService corto-circuita.
```
Función `seedRbac(prisma)`: `upsert` cada permiso (por `key`), `upsert` cada rol (`isSystem: true`), y crear `RolePermission` con su `scope`. Idempotente.

- [ ] **Step 2: Invocar desde `seed.ts`** y correr `npx prisma db seed`. Expected: filas en `Permission`/`Role`/`RolePermission` sin error; re-correr no duplica.
- [ ] **Step 3: Commit** — `feat(rbac): seed permission catalog + functional roles as scoped grants`

### Task 1.3: `PermissionService` (fachada) — TDD

**Files:**
- Create: `apps/api/src/authz/permission.service.ts`
- Create: `apps/api/test/authz/permission.service.spec.ts`
- Create: `packages/shared-types/src/authz.ts` (los tipos de 0.1)
- Modify: `apps/api/src/authz/authz.module.ts` (proveer/exportar `PermissionService`)

- [ ] **Step 1: Escribir el test que falla** (mocks a mano estilo `assets.service.spec.ts`):

```ts
// permission.service.spec.ts (núcleo)
const prisma = { membership: { findMany: vi.fn() }, rolePermission: { findMany: vi.fn() } } as any;
const fga = { check: vi.fn() } as any;
const svc = new PermissionService(prisma, fga, /*superAdminIds*/ ['user:super']);

it('SuperAdmin corto-circuita a allow/none', async () => {
  expect(await svc.can('super', 'project.create')).toEqual({ effect: 'allow', filter: { kind: 'none' } });
});
it('sin grants → deny', async () => {
  prisma.membership.findMany.mockResolvedValue([]);
  expect(await svc.can('u1', 'reimbursement.approve')).toEqual({ effect: 'deny', filter: { kind: 'none' } });
});
it('OWN → filtro own; recurso ajeno denegado', async () => {
  prisma.membership.findMany.mockResolvedValue([{ roleKey: 'r', scopeType: 'ORGANIZATION', scopeId: 'gmt' }]);
  prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'OWN', permission: { key: 'overtime.read', kind: 'FUNCTIONAL', fgaRelation: null } }]);
  expect(await svc.can('u1', 'overtime.read', { createdById: 'u2' })).toMatchObject({ effect: 'deny' });
  expect(await svc.can('u1', 'overtime.read', { createdById: 'u1' })).toMatchObject({ effect: 'allow', filter: { kind: 'own' } });
});
it('PROJECT estructural delega en fga.check', async () => {
  prisma.membership.findMany.mockResolvedValue([{ roleKey: 'operator', scopeType: 'PROJECT', scopeId: 'p1' }]);
  prisma.rolePermission.findMany.mockResolvedValue([{ scope: 'PROJECT', permission: { key: 'measurement.submit', kind: 'STRUCTURAL', fgaRelation: 'can_submit_measurements' } }]);
  fga.check.mockResolvedValue(true);
  const d = await svc.can('u1', 'measurement.submit', { projectId: 'p1' });
  expect(fga.check).toHaveBeenCalledWith({ user: 'user:u1', relation: 'can_submit_measurements', object: 'project:p1' });
  expect(d.effect).toBe('allow');
});
it('gana el scope más fuerte (GLOBAL > PROJECT)', async () => {
  prisma.membership.findMany.mockResolvedValue([{ roleKey: 'r', scopeType: 'ORGANIZATION', scopeId: 'gmt' }]);
  prisma.rolePermission.findMany.mockResolvedValue([
    { scope: 'PROJECT', permission: { key: 'reimbursement.read', kind: 'FUNCTIONAL', fgaRelation: null } },
    { scope: 'GLOBAL',  permission: { key: 'reimbursement.read', kind: 'FUNCTIONAL', fgaRelation: null } },
  ]);
  expect(await svc.scopeFilter('u1', 'reimbursement.read')).toEqual({ kind: 'none' });
});
```

- [ ] **Step 2: Correr y verificar que falla** — `pnpm --filter api test permission.service` → FAIL (módulo no existe).
- [ ] **Step 3: Implementar `PermissionService`** con la resolución de 0.1:

```ts
@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaService, private fga: FgaService,
    @Inject('SUPER_ADMIN_IDS') private superAdminIds: string[]) {}

  async scopeFilter(userId: string, permissionKey: string): Promise<ScopeFilter | null> {
    if (this.superAdminIds.includes(userId)) return { kind: 'none' };
    const memberships = await this.prisma.membership.findMany({ where: { userId } });
    if (memberships.length === 0) return null;
    const roleKeys = [...new Set(memberships.map(m => m.roleKey))];
    const grants = await this.prisma.rolePermission.findMany({
      where: { role: { key: { in: roleKeys } }, permission: { key: permissionKey } },
      include: { permission: true },
    });
    if (grants.length === 0) return null;
    if (grants.some(g => g.scope === 'GLOBAL')) return { kind: 'none' };
    if (grants.some(g => g.scope === 'PROJECT')) {
      const ids = await this.projectIdsForUser(userId, memberships);
      return { kind: 'projects', ids };
    }
    return { kind: 'own' };
  }

  async can(userId: string, permissionKey: string, resource?: ResourceRef): Promise<PermissionDecision> {
    const filter = await this.scopeFilter(userId, permissionKey);
    if (filter === null) return { effect: 'deny', filter: { kind: 'none' } };
    if (!resource) return { effect: 'allow', filter };
    if (filter.kind === 'none') return { effect: 'allow', filter };
    if (filter.kind === 'own')
      return { effect: resource.createdById === userId ? 'allow' : 'deny', filter };
    // PROJECT: estructural → fga.check; funcional → pertenencia al set
    const grant = await this.grantFor(userId, permissionKey);
    if (resource.projectId && grant?.permission.kind === 'STRUCTURAL' && grant.permission.fgaRelation) {
      const ok = await this.fga.check({ user: `user:${userId}`, relation: grant.permission.fgaRelation, object: `project:${resource.projectId}` });
      return { effect: ok ? 'allow' : 'deny', filter };
    }
    return { effect: resource.projectId && filter.ids.includes(resource.projectId) ? 'allow' : 'deny', filter };
  }

  async usersWithPermissionOnProject(permissionKey: string, projectId: string): Promise<string[]> {
    // B-now: vía Membership; C-later: fga.listUsers. Roles que otorgan el permiso:
    const grants = await this.prisma.rolePermission.findMany({ where: { permission: { key: permissionKey } }, include: { role: true } });
    const roleKeys = grants.map(g => g.role.key);
    const ms = await this.prisma.membership.findMany({ where: { roleKey: { in: roleKeys }, scopeType: 'PROJECT', scopeId: projectId } });
    return [...new Set(ms.map(m => m.userId))];
  }

  private async projectIdsForUser(userId: string, memberships: Membership[]): Promise<string[]> {
    const direct = memberships.filter(m => m.scopeType === 'PROJECT').map(m => m.scopeId);
    const deptIds = memberships.filter(m => m.scopeType === 'DEPARTMENT').map(m => m.scopeId);
    const deptProjects = deptIds.length
      ? (await this.prisma.project.findMany({ where: { departmentId: { in: deptIds } }, select: { id: true } })).map(p => p.id)
      : [];
    return [...new Set([...direct, ...deptProjects])];
  }
  private async grantFor(userId: string, permissionKey: string) { /* findFirst con include permission */ }
}
```

- [ ] **Step 4: Correr tests** → PASS. **Step 5: Commit** — `feat(authz): PermissionService facade (can/scopeFilter/usersWithPermissionOnProject)`

### Task 1.4: Probar la fachada en un endpoint real (migrar el path de listas de assets)

**Files:** Modify `apps/api/src/modules/assets/assets.service.ts:242-291` (`listAll`)

- [ ] **Step 1:** Reemplazar el armado SQL manual de `allowedProjectIds` por `const f = await this.permissions.scopeFilter(userId, 'asset.read');` y construir el `where` Prisma desde `f` (`none`→sin filtro; `own`→`{ createdById: userId }`; `projects`→`{ projectId: { in: f.ids } }`). Inyectar `PermissionService`.
- [ ] **Step 2: Test** — un operator de p1 ve activos de p1 y no de p2 (mock o e2e contra seed). **Step 3: Commit** — `refactor(assets): list via PermissionService.scopeFilter (proof of facade)`

### Task 1.5: Backfill `Asset.createdById` (migración de datos, separada)

**Files:** Create `apps/api/prisma/migrations/<ts>_backfill_asset_createdby/migration.sql`

- [ ] **Step 1:** `npx prisma migrate dev --create-only --name backfill_asset_createdby`; en el SQL, set `createdById` = primer `AssetHistoryEntry.userId` del activo (o el admin de la org como fallback). Lotes con `FOR UPDATE SKIP LOCKED` si hay volumen (dev: bajo). **Step 2:** aplicar. **Step 3: Commit** — `chore(assets): backfill createdById`

### Task 1.6: Seeders de mockup (⭐ pedido explícito)

**Files:** Create `apps/api/prisma/seed-mockup.ts`; Modify `apps/api/prisma/seed.ts`

- [ ] **Step 1:** `seedMockup(prisma)` idempotente que crea: 1 organización (`gmt`), 2 clientes, 2 departamentos, 3-4 proyectos; ~8 usuarios cubriendo cada rol (superadmin, project_creator, operator, qa, finance, viewer, client_ito); `Membership` que cablea usuarios↔proyectos y **sincroniza a FGA** (vía `syncMembershipToFGA` para los estructurales); 2-3 vehículos (`Asset` tipo `VEHICULO`) + 1 `ChecklistTemplate` de vehículo. (Los `ServiceType` de mockup se siembran en la Fase 2, donde existe el modelo.)
- [ ] **Step 2:** correr `npx prisma db seed`; verificar conteos. **Step 3: Commit** — `feat(seed): mockup data (orgs, projects, users, memberships, vehicles)`

### Task 1.7: Fix proporción del logo (quick win UI)

**Files:** Modify `apps/web/src/components/layout/sidebar.tsx:116-126`

- [ ] **Step 1:** subir el bar de marca de `h-14` a `h-16`; `logoMid` de `h-8` a `h-11 max-w-[160px]`; `logoCompact` de `h-8` a `h-10`. Mantener `w-auto object-contain` y el chevron con `ml-auto`. **Step 2:** verificar visualmente expandido/colapsado + drawer móvil. **Step 3: Commit** — `fix(web): enlarge GMT logo proportions in sidebar`

---

## FASE 2 — Módulo 1: Builder dinámico de servicios

**Objetivo:** meta-modelo per-service-type + migración de metrics + UI builder + nomenclatura por servicio. **DoD:** un admin crea un `ServiceType` con N niveles y campos, lo publica, y un servicio captura datos validados contra él; el correlativo de documento usa el patrón del servicio sin colisión.

**Files (crear):** `schema.prisma` (ServiceType/ServiceTypeLevel/FieldDef/InstanceNode/FieldValue/DocumentSequence + enums) · `apps/api/src/modules/service-types/*` (module/controller/service/dto) · `apps/api/src/modules/metrics/metrics-compat.shim.ts` (resuelve `variableCode→FieldDef` para PyQt) · `apps/web/src/pages/operaciones/service-builder/*` · `packages/shared-types/src/service-model.ts` (unión de `FieldDataType`, validación Zod).
**Files (modificar):** `Service` (+serviceTypeId/serviceTypeVersion) · `project-documents.service.ts` (`generateDocumentCode` lee segmentos del servicio + usa `DocumentSequence`).

**Tareas (expandir a plan granular al iniciar):** (1) schema + migración aditiva de tablas nuevas. (2) `ServiceTypeService` CRUD + publish (congela versión). (3) Validación de captura contra el `FieldDef` (switch exhaustivo `FieldDataType`, cero `any`). (4) Migración expand-contract: backfill `DataPoint→InstanceNode/FieldValue` (lotes), shim PyQt, drop diferido de `Phase/Variable/DataPoint`. (5) `DocumentSequence` transaccional reemplaza `count()+while`. (6) UI builder (3 zonas: árbol de niveles · canvas de campos · panel nomenclatura con preview). (7) Permisos `servicetype.*`/`service.naming.configure` ya sembrados en F1.

## FASE 3 — Módulo 4: UI de la matriz de roles

**Objetivo:** que el admin cree roles y asigne scopes desde la UI. **DoD:** crear rol → marcar permisos+scope → guardar → un usuario con ese rol ve el filtro aplicado.

**Files (crear):** `apps/api/src/modules/roles/*` (endpoints de la superficie API M4: `GET /permissions`, `roles` CRUD, `PUT /roles/:id/permissions`, `POST/DELETE /users/:id/roles`, `GET /me/permissions`) · `apps/web/src/pages/configuracion/roles/*` (matriz permisos×scope agrupada por `module`).
**Files (modificar):** `apps/web/src/pages/usuarios/roles-dialog.tsx` (asignación con scopeType/scopeId).

**Tareas:** (1) endpoints + DTOs `class-validator` (validar scope∈válidos del permiso → 422). (2) sync a FGA solo para roles estructurales. (3) matriz UI con selector segmentado Propios/Proyecto/Todo (oculto si `!scopeable`). (4) `GET /me/permissions` para pintar affordances.

## FASE 4 — Módulo 3: RRHH/Logística

**Objetivo:** horas extra completas + gate de checklist de vehículo + capture de reembolso. **DoD:** solicitud de horas extra con proyecto+autorizador+entrada/salida (horas derivadas); uso de vehículo no aprobable sin checklist OK.

**Files (modificar):** `OvertimeRequest` (expand-contract: +projectId,+authorizerId,+startTime,+endTime; hours derivado; date deprecado) · `overtime.dto.ts`/`overtime.service.ts` · `apps/web/src/pages/finanzas/horas-extra.tsx` (proyecto filtrado + autorizador vía `GET /projects/:id/authorizers` que usa `usersWithPermissionOnProject('overtime.authorize', …)`) · `reembolsos.tsx` (`capture="environment"` + split foto/PDF).
**Files (crear):** `VehicleUseRequest` + `apps/api/src/modules/vehicle-use/*` (gate: aprobar exige `inspectionSubmissionId` con checklist sin fallas) · UI de solicitud que reemplaza el "Tomar en Uso" libre.
**FGA:** agregar relaciones `can_authorize_overtime`/`can_authorize_use` a `model.fga` (estructural; semilla de grant ya existe).

## FASE 5 — Módulo 2: Template Builder

**Objetivo:** armar informes con bloques ligados a `FieldDef` + render React/PDF + snapshot. **DoD:** plantilla publicada genera un `ProjectDocument` en `PENDIENTE_QA` con `renderSnapshot`, y la previsualización del doc aprobado es estable.

**Files (crear):** `ReportTemplate`/`TemplateBlock` + `apps/api/src/modules/report-templates/*` · `renderTemplateToPdf` (`@react-pdf/renderer`) → alimenta el `stampDocumentPdf` existente · `packages/shared-types/src/report-blocks.ts` (unión `Block` + Zod) · `apps/web/src/pages/operaciones/template-builder/*` (paleta + lienzo WYSIWYG) · `<BlockRenderer>` compartido.
**Files (modificar):** `ProjectDocument` (+templateId,+renderSnapshot) · `project-documents.service.ts` (`generateFromTemplate`).

**Tareas:** (1) modelos + binding por `fieldKey`. (2) resolver `(template,destino)→árbol resuelto`. (3) doble renderer (React + PDF→stamp). (4) snapshot inmutable al generar. (5) builder UI drag-and-drop. (6) ambos flujos (ensamblado/PDF crudo) caen en el `ApprovalWorkflow` existente.

## FASE 6 — (Opcional) Promoción a Opción C

**Objetivo:** reverse-queries con herencia. **Tareas:** espejar grants a tuplas FGA sobre un tipo genérico `role`; extender `FgaClientLike` con `listUsers`/`listObjects`; reapuntar `usersWithPermissionOnProject` y `scopeFilter` (proyectos) a FGA. Firma de la fachada sin cambios.

---

## Self-Review (cobertura del análisis)

- **Esquema BD (EAV/JSONB + RRHH + RBAC con scopes):** §0.2 + F1 (RBAC), F2 (builder), F4 (RRHH), F5 (templates). ✔
- **Levantamiento de permisos:** §0.3 + array completo en Tarea 1.2. ✔
- **Arquitectura template builder:** F5 + diseño en chat B.2 (binding `fieldKey`, snapshot). ✔
- **Flujo UI/UX + fix logo:** §Apéndice UI (abajo) + Tarea 1.7. ✔
- **Plan en fases + seeders en Fase 1:** Tarea 1.6. ✔

## Apéndice UI/UX

- **Builder de Servicios (F2):** 3 zonas — árbol de niveles (drag→anida) · canvas de `FieldDef` del nivel · panel propiedades + editor de nomenclatura (segmentos arrastrables con preview del código). Barra: `BORRADOR→PUBLICADO`.
- **Template Builder (F5):** 2 zonas — paleta de bloques + lista de `FieldDef` arrastrables · lienzo WYSIWYG con datos de muestra; cada bloque abre su `config`.
- **Matriz de Roles (F3):** permisos×scope agrupados por `module`; selector segmentado Propios/Proyecto/Todo (oculto si `!scopeable`).
- **Logo (F1):** `h-14→h-16`, `logoMid h-8→h-11 max-w-[160px]`, `logoCompact h-8→h-10`.
- **Transversal (CLAUDE.md):** mobile-first, estados vacío/carga/error siempre, iconos `lucide-react`.
