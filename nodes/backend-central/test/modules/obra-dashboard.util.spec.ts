import { describe, expect, it } from 'vitest';
import {
  computeObraDashboard,
  doneOf,
  weightOf,
  type ObraActivity,
} from '../../src/modules/projects/obra-dashboard.util';

const d = (s: string): Date => new Date(s + 'T00:00:00.000Z');

/** Actividad de obra con valores por defecto razonables. */
function act(over: Partial<ObraActivity> & { id: string }): ObraActivity {
  return {
    name: over.id,
    phaseId: 'f1',
    phaseName: 'Construcción',
    unit: 'un',
    quantityTotal: 100,
    isMilestone: false,
    start: d('2026-01-01'),
    end: d('2026-01-11'),
    earlyStart: d('2026-01-01'),
    earlyFinish: d('2026-01-11'),
    lateStart: d('2026-01-01'),
    lateFinish: d('2026-01-11'),
    progress: [],
    ...over,
  };
}

describe('ponderación por cantidad × duración', () => {
  it('una partida grande y larga pesa mucho más que una chica y corta', () => {
    const grande = act({ id: 'dados', quantityTotal: 135, start: d('2026-01-01'), end: d('2026-01-21') });
    const chica = act({ id: 'faenas', quantityTotal: 3, start: d('2026-01-01'), end: d('2026-01-06') });
    expect(weightOf(grande)).toBeGreaterThan(weightOf(chica) * 100);
  });

  it('los hitos no pesan: marcan fecha, no aportan avance', () => {
    expect(weightOf(act({ id: 'h', isMilestone: true, quantityTotal: null }))).toBe(0);
  });

  it('una actividad sin cantidad no pondera', () => {
    expect(weightOf(act({ id: 'x', quantityTotal: null }))).toBe(0);
    expect(weightOf(act({ id: 'y', quantityTotal: 0 }))).toBe(0);
  });

  it('la cantidad ejecutada es la SUMA de los reportes, no el último', () => {
    const a = act({
      id: 'z',
      progress: [
        { date: d('2026-01-02'), quantity: 10 },
        { date: d('2026-01-03'), quantity: 15 },
      ],
    });
    expect(doneOf(a)).toBe(25);
  });

  it('un reporte negativo corrige sin borrar historial', () => {
    const a = act({
      id: 'z',
      progress: [
        { date: d('2026-01-02'), quantity: 30 },
        { date: d('2026-01-03'), quantity: -5 },
      ],
    });
    expect(doneOf(a)).toBe(25);
  });
});

describe('avance real y planificado', () => {
  it('sin reportes el avance real es 0', () => {
    const r = computeObraDashboard('p', 'P', [act({ id: 'a' })], d('2026-01-06'));
    expect(r.realProgress).toBe(0);
  });

  it('a mitad del plazo el programa espera el 50%', () => {
    const r = computeObraDashboard('p', 'P', [act({ id: 'a' })], d('2026-01-06'));
    expect(r.plannedProgress).toBe(50);
  });

  it('el avance real refleja la proporción ejecutada', () => {
    const a = act({ id: 'a', progress: [{ date: d('2026-01-05'), quantity: 40 }] });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-06'));
    expect(r.realProgress).toBe(40);
  });

  it('la desviación es real menos planificado y marca atraso', () => {
    const a = act({ id: 'a', progress: [{ date: d('2026-01-05'), quantity: 40 }] });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-06'));
    expect(r.deviation).toBe(-10);
    expect(r.status).toBe('ATRASADO');
  });

  it('adelantado, en línea y leve atraso caen en su tramo', () => {
    const conAvance = (q: number) =>
      computeObraDashboard('p', 'P', [act({ id: 'a', progress: [{ date: d('2026-01-05'), quantity: q }] })], d('2026-01-06'));
    expect(conAvance(60).status).toBe('ADELANTADO');
    expect(conAvance(50).status).toBe('EN_LINEA');
    expect(conAvance(47).status).toBe('LEVE_ATRASO');
  });

  it('reportar de más no supera el 100%', () => {
    const a = act({ id: 'a', progress: [{ date: d('2026-01-05'), quantity: 250 }] });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-20'));
    expect(r.realProgress).toBe(100);
  });

  it('antes del inicio el planificado es 0 y después del fin es 100', () => {
    expect(computeObraDashboard('p', 'P', [act({ id: 'a' })], d('2025-12-01')).plannedProgress).toBe(0);
    expect(computeObraDashboard('p', 'P', [act({ id: 'a' })], d('2026-06-01')).plannedProgress).toBe(100);
  });
});

describe('fases', () => {
  it('el % de la fase se pondera, no es promedio simple de sus actividades', () => {
    // Grande al 0% y chica al 100%: el promedio simple daría 50%, pero la fase
    // debe quedar cerca de 0 porque la que pesa es la grande.
    const grande = act({ id: 'g', quantityTotal: 1000, start: d('2026-01-01'), end: d('2026-01-21') });
    const chica = act({
      id: 'c', quantityTotal: 2, start: d('2026-01-01'), end: d('2026-01-03'),
      progress: [{ date: d('2026-01-02'), quantity: 2 }],
    });
    const r = computeObraDashboard('p', 'P', [grande, chica], d('2026-01-10'));
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0].percent).toBeLessThan(1);
  });

  it('agrupa por fase y suma cantidades', () => {
    const a = act({ id: 'a', phaseId: 'f1', phaseName: 'Gestión', quantityTotal: 10 });
    const b = act({ id: 'b', phaseId: 'f2', phaseName: 'Construcción', quantityTotal: 90 });
    const r = computeObraDashboard('p', 'P', [a, b], d('2026-01-06'));
    expect(r.phases.map((f) => f.name).sort()).toEqual(['Construcción', 'Gestión']);
    expect(r.phases.find((f) => f.name === 'Construcción')?.quantityTotal).toBe(90);
  });
});

describe('hitos', () => {
  it('quedan fuera del avance y se ordenan por fecha', () => {
    const h1 = act({ id: 'h1', name: 'Entrega', isMilestone: true, quantityTotal: null, end: d('2026-03-01') });
    const h2 = act({ id: 'h2', name: 'Kick-off', isMilestone: true, quantityTotal: null, end: d('2026-01-05') });
    const r = computeObraDashboard('p', 'P', [act({ id: 'a' }), h1, h2], d('2026-01-06'));
    expect(r.milestones.map((m) => m.name)).toEqual(['Kick-off', 'Entrega']);
    expect(r.phases.flatMap((f) => f.activities).map((x) => x.id)).toEqual(['a']);
  });

  it('un hito ya pasado se marca cumplido', () => {
    const h = act({ id: 'h', isMilestone: true, quantityTotal: null, end: d('2026-01-05') });
    const r = computeObraDashboard('p', 'P', [act({ id: 'a' }), h], d('2026-01-06'));
    expect(r.milestones[0].done).toBe(true);
  });
});

describe('curvas', () => {
  it('entrega las cuatro curvas', () => {
    const a = act({ id: 'a', progress: [{ date: d('2026-01-05'), quantity: 40 }] });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-06'));
    expect(Object.keys(r.curves).sort()).toEqual(['early', 'late', 'real', 'scheduled']);
    expect(r.curves.scheduled.length).toBeGreaterThan(0);
    expect(r.curves.real.length).toBeGreaterThan(0);
  });

  it('la temprana va por delante de la tardía', () => {
    // Misma actividad, ventana temprana al principio y tardía al final.
    const a = act({
      id: 'a',
      start: d('2026-01-01'), end: d('2026-01-31'),
      earlyStart: d('2026-01-01'), earlyFinish: d('2026-01-10'),
      lateStart: d('2026-01-21'), lateFinish: d('2026-01-31'),
    });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-15'));
    const en = (c: { date: string; value: number }[], f: string) =>
      c.find((p) => p.date === f)?.value ?? 0;
    const fecha = r.curves.scheduled[2]?.date ?? '2026-01-15';
    expect(en(r.curves.early, fecha)).toBeGreaterThanOrEqual(en(r.curves.late, fecha));
  });

  it('la curva real NO se dibuja más allá del último reporte', () => {
    const a = act({
      id: 'a',
      start: d('2026-01-01'), end: d('2026-03-01'),
      progress: [{ date: d('2026-01-05'), quantity: 20 }],
    });
    const r = computeObraDashboard('p', 'P', [a], d('2026-02-20'));
    const ultima = r.curves.real[r.curves.real.length - 1].date;
    expect(ultima <= '2026-01-05').toBe(true);
  });

  it('sin reportes no hay curva real', () => {
    const r = computeObraDashboard('p', 'P', [act({ id: 'a' })], d('2026-01-06'));
    expect(r.curves.real).toEqual([]);
  });

  it('la curva programada es monótona creciente y cierra en 100', () => {
    const a = act({ id: 'a', start: d('2026-01-01'), end: d('2026-02-01') });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-15'));
    const vals = r.curves.scheduled.map((p) => p.value);
    for (let i = 1; i < vals.length; i += 1) expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1]);
    expect(vals[vals.length - 1]).toBe(100);
  });
});
