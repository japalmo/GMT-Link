import { describe, expect, it } from 'vitest';

import {
  INTERVALO_MANTENCION_KM,
  inicioDePeriodo,
  kmPorPeriodo,
  limpiarSerie,
  promedios,
  proyectarMantencion,
  type LecturaOdometro,
} from '../../../src/modules/assets/vehicle-usage.util';

/**
 * Lo que importa verificar acá es que los NÚMEROS sean correctos, porque de
 * ellos sale una fecha de mantención que alguien va a usar para planificar.
 *
 * El caso más importante son las lecturas de odómetro que RETROCEDEN: en los
 * datos reales de producción son entre un 3% y un 6% (10 de 333 en un vehículo,
 * 19 de 303 en otro), y una sola mal tipeada basta para ensuciar el promedio.
 */

function fecha(dia: number): Date {
  return new Date(2026, 0, 1 + dia);
}

function serie(...pares: Array<[number, number]>): LecturaOdometro[] {
  return pares.map(([dia, km]) => ({ fecha: fecha(dia), km }));
}

// ─────────────────────────── limpieza de la serie ───────────────────────────

describe('limpiarSerie', () => {
  it('ordena por fecha aunque lleguen desordenadas', () => {
    const { lecturas } = limpiarSerie(serie([5, 1500], [0, 1000], [2, 1200]));
    expect(lecturas.map((l) => l.km)).toEqual([1000, 1200, 1500]);
  });

  it('descarta la lectura que retrocede y explica contra qué choca', () => {
    // Un odómetro no baja: es un error de tipeo al cargar el checklist.
    const { lecturas, descartadas } = limpiarSerie(
      serie([0, 50_000], [1, 50_300], [2, 5_030], [3, 50_600]),
    );

    expect(lecturas.map((l) => l.km)).toEqual([50_000, 50_300, 50_600]);
    expect(descartadas).toHaveLength(1);
    expect(descartadas[0]!.km).toBe(5_030);
    // El motivo nombra las lecturas válidas que la rodean: es lo que alguien
    // necesita para saber qué debería decir la mal cargada.
    expect(descartadas[0]!.motivo).toContain('50.300');
    expect(descartadas[0]!.motivo).toContain('50.600');
  });

  it('una lectura errónea HACIA ARRIBA no arrastra a las correctas que siguen', () => {
    // Este es el caso que hizo cambiar el algoritmo. Comparando contra el
    // máximo, el 500.000 se volvía el techo y botaba TODO lo posterior: en
    // producción una sola lectura así descartó 154 de 258 lecturas.
    const { lecturas, descartadas } = limpiarSerie(
      serie([0, 50_000], [1, 50_100], [2, 500_200], [3, 50_300], [4, 50_400], [5, 50_500]),
    );

    expect(lecturas.map((l) => l.km)).toEqual([50_000, 50_100, 50_300, 50_400, 50_500]);
    expect(descartadas.map((d) => d.km)).toEqual([500_200]);
  });

  it('conserva la MAYORÍA compatible, no la primera lectura que llegó', () => {
    // Si comparara con la anterior, tras un error hacia abajo todas las
    // correctas que siguen quedarían fuera por "subir demasiado".
    const { lecturas, descartadas } = limpiarSerie(
      serie([0, 50_000], [1, 500], [2, 50_100], [3, 50_200]),
    );
    expect(lecturas.map((l) => l.km)).toEqual([50_000, 50_100, 50_200]);
    expect(descartadas).toHaveLength(1);
  });

  it('con empate en largo prefiere la serie que empieza más alto', () => {
    // `[50.000, 50.100]` y `[500, 50.100]` miden lo mismo. La segunda implicaría
    // haber recorrido 49.600 km inventados, así que gana la primera.
    const { lecturas, descartadas } = limpiarSerie(serie([0, 50_000], [1, 500], [2, 50_100]));
    expect(lecturas.map((l) => l.km)).toEqual([50_000, 50_100]);
    expect(descartadas[0]!.km).toBe(500);
  });

  it('acepta lecturas repetidas: un vehículo detenido no cambia el odómetro', () => {
    const { lecturas, descartadas } = limpiarSerie(serie([0, 50_000], [1, 50_000], [2, 50_000]));
    expect(lecturas).toHaveLength(3);
    expect(descartadas).toHaveLength(0);
  });

  it('devuelve las descartadas ordenadas por fecha, mezclando ambos motivos', () => {
    const crudas = [
      { fecha: fecha(0), km: 1_000 },
      { fecha: fecha(1), km: Number.NaN },
      { fecha: fecha(2), km: 50 },
      { fecha: fecha(3), km: 1_100 },
    ];
    const { descartadas } = limpiarSerie(crudas);
    expect(descartadas.map((d) => d.fecha.getTime())).toEqual([
      fecha(1).getTime(),
      fecha(2).getTime(),
    ]);
  });

  it('descarta valores no numéricos o negativos', () => {
    const crudas = [
      { fecha: fecha(0), km: 1000 },
      { fecha: fecha(1), km: Number.NaN },
      { fecha: fecha(2), km: -5 },
      { fecha: fecha(3), km: 1100 },
    ];
    const { lecturas, descartadas } = limpiarSerie(crudas);
    expect(lecturas).toHaveLength(2);
    expect(descartadas).toHaveLength(2);
  });

  it('una serie vacía no revienta', () => {
    expect(limpiarSerie([])).toEqual({ lecturas: [], descartadas: [] });
  });

  it('con DOS series completas en la misma ficha conserva la más larga y expone la otra', () => {
    // Caso real de GMT-VH-0008: alguien carga el odómetro de otra camioneta en
    // esta ficha. Las dos series son internamente coherentes, así que ningún
    // cálculo puede repartirlas bien; lo que sí se puede es no esconder el
    // problema. Las descartadas SON la evidencia para arreglar los datos.
    const densa: Array<[number, number]> = [];
    for (let d = 0; d < 12; d += 1) densa.push([d * 2, 55_000 + d * 500]);
    const dispersa: Array<[number, number]> = [
      [3, 76_500],
      [9, 77_000],
      [15, 81_000],
    ];

    const { lecturas, descartadas } = limpiarSerie(serie(...densa, ...dispersa));

    expect(lecturas).toHaveLength(12);
    expect(lecturas[lecturas.length - 1]!.km).toBe(60_500);
    expect(descartadas.map((d) => d.km)).toEqual([76_500, 77_000, 81_000]);
  });
});

// ─────────────────────────── períodos ───────────────────────────

describe('inicioDePeriodo', () => {
  it('la semana empieza el LUNES, no el domingo', () => {
    // Es como se planifica el trabajo en faena; JavaScript trae domingo.
    const jueves = new Date(2026, 0, 8); // jueves
    const lunes = inicioDePeriodo(jueves, 'semana');
    expect(lunes.getDay()).toBe(1);
    expect(lunes.getDate()).toBe(5);
  });

  it('el mes empieza el día 1', () => {
    expect(inicioDePeriodo(new Date(2026, 2, 17), 'mes').getDate()).toBe(1);
  });

  it('el día ignora la hora', () => {
    const a = inicioDePeriodo(new Date(2026, 0, 5, 3), 'dia');
    const b = inicioDePeriodo(new Date(2026, 0, 5, 22), 'dia');
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('kmPorPeriodo', () => {
  it('mide contra el período ANTERIOR, no dentro del mismo', () => {
    // Con una sola lectura por semana, la resta interna daría 0 y parecería que
    // el vehículo no se movió, cuando recorrió todo lo que lo separa de la
    // lectura previa.
    const lecturas = serie([0, 1000], [7, 1700], [14, 2100]);
    const puntos = kmPorPeriodo(lecturas, 'semana');

    expect(puntos).toHaveLength(3);
    expect(puntos[1]!.km).toBe(700);
    expect(puntos[2]!.km).toBe(400);
  });

  it('agrupa varias lecturas del mismo período', () => {
    const lecturas = serie([0, 1000], [1, 1100], [2, 1250], [8, 1500]);
    const puntos = kmPorPeriodo(lecturas, 'semana');
    expect(puntos).toHaveLength(2);
    expect(puntos[1]!.km).toBe(250); // 1500 - 1250
  });

  it('con menos de dos lecturas no hay recorrido que mostrar', () => {
    expect(kmPorPeriodo(serie([0, 1000]), 'dia')).toEqual([]);
    expect(kmPorPeriodo([], 'dia')).toEqual([]);
  });

  it('nunca devuelve kilómetros negativos', () => {
    for (const g of ['dia', 'semana', 'mes'] as const) {
      for (const p of kmPorPeriodo(serie([0, 1000], [1, 1100], [2, 1300]), g)) {
        expect(p.km).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ─────────────────────────── promedios ───────────────────────────

describe('promedios', () => {
  it('divide por el LAPSO real, no por la cantidad de checklists', () => {
    // Un vehículo con 300 checklists en un año recorre lo mismo que uno con 30.
    // Dividir por reportes premiaría al que más papeleo hace.
    const pocas = serie([0, 0], [100, 10_000]);
    const muchas: LecturaOdometro[] = [];
    for (let d = 0; d <= 100; d += 1) muchas.push({ fecha: fecha(d), km: d * 100 });

    expect(promedios(pocas)!.kmPorDia).toBeCloseTo(100, 5);
    expect(promedios(muchas)!.kmPorDia).toBeCloseTo(100, 5);
  });

  it('deriva semana y mes del promedio diario', () => {
    const p = promedios(serie([0, 0], [10, 1000]))!;
    expect(p.kmPorDia).toBeCloseTo(100, 5);
    expect(p.kmPorSemana).toBeCloseTo(700, 5);
    expect(p.kmPorMes).toBeCloseTo(3000, 5);
  });

  it('reproduce el orden de magnitud real de la flota', () => {
    // GMT-VH-0012 en produccion: 49.800 -> 103.699 km en 374 dias = ~144 km/dia.
    const reales = [
      { fecha: new Date(2025, 6, 1), km: 49_800 },
      { fecha: new Date(2025, 6, 1 + 374), km: 103_699 },
    ];
    expect(promedios(reales)!.kmPorDia).toBeGreaterThan(130);
    expect(promedios(reales)!.kmPorDia).toBeLessThan(160);
  });

  it('con menos de dos lecturas no inventa un promedio', () => {
    expect(promedios(serie([0, 1000]))).toBeNull();
    expect(promedios([])).toBeNull();
  });
});

// ─────────────────────────── proyección de mantención ───────────────────────────

describe('proyectarMantencion', () => {
  it('proyecta el próximo múltiplo del intervalo', () => {
    // 100 km/dia, odometro en 9.500: faltan 500 km = 5 dias.
    const p = proyectarMantencion(serie([0, 8_500], [10, 9_500]))!;
    expect(p.kmObjetivo).toBe(INTERVALO_MANTENCION_KM);
    expect(p.kmRestantes).toBe(500);
    expect(p.diasEstimados).toBe(5);
  });

  it('usa el kilometraje de la última mantención cuando se conoce', () => {
    const p = proyectarMantencion(serie([0, 51_000], [10, 52_000]), {
      ultimaMantencionKm: 50_000,
    })!;
    expect(p.kmObjetivo).toBe(60_000);
    expect(p.kmRestantes).toBe(8_000);
  });

  it('con la mantención ATRASADA apunta al siguiente múltiplo, no al pasado', () => {
    // Devolver una fecha pasada no le sirve a nadie para planificar.
    const p = proyectarMantencion(serie([0, 68_000], [10, 69_000]), {
      ultimaMantencionKm: 50_000,
    })!;
    expect(p.kmObjetivo).toBeGreaterThan(69_000);
    expect(p.diasEstimados).toBeGreaterThan(0);
    expect(p.fechaEstimada.getTime()).toBeGreaterThan(fecha(10).getTime());
  });

  it('la fecha estimada nunca queda antes de la última lectura', () => {
    for (const km of [1, 9_999, 10_001, 250_000]) {
      const p = proyectarMantencion(serie([0, km - 500], [10, km]));
      if (p) expect(p.fechaEstimada.getTime()).toBeGreaterThanOrEqual(fecha(10).getTime());
    }
  });

  it('respeta un intervalo distinto si se le pasa', () => {
    const p = proyectarMantencion(serie([0, 4_000], [10, 5_000]), { intervaloKm: 5_000 })!;
    expect(p.kmObjetivo).toBe(10_000);
  });

  it('sin uso medible no proyecta nada en vez de dividir por cero', () => {
    // Un vehiculo detenido: el odometro no cambia. Proyectar daria infinito.
    expect(proyectarMantencion(serie([0, 5_000], [10, 5_000]))).toBeNull();
    expect(proyectarMantencion(serie([0, 5_000]))).toBeNull();
  });

  it('un error en el MEDIO de la serie no afecta al promedio', () => {
    // El promedio se calcula entre la primera y la última lectura, así que una
    // mal tipeada en el medio no lo mueve. Es robusto POR CONSTRUCCIÓN, y vale
    // dejarlo asentado para que nadie cambie el cálculo a "promediar todos los
    // tramos" sin darse cuenta de que ahí sí entraría el error.
    const conError = serie([0, 50_000], [10, 51_000], [11, 5_100], [20, 52_000]);
    const sucia = proyectarMantencion(conError)!;
    const limpia = proyectarMantencion(limpiarSerie(conError).lecturas)!;
    expect(sucia.diasEstimados).toBe(limpia.diasEstimados);
  });

  it('un error en la ÚLTIMA lectura SÍ arruina la proyección, y limpiar lo evita', () => {
    // Este es el caso que hace necesaria la limpieza: si la lectura más reciente
    // viene mal escrita hacia abajo, el recorrido total se desploma, el promedio
    // cae y la proyección da una fecha de mantención muy posterior a la real.
    const conError = serie([0, 50_000], [10, 51_000], [20, 52_000], [21, 5_200]);
    const sucia = proyectarMantencion(conError);
    const limpia = proyectarMantencion(limpiarSerie(conError).lecturas)!;

    expect(limpia.kmActual).toBe(52_000);
    // Sin limpiar, la ultima lectura es 5.200 km: el odometro "retrocedio" y el
    // recorrido total queda negativo, asi que ni siquiera hay proyeccion.
    expect(sucia).toBeNull();
  });

  it('limpiar deja el kilometraje actual correcto para la proyección', () => {
    const conError = serie([0, 50_000], [10, 51_000], [11, 5_100], [20, 52_000]);
    const { lecturas, descartadas } = limpiarSerie(conError);
    expect(descartadas).toHaveLength(1);
    expect(proyectarMantencion(lecturas)!.kmActual).toBe(52_000);
  });
});
