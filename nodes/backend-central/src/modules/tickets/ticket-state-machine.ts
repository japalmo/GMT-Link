import { TicketStatus } from '@prisma/client';
import { SANTIAGO_TZ } from '../finance/finance-time.util';

/**
 * Máquina de estados del procedimiento PR-TI-01, como dato puro y testeable.
 * El servicio la consulta; no duplica reglas. Cambiar el procedimiento es
 * cambiar esta tabla, no repartir `if` por el servicio.
 */

/** Quién ejecuta una transición: el área que pidió, o Informática. */
export type TicketActor = 'REQUESTER' | 'IT';

export interface TransitionRule {
  readonly from: TicketStatus;
  readonly to: TicketStatus;
  /** Roles funcionales que pueden ejecutarla. */
  readonly actor: TicketActor;
  /** Exige comentario no vacío (el porqué queda en la bitácora). */
  readonly requiresComment?: boolean;
  /** Exige `lane`, `size` y `priority` ya asignados (aceptar al backlog). */
  readonly requiresClassification?: boolean;
  /** Solo válida si la vía es PROYECTO (la vía rápida no pasa por levantamiento). */
  readonly requiresLaneProyecto?: boolean;
}

/**
 * Las 15 transiciones válidas. Cualquier par (from,to) que no esté acá se
 * rechaza. Ojo con dos reglas que NO son simétricas:
 *  - `EN_BACKLOG → CERRADO` existe porque la vía rápida resuelve dentro de ese
 *    estado, sin pasar por desarrollo.
 *  - Informática NUNCA cierra: `ENTREGADO` y `CERRADO` son del solicitante (un
 *    admin puede hacerlo EN SU NOMBRE, y la bitácora registra quién fue).
 */
export const TRANSITIONS: readonly TransitionRule[] = [
  { from: TicketStatus.BORRADOR, to: TicketStatus.ENVIADO, actor: 'REQUESTER' },
  { from: TicketStatus.ENVIADO, to: TicketStatus.EN_TRIAGE, actor: 'IT' },
  { from: TicketStatus.EN_TRIAGE, to: TicketStatus.REQUIERE_INFO, actor: 'IT', requiresComment: true },
  { from: TicketStatus.REQUIERE_INFO, to: TicketStatus.EN_TRIAGE, actor: 'REQUESTER' },
  { from: TicketStatus.EN_TRIAGE, to: TicketStatus.RECHAZADO, actor: 'IT', requiresComment: true },
  { from: TicketStatus.EN_TRIAGE, to: TicketStatus.EN_BACKLOG, actor: 'IT', requiresClassification: true },
  { from: TicketStatus.EN_BACKLOG, to: TicketStatus.EN_LEVANTAMIENTO, actor: 'IT', requiresLaneProyecto: true },
  { from: TicketStatus.EN_LEVANTAMIENTO, to: TicketStatus.EN_DISENO, actor: 'IT' },
  { from: TicketStatus.EN_DISENO, to: TicketStatus.EN_DESARROLLO, actor: 'IT' },
  { from: TicketStatus.EN_DESARROLLO, to: TicketStatus.EN_QA, actor: 'IT' },
  { from: TicketStatus.EN_QA, to: TicketStatus.EN_DESARROLLO, actor: 'IT', requiresComment: true },
  { from: TicketStatus.EN_QA, to: TicketStatus.EN_UAT, actor: 'IT' },
  { from: TicketStatus.EN_UAT, to: TicketStatus.ENTREGADO, actor: 'REQUESTER' },
  { from: TicketStatus.ENTREGADO, to: TicketStatus.CERRADO, actor: 'REQUESTER' },
  { from: TicketStatus.EN_BACKLOG, to: TicketStatus.CERRADO, actor: 'REQUESTER' },
];

/** La regla para un par (from,to), o `undefined` si la transición no existe. */
export function findTransition(
  from: TicketStatus,
  to: TicketStatus,
): TransitionRule | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

/** Estados a los que se puede ir desde `from` (para pintar solo los botones válidos). */
export function transitionsFrom(from: TicketStatus): readonly TransitionRule[] {
  return TRANSITIONS.filter((t) => t.from === from);
}

/** Estados finales: no sale ninguna transición de ellos. */
export function isTerminal(status: TicketStatus): boolean {
  return transitionsFrom(status).length === 0;
}

// ── SLA de triage ────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Día de la semana en la hora de pared de Chile. Se usa `Intl` con `timeZone`
 * (no un offset fijo) para que el horario de verano se resuelva solo: de noche
 * en Chile ya es el día siguiente en UTC, y con offset fijo un viernes por la
 * tarde se contaría como sábado.
 */
const weekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: SANTIAGO_TZ,
  weekday: 'short',
});

function esFinDeSemana(instant: Date): boolean {
  const wd = weekdayFmt.format(instant);
  return wd === 'Sat' || wd === 'Sun';
}

/**
 * Suma días HÁBILES a un instante. Hábil = de lunes a viernes en Chile; **no se
 * consideran feriados** (decisión de Juan para esta iteración: solo se saltan
 * sábado y domingo). Conserva la hora del día salvo cruce de horario de verano,
 * donde puede correrse una hora; para un plazo de 2 días es irrelevante.
 */
export function addBusinessDays(from: Date, days: number): Date {
  if (days <= 0) return new Date(from.getTime());
  let result = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    result = new Date(result.getTime() + DAY_MS);
    if (!esFinDeSemana(result)) added += 1;
  }
  return result;
}

/** Días hábiles que tiene Informática para tomar un ticket recién enviado. */
export const SLA_TRIAGE_BUSINESS_DAYS = 2;

/**
 * Vencimiento del triage. Se calcula en el SERVIDOR al enviar, nunca en el
 * navegador: el reloj del cliente no es confiable y el plazo sería manipulable.
 */
export function slaTriageDueAt(submittedAt: Date): Date {
  return addBusinessDays(submittedAt, SLA_TRIAGE_BUSINESS_DAYS);
}
