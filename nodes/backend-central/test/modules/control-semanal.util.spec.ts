import { describe, expect, it } from 'vitest';
import {
  computeControlSemanal,
  type CabeceraControl,
  type FilaActividad,
  type FilaSemana,
} from '../../src/modules/projects/control-semanal.util';

/**
 * Los números de estas pruebas salen del informe firmado GMT-MB-OOCC-CS-01
 * (Cierre Perimetral Mantos Blancos, corte 10-09-2026). El tablero se le
 * muestra al cliente al lado de ese PDF: si acá sale otra cifra, el tablero
 * está mintiendo, y por eso el caso base compara contra el documento y no
 * contra lo que devuelva el código.
 */

const CABECERA: CabeceraControl = {
  totalHh: 2312,
  cutoffDate: new Date('2026-09-10T00:00:00Z'),
  planAtCutoff: 0.02306805074971165,
};

/** Las doce semanas del programa, tal como las publica el informe. */
const SEMANAS: FilaSemana[] = [
  { code: 'S-0', index: 0, closeDate: new Date('2026-09-06T00:00:00Z'), hhPlan: 0, parPlan: 0, parReal: 0, acmPlan: 0, acmReal: 0 },
  { code: 'S-1', index: 1, closeDate: new Date('2026-09-13T00:00:00Z'), hhPlan: 80, parPlan: 0.03460207612456748, parReal: 0.13287197231833908, acmPlan: 0.03460207612456748, acmReal: 0.13287197231833908 },
  { code: 'S-2', index: 2, closeDate: new Date('2026-09-20T00:00:00Z'), hhPlan: 185.28627450980392, parPlan: 0.08014112219282177, parReal: null, acmPlan: 0.11474319831738924, acmReal: null },
  { code: 'S-3', index: 3, closeDate: new Date('2026-09-27T00:00:00Z'), hhPlan: 213.87049892420737, parPlan: 0.09250454105718312, parReal: null, acmPlan: 0.20724773937457236, acmReal: null },
];

/** Dos actividades de fases distintas, con su reparto de HH por semana. */
const ACTIVIDADES: FilaActividad[] = [
  {
    wbsId: 7,
    name: 'Movilizacion equipos y personal',
    phase: 'Gestión',
    hh: 80,
    startDate: new Date('2026-09-09T00:00:00Z'),
    endDate: new Date('2026-09-16T00:00:00Z'),
    hhByWeek: [40, 40, 0],
    realByWeek: [0],
  },
  {
    wbsId: 8,
    name: 'Instalacion de faenas',
    phase: 'Gestión',
    hh: 80,
    startDate: new Date('2026-09-09T00:00:00Z'),
    endDate: new Date('2026-09-16T00:00:00Z'),
    hhByWeek: [40, 40, 0],
    realByWeek: [0.2],
  },
  {
    wbsId: 11,
    name: 'Suministro dados hormigon',
    phase: 'Suministros',
    hh: 120,
    startDate: new Date('2026-09-16T00:00:00Z'),
    endDate: new Date('2026-10-08T00:00:00Z'),
    hhByWeek: [0, 21.176470588235293, 35.294117647058826],
    realByWeek: [0.4],
  },
];

describe('computeControlSemanal', () => {
  it('reproduce la cabecera del informe firmado', () => {
    const control = computeControlSemanal(CABECERA, SEMANAS, ACTIVIDADES);

    expect(control).not.toBeNull();
    expect(control?.cutoff).toBe('2026-09-10');
    expect(control?.totalHh).toBe(2312);
    // El PDF informa 13,29% real contra 2,31% de programa: +10,98 pp.
    expect(control?.realPercent).toBe(13.3);
    expect(control?.planPercent).toBe(2.3);
    expect(control?.deviation).toBe(11);
  });

  it('usa el plan prorrateado al corte y no el del cierre de semana', () => {
    const control = computeControlSemanal(CABECERA, SEMANAS, ACTIVIDADES);

    // El corte cae el 10-09 y la semana cierra el 13-09 con 3,5% acumulado.
    // Tomar el de la semana inflaría el programa y borraría el adelanto real.
    expect(control?.weeks[1]?.acmPlan).toBe(3.5);
    expect(control?.planPercent).toBe(2.3);
  });

  it('marca la última semana informada y deja el resto sin real', () => {
    const control = computeControlSemanal(CABECERA, SEMANAS, ACTIVIDADES);

    expect(control?.lastClosed).toBe(1);
    expect(control?.weeks[1]?.parReal).toBe(13.3);
    expect(control?.weeks[1]?.deviation).toBe(9.8);
    expect(control?.weeks[2]?.acmReal).toBeNull();
    // Sin informe no hay desviación: un 0 diría "en línea", que es otra cosa.
    expect(control?.weeks[2]?.deviation).toBeNull();
  });

  it('pondera cada fase por las HH de sus actividades', () => {
    const control = computeControlSemanal(CABECERA, SEMANAS, ACTIVIDADES);
    const gestion = control?.phases.find((f) => f.name === 'Gestión');
    const suministros = control?.phases.find((f) => f.name === 'Suministros');

    expect(gestion?.hh).toBe(160);
    // (80×0 + 80×0,2) / 160 = 10%.
    expect(gestion?.real).toEqual([0, 10]);
    // S-1 reparte 80 de las 160 HH de la fase.
    expect(gestion?.plan[1]).toBe(50);

    expect(suministros?.real).toEqual([0, 40]);
    // Suministros no arranca en S-1: su programa parte recién en S-2.
    expect(suministros?.plan[1]).toBe(0);
  });

  it('ordena las fases como el programa y descarta las que no pesan HH', () => {
    const conHitos: FilaActividad[] = [
      ...ACTIVIDADES,
      {
        wbsId: 3,
        name: 'Hito - Inicio de Obra',
        phase: 'Hitos',
        hh: 0,
        startDate: new Date('2026-08-10T00:00:00Z'),
        endDate: new Date('2026-08-10T00:00:00Z'),
        hhByWeek: [0, 0, 0],
        realByWeek: [0],
      },
    ];
    const control = computeControlSemanal(CABECERA, SEMANAS, conHitos);

    // Un hito no aporta avance: informarlo como "0%" sugeriría un atraso que
    // no existe. Y Gestión va antes que Suministros, como en el programa.
    expect(control?.phases.map((f) => f.name)).toEqual(['Gestión', 'Suministros']);
  });

  it('devuelve null cuando la obra no tiene programa cargado', () => {
    expect(computeControlSemanal(CABECERA, [], ACTIVIDADES)).toBeNull();
    expect(
      computeControlSemanal({ totalHh: null, cutoffDate: null, planAtCutoff: null }, SEMANAS, []),
    ).toBeNull();
  });

  it('corta el real de una fase en la semana del informe más corto', () => {
    // Si una actividad de la fase aún no tiene informe de esa semana, la fase
    // tampoco: rellenar con cero diría "no avanzó" en vez de "no se sabe".
    const desparejas: FilaActividad[] = [
      { ...(ACTIVIDADES[0] as FilaActividad), realByWeek: [0, 0.5] },
      { ...(ACTIVIDADES[1] as FilaActividad), realByWeek: [0.2] },
    ];
    const control = computeControlSemanal(CABECERA, SEMANAS, desparejas);

    expect(control?.phases[0]?.real).toEqual([0, 10]);
  });
});
