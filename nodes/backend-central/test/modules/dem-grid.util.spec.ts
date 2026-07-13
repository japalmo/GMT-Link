import { describe, expect, it } from 'vitest';
import { buildDemGrid, type DemSourceImage } from '../../src/modules/metrics/dem-grid.util';

/**
 * Fabrica una imagen GeoTIFF falsa (subconjunto estructural `DemSourceImage`). `band`
 * recibe el tamaño de salida ya submuestreado que pidió `buildDemGrid` y devuelve la
 * banda de valores, para poder afirmar el downsampling sin abrir un .tif real.
 */
function fakeImage(opts: {
  width: number;
  height: number;
  bbox?: [number, number, number, number];
  noData?: number | null;
  band: (outW: number, outH: number) => number[];
}): DemSourceImage {
  return {
    getWidth: () => opts.width,
    getHeight: () => opts.height,
    getBoundingBox: () => opts.bbox ?? [0, 0, opts.width, opts.height],
    getGDALNoData: () => opts.noData ?? null,
    readRasters: ({ width, height }) => Promise.resolve([opts.band(width, height)]),
  };
}

describe('buildDemGrid', () => {
  it('conserva el grid cuando cabe bajo el target (factor 1) y calcula min/max', async () => {
    const image = fakeImage({
      width: 4,
      height: 4,
      bbox: [10, 20, 30, 40],
      band: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    });
    const grid = await buildDemGrid(image, 10);
    expect(grid.width).toBe(4);
    expect(grid.height).toBe(4);
    expect(grid.bbox).toEqual([10, 20, 30, 40]);
    expect(grid.minZ).toBe(1);
    expect(grid.maxZ).toBe(16);
    expect(grid.elevations).toHaveLength(16);
    expect(grid.elevations[0]).toBe(1);
    expect(grid.elevations[15]).toBe(16);
  });

  it('submuestrea al target y devuelve el tamaño reducido', async () => {
    const image = fakeImage({
      width: 500,
      height: 500,
      band: (w, h) => new Array(w * h).fill(5),
    });
    const grid = await buildDemGrid(image, 220);
    // factor = ceil(500/220) = 3 → out = round(500/3) = 167
    expect(grid.width).toBe(167);
    expect(grid.height).toBe(167);
    expect(grid.elevations).toHaveLength(167 * 167);
    expect(grid.minZ).toBe(5);
    expect(grid.maxZ).toBe(5);
  });

  it('reemplaza valores noData por minZ (piso plano) y los excluye del rango', async () => {
    const image = fakeImage({
      width: 2,
      height: 2,
      noData: -9999,
      band: () => [10, -9999, 20, 30],
    });
    const grid = await buildDemGrid(image, 10);
    expect(grid.minZ).toBe(10);
    expect(grid.maxZ).toBe(30);
    expect(grid.elevations).toEqual([10, 10, 20, 30]);
  });

  it('reemplaza valores no finitos (NaN/Infinity) por minZ y los excluye del rango', async () => {
    const image = fakeImage({
      width: 2,
      height: 2,
      band: () => [5, Number.NaN, 7, 8],
    });
    const grid = await buildDemGrid(image, 10);
    expect(grid.minZ).toBe(5);
    expect(grid.maxZ).toBe(8);
    expect(grid.elevations).toEqual([5, 5, 7, 8]);
  });

  it('usa un rango de respaldo (0..1) cuando toda la banda es noData', async () => {
    const image = fakeImage({
      width: 2,
      height: 2,
      noData: -1,
      band: () => [-1, -1, -1, -1],
    });
    const grid = await buildDemGrid(image, 10);
    expect(grid.minZ).toBe(0);
    expect(grid.maxZ).toBe(1);
    expect(grid.elevations).toEqual([0, 0, 0, 0]);
  });
});
