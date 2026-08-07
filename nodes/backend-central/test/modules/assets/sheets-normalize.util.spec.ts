import { describe, expect, it } from 'vitest';

import {
  normalizarBooleano,
  normalizarEstado,
  normalizarFecha,
  normalizarNombre,
  normalizarNumero,
  normalizarPatente,
  normalizarTexto,
} from '../../../src/modules/assets/sheets-normalize.util';

/**
 * Los casos NO son inventados: salen de correr el normalizador contra los 2.137
 * registros reales de la planilla. Dejarlos escritos evita que una "mejora"
 * futura vuelva a romper lo que ya se resolvió.
 */

describe('normalizarPatente', () => {
  it('unifica las cuatro escrituras de la misma patente', () => {
    // En la planilla SKRF88 aparece de estas formas. Sin unificarlas, un mismo
    // vehículo se ve como cuatro y su kilometraje queda partido.
    for (const variante of ['SKRF88', 'SK RF 88', 'SKRF-88', 'skrf88', ' SKRF88 ']) {
      expect(normalizarPatente(variante), variante).toBe('SKRF88');
    }
  });

  it('rescata la patente envuelta en una frase', () => {
    expect(normalizarPatente('FURGÓN SURAY 17 PASAJEROS PATENTE VHBC 22')).toBe('VHBC22');
    expect(normalizarPatente('FURGÓN SURAY PATENTE VHBC-22')).toBe('VHBC22');
  });

  it('acepta el formato antiguo de dos letras y cuatro dígitos', () => {
    expect(normalizarPatente('SR-1234')).toBe('SR1234');
  });

  it('descarta lo que no es una patente en vez de inventar una', () => {
    // Un checklist atribuido al vehículo equivocado es PEOR que uno sin
    // vehículo: ensucia el kilometraje de una camioneta que sí existe.
    for (const basura of ['Prueba', 'PRUEBA', 'N/A', '', '   ', 'sin patente']) {
      expect(normalizarPatente(basura), basura).toBeNull();
    }
    expect(normalizarPatente(null)).toBeNull();
    expect(normalizarPatente(undefined)).toBeNull();
  });

  it('NO corrige lo que solo se parece a otra patente', () => {
    // `SIRF88` tiene 2 checklists y `SKRF88` tiene 471: es casi seguro un tipeo,
    // pero adivinarlo sería atribuirle uso a un vehículo por corazonada. Se deja
    // pasar tal cual y que una persona decida.
    expect(normalizarPatente('SIRF88')).toBe('SIRF88');
    expect(normalizarPatente('TBFG42')).toBe('TBFG42');
  });
});

describe('normalizarFecha', () => {
  it('lee el formato chileno con el DÍA primero', () => {
    // Leerlo al revés movería el registro casi un mes sin que nadie lo note.
    const d = normalizarFecha('14/05/2025 9:34:27')!;
    expect(d.getDate()).toBe(14);
    expect(d.getMonth()).toBe(4); // mayo
    expect(d.getFullYear()).toBe(2025);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(34);
  });

  it('distingue el día del mes en una fecha ambigua', () => {
    const d = normalizarFecha('05/06/2025')!;
    expect(d.getDate()).toBe(5);
    expect(d.getMonth()).toBe(5); // junio
  });

  it('acepta ISO y el número de serie de la hoja de cálculo', () => {
    expect(normalizarFecha('2025-05-14T09:34:27.000Z')?.getUTCFullYear()).toBe(2025);
    expect(normalizarFecha(45791)?.getUTCFullYear()).toBe(2025);
  });

  it('devuelve null en vez de una fecha inventada', () => {
    // La serie del odómetro se ordena por fecha: una inventada la desordenaría.
    for (const basura of ['', 'ayer', 'no aplica', null, undefined, 0, 9_999_999]) {
      expect(normalizarFecha(basura), String(basura)).toBeNull();
    }
  });
});

describe('normalizarNumero', () => {
  it('acepta el número puro y el texto', () => {
    expect(normalizarNumero(103699)).toBe(103699);
    expect(normalizarNumero('103699')).toBe(103699);
    expect(normalizarNumero(' 103699 ')).toBe(103699);
  });

  it('entiende el formato chileno de miles y decimales', () => {
    expect(normalizarNumero('103.699')).toBe(103699);
    expect(normalizarNumero('1.234,5')).toBe(1234.5);
  });

  it('devuelve null para lo que no es número', () => {
    for (const basura of ['', 'no sé', null, undefined]) {
      expect(normalizarNumero(basura), String(basura)).toBeNull();
    }
  });
});

describe('normalizarEstado', () => {
  it('reconoce los estados con cualquier escritura', () => {
    expect(normalizarEstado('bueno')).toBe('Bueno');
    expect(normalizarEstado('  REGULAR ')).toBe('Regular');
    expect(normalizarEstado('Malo')).toBe('Malo');
  });

  it('acepta los niveles de AdBlue, incluidas las fracciones', () => {
    // "1/4" aparece 17 veces en los datos reales; sin esto esos ítems quedaban
    // sin responder.
    expect(normalizarEstado('1/4')).toBe('1/4');
    expect(normalizarEstado('Lleno')).toBe('Lleno');
    expect(normalizarEstado('N/A')).toBe('N/A');
  });

  it('devuelve null ante un valor que la plantilla no declara', () => {
    // Guardarlo igual dejaría una respuesta que después no calza con ninguna
    // opción del formulario.
    expect(normalizarEstado('excelente')).toBeNull();
    expect(normalizarEstado('')).toBeNull();
  });
});

describe('normalizarBooleano', () => {
  it('entiende las formas de sí y de no que trae la planilla', () => {
    for (const si of ['Si', 'SI', 'sí', 'true', 'VERDADERO', '1', true]) {
      expect(normalizarBooleano(si), String(si)).toBe(true);
    }
    for (const no of ['No', 'NO', 'false', 'FALSO', '0', false]) {
      expect(normalizarBooleano(no), String(no)).toBe(false);
    }
  });

  it('devuelve null ante cualquier otra cosa', () => {
    expect(normalizarBooleano('quizás')).toBeNull();
    expect(normalizarBooleano('')).toBeNull();
    expect(normalizarBooleano(null)).toBeNull();
  });
});

describe('normalizarTexto y normalizarNombre', () => {
  it('colapsa espacios y trata el vacío como ausencia', () => {
    expect(normalizarTexto('  Piquete   en  parabrisas ')).toBe('Piquete en parabrisas');
    expect(normalizarTexto('   ')).toBeNull();
    expect(normalizarTexto('')).toBeNull();
  });

  it('deja los nombres con inicial mayúscula sin tocar las partículas', () => {
    expect(normalizarNombre('  jordan   sepulveda ')).toBe('Jordan Sepulveda');
    expect(normalizarNombre('JOSE FUENTES')).toBe('Jose Fuentes');
    expect(normalizarNombre('maria de los angeles')).toBe('Maria de los Angeles');
  });
});
