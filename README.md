# GMT Link

Plataforma interna de operaciones de GMT. El código vive en un monorepo pnpm con
un frontend React/Vite, una API NestJS, PostgreSQL/Prisma y OpenFGA. Producción se
ejecuta en Railway.

## Documentación vigente

- [Arquitectura y estado actual](docs/arquitectura-actual.md): mapa del sistema,
  rol de cada componente, flujos, inventario Railway, riesgos y prioridades.
- [Despliegue en Railway](docs/railway-deploy.md): configuración y operación del
  despliegue.
- [Modelo operativo DevOps](docs/devops/modelo-operativo.md): ramas, CI,
  ownership, promoción, monitoreo y reglas del equipo.
- [Staging aislado en Railway](docs/runbooks/railway-staging.md): provisioning,
  secretos, pruebas y rollback sin tocar producción.
- [Guía de contribución](CONTRIBUTING.md): flujo diario, commits, Pull Requests y
  Definition of Done.
- [ADR de autorización](docs/adr/0001-rbac-dinamico-permission-service.md): por
  qué la autorización combina permisos funcionales en PostgreSQL con relaciones
  estructurales en OpenFGA.

## Paquetes principales

| Ruta                    | Rol                                                              |
| :---------------------- | :--------------------------------------------------------------- |
| `nodes/web`             | SPA React 19 + Vite que corre en el navegador.                   |
| `nodes/backend-central` | API NestJS 11, reglas de negocio, autenticación y persistencia.  |
| `packages/contracts`    | Tipos compartidos entre frontend y backend.                      |
| `nodes/auth-service`    | Scaffold futuro; no está desplegado como servicio independiente. |
| `nodes/tenant-gateway`  | Scaffold futuro multitenant; no está desplegado.                 |
| `packages/sdk-gateway`  | Cliente del gateway futuro; no participa del runtime actual.     |

## Desarrollo

Requisitos: Node.js 22 y pnpm 9.15.9.

```bash
pnpm install --frozen-lockfile
pnpm --filter @gmt-platform/contracts build
pnpm --filter @gmt-platform/backend-central exec prisma generate
pnpm dev
```

Antes de publicar cambios:

```bash
pnpm ci:prepare
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

> Estado al 31-08-2026: el runtime desplegado se recuperó en
> `feat/fase1b-documental` (`0338073`). `main` todavía requiere integrar esa rama
> mediante PR; no se debe desplegar el `main` anterior (`c87b9b3`).

## Flujo del equipo

`develop` es la rama compartida de integración. Las ramas `feature/*` y `fix/*`
entran por Pull Request con CI; staging se despliega desde un SHA aprobado y
`main` queda reservada para promociones explícitas a producción.
