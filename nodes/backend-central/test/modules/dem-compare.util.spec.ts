import { describe, expect, it } from 'vitest';
import {
  computeCutFill,
  cellAreaOf,
  type CompareGrid,
} from '../../src/modules/metrics/dem-compare.util';

function grid(elevations: number[], width: number, height: number, noData: number | null = null): CompareGrid {
  return { width, height, bbox: [0, 0, width, height], elevations, noData };
}

describe('cellAreaOf', () => {
  it('calcula el área de celda a partir del bbox UTM y las dimensiones', () => {
    expect(cellAreaOf({ bbox: [0, 0, 100, 50], width: 10, height: 5 })).toBe(100);
    expect(cellAreaOf({ bbox: [0, 0, 2, 2], width: 2, height: 2 })).toBe(1);
  });
});

describe('computeCutFill', () => {
  it('relleno puro: B por encima de A en todas las celdas', () => {
    const r = computeCutFill(grid([0, 0, 0, 0], 2, 2), grid([1, 2, 3, 4], 2, 2));
    expect(r.fillM3).toBe(10);
    expect(r.cutM3).toBe(0);
    expect(r.netM3).toBe(10);
    expect(r.areaM2).toBe(4);
    expect(r.cells).toBe(4);
    expect(r.cellAreaM2).toBe(1);
  });

  it('corte puro: B por debajo de A en todas las celdas', () => {
    const r = computeCutFill(grid([5, 5, 5, 5], 2, 2), grid([4, 3, 2, 1], 2, 2));
    expect(r.fillM3).toBe(0);
    expect(r.cutM3).toBe(10);
    expect(r.netM3).toBe(-10);
  });

  it('mixto: suma relleno y corte por separado, neto = relleno - corte', () => {
    const r = computeCutFill(grid([0, 0, 10, 10], 2, 2), grid([2, 3, 8, 6], 2, 2));
    expect(r.fillM3).toBe(5); // (2-0)+(3-0)
    expect(r.cutM3).toBe(6); // |8-10|+|6-10|
    expect(r.netM3).toBe(-1);
    expect(r.cells).toBe(4);
  });

  it('excluye celdas noData de cualquiera de los dos DEMs', () => {
    const a = grid([1, -9999, 3, 4], 2, 2, -9999);
    const b = grid([2, 2, 2, 2], 2, 2);
    const r = computeCutFill(a, b);
    // celda 1 (A=noData) se omite; celdas 0/2/3: +1, -1, -2
    expect(r.cells).toBe(3);
    expect(r.fillM3).toBe(1);
    expect(r.cutM3).toBe(3);
    expect(r.netM3).toBe(-2);
    expect(r.areaM2).toBe(3);
  });

  it('excluye celdas no finitas (NaN)', () => {
    const a = grid([1, Number.NaN, 3, 4], 2, 2);
    const b = grid([2, 2, 2, 2], 2, 2);
    expect(computeCutFill(a, b).cells).toBe(3);
  });

  it('escala el volumen por el área de celda real (bbox grande)', () => {
    const a = { width: 10, height: 1, bbox: [0, 0, 100, 10] as [number, number, number, number], elevations: new Array<number>(10).fill(0), noData: null };
    const b = { ...a, elevations: new Array<number>(10).fill(1) };
    const r = computeCutFill(a, b);
    // cellArea = (100/10)*(10/1) = 100; 10 celdas con +1 → 1000 m³
    expect(r.cellAreaM2).toBe(100);
    expect(r.fillM3).toBe(1000);
  });

  it('lanza si los DEMs no están alineados (dimensiones distintas)', () => {
    expect(() => computeCutFill(grid([0, 0, 0, 0], 2, 2), grid([0, 0, 0, 0, 0, 0], 3, 2))).toThrow(
      /alineados/,
    );
  });
});
