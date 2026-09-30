import { TicketStatus } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  TRANSITIONS,
  addBusinessDays,
  findTransition,
  isTerminal,
  slaTriageDueAt,
  transitionsFrom,
} from '../../src/modules/tickets/ticket-state-machine';

/**
 * La máquina de estados es el corazón del procedimiento PR-TI-01: si acepta una
 * transición que el procedimiento no permite, el registro deja de ser confiable.
 * Por eso se prueba la tabla completa, no una muestra.
 */
describe('máquina de estados de tickets', () => {
  it('acepta exactamente las 15 transiciones del procedimiento', () => {
    expect(TRANSITIONS).toHaveLength(15);
  });

  it('no declara transiciones duplicadas para el mismo par (from,to)', () => {
    const pares = TRANSITIONS.map((t) => `${t.from}->${t.to}`);
    expect(new Set(pares).size).toBe(pares.length);
  });

  it('ninguna transición sale y llega al mismo estado', () => {
    expect(TRANSITIONS.filter((t) => t.from === t.to)).toEqual([]);
  });

  it('rechaza saltos que el procedimiento no contempla', () => {
    // Saltarse el triage, o revivir un rechazo, no son transiciones válidas.
    expect(findTransition(TicketStatus.ENVIADO, TicketStatus.EN_DESARROLLO)).toBeUndefined();
    expect(findTransition(TicketStatus.ENVIADO, TicketStatus.CERRADO)).toBeUndefined();
    expect(findTransition(TicketStatus.RECHAZADO, TicketStatus.EN_TRIAGE)).toBeUndefined();
    expect(findTransition(TicketStatus.BORRADOR, TicketStatus.EN_TRIAGE)).toBeUndefined();
  });

  it('Informática NUNCA cierra: entregar y cerrar son del solicitante', () => {
    const entregar = findTransition(TicketStatus.EN_UAT, TicketStatus.ENTREGADO);
    const cerrar = findTransition(TicketStatus.ENTREGADO, TicketStatus.CERRADO);
    const cerrarRapida = findTransition(TicketStatus.EN_BACKLOG, TicketStatus.CERRADO);
    expect(entregar?.actor).toBe('REQUESTER');
    expect(cerrar?.actor).toBe('REQUESTER');
    expect(cerrarRapida?.actor).toBe('REQUESTER');
  });

  it('exige comentario donde el procedimiento pide justificar', () => {
    expect(
      findTransition(TicketStatus.EN_TRIAGE, TicketStatus.REQUIERE_INFO)?.requiresComment,
    ).toBe(true);
    expect(findTransition(TicketStatus.EN_TRIAGE, TicketStatus.RECHAZADO)?.requiresComment).toBe(
      true,
    );
    expect(findTransition(TicketStatus.EN_QA, TicketStatus.EN_DESARROLLO)?.requiresComment).toBe(
      true,
    );
  });

  it('aceptar al backlog exige la clasificación completa', () => {
    const aceptar = findTransition(TicketStatus.EN_TRIAGE, TicketStatus.EN_BACKLOG);
    expect(aceptar?.requiresClassification).toBe(true);
  });

  it('solo la vía PROYECTO pasa por levantamiento', () => {
    const rule = findTransition(TicketStatus.EN_BACKLOG, TicketStatus.EN_LEVANTAMIENTO);
    expect(rule?.requiresLaneProyecto).toBe(true);
  });

  it('la vía rápida cierra desde el backlog sin pasar por desarrollo', () => {
    expect(findTransition(TicketStatus.EN_BACKLOG, TicketStatus.CERRADO)).toBeDefined();
  });

  it('RECHAZADO y CERRADO son terminales; el resto no', () => {
    expect(isTerminal(TicketStatus.RECHAZADO)).toBe(true);
    expect(isTerminal(TicketStatus.CERRADO)).toBe(true);
    expect(isTerminal(TicketStatus.EN_TRIAGE)).toBe(false);
    expect(isTerminal(TicketStatus.BORRADOR)).toBe(false);
  });

  it('desde EN_TRIAGE ofrece las tres salidas del procedimiento', () => {
    const destinos = transitionsFrom(TicketStatus.EN_TRIAGE)
      .map((t) => t.to)
      .sort();
    expect(destinos).toEqual(
      [TicketStatus.EN_BACKLOG, TicketStatus.RECHAZADO, TicketStatus.REQUIERE_INFO].sort(),
    );
  });

  it('todo estado no terminal es alcanzable desde BORRADOR', () => {
    // Recorrido en anchura: detecta un estado huérfano que nadie puede alcanzar.
    const alcanzados = new Set<TicketStatus>([TicketStatus.BORRADOR]);
    const cola: TicketStatus[] = [TicketStatus.BORRADOR];
    while (cola.length > 0) {
      const actual = cola.shift() as TicketStatus;
      for (const t of transitionsFrom(actual)) {
        if (!alcanzados.has(t.to)) {
          alcanzados.add(t.to);
          cola.push(t.to);
        }
      }
    }
    const todos = Object.values(TicketStatus);
    expect([...alcanzados].sort()).toEqual([...todos].sort());
  });
});

/**
 * Día calendario de Chile de un instante. Las aserciones van SIEMPRE contra esta
 * fecha y no contra `toISOString()`, porque el plazo que el usuario ve es el de
 * pared chileno: de noche en Chile la fecha UTC ya avanzó un día, y comparar en
 * UTC hace que una prueba correcta parezca fallar (o peor, que una incorrecta pase).
 */
const fechaChile = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

describe('SLA de triage en días hábiles', () => {
  it('de lunes salta al miércoles', () => {
    // 2026-09-07 es lunes.
    const lunes = new Date('2026-09-07T15:00:00Z');
    expect(fechaChile(slaTriageDueAt(lunes))).toBe('2026-09-09');
  });

  it('de jueves cruza el fin de semana y cae el lunes', () => {
    // Jueves 10: +2 hábiles = viernes 11 y lunes 14 (sáb 12 y dom 13 no cuentan).
    const jueves = new Date('2026-09-10T15:00:00Z');
    expect(fechaChile(slaTriageDueAt(jueves))).toBe('2026-09-14');
  });

  it('de viernes cae el martes siguiente', () => {
    const viernes = new Date('2026-09-11T15:00:00Z');
    expect(fechaChile(slaTriageDueAt(viernes))).toBe('2026-09-15');
  });

  it('un envío del sábado también salta el domingo', () => {
    // Sábado 12: los hábiles siguientes son lunes 14 y martes 15.
    const sabado = new Date('2026-09-12T15:00:00Z');
    expect(fechaChile(slaTriageDueAt(sabado))).toBe('2026-09-15');
  });

  it('no cuenta sábados ni domingos como hábiles', () => {
    const viernes = new Date('2026-09-11T15:00:00Z');
    // Un solo día hábil desde el viernes es el lunes, no el sábado.
    expect(fechaChile(addBusinessDays(viernes, 1))).toBe('2026-09-14');
  });

  it('sumar cero o menos no mueve la fecha, y no muta el original', () => {
    const base = new Date('2026-09-07T15:00:00Z');
    const copia = new Date(base.getTime());
    expect(addBusinessDays(base, 0).getTime()).toBe(base.getTime());
    expect(base.getTime()).toBe(copia.getTime());
  });

  it('cuenta el día de pared de Chile, no el de UTC', () => {
    // Domingo 13 a las 23:00 en Santiago = lunes 14 a las 02:00 UTC. Si contara
    // en UTC partiría de un lunes y daría miércoles; contando en Chile parte del
    // domingo, así que los dos hábiles son lunes 14 y martes 15.
    const domingoNocheChile = new Date('2026-09-14T02:00:00Z');
    expect(fechaChile(domingoNocheChile)).toBe('2026-09-13'); // en Chile aún es domingo
    expect(fechaChile(slaTriageDueAt(domingoNocheChile))).toBe('2026-09-15');
  });
});
