# V-Metric — Plan de build para terminarlo

> **Fuente:** workflow de diseño (4 lectores paralelos, 2026-07-13). Output completo:
> `tasks/wyl8mbnfo.output` (subagents/workflows/wf_419612b0-25e/journal.jsonl).
> **Enfoque:** MVP-first por olas. Cada ola deja algo verificable en vivo.

**Meta:** cerrar la brecha de V-Metric web (visor 3D con DEM real, comparar DEMs,
canvas de workspace) y portar el flujo documental Wave D del desktop al shell nuevo.

**Hallazgo clave:** la versión nueva ya es superset del MVP viejo. Lo que falta es
consumir los **insumos reales que ya existen** (DEMs en R2 como `DataPoint` con
`variable.code='dem_file'`; `getLatestDem`/`listDems`/`getDemDownloadUrl` ya resuelven
r2Key y firman URLs). Dependencias `geotiff@3.0.5` + `@aws-sdk/client-s3` ya instaladas.

---

## Secuencia de olas (por dependencia + valor de demo)

1. **Ola 1 — Visor 3D con DEM real** (la más pequeña y de mayor impacto visual).
2. **Ola 2 — Comparar DEMs** (corte/relleno; reusa el reader de la Ola 1).
3. **Ola 3 — Canvas de workspace** (dibujar/editar polígono de poza + capas + regla/punto).
4. **Ola 4 — Flujo documental Wave D** (desktop PySide6; local-first, sync a Railway después).

---

## OLA 1 — Visor 3D consume el DEM real de R2

Hoy `dem-viewer.tsx` hace `fetch('/dem/<code>.json')` de grids estáticos generados
offline por `scripts/process-dem.ts`. Se sustituye por un endpoint que lee el GeoTIFF
real desde R2 por **range requests** (`GeoTIFF.fromUrl(presignedGetUrl)` — NO bufferizar
el .tif entero, pesan cientos de MB) y devuelve el mismo shape `DemGrid` downsampled.

- **MVP-1 (S):** extraer el downsampling de `scripts/process-dem.ts` a
  `nodes/backend-central/src/modules/metrics/dem-grid.util.ts` como `buildDemGrid(image, target=220)`
  → `{width,height,bbox,minZ,maxZ,noData,elevations[]}`. Refactor `process-dem.ts` para
  importarla (una sola implementación). `geotiff` es ESM-only → import dinámico:
  `const { fromUrl } = await import('geotiff')`.
- **MVP-2 (M):** `MetricsService.getDemGrid({reservorio_codigo})`: resolver r2Key con la
  misma búsqueda de `getLatestDem` (metrics.service.ts:555-583) → caché en R2
  `dem-grids/<code>.json` (invalida al cambiar r2Key = vuelo nuevo) → miss:
  `createPresignedGetUrl(r2Key)` + `fromUrl` + `buildDemGrid` → persistir grid + devolver.
  Si `this.r2===null` (dev) o no hay dem_file → `NotFoundException`.
- **MVP-3 (S):** `GET /metrics/elements/code/:code/dem-grid` con gate `can_view` (patrón
  de `getPoolByCode`, controller:77-86: requireUserId → getProjectIdForElementCode →
  requireProjectPermission(userId, projectId, 'can_view') → service.getDemGrid).
- **MVP-4 (S):** `nodes/web/src/lib/api.ts`: `interface DemGrid` + `getDemGrid(code)` →
  `request('/metrics/elements/code/${code}/dem-grid')` (hereda Bearer + ApiError).
- **MVP-5 (S):** `dem-viewer.tsx` useEffect (líneas 127-139): swap `fetch('/dem/${code}.json')`
  por `getDemGrid(code)`. `Terrain3D` no cambia (mismo shape). Fallback opcional a
  `/dem/${code}.json` en 404 para no romper la demo mientras se suben DEMs reales.
- **Ola 1.5 (opcional, M):** precompute del grid dentro de `registerDemMetadata` en
  background (fire-and-forget) + campos `gridKey`/`gridReady` en `VmetricDem` (migración).

**Verificación viva:** el nuevo route `GET /metrics/elements/code/:code/dem-grid` → 404 si
no desplegado; 200 con `{width,height,elevations}` si desplegado. Señal única.

---

## OLA 2 — Comparar DEMs (corte/relleno) — gate `vmetric:dem:compare`

Permiso ya declarado (`rbac-catalog.ts:94`, `seed-capstone.ts:70`) y concedido, sin UI ni
endpoint. Insumos: `listDems({reservorio_codigo})` (service:601) devuelve historial real
`{id,archivo,blob_path,fecha_vuelo,usuario}`; matemática de corte/relleno en desktop
`SurfaceCalculator.volume_between_surfaces` (poza/core.py:210): `diff=B-A`,
`fill=Σ(diff>0)·cell_area`, `cut=Σ|diff<0|·cell_area`, `net=fill-cut`, exige mallas alineadas.

- **Backend (recomendado):** portar `volume_between_surfaces` a TS reusando el reader
  `geotiff`+R2 de la Ola 1 (necesita los dos GeoTIFF completos y alineados desde R2, no
  los grids estáticos). Endpoint gateado inline con `requireProjectPermission(..,'can_view')`.
- **Frontend:** selector de dos vuelos + resultado corte/relleno/neto. Mostrar/ocultar el
  control con `useHasPermission('vmetric:dem:compare')`. Defensa en profundidad opcional
  en el endpoint vía `PermissionService`.
- **MVP demo:** reusar grids estáticos precalculados y restar en el cliente (aproximación).

---

## OLA 3 — Canvas de workspace (análogo al DemViewerWidget del desktop)

Desktop `poza/views/workspace_view.py` → `DemViewerWidget` (551-717): QWidget con
`paintEvent` que renderiza el DEM en espacio raster con pan/zoom y 4 herramientas
(`PolyTool`: CURSOR, DRAWING polígono, RULER, ELEV_POINT). `polygon_committed` →
`polygon_raster_to_geojson` → máscara UTM → `CalculationWorker` → `PondVolumeCalculator`.

La web (`pages/v-metric`): `index.tsx` es dashboard Leaflet (polígonos de pozas desde
`element.locationPolygon` WGS84); detalle muestra `dem-viewer.tsx` (three.js solo-lectura).
Hoy el polígono se edita pegando JSON a mano. Deps web: solo `leaflet` + `three`
(SIN plugin de dibujo, SIN proj4, SIN turf).

- **Realidad de alcance:** el cálculo pesado NO corre en el navegador (necesita
  rasterio/Python). La web = visualizar DEM/orto, **dibujar/editar el polígono de la poza**,
  medir (regla), leer cota (punto) y **disparar** el cálculo contra el backend.
- **MVP:** canvas Leaflet editable + capas (toggles dem/orto/polígono) + regla/punto +
  persistencia del polígono. Incrementos: disparo de cálculo (primero aprox. Node con
  `geotiff`; luego sidecar Python reusando `poza.core` para paridad exacta).
- **Ojo CRS:** el grid `/dem` guarda bbox en UTM pero NO el EPSG; Leaflet trabaja en
  lat/lng → reintroducir CRS y reproyectar (proj4) para georeferenciar overlay, lookup de
  cota y construir la máscara en el CRS del DEM.

---

## OLA 4 — Flujo documental Wave D (desktop PySide6, local-first)

Motor no-Qt ya existe: `poza/pdf/engine.py` (reportlab), `poza/pdf/placeholders.py`,
plantillas `assets/templates/*.xlsx`. Esquema BD listo (`Document`, `DocumentRevision`,
`ApprovalEvent` en `poza/db/models.py:271-362`). Falta portar el flujo al shell nuevo:

1. Extraer `SignatureProcessor` de `poza/protocol_creation.py` a `poza/protocol_utils.py` (sin Qt).
2. Capa de negocio en `poza/db/repository.py` (hoy sin métodos documentales): crear borrador,
   correlativo, transiciones draft→in_review→rejected/issued, etiqueta Rev0/A/B, cola QA, inmutabilidad.
3. `BaseDialog` (`poza/ui/components/dialog.py`) con tokens nuevos.
4. Reconstruir ambos overlays sobre `BaseDialog` + PDF real vía PyMuPDF + página "Documentos"
   en `PAGE_REGISTRY` (`poza/ui/main.py:60`) y Sidebar.

**Secuenciación crítica:** el flujo de aprobación remoto NO está migrado a Railway
(firebase_sync llama Cloud Functions). MVP = **local-first en SQLite** (correlativo/estados
locales, `sync_status='local'`, log en `ApprovalEvent`); sync a Railway = fase posterior XL.
El OTP para firmar SÍ funciona contra Railway (`metrics_client.generate_otp/verify_otp`).
