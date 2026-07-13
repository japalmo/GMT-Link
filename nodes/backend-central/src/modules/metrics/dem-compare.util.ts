/**
 * Corte/relleno entre dos DEMs (volumen B - A), portado de `SurfaceCalculator.
 * volume_between_surfaces` del desktop (poza/core.py). A diferencia del grid del visor
 * (`buildDemGrid`, que rellena noData con minZ para una malla continua), la comparación
 * DEBE preservar la máscara de validez: una celda inválida en cualquiera de los dos DEMs
 * se excluye del cálculo. Requiere mallas alineadas (misma dimensión y extensión).
 */

/** Grid de elevaciones crudo para comparar (noData SIN rellenar). */
export interface CompareGrid {
  width: number;
  height: number;
  bbox: [number, number, number, number]; // [minX, minY, maxX, maxY] en el CRS del DEM (UTM)
  elevations: number[]; // fila-mayor, longitud width*height; noData tal cual
  noData: number | null;
}

/** Resultado del corte/relleno entre dos superficies. */
export interface CutFillResult {
  fillM3: number; // relleno: volumen donde B está por encima de A
  cutM3: number; // corte: volumen donde B está por debajo de A
  netM3: number; // fill - cut
  areaM2: number; // área de celdas válidas en AMBOS DEMs
  cellAreaM2: number; // área de una celda del grid
  cells: number; // celdas válidas comparadas
}

/** ¿La celda tiene un valor válido (finito y distinto de noData)? */
function isValid(v: number | undefined, noData: number | null): boolean {
  return v !== undefined && Number.isFinite(v) && (noData === null || v !== noData);
}

/** Área de una celda a partir del bbox (UTM, metros) y las dimensiones del grid. */
export function cellAreaOf(grid: Pick<CompareGrid, 'bbox' | 'width' | 'height'>): number {
  const [minX, minY, maxX, maxY] = grid.bbox;
  const cellW = Math.abs(maxX - minX) / grid.width;
  const cellH = Math.abs(maxY - minY) / grid.height;
  return cellW * cellH;
}

/**
 * Corte/relleno entre dos DEMs alineados (mismo width/height). El área de celda se toma
 * del grid A (se asume la misma extensión). Celdas inválidas en cualquiera de los dos se
 * omiten (intersección de máscaras de validez).
 */
export function computeCutFill(a: CompareGrid, b: CompareGrid): CutFillResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `Los DEMs no están alineados: ${a.width}x${a.height} vs ${b.width}x${b.height}.`,
    );
  }

  const cellArea = cellAreaOf(a);
  const n = a.width * a.height;

  let fillSum = 0;
  let cutSum = 0;
  let cells = 0;
  for (let i = 0; i < n; i++) {
    const va = a.elevations[i];
    const vb = b.elevations[i];
    if (!isValid(va, a.noData) || !isValid(vb, b.noData)) continue;
    const d = (vb as number) - (va as number);
    if (d > 0) fillSum += d;
    else if (d < 0) cutSum += -d;
    cells += 1;
  }

  return {
    fillM3: fillSum * cellArea,
    cutM3: cutSum * cellArea,
    netM3: (fillSum - cutSum) * cellArea,
    areaM2: cells * cellArea,
    cellAreaM2: cellArea,
    cells,
  };
}
