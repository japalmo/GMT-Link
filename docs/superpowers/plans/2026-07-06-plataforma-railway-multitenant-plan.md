# Plataforma GMT en Railway (multi-tenant, auth propia) — Plan Maestro

> **For agentic workers:** este es un **plan maestro / roadmap** que abarca varios subsistemas independientes. Cada Fase/Milestone recibe su **plan detallado propio** (TDD, paso a paso) antes de ejecutarse. Usa superpowers:subagent-driven-development o superpowers:executing-plans para cada plan detallado. Los checkboxes `- [ ]` marcan hitos de fase, no micro-pasos.

**Goal:** Dejar GMT Link (web) y V-Metric (desktop) en **producción en Railway**, con **autenticación propia compartida** (sin Firebase), migrando los datos actuales, y evolucionando a **una base de datos física por cliente** (liftable a la infraestructura del cliente en el futuro) — priorizando primero **dejar la demo funcionando**.

**Architecture:** Monolito NestJS (`backend-central`) que emite/valida un **JWT propio** (bcrypt + HS256) y orquesta el acceso a datos. La demo corre sobre **una sola Postgres**; luego se introduce una **frontera core/tenant** y **una BD física por cliente** enrutada por el `clientId` del token vía un `TenantConnectionManager`. OpenFGA para permisos finos. Todo en Railway; los scaffolds `auth-service`/`tenant-gateway`/`sdk-gateway` quedan **congelados** como puente a la futura soberanía de datos.

**Tech Stack:** NestJS 11 · Prisma 6 · bcryptjs · jsonwebtoken · @nestjs/throttler · helmet · React/Vite · PySide6 + keyring (V-Metric) · OpenFGA · PostgreSQL · Railway CLI.

**Fuentes:** [evaluación de arquitectura](../specs/2026-07-06-evaluacion-arquitectura-railway.md) (ejército de 12 agentes) · [plan maestro producto](../../GMT_LINK_PLAN_MAESTRO.md) · [auth propia](2026-06-26-auth-propia-jwt-plan.md) (ya ejecutado).

---

## 1. Scope cerrado (decisiones del usuario, 2026-07-06)

1. **Todo en Railway** como entorno de producción/trabajo. Sin más pruebas locales.
2. **Auth propia compartida** por web y V-Metric (bcrypt + JWT). **Cero dependencia de Firebase.**
3. **Separación física real: una BD por cliente.** Se autoriza **refactorizar el esquema** para lograrlo limpio.
4. **Migrar los datos del PostgreSQL local** a producción (no arranque limpio).
5. **Soberanía diferida:** hoy lo alojamos nosotros; **diseñar para migrar a futuro cada BD de cliente a su servidor**. Congelar (no borrar) los scaffolds de gateway.
6. **Monolito** `backend-central` (no extraer `auth-service` ahora).
7. **Prioridad #1: que funcione la demo.** El aislamiento físico se hace inmediatamente después, aún no de cara al cliente.

---

## 2. Arquitectura objetivo y frontera core/cliente (la "solución")

### 2.1 Partición del modelo de datos

El esquema actual (`nodes/backend-central/prisma/schema.prisma`) no tiene una línea de corte por cliente. La solución para poder separar físicamente sin romper la app es partir los ~50 modelos en dos dominios:

**NÚCLEO — BD de control GMT (`core`, siempre alojada por nosotros):**
- **Identidad / auth:** `User`, `OtpCode`
- **Organización / catálogo:** `Client`, `Department`, `Role`, `Permission`, `RolePermission`, `Membership`
- **RR.HH. / perfil del colaborador:** `CV`, `CVExperience`, `CVEducation`, `CVCertification`, `PersonalDocument`, `DashboardConfig`, `UserPreferences`, `Notification`, `PermissionRequest`
- **Finanzas internas GMT:** `Reimbursement`, `OvertimeRequest`, `Liquidation`
- **Recursos internos GMT (compartidos entre clientes):** `Provider`, `ProviderProduct`, `ProviderRating`, `Supply`, `Warehouse`, `WarehouseStock`, `WarehouseTransaction`, `Asset`, `AssetDocument`, `AssetHistoryEntry`, `AssetAccessory`, `ChecklistTemplate`, `ChecklistSubmission`
- **Gamificación / uso IA:** `PointsLog`, `UserAchievement`, `GeminiUsage`

**POR CLIENTE — BD del tenant (liftable a su infra en el futuro):**
- `Project`, `Service`
- `Task`, `TaskTimeLog`
- `ProjectDocument`
- **Métricas / cubicaciones (V-Metric):** `Element`, `Phase`, `Variable`, `DataPoint`

> Racional: el trabajo que un cliente eventualmente querrá alojar en su servidor es **el de sus proyectos y sus mediciones**, no la identidad/HR/recursos internos de GMT. Ese subárbol (`Project → Service → {Task, ProjectDocument, Phase→Variable→DataPoint}` + `Element`) es exactamente lo que se separa.

### 2.2 Referencias que cruzan la frontera (FK dura → referencia blanda)

Al mover el subárbol de tenant a otra BD, estas FKs **dejan de ser FK** y pasan a ser IDs resueltos en la app (con denormalización donde haga falta para display/rendimiento):

| Tabla (tenant) | Campo | Apunta a (core) | Estrategia |
|---|---|---|---|
| `Project` | `departmentId` | `Department` | soft-ref + denormalizar `deptCode/deptName` |
| `Project` | `clientId` | `Client` | implícito por la BD; se conserva como etiqueta |
| `Task` | `assignedToId`, `createdById`, `clientUserId` | `User` | soft-ref (resolver nombre en batch desde core) |
| `TaskTimeLog` | `userId` | `User` | soft-ref |
| `ProjectDocument` | `ownerId`, `qaSignerId`, `clientSignerId` | `User` | soft-ref |
| `DataPoint` | `createdById` | `User` | soft-ref |
| `Asset` | `projectId` | `Project` (tenant) | soft-ref core→tenant (activo GMT asignado a un proyecto) |
| `Membership` | `scopeId` (PROJECT/SERVICE) | ids de tenant | soft-ref core→tenant |

### 2.3 Topología en Railway (proyecto `valiant-rebirth`)

```
        web (Vite)        V-Metric (.exe)
            │  Bearer JWT propio  │
            └──────────┬──────────┘
                       ▼
              api — backend-central (NestJS)
              · /auth/login · SessionMiddleware
              · TenantConnectionManager (enruta por clientId)
              · ProvisioningService (crea BD por cliente)
               │              │                     │
        railway.internal  railway.internal    railway.internal
               ▼              ▼                     ▼
          openfga        Postgres core       Postgres t_albemarle
        (+ su Postgres)  (identidad/HR/      Postgres t_capstone
                          recursos GMT)      (proyectos+mediciones)
                                             … 1 BD física por cliente
   ── CONGELADOS: auth-service · tenant-gateway · sdk-gateway ──
```

### 2.4 Enrutado por tenant (runtime)

- El JWT lleva `{sub}`; el `SessionMiddleware` carga el `User` desde **core**.
- **Usuarios cliente (ITO):** su `clientId` fija su tenant.
- **Staff GMT:** el tenant se resuelve por el recurso (p.ej. el `clientId` del proyecto en la ruta) o un selector explícito de tenant.
- `TenantConnectionManager`: cachea un `PrismaClient` por cliente, con la connection string **cifrada** guardada en `Client.dbUrl` (core). Las consultas de negocio usan el client del tenant; las de identidad/HR usan el client de core.

### 2.5 Provisionamiento automático

`ProvisioningService.createTenant(client)`:
1. Crear la BD física (API/CLI de Railway para una Postgres nueva por cliente; o `CREATE DATABASE` si el rol tiene permisos).
2. Correr las migraciones **de tenant** contra ella (`prisma migrate deploy` con `DATABASE_URL` a la nueva BD).
3. Guardar la connection string cifrada en `Client.dbUrl` (core).
4. Sembrar las tuplas base de OpenFGA del tenant.
Se expone como comando CLI/endpoint admin. **Primer uso: crear Albemarle y Capstone Cooper.**

---

## 3. Secuenciación — por qué "demo primero"

Hacer el refactor de esquema + BD-por-cliente **antes** de cualquier despliegue es el camino de mayor riesgo y retrasa la demo. Por eso se separa en milestones:

- **Milestone A — Demo funcionando en Railway (rápido).** Endurecer seguridad, desplegar los 4 servicios sobre **una sola Postgres** (que arranca como el futuro `core`, con los datos locales migrados), migrar V-Metric a la auth propia, smoke-test. Albemarle y Capstone existen como `Client` + proyectos demo dentro de esa BD. **Cumple "que funcione la demo".**
- **Milestone B — Aislamiento físico real (BD por cliente).** Refactor core/tenant + `TenantConnectionManager` + `ProvisioningService` + split de datos → crear las BD físicas de Albemarle y Capstone y mover su data de proyectos. **Cumple "una BD por cliente".**
- **Milestone C — Soberanía (futuro).** Descongelar el puente y migrar la BD de un cliente a su servidor por túnel, cuando el contrato lo exija.

> Si prefieres BD-por-cliente **antes** de la demo, se invierte B↔A (más lento y riesgoso). Recomendación fuerte: demo primero.

---

## 4. Roadmap por fases

Cada fase: **objetivo · entregable · DoD**. Las fases con ⚙️ reciben un **plan detallado TDD propio** antes de ejecutarse.

### Milestone A — Demo en Railway

#### Fase 0 — ADR y confirmaciones
- [ ] Registrar ADR "soberanía diferida" (hoy Railway, diseño liftable a infra del cliente) en `docs/adr/`.
- **DoD:** ADR commiteado; decisiones §1 registradas.

#### Fase 1 — ⚙️ Gate de seguridad de producción (bloqueante, va antes del deploy)
Objetivo: cerrar los agujeros que hacen inseguro exponer el backend.
- [ ] `@nestjs/throttler` en `/auth/login` (p.ej. 5/min/IP).
- [ ] `helmet` en el bootstrap de NestJS.
- [ ] Admin sembrado: **no** re-sembrar credencial pública en prod; forzar cambio de clave / rotar (`seed-admin.ts`).
- [ ] Validar entropía de `AUTH_JWT_SECRET` (≥32 bytes) al arrancar (falla el boot si falta/débil).
- [ ] Reescribir `docs/railway-deploy.md`: quitar todo Firebase, añadir `AUTH_JWT_SECRET`, fijar `RAILWAY_DOCKERFILE_PATH` por servicio, resolver la contradicción Nixpacks/Dockerfile.
- **DoD:** tests verdes; login con throttle+helmet activos; boot falla sin secreto válido; doc actualizado.

#### Fase 2 — ⚙️ Deploy single-DB en Railway (cumple req 1 + web)
Objetivo: los 4 servicios online con auto-deploy desde `main`.
- [ ] Servicios: `postgres-gmt`, `openfga` (+ su Postgres backing), `api`, `web`. Dominio público solo a `api` y `web`.
- [ ] `prisma migrate deploy` movido del CMD a un **pre-deploy command** (evita carreras con réplicas).
- [ ] Correr `fga:bootstrap` contra el OpenFGA desplegado; cargar `FGA_STORE_ID`/`FGA_MODEL_ID` como env del `api`.
- [ ] **Migrar los datos locales** a `postgres-gmt` (dump/restore vía `DATABASE_PUBLIC_URL`); podar filas de prueba obvias.
- [ ] Variables: `AUTH_JWT_SECRET`, `CORS_ORIGINS` (=URL web), `VITE_API_URL` (=URL api), NVIDIA keys.
- [ ] **Smoke-test en Railway:** login web `admin@gmt.cl` → dashboard; un check de OpenFGA.
- **DoD:** web y api públicas responden; login funciona en Railway; datos migrados visibles.

#### Fase 3 — ⚙️ V-Metric a la auth propia (cumple req 2 desktop — gap crítico)
Objetivo: cerrar el eslabón roto (V-Metric ↔ backend).
- [ ] Crear `v-metric/poza/gmt_auth.py`: `POST /auth/login` → JWT, `GET /auth/me`.
- [ ] En `call_function`, enviar `Authorization: Bearer <jwt>` (reemplaza `id_token`).
- [ ] **Eliminar** `refresh_session_token`/retry vía securetoken de Firebase → **re-login explícito ante 401** (`firebase_http.py`).
- [ ] Persistir el JWT con `keyring` (Windows Credential Manager); validar contra `/auth/me` al arrancar.
- [ ] `VMETRIC_GMT_LINK_API_URL` → URL pública del `api` en Railway; quitar `firebase-key.json` del bundle PyInstaller.
- [ ] **Smoke-test:** login V-Metric + una cubicación end-to-end contra Railway.
- **DoD:** V-Metric entra con la auth propia y guarda/lee una cubicación en prod; sin llamadas a Firebase.

### Milestone B — Aislamiento físico (BD por cliente)

#### Fase 4 — ⚙️ Defensa en profundidad del aislamiento (prep)
- [ ] Añadir `clientId`/scoping (RLS o `WHERE clientId`) sobre el subárbol de tenant (`metrics`/`projects`) como red de seguridad (hoy el aislamiento descansa 100% en tuplas OpenFGA).
- [ ] Verificar y, si aplica, sacar el token-store de subida de DEM del `Map` en memoria (`metrics.service.ts`) a Postgres/Redis o JWT corto. *(Verificar si `OtpCode` ya lo cubre.)*
- **DoD:** un error de siembra de tuplas no filtra datos entre clientes; subida DEM estable con >1 réplica.

#### Fase 5 — ⚙️ Refactor core/tenant + BD por cliente + provisión (cumple req 3)
> Recibe su **propio spec + plan detallado** (brainstorm→plan) por ser el subsistema más grande y riesgoso. Diseño en §2.
- [ ] Partir el esquema Prisma en **core** + **tenant** (§2.1); convertir FKs cruzadas en soft-refs (§2.2).
- [ ] `TenantConnectionManager` + `TenantContext` por request (§2.4); `Client.dbUrl` cifrada.
- [ ] `ProvisioningService` (§2.5) + CLI; fan-out de migraciones de tenant + drift check.
- [ ] Split de datos: mover proyectos+mediciones de cada cliente a su BD física.
- [ ] **Crear las BD físicas de Albemarle y Capstone Cooper** con el comando de provisión.
- **DoD:** cada cliente tiene su BD física; el backend enruta por tenant; onboarding de un cliente nuevo es un comando.

### Milestone C — Soberanía (futuro, fuera del alcance inmediato)

#### Fase 6 — Endurecimiento diferido + migración a infra de cliente
- [ ] Access token corto + refresh rotatorio con denylist (Redis); cookie httpOnly + CSRF para web (Bearer se mantiene para desktop).
- [ ] PITR/backup del cluster; PgBouncer si >5 tenants × réplicas.
- [ ] **Puente de soberanía:** apuntar la `dbUrl` de un cliente a su servidor por túnel (VPN/mTLS); descongelar el gateway solo para ese tenant.
- **DoD:** (cuando un contrato lo exija) la BD de ese cliente vive en su infra sin tocar el resto.

**Congelado (fuera del plan):** `auth-service`, `tenant-gateway`, `sdk-gateway`, federación cross-tenant, FGA-por-tenant, submodule `v-metric`. Se descongelan solo en Milestone C.

---

## 5. Riesgos y notas

- **Refactor core/tenant (Fase 5) es L/XL.** Toca ~12 tablas y ~10 relaciones; se hace en su propia rama/PR con tests. Por eso va **después** de la demo.
- **Consultas "GMT ve todo"** pasan a federar (backend agrega sobre N BD); documentar por feature.
- **Provisión en Railway:** confirmar si el rol de la Postgres permite `CREATE DATABASE`; si no, usar la API de Railway para crear una Postgres por cliente (o un cluster dedicado con superusuario).
- **Migración de datos locales:** el dump local incluye data demo; podar en Fase 2.
- **`railway-deploy.md` está obsoleto** (Firebase); se reescribe en Fase 1 antes de usarlo.

---

## 6. Handoff

Este maestro fija el rumbo y el orden. El siguiente paso es el **plan detallado (TDD) de la Fase 1 + Fase 2** (el empujón inmediato a producción), y luego Fase 3 (V-Metric). La Fase 5 recibe su propio spec.
