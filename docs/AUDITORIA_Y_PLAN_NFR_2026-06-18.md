# GMT Link — Auditoría crítica + Plan de implementación (NFR)

**Fecha:** 2026-06-18 · **Alcance:** click-path audit del código nuevo (Antigravity) + diagnóstico del login + plan para los 9 requisitos no funcionales.
**Método:** pruebas dinámicas en navegador + 6 agentes especialistas en paralelo (Web, Product Design, Security, Secure Build, QA, DevOps). 70 hallazgos.
**Estado:** documento de planificación. **No se implementó nada** — esto es la lista + el plan para ejecutar con Antigravity.

---

## 1. Resumen ejecutivo

La **base original** del proyecto es sólida y disciplinada: guards fail-closed, autorización vía OpenFGA, `ApiError` tipado, estados carga/vacío/error consistentes (`WidgetShell`), sanitización anti path-traversal centralizada, claves con CSPRNG, `.env` fuera de git y **sin secretos reales commiteados**.

El problema está en **(a)** el código nuevo de Antigravity, que introdujo regresiones críticas, y **(b)** la distancia entre la app actual (un proceso pensado para una laptop) y los 9 NFR (multi-tenancy físico, auth propia, aislamiento, multicloud, <2s, 50 concurrentes).

**Lo más urgente (rompe el uso hoy):**
1. **El `<Toaster>` de sonner nunca se monta.** 8 archivos disparan `toast.success/error` tras el "fix" BUG-09 (alert→toast), pero no hay `<Toaster>` en el árbol → **todos los toasts son no-ops silenciosos**. El usuario no recibe NINGUNA confirmación ni error al tomar/liberar activos, crear activos, subir/borrar liquidaciones, telemetría, etc. Es peor que el `alert()` original.
2. **Login sin feedback** (el bug que reportaste) — confirmado y reproducido. Causa raíz abajo.
3. **`GET /gamification/profile` → HTTP 500** en cada carga del dashboard (controller usa `req.userId`, que no existe).
4. **El módulo `metrics`/`v-metric` (sin commitear) tiene 3 vulnerabilidades CRÍTICAS**: path traversal en subida/descarga, OTP público con `Math.random`, y cero autorización OpenFGA. **No debe mergearse así.**

---

## 2. Diagnóstico del login (reproducido de punta a punta)

**El backend está bien.** Lo probé con curl: emulador Firebase → token → `GET /auth/me` = **HTTP 200** con el usuario. El bug es del **frontend + fragilidad operacional**:

1. `signInWithEmailAndPassword` (Firebase) tiene éxito.
2. El observer en `apps/web/src/context/auth-context.tsx:58` dispara `getMe()` y, si falla, hace `.catch(() => setUser(null))` — **traga el error** sin distinguir "401 token inválido" (cerrar sesión es correcto) de "API caída / red" (status 0 / 5xx).
3. `apps/web/src/pages/login.tsx:62` solo captura errores de `signIn` (que ya resolvió con éxito) → `error` queda `null`, `submitting` → `false`.
4. Resultado: el usuario se queda en `/login` **sin ningún mensaje**.

**Reproducción (navegador):** API caída + emulador arriba + credenciales correctas → atascado en `/login`, `errorShown: null`, red muestra `GET /auth/me → ERR_CONNECTION_REFUSED`, consola sin logs.

**Por qué pasa "en la vida real":** la API se cae fácil porque `FGA_API_URL` apunta a una IP de WSL que cambia, no hay readiness check, y el front no comunica el fallo. El fix BUG-01 de Antigravity (re-auth en first-login) NO tocó la causa raíz del login normal.

**Fix correcto:** en el observer, inspeccionar `err instanceof ApiError`: `status === 401` → `signOut` + `user=null`; `status === 0 || >= 500` → exponer `authError` en el contexto (sin cerrar la sesión de Firebase) y que login/ProtectedRoute lo muestren con botón **Reintentar**. (IDs: WEB-02, DESIGN-01, QA-06, SECURITY-07, SECURE-BUILD-05.)

---

## 3. Hallazgos priorizados (70)

### 3.1 CRÍTICOS

| ID | Área | Hallazgo | Fix |
|----|------|----------|-----|
| WEB-01 | Frontend | `<Toaster>` nunca montado → todos los `toast.*` son no-ops silenciosos (8 archivos) | Montar `<Toaster richColors closeButton />` una vez en `App.tsx` |
| WEB-02 / DESIGN-01 / QA-06 / SECURITY-07 | Auth | Login sin feedback cuando `getMe()` falla | Distinguir 401 vs red en `auth-context`, exponer `authError`, botón reintentar |
| API-01 *(hallazgo dinámico)* | Backend | `GET /gamification/profile` → 500 (`req.userId` no existe; es `req.authUser.id`) | Corregir `gamification.controller.ts:17`; añadir `@RequirePermission` o devolver 401 |
| SECURITY-01 | Seguridad | Path traversal en subida/descarga de archivos del módulo `metrics` | Sanitizar key (patrón de `local-storage.service.ts`); bloquear merge |
| SECURITY-02 / QA-04 | Seguridad | Endpoints `metrics` sin autorización OpenFGA (solo `if(!user)`) | `@RequirePermission` en todos; revisar cross-tenant |
| SECURITY-03 | Seguridad | OTP público + `Math.random` + almacenamiento en memoria | OTP con CSPRNG, endpoint autenticado, store en Redis/BD con TTL |
| DEVOPS-01 | Infra | Postgres/Redis expuestos al host sin red interna ni gateway (viola NFR1) | Red interna Docker, no publicar 5432/6379, gateway |
| DEVOPS-02 | Infra | Credenciales de BD débiles y hardcodeadas (`gmt_dev_2024`) | Secrets manager; rotar credenciales |
| DEVOPS-03 | Infra | `PrismaService` monolítico de una sola BD bloquea multi-tenancy (NFR2) | Rediseño con pool por tenant (ver §5) |

### 3.2 ALTOS

| ID | Área | Hallazgo |
|----|------|----------|
| WEB-03 / QA-11 / SECURITY-11 | Calidad | `any` explícito en `v-metric`/`metrics` (viola regla dura cero-any) |
| WEB-04 | Bug | `v-metric`: re-init frágil del mapa Leaflet (destroy+recreate en deps; race en StrictMode) |
| MAP-01 *(dinámico)* | Bug | Widget mapa: el contenedor solo monta si hay activos ubicados, pero el `useEffect` de init depende de `[loading,error]` → no inicializa si 0 activos al primer render |
| WEB-07 | Perf | Sin code-splitting: firebase + leaflet + 25 páginas en el bundle inicial (impacta NFR8) |
| TASK-01 / DESIGN-02 *(dinámico)* | Bug | Widget de tareas enlaza a `/operaciones/backlog` (ruta inexistente) → wildcard → dashboard |
| DESIGN-03 / WEB-05 | UX | `prompt()` nativo para motivo de rechazo en `recursos` (BUG-09 incompleto) |
| DESIGN-04 | UX | El anillo de rango no comunica que el rango baja ni cómo se sube |
| DESIGN-05 | UX/NFR6 | No existe formulario in-app de reporte de errores/propuestas |
| SECURITY-04 | Seguridad | Sin Helmet, ValidationPipe global, rate-limiting ni CORS por entorno |
| SECURITY-05 | Seguridad | Bypass `x-debug-user` dependiente de un solo flag `NODE_ENV` |
| SECURITY-06 | Seguridad | Endpoints sin `@RequirePermission` en varios módulos (autorización por `if(!user)`) |
| SECURE-BUILD-02 | Auth | No hay forgot/reset password ni verificación de email (ausente, no migrable) |
| SECURE-BUILD-03 | Auth | Tokens Firebase no revocables + sin logout server-side → killswitch/suspensión sin efecto inmediato |
| SECURE-BUILD-04 | Auth | Política de contraseña trivial, sin registro de intentos ni rate-limit |
| SECURE-BUILD-09 | Auth | "Todo propio" ≠ reinventar criptografía: usar libs probadas (argon2/jose) o IdP self-hosted |
| QA-01 | Perf | `Membership` sin índice secundario → full scan en cada listado bajo carga |
| QA-02 | Perf | FGA checks sin caché y en serie → latencia multiplicada con concurrencia |
| QA-03 | Perf | `PrismaService` sin config de connection pool → saturación con 50 concurrentes |
| QA-05 / DEVOPS-08 | Concurrencia | OTP y tokens de upload en `Map` en memoria → rompen con múltiples réplicas |
| QA-10 | Calidad | Cobertura de tests cero en servicios nuevos y calientes: tasks, projects, metrics |
| DEVOPS-04 | Infra | Sin aprovisionamiento automático de BD por cliente (NFR2) |
| DEVOPS-05 | Infra | Sin Dockerfile API/Web, sin CI/CD, sin IaC (bloquea NFR5) |
| DEVOPS-06 | Infra | Healthcheck estático sin readiness real (causa operacional del bug de login) |
| DEVOPS-07 | Infra | Redis declarado pero no cableado (sin caché, killswitch ni estado compartido) |
| DEVOPS-09 | Infra | FGA como dependencia externa única en cada check, sin resiliencia |

### 3.3 MEDIOS

| ID | Área | Hallazgo |
|----|------|----------|
| WEB-06 | Bug | Anillo de gamificación: color `rgba(var(--border),0.15)` inválido con tokens oklch → track no se pinta |
| WEB-08 | Bug | Telemetría simulada: interval con stale closure de `loadData`/`simSpeed` + refetch de 5 endpoints por tick |
| WEB-09 | Bug | `DashboardCustomizer`: en éxito no resetea `saving` (botón loading indefinido) |
| WEB-10 | Perf | Sin cancelación de requests (AbortController) y avalancha de fetch al montar el dashboard |
| MAP-02 *(dinámico)* | UX | Copy engañoso: "Telemetría en tiempo real" / "transmitiendo" sobre datos estáticos |
| TASK-02 *(dinámico)* | Datos | Gráfico de tareas agrupa "completadas" por `createdAt`, no por fecha de completado |
| DESIGN-06 | UX/NFR8 | No hay overlay de carga con blur para la home |
| DESIGN-07 | UX | Barras de tabs no responsivas a 375px (recursos, v-metric) |
| DESIGN-08 | UX | Tipografía sub-mínima y emojis como iconografía (viola regla solo-lucide) |
| SECURITY-08 | Seguridad | Tokens Firebase sin manejo explícito de refresh/expiración |
| SECURITY-09 | Seguridad | Uploads sin validación de tipo de contenido real (solo tamaño/extensión) |
| SECURITY-10 | Seguridad | Endpoint público de activos por código expone datos sin permiso |
| SECURE-BUILD-06 | Auth | Token Bearer vía `getIdToken()` en TODAS las llamadas → punto único a reescribir |
| SECURE-BUILD-07 | Auth | `NoopEmailService` deja sin enviar tokens críticos en silencio |
| SECURE-BUILD-08 | Auth | Sin cola ni reintentos de email (fallo SMTP transitorio pierde el correo) |
| SECURE-BUILD-10 | Auth | Provisión crea credencial Firebase en saga con compensación → replicar atomicidad al migrar |
| QA-07 | Perf | N+1 en `projects.injectCurrentKpi` (un aggregate por proyecto listado) |
| QA-08 | Perf | N+1 en `metrics.saveDataPoints` (findUnique en loop sin transacción) |
| QA-09 | Perf | `DataPoint` sin índices pese a filtrarse por phaseId/elementId/variableId |
| QA-12 | Seguridad | Sin rate limiting (NFR9 y endpoints sensibles: OTP, login) |
| DEVOPS-10 | Infra | `main.ts` sin hardening de producción ni graceful shutdown |
| DEVOPS-11 | Infra | Sin observabilidad (logs no estructurados, sin métricas ni trazas) |
| DEVOPS-12 | Infra | Pool sin límites por tenant (riesgo de agotamiento con DB-por-cliente) |

### 3.4 BAJOS

WEB-11 (empresas sin normalizar trim/case), WEB-12 (avatar upload fallo invisible por WEB-01), DESIGN-09 (carrusel sin `prefers-reduced-motion`), DESIGN-10 (confirmación destructiva inconsistente entre módulos), SECURITY-12 (API key de Gemini en query string; SSRF acotado), QA-13 (`void awardPoints` sin await), SECURE-BUILD-01 (sesión anclada por email → migración segura respecto a OpenFGA), SECURE-BUILD-11 (DevUserMiddleware debe seguir fail-closed).

---

## 4. Plan de implementación por fases

> Orden pensado para **estabilizar primero** (sin decisiones), **endurecer** después, y dejar los **refactors XL arriesgados** (auth propia, multi-tenancy) para cuando estén tomadas las decisiones de §6.

### FASE 0 — Estabilización crítica *(sin decisiones · hacer ya)*
- **WEB-01** Montar `<Toaster>` en `App.tsx` + verificar cada acción nueva.
- **WEB-02** Login: manejar el fallo de `getMe()` (401 vs red), `authError` + reintentar.
- **API-01** `gamification.controller.ts`: `req.authUser.id`; añadir guard.
- **TASK-01** Corregir enlaces muertos `/operaciones/backlog` → `/operaciones`.
- **MAP-01 / WEB-04** Arreglar init del mapa (Leaflet) en dashboard y v-metric.
- **WEB-05 / DESIGN-03** Reemplazar `prompt()` por `RejectDialog`.
- **WEB-06** Color del track del anillo de gamificación (token válido).
- **Decisión bloqueante:** módulo `metrics`/`v-metric` (SECURITY-01/02/03) — **remediar o revertir** antes de mergear.

### FASE 1 — Hardening de seguridad base *(bajo riesgo, alto valor)*
- **SECURITY-04** Helmet + `ValidationPipe` global + `@nestjs/throttler` + CORS por entorno.
- **SECURITY-05 / SECURE-BUILD-11** `x-debug-user` fail-closed (doble flag + nunca en prod).
- **SECURITY-06 / SECURITY-10** `@RequirePermission` en endpoints faltantes; revisar endpoint público de activos.
- **SECURITY-09** Validación de tipo de contenido real (magic bytes) en uploads.
- **DEVOPS-10** `main.ts`: hardening + graceful shutdown.
- **WEB-03 / QA-11** Eliminar `any` de código nuevo.

### FASE 2 — Rendimiento y concurrencia *(NFR8, NFR9)*
- **QA-01 / QA-09** Índices: `Membership(userId,scopeType)`, `DataPoint(phaseId,elementId,variableId)`.
- **QA-03 / DEVOPS-12** Config de connection pool (`connection_limit`) + PgBouncer si aplica.
- **QA-02 / DEVOPS-09** Caché de checks FGA (Redis, TTL corto) + resiliencia.
- **QA-07 / QA-08** Resolver N+1 (projects KPIs, metrics).
- **WEB-07** Code-splitting con `React.lazy`/`Suspense` por ruta → bundle inicial.
- **WEB-10** `AbortController` (o adoptar TanStack Query) + evitar avalancha en dashboard.
- **DESIGN-06 / NFR8** `LoadingOverlay` global (blur + skeletons; gif si se aprueba).
- **DEVOPS-06** Readiness check real (DB + FGA) → evita el escenario del bug de login.
- **QA** Suite de carga k6 (login, dashboard, crear tarea) con SLO p95 < 3s @ 50 usuarios.

### FASE 3 — Servicios propios *(NFR4 → NFR3 · requiere decisiones §6)*
- **NFR4 (primero)** Módulo de email propio: SMTP + plantillas + **outbox** (tabla) con reintentos. Reemplaza `NoopEmailService`.
- **NFR3** Auth propia (reemplazo de Firebase) — **ver decisión D2**: libs probadas (argon2 + jose) o IdP self-hosted (Keycloak/Ory). Incluye: login/logout/refresh, cookies HttpOnly+SameSite, CSRF, forgot/reset password (SECURE-BUILD-02), verificación de email, registro de intentos + lockout (SECURE-BUILD-04), **revocación server-side** (SECURE-BUILD-03, habilita killswitch).
- Migración: identidad anclada por email (SECURE-BUILD-01) → OpenFGA no se toca. Contraseñas: **ver decisión D6**.

### FASE 4 — Aislamiento + multi-tenancy *(NFR1, NFR2, NFR5 · XL · requiere decisiones §6)*
- **DEVOPS-01** Red interna, no exponer 5432/6379, gateway seguro de BD.
- **DEVOPS-03 / DEVOPS-04** Multi-tenancy — **ver decisión D1** (BD-física-por-cliente vs schema-per-tenant). Router de tenant + pool con caché y límites + aprovisionamiento automático (CREATE + `prisma migrate deploy` programático) + ejecución de migraciones en N destinos.
- **DEVOPS-05 / NFR5** Dockerfiles API/Web, CI/CD, IaC (Terraform), secret manager, 12-factor, abstracciones de storage/email/colas para evitar lock-in.

### FASE 5 — Mantenimiento + observabilidad *(NFR6)*
- **DEVOPS-11** Logs estructurados (pino), métricas (Prometheus), trazas (OpenTelemetry).
- **NFR6** Panel admin: telemetría (CPU/mem/latencia DB/conexiones del pool), **killswitch** (flag en Redis/BD + middleware 503, **ver decisión D5**), benchmarks.
- **DESIGN-05** Formulario in-app de reporte de errores/propuestas → bandeja admin.
- **DEVOPS-07** Cablear Redis (caché, killswitch, colas, OTP).

### FASE 6 — UX polish + tests *(NFR7)*
- **DESIGN-04** Anillo de rango: comunicar sube/baja y alinear modelo backend con el copy (**ver decisión D7**).
- **DESIGN-07 / DESIGN-08 / DESIGN-09 / DESIGN-10** Responsive 375px, tipografía, iconos lucide (no emojis), reduced-motion, confirmación destructiva consistente.
- **QA-10** Tests de los servicios nuevos (tasks, projects, metrics) + regresión de los bugs de Fase 0.
- **WEB-11 / TASK-02 / MAP-02** Normalizar empresas, métrica de completadas por fecha correcta, copy honesto del mapa.

---

## 5. Notas de arquitectura (multi-tenancy y auth)

**Multi-tenancy (NFR2).** Prisma no soporta múltiples BD nativamente. Dos caminos:
- **BD física por cliente** (lo que pediste): máximo aislamiento; costo operacional alto (N bases: conexiones, backups, migraciones, pool por tenant). Riesgo de fuga si el switching de conexión falla bajo concurrencia (choca con NFR9). Esfuerzo **XL**.
- **Schema-per-tenant** (un Postgres, un schema por cliente): aislamiento lógico fuerte, mucho menos overhead, migraciones más simples. Esfuerzo **L**. Recomendado por los especialistas salvo requisito regulatorio de separación física.

En ambos: la identidad/usuarios y el catálogo de clientes viven en la **BD core `gmt`**; el tenant se resuelve **después** de autenticar (claim en el token propio o subdominio).

**Auth propia (NFR3).** "Todo propio" **no** debe significar criptografía casera (altísimo riesgo). Opciones que cumplen "sin servicio externo que quede obsoleto":
- **Libs probadas self-hosted**: `argon2id` (hashing) + `jose` (JWT) en el propio NestJS. Control total, sin SaaS.
- **IdP open-source self-hosted**: Keycloak / Ory — cumplen "todo propio" sin reimplementar primitivas.

---

## 6. Decisiones que debes tomar (bloquean Fases 3-5)

- **D1 — Multi-tenancy:** ¿BD física por cliente (XL, máximo aislamiento) o schema-per-tenant (L, aislamiento lógico fuerte)?
- **D2 — Auth:** ¿auth propia con libs probadas (argon2+jose) o IdP self-hosted (Keycloak/Ory)? (No criptografía casera.)
- **D3 — Módulo `metrics`/`v-metric`:** ¿remediar las 3 vulns críticas o revertir/descartar? (El cliente PyQt externo, ¿sigue existiendo?)
- **D4 — Despliegue:** ¿VPS único con Docker Compose, Kubernetes gestionado, o PaaS (Fly/Render)? Define el alcance de IaC y del gateway.
- **D5 — Killswitch:** ¿global, por tenant, por módulo? ¿quién lo acciona (solo super-admin GMT)? ¿requiere step-up auth?
- **D6 — Migración de contraseñas:** ¿reset masivo por email (requiere NFR4 listo) o el admin reemite claves provisorias (flujo §9 actual)?
- **D7 — Gamificación:** ¿rango ABSOLUTO por hábito (puntos 30 días vs umbrales, puede bajar — actual) o RELATIVO a pares (ranking competitivo — lo que sugiere el copy)?
- **D8 — Infra dev:** ¿hay Redis disponible para producción? (caché FGA, killswitch, OTP, colas lo asumen.) ¿secrets manager disponible/planificado?
- **D9 — Toasts:** confirmar sonner global (`<Toaster>`) como estándar (afecta 8 archivos ya escritos).

---

*Generado por auditoría multi-agente. Detalle completo de planes NFR por especialista en los informes del workflow.*
