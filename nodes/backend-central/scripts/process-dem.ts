/**
 * Procesa un DEM GeoTIFF a un grid de elevaciones SIMPLIFICADO (downsampled) en JSON,
 * que el visor 3D de v-metric consume directo desde nodes/web/public/dem/<code>.json.
 * Generador OFFLINE de respaldo: en producción el mismo grid lo sirve on-demand
 * `MetricsService.getDemGrid` leyendo el .tif real desde R2 (misma util `buildDemGrid`).
 *
 * Uso (desde nodes/backend-central):  npx tsx scripts/process-dem.ts R2 var/uploads/dem/R2.tif
 *   arg1 = code del Element (nombre del json de salida)
 *   arg2 = ruta al .tif (relativa a nodes/backend-central)
 */
import { fromFile } from 'geotiff';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildDemGrid, type DemSourceImage } from '../src/modules/metrics/dem-grid.util';

async function main(): Promise<void> {
  const code = process.argv[2] ?? 'R2';
  const src = path.resolve(process.cwd(), process.argv[3] ?? 'var/uploads/dem/R2.tif');
  const outDir = path.resolve(process.cwd(), '..', 'web', 'public', 'dem');
  const out = path.join(outDir, `${code}.json`);

  const tiff = await fromFile(src);
  const image = await tiff.getImage();
  const srcW = image.getWidth();
  const srcH = image.getHeight();

  // Misma util que el endpoint on-demand, para no divergir del algoritmo de producción.
  const grid = await buildDemGrid(image as unknown as DemSourceImage);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(out, JSON.stringify({ code, ...grid }));

  console.log(`DEM ${code}: ${srcW}x${srcH} -> ${grid.width}x${grid.height}`);
  console.log(
    `Elevación: min=${grid.minZ.toFixed(2)} max=${grid.maxZ.toFixed(2)} Δ=${(grid.maxZ - grid.minZ).toFixed(2)} m`,
  );
  console.log(`bbox=${JSON.stringify(grid.bbox)} noData=${grid.noData}`);
  console.log(`-> ${out} (${grid.elevations.length} celdas)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
