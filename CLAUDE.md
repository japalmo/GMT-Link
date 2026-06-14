# GTM Link — Contexto para agentes

## Fuente única de verdad

**`docs/GTM_LINK_PLAN_MAESTRO.md`** es la autoridad de este proyecto: arquitectura, modelo de datos (§4.2), modelo de autorización OpenFGA (§4.3), primitivas reutilizables (§5), roadmap por etapas (§6), codificación de documentos (§7), catálogo de permisos (§8) y decisiones pendientes (§9). Léelo antes de escribir código. Si algo lo contradice, gana el plan maestro.

## Stack (decisiones cerradas — §2, no re-litigar)

PostgreSQL + Prisma · OpenFGA · instancia única con clientes scopeados · monorepo pnpm · NestJS (`apps/api`) · React + Vite + TS + Tailwind + shadcn/ui (`apps/web`) · tipos compartidos en `packages/shared-types` · Firebase Auth · Cloudflare R2 · Gemini (cuota 3/día/usuario).

## Estructura

```
apps/api/              → NestJS
apps/web/              → React + Vite
packages/shared-types/ → tipos compartidos (@gtm-link/shared-types)
docs/                  → plan maestro y documentación
docker-compose.yml     → PostgreSQL + Redis local
```

## Reglas duras

- TypeScript **estricto** en todo el monorepo. Cero `any` explícito.
- Toda decisión de permiso pasa por el guard de OpenFGA (`@RequirePermission`). Nunca `if (rol === ...)` suelto.
- Los módulos **ensamblan** las primitivas de §5 (`ImportWizard`, `ApprovalWorkflow`, `RoleScopedList`, …); no reimplementan esa lógica.
- Mobile-first y responsive. Estados vacío/carga/error siempre.
- Por cada modelo nuevo → migración Prisma. Por cada permiso nuevo → entrada en catálogo (§8) + relación OpenFGA (§4.3).
- Cuando una tarea dependa de una decisión pendiente (§9), preguntar antes de implementar.
- Iconos UI → `lucide-react`. No generar assets visuales: anotarlos en lista de pendientes con prompt.

## Comandos

```bash
pnpm install        # instala todo el workspace
pnpm dev            # levanta api (3001) + web (5173) en paralelo
pnpm build          # build de todos los paquetes
pnpm lint           # ESLint flat config raíz
docker compose up -d  # PostgreSQL + Redis (alternativa si Docker funciona)
```

## Infraestructura local (estado actual)

PostgreSQL 16 y Redis 7 corren en **WSL Ubuntu** (no Docker — Docker Desktop tiene un bug recurrente de sockets en esta máquina). BD del proyecto: `gtm_link` (la `gmt_link` del MVP vive en el volumen Docker, no tocar). Si el puerto 5432 no responde, WSL se durmió:

```powershell
Start-Process wsl -ArgumentList "-d","Ubuntu","--exec","sleep","infinity" -WindowStyle Hidden
```

Redis en WSL aún no es accesible desde Windows (bind loopback; pendiente hasta que una etapa lo necesite).

## Decisiones §9 resueltas

- **1.1 (provisión de usuarios):** sin envío de email. El admin importa CSV / crea usuarios y la **clave provisoria se muestra en la UI** para que el admin la comparta manualmente. Dejar `EmailService` como interfaz enchufable para un proveedor real más adelante, pero no integrarlo aún.
- **1.2 (tour onboarding):** "Omitir" **pospone**, no completa. Los checks de progreso persisten y el tour reaparece hasta que el usuario complete de verdad cada paso.
- **1.4/1.5 (storage de archivos):** stub local en dev. `StorageService` enchufable que en desarrollo guarda en disco local (servido por la API) con interfaz lista para Cloudflare R2 (§2); R2 se integra cuando haya credenciales. Orden Etapa 1: 1.3 y 1.6 primero, luego 1.4/1.5/1.2.
- **1.1 (roles al crear usuario):** acceso org + roles por defecto. En OpenFGA solo se escribe el **acceso** org del usuario: `organization#member` siempre, y `organization#admin` si trae `org_admin`. Los roles funcionales (operator/qa/finance/viewer/client_ito) se guardan como `Membership` scope ORGANIZATION = **"rol por defecto"** (visible en el directorio) y NO generan tupla funcional a nivel org; se materializan como tuplas FGA recién al asignar al usuario a un proyecto (Etapa 4). `assignRole`/`removeRole` solo tocan FGA para `org_admin`. (OpenFGA `write` no es idempotente: `member` se escribe una sola vez en la provisión.)

## Git

- `master` → monorepo GTM Link (este código)
- `mvp-v0` → MVP anterior preservado (NestJS + Next.js, no tocar)
