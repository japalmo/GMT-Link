/**
 * Lógica pura de agregación de cubicación de V-metric (extraída de index.tsx
 * para poder testearla). Calcula, por elemento (poza/reservorio), el último
 * valor de cada variable, el estado de alerta según cotas, y los totales del
 * yacimiento. Sin dependencias de React/UI.
 */
import type { MetricElement, MetricVariable, MetricDataPoint } from '@/lib/api';

/** Último valor (string) de cada variable (por code) para cada elemento (por id). */
export type LatestPoolMetrics = Record<string, Record<string, string>>;

export type PoolStatus = 'neutral' | 'danger' | 'warning' | 'safe';

export interface SummaryStats {
  totalBrineVolume: number;
  totalFreeVolume: number;
  totalDecantedSalt: number;
  poolCount: number;
}

/**
 * Para cada elemento, toma el ÚLTIMO valor de cada variable (por fecha de
 * creación ascendente → el más reciente sobrescribe). Datos sin `elementId`,
 * con variable desconocida, o de un elemento ausente se ignoran.
 */
export function computeLatestPoolMetrics(
  elements: MetricElement[],
  variables: MetricVariable[],
  dataPoints: MetricDataPoint[],
): LatestPoolMetrics {
  const metrics: LatestPoolMetrics = {};
  elements.forEach((el) => {
    metrics[el.id] = {};
  });

  const sortedDps = [...dataPoints].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  sortedDps.forEach((dp) => {
    if (dp.elementId) {
      const elementMetrics = metrics[dp.elementId];
      if (elementMetrics) {
        const variable = variables.find((v) => v.id === dp.variableId);
        if (variable) {
          elementMetrics[variable.code] = dp.value;
        }
      }
    }
  });

  return metrics;
}

/**
 * Estado de alerta de un elemento según su cota de espejo vs. los umbrales de
 * su metadata: `neutral` (sin dato/NaN), `danger` (≥ cota_lamina_critica),
 * `warning` (≥ cota_segura), `safe` (normal).
 */
export function getPoolStatus(element: MetricElement, latest: LatestPoolMetrics): PoolStatus {
  const poolData = latest[element.id] || {};
  const cotaEspejoStr = poolData['cota_espejo'];
  if (!cotaEspejoStr) return 'neutral';

  const cotaEspejo = parseFloat(cotaEspejoStr);
  const metadata = (element.metadata as Record<string, number> | null) || {};
  const cotaCritica = metadata.cota_lamina_critica;
  const cotaSegura = metadata.cota_segura;

  if (isNaN(cotaEspejo)) return 'neutral';
  if (cotaCritica !== undefined && cotaEspejo >= cotaCritica) return 'danger';
  if (cotaSegura !== undefined && cotaEspejo >= cotaSegura) return 'warning';
  return 'safe';
}

/** Totales del yacimiento (suma de los últimos volúmenes de cada elemento). */
export function computeSummaryStats(
  elements: MetricElement[],
  latest: LatestPoolMetrics,
): SummaryStats {
  let totalBrineVolume = 0;
  let totalFreeVolume = 0;
  let totalDecantedSalt = 0;

  elements.forEach((el) => {
    const elData = latest[el.id] || {};
    const volSalmueraTotal = parseFloat(elData['vol_salmuera_total'] || '0');
    const volSalmueraLibre = parseFloat(elData['vol_salmuera_libre'] || '0');
    const volSal = parseFloat(elData['vol_sal'] || '0');

    if (!isNaN(volSalmueraTotal)) totalBrineVolume += volSalmueraTotal;
    if (!isNaN(volSalmueraLibre)) totalFreeVolume += volSalmueraLibre;
    if (!isNaN(volSal)) totalDecantedSalt += volSal;
  });

  return {
    totalBrineVolume,
    totalFreeVolume,
    totalDecantedSalt,
    poolCount: elements.length,
  };
}
