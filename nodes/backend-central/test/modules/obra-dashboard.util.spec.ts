import { describe, expect, it } from 'vitest';
import {
  computeObraDashboard,
  doneOf,
  sectorDeCerco,
  tipoDeCerco,
  weightOf,
  type ObraActivity,
} from '../../src/modules/projects/obra-dashboard.util';

const d = (s: string): Date => new Date(s + 'T00:00:00.000Z');

/** Reporte de avance. El id lo exige el contrato para listar los últimos. */
let secuencia = 0;
const rep = (fecha: string, quantity: number) => ({
  id: `r${(secuencia += 1)}`,
  date: d(fecha),
  quantity,
});

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
        rep('2026-01-02', 10),
        rep('2026-01-03', 15),
      ],
    });
    expect(doneOf(a)).toBe(25);
  });

  it('un reporte negativo corrige sin borrar historial', () => {
    const a = act({
      id: 'z',
      progress: [
        rep('2026-01-02', 30),
        rep('2026-01-03', -5),
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
    const a = act({ id: 'a', progress: [rep('2026-01-05', 40)] });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-06'));
    expect(r.realProgress).toBe(40);
  });

  it('la desviación es real menos planificado y marca atraso', () => {
    const a = act({ id: 'a', progress: [rep('2026-01-05', 40)] });
    const r = computeObraDashboard('p', 'P', [a], d('2026-01-06'));
    expect(r.deviation).toBe(-10);
    expect(r.status).toBe('ATRASADO');
  });

  it('adelantado, en línea y leve atraso caen en su tramo', () => {
    const conAvance = (q: number) =>
      computeObraDashboard('p', 'P', [act({ id: 'a', progress: [rep('2026-01-05', q)] })], d('2026-01-06'));
    expect(conAvance(60).status).toBe('ADELANTADO');
    expect(conAvance(50).status).toBe('EN_LINEA');
    expect(conAvance(47).status).toBe('LEVE_ATRASO');
  });

  it('reportar de más no supera el 100%', () => {
    const a = act({ id: 'a', progress: [rep('2026-01-05', 250)] });
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
      progress: [rep('2026-01-02', 2)],
    });
    const r = computeObraDashboard('p', 'P', [grande, chica], d('2026-01-10'));
    expect(r.phases).toHaveLength(1);
    expect(r.phases[0]?.percent).toBeLessThan(1);
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
    expect(r.milestones[0]?.done).toBe(true);
  });
});

describe('curvas', () => {
  it('entrega las cuatro curvas', () => {
    const a = act({ id: 'a', progress: [rep('2026-01-05', 40)] });
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
      progress: [rep('2026-01-05', 20)],
    });
    const r = computeObraDashboard('p', 'P', [a], d('2026-02-20'));
    const ultima = r.curves.real.at(-1)?.date ?? '';
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
    for (let i = 1; i < vals.length; i += 1) expect(vals[i] ?? 0).toBeGreaterThanOrEqual(vals[i - 1] ?? 0);
    expect(vals.at(-1)).toBe(100);
  });
});

describe('cercos con etapas (jerarquía padre → hijas)', () => {
  /** Un cerco con sus etapas, como queda sembrado el Cierre Perimetral. */
  function cerco(codigo: string, sector: string | null, etapas: Array<[string, number, number]>) {
    const padre = act({
      id: `c-${codigo}`,
      name: sector ? `Cerco ${codigo} · ${sector}` : `Cerco ${codigo}`,
      quantityTotal: null,
    });
    const hijas = etapas.map(([nombre, total, hecho]) =>
      act({
        id: `c-${codigo}-${nombre}`,
        name: nombre,
        parentId: `c-${codigo}`,
        quantityTotal: total,
        progress: hecho > 0 ? [rep('2026-01-05', hecho)] : [],
      }),
    );
    return [padre, ...hijas];
  }

  it('el padre no se mide: si lo hiciera, la obra contaría dos veces', () => {
    // El padre iría con cantidad 100 y las hijas suman 100: sin exclusión el
    // total ponderado se duplicaría y el avance saldría a la mitad.
    const acts = cerco('A-I', 'PF8', [
      ['Excavación de dados', 6, 6],
      ['Montaje de pilares galvanizados', 6, 0],
    ]);
    const r = computeObraDashboard('p', 'P', acts, d('2026-01-06'));
    expect(r.realProgress).toBe(50);
  });

  it('la fase muestra el cerco como una línea con sus etapas dentro', () => {
    const r = computeObraDashboard(
      'p',
      'P',
      cerco('A-I', 'PF8', [
        ['Excavación de dados', 6, 6],
        ['Montaje de pilares galvanizados', 6, 3],
      ]),
      d('2026-01-06'),
    );
    const linea = r.phases[0]?.activities[0];
    expect(linea?.name).toBe('Cerco A-I · PF8');
    expect(linea?.steps.map((s) => s.name)).toEqual([
      'Excavación de dados',
      'Montaje de pilares galvanizados',
    ]);
    expect(linea?.stepsDone).toBe(1);
    expect(linea?.stepsTotal).toBe(2);
    expect(linea?.percent).toBe(75);
  });

  it('una partida suelta sigue siendo una línea sin etapas', () => {
    const r = computeObraDashboard('p', 'P', [act({ id: 'zanja', quantityTotal: 1000 })], d('2026-01-06'));
    const linea = r.phases[0]?.activities[0];
    expect(linea?.steps).toEqual([]);
    expect(linea?.stepsTotal).toBe(1);
  });

  it('corta por etapa sumando la misma etapa de todos los cercos', () => {
    const acts = [
      ...cerco('A-I', 'PF8', [['Excavación de dados', 6, 6]]),
      ...cerco('B-I', 'DC1', [['Excavación de dados', 7, 0]]),
    ];
    const r = computeObraDashboard('p', 'P', acts, d('2026-01-06'));
    const etapa = r.breakdowns.find((b) => b.key === 'etapa');
    expect(etapa?.lines).toHaveLength(1);
    expect(etapa?.lines[0]?.quantityTotal).toBe(13);
    expect(etapa?.lines[0]?.quantityDone).toBe(6);
  });

  it('corta por tipo de cerco leyendo el código del padre', () => {
    const acts = [
      ...cerco('A-I', 'PF8', [['Excavación de dados', 6, 6]]),
      ...cerco('B-I', 'DC1', [['Excavación de dados', 7, 0]]),
    ];
    const r = computeObraDashboard('p', 'P', acts, d('2026-01-06'));
    const tipo = r.breakdowns.find((b) => b.key === 'tipo');
    expect(tipo?.lines.map((l) => l.name)).toEqual(['Cerco tipo A', 'Cerco tipo B']);
    expect(tipo?.lines[0]?.percent).toBe(100);
    expect(tipo?.lines[1]?.percent).toBe(0);
  });

  it('corta por sector y agrupa los sin ubicación en "Por definir"', () => {
    const acts = [
      ...cerco('A-I', 'PF8', [['Excavación de dados', 6, 6]]),
      ...cerco('B-XL', null, [['Excavación de dados', 7, 0]]),
    ];
    const r = computeObraDashboard('p', 'P', acts, d('2026-01-06'));
    const sector = r.breakdowns.find((b) => b.key === 'sector');
    expect(sector?.lines.map((l) => l.name).sort()).toEqual(['PF8', 'Por definir']);
  });

  it('no corta por sector cuando toda la obra está en uno solo', () => {
    const r = computeObraDashboard(
      'p',
      'P',
      cerco('A-I', 'PF8', [['Excavación de dados', 6, 6]]),
      d('2026-01-06'),
    );
    expect(r.breakdowns.find((b) => b.key === 'sector')).toBeUndefined();
  });

  it('los últimos avances nombran el cerco y su etapa, del más nuevo al más viejo', () => {
    const acts = [
      ...cerco('A-I', 'PF8', [['Excavación de dados', 6, 6]]),
      act({
        id: 'zanja',
        name: 'Excavación zanja eléctrica',
        quantityTotal: 1000,
        progress: [rep('2026-01-09', 120)],
      }),
    ];
    const r = computeObraDashboard('p', 'P', acts, d('2026-01-10'));
    expect(r.recent[0]?.activityName).toBe('Excavación zanja eléctrica');
    expect(r.recent[1]?.activityName).toBe('Cerco A-I · PF8 · Excavación de dados');
    expect(r.recent.some((x) => 'reportedBy' in x)).toBe(false);
  });
});

describe('lectura del nombre de un cerco', () => {
  it('saca el tipo y el sector', () => {
    expect(tipoDeCerco('Cerco B-XXVII · DC2')).toBe('B');
    expect(sectorDeCerco('Cerco B-XXVII · DC2')).toBe('DC2');
  });

  it('un cerco sin ubicación no tiene sector, pero sí tipo', () => {
    expect(tipoDeCerco('Cerco C-VII')).toBe('C');
    expect(sectorDeCerco('Cerco C-VII')).toBeNull();
  });

  it('lo que no es un cerco no ensucia los cortes', () => {
    expect(tipoDeCerco('Excavación zanja eléctrica 380V (1.000 ml)')).toBeNull();
    expect(sectorDeCerco('Movilización equipos y personal a faena')).toBeNull();
    expect(tipoDeCerco(null)).toBeNull();
  });
});

describe('cortes que mezclan unidades', () => {
  it('por sector se cuentan cercos, porque sumar pto + un + paño no significa nada', () => {
    const etapas = (codigo: string, sector: string) => [
      act({ id: `c-${codigo}`, name: `Cerco ${codigo} · ${sector}`, quantityTotal: null }),
      act({ id: `${codigo}-r`, name: 'Replanteo topográfico', parentId: `c-${codigo}`, quantityTotal: 1, unit: 'pto' }),
      act({ id: `${codigo}-m`, name: 'Montaje de mallas ACMAFOR', parentId: `c-${codigo}`, quantityTotal: 6, unit: 'paño' }),
    ];
    const r = computeObraDashboard(
      'p',
      'P',
      [...etapas('A-I', 'PF8'), ...etapas('A-II', 'PF8'), ...etapas('B-I', 'DC1')],
      d('2026-01-06'),
    );
    const sector = r.breakdowns.find((b) => b.key === 'sector');
    expect(sector?.lines.find((l) => l.name === 'PF8')?.detail).toBe('2 cercos');
    expect(sector?.lines.find((l) => l.name === 'DC1')?.detail).toBe('1 cerco');
    // Mezcla unidades: la línea no debe declarar ninguna.
    expect(sector?.lines[0]?.unit).toBeNull();
  });

  it('por etapa la unidad es única, así que se conserva la cantidad', () => {
    const r = computeObraDashboard(
      'p',
      'P',
      [
        act({ id: 'c-A-I', name: 'Cerco A-I · PF8', quantityTotal: null }),
        act({ id: 'e1', name: 'Excavación de dados', parentId: 'c-A-I', quantityTotal: 6, unit: 'un', progress: [rep('2026-01-05', 3)] }),
      ],
      d('2026-01-06'),
    );
    const etapa = r.breakdowns.find((b) => b.key === 'etapa');
    expect(etapa?.lines[0]?.unit).toBe('un');
    expect(etapa?.lines[0]?.detail).toBeUndefined();
    expect(etapa?.lines[0]?.quantityDone).toBe(3);
  });
});
