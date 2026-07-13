/**
 * Downsampling de un DEM (GeoTIFF) a un grid de elevaciones liviano que el visor 3D
 * consume directo. Función pura (sin I/O): recibe una imagen GeoTIFF ya abierta y
 * devuelve el grid submuestreado. La comparten el generador offline
 * (`scripts/process-dem.ts`) y el endpoint on-demand (`MetricsService.getDemGrid`),
 * para tener UNA sola implementación del algoritmo.
 */

/** Grid de elevaciones submuestreado (sin `code`, que lo pone el llamador). */
export interface DemGridData {
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY] en el CRS del DEM
  minZ: number;
  maxZ: number;
  noData: number | null;
  elevations: number[];
}

/** Grid de elevaciones etiquetado con el código del elemento (lo que sirve la API). */
export interface DemGridResult extends DemGridData {
  code: string;
}

/**
 * Subconjunto estructural de un `GeoTIFFImage` que necesita el downsampling. Se define
 * aquí (en vez de importar el tipo de `geotiff`) porque `geotiff` es ESM-only y el
 * backend compila a CommonJS: acoplarse a su tipo obligaría a un import de runtime.
 */
export interface DemSourceImage {
  getWidth(): number;
  getHeight(): number;
  getBoundingBox(): number[];
  getGDALNoData(): number | null;
  readRasters(options: {
    width: number;
    height: number;
    resampleMethod?: string;
  }): Promise<ArrayLike<ArrayLike<number>>>;
}

/** Grid máximo por lado (≈48k vértices: fluido en three.js). */
export const DEM_GRID_TARGET = 220;

/**
 * Submuestrea la imagen a un grid de a lo más `target` celdas por lado, calcula el
 * rango de cotas y reemplaza los valores noData/inválidos por `minZ` (piso plano) para
 * una malla continua. No hace I/O: `readRasters` ya baja solo los tiles necesarios.
 */
export async function buildDemGrid(
  image: DemSourceImage,
  target: number = DEM_GRID_TARGET,
): Promise<DemGridData> {
  const W = image.getWidth();
  const H = image.getHeight();
  const [minX = 0, minY = 0, maxX = 0, maxY = 0] = image.getBoundingBox();
  const bbox: [number, number, number, number] = [minX, minY, maxX, maxY];
  const noDataRaw = image.getGDALNoData();
  const noData = typeof noDataRaw === 'number' ? noDataRaw : null;

  const factor = Math.max(1, Math.ceil(Math.max(W, H) / target));
  const outW = Math.max(2, Math.round(W / factor));
  const outH = Math.max(2, Math.round(H / factor));

  const rasters = await image.readRasters({ width: outW, height: outH, resampleMethod: 'nearest' });
  const band = rasters[0] ?? [];
  const cellCount = band.length;

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < cellCount; i++) {
    const v = band[i];
    if (v === undefined || (noData !== null && v === noData) || !Number.isFinite(v)) continue;
    if (v < minZ) minZ = v;
    if (v > maxZ) maxZ = v;
  }
  if (!Number.isFinite(minZ)) {
    minZ = 0;
    maxZ = 1;
  }

  // Reemplaza noData / inválidos por minZ (piso plano) para una malla continua.
  const elevations: number[] = new Array<number>(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const v = band[i];
    elevations[i] =
      v === undefined || (noData !== null && v === noData) || !Number.isFinite(v) ? minZ : v;
  }

  return { width: outW, height: outH, bbox, minZ, maxZ, noData, elevations };
}
