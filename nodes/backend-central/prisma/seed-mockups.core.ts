/**
 * Lógica PURA y testeable del seed de usuarios MOCKUP (Fase 1e, spec §6).
 * No crea PrismaClient ni ejecuta efectos al importarse: el entrypoint
 * `seed-mockups.ts` inyecta Prisma y orquesta. Espejo de `seed-admin.core.ts`.
 *
 * ⚠️ Estos son mockups FICTICIOS de prueba (identidades @example.test), solo
 * para validar roles en web-dev. NUNCA cuentas reales (esas viven en Fase 3).
 *
 * RESOLUCIÓN #5 (índice Fase 1, override): `mock_admin_ti` usa el rol REAL
 * `admin_ti` del Plan A (bundle = todo GLOBAL menos beta, SIN FGA admin), NO
 * `org_admin`. Así el owner prueba el bundle `admin_ti` tal cual (sin acceso a
 * gestión de roles, que sí tendría un `org_admin` por su tupla FGA admin).
 */
import { FinanceStatus } from '@prisma/client';

/** ORG id (espejo de src/common/org.constant.ts — ORG_ID = 'gmt'). */
export const ORG_ID = 'gmt';

/** Clave conocida compartida por TODOS los mockups (solo web-dev). */
export const MOCKUP_PASSWORD = 'Mockup2026!';

/** Dominio ficticio reservado — jamás una identidad real. */
export const MOCKUP_EMAIL_DOMAIN = 'example.test';

/**
 * roleKey del superadmin org. Materializa la tupla FGA `admin` sobre la org (por
 * eso ve gestión de roles). NINGÚN mockup lo usa hoy (ver RESOLUCIÓN #5: el
 * "admin TI" usa `admin_ti`), pero el entrypoint conserva el gate por si a
 * futuro se agrega un mockup superadmin.
 */
export const ORG_ADMIN_ROLE = 'org_admin';

/** roleKey del administrador TI (bundle real del Plan A, SIN FGA admin). */
export const ADMIN_TI_ROLE = 'admin_ti';

export interface MockupDef {
  /** username de login (spec §4.2). */
  username: string;
  /** roleKey de la Membership ORGANIZATION (spec §2.3). */
  roleKey: string;
  firstName: string;
  lastName: string;
}

/**
 * 1 mockup por rol (spec §6). username = `mock_<rol>`; email institucional
 * ficticio = `<username>@example.test`. `mock_admin_ti` se materializa con el
 * rol `admin_ti` (RESOLUCIÓN #5), NO `org_admin`.
 */
export const MOCKUPS: readonly MockupDef[] = [
  { username: 'mock_admin_contrato', roleKey: 'admin_contrato', firstName: 'Mock', lastName: 'Admin Contrato' },
  { username: 'mock_trabajador', roleKey: 'trabajador', firstName: 'Mock', lastName: 'Trabajador' },
  { username: 'mock_admin_finanzas', roleKey: 'admin_finanzas', firstName: 'Mock', lastName: 'Admin Finanzas' },
  { username: 'mock_analista_rh', roleKey: 'analista_rh', firstName: 'Mock', lastName: 'Analista RH' },
  { username: 'mock_analista_finanzas', roleKey: 'analista_finanzas', firstName: 'Mock', lastName: 'Analista Finanzas' },
  { username: 'mock_asesor_hse', roleKey: 'asesor_hse', firstName: 'Mock', lastName: 'Asesor HSE' },
  { username: 'mock_gerencia_proyectos', roleKey: 'gerencia_proyectos', firstName: 'Mock', lastName: 'Gerencia Proyectos' },
  { username: 'mock_gerencia_rh', roleKey: 'gerencia_rh', firstName: 'Mock', lastName: 'Gerencia RH' },
  { username: 'mock_gerencia_general', roleKey: 'gerencia_general', firstName: 'Mock', lastName: 'Gerencia General' },
  { username: 'mock_admin_ti', roleKey: ADMIN_TI_ROLE, firstName: 'Mock', lastName: 'Admin TI' },
] as const;

/** Email institucional ficticio del mockup. */
export function mockupEmail(username: string): string {
  return `${username}@${MOCKUP_EMAIL_DOMAIN}`;
}

/**
 * Guard de entorno: los mockups SOLO se siembran con SEED_MOCKUPS activado.
 * NO se gatea por NODE_ENV: `web` y `web-dev` comparten la api prod y la BD
 * (spec Arquitectura), así que gatear por NODE_ENV bloquearía web-dev.
 */
export function isMockupSeedEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SEED_MOCKUPS?.trim().toLowerCase();
  return raw === 'on' || raw === '1' || raw === 'true';
}

// ─────────────────────────────────────────────────────────────────────────────
// Data de juguete para poblar el dashboard de Finanzas (spec §5.2).
// Usa las columnas del esquema actual de Reimbursement/OvertimeRequest (C1 ya
// mergeado): incluye borrador de HE (isDraft) y registro onBehalf.
// projectId/rejectionReason/printedAt quedan fuera (no aportan a las cards/carruseles).
// ─────────────────────────────────────────────────────────────────────────────

/** Estados en los que la solicitud ya fue decidida (llevan decidedBy/decidedAt). */
const DECIDED_STATUSES: ReadonlySet<FinanceStatus> = new Set([
  FinanceStatus.APROBADO,
  FinanceStatus.PAGADO,
  FinanceStatus.RECHAZADO,
]);

/** true si el estado implica una decisión ya tomada (para decidedBy/decidedAt). */
export function isDecidedStatus(status: FinanceStatus): boolean {
  return DECIDED_STATUSES.has(status);
}

interface ReimbursementSample {
  requester: string; // username
  amount: number; // CLP entero
  daysAgo: number; // fecha de la boleta = now - daysAgo
  concept: string;
  category: string;
  status: FinanceStatus;
  decidedBy?: string; // username de quien decidió (obligatorio si status decidido)
}

interface OvertimeSample {
  requester: string; // username del DUEÑO (trabajador cuyas horas son)
  hours: number | null; // null solo en borrador
  daysAgo: number;
  reason: string;
  status: FinanceStatus;
  startTime?: string; // "HH:mm"
  endTime?: string; // "HH:mm"; ausente en borrador
  isDraft?: boolean;
  onBehalfOf?: string; // username de quien la registró a nombre del dueño
  decidedBy?: string;
}

export const REIMBURSEMENT_SAMPLES: readonly ReimbursementSample[] = [
  { requester: 'mock_trabajador', amount: 18990, daysAgo: 2, concept: 'Almuerzo en terreno', category: 'Alimentación', status: FinanceStatus.PENDIENTE },
  { requester: 'mock_trabajador', amount: 32000, daysAgo: 6, concept: 'Bencina camioneta', category: 'Transporte', status: FinanceStatus.APROBADO, decidedBy: 'mock_admin_finanzas' },
  { requester: 'mock_trabajador', amount: 12500, daysAgo: 25, concept: 'Peaje ruta 5', category: 'Transporte', status: FinanceStatus.PAGADO, decidedBy: 'mock_admin_finanzas' },
  { requester: 'mock_analista_rh', amount: 45990, daysAgo: 3, concept: 'Materiales de oficina', category: 'Otro', status: FinanceStatus.PENDIENTE },
  { requester: 'mock_asesor_hse', amount: 78000, daysAgo: 10, concept: 'Repuesto de EPP', category: 'Otro', status: FinanceStatus.APROBADO, decidedBy: 'mock_admin_finanzas' },
  { requester: 'mock_asesor_hse', amount: 54500, daysAgo: 18, concept: 'Arriendo de andamio', category: 'Otro', status: FinanceStatus.PAGADO, decidedBy: 'mock_admin_finanzas' },
  { requester: 'mock_admin_contrato', amount: 9990, daysAgo: 1, concept: 'Café reunión con cliente', category: 'Alimentación', status: FinanceStatus.RECHAZADO, decidedBy: 'mock_admin_finanzas' },
];

export const OVERTIME_SAMPLES: readonly OvertimeSample[] = [
  { requester: 'mock_trabajador', hours: 2.5, daysAgo: 1, reason: 'Cierre de avance mensual', status: FinanceStatus.PENDIENTE, startTime: '18:00', endTime: '20:30' },
  { requester: 'mock_trabajador', hours: 3, daysAgo: 8, reason: 'Emergencia en faena', status: FinanceStatus.APROBADO, startTime: '19:00', endTime: '22:00', decidedBy: 'mock_admin_contrato' },
  { requester: 'mock_analista_rh', hours: 1.5, daysAgo: 22, reason: 'Carga de datos de RH', status: FinanceStatus.PENDIENTE, startTime: '18:30', endTime: '20:00' },
  { requester: 'mock_asesor_hse', hours: 4, daysAgo: 15, reason: 'Auditoría HSE nocturna', status: FinanceStatus.APROBADO, startTime: '20:00', endTime: '00:00', decidedBy: 'mock_gerencia_proyectos' },
  { requester: 'mock_admin_contrato', hours: 2, daysAgo: 30, reason: 'Revisión de contratos', status: FinanceStatus.RECHAZADO, startTime: '18:00', endTime: '20:00', decidedBy: 'mock_gerencia_proyectos' },
  // Borrador de HE: sin término ni horas, siempre PENDIENTE (no aprobable hasta cerrarlo).
  { requester: 'mock_trabajador', hours: null, daysAgo: 0, reason: 'Turno en curso (borrador)', status: FinanceStatus.PENDIENTE, startTime: '18:00', isDraft: true },
  // Registrada a nombre del dueño (onBehalf): el admin_contrato la carga por el trabajador.
  { requester: 'mock_trabajador', hours: 3.5, daysAgo: 4, reason: 'Sobretiempo cargado por administración', status: FinanceStatus.PENDIENTE, startTime: '18:00', endTime: '21:30', onBehalfOf: 'mock_admin_contrato' },
];

export interface BuiltReimbursement {
  userId: string;
  amount: number;
  date: Date;
  concept: string;
  category: string;
  status: FinanceStatus;
  decidedById: string | null;
  decidedAt: Date | null;
}

export interface BuiltOvertime {
  userId: string;
  date: Date;
  startTime: string | null;
  endTime: string | null;
  hours: number | null;
  isDraft: boolean;
  reason: string;
  status: FinanceStatus;
  onBehalfOfUserId: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateDaysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Resuelve un username→id o lanza (defensivo: el mapa debe traer todos los mockups). */
function requireId(idByUsername: ReadonlyMap<string, string>, username: string): string {
  const id = idByUsername.get(username);
  if (id === undefined) {
    throw new Error(
      `Mockup sin id resuelto: "${username}". ¿Se sembraron los usuarios antes que la data de finanzas?`,
    );
  }
  return id;
}

/** Fecha de decisión: un día después de la boleta (nunca en el futuro respecto de now). */
function decidedAtFor(now: Date, daysAgo: number, decided: boolean): Date | null {
  return decided ? dateDaysAgo(now, Math.max(0, daysAgo - 1)) : null;
}

export function buildReimbursements(
  idByUsername: ReadonlyMap<string, string>,
  now: Date,
): BuiltReimbursement[] {
  return REIMBURSEMENT_SAMPLES.map((s) => {
    const decided = DECIDED_STATUSES.has(s.status);
    return {
      userId: requireId(idByUsername, s.requester),
      amount: s.amount,
      date: dateDaysAgo(now, s.daysAgo),
      concept: s.concept,
      category: s.category,
      status: s.status,
      decidedById: decided && s.decidedBy ? requireId(idByUsername, s.decidedBy) : null,
      decidedAt: decidedAtFor(now, s.daysAgo, decided),
    };
  });
}

export function buildOvertime(
  idByUsername: ReadonlyMap<string, string>,
  now: Date,
): BuiltOvertime[] {
  return OVERTIME_SAMPLES.map((s) => {
    const decided = DECIDED_STATUSES.has(s.status);
    const isDraft = s.isDraft ?? false;
    return {
      userId: requireId(idByUsername, s.requester),
      date: dateDaysAgo(now, s.daysAgo),
      startTime: s.startTime ?? null,
      endTime: s.endTime ?? null,
      hours: s.hours,
      isDraft,
      reason: s.reason,
      status: s.status,
      onBehalfOfUserId: s.onBehalfOf ? requireId(idByUsername, s.onBehalfOf) : null,
      decidedById: decided && s.decidedBy ? requireId(idByUsername, s.decidedBy) : null,
      decidedAt: decidedAtFor(now, s.daysAgo, decided),
    };
  });
}
