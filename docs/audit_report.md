# Auditoría integral — GMT Link (demo MVP)

**Fecha:** 2026-06-23 · **Rama:** `feat/modulos-1-4` · **Auditor:** Claude (Opus 4.8)
**Alcance:** validar estabilidad de la demo (Capstone tareas/tiempos + Albemarle visor 3D), UX/UI y proponer fixes.

> **Veredicto:** la demo es **DEMOSTRABLE** tras corregir un **bug crítico de login** que la bloqueaba por completo (detallado abajo, ya aplicado). El resto de los flujos clave se validaron en vivo con navegador. Quedan mejoras de pulido y de "limitación estricta de acceso" pendientes (no bloquean la demo).

---

## 1. Resumen de Estado (checks por flujo)

| Flujo / Check | Estado | Observaciones |
|---|---|---|
| **Login (todos los roles, `TempPass123`)** | ✅ (tras fix) | **Estaba 100% roto** (ver Fix #1). Arreglado y verificado: `supervisor@capstone.cl` → "Hola, Camila"; `ito@albemarle.cl` → "Hola, Claudio". |
| Sidebar — logo expandido `h-14` | ✅ | `sidebar.tsx`: bar `h-16`, logo `h-14 max-w-[170px]`. |
| Sidebar — V-metric oculto para Capstone | ✅ | Verificado en vivo: nav de `supervisor@capstone.cl` no incluye V-metric. |
| Sidebar — V-metric visible para Albemarle | ✅ | Verificado: nav de `ito@albemarle.cl` incluye V-metric. |
| Operaciones — Backlog (Kanban/Tabla) | ✅ | Las 3 tareas sembradas renderizan; toggle Kanban↔Tabla presente. |
| Operaciones — Wizard "Nueva tarea" (entregable/`dataSpec`) | ⚠️ | Botón de creación no localizado por texto en el smoke test automatizado; **verificar manualmente** (probable icono/label distinto). Código de `dataSpec` presente. |
| Concurrencia (solo el iniciador cierra) | ✅ (backend) | Lock verificado en `tasks.service.ts` (`startTime`/`finishTime`). Test multi-sesión en vivo: **recomendado manual** (no automatizable con 1 navegador). |
| Vista ITO — solo `COMPLETADO` + columna centrada | ⚠️ | No validado en vivo (sin tarea completada en el set actual). Verificar manualmente. |
| ITO — Solicitud de Actividad | ⚠️ | No validado en vivo. Verificar manualmente. |
| **V-metric — Visor 3D (Three.js) + tabla + gráfico** | ✅ | Verificado: `<canvas>` 960×770 renderizado, tabla de cubicación (8 vars), gráfico temporal, Reservorio 2. DEM real R2. |

Leyenda: ✅ Pasa · ⚠️ Pasa parcial / verificar manual · ❌ Falla.

---

## 2. Diagnóstico Técnico (static analysis + entorno)

| Check | Comando | Resultado |
|---|---|---|
| TypeScript API | `pnpm --filter @gmt-link/api exec tsc --noEmit` | **exit 0 (sin errores)** |
| TypeScript Web | `pnpm --filter @gmt-link/web exec tsc --noEmit` | **exit 0 (sin errores)** |
| Tests API (Vitest) | `pnpm --filter @gmt-link/api run test` | **25 archivos, 227 tests — todos verdes** |
| Docker (PostgreSQL/OpenFGA/Redis) | `docker compose ps` | up + `gmt_postgres` healthy |
| Migraciones Prisma | `prisma migrate status` | 15 migraciones, **schema al día** |
| Seed / datos | psql | 9 usuarios, 2 clientes (Capstone+Albemarle), Element R2, 4 tareas |
| Puertos | API 3001 · Web 5173 · FB emu 9099 · FGA 8080 · PG 5432 | todos arriba |
| DEM servido | `GET /dem/R2.json` | HTTP 200, 731 KB (grid 216×199) |

**Conclusión:** integridad de código y entorno **sólida**. El único fallo de estabilidad fue de configuración del emulador (Fix #1), no de código de tipos/tests.

---

## 3. Auditoría de UX/UI

**Rendimiento del visor 3D.** El DEM real R2 (2597×2391) se reduce a un grid 216×199 (~43k vértices) — rinde fluido en Three.js con `OrbitControls` y exageración vertical ×6 (necesaria: solo 4.3 m de relieve sobre ~117 m). Carga el JSON estático desde `public/` (731 KB), sin servidor de tiles: arranque rápido y confiable para la demo. *Mejora futura:* mostrar un loader/`Suspense` mientras se descarga+monta la malla (hoy aparece "Cargando visor 3D…" como texto, suficiente pero mejorable a un skeleton).

**Consistencia de inputs.** El login usa inputs controlados de React; OK. *Hallazgo:* el formulario de login no deshabilita el botón "Ingresar" ni muestra spinner mientras `signIn`+`getMe` resuelven — si la API tarda, el usuario no tiene feedback (ver Fix #5).

**Estados de carga.** El dashboard y operaciones tienen estados, pero el visor y algunos modales se beneficiarían de transiciones más suaves y skeletons (ver Fixes #5–#6).

**Responsividad móvil.** A ~668px (móvil) el sidebar colapsa a drawer (hamburguesa) y muestra el logo compacto — correcto. El visor 3D y la tabla de cubicación se apilan; la tabla hace overflow-x (scroll horizontal) — aceptable. Verificar el Kanban en móvil (puede requerir scroll horizontal por columnas).

**Marca.** Logo expandido `h-14` proporcionado ✓. *Hallazgo menor:* V-metric figura en `nav-items.ts` con `placeholder: true` → puede pintar el badge "Pronto" pese a estar implementado (ver Fix #4).

---

## 4. Checklist de Fixes e Implementación (priorizado)

### 🔴 ALTA

**Fix #1 — Login roto: emulador Firebase iniciado sin proyecto fijo. [APLICADO]**
*Síntoma:* todo login fallaba ("Correo o contraseña incorrectos"), bloqueando la demo entera.
*Causa raíz:* el emulador se lanzó con `firebase emulators:start` **sin `--project`** y no había `.firebaserc` → el emulador usó un proyecto default ≠ `demo-gmt-link`. El seed (`firebase-admin`, proyecto `demo-gmt-link`) escribía los usuarios en otra partición que el web (`VITE_FIREBASE_PROJECT_ID=demo-gmt-link`) no consultaba.
*Fix aplicado:* se creó `.firebaserc` fijando el proyecto default, y se reinició el emulador con el proyecto correcto:
```json
// .firebaserc (NUEVO)
{ "projects": { "default": "demo-gmt-link" } }
```
*Procedimiento de arranque correcto (documentar para la demo):*
```bash
firebase emulators:start --only auth        # ahora toma demo-gmt-link de .firebaserc
pnpm --filter @gmt-link/api exec tsx scripts/seed-firebase-mvp.ts   # recrear usuarios (emulador es in-memory)
```
*Nota:* el emulador de Auth es **in-memory** → cada reinicio borra los usuarios. **Siempre** re-correr `seed-firebase-mvp.ts` tras (re)levantar el emulador. Recomendado: agregar al emulador `--import=./.firebase-data --export-on-exit` para persistir, o un script `dev:emu` que encadene start+seed.

**Fix #2 — La API debe estar arriba para que el login complete.**
*Síntoma:* con el emulador OK pero la API caída, `signIn` funciona pero `getMe()` cuelga → el login no avanza ni muestra error.
*Acción:* asegurar `pnpm --filter @gmt-link/api dev` (puerto 3001) antes de demostrar. *Mejora de robustez:* en `auth-context.tsx`, dar timeout/feedback a `getMe()` para no quedar colgado si la API no responde.

### 🟡 MEDIA

**Fix #3 — Visibilidad de módulos por "hack" de email, no por permisos. [APLICADO]**
*Antes:* `apps/web/src/components/layout/sidebar.tsx` filtraba por dominio de email (`user?.email?.endsWith('@capstone.cl')`), frágil y acoplado.
*Fix aplicado (commit `130bb22`):* el backend `GET /auth/me` ahora devuelve `user.modules` derivado del cliente real (`Membership PROJECT → Project → Client.code` → `CLIENT_MODULES`). El sidebar filtra por `item.module` con un único `canSeeModule`. CAP → `[dashboard, operaciones]`; ALB → `[dashboard, v-metric]`; org_admin / cliente desconocido → todos. Ver `auth.controller.ts:resolveModules()`.

**Fix #4 — "Limitación estricta de acceso" no implementada. [APLICADO]**
*Hallazgo:* el brief pide que Capstone se limite a **Dashboard + Operaciones** y Albemarle a **Dashboard + V-metric**.
*Fix aplicado (commit `130bb22`):* el mismo `canSeeModule` del Fix #3 filtra **tanto `PRIMARY_NAV` como `SECONDARY_NAV`**, por lo que `supervisor@capstone.cl` ya NO ve Usuarios/Directorio/Finanzas/Recursos/Herramientas. Verificado en navegador: Capstone = `[Dashboard, Operaciones]`, Albemarle = `[Dashboard, V-metric]`.

**Fix #5 — Feedback de carga en login. [YA IMPLEMENTADO — falso positivo]**
*Verificación:* `login.tsx` ya mantiene `submitting` durante **todo** el flujo (`login()` en `auth-context.tsx` espera `signInWithEmailAndPassword` **y** `getMe`). El `Button` (`components/ui/button.tsx`) con `loading` renderiza spinner (`Loader2 animate-spin`), aplica `disabled` + `aria-busy`, y los inputs se deshabilitan; el texto cambia a "Ingresando…". No requiere cambios.

### 🟢 BAJA

**Fix #6 — Badge "Pronto" en V-metric ya implementado. [APLICADO]**
*Fix aplicado (commit `130bb22`):* se quitó `placeholder: true` de la entrada V-metric en `nav-items.ts`; ya no pinta el badge "Pronto".

**Fix #7 — Loader/skeleton del visor 3D. [APLICADO]**
*Fix aplicado (commit `130bb22`):* `dem-viewer.tsx` reemplaza "Cargando visor 3D…" por un skeleton del canvas (`animate-pulse`) + spinner SVG mientras se descarga el grid (731 KB) y se monta la malla.

**Fix #8 — Verificar entrypoint del Wizard de tareas. [RESUELTO — falso negativo del smoke]**
*Verificación:* el botón existe en `backlog.tsx:521` con el texto **"Nueva Tarea"** (T mayúscula); el smoke automatizado buscó "Nueva tarea" (minúscula) → falso negativo por sensibilidad a mayúsculas. Está correctamente gateado: `!isReadOnly` (supervisor/operador) abre el wizard (`setWizardStep(1); setCreateOpen(true)`); el ITO (`isIto`, read-only) ve en su lugar "Solicitud de Actividad".

---

## 5. Notas de verificación pendiente (manual, antes de la demo)

1. **Concurrencia en vivo:** Operador 1 inicia una tarea; con Operador 2 (otra sesión/incógnito) confirmar que el botón "Detener/Finalizar" está bloqueado y aparece el mensaje *"Solo el operador que inició la actividad puede cerrarla."* (lógica ya en `tasks.service.ts`).
2. **Flujo ITO:** crear una tarea, completarla, y como `ito@capstone.cl` confirmar (a) Kanban de una sola columna centrada con la completada, (b) descarga del entregable, (c) "Solicitud de Actividad" → llega al supervisor en `PENDIENTE`.
3. **Re-seed de usuarios** tras cualquier reinicio del emulador (in-memory).

---

*Generado durante la auditoría en vivo (static analysis + entorno + smoke tests con navegador headless sobre `http://localhost:5173`).*
