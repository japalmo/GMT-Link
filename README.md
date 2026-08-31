# GMT Link

Plataforma interna de operaciones de GMT. El código vive en un monorepo pnpm con
un frontend React/Vite, una API NestJS, PostgreSQL/Prisma y OpenFGA. Producción se
ejecuta en Railway.

## Documentación vigente

- [Arquitectura y estado actual](docs/arquitectura-actual.md): mapa del sistema,
  rol de cada componente, flujos, inventario Railway, riesgos y prioridades.
- [Despliegue en Railway](docs/railway-deploy.md): configuración y operación del
  despliegue.
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

Requisitos: Node.js 22+ y pnpm 9+.

```bash
pnpm install --frozen-lockfile
pnpm --filter @gmt-platform/contracts build
pnpm --filter @gmt-platform/backend-central exec prisma generate
pnpm dev
```

Antes de publicar cambios:

```bash
pnpm --filter @gmt-platform/backend-central build
pnpm --filter @gmt-platform/web build
pnpm --filter @gmt-platform/contracts test
pnpm --filter @gmt-platform/backend-central test
pnpm --filter @gmt-platform/web test
```

> Estado al 31-08-2026: el runtime desplegado se recuperó en
> `feat/fase1b-documental` (`0338073`). `main` todavía requiere integrar esa rama
> mediante PR; no se debe desplegar el `main` anterior (`c87b9b3`).
