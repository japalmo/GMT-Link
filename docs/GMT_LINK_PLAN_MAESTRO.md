# GMT Link — Plan Maestro de Implementación

> **Fuente única de verdad.** Reemplaza los borradores anteriores. Este documento + el prompt de ejecución son todo lo que el modelo necesita.
> Estructura: decisiones cerradas → arquitectura → primitivas → **roadmap por etapas con tareas pequeñas** → pendientes → assets.
> Versión: 1.0

---

## 1. Contexto y objetivo

GMT Link es la plataforma interna de operaciones de GMT (ingeniería/geofísica). Conviven **colaboradores y clientes (ITO)** con acceso finamente segmentado. Cubre: identidad/acceso, finanzas internas, operaciones por proyecto (backlog + documentos con flujo de aprobación), recursos físicos (insumos, proveedores, equipos, vehículos, bodegas) y herramientas técnicas (coordenadas + IA). Todo atravesado por **mínimo privilegio** y **gamificación**. Mobile-first, responsive, limpio.

**Objetivo de este plan:** construir el sistema por etapas pequeñas y reviewables, una tarea a la vez, optimizando el uso del modelo.

---

## 2. Decisiones cerradas (no re-litigar)

| Decisión | Elegido |
|---|---|
| Base de datos | **PostgreSQL + Prisma** (JSONB donde haya forma variable) |
| Autorización | **OpenFGA** (relacional, estilo Zanzibar) |
| Modelo de clientes | **Instancia única**, clientes scopeados vía OpenFGA |
| Repos | **Monorepo** (back + front + tipos compartidos) |
| Frontend | React + Vite + **TypeScript** + Tailwind + shadcn/ui |
| Backend | **NestJS** (TypeScript) |
| AuthN | Firebase Auth |
| Storage | Cloudflare R2 (o Firebase Storage) |
| GIS/coords | proj4js + MapLibre/Leaflet |
| IA (app) | API de Gemini desde el backend (cuota 3/día/usuario) |
| "Omitir" de onboarding | **Pospone**, no completa. El tour reaparece hasta completar de verdad. |
| Modelo de aporte de KPI | **Dinámico**, sumando los `actualPoints` de tareas `COMPLETADO` al avance. |
| Esquema de revisiones | **Alfabético** (`rev0` borrador, `revA` QA, `revB`... correcciones). |
| Firma digital | **Firma Electrónica Simple (FES)** por hash SHA-256 en auditoría PDF. |
| Checklist de camioneta | **Carga automática** estándar desde `docs/checklist_camioneta.csv` al inicializar. |
| Identidad visual / paleta | **Gris neutro y HSL oscuro/claro** personalizables por el usuario. |

---

## 3. Principios transversales

1. **Mínimo privilegio.** Permisos atómicos por método; roles = bundles; todo scopeado a proyecto/servicio/depto.
2. **Primitivas primero.** Construir y documentar las piezas reutilizables (§5) antes de los módulos. Cada módulo las ensambla, no las reinventa.
3. **Disciplina de tokens.** Referenciar secciones de este doc por número en vez de reescribir. No regenerar archivos sin cambios. Respuestas enfocadas en la tarea actual.
4. **Instancia única segura.** Un cliente NUNCA ve datos de otro cliente ni lo interno de GMT. El rol `client_ito` solo deriva permisos hacia su proyecto y sus documentos.

---

## 4. Arquitectura de datos y autorización

### 4.1 Cómo conviven Postgres y OpenFGA

- **OpenFGA** = fuente de verdad de "¿puede el usuario X hacer Y sobre Z?". Toda decisión de permiso se resuelve ahí.
- **Postgres** = datos del negocio + catálogo legible de roles/permisos (para la UI de config) + espejo de asignaciones.
- **Sync:** al crear/borrar una `Membership` en Postgres se escribe/borra la tupla equivalente en OpenFGA vía `syncMembershipToFGA()`.

### 4.2 Esquema Prisma — núcleo

```prisma
// ============ IDENTIDAD ============
model User {
  id             String     @id @default(cuid())
  firstName      String
  secondName     String?
  lastName       String
  secondLastName String?
  email          String     @unique
  avatarUrl      String?
  status         UserStatus @default(PENDING_FIRST_LOGIN)
  points         Int        @default(0)   // gamificación
  isClientUser   Boolean    @default(false)
  clientId       String?
  client         Client?    @relation(fields: [clientId], references: [id])
  memberships    Membership[]
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
}

enum UserStatus { PENDING_FIRST_LOGIN  ACTIVE  SUSPENDED }

// ============ ORGANIZACIÓN ============
model Client {
  id       String    @id @default(cuid())
  code     String    @unique          // máx 4 chars — obligatorio en codificación
  name     String
  rut      String?
  users    User[]
  projects Project[]
}

model Department {
  id       String    @id @default(cuid())
  code     String    @unique          // 3 chars
  name     String
  projects Project[]
}

model Project {
  id           String     @id @default(cuid())
  code         String                          // 3 chars, único dentro del depto
  name         String
  departmentId String
  department   Department @relation(fields: [departmentId], references: [id])
  clientId     String
  client       Client     @relation(fields: [clientId], references: [id])
  services     Service[]
  kpis         Json?
  createdAt    DateTime   @default(now())
  @@unique([departmentId, code])
}

model Service {
  id              String   @id @default(cuid())
  code            String                        // 3 chars
  name            String
  projectId       String
  project         Project  @relation(fields: [projectId], references: [id])
  docCodingConfig Json
  @@unique([projectId, code])
}

// ============ ROLES Y PERMISOS (catálogo — espejo de OpenFGA) ============
model Role {
  id          String           @id @default(cuid())
  key         String           @unique
  label       String
  permissions RolePermission[]
}

model Permission {
  id    String           @id @default(cuid())
  key   String           @unique
  label String
  roles RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id])
  permission   Permission @relation(fields: [permissionId], references: [id])
  @@id([roleId, permissionId])
}

model Membership {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id])
  roleKey   String
  scopeType ScopeType
  scopeId   String
  createdAt DateTime  @default(now())
  @@unique([userId, roleKey, scopeType, scopeId])
}

enum ScopeType { ORGANIZATION  DEPARTMENT  PROJECT  SERVICE }
```

### 4.3 Modelo de autorización OpenFGA

Roles = relaciones de asignación directa. Permisos atómicos por método = relaciones derivadas. Scope = el tipo padre.

```dsl
model
  schema 1.1

type user

type organization
  relations
    define admin: [user]
    define member: [user] or admin
    # permiso atómico (derivado) — provisión de usuarios (§1.1)
    define can_manage_users: admin

type department
  relations
    define organization: [organization]
    define admin: [user] or admin from organization
    define member: [user] or admin

type client
  relations
    define member: [user]

type project
  relations
    define department: [department]
    define client: [client]
    # roles asignables (bundles)
    define project_creator: [user] or admin from department
    define operator: [user]
    define qa: [user]
    define finance: [user]
    define viewer: [user]
    define client_ito: [user]
    # permisos atómicos (derivados)
    define can_view: viewer or operator or qa or finance or project_creator or client_ito
    define can_create_task: operator or project_creator
    define can_assign_task: project_creator or admin from department
    define can_define_kpi: project_creator
    define can_create_service: project_creator
    # gate propio de la gestión de activos (asset:manage) — desacoplado de can_create_service
    define can_manage_assets: [user] or project_creator

type service
  relations
    define project: [project]
    define qa: [user] or qa from project
    define operator: [user] or operator from project
    define client_signer: [user]
    define can_view: can_view from project

type document
  relations
    define service: [service]
    define owner: [user]
    define can_view: owner or can_view from service
    define can_upload_revision: owner or operator from service
    define can_sign_qa: qa from service
    define can_sign_client: client_signer from service

# Activo = base de Equipo/Vehículo: "rol chico por método"
type asset
  relations
    define project: [project]
    define assigned: [user]
    define can_view_list: [user] or can_view from project
    define can_run_checklist: assigned
    define can_view_location: [user]
    define can_view_history: [user]
    define can_view_speed: [user]
    define can_create: can_manage_assets from project
    define can_upload_doc: [user]
    define can_upload_and_approve_doc: [user]
```

---

## 5. Primitivas reutilizables (construir en Etapa 0)

| Primitiva | Qué hace | Usada en |
|---|---|---|
| `ImportWizard` | Overlay 4 pasos: descargar formato → subir → preview → confirmar. Slot opcional de ayuda IA. | Reembolsos, Horas extra, Insumos, Proveedores |
| `ApprovalWorkflow` | Estados pendiente→aprobado/rechazado, guarda versión anterior, notifica al aprobador. | Docs proyecto, docs perfil, docs activos, plantillas checklist, update insumos |
| `RoleScopedList` | Lista/tabla filtrada por permisos del usuario; búsqueda + filtros + paginación. | Reembolsos, Horas, Proyectos, Directorio, Insumos, Activos |
| `RequestForm` | "Nueva solicitud" → formulario tipado → entra al list. | Reembolsos, Horas extra |
| `AssetBase` | Codificación auto, QR, ficha pública, docs, historial, disputa "en uso". | Equipos, Vehículos |
| `StepperDownload` | Barra de pasos adaptativa (1=última … N=todas; densidad cambia según cantidad). | Liquidaciones |
| `AIAssistedDataCleaner` | Card "Necesito ayuda para ordenar los datos" → CSV ordenado. Cuota 3/día. | Insumos, Proveedores |

---

## 6. Roadmap por etapas

Formato de cada tarea: **objetivo · entregable · criterio de "hecho" (DoD)**. Una tarea = una unidad de review. No se avanza a la siguiente sin aprobación.

### ETAPA 0 — Fundación

| # | Tarea | Entregable | DoD |
|---|---|---|---|
| 0.1 | Monorepo + tooling | pnpm workspaces, app NestJS, app Vite+React+TS, paquete `shared-types`, ESLint/Prettier, `.env` | `pnpm dev` levanta back y front |
| 0.2 | Prisma núcleo | `schema.prisma` (§4.2) + migración + seed mínimo (org, roles, permisos semilla §6-tabla) | Migración corre; seed inserta sin error |
| 0.3 | OpenFGA | Modelo (§4.3) cargado + cliente + `syncMembershipToFGA()` + tests del modelo | Tests de relaciones pasan |
| 0.4 | Guard de permisos | Decorador `@RequirePermission(perm, resource)` que consulta OpenFGA, probado en endpoint dummy | Acceso permitido/denegado correcto |
| 0.5 | AuthN | Firebase Auth + primer login (cambio de clave forzado) + middleware de sesión | Login + cambio de clave end-to-end |
| 0.6 | Design system | Tokens neutros, tema, tipografía + primitivos visuales (Button, Input, Card, Modal, Table) | Storybook o página demo con todos |
| 0.7 | Shell | Sidebar colapsable (nav primaria + secundaria + footer perfil/config/notif) + main canvas + routing | Navega y colapsa; mobile-first OK |
| 0.8 | Primitivas | `RoleScopedList`, `ImportWizard`, `ApprovalWorkflow` genéricas + documentadas | Cada una con demo aislada |

### ETAPA 1 — Identidad y acceso

| # | Tarea | DoD |
|---|---|---|
| 1.1 | Admin crea usuarios: CSV (nombres, apellidos, correo, array roles) → clave provisoria → email | Importa CSV y envía correos |
| 1.2 | Primer login completo (UI) + tour de onboarding con checks de progreso + "Omitir" *(confirmar comportamiento)* | Tour persiste hasta completarse |
| 1.3 | Perfil → Mis datos (ver/editar, cambiar clave) | Edita y persiste |
| 1.4 | Perfil → Mi CV (arrays exp/edu/cert con +/editar, diplomas PDF) | CRUD de cada array |
| 1.5 | Perfil → Mis documentos (vencimiento, filtros, versionado vía `ApprovalWorkflow`) | Sube/actualiza queda pendiente |
| 1.6 | Directorio (CRUD + detalle, scopeado por rol) | Vistas según permisos |

### ETAPA 2 — Shell funcional + dashboard + sistema

| # | Tarea | DoD |
|---|---|---|
| 2.1 | Dashboard modular configurable por rol (widgets, layout JSONB, acomodable) | Usuario acomoda y persiste |
| 2.2 | Notificaciones (modelo + overlay hover + sección dedicada) | Llega, se ve, se marca leída |
| 2.3 | Configuración (notif, solicitar permisos a admin, preferencias de diseño) | Cambios aplican |
| 2.4 | Placeholder V-metric en nav secundaria | Enlace presente |

### ETAPA 3 — Finanzas

| # | Tarea | DoD |
|---|---|---|
| 3.1 | Reembolsos: `RoleScopedList` + `RequestForm` (nueva solicitud) | Crea y lista según rol |
| 3.2 | Reembolsos: `ImportWizard` + Impresión en lote (PDF 2/4/6 boletas/página) | Importa y genera PDF |
| 3.3 | Horas extra (reusa patrón de 3.1–3.2) | Funciona end-to-end |
| 3.4 | Liquidaciones: tabla por mes + descarga individual + `StepperDownload` | Descarga rango adaptativo |

### ETAPA 4 — Operaciones

| # | Tarea | DoD |
|---|---|---|
| 4.1 | Proyectos: lista scopeada + datos públicos + creación (rol creador) + definir servicios + config codificación | Crea proyecto con servicios |
| 4.2 | KPIs: definición por proyecto + modelo de aporte por tarea *(confirmar)* | KPI sube al completar tarea |
| 4.3 | Backlog: Kanban (tabs estados) + filtros + asignación + trazabilidad | Mueve tareas, filtra |
| 4.4 | Backlog: tareas cíclicas (recurrencia) + solicitudes de cliente/ITO | Genera recurrentes |
| 4.5 | Documentos: servicio de codificación automática (formato §7) | Código correcto auto |
| 4.6 | Documentos: control de revisiones *(rev0→revA→… confirmar)* | Versiona bien |
| 4.7 | Documentos: flujo de aprobación (genera→pendiente→QA→firma→cliente→firma) vía `ApprovalWorkflow` | Flujo completo con alertas |
| 4.8 | Documentos: firma digital *(FEA/FES — módulo aislado, confirmar)* | Firma registrada |

### ETAPA 5 — Recursos

| # | Tarea | DoD |
|---|---|---|
| 5.1 | `AssetBase` (codificación, QR, ficha pública, docs, historial, disputa "en uso") | QR abre ficha pública |
| 5.2 | Equipos (ciclos carga, calibración, accesorios, checklist editable + aprobación) | Crea equipo con checklist |
| 5.3 | Vehículos (km, ubicación device, docs legales, checklist) — *integrar código + CSV existentes* | Checklist de camioneta corre |
| 5.4 | Insumos (lote CSV/manual, búsqueda sugerida, alta bodega inline) | Ingresa lote a bodega |
| 5.5 | Proveedores (catálogo, evaluación 1–5, score, `AIAssistedDataCleaner`) | Crea proveedor + catálogo |
| 5.6 | Bodegas (stock, historial entrada/salida, widget gráfico más usados) | Muestra stock y gráfico |

### ETAPA 6 — Herramientas

| # | Tarea | DoD |
|---|---|---|
| 6.1 | Transformación de coordenadas (UTM↔lat/long; punto/polígono/lista CSV/Excel) + GIS | Convierte y visualiza |
| 6.2 | Detección de orilla con IA (orto → polígono) + cuota 3/día + integración Gemini | Devuelve polígono |

### ETAPA 7 — Gamificación + pulido

| # | Tarea | DoD |
|---|---|---|
| 7.1 | Motor de puntos/logros/badges sobre acciones | Acciones suman puntos |
| 7.2 | Accesibilidad, performance, estados vacíos/carga/error, QA general | Pasa checklist de pulido |

---

## 7. Codificación de documentos

```
GMT - {Cliente*} - {Depto} - {CodProyecto} - {CodServicio} - {TipoDoc} - {CodÁrea} - {N°}
```
Ej.: `GMT-ALS-...-CA-A4-001`. Cada código máx 4 chars, configurable. Al crear depto/proyecto/servicio se exige su código identificador.
**Revisiones (confirmar):** convención probable `rev0` inicial → `revA` aprobada por QA → `revB`, `revC`… por corrección.

---

## 8. Catálogo de permisos (semilla)

| key | label |
|---|---|
| `project:create` | Crear proyectos |
| `project:kpi:define` | Definir KPIs |
| `project:measurements:submit` | Subir cubicaciones/mediciones (módulo metrics, D3) |
| `task:create` / `task:assign` | Crear / asignar tareas |
| `document:upload` | Subir documento |
| `document:sign:qa` / `document:sign:client` | Firmar QA / cliente |
| `asset:checklist:run` | Ejecutar checklist |
| `asset:location:view` / `asset:history:view` | Ver ubicación / históricos |
| `asset:manage` | Gestionar activos (crear/asignar/accesorios/plantillas; FGA `can_manage_assets`) |
| `asset:create` | Crear activo |
| `asset:doc:upload` / `asset:doc:approve` | Subir / aprobar doc de activo |
| `finance:reimbursement:import` | Importar reembolsos |
| `finance:print:batch` | Impresión en lote |
| `directory:view:extended` | Ver datos extendidos de directorio |
| `user:create` | Crear usuarios (§1.1) |
| `user:read` | Ver usuarios |
| `user:update` | Editar usuarios |
| `role:assign` | Asignar roles a usuarios |

---

## 9. Decisiones pendientes (cerrar al llegar a su etapa)

*Todas las decisiones operacionales y de diseño técnico han sido cerradas y documentadas en la sección §2.*

---

## 10. Assets

No se generan dentro del chat. Ver hoja de prompts (documento aparte) para generarlos con herramienta externa (nano banana / Flux / Midjourney). Iconos de UI → `lucide-react`, no generados. Estilo común y paleta `[PALETA]` a definir.
