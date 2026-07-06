# Evaluación de arquitectura — GMT Link + V-Metric → Railway (auth propia, BD por cliente)

> **Origen:** ejército de 12 agentes (8 especialistas + 3 red-team + arquitecto jefe), 2026-07-06.
> ~1M tokens, verificado contra el repo. Este documento decide el rumbo antes del plan de implementación.

## Decisiones ya cerradas por el usuario (2026-07-06)
1. **Aislamiento:** una "BD" por cliente, TODO dentro de Railway (no instancia única, no infra del cliente).
2. **Forma del backend:** monolito `backend-central` (eliminar/congelar los scaffolds vacíos).
3. **V-Metric:** migrar a la auth propia AHORA (cerrar el gap con Firebase).
4. **Datos iniciales:** migrar los datos del PostgreSQL local a producción.
5. **Todo propio:** sin Firebase ni dependencias de servicios externos de identidad.

## Decisiones pendientes de confirmar (ver §5 del veredicto)
- Soberanía de datos (¿Albemarle/Capstone exigen residencia en Chile / su infra?) — BLOQUEANTE.
- "BD por cliente" = ¿schema-per-tenant (recomendado) o base física separada?
- ¿Smoke-test en Railway antes de declarar producción?

---

Verificación completada contra el repo (todos los hechos load-bearing del red-team confirmados). Aquí está el veredicto de síntesis.

---

# Veredicto del Arquitecto Jefe — Plataforma GMT (Railway, auth propia, BD-por-cliente)
### 2026-07-06 · Síntesis de 8 evaluaciones + red-team de 3 pilares · Verificado en repo

---

## 1. Veredicto ejecutivo

**El rumbo actual está mayormente correcto en su BASE (auth propia + monolito NestJS + una Postgres) pero el DISEÑO OFICIAL escrito (multicloud gateway-por-tenant) hay que enterrarlo, y la solución que casi todo el panel propuso para reemplazarlo — *database-per-tenant físico alcanzado por multi-datasource Prisma* — también hay que rechazarla.** Verifiqué en el repo el hallazgo decisivo del red-team: de ~50 modelos Prisma, **solo `User.clientId` (opcional) y `Project.clientId` llevan el tenant**; los ~48 restantes —incluido TODO `metrics` (Element/Phase/Variable/DataPoint), RRHH, CV, Assets, Warehouse— cuelgan de `projectId`/`userId` en un único grafo relacional con FKs. **No existe una línea de corte por cliente**, así que fragmentar en N bases físicas rompe FKs cross-database (Prisma no las soporta), obliga a duplicar catálogos y fuerza joins en memoria en CADA request, no solo en reportes. Para 2 clientes eso es sobre-ingeniería con ratio costo/beneficio negativo. **El camino óptimo: desplegar el monolito single-DB en Railway YA (cumple req 1 y 2), endurecer el aislamiento lógico con RLS/scoping por clientId como defensa en profundidad, y satisfacer el req 3 con `schema-per-tenant` (search_path) SOLO para las tablas genuinamente por-cliente (metrics/projects) sobre un schema `core` compartido — NO database-per-tenant, NO gateway.** Los scaffolds auth-service/tenant-gateway/sdk-gateway se **congelan (no se borran)**: la premisa de soberanía no está muerta, está NO VERIFICADA con el cliente, y borrarlos destruye el único puente a infra-del-cliente. Antes de ir a producción hay un **gate de bloqueantes innegociables** (V-Metric roto, admin de credencial pública re-sembrado, sin throttler, IDs de OpenFGA inexistentes) que NO son "hardening posterior".

---

## 2. Arquitectura objetivo recomendada

### Topología en Railway (proyecto `valiant-rebirth`)

```
                        Internet (HTTPS público)
                              │
                ┌─────────────┴──────────────┐
                │                            │
        ┌───────▼────────┐          ┌────────▼────────┐
        │   web (Vite)   │          │  V-Metric .exe  │
        │  serve -s dist │          │  (PySide6, PC)  │
        └───────┬────────┘          └────────┬────────┘
                │  Bearer JWT propio          │  Bearer JWT propio
                │  (mismo emisor)             │  (mismo emisor)
                └──────────────┬──────────────┘
                               │
                    ┌──────────▼───────────┐
                    │   api  (NestJS)      │  ← auth propia VIVE aquí
                    │  backend-central     │    (/auth/login, JWT HS256,
                    │  23 módulos + auth   │     SessionMiddleware)
                    │  ProvisioningService │
                    └───┬──────────────┬───┘
             railway.internal      railway.internal
                    │              │
         ┌──────────▼───┐   ┌──────▼─────────┐
         │  openfga     │   │  Postgres GMT  │  ← UNA instancia
         │ (1 store)    │   │                │
         └──────┬───────┘   │ ┌────────────┐ │
                │           │ │ schema core│ │ users, roles, clients,
         ┌──────▼───────┐   │ │ (compartido)│ │ RRHH, CV, assets, catálogos
         │ Postgres-fga │   │ ├────────────┤ │
         │ (backing)    │   │ │schema t_alb│ │ metrics+projects Albemarle
         └──────────────┘   │ ├────────────┤ │
                            │ │schema t_cap│ │ metrics+projects Capstone
                            │ └────────────┘ │
                            └────────────────┘
    ── CONGELADOS, NO desplegados: auth-service · tenant-gateway · sdk-gateway ──
```

*Redis se difiere al MVP; entra cuando se implemente refresh-token denylist y se saque el token-store de uploads de memoria (ver Gaps).*

### Tabla de decisiones

| Decisión | Elección | Por qué |
|---|---|---|
| **(a) Topología Railway** | 4 servicios de cómputo/datos: `postgres-gmt`, `openfga` (+ su Postgres backing), `api`, `web`. Auto-deploy desde `main`. Dominio público solo a api y web. | Cubre req 1 y 2 sin código nuevo. El repo ya es Railway-ready (Dockerfiles, `/health`, `migrate deploy`, CORS por env). Cada servicio extra del multicloud es costo recurrente sin beneficio con todo-en-Railway. |
| **(b) Auth propia compartida** | **MANTENER** núcleo bcrypt(12) + JWT HS256 `{sub}` emitido por `backend-central`, re-lectura de estado/roles desde Postgres en `/me`. Web y V-Metric usan el MISMO token como Bearer. Identidad vive en **schema `core`** (invariante). | Fundación correcta y verificada: `algorithms:['HS256']` cierra alg:none, 401 genérico evita enumeración, token minimalista permite suspensión casi inmediata. Extraer a auth-service separado = YAGNI (un solo emisor/verificador). El token `{sub}`+lookup exige que la identidad NO se fragmente por tenant → por eso `core` compartido. |
| **(c) Multi-tenancy + auto-provisión** | **schema-per-tenant** (Postgres `search_path`) para las tablas genuinamente por-cliente (`metrics`, `projects`) sobre schema `core` compartido. Provisión automática = `CREATE SCHEMA` + migrar solo esas tablas + registrar tenant→schema en `core` + sembrar tuplas OpenFGA. Ejecutar el mismo comando a mano para Albemarle y Capstone. | El dominio NO tiene línea de corte por cliente (verificado: 2 de ~50 modelos). schema-per-tenant resuelve FKs (catálogos en `core`), evita el fan-out de 18 migraciones a N bases y el rollback distribuido, y **no requiere superusuario ni `CREATE DATABASE`** (el red-team confirmó que el rol de app en Railway típicamente no tiene CREATEDB). Aísla por credencial/search_path sin fracturar el grafo. |
| **(d) auth-service / tenant-gateway / sdk-gateway** | **CONGELAR** (no desplegar, no completar, **no borrar**). Moverlos a `docs/exploración` o marcarlos `[diferido]` en CLAUDE.md. | Son healthchecks vacíos verificados; su única justificación (soberanía en infra del cliente) está NO verificada, no muerta. Borrarlos elimina el puente a soberanía si Albemarle (minera, jurisdicción chilena plausible) lo exige. Congelar = costo cero + opción preservada. |
| **OpenFGA** | UN solo store, aislamiento por tuplas (`client:albemarle`), **+ RLS/`WHERE clientId` como defensa en profundidad**. FGA-por-tenant diferido indefinidamente. | Hoy `metrics` NO filtra por clientId (verificado: 0 refs) — el aislamiento descansa 100% en corrección de tuplas, sin barrera de datos. Un error de siembra filtra DataPoints entre mineras competidoras. RLS es la red de seguridad. |

---

## 3. Dónde el rumbo es correcto (MANTENER) vs dónde corregir (CAMBIAR)

| # | Ítem | Decisión | Esfuerzo |
|---|---|---|---|
| 1 | Auth propia núcleo (bcrypt 12 + JWT HS256 `{sub}` + SessionMiddleware) | **MANTENER** | — |
| 2 | Dockerfiles api/web + openfga (distroless→Alpine) | **MANTENER** | — |
| 3 | Single-DB como base de datos de la plataforma; `Client` como entidad de 1ª clase | **MANTENER** | — |
| 4 | Contrato `/metrics` desktop↔backend (endpoints ya calzan 1:1) | **MANTENER** transporte | — |
| 5 | Diseño multicloud gateway-por-tenant + federación + FGA-por-tenant | **CAMBIAR → descartar** (congelar scaffolds) | S |
| 6 | database-per-tenant físico + multi-datasource Prisma (lo que propuso el panel) | **CAMBIAR → NO adoptar**; usar schema-per-tenant | — |
| 7 | Aislamiento solo-OpenFGA sin barrera de datos | **CAMBIAR → añadir RLS/scoping clientId** | M |
| 8 | Auth de V-Metric (Firebase → propia) + refresh vía securetoken | **CAMBIAR → reescribir path completo** | M |
| 9 | Token-store de uploads DEM en `Map` en memoria | **CAMBIAR → Postgres/Redis o JWT corto** | S |
| 10 | Provisión automática schema-per-tenant + seed reescrito por tenant | **CAMBIAR → construir (nuevo)** | L |
| 11 | Fan-out de migraciones a schemas + drift check + sacar `migrate` del CMD | **CAMBIAR → construir** | M |
| 12 | `railway-deploy.md` (Firebase, sin AUTH_JWT_SECRET, contradictorio Nixpacks/Docker) | **CAMBIAR → reescribir** | S |
| 13 | Seed admin de credencial pública re-sembrada por deploy | **CAMBIAR → rotar/no sembrar en prod** | S |
| 14 | Sin throttler + sin helmet en login público | **CAMBIAR → añadir** | S |
| 15 | `nodes/v-metric` como submodule; Python en monorepo pnpm | **CAMBIAR → mantener repo HTTP independiente** | S |

---

## 4. Gaps críticos priorizados (bloqueantes de producción)

| Sev | Gap | Evidencia verificada | Remediación |
|---|---|---|---|
| **CRÍTICO** | **V-Metric autentica con Firebase; el backend ya no valida Firebase → todo `/metrics` = 401 en prod.** | `firebase_auth.py:29` `signInWithPassword` a identitytoolkit; SessionMiddleware solo HS256 propio | Crear `poza/gmt_auth.py`: `POST /auth/login`→JWT, `GET /auth/me`. Cambiar `id_token`→`jwt` en `call_function`. |
| **CRÍTICO** | **Retry de V-Metric llama `refresh_session_token`→securetoken de Firebase, que la auth propia NO emite → 401-loop en threads background tras migrar.** | `firebase_http.py:74`→`:36` securetoken; auth propia solo `/login` y `/me` | ELIMINAR `refresh_session_token`/retry-securetoken; sustituir por re-login explícito ante 401. La migración es **esfuerzo M+, no "una línea"**. |
| **CRÍTICO** | **Admin `admin@gmt.cl` / `AdminGmt2026` re-sembrado por `upsert` en cada deploy + sin throttler + sin helmet en URL pública = toma de cuenta org_admin día 1.** | `seed-admin.ts:26-27,38` upsert; grep throttler/helmet en backend = 0 | Rotar/forzar cambio de credencial admin o no sembrarla en prod; `@nestjs/throttler` 5/min/IP en `/auth/login`; `helmet`. **NO diferible.** |
| **ALTO** | **Aislamiento de `metrics` descansa 100% en tuplas OpenFGA; cero filtro por clientId a nivel de datos → un error de siembra filtra datos entre mineras competidoras.** | grep `clientId` en `src/modules/metrics` = 0 | RLS Postgres o `WHERE clientId` como defensa en profundidad. |
| **ALTO** | **`keyring` no se usa en ningún módulo de `poza/` (solo en el `.spec`) → "guardado seguro" es trabajo nuevo, no ajuste.** | grep keyring en poza = 0 refs de uso | Implementar `keyring.set/get_password('V-Metric', email, jwt)` + validar contra `/auth/me` al arrancar. |
| **ALTO** | **DEM upload token-store en `Map` en memoria → falla intermitente y silenciosa con >1 réplica o reinicio en Railway.** | `metrics.service.ts:31` `new Map()`; `:626 resolveToken` | Mover a Postgres/Redis o firmar JWT de corta vida. |
| **ALTO** | **`FGA_STORE_ID`/`FGA_MODEL_ID` no existen; sin `fga:bootstrap` toda autorización por proyecto falla en el primer arranque.** | railway-deploy.md §4 | Correr `fga:bootstrap` contra openfga desplegado ANTES del primer deploy productivo y cargar IDs como env del api. |
| **MEDIO** | **`railway-deploy.md` obsoleto: manda `FIREBASE_*`/`VITE_FIREBASE_*`, omite `AUTH_JWT_SECRET`, es contradictorio Nixpacks vs Dockerfile.** | railway-deploy.md §2/§5/§8; firebase-admin eliminado | Reescribir: quitar Firebase, añadir `AUTH_JWT_SECRET` (+validar ≥32 bytes en boot), fijar `RAILWAY_DOCKERFILE_PATH` por servicio. |
| **MEDIO** | **Sin PITR/backup por-tenant; el aislamiento de schema NO da aislamiento de disponibilidad (todo en un cluster).** | Railway respalda la instancia, no por schema | Activar PITR del cluster; documentar explícitamente que el aislamiento es de DATOS, no de disponibilidad. |

---

## 5. Decisiones que requieren confirmación del usuario (máx. 3)

1. **Soberanía de datos — BLOQUEANTE antes de crear las BD.** ¿Albemarle o Capstone exigen contractualmente residencia/soberanía de datos (en Chile o en su propia infraestructura)? El multicloud entero se justificaba con esto y hoy es una **suposición no verificada**. → *Si NINGUNO lo exige:* Railway es válido, schema-per-tenant procede. *Si ALGUNO lo exige:* esa BD específica va a su infra vía `DATABASE_URL` por túnel desde el día 1 (y ahí sí se descongela el gateway para ESE tenant). **Registrar la respuesta como ADR antes de provisionar.**

2. **Interpretación de "una BD por cliente" (req 3).** ¿Aceptas que "BD por cliente" se implemente como **schema-per-tenant** (aislamiento por `search_path` + credencial, un solo Postgres, sin romper FKs ni multiplicar migraciones) en lugar de **database física separada**? Es la diferencia entre L de esfuerzo con FKs intactas vs XL recurrente con fan-out distribuido y grafo fracturado — para 2 clientes. Mi recomendación fuerte es schema-per-tenant; la database física solo si (1) lo activa, o si el conteo de clientes supera ~10-15.

3. **Producción sin pruebas locales (req 1) vs smoke-test staged.** El req dice "sin más pruebas locales, todo online". Pero con V-Metric roto e IDs de OpenFGA inexistentes, un primer deploy exitoso de web/api **prueba plomería, no los flujos críticos**. ¿Autorizas un smoke-test mínimo en el propio Railway (login web + login V-Metric + un check OpenFGA) antes de declarar "producción" y mostrarla a clientes? Recomiendo sí; es 30 min que evitan un día-1 fallido frente a clientes reales.

---

## 6. Implicancias para el plan de implementación (orden de fases)

**Fase 0 — Verificación y desbloqueo (antes de tocar arquitectura).**
Confirmar soberanía con Albemarle/Capstone (Decisión 1) y registrar ADR. Confirmar Decisiones 2 y 3. Sin esto, cualquier trabajo de tenancy es apuesta.

**Fase 1 — Gate de seguridad de producción (bloqueante, va primero que el deploy).**
Throttler + helmet en `/auth/login`; rotar/eliminar admin sembrado en prod; validar entropía de `AUTH_JWT_SECRET` en boot. Reescribir `railway-deploy.md` (quitar Firebase, añadir AUTH_JWT_SECRET, corregir Docker path).

**Fase 2 — Deploy single-DB en Railway (cumple req 1 + req 2 web).**
Desplegar 4 servicios. Correr `fga:bootstrap`, cargar STORE/MODEL IDs. Sacar `prisma migrate deploy` del CMD a un pre-deploy command (evita carreras con >1 réplica). Smoke-test de login web + un check OpenFGA.

**Fase 3 — Cerrar V-Metric (cumple req 2 desktop) — el gap crítico.**
`poza/gmt_auth.py` (login→JWT, `/auth/me`); cambiar `id_token`→`jwt`; **eliminar refresh-vía-securetoken → re-login ante 401**; persistir JWT con `keyring`; fijar `VMETRIC_GMT_LINK_API_URL` a Railway; quitar `firebase-key.json` del bundle. Smoke-test: login V-Metric + una cubicación end-to-end.

**Fase 4 — Defensa en profundidad del aislamiento (antes de multi-tenant).**
Añadir RLS/`WHERE clientId` sobre metrics/projects; mover el token-store de uploads DEM fuera del `Map` en memoria.

**Fase 5 — schema-per-tenant + provisión automática (cumple req 3).**
`ProvisioningService`: `CREATE SCHEMA` + migrar tablas de negocio + registrar tenant→schema en `core` + sembrar tuplas OpenFGA. Fan-out de migraciones sobre schemas + drift check + bloqueo de deploy si diverge. Reescribir el seed para apuntar por tenant. **Crear Albemarle y Capstone con ese comando como primer uso.**

**Fase 6 — Endurecimiento diferido (post-deploy inmediato, no indefinido).**
Access token corto (15-60 min) + refresh rotatorio con denylist en Redis; cookie httpOnly + CSRF para web (manteniendo Bearer para desktop); PITR del cluster; PgBouncer si se esperan >5 tenants × réplicas.

**Congelado, fuera del plan:** auth-service, tenant-gateway, sdk-gateway, federación cross-tenant, FGA-por-tenant, submodule v-metric. Se descongelan solo si la Decisión 1 revela un requisito de soberanía real.

---

### Nota de divergencia con el panel
Seis de ocho especialistas recomendaron **database-per-tenant vía multi-datasource Prisma** como topRecommendation. **Lo rechazo** con base en verificación de repo: el esquema no tiene línea de corte por cliente (2 de ~50 modelos), lo que hace que la fragmentación física rompa FKs y multiplique migraciones sin aislar realmente (todo en un Postgres de Railway). El red-team acertó y lo confirmé. La respuesta correcta es **schema-per-tenant**, más simple de operar y sin fracturar el grafo. Coincido con el consenso en enterrar el gateway-por-tenant y en la criticidad del gap V-Metric.

---

Archivo de referencia relevante para el plan: `C:\Users\juana\GMT\proyectos\gmt-link\nodes\backend-central\prisma\schema.prisma` (evidencia de la ausencia de línea de corte por cliente) y `C:\Users\juana\GMT\proyectos\v-metric\poza\firebase_http.py` (el retry-securetoken que rompe la migración de V-Metric).