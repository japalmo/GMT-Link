# Fase 1 — Índice integrador de planes (roles + auth + finanzas + infra + mockups + vmetric)

**Fecha:** 2026-07-10
**Rol de este doc:** arquitectura integradora. Ordena la ejecución de los 7 planes de Fase 1, declara
las dependencias entre ellos, registra los issues de consistencia cross-plan (los menores ya
corregidos; los mayores anotados abajo) y fija el "definition of done" de la fase.
**Spec autoridad:** `docs/superpowers/specs/2026-07-10-deploy-finanzas-roles-design.md`.
**Rama:** `feat/finanzas-roles-deploy`.

---

## Los 7 planes (resumen de una línea)

| # | Plan | Archivo | En una línea |
|---|---|---|---|
| **A** | Fase 1a — Roles, permisos y acceso | `2026-07-10-fase1a-roles-permisos-acceso.md` | **Fundaciones**: cataloga permisos nuevos + 10 roles de sistema en el seed, expone `permissions[]` en `GET /auth/me`, deriva `modules` de permisos, y migra el front a `useHasPermission` + guards de ruta + banner beta. **Sin migración Prisma** (aditivo por seed). |
| **B** | Fase 1b — Auth: username + emails | `2026-07-10-fase1b-auth-username-emails.md` | Login por `username`; agrega `username @unique` + `emailInstitucional? @unique` + `emailPersonal?` a `User` (migración aditiva + backfill); creación de usuarios (form + CSV) con username/emails. Conserva `email` NOT NULL por retro-compat (Decisión D1, a confirmar por el owner). |
| **C1** | Fase 1c — Finanzas backend | `2026-07-10-fase1c-finanzas-backend.md` | Migración aditiva de `Reimbursement`/`OvertimeRequest` (campos nuevos, borrador HE, onBehalf, proyecto), reglas de negocio (cierre día 20, cómputo de horas, OCR NVIDIA), fix R2 de impresión (`receiptKey`), gating inline por permiso, endpoints `scan-receipt`/`summary`/`print/mark`/`:id/close`. |
| **C2** | Fase 1c — Finanzas frontend | `2026-07-10-fase1c-finanzas-frontend.md` | Rework del módulo Finanzas: pestañas Vista general/Reembolsos/Horas extra (quita Liquidaciones + import CSV), cards+carruseles+tabla histórica filtrable (agregación **client-side**), formularios de reembolso (OCR) y HE (inicio/término/proyecto/onBehalf), impresión en lote. Todo gateado por `useHasPermission`. |
| **D** | Fase 1d — Infra / Seguridad / Git | `2026-07-10-fase1d-infra-seguridad-git.md` | Repo privado + branch protection en `main`; servicio Railway `web-dev` (misma api/BD, CORS); quita la credencial dev hardcodeada del seed; alinea `.env.example` (R2/SMTP/ADMIN_PASSWORD); runbook de infra. Track paralelo. |
| **E** | Fase 1e — Usuarios MOCKUP | `2026-07-10-fase1e-mockups.md` | Seed idempotente `SEED_MOCKUPS=on` que crea 1 usuario ficticio `mock_*@example.test` por rol (10) + data de juguete de reembolsos/HE para poblar el dashboard. Consume roles (A) y campos de auth (B). |
| **F** | V-Metric shell wiring | `2026-07-10-vmetric-shell-wiring.md` | Cablea el shell nuevo de V-Metric (repo `v-metric`, Python) contra Railway `/metrics` con `MetricsClient` inyectable (write-through local + Outbox). Prerrequisito backend B0 (seed Element/Phase/Variable + FGA). Plano de autorización **FGA por proyecto**, independiente de los permisos de finanzas. |

---

## Orden de ejecución recomendado

```
        ┌──────────────────────────────────────────────────────────────┐
        │  A  Fundaciones (roles/permisos/acceso)  — sin migración      │
        └───────────────┬──────────────────────────────────────────────┘
                        │ (define el contrato: permissions[], useHasPermission, guards)
          ┌─────────────┼──────────────────────────────┐
          ▼             ▼                               ▼
   B Auth username   C1 Finanzas backend        (E depende de A+B; ver abajo)
   (migración User)  (migración Reimb/OT)
          │             │
          │             ▼
          │        C2 Finanzas frontend  (consume el contrato de A + endpoints de C1)
          │
          └────────────┬───────────────┐
                       ▼               ▼
                 E Mockups        (deploy a web-dev)

  ∥ PARALELO, sin bloquear la cadena:
     D Infra/Seguridad/Git  (habilita el deploy a web-dev; no toca lógica)
     F V-Metric wiring      (repo v-metric; solo B0 toca backend-central)
```

**Secuencia concreta sugerida:**

1. **A (Fundaciones)** — primero SIEMPRE. Es el contrato compartido (`permissions[]` en `/auth/me`,
   `useHasPermission`, guards `RequireModule`/`RequirePermission`, catálogo de permisos + 10 roles).
   B, C1, C2 y E lo consumen. Sin A no hay permisos sembrados ni hook.
2. **B (Auth username)** y **C1 (Finanzas backend)** — pueden empezar tras A. **Ojo migraciones
   Prisma** (ver Issue #1): ambos editan `model User` en `prisma/schema.prisma`. **No** desarrollar en
   paralelo sobre el mismo `schema.prisma`; ejecutar **B antes que C1** (o al revés) de forma
   secuencial, aplicando cada `prisma migrate dev` en orden de timestamp. Recomendado: **B → C1**.
3. **C2 (Finanzas frontend)** — tras C1 (espeja sus endpoints/campos) y con A ya mergeado (usa
   `useHasPermission`). Los wrappers/tipos del web se pueden escribir antes, pero la integración e2e
   requiere C1 desplegado.
4. **E (Mockups)** — tras **A + B** (usa `Membership.roleKey` de los roles de A y los campos
   `username`/`emailInstitucional` de B). Se enriquece si corre tras C1 pero es auto-contenido contra
   el esquema previo (no lo requiere).
5. **D (Infra)** — en paralelo desde el día 1. Habilita el deploy a `web-dev`; su único toque de
   backend (resolución de credenciales del seed) es retrocompatible y no choca con A/B/C1.
6. **F (V-Metric)** — track independiente en el repo `v-metric`. Su única dependencia con
   `gmt-link/nodes/backend-central` es el **Bloque B0** (seed demo Element/Phase/Variable + FGA), que
   no toca el schema ni colisiona con A/B/C1. Puede correr en paralelo todo el track.

**Regla de deploy (spec §Arquitectura):** `web` y `web-dev` comparten **una** api y **una** BD. Todo
cambio de api/BD debe ser retrocompatible y las features se prenden por **permiso**, no por build. Por
eso A/B/C1 son aditivos y las migraciones no rompen `web` en producción.

---

## Dependencias entre planes

| Plan | Depende de | Naturaleza de la dependencia |
|---|---|---|
| A | — | Raíz. |
| B | A (recomendado, no duro) | Comparte `packages/contracts` y `model User`/`schema.prisma`; no redefine el contrato de A. |
| C1 | A (contrato de permisos) | Consume las claves `finance:*`/`finance:print:batch` que A siembra. Comparte `model User` con B. |
| C2 | A (hook+guard), C1 (endpoints/campos) | Consume `useHasPermission` (A) y espeja el contrato HTTP de C1. |
| D | — | Ninguna dura. Habilita el deploy. |
| E | A (roles), B (campos username/emails) | Duras: `Membership.roleKey` (FK `onDelete: Restrict`) + `username`/`emailInstitucional`. |
| F | B0 propio (backend), no A/B/C | Plano FGA por proyecto; independiente de los permisos de finanzas. |

---

## Verificación de consistencia cross-plan

### Contrato compartido — OK
Los 4 planes consumidores referencian el contrato de A **sin redefinirlo**, con sección explícita:
B ("Contrato compartido — NO redefinir"), C1 ("Contrato compartido — NO redefinir aquí"),
C2 ("Contrato compartido — CONSUMIDO, no redefinido"), E ("Contrato compartido — referenciado, NO
redefinido"). F usa FGA por proyecto y aclara que es un plano distinto. **Sin redefiniciones ni
choques de propiedad del contrato.**

### Issues menores — CORREGIDOS en los planes

- **[FIXED] Endpoint de marcado de impresión (C1 ↔ C2).** C1 expone `POST /reimbursements/print/mark`;
  C2 llamaba `POST /reimbursements/mark-printed`. Se alineó **C2 al path del backend** (`print/mark`)
  en las 3 apariciones (dependencias, wrapper `markReimbursementsPrinted`, y la nota de contrato).
  Editado en `2026-07-10-fase1c-finanzas-frontend.md`.

### Issues mayores — ANOTADOS (resolver antes/durante ejecución)

- **[#1 — Coordinación de migraciones B ↔ C1].** Ambos editan `model User` en el mismo
  `prisma/schema.prisma` (B agrega `username`/`emailInstitucional`/`emailPersonal`; C1 agrega las
  back-relations `overtimeOnBehalf`/`overtimeAuthorized`). No hay colisión de columnas, pero el archivo
  es compartido y las migraciones deben apilarse en orden de timestamp. **Acción:** ejecutar **B → C1**
  secuencialmente (no en paralelo sobre `schema.prisma`); tras B, regenerar cliente y recién entonces
  arrancar C1. Si se hicieran en ramas separadas, la segunda debe rebasar y re-generar su migración.

- **[#2 — `finance:request:create` no es universal, pero el front lo trata como default].**
  C2 asume que `finance:request:create` es "base, todo usuario, no se chequea" y **no gatea** el botón
  de crear. Pero A solo lo otorga al rol `trabajador` (y a `org_admin`/`admin_ti` vía el bundle
  completo). El backend C1 **sí** gatea los endpoints de creación con `P_CREATE = finance:request:create`
  (`@Post()` de reembolsos y HE → `require(userId, P_CREATE)`). **Consecuencia:** un manager (p.ej.
  `admin_finanzas`, `admin_contrato`, gerencias, analistas, `asesor_hse`) **no** puede crear su propio
  reembolso/HE → **403** al enviar, aunque el front le muestre el formulario. Al probar con
  `mock_admin_finanzas` esto se verá. **Decisión requerida (spec §2.3):** ¿los managers crean
  solicitudes propias? Opciones: (a) agregar `finance:request:create` a los bundles de los roles que
  deban poder crear (en A); o (b) gatear el botón de crear en el front por `finance:request:create`
  (en C2) y aceptar que ciertos roles no crean. Coordinar A+C1+C2.

- **[#3 — Representación del borrador de HE: `isDraft` (backend) vs `status==='BORRADOR'` (front)].**
  C1 modela el borrador como `OvertimeRequest.isDraft: boolean` **sin** agregar `BORRADOR` al enum
  `FinanceStatus` (Decisión 4), y su `OvertimeView` expone `isDraft`. C2, en cambio, define
  `OvertimeStatus = FinanceStatus | 'BORRADOR'`, hace `status === 'BORRADOR'` en el `StatusBadge` y su
  `OvertimeView` **no** tiene `isDraft`. **Consecuencia:** el backend enviará `status: 'PENDIENTE'` +
  `isDraft: true`; el front nunca verá `'BORRADOR'` y pintará el borrador como PENDIENTE.
  **Decisión requerida:** o (a) el backend deriva `status: 'BORRADOR'` en el `toView` cuando
  `isDraft`, o (b) el front agrega `isDraft` a su `OvertimeView` y deriva el badge de ahí. Recomendado
  (b) (menos acoplamiento del contrato al estado de UI). Ajustar C2 (tipo + badge) o C1 (toView).

- **[#4 — Campos de vehículo y proyecto/cliente en reembolsos (C1 ↔ C2)].** El `ReimbursementView` de
  C1 expone `vehicle: string|null` y `subcategory: string|null`; el de C2 espera `vehicleId`,
  `vehicleName`, `vehicleSubcategory`. Además C1 **no** da proyecto/cliente a `Reimbursement`
  (Decisión 7: el form §5.5 no los pide), pero C2 lista `project`/`client` en `ReimbursementView` y
  ofrece filtro por proyecto/cliente para filas de reembolso (siempre caerán en `null`). C2 ya se
  cubre con la nota "no inventar el shape: ajustar el tipo del web al backend real". **Acción:** al
  ejecutar C2, **alinear los nombres al backend** (`vehicle`/`subcategory`) y aceptar que el filtro
  proyecto/cliente aplica solo a HE (no a reembolsos). No es bloqueante, pero hay que reconciliar
  nombres o el hidratado de vehículo mostrará vacío.

- **[#5 — `admin_ti`: rol propio (A) vs alias de `org_admin` (E)].** A crea `admin_ti` como **rol de
  sistema real** (Decisión 2, bundle = todo GLOBAL menos `system:beta:full`, **sin** FGA admin) e
  incluye `admin_ti` en `ROLE_KEYS`. E, en cambio, materializa `mock_admin_ti` con el `roleKey`
  **`org_admin`** (no `admin_ti`) y su lista de prerrequisitos **omite** `admin_ti`, con una
  justificación ("en vez de inventar un rol admin_ti") que quedó **desactualizada** respecto de A.
  **Consecuencia:** el mockup de "admin TI" en realidad ejercita `org_admin` (que además recibe FGA
  admin → ve gestión de roles), no el bundle `admin_ti` de A. **Acción (elegir 1):** (a) actualizar E
  para usar `roleKey: 'admin_ti'` en `mock_admin_ti` (prueba el bundle real de A; sin FGA admin → sin
  `/roles`); o (b) mantener `org_admin` en E pero **corregir la nota** de E para que no afirme que
  `admin_ti` no existe (sí existe, lo crea A). No rompe nada (org_admin existe igual), pero el owner
  debe saber qué está probando.

### Observaciones menores (no bloqueantes)

- **Endpoints `/summary` sin consumidor.** C1 agrega `GET /reimbursements/summary` y
  `GET /overtime/summary`; C2 decide agregar **client-side** y no los llama. Quedan aditivos y no
  usados por este front (útiles a futuro / para otros clientes). Sin acción; documentado.
- **`ROLE_KEYS` de `packages/contracts` editado por A (quita huérfanas + 10 roles) y `ProvisionedUser`
  por B.** Distintas zonas del mismo archivo; ambos rebuild de contracts. Sin conflicto; respetar el
  orden A → B para el `dist/`.
- **Deviación D1 de B (email NOT NULL por retro-compat).** Anotada por B; el owner confirma si prefiere
  la semántica `email String? @unique` estricta del spec §4.1 (cambio de 1 línea + ripple TS).

---

## Definition of Done — Fase 1

**Fundaciones y contrato (A)**
- [ ] Seed idempotente (x2 sin duplicar): catálogo de permisos ampliado + los 10 roles de sistema
      (`trabajador … admin_ti`) sembrados; `org_admin`/`admin_ti` = todo GLOBAL menos `system:beta:full`.
- [ ] `GET /auth/me` devuelve `permissions: string[]` no vacío para roles con bundle, y `modules`
      derivados de permisos (default Inicio + Finanzas; `system:beta:full`/`org_admin` → todos).
- [ ] Front: `useHasPermission` + guards `RequireModule`/`RequirePermission` aplicados; `useHasRole`
      eliminado; banner beta visible solo con `system:beta:full`.
- [ ] `pnpm test` (backend + web) verde; `pnpm build` y `pnpm lint` sin errores.

**Auth (B)**
- [ ] Migración aditiva aplicada; backfill sin `username` nulos ni duplicados.
- [ ] Login por `username` (backend + pantalla); creación de usuarios (form + CSV) con username
      autosugerido + regla ≥1 email; credencial muestra username.
- [ ] Decisión D1 (email NOT NULL) confirmada con el owner.

**Finanzas (C1 + C2)**
- [ ] Migración aditiva de `Reimbursement`/`OvertimeRequest` aplicada (cero DROP/NOT NULL nuevos).
- [ ] Reglas: cierre día 20, cómputo de horas, borrador HE (no aprobable), onBehalf, OCR de boletas,
      fix R2 de impresión (`receiptKey`), gating inline por permiso en todos los endpoints.
- [ ] Front: pestañas Vista general/Reembolsos/Horas extra (sin Liquidaciones ni import CSV); cards +
      tabla histórica filtrable; formularios nuevos; impresión en lote con marcado post-descarga.
- [ ] **Issues #2, #3, #4 resueltos** (create para managers, borrador BORRADOR/isDraft, nombres de
      vehículo/proyecto) — verificados e2e con los mockups.

**Infra (D)**
- [ ] Repo `japalmo/GMT-Link` PRIVATE + branch protection en `main` (PR + 1 aprobación, sin push directo).
- [ ] Servicio Railway **`web-dev`** sirviendo la SPA contra la misma api/BD; su dominio en `CORS_ORIGINS`.
- [ ] `AdminGmt2026` fuera de código/tests/docs de ejecución; `.env.example` alineado (R2/SMTP/ADMIN_PASSWORD).
- [ ] Runbook `docs/infra/git-railway-setup.md` entregado al owner.

**Mockups (E)**
- [ ] `SEED_MOCKUPS=on` crea 10 `mock_*@example.test` (1 por rol) + data de juguete, idempotente; sin el
      flag es no-op. **Issue #5 resuelto** (qué rol usa `mock_admin_ti`).

**V-Metric (F)** *(track paralelo, puede cerrarse después)*
- [ ] `MetricsClient` inyectado; Workspace guarda cubicación (write-through + Outbox) y sube/baja DEM
      contra Railway `/metrics`; B0 sembrado. Follow-up `vmetric_*` flageado (no bloquea la demo).

**Cierre de fase (el owner puede probar cada rol)**
- [ ] Deploy a `web-dev` con A+B+C1+C2 mergeados y mockups sembrados.
- [ ] El owner ingresa con **cada** `mock_*` (login por username o email institucional) y valida:
      visibilidad de módulos/secciones por permiso, botones aprobar/pagar/imprimir según rol, banner
      beta en gerencias, y que crear reembolso/HE se comporta según lo decidido en el Issue #2.
- [ ] QA en vivo por etapa (política `feedback_qa_gates_railway.md`): verificar en el deploy, no asumir.

---

## RESOLUCIONES (autoritativas — OVERRIDE cualquier texto en conflicto de los planes)

Estas decisiones cierran los issues mayores. Al ejecutar, **prevalecen sobre lo que diga cada plan**.

- **#1 · Orden de migraciones** → **B antes que C1**, secuencial sobre `schema.prisma`; tras B, regenerar
  cliente Prisma y recién arrancar C1. Nunca en paralelo sobre el mismo schema.
- **#2 · ¿Managers crean solicitudes propias? → SÍ.** El requerimiento es explícito ("todos los usuarios
  son trabajadores también; el admin de contrato o de finanzas pueden crear sus propias solicitudes").
  **Resolución:** `finance:request:create` se agrega al bundle de **los 10 roles** en el Plan A (es un
  derecho base). El front NO gatea el botón de crear (todos lo tienen). Coordinar A (bundles) + C1
  (endpoint sigue exigiendo `finance:request:create`, que ahora todos poseen) + C2 (botón visible).
- **#3 · Borrador de HE** → **opción (b)**: el backend mantiene `status:'PENDIENTE' + isDraft:true`; el
  **front agrega `isDraft` a `OvertimeView`** y deriva el badge "Borrador" de `isDraft` (no del enum).
  Ajustar C2 (tipo + StatusBadge). NO se agrega `BORRADOR` a `FinanceStatus`.
- **#4 · Nombres vehículo/proyecto en reembolsos** → alinear **C2 al backend real**: `vehicle` +
  `subcategory` (no `vehicleId/Name/Subcategory`). El filtro por proyecto/cliente en la tabla aplica
  **solo a Horas Extra** (los reembolsos no llevan proyecto/cliente); en filas de reembolso ese filtro
  no las excluye (o se muestra "—").
- **#5 · Mock admin TI** → `mock_admin_ti` usa **`roleKey:'admin_ti'`** (el bundle real del Plan A, sin
  FGA admin), NO `org_admin`. Actualizar el Plan E y su nota. Así el owner prueba el bundle `admin_ti` real.
- **D1 · Campo `email`** → **se conserva `email String @unique` NOT NULL** internamente, poblado por el
  servicio = `emailInstitucional ?? emailPersonal`; la "relajación" del spec §4.1 es a nivel DTO/UX (el
  admin ya no ingresa `email`, el login usa `username`, y la regla es ≥1 de institucional/personal).
  Evita el ripple `string|null` en ~15 sitios y mantiene retro-compat web/web-dev. **Confirmado.**

**Sobre `/summary` sin consumidor (C1):** se dejan los endpoints (aditivos, sin costo); C2 agrega
client-side. OK.
