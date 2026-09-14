import type {
  HrDashboard,
  HrPersonRow,
  HrRequirementRow,
  HrRequisitoTipo,
  HrTurnoKey,
  HrVigencia,
} from '@gmt-platform/contracts';
import { DIAS_POR_VENCER, estadoDe } from './vigencia.util';

/**
 * Tabla de consulta y tablero de RRHH, como cálculo PURO sobre las personas ya
 * cargadas. Sin Prisma: las reglas de "qué habilita" y "qué coincide con el
 * filtro" son las que deciden si alguien entra a faena, y así se prueban con
 * datos fijos.
 *
 * Tres reglas que atraviesan todo el archivo:
 *
 *  1. Nada es obligatorio. No existe una regla que diga qué exige cada faena, así
 *     que acá nunca se calcula un "falta": solo vencido, por vencer y sin fecha
 *     de lo que está cargado.
 *  2. Lo desconocido no habilita. Un requisito sin fecha de vencimiento cargada
 *     NO cuenta como vigente, aunque su estado diga otra cosa.
 *  3. Una acreditación habilita solo si el cliente la dio por VIGENTE y además no
 *     está vencida. En trámite, suspendida o rechazada no habilitan a nadie.
 */

// ── Fuentes ─────────────────────────────────────────────────────────────────

interface FuenteBase {
  id: string;
  issuedAt: Date | null;
  expiresAt: Date | null;
  noExpiry: boolean;
}

export interface FuenteDocumento extends FuenteBase {
  type: string;
  name: string;
  status: string;
}

export interface FuenteExamen extends FuenteBase {
  type: string;
}

export interface FuenteInduccion extends FuenteBase {
  name: string;
  clientId: string;
  clientName: string;
  faenas: Array<{ id: string; name: string }>;
}

export interface FuenteAcreditacion extends FuenteBase {
  clientId: string;
  clientName: string;
  faenaId: string | null;
  faenaName: string | null;
  status: string;
}

export interface FuenteTurno {
  shiftPattern: string;
  dayNight: string;
  workDays: number | null;
  restDays: number | null;
}

export interface FuentePersona {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  cargo: string | null;
  isFieldWorker: boolean;
  turno: FuenteTurno | null;
  documentos: FuenteDocumento[];
  examenes: FuenteExamen[];
  inducciones: FuenteInduccion[];
  acreditaciones: FuenteAcreditacion[];
}

export interface FuenteFaena {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
}

// ── Filtros ─────────────────────────────────────────────────────────────────

export interface FiltrosRrhh {
  search?: string;
  turno?: HrTurnoKey;
  sinCargo?: boolean;
  clientId?: string;
  faenaId?: string;
  /** Cliente de la faena filtrada: lo resuelve el servicio. */
  faenaClientId?: string;
  tipos?: HrRequisitoTipo[];
  vigencias?: HrVigencia[];
  /** Solo los que habilitan hoy (regla 2 y 3). */
  habilitante?: boolean;
  /** Rango de vencimiento, aaaa-mm-dd inclusive. */
  desde?: string;
  hasta?: string;
}

const TIPOS: readonly HrRequisitoTipo[] = ['DOCUMENTO', 'EXAMEN', 'INDUCCION', 'ACREDITACION'];

const ORDEN_VIGENCIA: Record<HrVigencia, number> = {
  VENCIDO: 0,
  POR_VENCER: 1,
  SIN_FECHA: 2,
  VIGENTE: 3,
  SIN_VENCIMIENTO: 4,
};

const ESTADO_DOCUMENTO: Record<string, string> = {
  BORRADOR: 'Borrador',
  EN_REVISION: 'En revisión',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

const ESTADO_ACREDITACION: Record<string, string> = {
  EN_TRAMITE: 'En trámite',
  VIGENTE: 'Vigente',
  SUSPENDIDA: 'Suspendida',
  RECHAZADA: 'Rechazada',
};

export const TURNO_LABEL: Record<HrTurnoKey, string> = {
  ADMINISTRATIVO: 'Administrativo',
  SIETE_POR_SIETE: '7x7',
  CUATRO_POR_TRES: '4x3',
  CATORCE_POR_CATORCE: '14x14',
  PERSONALIZADO: 'Personalizado',
  SIN: 'Sin turno cargado',
};

const TURNO_ORDEN: readonly HrTurnoKey[] = [
  'ADMINISTRATIVO',
  'SIETE_POR_SIETE',
  'CUATRO_POR_TRES',
  'CATORCE_POR_CATORCE',
  'PERSONALIZADO',
  'SIN',
];

/** ¿Este estado de vigencia habilita hoy? Lo desconocido no habilita. */
export function habilita(vigencia: HrVigencia): boolean {
  return vigencia === 'VIGENTE' || vigencia === 'POR_VENCER' || vigencia === 'SIN_VENCIMIENTO';
}

/** ¿La acreditación habilita? Hace falta que el cliente la dé por vigente Y no esté vencida. */
export function acreditacionHabilita(status: string, vigencia: HrVigencia): boolean {
  return status === 'VIGENTE' && habilita(vigencia);
}

export function turnoKey(turno: FuenteTurno | null): HrTurnoKey {
  if (!turno) return 'SIN';
  return (TURNO_ORDEN as readonly string[]).includes(turno.shiftPattern)
    ? (turno.shiftPattern as HrTurnoKey)
    : 'PERSONALIZADO';
}

/** Turno en una línea: "7x7 día", "Administrativo". `null` sin horario cargado. */
export function turnoLabel(turno: FuenteTurno | null): string | null {
  if (!turno) return null;
  if (turno.shiftPattern === 'ADMINISTRATIVO') return 'Administrativo';
  const jornada = turno.dayNight === 'NOCHE' ? 'noche' : 'día';
  if (turno.workDays && turno.restDays) return `${turno.workDays}x${turno.restDays} ${jornada}`;
  return `Turno ${jornada}`;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

// ── Aplanado ────────────────────────────────────────────────────────────────

/** Todos los requisitos de una persona, como filas de la tabla de consulta. */
export function requisitosDe(p: FuentePersona, hoy: Date): HrRequirementRow[] {
  const base = {
    userId: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    cargo: p.cargo,
    isFieldWorker: p.isFieldWorker,
    turno: turnoLabel(p.turno),
  };
  const filas: HrRequirementRow[] = [];

  for (const d of p.documentos) {
    filas.push({
      ...base,
      key: `DOCUMENTO:${d.id}`,
      tipo: 'DOCUMENTO',
      id: d.id,
      nombre: d.name,
      detalle: d.type,
      clientId: null,
      clientName: null,
      faenaIds: [],
      faenas: null,
      issuedAt: iso(d.issuedAt),
      expiresAt: iso(d.expiresAt),
      estadoRegistro: ESTADO_DOCUMENTO[d.status] ?? d.status,
      ...estadoDe(d.expiresAt, hoy, !d.noExpiry),
    });
  }
  for (const e of p.examenes) {
    filas.push({
      ...base,
      key: `EXAMEN:${e.id}`,
      tipo: 'EXAMEN',
      id: e.id,
      nombre: e.type,
      // Sin centro ni resultado: es información clínica y esta tabla es general.
      detalle: null,
      clientId: null,
      clientName: null,
      faenaIds: [],
      faenas: null,
      issuedAt: iso(e.issuedAt),
      expiresAt: iso(e.expiresAt),
      estadoRegistro: null,
      ...estadoDe(e.expiresAt, hoy, !e.noExpiry),
    });
  }
  for (const i of p.inducciones) {
    filas.push({
      ...base,
      key: `INDUCCION:${i.id}`,
      tipo: 'INDUCCION',
      id: i.id,
      nombre: i.name,
      detalle: null,
      clientId: i.clientId,
      clientName: i.clientName,
      faenaIds: i.faenas.map((f) => f.id),
      faenas: i.faenas.length > 0 ? i.faenas.map((f) => f.name).join(', ') : null,
      issuedAt: iso(i.issuedAt),
      expiresAt: iso(i.expiresAt),
      estadoRegistro: null,
      ...estadoDe(i.expiresAt, hoy, !i.noExpiry),
    });
  }
  for (const a of p.acreditaciones) {
    filas.push({
      ...base,
      key: `ACREDITACION:${a.id}`,
      tipo: 'ACREDITACION',
      id: a.id,
      nombre: `Acreditación ${a.clientName}`,
      detalle: null,
      clientId: a.clientId,
      clientName: a.clientName,
      faenaIds: a.faenaId ? [a.faenaId] : [],
      faenas: a.faenaName ?? 'Todas las faenas',
      issuedAt: iso(a.issuedAt),
      expiresAt: iso(a.expiresAt),
      estadoRegistro: ESTADO_ACREDITACION[a.status] ?? a.status,
      ...estadoDe(a.expiresAt, hoy, !a.noExpiry),
    });
  }
  return filas;
}

// ── Coincidencias ───────────────────────────────────────────────────────────

/** Filtros que miran a la PERSONA y no a sus requisitos. */
export function pasaPersona(p: FuentePersona, f: FiltrosRrhh, conBusqueda: boolean): boolean {
  if (f.turno && turnoKey(p.turno) !== f.turno) return false;
  if (f.sinCargo && p.cargo) return false;
  if (conBusqueda && f.search?.trim()) {
    const q = f.search.trim().toLowerCase();
    if (!`${p.firstName} ${p.lastName} ${p.cargo ?? ''} ${p.email}`.toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}

/** ¿Hay algún filtro que mire los requisitos? Cambia qué personas se muestran. */
export function hayFiltroDeRequisito(f: FiltrosRrhh): boolean {
  return Boolean(
    f.clientId ||
      f.faenaId ||
      f.habilitante ||
      f.desde ||
      f.hasta ||
      (f.tipos && f.tipos.length > 0) ||
      (f.vigencias && f.vigencias.length > 0),
  );
}

export function pasaRequisito(r: HrRequirementRow, f: FiltrosRrhh, conBusqueda: boolean): boolean {
  if (f.tipos && f.tipos.length > 0 && !f.tipos.includes(r.tipo)) return false;
  if (f.vigencias && f.vigencias.length > 0 && !f.vigencias.includes(r.vigencia)) return false;

  if (f.habilitante) {
    const ok =
      r.tipo === 'ACREDITACION'
        ? r.estadoRegistro === ESTADO_ACREDITACION.VIGENTE && habilita(r.vigencia)
        : habilita(r.vigencia);
    if (!ok) return false;
  }

  // Documentos y exámenes no tienen cliente ni faena: con ese filtro no aplican.
  if (f.clientId && r.clientId !== f.clientId) return false;
  if (f.faenaId) {
    if (r.tipo === 'INDUCCION') {
      // Elegir el cliente NO hace válida la inducción en todas sus faenas.
      if (!r.faenaIds.includes(f.faenaId)) return false;
    } else if (r.tipo === 'ACREDITACION') {
      // Una acreditación sin faena vale para toda la operación de su cliente.
      const cubre =
        r.faenaIds.includes(f.faenaId) ||
        (r.faenaIds.length === 0 && !!f.faenaClientId && r.clientId === f.faenaClientId);
      if (!cubre) return false;
    } else {
      return false;
    }
  }

  if (f.desde || f.hasta) {
    // Sin fecha no se puede decir que vence en el período: queda fuera.
    if (!r.expiresAt) return false;
    if (f.desde && r.expiresAt < f.desde) return false;
    if (f.hasta && r.expiresAt > f.hasta) return false;
  }

  if (conBusqueda && f.search?.trim()) {
    const q = f.search.trim().toLowerCase();
    if (!`${r.firstName} ${r.lastName} ${r.nombre} ${r.detalle ?? ''}`.toLowerCase().includes(q)) {
      return false;
    }
  }
  return true;
}

// ── Orden ───────────────────────────────────────────────────────────────────

function porUrgenciaFila(a: HrEstadoLike, b: HrEstadoLike): number {
  return (
    ORDEN_VIGENCIA[a.vigencia] - ORDEN_VIGENCIA[b.vigencia] ||
    (a.diasRestantes ?? Number.MAX_SAFE_INTEGER) - (b.diasRestantes ?? Number.MAX_SAFE_INTEGER)
  );
}

interface HrEstadoLike {
  vigencia: HrVigencia;
  diasRestantes: number | null;
}

function porNombre(a: { lastName: string; firstName: string }, b: typeof a): number {
  return a.lastName.localeCompare(b.lastName, 'es') || a.firstName.localeCompare(b.firstName, 'es');
}

export function ordenarRequisitos(
  filas: HrRequirementRow[],
  sortBy: string | undefined,
  dir: 'asc' | 'desc',
): HrRequirementRow[] {
  const signo = dir === 'desc' ? -1 : 1;
  const cmp: Record<string, (a: HrRequirementRow, b: HrRequirementRow) => number> = {
    trabajador: porNombre,
    tipo: (a, b) => TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    vencimiento: (a, b) => {
      // Sin fecha va al final en ambos sentidos: no es "el más antiguo".
      if (!a.expiresAt && !b.expiresAt) return 0;
      if (!a.expiresAt) return 1 * signo;
      if (!b.expiresAt) return -1 * signo;
      return a.expiresAt.localeCompare(b.expiresAt);
    },
    vigencia: porUrgenciaFila,
  };
  const elegido = (sortBy && cmp[sortBy]) || porUrgenciaFila;
  return [...filas].sort((a, b) => signo * elegido(a, b) || porNombre(a, b));
}

// ── Consultas ───────────────────────────────────────────────────────────────

export function consultaRequisitos(
  personas: FuentePersona[],
  f: FiltrosRrhh,
  sortBy: string | undefined,
  dir: 'asc' | 'desc',
  hoy: Date,
): { filas: HrRequirementRow[]; personas: number } {
  const filas: HrRequirementRow[] = [];
  for (const p of personas) {
    if (!pasaPersona(p, f, false)) continue;
    for (const r of requisitosDe(p, hoy)) {
      if (pasaRequisito(r, f, true)) filas.push(r);
    }
  }
  return {
    filas: ordenarRequisitos(filas, sortBy, dir),
    personas: new Set(filas.map((r) => r.userId)).size,
  };
}

/**
 * Vista por persona. Sin filtros de requisito aparecen TODAS las personas que
 * pasan los filtros de persona, tengan o no requisitos cargados: es la vista que
 * responde "¿quiénes están en tal turno?". Con un filtro de requisito, solo las
 * que tienen al menos uno que cumple.
 */
export function consultaPersonas(
  personas: FuentePersona[],
  f: FiltrosRrhh,
  sortBy: string | undefined,
  dir: 'asc' | 'desc',
  hoy: Date,
): { filas: HrPersonRow[]; requisitos: number } {
  const exigeRequisito = hayFiltroDeRequisito(f);
  const filas: HrPersonRow[] = [];
  let requisitos = 0;

  for (const p of personas) {
    if (!pasaPersona(p, f, true)) continue;
    const suyos = requisitosDe(p, hoy)
      .filter((r) => pasaRequisito(r, f, false))
      .sort(porUrgenciaFila);
    if (exigeRequisito && suyos.length === 0) continue;
    requisitos += suyos.length;
    filas.push({
      userId: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      cargo: p.cargo,
      isFieldWorker: p.isFieldWorker,
      turno: turnoLabel(p.turno),
      turnoKey: turnoKey(p.turno),
      total: suyos.length,
      vencidos: suyos.filter((r) => r.vigencia === 'VENCIDO').length,
      porVencer: suyos.filter((r) => r.vigencia === 'POR_VENCER').length,
      sinFecha: suyos.filter((r) => r.vigencia === 'SIN_FECHA').length,
      vigentes: suyos.filter((r) => habilita(r.vigencia)).length,
      requisitos: suyos.map((r) => ({
        key: r.key,
        tipo: r.tipo,
        nombre: r.nombre,
        vigencia: r.vigencia,
        diasRestantes: r.diasRestantes,
      })),
    });
  }

  const signo = dir === 'desc' ? -1 : 1;
  const cmp: Record<string, (a: HrPersonRow, b: HrPersonRow) => number> = {
    trabajador: porNombre,
    vencidos: (a, b) => a.vencidos - b.vencidos,
    porVencer: (a, b) => a.porVencer - b.porVencer,
    total: (a, b) => a.total - b.total,
  };
  const elegido = (sortBy && cmp[sortBy]) || porNombre;
  filas.sort((a, b) => signo * elegido(a, b) || porNombre(a, b));
  return { filas, requisitos };
}

// ── Tablero ─────────────────────────────────────────────────────────────────

/** Cuántas alertas se muestran en "Atender primero". El resto está en la tabla. */
export const TOPE_ATENDER = 8;

export function construirTablero(
  personas: FuentePersona[],
  faenas: FuenteFaena[],
  clientes: Array<{ id: string; name: string }>,
  hoy: Date,
): HrDashboard {
  const filasPorPersona = new Map(personas.map((p) => [p.id, requisitosDe(p, hoy)]));
  const todas = [...filasPorPersona.values()].flat();

  const personasCon = (v: HrVigencia) =>
    new Set(todas.filter((r) => r.vigencia === v).map((r) => r.userId)).size;

  const turnos = TURNO_ORDEN.map((key) => ({
    key,
    label: TURNO_LABEL[key],
    personas: personas.filter((p) => turnoKey(p.turno) === key).length,
  })).filter((t) => t.personas > 0);

  const acreditacionesPorCliente = clientes
    .map((c) => ({
      clientId: c.id,
      clientName: c.name,
      personas: personas.filter((p) =>
        p.acreditaciones.some(
          (a) =>
            a.clientId === c.id &&
            acreditacionHabilita(a.status, estadoDe(a.expiresAt, hoy, !a.noExpiry).vigencia),
        ),
      ).length,
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'));

  const matriz = faenas
    .map((f) => ({
      clientId: f.clientId,
      clientName: f.clientName,
      faenaId: f.id,
      faenaName: f.name,
      acreditados: personas.filter((p) =>
        p.acreditaciones.some(
          (a) =>
            (a.faenaId === f.id || (a.faenaId === null && a.clientId === f.clientId)) &&
            acreditacionHabilita(a.status, estadoDe(a.expiresAt, hoy, !a.noExpiry).vigencia),
        ),
      ).length,
      inducidos: personas.filter((p) =>
        p.inducciones.some(
          (i) =>
            i.faenas.some((x) => x.id === f.id) &&
            habilita(estadoDe(i.expiresAt, hoy, !i.noExpiry).vigencia),
        ),
      ).length,
    }))
    .sort(
      (a, b) =>
        a.clientName.localeCompare(b.clientName, 'es') || a.faenaName.localeCompare(b.faenaName, 'es'),
    );

  return {
    generatedAt: hoy.toISOString(),
    diasPorVencer: DIAS_POR_VENCER,
    personas: {
      total: personas.length,
      conCuenta: personas.filter((p) => !p.isFieldWorker).length,
      deFaena: personas.filter((p) => p.isFieldWorker).length,
    },
    requisitos: {
      total: todas.length,
      vencidos: todas.filter((r) => r.vigencia === 'VENCIDO').length,
      porVencer: todas.filter((r) => r.vigencia === 'POR_VENCER').length,
      sinFecha: todas.filter((r) => r.vigencia === 'SIN_FECHA').length,
      personasConVencidos: personasCon('VENCIDO'),
      personasConPorVencer: personasCon('POR_VENCER'),
    },
    porTipo: TIPOS.map((tipo) => {
      const suyas = todas.filter((r) => r.tipo === tipo);
      return {
        tipo,
        total: suyas.length,
        vencidos: suyas.filter((r) => r.vigencia === 'VENCIDO').length,
        porVencer: suyas.filter((r) => r.vigencia === 'POR_VENCER').length,
        sinFecha: suyas.filter((r) => r.vigencia === 'SIN_FECHA').length,
      };
    }),
    acreditacionesPorCliente,
    turnos,
    completitud: {
      sinTurno: personas.filter((p) => !p.turno).length,
      sinCargo: personas.filter((p) => !p.cargo).length,
    },
    matriz,
    atender: ordenarRequisitos(
      todas.filter((r) => r.vigencia === 'VENCIDO' || r.vigencia === 'POR_VENCER'),
      'vigencia',
      'asc',
    ).slice(0, TOPE_ATENDER),
  };
}
