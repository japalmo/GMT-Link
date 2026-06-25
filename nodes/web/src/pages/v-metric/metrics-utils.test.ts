import { describe, it, expect } from 'vitest';
import type { MetricElement, MetricVariable, MetricDataPoint } from '@/lib/api';
import { computeLatestPoolMetrics, getPoolStatus, computeSummaryStats } from './metrics-utils';

const el = (id: string, metadata: Record<string, unknown> | null = null): MetricElement =>
  ({ id, metadata }) as unknown as MetricElement;
const v = (id: string, code: string): MetricVariable => ({ id, code }) as unknown as MetricVariable;
const dp = (over: Partial<MetricDataPoint>): MetricDataPoint =>
  ({
    id: 'd',
    value: '0',
    elementId: 'e1',
    variableId: 'v1',
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  }) as unknown as MetricDataPoint;

describe('computeLatestPoolMetrics', () => {
  it('toma el ÚLTIMO valor por fecha (el más reciente sobrescribe)', () => {
    const result = computeLatestPoolMetrics(
      [el('e1')],
      [v('v1', 'cota_espejo')],
      [
        dp({ value: '100', createdAt: '2026-01-01T00:00:00Z' }),
        dp({ value: '200', createdAt: '2026-03-01T00:00:00Z' }),
        dp({ value: '150', createdAt: '2026-02-01T00:00:00Z' }),
      ],
    );
    expect(result.e1?.cota_espejo).toBe('200');
  });

  it('inicializa todos los elementos (aunque no tengan datos)', () => {
    const result = computeLatestPoolMetrics([el('e1'), el('e2')], [], []);
    expect(result).toEqual({ e1: {}, e2: {} });
  });

  it('ignora datapoints sin elementId, con variable desconocida, o de elemento ausente', () => {
    const result = computeLatestPoolMetrics(
      [el('e1')],
      [v('v1', 'cota_espejo')],
      [
        dp({ elementId: undefined, value: 'X' }), // sin elementId
        dp({ variableId: 'desconocida', value: 'Y' }), // variable no listada
        dp({ elementId: 'e9', value: 'Z' }), // elemento no listado
        dp({ value: 'OK' }), // válido
      ],
    );
    expect(result.e1).toEqual({ cota_espejo: 'OK' });
  });
});

describe('getPoolStatus', () => {
  const meta = { cota_segura: 2301, cota_lamina_critica: 2302 };

  it('neutral cuando no hay cota_espejo o es NaN', () => {
    expect(getPoolStatus(el('e1', meta), { e1: {} })).toBe('neutral');
    expect(getPoolStatus(el('e1', meta), { e1: { cota_espejo: 'abc' } })).toBe('neutral');
  });

  it('danger cuando la cota alcanza/supera la cota crítica', () => {
    expect(getPoolStatus(el('e1', meta), { e1: { cota_espejo: '2302' } })).toBe('danger');
    expect(getPoolStatus(el('e1', meta), { e1: { cota_espejo: '2302.5' } })).toBe('danger');
  });

  it('warning entre cota segura y crítica', () => {
    expect(getPoolStatus(el('e1', meta), { e1: { cota_espejo: '2301.5' } })).toBe('warning');
  });

  it('safe bajo la cota segura', () => {
    expect(getPoolStatus(el('e1', meta), { e1: { cota_espejo: '2300' } })).toBe('safe');
  });

  it('safe cuando hay cota válida pero la metadata no define umbrales', () => {
    expect(getPoolStatus(el('e1', {}), { e1: { cota_espejo: '2300' } })).toBe('safe');
  });
});

describe('computeSummaryStats', () => {
  it('suma los últimos volúmenes de cada elemento y cuenta las pozas', () => {
    const latest = {
      e1: { vol_salmuera_total: '100', vol_salmuera_libre: '80', vol_sal: '20' },
      e2: { vol_salmuera_total: '50.5', vol_salmuera_libre: '40.5' }, // sin vol_sal
    };
    const stats = computeSummaryStats([el('e1'), el('e2')], latest);
    expect(stats.totalBrineVolume).toBeCloseTo(150.5);
    expect(stats.totalFreeVolume).toBeCloseTo(120.5);
    expect(stats.totalDecantedSalt).toBeCloseTo(20);
    expect(stats.poolCount).toBe(2);
  });

  it('valores ausentes cuentan como 0; sin elementos → todo 0', () => {
    expect(computeSummaryStats([], {})).toEqual({
      totalBrineVolume: 0,
      totalFreeVolume: 0,
      totalDecantedSalt: 0,
      poolCount: 0,
    });
  });
});
