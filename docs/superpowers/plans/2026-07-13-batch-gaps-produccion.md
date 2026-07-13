# Plan — Batch de gaps post-lanzamiento (2026-07-13)

> Roadmap por área. Cada ítem: **qué / enfoque / archivos / esfuerzo**. Al ejecutar cada
> tanda se hace TDD + gates verdes + deploy. Ordenado de quick-wins a features grandes.
> **Fuente de datos del checklist:** `CHECK LIST CAMIONETAS (2).xlsx` (hojas FORMATO
> CHECKLIST, RESPUESTAS ~18.800, VEHICULOS, TRABAJADORES, PROYECTOS).

## Decisiones (confirmadas 2026-07-13)
1. Checklist: **opciones configurables por campo** (cada ítem ESTADO define sus opciones; `config.options`).
2. Cargo: **texto libre** (`User.cargo String?`).
3. Import histórico: **crear los trabajadores como usuarios SIN enviar credenciales**, deduplicando contra los ya existentes (nombres mal escritos/variantes → normalizar la tabla de usuarios). La dueña indicará después activos/inactivos y roles.
4. Ejecución: **todo el plan, en orden** (tandas 1→5, deploy por tanda).
5. (Pendientes menores: alcance de procedimientos-preset; borrado con hijos → bloquear si tiene dependencias.)

---

## Tanda 1 — Quick wins (alto valor, bajo riesgo)

### 1.1 `japalmo` acceso total → org_admin
- **Qué:** que japalmo tenga todo sin restricciones.
- **Enfoque:** agregar Membership `org_admin` @ORGANIZATION a japalmo + tupla FGA `organization:gmt#admin`. org_admin bypassa el `PermissionService` (grants GLOBAL) y el `fga.check` estructural. Se hace por script contra la BD; la tupla FGA la materializa `fga-resync` en el próximo boot del api (o la escribo directa).
- **Archivos:** script one-off (patrón `seed-mockups`); nada de código de app.
- **Esfuerzo:** XS.

### 1.2 Tabs con scroll horizontal en mobile
- **Qué:** en Finanzas y Recursos (y sub-tabs) los tabs se cortan; deben scrollear.
- **Enfoque (central):** en `components/ui/tabs.tsx` (primitivo botón): contenedor → `overflow-x-auto snap-x` + ocultar scrollbar; botones `flex-1` → `shrink-0 snap-start` (mantener `sm:flex-none` para desktop). Arregla TODOS los tab-bars de una. Secundario: la barra de sub-tabs custom del detalle de activo en `recursos/index.tsx` (~L1531) → mismo tratamiento o migrar al primitivo.
- **Archivos:** `nodes/web/src/components/ui/tabs.tsx`; `nodes/web/src/pages/recursos/index.tsx`.
- **Esfuerzo:** S.

### 1.3 OCR de reembolso: español + aviso "interpretando la boleta"
- **Qué:** el concepto vuelve en inglés; falta feedback de espera (tarda varios segundos).
- **Enfoque:** (a) en `receipt-ocr.util.ts` PROMPT: instruir explícitamente que TODOS los valores de texto (`concept`, `category`) se devuelvan **en español de Chile**; opcional agregar `system` message. (b) en `reembolso-form.tsx`: mientras `scanning`, mostrar un **banner** claro ("Estamos interpretando la boleta, espera unos segundos…") + spinner, no solo el ícono del botón.
- **Archivos:** `nodes/backend-central/src/modules/reimbursements/receipt-ocr.util.ts`; `nodes/web/src/pages/finanzas/reembolso-form.tsx`.
- **Esfuerzo:** S.

### 1.4 "Poner en uso" abre el checklist del vehículo
- **Qué:** al poner en uso un vehículo no se abre el formulario de checklist.
- **Enfoque:** hoy `takeUse` solo hace el claim (EN_USO) y el checklist está desacoplado. Al poner en uso un `VEHICULO`: tras el claim, navegar al tab checklist en modo **ejecución**; asegurar que exista una plantilla APROBADA (autocargar la estándar de camioneta si no hay — ya existe `loadDefaultVehicleChecklist`). Encadenar `handleTakeUse` → si `type===VEHICULO` → `goToChecklist(true)`.
- **Archivos:** `nodes/web/src/pages/recursos/index.tsx` (handleTakeUse/goToChecklist); revisar autocreación de plantilla en `assets.service.ts`.
- **Esfuerzo:** S (depende de la Tanda 5 para el checklist tipado; el fix de encadenamiento es chico).

### 1.5 Eliminar "Ubicación y Telemetría"
- **Qué:** sin servicio GPS; quitar el tab.
- **Enfoque:** remover el tab + su lógica (simulación setInterval, POST /telemetry) del detalle. Dejar el endpoint backend por ahora sin uso, o marcarlo deprecado.
- **Archivos:** `nodes/web/src/pages/recursos/index.tsx` (~L2242+).
- **Esfuerzo:** XS.

### 1.6 Accesorios: botón "Agregar" siempre visible
- **Qué:** falta el botón de agregar accesorios.
- **Enfoque:** hoy el form de accesorios solo aparece si `isAdmin`. Exponer el botón "Agregar accesorio" según el permiso correcto (no solo admin duro). CRUD backend ya existe.
- **Archivos:** `nodes/web/src/pages/recursos/index.tsx` (~L1734).
- **Esfuerzo:** XS.

---

## Tanda 2 — CRUD faltante

### 2.1 Editar / borrar solicitudes (reembolsos y horas extra) solo en PENDIENTE
- **Qué:** poder editar/eliminar una solicitud antes de que sea aprobada/rechazada.
- **Enfoque:** máquina de estados (`finance-status.util.ts`): editar/borrar permitido **solo si `status===PENDIENTE`** y por el dueño. Agregar endpoints `PUT/DELETE /reimbursements/:id` y `/overtime/:id` con guard: dueño + estado PENDIENTE (ForbiddenException si no). En la UI, botones editar/borrar visibles solo en PENDIENTE del propio.
- **Archivos:** `reimbursements.{service,controller}.ts`, `overtime.{service,controller}.ts`, DTOs; web `reembolsos.tsx`, `horas-extra.tsx`, `reembolso-form.tsx`.
- **Esfuerzo:** M.

### 2.2 Editar / borrar clientes, faenas y proyectos
- **Qué:** falta borrar (y en proyecto, editar general).
- **Enfoque:** clientes y faenas ya tienen `@Patch(:id)` (update); **falta `@Delete`** en los tres, y update general de proyecto (hoy solo kpis/servicios). Agregar `DELETE /clients/:id`, `DELETE /faenas/:id`, `PUT/PATCH /projects/:id` + `DELETE /projects/:id`, con guard de permiso + manejo de FKs (bloquear o cascada controlada: un proyecto con servicios/datapoints/activos no se borra sin confirmación). UI: botones editar/borrar en las listas + confirmación.
- **Archivos:** `clients/`, `faenas/`, `projects/` (service+controller+dto); web páginas de proyectos/clientes/faenas.
- **Esfuerzo:** M.

---

## Tanda 3 — Directorio + Usuarios/Roles

### 3.1 Campo "cargo" en el perfil + Directorio muestra cargo (no roles)
- **Qué:** el directorio debe listar nombre, **cargo** y correo (no roles). "Cargo" es un campo nuevo del perfil (hoy inexistente).
- **Enfoque:** agregar `cargo String?` al modelo `User` (+ migración Prisma). Exponerlo en el perfil (form de creación/edición de usuario). `listDirectory` deja de derivar roleKeys y devuelve `{ fullName, cargo, email }`. La página de directorio muestra solo esas 3 columnas.
- **Archivos:** `prisma/schema.prisma` (+migración), `users.service.ts` (listDirectory), DTO create/update user, web directorio + form de usuario, contracts.
- **Esfuerzo:** M.

### 3.2 Usuarios → 2 tabs: "Usuarios" (CRUD) y "Roles"
- **Qué:** dividir la sección Usuarios en (a) CRUD + lista de usuarios, (b) Roles (migrar acá la gestión y creación de roles = conjuntos de permisos).
- **Enfoque:** envolver la página de usuarios en el primitivo Tabs; tab 1 = la lista/crud actual; tab 2 = mover acá `roles/role-editor.tsx` (creación de rol = set de permisos, ya existe vía `RolesService`/RolesController). Ajustar navegación/menú.
- **Archivos:** web `pages/usuarios/*`, `pages/roles/role-editor.tsx` (relocar/embeber), router/menú.
- **Esfuerzo:** M.

---

## Tanda 4 — Proyectos / Servicios / Procedimientos

### 4.1 Servicios: sin código, elegir TIPO + nombre; tipos como presets de "procedimientos"
- **Qué:** el tab Servicios pide código; debe elegir un **tipo de servicio** y darle un nombre. Los tipos sirven como **presets de rutinas → renombrar a "procedimientos"**.
- **Enfoque:** nuevo catálogo `ServiceType` (o `Procedimiento`) reusable: {nombre, y opcionalmente un preset de checklist/campos}. `createService` deja de exigir `code` (autogenera o lo omite) y pasa a recibir `serviceTypeId` + `name`. UI del tab servicios: Select de tipo + Input nombre. Los "procedimientos" quedan como plantillas reusables que un servicio instancia.
- **Archivos:** `prisma/schema.prisma` (modelo ServiceType/Procedimiento + FK en Service, +migración), `projects.service.ts` (createService), DTO, web tab servicios, contracts.
- **Esfuerzo:** M-L (define un concepto nuevo — ver decisión).

---

## Tanda 5 — Activos: Checklist tipado + Ficha + Import histórico (la grande)

### 5.1 Modelo de checklist TIPADO
- **Qué:** en "Checklist y control" se DEFINEN los campos y su tipo (no se llena). Tipos: `BOOLEAN` (Sí/No), `ESTADO` (Bueno/Regular/Malo, +No aplica), `ENTERO`, `FECHA`, `TEXTO`, y campos doc `BOOLEAN+FECHA_VENCIMIENTO`. El llenado (submissions) ya existe.
- **Enfoque:** extender el union de tipo de item (hoy `YES_NO|NUMBER|TEXT`) en la **fuente única** `packages/contracts` → `BOOLEAN|ESTADO|ENTERO|FECHA|TEXTO` (mapear legacy YES_NO→BOOLEAN, NUMBER→ENTERO, TEXT→TEXTO al leer, sin romper los históricos). Item tipado `{ id, label, type, required, config? }` con validación **Zod estricta** en `UpdateChecklistTemplateDto` (hoy `Record<string,unknown>[]` sin validar); mantener columna `Json` en Prisma (evita migración masiva). Generalizar `submitChecklist` (detección de falla) para los nuevos tipos (ESTADO Malo = falla, etc.). Diseñador de plantilla en el tab (ya existe) + Select de tipo ampliado.
- **Archivos:** `packages/contracts/src/index.ts`, `nodes/web/src/types/assets.ts`, `assets.service.ts` (submitChecklist, defaults), `assets.dto.ts` (Zod), `nodes/web/src/pages/recursos/index.tsx` (diseñador).
- **Esfuerzo:** L.

### 5.2 Reorganizar la vista detalle del activo
- **Qué:** Documentos (ok). Accesorios (+botón, 1.6). **Checklist y control** = definir campos (5.1), NO llenar. **Historial** = respuestas de checklist (con detalle) + eventos (creación/cambios/docs). **Ubicación/Telemetría** = eliminar (1.5). **Información General** = campos editables + quitar los botones que viven ahí. **Ficha pública** = mostrar docs del vehículo + último checklist.
- **Enfoque:** el detalle es un monolito de 2726 líneas (`recursos/index.tsx`) → **partir en componentes** por tab (deuda GAP5b pendiente, buen momento). Info General: agregar `PUT /assets/:id` (hoy solo /status y /assign) para editar fabricante/identificador/subtipo/metadata inline; quitar los botones de esa card. Historial: unificar (hoy hay duplicado) + agregar la lista de submissions de checklist con vista de detalle. Ficha pública: extender `getPublicByToken`/`AssetPublicView` para incluir documentos (los vigentes) + último checklist (resumen), y renderizarlo en `public/activo.tsx` bajo el QR.
- **Archivos:** `recursos/index.tsx` (split), `assets.service.ts` (PUT general + getPublicByToken), `assets.controller.ts`, `assets.dto.ts`, contracts (AssetPublicView), `public/activo.tsx`.
- **Esfuerzo:** L (incluye el split del god-component).

### 5.3 Crear los vehículos + importar el histórico de checklists
- **Qué:** subir los ~11 vehículos y las ~18.800 respuestas históricas del Excel a la BD.
- **Enfoque:** script de import (patrón `bridge-vmetric-datapoints`): (a) crear los `Asset` VEHICULO desde la hoja VEHICULOS (patente, marca, modelo, subtipo camioneta/furgón, metadata); (b) asegurar/crear una `ChecklistTemplate` estándar aprobada de camioneta con los ~30 campos tipados (mapeados de las 92 columnas de RESPUESTAS); (c) por cada fila de RESPUESTAS, crear una `ChecklistSubmission` sobre el vehículo (por patente/idVeh), con `answers` = {itemId, value} por campo, `createdAt` = datetime real, atribuida a un usuario de sistema (como se hizo con V-Metric) o al trabajador si se crean. Firma (pngFirma) queda como URL de referencia. Correr contra Railway; verificar en vivo.
- **Archivos:** nuevo `scripts/import-vehiculos-checklists.ts`; usa el Excel local.
- **Esfuerzo:** L (parsing + mapeo de 92 columnas + volumen).

---

## Orden sugerido de ejecución
1. **Tanda 1** (quick wins) — se puede desplegar en 1-2 lotes rápidos.
2. **Tanda 5.1** (modelo checklist tipado) — habilita 1.4, 5.2 y 5.3.
3. **Tanda 5.3** (crear vehículos + import) — pobla datos reales.
4. **Tanda 2** (CRUD) y **Tanda 3** (directorio/usuarios) — en paralelo.
5. **Tanda 4** (servicios/procedimientos) y **5.2** (reorg detalle) — las de más diseño.

## Decisiones que necesito confirmar
1. **Estados del checklist:** la data real usa **Bueno / Regular / Malo** (no "Bien/Mal/No aplica"). ¿Uso `Bueno/Regular/Malo` + opción **No aplica**? ¿Cuál cuenta como "falla" para las alertas (Malo, o Malo+Regular)?
2. **Cargo:** ¿campo de **texto libre** en el perfil, o **catálogo cerrado** de cargos? (texto libre es más rápido).
3. **Import histórico:** los ~18.800 checklists, ¿los atribuyo a un **usuario de sistema** (como V-Metric) o creo/enlazo a los **trabajadores** del Excel (que hoy no son usuarios)? ¿Los trabajadores se crean como usuarios o quedan como texto en la submission?
4. **Procedimientos (tipos de servicio):** ¿un catálogo simple {nombre} por ahora, o ya con **preset de checklist/campos** asociado? (define el alcance de la Tanda 4).
5. **Borrado de proyectos/clientes/faenas con hijos:** ¿bloquear si tiene servicios/activos/datapoints (más seguro), o permitir borrado en cascada con confirmación fuerte?
