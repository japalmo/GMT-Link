import { describe, expect, it } from 'vitest';
import {
  claseDeLicencia,
  construirDatosConductor,
} from '../../../src/modules/assets/checklist-conductor.util';
import { construirFormato } from '../../../src/modules/assets/checklist-formato.builder';

describe('claseDeLicencia', () => {
  it('lee la clase cuando viene rotulada', () => {
    expect(claseDeLicencia('Licencia de conducir clase B')).toBe('B');
    expect(claseDeLicencia('LICENCIA MUNICIPAL CLASE: A4')).toBe('A4');
    expect(claseDeLicencia('licencia - clase a2 vigente')).toBe('A2');
  });

  it('acepta las profesionales sueltas, que son inconfundibles', () => {
    expect(claseDeLicencia('Licencia A5 sustancias peligrosas')).toBe('A5');
  });

  it('NO confunde una inicial con una clase', () => {
    // El caso que motiva la regla: acá la "B" es la inicial del apellido.
    expect(claseDeLicencia('Licencia de conducir - Juan B. Pérez')).toBeNull();
  });

  it('devuelve null cuando no hay clase, en vez de inventarla', () => {
    expect(claseDeLicencia('Licencia de conducir')).toBeNull();
    expect(claseDeLicencia('')).toBeNull();
  });
});

/**
 * El bloque "datos del conductor" del PDF, que hasta ahora salía vacío.
 *
 * OJO: acá NO va el nombre. El generador del PDF ya lo antepone al bloque
 * (`{ etiqueta: 'Nombre del conductor:', valor: data.conductor }`); devolverlo
 * también desde acá lo imprimiría dos veces.
 */

const d = (iso: string): Date => new Date(`${iso}T12:00:00Z`);

/**
 * "Hoy" fijo en todas las pruebas.
 *
 * Sin esto el resultado depende del reloj de quien las corra: una fecha que hoy
 * es futura deja de serlo, y la prueba empieza a fallar sola meses después.
 */
const HOY = d('2026-09-28');

describe('construirDatosConductor', () => {
  it('usa las fechas de RRHH cuando el checklist no declara nada', () => {
    expect(
      construirDatosConductor({
        licenciaPerfil: { clase: 'B', vence: d('2028-08-14') },
        acreditacionFaena: { vence: d('2027-08-14') },
        declarado: null,
        hoy: HOY,
      }),
    ).toEqual([
      { etiqueta: 'Licencia municipal:', valor: 'Clase B', vencimiento: '14-08-2028' },
      { etiqueta: 'Licencia interna:', valor: 'Sí', vencimiento: '14-08-2027' },
    ]);
  });

  it('lo declarado al firmar manda sobre lo que dice RRHH', () => {
    // Quien firma responde por lo que declara: si corrigió el dato en el
    // formulario, el documento tiene que mostrar eso y no el registro viejo.
    const filas = construirDatosConductor({
      licenciaPerfil: { clase: 'B', vence: d('2028-08-14') },
      acreditacionFaena: { vence: d('2026-08-14') },
      declarado: { clase: 'A4', vence: d('2030-01-31'), interna: d('2027-03-15') },
      hoy: HOY,
    });
    expect(filas[0]).toEqual({
      etiqueta: 'Licencia municipal:',
      valor: 'Clase A4',
      vencimiento: '31-01-2030',
    });
    expect(filas[1]).toEqual({
      etiqueta: 'Licencia interna:',
      valor: 'Sí',
      vencimiento: '15-03-2027',
    });
  });

  it('un campo declarado vacío NO borra el dato de RRHH', () => {
    // El formulario manda los campos que tiene; que uno venga nulo significa
    // "no lo toqué", no "bórralo".
    const filas = construirDatosConductor({
      licenciaPerfil: { clase: 'B', vence: d('2028-08-14') },
      acreditacionFaena: null,
      declarado: { clase: null, vence: null, interna: d('2027-03-15') },
      hoy: HOY,
    });
    expect(filas[0]?.vencimiento).toBe('14-08-2028');
    expect(filas[0]?.valor).toBe('Clase B');
  });

  it('sin ningún dato lo DICE, en vez de dejar la celda en blanco', () => {
    // Una celda vacía en un documento que se firma se lee como "estaba todo
    // bien". Tiene que decir que no hay registro.
    expect(
      construirDatosConductor({
        licenciaPerfil: null,
        acreditacionFaena: null,
        declarado: null,
        hoy: HOY,
      }),
    ).toEqual([
      { etiqueta: 'Licencia municipal:', valor: 'No registrada' },
      { etiqueta: 'Licencia interna:', valor: 'No registrada' },
    ]);
  });

  it('con fecha pero sin clase dice que la hay, sin inventar la clase', () => {
    const filas = construirDatosConductor({
      licenciaPerfil: { clase: null, vence: d('2028-08-14') },
      acreditacionFaena: null,
      declarado: null,
      hoy: HOY,
    });
    expect(filas[0]).toEqual({
      etiqueta: 'Licencia municipal:',
      valor: 'Sí',
      vencimiento: '14-08-2028',
    });
  });

  it('marca la licencia vencida en vez de mostrar la fecha a secas', () => {
    // Que el documento muestre "14-08-2020" y nada más obliga al lector a hacer
    // la resta. Si venció, el PDF lo dice.
    const filas = construirDatosConductor({
      licenciaPerfil: { clase: 'B', vence: d('2020-08-14') },
      acreditacionFaena: null,
      declarado: null,
      hoy: HOY,
    });
    expect(filas[0]?.valor).toBe('Clase B · VENCIDA');
    expect(filas[0]?.vencimiento).toBe('14-08-2020');
  });

  it('no marca como vencida una licencia que vence hoy', () => {
    const filas = construirDatosConductor({
      licenciaPerfil: { clase: 'B', vence: d('2026-09-28') },
      acreditacionFaena: null,
      declarado: null,
      hoy: HOY,
    });
    expect(filas[0]?.valor).toBe('Clase B');
  });
});

describe('cableado con el formato', () => {
  it('las licencias llegan al bloque que el PDF reserva', async () => {
    // El util puede estar perfecto y el bloque salir vacío igual si nadie se lo
    // pasa al builder: durante meses `datosConductor` fue `[]` fijo.
    const filas = construirDatosConductor({
      licenciaPerfil: { clase: 'B', vence: d('2028-08-14') },
      acreditacionFaena: null,
      declarado: null,
      hoy: HOY,
    });
    const formato = construirFormato({
      proyecto: 'Mantos Blancos',
      fecha: HOY,
      conductor: 'Yerko Jara',
      origen: null,
      patente: 'SKRF88',
      items: [],
      answers: [],
      documentos: [],
      datosConductor: filas,
    });
    expect(formato.datosConductor).toEqual(filas);
  });

  it('sin licencias el bloque queda vacío y no revienta', () => {
    expect(
      construirDatosConductor({
        licenciaPerfil: null,
        acreditacionFaena: null,
        declarado: null,
        hoy: HOY,
      }),
    ).toHaveLength(2);
  });
});
