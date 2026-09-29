import { describe, expect, it } from 'vitest';
import { avanceSemanal } from '../../../src/modules/projects/avance-ponderado.util';

/**
 * El avance real por semana, ponderado por horas hombre.
 *
 * Es el número que va al informe firmado que GMT le entrega al cliente, así que
 * lo que importa probar no es que la función corra: es que pondere como pondera
 * el informe y que no invente avance donde no hay dato.
 */

describe('avanceSemanal', () => {
  it('pondera por HH, no por cantidad de actividades', () => {
    // Una actividad de 900 HH terminada y una de 100 HH sin empezar dan 90%.
    // Contando actividades daría 50%, que es la respuesta a otra pregunta.
    const r = avanceSemanal(
      [
        { hh: 900, realByWeek: [1] },
        { hh: 100, realByWeek: [0] },
      ],
      1,
    );
    expect(r[0]?.acm).toBeCloseTo(0.9, 5);
  });

  it('los hitos (hh = 0) no pesan', () => {
    // Un hito marca una fecha, no trabajo ejecutado.
    const r = avanceSemanal(
      [
        { hh: 0, realByWeek: [1] },
        { hh: 100, realByWeek: [0.5] },
      ],
      1,
    );
    expect(r[0]?.acm).toBeCloseTo(0.5, 5);
  });

  it('el parcial de la semana es la diferencia contra la anterior', () => {
    const r = avanceSemanal([{ hh: 100, realByWeek: [0.2, 0.5] }], 2);
    expect(r[0]?.par).toBeCloseTo(0.2, 5);
    expect(r[1]?.par).toBeCloseTo(0.3, 5);
  });

  it('una semana sin informe queda en null, no en cero', () => {
    // Cero significa "no se avanzó"; null significa "todavía no hay corte".
    // Confundirlos dibuja una curva que cae a plano en vez de terminar.
    const r = avanceSemanal([{ hh: 100, realByWeek: [0.2] }], 3);
    expect(r[0]?.acm).toBeCloseTo(0.2, 5);
    expect(r[1]?.acm).toBeNull();
    expect(r[2]?.acm).toBeNull();
    expect(r[1]?.par).toBeNull();
  });

  it('sin actividades con HH no inventa un avance', () => {
    expect(avanceSemanal([{ hh: 0, realByWeek: [1] }], 1)[0]?.acm).toBeNull();
    expect(avanceSemanal([], 2)[0]?.acm).toBeNull();
  });

  it('una actividad sin dato en una semana arrastra su último acumulado', () => {
    // Un acumulado no retrocede por no haberlo informado. Si contara como cero,
    // al empezar a cargar S-4 —tocando la primera de 38 actividades— el total
    // del tablero se desplomaría hasta terminar de cargarlas todas, y la que
    // no avanzó y nadie volvió a teclear quedaría en cero para siempre.
    const r = avanceSemanal(
      [
        { hh: 100, realByWeek: [0.5, 0.8] },
        { hh: 100, realByWeek: [0.5] },
      ],
      2,
    );
    expect(r[0]?.acm).toBeCloseTo(0.5, 5);
    // (100×0,8 + 100×0,5) / 200 = 0,65
    expect(r[1]?.acm).toBeCloseTo(0.65, 5);
  });

  it('una actividad que nunca reportó cuenta como cero, no excluye la semana', () => {
    // Siempre hay alguna actividad que todavía no empieza.
    const r = avanceSemanal(
      [
        { hh: 100, realByWeek: [0.6] },
        { hh: 100, realByWeek: [] },
      ],
      1,
    );
    expect(r[0]?.acm).toBeCloseTo(0.3, 5);
  });

  it('admite que el acumulado retroceda', () => {
    // Corregir a la baja un informe anterior es legítimo y no puede reventar.
    const r = avanceSemanal([{ hh: 100, realByWeek: [0.5, 0.4] }], 2);
    expect(r[1]?.par).toBeCloseTo(-0.1, 5);
  });

  it('devuelve exactamente tantas semanas como se le piden', () => {
    expect(avanceSemanal([{ hh: 100, realByWeek: [0.1, 0.2, 0.3] }], 2)).toHaveLength(2);
    expect(avanceSemanal([{ hh: 100, realByWeek: [0.1] }], 5)).toHaveLength(5);
  });

  it('reproduce el informe S-3 del Cierre Perimetral', () => {
    // Prueba de contraste contra un documento firmado: dos actividades que
    // suman 1.000 HH, con el acumulado que deja el proyecto en 23,72%.
    const r = avanceSemanal(
      [
        { hh: 600, realByWeek: [0.23, 0.326, 0.3953] },
        { hh: 400, realByWeek: [0.0, 0.0, 0.0] },
      ],
      4,
    );
    expect(Math.round((r[2]?.acm ?? 0) * 10000) / 100).toBeCloseTo(23.72, 2);
    expect(r[3]?.acm).toBeNull();
  });
});
