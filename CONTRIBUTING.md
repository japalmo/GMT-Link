# Contribuir a GMT Link

El repositorio usa una línea de integración separada de producción. Todo cambio
entra por Pull Request y debe conservar trazabilidad entre requerimiento, commit,
pruebas y despliegue.

## Ramas

| Rama                             | Propósito                             | Despliegue                                         |
| -------------------------------- | ------------------------------------- | -------------------------------------------------- |
| `main`                           | Código aprobado para producción       | Producción, solo por promoción aprobada            |
| `develop`                        | Integración compartida del equipo     | Staging, nunca producción                          |
| `feature/<ticket>-<descripcion>` | Funcionalidad nacida desde `develop`  | CI o staging bajo demanda                          |
| `fix/<ticket>-<descripcion>`     | Corrección nacida desde `develop`     | CI o staging bajo demanda                          |
| `hotfix/<ticket>-<descripcion>`  | Incidente urgente nacido desde `main` | Producción tras revisión; luego vuelve a `develop` |

No se hacen commits directos a `main` ni `develop`. No se reutilizan ramas de
funcionalidad ya fusionadas.

## Flujo de trabajo

```bash
git fetch origin --prune
git switch develop
git pull --ff-only
git switch -c feature/GMT-123-descripcion-breve
```

Los commits siguen Conventional Commits:

```text
feat(proyectos): agrega filtro por responsable
fix(auth): invalida sesiones después de cambiar clave
test(activos): cubre importación duplicada
docs(devops): documenta rollback de staging
```

Antes de abrir un Pull Request:

```bash
pnpm install --frozen-lockfile
pnpm ci:prepare
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

La prueba completa del modelo OpenFGA requiere un servidor local en
`http://localhost:8080` y se ejecuta con:

```bash
pnpm --filter @gmt-platform/backend-central test:integration:fga
```

## Pull Requests

- Vincular el ticket o incidente correspondiente.
- Mantener el alcance pequeño y describir riesgo, migración y rollback.
- No mezclar refactors no relacionados con una corrección funcional.
- Resolver CI y comentarios antes del merge.
- Requerir al menos una aprobación de alguien distinto al autor.
- Usar **Squash merge** para features/fixes; el título resultante debe conservar
  el formato Conventional Commit.

Los cambios de Prisma deben incluir una migración compatible hacia adelante. No
se edita una migración que ya pudo ejecutarse en un ambiente compartido.

## Seguridad y datos

- Nunca versionar `.env`, tokens, contraseñas, dumps o capturas con datos reales.
- Usar únicamente secretos y datos ficticios en CI/staging.
- No apuntar una rama de pruebas a la API, PostgreSQL, R2 o correo de producción.
- Revocar inmediatamente cualquier credencial compartida por chat o incidente.

## Definition of Done

Un cambio está terminado cuando CI está verde, tiene revisión, pruebas acordes al
riesgo, documentación/observabilidad actualizadas y un rollback ejecutable.
