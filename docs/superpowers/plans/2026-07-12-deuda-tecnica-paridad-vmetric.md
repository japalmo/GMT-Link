# Plan: deuda técnica + paridad + V-Metric + 5 ciclos QA

**Fecha:** 2026-07-12 · **Rama:** feat/finanzas-roles-deploy (deploy vía push a `main` + `railway up`)

## Hallazgo clave (honesto)
Tras leer el código real, **la percepción de "muy incompleto" no se sostiene** en las áreas que cubría el MVP viejo:
- **Recursos y Usuarios**: el nuevo es un **superset amplio** del viejo (el viejo era CRUD simple de equipos/vehículos/usuarios; el nuevo agrega maquinaria, fabricante, identificador, subtipo, código correlativo, QR/ficha, historial, accesorios, checklist con plantilla+aprobación+PDF, telemetría, documentos, roles, importación CSV, invitaciones). Brecha real de paridad: **mínima** (3 campos).
- **V-Metric**: la app desktop **funciona** (motor de cálculo sólido, ya migrado de Firebase a Railway) y el módulo web **funciona** (dashboard con mapa, stats, histórico, visor 3D, CSV). Brechas puntuales, no "incompleto".

Lo que sí conviene: cerrar la **deuda técnica/seguridad** (5 gaps de la auditoría) y unas brechas menores.

---

## FASE A — Correcciones rápidas de alto valor (hacer ya)
1. **Paridad: unicidad de patente/serie** (regresión). `identifier` no es único en el nuevo → se pueden crear 2 vehículos con la misma patente. Fix: índice único parcial sobre `(identifierType, identifier)` + validación con mensaje en `assets.service.create`. Migración. [S]
2. **Paridad: campo "año" del vehículo** (se perdió del viejo). Reintroducir `metadata.year` en el form de alta, tabla y ficha. [S]
3. **GAP 2 — changePassword cierra otras sesiones (A3).** `profile.service.changePassword` bumpea `tokenVersion` y **re-emite** el JWT actual (para no autoexpulsarte); el front guarda el token nuevo. Sin migración. [S]
4. **GAP 5c — emailPersonal @unique** + ampliar `assertEmailAvailable`. Migración con limpieza previa de duplicados. [S]
5. **GAP 3 (parte 1) — recortar ficha pública + throttle.** Quitar patente/serie y nombres de personas del `AssetPublicView`; `@Throttle(20/min)` en el endpoint público. [S]
6. **GAP 1 — FilesController exige sesión** + no montarlo cuando hay R2 (URLs firmadas en prod). Cierra la descarga anónima de boletas/documentos personales. [M]
7. **V-Metric web: fix typo** "Vasode"→"Vaso de" + badge OTP honesto. [S]

## FASE B — Endurecimiento y escala
8. **GAP 3 (parte 2) — `publicToken` opaco no enumerable** en el QR (backfill a los existentes). Corta el raspado del parque por códigos correlativos. [M]
9. **GAP 5a — tipos de activos → `packages/contracts`** (hoy triplicados Prisma/back/front; ya divergieron con MAQUINARIA). Sigue el patrón de projects/clients. [M]
10. **GAP 4 — paginación server-side** (activos, usuarios, finanzas) + consumo en el front. Rompe contratos de API → coordinar back+front por endpoint. [L]

## FASE C — Refactor grande + V-Metric (requiere tu OK)
11. **GAP 5b — split de `recursos/index.tsx`** (2672 líneas, 63 useState) por tabs. Baja riesgo a futuro, pero es refactor grande de un archivo que funciona. [L]
12. **V-Metric web: visor 3D consume el DEM real de R2** (hoy lee JSON estáticos de demo). Requiere endpoint de grid en el backend. [L]
13. **V-Metric web: comparar DEMs** (corte/relleno entre dos vuelos), permiso `vmetric:dem:compare` ya existe sin UI. [L]
14. **V-Metric desktop: portar flujo documental Wave D** (protocolos, PDF, firma OTP, estados draft→issued) del legacy al shell nuevo + retirar UI legacy. [XL]

## FASE D — 5 ciclos de QA and fix
Metodología por ciclo (converge cuando no hay hallazgos ALTA nuevos):
`auditar (workflow multi-dimensión: seguridad, clean code, arquitectura, diseño, rendimiento, modelo de negocio, costos) → verificación adversarial de hallazgos → remediar confirmados → re-auditar`. QA verde antes de cada commit; deploy por `main` + verificación en vivo con señal única.

## Decisiones abiertas
- **V-Metric**: ¿hasta dónde llevarlo? (solo menores / completar web / + portar Wave D del desktop).
- **GAP 1**: ¿la demo corre con R2 o storage local? (define el enfoque exacto; el mínimo "exigir sesión" sirve igual).
- **GAP 3**: ¿hay QR físicos impresos con el código viejo? (compat vs reimprimir).
- **Refactors L** (paginación, split god-component): ¿ahora o después de estabilizar?
