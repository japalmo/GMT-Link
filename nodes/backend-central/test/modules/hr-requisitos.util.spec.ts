import { describe, expect, it } from 'vitest';
import {
  consultaPersonas,
  consultaRequisitos,
  construirTablero,
  habilita,
  requisitosDe,
  type FuentePersona,
} from '../../src/modules/hr/requisitos.util';

/**
 * La tabla de consulta y el tablero responden preguntas de las que depende que
 * alguien entre o no a faena. Estas pruebas cuidan las reglas que son fáciles de
 * romper sin darse cuenta: lo desconocido no habilita, una acreditación no
 * vigente no habilita, y elegir un cliente no hace válida una inducción en todas
 * sus faenas.
 */

// Fechas en hora local, como las lee `diasHasta`.
const HOY = new Date(2026, 8, 14, 10, 0, 0);
const en = (dias: number): Date => new Date(2026, 8, 14 + dias, 0, 0, 0);

function persona(over: Partial<FuentePersona> & { id: string }): FuentePersona {
  return {
    firstName: 'Ana',
    lastName: 'Soto',
    email: `${over.id}@gmt.cl`,
    cargo: 'Maestra',
    isFieldWorker: false,
    turno: null,
    documentos: [],
    examenes: [],
    inducciones: [],
    acreditaciones: [],
    ...over,
  };
}

const CAPSTONE = { clientId: 'cap', clientName: 'Capstone' };

describe('requisitosDe', () => {
  it('una fila por registro, con la vigencia calculada', () => {
    const p = persona({
      id: 'p1',
      examenes: [
        { id: 'e1', type: 'Altura', issuedAt: null, expiresAt: en(-2), noExpiry: false },
        { id: 'e2', type: 'Psico', issuedAt: null, expiresAt: en(10), noExpiry: false },
      ],
    });
    const filas = requisitosDe(p, HOY);
    expect(filas.map((f) => f.vigencia)).toEqual(['VENCIDO', 'POR_VENCER']);
    expect(filas[0]?.key).toBe('EXAMEN:e1');
  });

  it('no expone detalle clínico del examen en la tabla general', () => {
    const p = persona({
      id: 'p1',
      examenes: [{ id: 'e1', type: 'Altura', issuedAt: null, expiresAt: en(5), noExpiry: false }],
    });
    expect(requisitosDe(p, HOY)[0]?.detalle).toBeNull();
  });

  it('distingue "no vence" de "sin fecha cargada"', () => {
    const p = persona({
      id: 'p1',
      documentos: [
        {
          id: 'd1',
          type: 'Cédula',
          name: 'Carnet',
          status: 'APROBADO',
          issuedAt: null,
          expiresAt: null,
          noExpiry: true,
        },
        {
          id: 'd2',
          type: 'Licencia',
          name: 'Licencia',
          status: 'APROBADO',
          issuedAt: null,
          expiresAt: null,
          noExpiry: false,
        },
      ],
    });
    expect(requisitosDe(p, HOY).map((f) => f.vigencia)).toEqual(['SIN_VENCIMIENTO', 'SIN_FECHA']);
  });
});

describe('habilita', () => {
  it('lo desconocido no habilita', () => {
    expect(habilita('SIN_FECHA')).toBe(false);
    expect(habilita('VENCIDO')).toBe(false);
    expect(habilita('SIN_VENCIMIENTO')).toBe(true);
    expect(habilita('POR_VENCER')).toBe(true);
  });
});

describe('consultaRequisitos', () => {
  const conInduccion = persona({
    id: 'p1',
    inducciones: [
      {
        id: 'i1',
        name: 'Hombre nuevo',
        ...CAPSTONE,
        faenas: [{ id: 'mb', name: 'Mantos Blancos' }],
        issuedAt: null,
        expiresAt: en(90),
        noExpiry: false,
      },
    ],
    documentos: [
      {
        id: 'd1',
        type: 'Cédula',
        name: 'Carnet',
        status: 'APROBADO',
        issuedAt: null,
        expiresAt: en(90),
        noExpiry: false,
      },
    ],
  });

  it('una inducción NO vale en una faena del cliente que no se marcó', () => {
    const r = consultaRequisitos(
      [conInduccion],
      { faenaId: 'mv', faenaClientId: 'cap' },
      undefined,
      'asc',
      HOY,
    );
    expect(r.filas).toHaveLength(0);
  });

  it('una acreditación sin faena cubre todas las faenas de su cliente', () => {
    const acreditado = persona({
      id: 'p2',
      acreditaciones: [
        {
          id: 'a1',
          ...CAPSTONE,
          faenaId: null,
          faenaName: null,
          status: 'VIGENTE',
          issuedAt: null,
          expiresAt: en(60),
          noExpiry: false,
        },
      ],
    });
    const r = consultaRequisitos(
      [acreditado],
      { faenaId: 'mv', faenaClientId: 'cap', habilitante: true },
      undefined,
      'asc',
      HOY,
    );
    expect(r.filas).toHaveLength(1);
  });

  it('una acreditación en trámite no habilita aunque tenga fecha futura', () => {
    const enTramite = persona({
      id: 'p3',
      acreditaciones: [
        {
          id: 'a1',
          ...CAPSTONE,
          faenaId: 'mb',
          faenaName: 'MB',
          status: 'EN_TRAMITE',
          issuedAt: null,
          expiresAt: en(60),
          noExpiry: false,
        },
      ],
    });
    const r = consultaRequisitos([enTramite], { habilitante: true }, undefined, 'asc', HOY);
    expect(r.filas).toHaveLength(0);
  });

  it('documentos y exámenes no aparecen al filtrar por cliente', () => {
    const r = consultaRequisitos([conInduccion], { clientId: 'cap' }, undefined, 'asc', HOY);
    expect(r.filas.map((f) => f.tipo)).toEqual(['INDUCCION']);
  });

  it('el rango de vencimiento deja fuera lo que no tiene fecha', () => {
    const sinFecha = persona({
      id: 'p4',
      examenes: [{ id: 'e1', type: 'Altura', issuedAt: null, expiresAt: null, noExpiry: false }],
    });
    const r = consultaRequisitos(
      [sinFecha],
      { desde: '2026-09-01', hasta: '2026-12-31' },
      undefined,
      'asc',
      HOY,
    );
    expect(r.filas).toHaveLength(0);
  });

  it('cuenta personas aparte de registros', () => {
    const dosVencidos = persona({
      id: 'p5',
      examenes: [
        { id: 'e1', type: 'A', issuedAt: null, expiresAt: en(-1), noExpiry: false },
        { id: 'e2', type: 'B', issuedAt: null, expiresAt: en(-5), noExpiry: false },
      ],
    });
    const r = consultaRequisitos([dosVencidos], { vigencias: ['VENCIDO'] }, undefined, 'asc', HOY);
    expect(r.filas).toHaveLength(2);
    expect(r.personas).toBe(1);
  });

  it('ordena por urgencia: lo que lleva más tiempo vencido primero', () => {
    const p = persona({
      id: 'p6',
      examenes: [
        { id: 'e1', type: 'A', issuedAt: null, expiresAt: en(12), noExpiry: false },
        { id: 'e2', type: 'B', issuedAt: null, expiresAt: en(-30), noExpiry: false },
        { id: 'e3', type: 'C', issuedAt: null, expiresAt: en(-2), noExpiry: false },
      ],
    });
    const r = consultaRequisitos([p], {}, 'vigencia', 'asc', HOY);
    expect(r.filas.map((f) => f.id)).toEqual(['e2', 'e3', 'e1']);
  });
});

describe('consultaPersonas', () => {
  const sinNada = persona({
    id: 'p1',
    turno: { shiftPattern: 'SIETE_POR_SIETE', dayNight: 'DIA', workDays: 7, restDays: 7 },
  });
  const conVencido = persona({
    id: 'p2',
    firstName: 'Beto',
    examenes: [{ id: 'e1', type: 'A', issuedAt: null, expiresAt: en(-1), noExpiry: false }],
  });

  it('sin filtros de requisito muestra también a quien no tiene nada cargado', () => {
    const r = consultaPersonas(
      [sinNada, conVencido],
      { turno: 'SIETE_POR_SIETE' },
      undefined,
      'asc',
      HOY,
    );
    expect(r.filas.map((f) => f.userId)).toEqual(['p1']);
  });

  it('con un filtro de requisito, solo quien tiene al menos uno que cumple', () => {
    const r = consultaPersonas(
      [sinNada, conVencido],
      { vigencias: ['VENCIDO'] },
      undefined,
      'asc',
      HOY,
    );
    expect(r.filas.map((f) => f.userId)).toEqual(['p2']);
    expect(r.requisitos).toBe(1);
  });
});

describe('construirTablero', () => {
  it('no cuenta como acreditado a quien tiene la acreditación sin fecha cargada', () => {
    const p = persona({
      id: 'p1',
      acreditaciones: [
        {
          id: 'a1',
          ...CAPSTONE,
          faenaId: null,
          faenaName: null,
          status: 'VIGENTE',
          issuedAt: null,
          expiresAt: null,
          noExpiry: false,
        },
      ],
    });
    const t = construirTablero(
      [p],
      [{ id: 'mb', name: 'Mantos Blancos', ...CAPSTONE }],
      [{ id: 'cap', name: 'Capstone' }],
      HOY,
    );
    expect(t.acreditacionesPorCliente[0]?.personas).toBe(0);
    expect(t.matriz[0]?.acreditados).toBe(0);
  });

  it('informa completitud sin llamarla requisito', () => {
    const t = construirTablero(
      [persona({ id: 'p1', cargo: null }), persona({ id: 'p2' })],
      [],
      [],
      HOY,
    );
    expect(t.completitud).toEqual({ sinTurno: 2, sinCargo: 1 });
    expect(t.requisitos.total).toBe(0);
  });

  it('"Atender primero" trae solo vencido y por vencer, en orden de urgencia', () => {
    const p = persona({
      id: 'p1',
      examenes: [
        { id: 'ok', type: 'A', issuedAt: null, expiresAt: en(200), noExpiry: false },
        { id: 'pronto', type: 'B', issuedAt: null, expiresAt: en(3), noExpiry: false },
        { id: 'vencido', type: 'C', issuedAt: null, expiresAt: en(-4), noExpiry: false },
      ],
    });
    const t = construirTablero([p], [], [], HOY);
    expect(t.atender.map((a) => a.id)).toEqual(['vencido', 'pronto']);
    expect(t.requisitos.personasConVencidos).toBe(1);
  });
});
