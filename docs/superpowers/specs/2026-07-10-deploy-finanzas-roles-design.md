# Deploy Finanzas + Roles — Diseño (Fase 1)

**Fecha:** 2026-07-10
**Estado:** Diseño aprobado (roadmap + modelo de roles). Pendiente de review del spec.

## Goal

Dejar **GMT Link deployable con cuentas reales** empezando por la sección **Finanzas**, con un
modelo de **roles/permisos** que refleje la organización, control de acceso **por permiso**
(no por nombre de rol), **login por username**, y todo lo demás **oculto/bloqueado** hasta
habilitarlo por permiso. Primero se valida con **usuarios de prueba (uno por rol)** en un
ciclo de prueba↔corrección; recién después se crean las cuentas reales y se activa el email.

## Arquitectura (decisiones cerradas)

- **Un environment Railway** (`production`) con **dos servicios web**: `web` (público/estable)
  y `web-dev` (pruebas), **compartiendo la misma `api` y la misma BD**. Se deploya lo nuevo a
  `web-dev`; cuando está conforme, se promueve a `web`. Corolario: **los cambios de api/BD deben
  ser retrocompatibles** y las features se prenden/apagan **por permiso** (no por build).
- **Control de acceso por permiso** en front (visibilidad de secciones/botones) y en backend
  (guard de módulo/permiso a nivel de ruta). Se elimina el gating por `roleKey` hardcodeado.
- **BD única** (sin multitenant por ahora; los scaffolds de tenant quedan congelados).
- **Repo privado** + **branch protection** en `main` (PR + aprobación del owner).

## Tech Stack

NestJS + Prisma + OpenFGA + Postgres (backend `nodes/backend-central`); React 19 + Vite +
Tailwind v4 + shadcn/ui (`nodes/web`); auth propia JWT+bcrypt; `PermissionService` como fachada
única de autorización (ADR-0001); NVIDIA multimodal (`common/nvidia.ts`) para OCR; `SmtpEmailService`
(nodemailer) para email; R2 (`R2StorageService`) para archivos; pdf-lib para PDFs.

---

## 1. Roadmap por fases

| Fase | Contenido | Salida |
|---|---|---|
| **1 · Fundaciones + Finanzas** | roles/permisos · gating por permiso (front+ruta) · login username + emails inst/personal · módulos por permiso (default: Inicio/Finanzas/Config/Perfil) · rework Finanzas · infra/seguridad base | build |
| **1b · Usuarios de prueba** | 1 mockup por rol; el owner ingresa con cada uno | deploy `web-dev` |
| **1c · Ciclo prueba↔corrección** | el owner prueba, se corrige, hasta conforme | validado |
| **2 · Proyectos (simplificado)** | forms cliente/faena/proyecto · mapa satelital faena · cards trabajador+detalle · docs HSE/Calidad · servicios con encargados. Oculto, habilitable por permiso | spec propio |
| **3 · Cuentas reales + email** | usuarios reales por lote · plantilla de correo (con owner) · envío de credenciales · promover `web-dev`→`web` | deploy real |
| **∥ Infra/Seguridad** | repo→privado + branch protection · 2ª web (dev) · scrub cred dev + `.gitignore` + rotar creds legacy · SMTP en Railway · alinear `R2_*` | base segura |
| **∥ V-Metric** | cablear el shell nuevo a Railway `/metrics` | mini-spec propio |

**Fase 1 es el foco de este spec.** Fase 2/3 y V-Metric se detallan en specs propios; acá solo se
listan sus dependencias.

---

## 2. Modelo de roles → permisos

### 2.1 Principios
- **Todo usuario es también Trabajador** (crea/ve sus propias solicitudes). Los roles agregan capacidades.
- El gating (front y backend) se decide **por permiso**, nunca por nombre de rol → roles nuevos y
  custom "encienden" solos sus secciones/botones.
- Los roles se siembran como **roles de sistema** (`isSystem:true`) en `prisma/seed.ts` con sus bundles.
- **Claves huérfanas** (`supervisor`, `operador`, `ito`, `adm_contrato` en contracts/role-labels sin
  bundle): se **eliminan** del catálogo de labels (o se mapean a los nuevos). No se usan.

### 2.2 Permisos nuevos/necesarios (extender el catálogo de `seed.ts`)

Módulo **finanzas** (todos FUNCTIONAL salvo indicación):
- `finance:request:create` — crear solicitudes propias (reembolso + horas extra). *(base de Trabajador)*
- `finance:overtime:create:onbehalf` — crear HE en nombre de otro trabajador, **sin restricción de fecha**.
- `finance:request:view:all` — ver solicitudes de todos (reembolsos + horas extra).
- `finance:overtime:view:all` — ver horas extra de todos (subconjunto, para RH).
- `finance:request:approve` — aprobar/rechazar.
- `finance:payment:register` — registrar pago.
- `finance:print:batch` — impresión en lote de boletas (exclusivo finanzas).
- *(la vista de solicitudes propias no requiere permiso: es el default de todo usuario autenticado.)*

Módulo **proyectos** (para Fase 2, pero se define el permiso ahora para el modelo de roles):
- `project:view:all` — visualizar toda la sección proyectos (read-only).
- `project:manage` — crear cliente/faena/proyecto + asignar trabajadores. *(ya existe como `project:create`/`faena:create`/`client:create`/`project:team:manage` — se agrupa)*
- `project:doc:upload:worker` — subir documentación de trabajadores.
- `project:doc:upload:project` — subir documentación del proyecto (general).
- `project:doc:upload:hse` — subir documentación HSE.

Módulo **sistema**:
- `system:beta:full` — acceso completo con **alerta de beta** (gerencias RH y general). Habilita todo
  como admin pero el front muestra el banner "versión beta, no realizar cambios sin consultar".

Se conservan `finance:manage` (compat) y los permisos existentes; el nuevo catálogo es aditivo.

### 2.3 Bundles por rol (perm · scope)

- **`trabajador`** (base, todos lo tienen implícito o como bundle): `finance:request:create`.
- **`admin_contrato`**: `finance:request:view:all`, `finance:request:approve`,
  `finance:overtime:create:onbehalf`, `project:manage`.
- **`admin_finanzas`**: `finance:request:view:all`, `finance:request:approve`,
  `finance:payment:register`, `finance:print:batch`, `project:view:all`,
  `project:doc:upload:worker`, `project:doc:upload:project`.
- **`analista_rh`**: `finance:overtime:view:all`, `project:view:all`, `project:doc:upload:worker`.
- **`analista_finanzas`**: `finance:request:view:all`, `finance:payment:register`, `finance:print:batch`.
- **`asesor_hse`**: `project:view:all`, `project:doc:upload:hse`.
- **`gerencia_proyectos`**: idéntico a `admin_contrato`.
- **`gerencia_rh`**: `system:beta:full` (= todo, con banner beta).
- **`gerencia_general`**: `system:beta:full` (= todo, con banner beta).
- **`admin_ti`**: `org_admin` (superadmin de sistema; todo el catálogo GLOBAL).

Scope: los permisos de finanzas son **GLOBAL** (la organización es una sola en esta fase). Los de
proyectos, GLOBAL para "view:all"/"manage"/doc-upload (simplificado; se refina en Fase 2).

### 2.4 Reglas de negocio de las solicitudes (backend)
- **Horas extra – restricción de fecha**: si el creador NO tiene `finance:overtime:create:onbehalf`,
  la fecha se fuerza al **día en curso** (no puede ser anterior/posterior). Si lo tiene, puede elegir
  cualquier fecha y crear **en nombre de** otro trabajador (campo `onBehalfOfUserId`).
- **Cierre mensual de HE = día 20**: para agrupar por "mes", el mes de una HE con fecha ≤ día 20 es el
  mes calendario; con fecha > día 20 cuenta como **mes siguiente**. (Helper `overtimeMonth(fecha)`.)
- **Motivo de rechazo**: se **persiste** un campo `rejectionReason` en `Reimbursement` y
  `OvertimeRequest` (hoy no existe) → migración aditiva.
- **Flag de impresión**: se agrega `printedAt`/`printed` a `Reimbursement` (para el flujo de lote).

---

## 3. Control de acceso (refactor)

### 3.1 Backend
- Exponer los permisos efectivos del usuario en `GET /auth/me` (ya expone `roleKeys`/`modules`; agregar
  `permissions: string[]` derivados de `PermissionService`).
- Guard de ruta/módulo: `@RequirePermission` ya existe para STRUCTURAL; para los permisos FUNCTIONAL de
  finanzas se usa `PermissionService.can` inline (patrón clients/faenas) en cada endpoint.
- **Visibilidad de módulos por permiso**: `resolveModules` (auth.controller) pasa de hardcode
  `CLIENT_MODULES[code]` a **derivar de permisos** (mapa permiso→módulo). Default: todo usuario ve
  `inicio`, `finanzas`, `configuracion`, `perfil`. `proyectos` solo si tiene `project:view:all` o
  `project:manage` (Fase 2, oculto hasta entonces). El resto (recursos, operaciones, directorio,
  gis-tools, usuarios, roles, v-metric) **oculto** salvo permiso explícito.

### 3.2 Frontend
- Reemplazar `useHasRole([...])` por `useHasPermission('perm')` (nuevo hook que lee
  `profile.permissions`). Migrar todas las consts `*_ROLES` a checks por permiso.
- **Guard de ruta** (`ProtectedRoute` hoy solo mira `UserStatus`): agregar un `RequireModule`/
  `RequirePermission` que redirige (a Inicio) si el usuario entra por URL a una sección sin permiso.
- Sidebar/nav: filtra por `modules` (ya lo hace) — que ahora vienen derivados de permisos.
- **Banner beta**: si el usuario tiene `system:beta:full`, mostrar un banner no intrusivo en las
  secciones incompletas ("versión beta en desarrollo; se sugiere no realizar cambios sin consultar
  con el admin del sistema").

---

## 4. Auth: login por username + emails

### 4.1 Modelo `User` (migración aditiva)
- `username String @unique` — **login por username** (default = prefijo del email institucional,
  editable por admin). Obligatorio.
- `emailInstitucional String? @unique`, `emailPersonal String?` — **mínimo uno de los dos**.
  El campo `email` actual se **conserva** (compat) y se mapea al institucional o personal según
  corresponda; se relaja `@unique`/obligatoriedad hacia los nuevos campos. (Detalle de migración de
  datos existentes en el plan.)
- Validación: al crear/editar usuario, exigir username único + al menos un email.

### 4.2 Flujo de login
- `login.dto`: `username` (string) + `password` (hoy `@IsEmail` → username).
- `auth.service`: `findUnique({ where: { username }})`.
- Front `login.tsx`: campo "Usuario" en vez de "Email".
- Primer login forzado (cambio de clave) se mantiene igual.

### 4.3 Creación de usuarios
- Form/CSV: agrega username (autosugerido del email institucional), emailInstitucional, emailPersonal.
- Clave provisoria: igual que hoy (CSPRNG, mostrada una vez en `CredentialDialog`).
- **Email de credenciales**: cablear `SmtpEmailService` a la provisión — pero **DESACTIVADO por
  defecto** (flag). Se activa en Fase 3, con plantilla acordada. En Fase 1b/1c la clave se ve en la UI.

---

## 5. Finanzas (rework)

### 5.1 Quitar
- Subsección **Liquidaciones** (UI + rutas + gating; el backend `liquidations` se deja pero se
  desconecta de la UI, o se marca oculto).
- **Import de reembolsos** (no funcional) — quitar el botón/flujo.

### 5.2 Vista general (nueva) — sobre la lista histórica
Al entrar a Finanzas: **cards arriba** + **tabla histórica abajo**. Las cards se **recalculan según el
filtro** de la tabla.

**Cards para roles con acceso a todos** (admins, gerencias, RH, analista finanzas):
- Horas extra pendientes (cantidad).
- Monto total pendiente de reembolso (**solo aprobados**, pendientes de pago).
- **Card 2 estados (carrusel)** — reembolsos: ranking trabajadores × total pendiente / horas extra:
  ranking trabajadores × horas. Orden desc. Dos puntitos con flechas ocultas (aparecen en hover),
  autoalterna cada 5s; **clic congela** el estado.
- **Card 2 estados por proyecto** — proyectos en curso × HE / total reembolso, desc.
- **Alertas**: solicitudes pendientes de resolución → clic abre overlay con detalle + aprobar/rechazar.
- Card HE 2 estados: pendientes / aprobadas. Card reembolsos 2 estados: pendiente de aprobación /
  aprobado pendiente de pago.

**Cards para Trabajador** (solo sus datos):
- HE pendientes (cantidad). Monto reembolso pendiente (aprobado, pend. de pago).
- Card por proyecto 2 estados: proyectos donde reportó HE × cuántas / reembolsos por proyecto
  (solo los proyectos con datos).

### 5.3 Tabla histórica
- Todas las solicitudes; **filtros**: por trabajador *(solo roles con acceso a todos; Trabajador no
  ve este filtro)*, por fecha (antes/después/entre/exacta), por **mes** (cierre día 20), por proyecto,
  por cliente; **orden por fecha** asc/desc.
- Default: **mes en curso**.
- Paginación abajo-derecha: selector todas / 20 / 50 / 100 por página + flechas prev/next.
- Las **cards se actualizan con el filtrado**.

### 5.4 Vistas específicas (Reembolsos / Horas Extra)
- Cada una: lista histórica + arriba botón "Nueva solicitud" que abre el overlay con el formulario.

### 5.5 Formulario de Reembolso (con OCR)
Campos: **Foto de boleta** (subir imagen o **tomar foto con cámara en móvil**) → dispara OCR NVIDIA
que **autocompleta** los campos; **Concepto** (descripción corta); **Monto** (total boleta);
**Categoría** (desplegable: Alimentación · Transporte · **Vehículos** {si es Vehículos aparece un
selector de **vehículo** (input hoy hidden) + subcategoría: Combustible/Mantención-Limpieza/Repuesto/Otro} ·
Otro(s)); **Fecha** (de la boleta); **Observaciones** (opcional).
- OCR: endpoint `POST /reimbursements/scan-receipt` (multipart imagen) → NVIDIA visión → JSON
  `{concept, amount, date, category}` (patrón `detectShoreline`). El front pre-llena; el usuario corrige.
- La imagen se guarda en storage (R2). **Fix**: `extractStorageKey`/`generateBatchPdf` deben soportar
  keys de R2 (hoy asumen URL local `/files/`) para que la impresión en lote funcione con R2.

### 5.6 Formulario de Horas Extra
Campos: **Hora inicio** (obligatoria); **Hora término** (puede quedar pendiente → solicitud
**borrador** que se cierra luego); **Fecha** (Trabajador: fija hoy; con `overtime:create:onbehalf`:
cualquier fecha); **Proyecto** (lista de proyectos asignados + opción "Otro" con texto libre);
**Autorizado por** (ex "Jefatura": selección de usuarios con rol admin_contrato o gerencias).
- Estado **borrador** (draft) hasta que se cierra con hora término.
- Si `onBehalfOfUserId` presente (permiso), la solicitud se crea a nombre de ese trabajador.

### 5.7 Impresión en lote de boletas (ampliar el flujo existente)
Botón en subsección Reembolsos (permiso `finance:print:batch`, exclusivo finanzas):
1. Overlay: seleccionar boletas — "todas las pendientes de impresión" o selección manual (usa el flag
   `printed`).
2. Elegir boletas por hoja + orientación + tamaño de hoja.
3. **Preview** del PDF (imágenes + tablita por boleta: concepto, monto, categoría, nombre del usuario).
4. Confirmar → **descarga el PDF** → recién ahí se marca cada solicitud como **impresa** (`printedAt`).
- Reutiliza `composeReceiptsPdf` (extender con orientación/tamaño + la tablita + el marcado post-descarga).

---

## 6. Usuarios de prueba (Fase 1b) + ciclo (1c)
- Seed/script que crea **1 usuario mockup por rol** (admin_contrato, trabajador, admin_finanzas,
  analista_rh, analista_finanzas, asesor_hse, gerencia_proyectos, gerencia_rh, gerencia_general,
  admin_ti) con claves conocidas (solo en `web-dev`), + solicitudes de reembolso/HE de ejemplo.
- El owner ingresa con cada uno y valida permisos/UX. Se corrige en ciclo hasta conforme.
- **No** se envían emails en esta fase.

---

## 7. Infra / Seguridad / Git (track paralelo, habilita el deploy)
- **Repo → privado** + **branch protection** en `main` (requiere PR + aprobación del owner; nadie
  mergea directo). Rama de trabajo del compañero: cualquier `feat/*`.
- **Segundo servicio web** `web-dev` en Railway (mismo Dockerfile web, `VITE_API_URL` a la misma api).
- **Seguridad**: sacar la credencial dev (`admin@gmt.cl/AdminGmt2026`) de `seed-admin.core.ts` y docs
  → solo por env (`ADMIN_PASSWORD`). Endurecer `.gitignore` (`*.key`, `*.pem`, `service-account*.json`,
  `firebase-key.json`, `/data`). Rotar/eliminar creds legacy del `.env` (Firebase/Gemini). Alinear
  `.env.example` a `R2_BUCKET`/`R2_ENDPOINT`. Confirmar con cliente si `data-reservorios.json`/`public/dem`
  pueden quedar (o moverlos fuera del repo).
- **SMTP**: configurar `SMTP_*` en Railway (para Fase 3). Email de credenciales **desactivado** hasta Fase 3.

---

## 8. V-Metric (track paralelo — mini-spec propio)
Cablear el shell **nuevo** de V-Metric (hoy local-only SQLite) para leer/escribir cubicaciones/DEMs
contra Railway `/metrics` (auth JWT ya migrada; endpoints + R2 ya listos). Se diseña/planifica aparte;
no bloquea Fase 1.

---

## 9. Fuera de alcance de Fase 1
- Detalle de **Proyectos** (Fase 2): forms, mapa satelital, cards trabajador+detalle, docs HSE/Calidad,
  servicios con encargados. Solo se define el **permiso** que los gatea.
- **Cuentas reales** + **envío de emails** (Fase 3).
- Multitenant / BD por cliente (congelado).

## 10. Riesgos / decisiones abiertas
- Migración de datos de usuarios existentes al agregar `username`/emails (backfill: username = prefijo
  del email actual; email actual → institucional). Definir en el plan.
- `web` y `web-dev` comparten api/BD → toda feature debe ser retrocompatible + gateada por permiso.
- Confirmar aceptabilidad de la data geoespacial pública del cliente antes de mover el repo (ya será privado).
