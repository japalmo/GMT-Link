# GMT Digital — Bucle autónomo de QA y fixes

Metodología para seguir puliendo el proyecto (GMT Link + V-Metric) sin feedback humano,
cubriendo todos los ángulos. Cada **ciclo** produce hallazgos verificados y fixes desplegados.

## Ángulos (lentes) por ciclo
1. **Seguridad** — authz/IDOR, sesiones/JWT, secretos, validación, endpoints de credenciales/correo, storage.
2. **Clean code** — `any`, código muerto, duplicación, TODOs con impacto, comentarios stale, consistencia de patrones.
3. **Arquitectura** — punto único de authz, drift Postgres↔FGA, acoplamientos, aislamiento de módulos, retrocompat de migraciones.
4. **Diseño / UX** — design system, estados vacío/carga/error, mobile, accesibilidad (teclado, ARIA, contraste), copy (español chileno formal, sin voseo/em-dash).
5. **Rendimiento** — N+1, agregaciones en memoria, índices, re-renders, bundle, agua­jes de red.
6. **Modelo de negocio** — flujos correctos vs. proceso real (segregación de funciones, respaldos obligatorios, ventanas de fecha), gaps de roles.
7. **Costos** — servicios pagos (Railway, Brevo, R2, NVIDIA), cuotas/free-tiers, egresos, almacenamiento, límites de escala.

## Pasos de cada ciclo
1. **Auditar** (read-only, en paralelo por lente) sobre el estado desplegado actual.
2. **Verificar adversarialmente** cada hallazgo (refutar; descartar falsos positivos). Solo sobreviven los confirmados.
3. **Priorizar**: ALTA (seguridad/correctitud) → MEDIA → BAJA. Separar "arreglar" de "solo registrar".
4. **Arreglar** los seguros/acotados (subagente por tarea + review de dos etapas). Cambios pequeños y aislados.
5. **QA-gate**: `pnpm build` + `pnpm test` verdes en backend y web + eslint 0 antes de commitear (política de la owner).
6. **Desplegar** a Railway (`railway up -s api|web-dev -c`) y **verificar en vivo** (health + un smoke del área tocada).
7. **Registrar** el ciclo (qué se arregló, qué queda) y repetir.

## Reglas de seguridad del bucle (para operar sin feedback)
- **Solo cambios reversibles y de bajo riesgo por ciclo.** Nada destructivo (borrar datos, rotar secretos, cambiar esquemas de forma no aditiva) sin marcarlo como "requiere decisión de la owner".
- **Migraciones siempre aditivas**; verificar colisiones contra la BD real antes de aplicar índices únicos.
- **No romper retrocompat** de la API mientras `web`/`web-dev` compartan imagen.
- **No tocar** el flujo de credenciales/correo ni permisos de forma que amplíe accesos sin registrarlo.
- Todo lo que amplíe superficie de riesgo o cambie comportamiento visible para usuarios → se **deja anotado** para revisión, no se aplica en silencio.

## Criterio de término
- **Mínimo 5 ciclos completos.** Se continúa mientras cada ronda siga encontrando hallazgos ALTA/MEDIA reales.
- Se considera "pulido" cuando 2 ciclos consecutivos no arrojan hallazgos ALTA nuevos y los MEDIA restantes quedan registrados con plan.

## Backlog vivo (semilla, de la auditoría inicial)
- **A1** usuario SUSPENDED puede loguear (en curso). **A4** cambio de correo sin re-auth. **A3** JWT sin revocación. **A8** OTP compare no constante.
- **M3** borrar vertical Liquidaciones (código muerto). **M1/M2** consolidar authz + reconciliador FGA. **M13** actualizar `CLAUDE.md`. **M7** gating por rol → permiso. **M10** `window.confirm` → ConfirmDialog. **M9/M15** colores hardcodeados → tokens.
- **Checklist de vehículos**: habilitar módulo para admin/gerencia (en curso) + plan de mejora (fotos, firma, comentario por ítem).
