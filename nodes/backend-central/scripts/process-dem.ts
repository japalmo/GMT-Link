/**
 * Procesa un DEM GeoTIFF a un grid de elevaciones SIMPLIFICADO (downsampled) en JSON,
 * que el visor 3D de v-metric consume directo desde nodes/web/public/dem/<code>.json.
 * Reemplaza el paso que en producción hará el cliente PyQt (subir el raster simplificado).
 *
 * Uso (desde nodes/backend-central):  npx tsx scripts/process-dem.ts R2 var/uploads/dem/R2.tif
 *   arg1 = code del Element (nombre del json de salida)
 *   arg2 = ruta al .tif (relativa a nodes/backend-central)
 */
import { fromFile } from 'geotiff';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TARGET = 220; // grid máximo por lado (≈48k vértices: fluido en three.js)

async function main(): Promise<void> {
  const code = process.argv[2] ?? 'R2';
  const src = path.resolve(process.cwd(), process.argv[3] ?? 'var/uploads/dem/R2.tif');
  const outDir = path.resolve(process.cwd(), '..', 'web', 'public', 'dem');
  const out = path.join(outDir, `${code}.json`);

  const tiff = await fromFile(src);
  const image = await tiff.getImage();
  const W = image.getWidth();
  const H = image.getHeight();
  const bbox = image.getBoundingBox(); // [minX, minY, maxX, maxY] en el CRS del DEM
  const noDataRaw = image.getGDALNoData();
  const noData = typeof noDataRaw === 'number' ? noDataRaw : null;

  const factor = Math.max(1, Math.ceil(Math.max(W, H) / TARGET));
  const outW = Math.max(2, Math.round(W / factor));
  const outH = Math.max(2, Math.round(H / factor));

  const rasters = await image.readRasters({ width: outW, height: outH, resampleMethod: 'nearest' });
  const band = rasters[0] as ArrayLike<number>;

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    if ((noData !== null && v === noData) || !Number.isFinite(v)) continue;
    if (v < minZ) minZ = v;
    if (v > maxZ) maxZ = v;
  }
  if (!Number.isFinite(minZ)) {
    minZ = 0;
    maxZ = 1;
  }

  // Reemplaza noData / inválidos por minZ (piso plano) para una malla continua.
  const elevations: number[] = new Array(band.length);
  for (let i = 0; i < band.length; i++) {
    const v = band[i];
    elevations[i] = (noData !== null && v === noData) || !Number.isFinite(v) ? minZ : v;
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    out,
    JSON.stringify({ code, width: outW, height: outH, bbox, minZ, maxZ, noData, elevations }),
  );

  console.log(`DEM ${code}: ${W}x${H} -> ${outW}x${outH} (factor ${factor})`);
  console.log(`Elevación: min=${minZ.toFixed(2)} max=${maxZ.toFixed(2)} Δ=${(maxZ - minZ).toFixed(2)} m`);
  console.log(`bbox=${JSON.stringify(bbox)} noData=${noData}`);
  console.log(`-> ${out} (${elevations.length} celdas)`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
