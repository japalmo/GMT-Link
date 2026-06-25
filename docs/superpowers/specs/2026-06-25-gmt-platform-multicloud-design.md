# Diseño — Proyecto General GMT (plataforma multicloud)

**Fecha:** 2026-06-25
**Estado:** Fase 1 implementada (ver docs/superpowers/plans/2026-06-25-gmt-platform-fase1-reestructura.md). Fases 2–5 pendientes.

## 1. Contexto y objetivo

Hoy existen dos repos: **GMT Link** (monorepo pnpm: `apps/api` NestJS, `apps/web` React/Vite, `packages/shared-types`; **una sola PostgreSQL**, clientes scopeados por OpenFGA) y **V-metric** (desktop Python/PySide6, repo `japalmo/V-metric`).

El objetivo es **reorganizar el código hacia un "Proyecto General GMT"** cuya estructura refleje una realidad **multicloud**: en producción los nodos viven separados en distintos servidores, con **soberanía de datos por cliente** (la BD de Albemarle vive y se controla en infraestructura de Albemarle, etc.).

Esto **supersede deliberadamente** la decisión cerrada anterior "instancia única, clientes scopeados" (§2 del plan maestro): pasamos de aislamiento lógico a **separación física por cliente**.

## 2. Decisiones aprobadas (brainstorming)

| Decisión | Elección |
| :-- | :-- |
| Modelo de datos | **BD + gateway por cliente** (multicloud real). Cada cliente = su PostgreSQL + un Data Gateway en su servidor; el backend central nunca toca las BD directo. |
| Organización del código | **Monorepo "GMT General"** (`gmt-platform`), un paquete/app por nodo; cada nodo se despliega independiente. |
| Autenticación | **Servicio de auth propio** (nodo dedicado): JWT propios, user store, login/refresh/roles. Detrás de una interfaz abstracta para poder arrancar con Firebase real y migrar sin tocar el resto. (El emulador queda descartado: no corre en Railway.) |
| Frontend web | **Nodo propio** "Frontend GMT" (la app React/Vite actual), consume el backend central. |
| V-metric en el monorepo | **Repo propio referenciado** (git submodule en `nodes/v-metric/`); no se fusiona al workspace pnpm (es Python). |
| Protocolo Backend↔Gateway | **REST/HTTP tipado** (contratos en `packages/contracts`); gRPC queda como opción futura. |
| Identidad gráfica | **Canon = V-metric.** Se extraen paleta/estilos/directrices de las vistas actuales de V-metric y los demás nodos las heredan. (Revertir el cambio previo que pintó V-metric con el azul de GMT Link.) |

## 3. Arquitectura de nodos

```
Clientes (web, V-metric)
   │  login → JWT (auth-service)
   ▼
auth-service  ⇄  backend-central (lógica de negocio GMT, orquestador)
                       │  REST/HTTP tipado (sdk-gateway)
        ┌──────────────┼──────────────┐
        ▼              ▼               ▼
   gateway GMT    gateway Albemarle  gateway Mantos   ← misma plantilla, N despliegues
   +OpenFGA       +OpenFGA           +OpenFGA
        ▼              ▼               ▼
   PostgreSQL     PostgreSQL        PostgreSQL        ← servidores separados
```

**Responsabilidades (una por nodo, límites claros):**
- **`auth-service`** — identidad. Emite/renueva JWT, gestiona el user store y roles de alto nivel. No sabe de dominio. Entrada: credenciales → salida: tokens.
- **`backend-central`** — lógica de negocio GMT. Valida el JWT y los permisos gruesos (¿este usuario accede al tenant X?), orquesta los gateways, compone respuestas. **No accede a ninguna BD de tenant directamente.**
- **`tenant-gateway`** (plantilla, 1 despliegue por cliente) — dueño exclusivo de UNA BD de cliente. CRUD vía Prisma, **permisos finos del dato** (OpenFGA por tenant), verificación del token. Único componente con credenciales de esa BD.
- **`web`** — UI (React/Vite). Consume `auth-service` y `backend-central`.
- **`v-metric`** — desktop (Python). Cliente del backend/auth como cualquier otro.

## 4. Estructura del monorepo

```
gmt-platform/
├── pnpm-workspace.yaml · turbo.json · package.json
├── packages/                 # compartido, NO desplegable
│   ├── contracts/            # DTOs/tipos + contrato Backend↔Gateway (zod/OpenAPI)  ← ex shared-types
│   ├── sdk-gateway/          # cliente tipado backend→gateway
│   └── config/               # tsconfig/eslint/env-schema compartidos
├── nodes/                    # cada carpeta = 1 nodo desplegable (su Dockerfile)
│   ├── auth-service/         # NestJS
│   ├── backend-central/      # NestJS (ex apps/api, sin BD de tenant directa)
│   ├── tenant-gateway/       # NestJS + Prisma → 1 BD de tenant
│   ├── web/                  # React/Vite (ex apps/web)
│   └── v-metric/             # git submodule → japalmo/V-metric (Python)
├── deploy/
│   ├── tenants/{gmt,albemarle,mantos-blancos}/   # env/infra por cliente (gateway+BD)
│   ├── auth/ · backend/ · web/
└── docs/                     # arquitectura, ADRs, specs
```

## 5. Auth + permisos (modelo de seguridad)

- **Identidad (auth-service):** JWT firmado con identidad + scopes de alto nivel (tenants/roles a los que el usuario pertenece). Interfaz `AuthProvider` abstracta: implementación `FirebaseAuthProvider` (arranque) → `NativeAuthProvider` (propio) sin cambiar consumidores.
- **Autorización gruesa (backend-central):** verifica firma del JWT + "¿puede este usuario operar sobre el tenant solicitado?".
- **Autorización fina (tenant-gateway):** OpenFGA scopeado a los datos de ESE tenant. La decisión de "quién ve qué dato" vive con el dueño del dato (soberanía).
- Los gateways **no se exponen a clientes finales**; solo el backend central (y operadores autorizados) los llaman.

## 6. Plan de migración por fases

1. **Fase 1 — Estructura (alcance inmediato, ver §7).** Crear el monorepo, mover lo existente, scaffolds de los nodos nuevos. Todo sigue funcionando con la BD única durante la transición.
2. **Fase 2 — Gateway de datos.** Extraer el acceso a datos de `backend-central` a `tenant-gateway` vía `sdk-gateway`; el backend deja de tocar Prisma.
3. **Fase 3 — BD por tenant.** Desplegar un gateway+BD por cliente; split/migración de datos del esquema único a los esquemas por tenant.
4. **Fase 4 — Auth propio.** `auth-service` nativo reemplaza a Firebase detrás de la interfaz.
5. **Fase 5 — V-metric.** Apuntar V-metric al nuevo backend/auth; heredar la identidad visual (que es la suya).

## 7. Alcance de Fase 1 (lo que se implementa primero)

Objetivo: dejar la **estructura del monorepo** lista y reflejando los nodos, **sin romper** el sistema actual.

1. Crear el esqueleto `gmt-platform/` (workspace pnpm + turbo + config compartida en `packages/config`).
2. Mover `apps/web → nodes/web` y `apps/api → nodes/backend-central` (ajustar paths/imports/build).
3. Extraer `packages/shared-types → packages/contracts` (renombrar + ubicar contratos).
4. Scaffolds **mínimos compilables** de `nodes/auth-service`, `nodes/tenant-gateway` y `packages/sdk-gateway` (estructura + healthcheck + un endpoint dummy; sin lógica real todavía).
5. `nodes/v-metric` como **git submodule** apuntando a `japalmo/V-metric`.
6. Estructura `deploy/` con plantillas de env por nodo/tenant (sin secretos).
7. Verificación: `pnpm install`, `tsc` y los tests existentes siguen verdes tras el movimiento; build de `web` y `backend-central` OK.

**Criterio de aceptación Fase 1:** el monorepo compila y testea verde con la nueva estructura; el sistema actual (backend-central + web) sigue corriendo igual; los nodos nuevos existen como esqueletos compilables.

## 8. Riesgos y consideraciones

- **Esfuerzo y "big bang":** mover api/web + renombrar paquetes toca muchos imports/paths/configs (tsconfig, vite alias, prisma, Dockerfiles, CI). Fase 1 se hace en un solo movimiento coordinado y se verifica con tsc+tests antes de commitear.
- **Consultas cross-tenant:** con BD por cliente, una vista "GMT ve todo" requiere que el backend **federe** (llama a cada gateway y agrega); no hay JOIN único. Es un cambio de mentalidad a documentar en cada feature.
- **Doble salto de red** (cliente→backend→gateway→BD): más latencia; mitigable con caché/colas en el backend.
- **Despliegue:** pasa de ~2 servicios a 5+ (auth, backend, web, N gateways, N BD). Implica más infra/CI; coherente con el objetivo multicloud.
- **OpenFGA por tenant:** cada gateway necesita su store/modelo FGA; el bootstrap del modelo se vuelve por-tenant.

## 9. Fuera de alcance (por ahora)

- Implementación de la lógica real de gateways/auth (fases 2-4).
- Split físico de datos por tenant (fase 3).
- Integración final de V-metric (fase 5).
- gRPC (queda como evolución futura del contrato REST).

## 10. Notas de auto-revisión (a confirmar en la revisión del spec)

Puntos que el diseño asume y conviene validar antes de escribir el plan:

1. **Reorganización in-place, no repo nuevo.** `gmt-platform/` es **el repo actual reorganizado** (la raíz `GMT Link` cambia su estructura interna; el repo de GitHub `japalmo/GMT-Link` se mantiene, no se crea uno nuevo). Lo que cambia es el layout de carpetas y nombres de paquetes, no el origin.
2. **Rama y PR dedicados.** Por ser un movimiento grande que toca casi todos los paths, la Fase 1 va en su propia rama (`feat/gmt-platform-multicloud`) y un PR único y atómico (mover + ajustar imports + verde) para que el historial sea legible y revisable.
3. **`turbo` es opcional.** El árbol §4 incluye `turbo.json`, pero el orquestador de tareas no es esencial para la Fase 1: se puede arrancar solo con scripts pnpm (como hoy) e introducir Turborepo después si el grafo de builds lo justifica. Recomendado: **diferir turbo** y mantener scripts pnpm en Fase 1.
4. **Sub-decisiones embebidas (ya tomadas, ratificar):** V-metric como **git submodule**; protocolo **REST/HTTP tipado**; nombre de workspace **`gmt-platform`**. Si alguna cambia, se ajusta el spec antes del plan.
5. **OpenFGA permanece en `backend-central` durante Fase 1.** El move a los gateways ocurre en Fase 2; en Fase 1 no se mueve lógica de autorización, solo carpetas/paquetes.
