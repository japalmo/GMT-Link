# Plan Maestro — Demo GMT Link + Completar V-Metric

> **Para workers agénticos:** ejecutar con superpowers:subagent-driven-development. Dos tracks INDEPENDIENTES (A=GMT Link, B=V-Metric) que corren en paralelo. Dentro de cada track las tareas usan checkbox `- [ ]`.

**Goal:** Dejar estables las funciones básicas del usuario trabajador GMT (demo web en Railway) y terminar V-Metric completa sobre el shell nuevo. Ambas demo-ready mañana.

**Arquitectura:** GMT Link ya está ~80% construido (52 modelos Prisma, 27 módulos NestJS, 96 permisos/8 roles, primitivas §5, design system shadcn/ui). El trabajo es (1) datos+API nuevos para la jerarquía Cliente→Faena→Proyecto y asignación de trabajadores, (2) reorganización de navegación (Proyectos como sección propia, Recursos en subsecciones), (3) widgets de Inicio, (4) gating por roleKeys. V-Metric: rewrap de las vistas viejas funcionales (`views/*.py`, `core.py`, `viz.py`, `repository.py`) dentro del `AppShell` nuevo.

**Tech stack:** NestJS 11 + Prisma 6 + OpenFGA + Postgres (Railway) · React 19 + Vite + Tailwind v4 + shadcn/ui · PySide6/Qt.

**Decisiones fijadas:** Faena = nivel nuevo. Proyectos funcional e2e. Ambas apps mañana. Gating demo = `profile.roleKeys` client-side. "Orilla playa" = shore-detect existente. Placeholders minimizados.

**Regla de honestidad:** marcar en UI lo que sea placeholder navegable (idealmente nada, pero si algo no alcanza: telemetría real, editor avanzado de dataSpec).

---

## TRACK A — GMT Link (demo usuario trabajador)

Rutas base: `nodes/backend-central` (BE), `nodes/web/src` (WEB), `packages/contracts` (tipos compartidos).

### Bloque A0 — Fundaciones de datos + permisos (BACKEND, bloqueante del resto de A)

#### Tarea A0.1: Schema Prisma — Faena, tipos de proyecto, asignación de trabajadores, frecuencia de servicio, variable enriquecida

**Files:** `BE/prisma/schema.prisma` (modificar), nueva migración `BE/prisma/migrations/`.

Añadir enums:
```prisma
enum ProjectType { SPOT OBRAS_CIVILES RUTINARIO }
enum FaenaStatus { PLANIFICADA EN_PROGRESO COMPLETADA }
enum ProjectWorkerStatus { ACTIVO INACTIVO }
enum ServiceFrequency { DIARIA SEMANAL QUINCENAL MENSUAL A_DEMANDA }
```
Añadir valores al enum `VariableType` existente (Postgres `ADD VALUE`, no romper SCALAR/FILE/LIST): `ENTERO DECIMAL BOOLEAN METROS M3 TEXTO IMAGEN PLANO POLIGONO ORTOFOTO PDF GEODATA OTRO`.

Nuevo modelo:
```prisma
model Faena {
  id           String      @id @default(cuid())
  code         String      // 3-4 chars, único por cliente
  name         String
  clientId     String
  client       Client      @relation(fields: [clientId], references: [id])
  supervisorId String?
  supervisor   User?       @relation("FaenaSupervisor", fields: [supervisorId], references: [id])
  status       FaenaStatus @default(PLANIFICADA)
  startDate    DateTime?
  endDate      DateTime?
  projects     Project[]
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  @@unique([clientId, code])
}

model ProjectWorkerAssignment {
  id        String              @id @default(cuid())
  projectId String
  project   Project             @relation(fields: [projectId], references: [id])
  userId    String
  user      User                @relation("ProjectAssignments", fields: [userId], references: [id])
  roleKey   String
  status    ProjectWorkerStatus @default(ACTIVO)
  startDate DateTime?
  endDate   DateTime?
  createdAt DateTime            @default(now())
  @@unique([projectId, userId, roleKey])
}
```
Extender `Project`: `contractNumber String?`, `projectType ProjectType?`, `faenaId String?` + `faena Faena? @relation(...)`, `projectAdminId String?` + `projectAdmin User? @relation("ProjectAdmin", ...)`, `workers ProjectWorkerAssignment[]`.
Extender `Client`: `faenas Faena[]`.
Extender `Service`: `frequency ServiceFrequency?`.
Extender `Variable`: `description String?`.
Extender `User`: relaciones inversas `faenasSupervised Faena[] @relation("FaenaSupervisor")`, `projectsAdmin Project[] @relation("ProjectAdmin")`, `projectAssignments ProjectWorkerAssignment[] @relation("ProjectAssignments")`.

**Acceptance:** `pnpm --filter backend-central prisma migrate dev` corre limpio; `prisma generate` OK; enum ADD VALUE no rompe datos existentes.

#### Tarea A0.2: Permisos nuevos (catálogo + FGA)

**Files:** `BE/prisma/seed.ts` (PERMISSIONS + ROLES grants), `BE/fga/model.fga` (relación `can_manage_team`), `BE/src/modules/roles/composable-permissions.ts`.

Añadir a PERMISSIONS: `client:create` (FUNCTIONAL, module `clientes`, scopeable=false), `faena:create` (FUNCTIONAL, module `proyectos`, scopeable=false), `project:team:manage` (STRUCTURAL, fgaRelation `can_manage_team`), `asset:fields:edit` (FUNCTIONAL, module `recursos`). Reusar existentes: `project:create`, `asset:create`, `supplier:read`, `warehouse:read` (si no existen como gate, marcarlos FUNCTIONAL).
En `model.fga` tipo `project`: `define can_manage_team: [user] or project_creator or admin`.
Grants: `org_admin` recibe todos; `department_admin` recibe `client:create`+`faena:create`+`project:create`+`project:team:manage`. `operator/qa/finance/viewer/client_ito` NO reciben los de creación.

**Acceptance:** `pnpm --filter backend-central prisma db seed` idempotente; `scripts/fga-bootstrap.ts` recarga modelo sin error; un usuario `operator` NO pasa `can(client:create)` y `org_admin` sí (test unit del PermissionService).

#### Tarea A0.3: ClientsModule (CRUD)

**Files:** crear `BE/src/modules/clients/{clients.module.ts,clients.controller.ts,clients.service.ts,dto/}`; registrar en `BE/src/app.module.ts`.

Endpoints: `POST /clients` (@RequirePermission funcional `client:create`), `GET /clients` (lista con métricas: `projectsCount`, `activeProjectsCount`, `pendingAlertsCount`), `GET /clients/:id`, `PATCH /clients/:id`. DTO `CreateClientDto { code(≤4), name, rut }`. Métricas: contar Project por clientId (histórico/activo por status), alertas = tasks PENDIENTE en proyectos del cliente.

**Acceptance:** e2e: crear cliente con org_admin → 201; con operator → 403; GET devuelve métricas correctas sobre datos seed.

#### Tarea A0.4: FaenasModule + extensión ProjectsModule

**Files:** `BE/src/modules/projects/` (extender) o nuevo `BE/src/modules/faenas/`.

Endpoints: `POST /clients/:id/faenas` (`faena:create`), `GET /clients/:id/faenas` (con métricas por faena), `GET /faenas/:id`, `PATCH /faenas/:id`. Extender `POST /projects` DTO con `contractNumber, projectType, faenaId, projectAdminId`. `GET /projects?faenaId=`. `GET /users?role=project_admin` (o reusar `/tasks/assignees`) para el selector de administrador de proyecto.
Worker assignment: `POST /projects/:id/assignments` (`project:team:manage`), `GET /projects/:id/assignments`, `PATCH /projects/:id/assignments/:aid`, `DELETE /projects/:id/assignments/:aid`. Sincronizar tupla FGA `project#worker` opcional (diferible; para demo basta persistir + roleKey).
Fases/Servicios: `PUT /metrics/phases/:id/dataspec` guarda variables (code, name, type∈VariableType nuevo, unit, description, required) vía Variable existente; `PATCH /projects/:id/services/:sid` set `frequency` para RUTINARIO.

**Acceptance:** e2e crea Cliente→Faena→Proyecto(tipo SPOT)→asigna trabajador→define fase con variables tipadas; GET reconstruye la jerarquía.

#### Tarea A0.5: Tipos compartidos

**Files:** `packages/contracts/src/` (+ re-export en `WEB/src/types/`).
Añadir `ClientView`, `FaenaView`, `ProjectType`, `ProjectWorkerAssignmentView`, `VariableType` ampliado, `ServiceFrequency`, inputs `CreateClientInput/CreateFaenaInput/CreateProjectInput(ext)/AssignWorkerInput`.

**Acceptance:** `pnpm --filter @gmt-platform/contracts build` OK; WEB compila con los tipos nuevos.

### Bloque A1 — Navegación: Proyectos como sección + Operaciones limpia (WEB)

#### Tarea A1.1: Nav item + ruta /proyectos; sacar Proyectos de Operaciones
**Files:** `WEB/src/components/layout/nav-items.ts` (+ item `{label:'Proyectos', to:'/proyectos', icon:Briefcase, module:'proyectos'}`), `WEB/src/App.tsx` (ruta lazy `/proyectos/*`), `WEB/src/pages/operaciones/operaciones-tabs.tsx` (quitar tab Proyectos → solo Backlog + Documentos). Backend `GET /auth/me` debe incluir módulo `proyectos` para el usuario demo.
**Acceptance:** sidebar muestra Proyectos; Operaciones solo Backlog+Documentos; rutas viejas `/operaciones/proyectos` redirigen a `/proyectos`.

### Bloque A2 — Sección Proyectos (4 capas) (WEB, depende de A0+A1)

Patrón por capa: grid de Cards + buscador (RoleScopedList) + filtro + botón crear gateado por `profile.roleKeys`. Reusar `WEB/src/pages/operaciones/proyectos.tsx` como base del catálogo/detalle.

- **A2.1 Capa 1 Clientes:** `WEB/src/pages/proyectos/index.tsx` — cards de cliente (nombre + carrusel métricas: histórico/activos/alertas), buscador+filtro, `CrearClienteDialog` (gate `client:create`). Consume `GET /clients`.
- **A2.2 Capa 2 Faenas:** `WEB/src/pages/proyectos/cliente/[clientId].tsx` — cards de faena + métricas, `CrearFaenaDialog` (gate `faena:create`).
- **A2.3 Capa 3 Proyectos:** `.../faena/[faenaId].tsx` — cards de proyecto, `CrearProyectoDialog` (form: nombre, num contrato, cliente+faena autocompletados con alerta si cambia, descripción, tipo, administrador de proyecto=select usuarios). Gate `project:create`.
- **A2.4 Capa 4 Vista de proyecto:** `.../proyecto/[projectId].tsx` con tabs:
  - **Trabajadores** (gate rol): lista de asignados con rol + add/edit/delete (`/projects/:id/assignments`).
  - **Documentación:** 4 secciones (bases técnicas / procedimientos / contratos / otros) enlazadas a ProjectDocument existente (crear si falta categoría).
  - **Fases** (SPOT/OBRAS_CIVILES) o **Servicios** (RUTINARIO, con frecuencia): editor de datos esperados (tipo∈VariableType + descripción) por fase/servicio.

**Acceptance:** navegación completa Cliente→Faena→Proyecto→Vista con datos reales; crear en cada capa persiste; botones de crear ocultos para usuario default.

### Bloque A3 — Inicio: widgets del trabajador (WEB)
**Files:** `WEB/src/pages/dashboard/widgets/` + `registry.tsx`.
- **A3.1** `account-config-progress`: % completitud (avatar, contacto, docs, CV) client-side sobre `/profile/me`.
- **A3.2** `mis-tareas-pendientes`: `GET /tasks?assignedToId=me&status=PENDIENTE`, lista con link a `/operaciones/backlog`.
- **A3.3** `accesos-directos`: botones → Checklist Vehículos (`/recursos` vehículos), Horas Extra (abre `NewOvertimeDialog`), Orilla de Playa (`/herramientas` shore-detect).
**Acceptance:** los 3 widgets aparecen por default para el usuario trabajador y funcionan.

### Bloque A4 — Recursos: subsecciones + log + checklist download (WEB, backend menor)
**Files:** `WEB/src/pages/recursos/index.tsx`, `BE/src/modules/assets/` (PDF checklist).
- **A4.1** Separar tabs **Equipos** / **Vehículos** (hoy subtabs de Activos); Insumos default; **Proveedores/Bodegas** gateados por roleKey.
- **A4.2** Tab **Historial** en detalle (usa `getHistory` existente) como log de uso; botón **Reportar uso** → checklist submit existente.
- **A4.3** Botón **Checklist camionetas** (vehículos) con campos ya definidos; al enviar: `POST /assets/:id/checklist/submissions/:sid/pdf` (nuevo, pdfkit) → ofrecer descarga + queda en log.
- **A4.4** Estado: mapear `defectuoso`→ nuevo valor o `MANTENIMIENTO`; `no disponible`→`BAJA` (o extender AssetStatus).
**Acceptance:** Equipos y Vehículos como subsecciones; historial visible; checklist descarga PDF y registra.

### Bloque A5 — Gating + Perfil (WEB)
- **A5.1** Hook `useHasRole(roleKeys[])` sobre `profile.roleKeys`; componente `<GatedAction>`. Gatea botones crear cliente/faena/proyecto/equipo y tabs Proveedores/Bodegas.
- **A5.2** Perfil: verificar edición propia OK (sin cambios funcionales).
**Acceptance:** usuario default no ve acciones especiales; admin sí.

---

## TRACK B — V-Metric (completar sobre shell nuevo)

Rutas: `v-metric/poza/ui/*` (shell nuevo), `v-metric/poza/*` (lógica existente reutilizable).

### Bloque B0 — Wiring + sesión (bloqueante del resto de B)
- **B0.1** `poza/ui/session.py`: `SessionBus` (QObject singleton) con signals `logged_in(GmtSession)`, `logged_out()`, y `DataBus` con `element_created/updated/deleted`. Evita estado global disperso.
- **B0.2** `poza/ui/pages/login_page.py`: `LoginPage(QWidget)` — inputs email/password (estilo nuevo), PrimaryButton, spinner, manejo `GmtAuthError`. Llama `gmt_auth.login()`, persiste con `credential_store`, emite `logged_in`.
- **B0.3** `poza/ui/main.py`: entrypoint nuevo. `init_db()`, `try_restore_session()` → LoginPage o AppShell; inyecta `Repository` + `GmtSession` a cada page; `TopBar.logout` → `credential_store.clear` + volver a LoginPage. `app.py` pasa a llamar `poza.ui.main:main`.
**Acceptance:** `python -m poza.ui.main` arranca en Login; login exitoso entra al AppShell con el usuario en la TopBar; logout vuelve a Login; sesión se restaura al reabrir.

### Bloque B1 — Dashboard real
**Files:** `poza/ui/pages/dashboard_page.py` (reusa StatCard nuevo + lógica de `views/dashboard_view.py`/`repository.py`).
StatCards vivos: elementos activos (`repo`), pendientes QA, emitidos este mes; historial reciente (lista). MapWidget (ortho) opcional embebido.
**Acceptance:** cifras reales desde SQLite; refresco al cambiar datos vía DataBus.

### Bloque B2 — Elementos (catálogo)
**Files:** `poza/ui/pages/elements_page.py` (reusa `views/elements_view.py` + `ElementDetailDialog`).
QTableWidget (estilo nuevo) con elementos; Nuevo/Editar/Eliminar; map picker de polígono. Persiste vía Repository; emite DataBus.
**Acceptance:** CRUD de elementos funcional dentro del AppShell.

### Bloque B3 — Workspace (motor real, rewrap SIN reescribir)
**Files:** `poza/ui/pages/workspace_page.py` que **embebe** `DemViewerWidget` + `LayersPanel` + controles de cálculo desde `views/workspace_view.py`; usa `core.py`/`viz.py`/`CalculationWorker` tal cual.
Layout: selector de elemento → carga DEM → inputs de cota (sal/agua/oclusión) → Calcular (worker en background + spinner) → resultados + export CSV/PDF + protocolo.
**Acceptance:** cubicación real de una poza demo produce volúmenes y export; no se reimplementa el motor.

### Bloque B4 — Config + pulido
**Files:** `poza/ui/pages/config_page.py` (reusa `system_config.py`/`config_view.py`): caché/TTL, unidades, tema, borrar caché. Migrar `gmt_auth.py` a JWT propio (quitar restos Firebase/id_token) si la demo apunta a Railway.
**Acceptance:** preferencias persisten; caché gestionable; auth JWT limpio.

---

## Paralelización y secuenciación

1. **Arrancar en paralelo:** A0 (backend GMT) ‖ B0 (wiring V-Metric). Son repos distintos, cero conflicto.
2. GMT: A0 → (A1 ‖ A3 ‖ A4-frontend) → A2 (depende de A0 API) → A5. Backend de A0 con subagentes en serie por la migración Prisma (una sola migración), frontend en paralelo.
3. V-Metric: B0 → (B1 ‖ B2) → B3 → B4.
4. Checkpoints: correr `pnpm lint`+`prisma validate`+build web tras cada bloque GMT; `python -m poza.ui.main` humo tras cada bloque V-Metric.

## Riesgos
- **Migración enum VariableType**: usar `ADD VALUE` (seguro), no recrear el enum.
- **FGA tuplas de worker**: diferibles; persistir asignación aunque la tupla FGA quede como deuda (gating por roleKey en demo).
- **Workspace rewrap**: si `DemViewerWidget` está embebido en `workspace_view.py`, extraerlo mínimo; NO reescribir `core/viz`.
- **Tiempo**: si algo no cierra, dejar working software por bloque y marcar lo diferido; Proyectos es el bloque más pesado (prioridad tras fundaciones).
