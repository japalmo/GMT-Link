# ADR-0002: Rama de integración, CI obligatoria y staging aislado

**Date**: 2026-08-31
**Status**: accepted
**Deciders**: responsable de GMT Link y equipo técnico

## Context

Producción fue desplegada desde un checkout sin SHA registrado y `main` no
representa el runtime actual. El servicio `web-dev` comparte API y PostgreSQL con
producción, por lo que no permite pruebas destructivas ni migraciones seguras. El
proyecto empieza a recibir contribuciones de un equipo y necesita revisión,
responsabilidad y evidencia reproducible.

## Options considered

| Opción                               | Ventajas                                    | Costos/riesgos                                                                       |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| GitHub Flow solo con `main`          | Muy simple                                  | Cada merge queda demasiado cerca de producción mientras no existan previews aisladas |
| `develop` + staging independiente    | Separación clara, familiar y costo moderado | Agrega una promoción y requiere mantener staging                                     |
| Environment efímero por Pull Request | Aislamiento máximo y feedback rápido        | Mayor costo, automatización y gestión de datos/migraciones                           |

## Decision

Adoptar `develop` como rama compartida de integración y `main` como única rama
promovible a producción. Todo cambio usa ramas cortas y Pull Requests. CI valida
PRs hacia ambas ramas. Railway staging es un environment independiente y su
deploy es manual hasta completar secretos, datos ficticios y reglas de revisión.

Las promociones a producción siguen siendo explícitas y no se añade autodeploy
productivo en esta etapa.

## Rationale

La opción elegida resuelve el aislamiento que hoy falta sin pagar todavía el
costo operacional de un ambiente completo por PR. `develop` ya existía y es un
ancestro lineal del runtime recuperado, por lo que puede actualizarse mediante
fast-forward sin reescribir historial.

## Trade-offs

- Se acepta mantener una rama de larga vida adicional.
- Algunas integraciones requieren coordinación de cambios entre `develop` y
  `main`.
- Staging consume infraestructura y exige datos/secretos propios.
- A cambio, ningún test necesita escribir sobre producción y cada release queda
  asociado a PR, CI y SHA.

## Consequences

### Positive

- Cambios paralelos revisables y CI obligatoria.
- Staging reutilizable con datos ficticios.
- Despliegues trazables y rollback por commit.
- Ownership, actualización de dependencias y análisis CodeQL versionados.

### Negative

- El primer PR `develop` → `main` será grande porque reconcilia el historial
  desplegado que nunca llegó a `main`.
- La protección de ramas y los GitHub Environments requieren activación en la
  configuración del repositorio.

### Mitigation

- Revisar la primera promoción como release de reconciliación.
- No conectar producción a `main` hasta completar esa revisión.
- Mantener el deploy de staging manual hasta validar su aislamiento.

## Revisit trigger

Evaluar environments efímeros por PR cuando el equipo supere diez contribuidores,
las colisiones en staging sean frecuentes o el tiempo de espera de validación
supere un día laboral.
