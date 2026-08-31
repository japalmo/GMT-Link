# Modelo operativo DevOps de GMT Link

## Objetivo

Permitir trabajo paralelo sin que una prueba modifique producción y conservar un
rastro verificable desde cada Pull Request hasta el despliegue. El modelo está
pensado para un equipo pequeño o mediano y privilegia controles simples.

## Flujo de promoción

```text
feature/* o fix/*
        │ Pull Request + CI + revisión
        ▼
     develop ───── despliegue manual controlado ─────► Railway staging
        │ Pull Request de release + validación
        ▼
      main ─────── aprobación de producción ─────────► Railway production
        │
        └───────── tag/version + evidencia + rollback
```

`web-dev` no cuenta como staging: hoy comparte la API y la base de datos de
producción. El ambiente seguro es un environment Railway independiente, con
PostgreSQL, OpenFGA, archivos y credenciales propios.

## Controles automáticos

| Control          | Cuándo corre                              | Qué protege                                                |
| ---------------- | ----------------------------------------- | ---------------------------------------------------------- |
| `CI / Verify`    | Push a `develop`; PR a `develop` o `main` | Formato, lint, tipos, contratos, pruebas, OpenFGA y builds |
| `CodeQL`         | PR/push y semanal                         | Vulnerabilidades en JavaScript/TypeScript                  |
| Dependabot       | Semanal/mensual                           | Dependencias npm y GitHub Actions                          |
| `Deploy staging` | Manual, con GitHub Environment `staging`  | Deploy trazable por SHA sin credenciales de producción     |
| Smoke tests      | Después del deploy staging                | `/health` de API y disponibilidad web                      |

Los workflows usan permisos mínimos, versiones mayores soportadas de las Actions,
dependencias bloqueadas y concurrencia para cancelar validaciones obsoletas.
El control de formato usa un baseline: bloquea archivos nuevos y archivos que ya
estaban normalizados, sin mezclar en cada PR la deuda histórica de formato. Los
archivos legacy aún no normalizados se reportan como omitidos hasta que un cambio
dedicado los incorpore al baseline.

## Ambientes

| Propiedad  | Local/CI               | Staging                            | Producción                                |
| ---------- | ---------------------- | ---------------------------------- | ----------------------------------------- |
| Rama base  | Feature/PR             | `develop`                          | `main`                                    |
| PostgreSQL | Efímero/local          | Instancia y volumen propios        | Instancia productiva                      |
| OpenFGA    | Efímero                | Store/datastore propios            | Productivo                                |
| R2         | Mock/bucket de pruebas | Bucket de staging                  | Bucket productivo                         |
| Correo     | Noop/capturador        | Sandbox o destinatarios permitidos | Proveedor real                            |
| Datos      | Ficticios              | Ficticios anonimizados             | Reales                                    |
| Aprobación | CI                     | Reviewer técnico                   | Reviewer técnico + responsable de negocio |

## Reglas que deben activarse en GitHub

En **Settings → Rules → Rulesets**, aplicar a `main` y `develop`:

1. Bloquear force-push y eliminación.
2. Exigir Pull Request y al menos una aprobación.
3. Exigir revisión de CODEOWNERS y descartar aprobaciones obsoletas.
4. Exigir conversaciones resueltas.
5. Exigir `CI / Verify`; para `main`, exigir además validación funcional de
   staging registrada en el Pull Request.
6. Restringir commits directos y mantener historial lineal.

Crear GitHub Environments:

- `staging`: secreto `RAILWAY_STAGING_TOKEN`; variables `STAGING_API_URL` y
  `STAGING_WEB_URL`.
- `production`: secretos productivos separados y al menos un required reviewer.
  El repositorio no incluye un workflow de deploy productivo automático.

## Responsabilidades

| Rol            | Responsabilidad                                    |
| -------------- | -------------------------------------------------- |
| Autor          | Cambio pequeño, pruebas, migración y rollback      |
| Reviewer       | Correctitud, seguridad, compatibilidad y evidencia |
| CODEOWNER      | Decisiones sensibles de su área                    |
| Release owner  | Promoción `develop` → `main`, tag y seguimiento    |
| Incident owner | Mitigación, comunicación y postmortem              |

Al crecer el equipo, reemplazar el owner temporal `@japalmo` por equipos como
`@gmt/backend`, `@gmt/frontend` y `@gmt/platform` en `.github/CODEOWNERS`.

## Monitoreo y trazabilidad

- Cada deploy debe incluir el SHA (`staging:<sha>` o tag de release).
- Conservar enlaces a CI, pruebas funcionales y migraciones en el Pull Request.
- Revisar fallos de GitHub Actions y alertas CodeQL/Dependabot semanalmente.
- Monitorear en Railway disponibilidad, reinicios, uso de CPU/memoria/volumen,
  errores 5xx y duración de migraciones.
- Registrar incidentes con ambiente, SHA y evidencia sanitizada.

## Promoción y rollback

La promoción se hace mediante PR de `develop` a `main`; nunca copiando archivos o
desplegando un checkout sucio. El rollback preferido es redeploy del último commit
estable. Una migración destructiva requiere estrategia expand/contract o un plan
de restauración probado antes de promover.

Durante la inicialización, `main` sigue atrasada respecto de `develop`. El primer
PR de release debe revisarse como reconciliación completa; hasta entonces no se
debe conectar `main` a autodeploy de producción.
