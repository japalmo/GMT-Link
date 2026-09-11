import { describe, expect, it } from 'vitest';
import {
  DIAS_POR_VENCER,
  esAlerta,
  estadoDe,
  horasEntre,
  porUrgencia,
} from '../../src/modules/hr/vigencia.util';
import { AVISO_TEMPRANO_DIAS } from '../../src/modules/assets/expiry-notices.util';

/**
 * La vigencia decide si alguien puede entrar a faena, así que las fechas límite
 * se prueban una por una. Lo que más importa acá es la distinción entre "no
 * vence" y "no le cargaron la fecha": confundirlas haría pasar un dato faltante
 * por uno tranquilizador.
 */

// Fechas en hora LOCAL, que es como `diasHasta` las lee (getFullYear/getMonth/
// getDate). Construirlas en UTC haría que la prueba pasara en un servidor UTC y
// fallara en Chile por el desfase, que es justo el error que hay que evitar.
const HOY = new Date(2026, 8, 11, 14, 0, 0);
const enDias = (n: number): Date => new Date(2026, 8, 11 + n, 0, 0, 0);

describe('estadoDe', () => {
  it('usa la MISMA ventana de aviso que la documentación de vehículos', () => {
    // Dos umbrales distintos para "¿está por vencer?" serían una trampa para
    // quien mira los dos tableros de la plataforma.
    expect(DIAS_POR_VENCER).toBe(AVISO_TEMPRANO_DIAS);
  });

  it('distingue un requisito que no vence de uno sin fecha cargada', () => {
    expect(estadoDe(null, HOY, false).vigencia).toBe('SIN_VENCIMIENTO');
    expect(estadoDe(null, HOY, true).vigencia).toBe('SIN_FECHA');
  });

  it('marca vencido lo que ya pasó', () => {
    const e = estadoDe(enDias(-1), HOY);
    expect(e.vigencia).toBe('VENCIDO');
    expect(e.diasRestantes).toBe(-1);
  });

  it('lo que vence HOY todavía no está vencido', () => {
    // Un examen que vence hoy sirve hoy. Tratarlo como vencido dejaría a alguien
    // fuera de faena un día antes de lo que dice su papel.
    const e = estadoDe(enDias(0), HOY);
    expect(e.vigencia).toBe('POR_VENCER');
    expect(e.diasRestantes).toBe(0);
  });

  it('el borde de los 30 días cae del lado de "por vencer"', () => {
    expect(estadoDe(enDias(30), HOY).vigencia).toBe('POR_VENCER');
    expect(estadoDe(enDias(31), HOY).vigencia).toBe('VIGENTE');
  });

  it('no depende de la hora del día en que se consulte', () => {
    const manana = new Date(2026, 8, 11, 3, 0, 0);
    const noche = new Date(2026, 8, 11, 23, 30, 0);
    expect(estadoDe(enDias(5), manana)).toEqual(estadoDe(enDias(5), noche));
  });
});

describe('esAlerta', () => {
  it('alerta solo lo vencido y lo próximo', () => {
    expect(esAlerta(estadoDe(enDias(-3), HOY))).toBe(true);
    expect(esAlerta(estadoDe(enDias(10), HOY))).toBe(true);
    expect(esAlerta(estadoDe(enDias(90), HOY))).toBe(false);
    // Sin fecha NO es alerta de vencimiento: es un dato que falta, y mezclarlo
    // con lo vencido enterraría lo que de verdad está fuera de plazo.
    expect(esAlerta(estadoDe(null, HOY))).toBe(false);
    expect(esAlerta(estadoDe(null, HOY, false))).toBe(false);
  });
});

describe('porUrgencia', () => {
  it('ordena primero lo que lleva más tiempo vencido', () => {
    const alertas = [
      estadoDe(enDias(12), HOY),
      estadoDe(enDias(-30), HOY),
      estadoDe(enDias(-2), HOY),
      estadoDe(enDias(0), HOY),
    ].sort(porUrgencia);
    expect(alertas.map((a) => a.diasRestantes)).toEqual([-30, -2, 0, 12]);
  });

  it('lo que no tiene fecha va al final', () => {
    const orden = [estadoDe(null, HOY), estadoDe(enDias(-1), HOY)].sort(porUrgencia);
    expect(orden[0]?.diasRestantes).toBe(-1);
  });
});

describe('horasEntre', () => {
  it('cuenta las horas de un registro cerrado', () => {
    expect(
      horasEntre(new Date('2026-09-11T08:00:00Z'), new Date('2026-09-11T16:30:00Z')),
    ).toBe(8.5);
  });

  it('un registro abierto vale 0', () => {
    // Contarlo hasta "ahora" haría que el mismo período diera distinto según
    // cuándo se mire el gráfico. Los abiertos se informan aparte.
    expect(horasEntre(new Date('2026-09-11T08:00:00Z'), null)).toBe(0);
  });

  it('un cierre anterior al inicio no resta horas', () => {
    expect(
      horasEntre(new Date('2026-09-11T16:00:00Z'), new Date('2026-09-11T08:00:00Z')),
    ).toBe(0);
  });
});
