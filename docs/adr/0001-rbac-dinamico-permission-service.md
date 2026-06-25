# ADR-0001: RBAC dinámico vía fachada `PermissionService` (B-ahora / C-listo)

**Date**: 2026-06-19
**Status**: accepted
**Deciders**: japalmo (Product/Arquitectura), Claude (arquitecto asistente)

## Context

El Módulo 4 exige que el Admin cree roles **100% en runtime, sin tocar el modelo OpenFGA ni desplegar**, con un selector de scope por permiso (*Solo propios / Solo proyectos asociados / Todo*) que es un **límite de seguridad duro** (server-enforced). Hoy la autorización es un **modelo FGA estático** (`nodes/backend-central/fga/model.fga`) más un mapa hardcodeado (`MEMBERSHIP_RELATION_MAP` en `nodes/backend-central/src/fga/fga.types.ts`): agregar un rol = editar el modelo + redeploy + editar el mapa. Las tablas `Role`/`Permission`/`RolePermission` existen pero **ningún path de enforcement las consulta** (catálogo dormido); el path de listas **ya esquiva FGA** y lee `Membership` por SQL (`nodes/backend-central/src/modules/assets/assets.service.ts:242`); `FgaClientLike` expone solo `check`+`write`. Hecho duro: **"Solo propios" (propiedad de instancia) no tiene expresión ReBAC en ningún motor** — siempre es un predicado SQL sobre `createdById`.

## Decision

Introducir una **fachada única de autorización** `PermissionService.can(userId, permissionKey, resource?) → { effect, filter }` como **el** punto de decisión. Los permisos **funcionales** pasan a ser **datos en Postgres** (`RolePermission` gana una columna `scope: PermissionScope`); las relaciones **estructurales/jerárquicas** (membresía de proyecto/depto/servicio, firma de documentos, checklist de activos) siguen intactas en OpenFGA; **"Solo propios" es un predicado SQL** sobre `createdById`. Se implementa primero el mecanismo Postgres-PDP (**Opción B** — menor blast radius, generaliza el código de listas existente), con la firma de la fachada y la columna `PermissionScope` diseñadas para que **promover a tuplas FGA espejadas (Opción C** — desbloquea `ListUsers`/`ListObjects` con herencia de jerarquía) sea **aditivo, no un rewrite**.

## Alternatives Considered

### Alternative A: OpenFGA totalmente dinámico (todo tupla)
- **Pros**: una sola fuente de verdad para lo expresable como tupla; reverse-queries nativas con herencia; changelog/audit gratis.
- **Cons**: "Solo propios" **igual** cae a un predicado SQL (híbrido irreducible); write-amplification al asignar; reescribe el modelo a tipos genéricos y obliga a re-expresar cada `can_*` derivado y cada `fga.check` manual.
- **Why not (como jugada pura)**: paga el costo completo del rewrite del modelo y de todos los checks, y **no** elimina el híbrido que de todos modos exige "Solo propios".

### Alternative B: PDP Postgres en paralelo
- **Pros**: menor blast radius; generaliza el patrón que ya corre en `assets.service.ts:242-291`; sin N+1 en listas; consistencia transaccional al escribir grants.
- **Cons**: SOT fracturada por diseño (estructural en FGA, funcional en Postgres); requiere disciplina para no llamar `fga.check` directo para un permiso funcional.
- **Why not (como jugada pura permanente)**: no restaura *literalmente* "toda decisión pasa por un punto único" — aunque es el mecanismo correcto para arrancar.

### Alternative C: Fachada unificada con grants espejados a tuplas
- **Pros**: restaura el punto único literal; reverse-queries FGA con herencia depto→proyecto.
- **Cons**: más piezas en sincronía (Postgres ↔ tuplas), vía el mismo mecanismo `syncMembershipToFGA` ya existente, generalizado.
- **Why not ahora**: es el **destino**, pero no hace falta pagar la sincronía el día 1; B y C comparten la firma de la fachada y la columna `scope`, así que la promoción es aditiva.

## Consequences

### Positive
- Roles dinámicos en runtime de inmediato, sin tocar el modelo FGA ni desplegar.
- Un único `PermissionService.can` que los 4 módulos consumen → consistencia de scope garantizada.
- Límite duro real: el filtro se aplica server-side en el query; un `projectId` manipulado en el body solo se **intersecta**, nunca amplía el alcance.
- Camino de migración incremental B→C sin rewrite.

### Negative
- Dualidad estructural (FGA) / funcional (Postgres) hasta promover a C.
- Hay que migrar el path de listas existente a la primitiva `scopeFilter`.

### Risks
- *Riesgo:* alguien llama `fga.check` directo para un permiso funcional y esquiva la fachada. *Mitigación:* la fachada es la única entrada documentada + regla de lint/codemod + review.
- *Riesgo:* `Asset` no tiene `createdById`, así que "Solo propios" sería inaplicable a activos. *Mitigación:* se agrega la columna + backfill en la Fase 1.
- *Riesgo:* divergencia Postgres↔FGA al promover a C. *Mitigación:* reusar el mecanismo de sync transaccional existente y tests de paridad.
