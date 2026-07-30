/**
 * import-vehiculos-checklists.ts — Paso 2 del import one-off (Tanda 5.3).
 * ---------------------------------------------------------------------------
 * Lee el JSON producido por `scratchpad/export_xl.py` (Excel "CHECK LIST
 * CAMIONETAS") y escribe con Prisma: Asset (VEHICULO), ChecklistTemplate (1:1
 * por activo, APROBADA) y ChecklistSubmission (una por fila de RESPUESTAS).
 * Los trabajadores de la hoja se convierten en User SIN credenciales, con dedup
 * contra los usuarios existentes.
 *
 * DRY-RUN POR DEFECTO: sin `--commit` NO instancia PrismaClient, NO conecta a la
 * BD y NO escribe: solo arma el plan y lo imprime. Con `--commit` escribe en la
 * BD apuntada por DATABASE_URL, dentro de una transacción. NO dispara efectos
 * secundarios (estado del activo, historial, gamificación, notificaciones): las
 * filas se insertan directo.
 *
 * Uso:
 *   pnpm exec tsx scripts/import-vehiculos-checklists.ts                 # dry-run
 *   pnpm exec tsx scripts/import-vehiculos-checklists.ts --input <json>  # dry-run
 *   railway run pnpm exec tsx scripts/import-vehiculos-checklists.ts --commit
 *
 * Flags:
 *   --commit                 escribe en la BD (por defecto NO)
 *   --input <ruta>           JSON de entrada (default: scratchpad gmt-link-import.json)
 *   --fallback-username <u>  usuario para filas sin idTrab (default: admin)
 *
 * Decisiones de mapeo (ver reporte del dry-run):
 * - idVeh es la CLAVE AUTORITATIVA del vehículo. La columna `patente` de
 *   RESPUESTAS es poco confiable (cientos de filas con patente cruzada), así que
 *   solo se usa como fallback cuando la fila no trae idVeh.
 * - V015 no está en el maestro y su patente (VGWD71) coincide con V014: se crea
 *   un activo mínimo V015 con identifier=null (para no duplicar patente) y la
 *   patente observada queda en metadata para revisión.
 * - Filas sin idVeh y con patente irreconocible (o vacía) se OMITEN y se
 *   reportan (no se fabrican vehículos basura).
 */

import { readFileSync } from 'node:fs';

import type { Prisma } from '@prisma/client';
import type {
  ChecklistAnswer,
  ChecklistTemplateItem,
} from '@gmt-platform/contracts';
import { parseTemplateItems, submitAnswersSchema } from '../src/modules/assets/checklist.schema';

// ---------------------------------------------------------------------------
// Config / args
// ---------------------------------------------------------------------------

const DEFAULT_INPUT =
  'C:/Users/juana/AppData/Local/Temp/claude/' +
  'C--Users-juana-GMT-proyectos/58405bea-22a0-4724-8cc9-c0c51a7a9e47/' +
  'scratchpad/gmt-link-import.json';

const COMMIT = process.argv.includes('--commit');

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const INPUT_PATH = argValue('--input') ?? DEFAULT_INPUT;
const FALLBACK_USERNAME = argValue('--fallback-username') ?? 'admin';

// Dominio placeholder para trabajadores sin correo. Obviamente no entregable:
// evita implicar un buzón real y garantiza unicidad de `email`.
const PLACEHOLDER_EMAIL_DOMAIN = 'sin-correo.gmtlink.local';

const TEMPLATE_NAME = 'Checklist camioneta liviana (importado)';

// ---------------------------------------------------------------------------
// Shape del JSON de entrada
// ---------------------------------------------------------------------------

interface JsonVehiculo {
  idVeh: string;
  tipoVeh: string | null;
  patente: string | null;
  marca: string | null;
  modelo: string | null;
  operativa: boolean | null;
}

interface JsonTrabajador {
  idTrab: string;
  nombreTrab: string | null;
  emailTrab: string | null;
  claseLic: string | null;
}

interface JsonRespuesta {
  idForm: string | null;
  idProy: string | null;
  datetimeIso: string | null;
  idTrab: string | null;
  nombreTrab: string | null;
  pngFirma: string | null;
  idVeh: string | null;
  patente: string | null;
  kilometraje: number | null;
  estados: Record<string, string | null>;
  obs: Record<string, string | null>;
  capacidadConducir: string | null;
  horasDescanso: number | null;
  medicamentosSueno: string | null;
  problemasInquietan: string | null;
  observaciones: string | null;
  obsCarr: string | null;
}

interface JsonPayload {
  meta: {
    source: string;
    generatedAt: string;
    timezone: string;
    estadoItems: { key: string; label: string }[];
    counts: { vehiculos: number; trabajadores: number; respuestas: number };
  };
  vehiculos: JsonVehiculo[];
  trabajadores: JsonTrabajador[];
  respuestas: JsonRespuesta[];
}

// ---------------------------------------------------------------------------
// Definición canónica de la plantilla (fuente de las etiquetas, con acentos)
// ---------------------------------------------------------------------------

interface EstadoDef {
  key: string;
  label: string;
}

// Mismo orden y claves que `ESTADO_ITEMS` de export_xl.py (las claves deben
// coincidir; las etiquetas acá llevan acentos para mostrarse en la UI).
const ESTADO_DEFS: EstadoDef[] = [
  { key: 'sistemaFrenos', label: 'Sistema de frenos' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'estadoMotor', label: 'Estado del motor' },
  { key: 'neumaticos', label: 'Neumáticos' },
  { key: 'neumaticoRepuesto', label: 'Neumático de repuesto' },
  { key: 'luces', label: 'Luces' },
  { key: 'bocina', label: 'Bocina' },
  { key: 'velocimetroIndicadores', label: 'Velocímetro e indicadores' },
  { key: 'parabrisasVidrios', label: 'Parabrisas y vidrios' },
  { key: 'limpiaparabrisas', label: 'Limpiaparabrisas' },
  { key: 'espejos', label: 'Espejos' },
  { key: 'proteccionPickupCabina', label: 'Protección de pickup y cabina' },
  { key: 'carroceriaEstructura', label: 'Carrocería y estructura' },
  { key: 'velocidadCrucero', label: 'Velocidad crucero' },
  { key: 'radioBase', label: 'Radio base' },
  { key: 'sistemaMonitoreoGPS', label: 'Sistema de monitoreo GPS' },
  { key: 'trabatuercasCheckpointSafelock', label: 'Trabatuercas Checkpoint Safelock' },
  { key: 'logotipoEmpresa', label: 'Logotipo de la empresa' },
  { key: 'numeroIdentificacion', label: 'Número de identificación' },
  { key: 'logoAutorizacionTransito', label: 'Logo de autorización de tránsito' },
  { key: 'nivelAdBlue', label: 'Nivel de AdBlue' },
  { key: 'cinturonSeguridad', label: 'Cinturón de seguridad' },
  { key: 'alarmaRetroceso', label: 'Alarma de retroceso' },
  { key: 'triangulosReflectantes', label: 'Triángulos reflectantes' },
  { key: 'extintores', label: 'Extintores' },
  { key: 'botiquinPrimerosAuxilios', label: 'Botiquín de primeros auxilios' },
  { key: 'llaveRuedas', label: 'Llave de ruedas' },
  { key: 'gataHidraulica', label: 'Gata hidráulica' },
  { key: 'baliza', label: 'Baliza' },
  { key: 'barraAntivuelco', label: 'Barra antivuelco' },
  { key: 'pertigaBanderaLuz', label: 'Pértiga con bandera y luz' },
  { key: 'cunas', label: 'Cuñas' },
];

const ESTADO_OPTIONS = ['Bueno', 'Regular', 'Malo'];
const ESTADO_FAIL_OPTIONS = ['Malo'];

const KM_ITEM_ID = 'kilometraje';
const OBSERVACIONES_ITEM_ID = 'observaciones';
const FIRMA_ITEM_ID = 'firma';

const DRIVER_BOOL_ITEMS: EstadoDef[] = [
  { key: 'capacidadConducir', label: '¿En condiciones de conducir?' },
  { key: 'medicamentosSueno', label: '¿Consumió medicamentos que provoquen sueño?' },
  { key: 'problemasInquietan', label: '¿Tiene problemas que lo inquieten?' },
];
const HORAS_DESCANSO_ITEM: EstadoDef = { key: 'horasDescanso', label: 'Horas de descanso' };

function obsItemId(key: string): string {
  return `obs_${key}`;
}
function obsItemLabel(label: string): string {
  return `Observación: ${label}`;
}

/** Construye los ítems tipados de la plantilla estándar de camioneta. */
function buildTemplateItems(): ChecklistTemplateItem[] {
  const items: ChecklistTemplateItem[] = [];
  for (const { key, label } of ESTADO_DEFS) {
    items.push({
      id: key,
      label,
      type: 'ESTADO',
      required: false,
      config: {
        options: ESTADO_OPTIONS,
        failOptions: ESTADO_FAIL_OPTIONS,
        requireObs: false,
        obsItemId: obsItemId(key),
      },
    });
    items.push({ id: obsItemId(key), label: obsItemLabel(label), type: 'TEXTO', required: false });
  }
  items.push({
    id: KM_ITEM_ID,
    label: 'Kilometraje actual (odómetro)',
    type: 'ENTERO',
    required: true,
    config: { isOdometer: true },
  });
  for (const { key, label } of DRIVER_BOOL_ITEMS) {
    items.push({ id: key, label, type: 'BOOLEAN', required: false });
  }
  items.push({ id: HORAS_DESCANSO_ITEM.key, label: HORAS_DESCANSO_ITEM.label, type: 'ENTERO', required: false });
  items.push({ id: OBSERVACIONES_ITEM_ID, label: 'Observaciones generales', type: 'TEXTO', required: false });
  items.push({ id: FIRMA_ITEM_ID, label: 'Firma (URL)', type: 'TEXTO', required: false });
  return items;
}

// ---------------------------------------------------------------------------
// Helpers de normalización
// ---------------------------------------------------------------------------

function normalize(text: string | null | undefined): string {
  if (!text) return '';
  const stripped = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // marcas diacríticas combinantes
    .replace(/�/g, 'n'); // carácter de reemplazo (ñ mal decodificada) -> n
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function plateKey(patente: string | null | undefined): string {
  return normalize(patente);
}

function parseBool(value: string | null): boolean | null {
  if (value === null) return null;
  const n = normalize(value);
  if (n === 'si') return true;
  if (n === 'no') return false;
  return null;
}

// ---------------------------------------------------------------------------
// Plan de vehículos
// ---------------------------------------------------------------------------

type VehicleSubtypeName = 'PICKUP' | 'FURGON';

interface VehiclePlan {
  idVehExcel: string;
  tipoVeh: string | null;
  subtype: VehicleSubtypeName;
  name: string;
  manufacturer: string | null;
  identifier: string | null; // patente; null cuando colisiona con otra ya usada
  operativa: boolean | null;
  patenteObservada: string | null; // cuando no se pudo usar como identifier
  minimal: boolean; // true = idVeh ausente del maestro (V015)
}

function subtypeFor(tipoVeh: string | null): VehicleSubtypeName {
  return normalize(tipoVeh) === 'furgon' ? 'FURGON' : 'PICKUP';
}

/**
 * Arma el plan de vehículos: el maestro (merge) + un mínimo por cada idVeh que
 * aparece en RESPUESTAS pero no está en el maestro. Dedup por patente: si la
 * patente ya la usa otro vehículo, el nuevo queda con identifier=null.
 */
function buildVehiclePlan(payload: JsonPayload): {
  plans: VehiclePlan[];
  byIdVeh: Map<string, VehiclePlan>;
  byPlate: Map<string, VehiclePlan>;
} {
  const plans: VehiclePlan[] = [];
  const byIdVeh = new Map<string, VehiclePlan>();
  const byPlate = new Map<string, VehiclePlan>();

  const addPlate = (plan: VehiclePlan): void => {
    if (plan.identifier) byPlate.set(plateKey(plan.identifier), plan);
  };

  for (const v of payload.vehiculos) {
    const marcaModelo = [v.marca, v.modelo].filter((s): s is string => !!s).join(' ').trim();
    const name = marcaModelo !== '' ? marcaModelo : (v.patente ?? v.idVeh);
    const plate = v.patente;
    const collides = plate ? byPlate.has(plateKey(plate)) : false;
    const plan: VehiclePlan = {
      idVehExcel: v.idVeh,
      tipoVeh: v.tipoVeh,
      subtype: subtypeFor(v.tipoVeh),
      name,
      manufacturer: v.marca,
      identifier: collides ? null : plate,
      operativa: v.operativa,
      patenteObservada: collides ? plate : null,
      minimal: false,
    };
    plans.push(plan);
    byIdVeh.set(v.idVeh, plan);
    addPlate(plan);
  }

  // idVeh presentes en RESPUESTAS pero no en el maestro -> mínimo.
  const masterIds = new Set(payload.vehiculos.map((v) => v.idVeh));
  const extraIds = new Set<string>();
  for (const r of payload.respuestas) {
    if (r.idVeh && !masterIds.has(r.idVeh)) extraIds.add(r.idVeh);
  }
  for (const idVeh of [...extraIds].sort()) {
    const plate =
      payload.respuestas.find((r) => r.idVeh === idVeh && r.patente)?.patente ?? null;
    const collides = plate ? byPlate.has(plateKey(plate)) : false;
    const plan: VehiclePlan = {
      idVehExcel: idVeh,
      tipoVeh: null,
      subtype: 'PICKUP',
      name: `Vehículo ${idVeh} (sin ficha en maestro)`,
      manufacturer: null,
      identifier: collides ? null : plate,
      operativa: null,
      patenteObservada: collides ? plate : null,
      minimal: true,
    };
    plans.push(plan);
    byIdVeh.set(idVeh, plan);
    addPlate(plan);
  }

  return { plans, byIdVeh, byPlate };
}

// ---------------------------------------------------------------------------
// Plan de trabajadores (dedup vs usuarios existentes)
// ---------------------------------------------------------------------------

interface ExistingUser {
  id: string | null; // null en dry-run sin BD
  username: string;
  fullName: string;
}

// Usuarios existentes conocidos (fallback para dry-run SIN BD). En --commit se
// consulta la BD real. (username | nombre completo)
const EXISTING_USERS_FALLBACK: ExistingUser[] = [
  { id: null, username: 'admin', fullName: 'admin' },
  { id: null, username: 'fdiaz', fullName: 'Felipe Diaz' },
  { id: null, username: 'fmarti', fullName: 'Fredy Marti' },
  { id: null, username: 'hleiva', fullName: 'Humberto Leiva' },
  { id: null, username: 'japalmo', fullName: 'Juan Apalmo' },
  { id: null, username: 'jsanta', fullName: 'Juan Santa' },
  { id: null, username: 'mpoblete', fullName: 'Marisol Poblete' },
  { id: null, username: 'mtapia', fullName: 'Mario Tapia' },
  { id: null, username: 'npizarro', fullName: 'Nicole Pizarro' },
  { id: null, username: 'pmarambio', fullName: 'Pamela Marambio' },
  { id: null, username: 'rargandona', fullName: 'Rocio Argandona' },
  { id: null, username: 'vcastillo', fullName: 'Victor Castillo' },
  { id: null, username: 'vmetric-historico', fullName: 'vmetric historico' },
];

interface ParsedName {
  firstName: string;
  secondName: string | null;
  lastName: string;
  secondLastName: string | null;
  apellidoPaterno: string;
}

function parseName(nombre: string): ParsedName {
  const tokens = nombre.trim().split(/\s+/).filter((t) => t.length > 0);
  const at = (i: number): string => tokens[i] ?? '';
  const first = at(0) !== '' ? at(0) : nombre;
  if (tokens.length <= 1) {
    return { firstName: first, secondName: null, lastName: '(sin apellido)', secondLastName: null, apellidoPaterno: '' };
  }
  if (tokens.length === 2) {
    return { firstName: at(0), secondName: null, lastName: at(1), secondLastName: null, apellidoPaterno: at(1) };
  }
  if (tokens.length === 3) {
    return { firstName: at(0), secondName: null, lastName: at(1), secondLastName: at(2), apellidoPaterno: at(1) };
  }
  return {
    firstName: at(0),
    secondName: at(1),
    lastName: at(2),
    secondLastName: tokens.slice(3).join(' '),
    apellidoPaterno: at(2),
  };
}

function candidateUsername(nombre: string): string {
  const p = parseName(nombre);
  const initial = p.firstName.slice(0, 1);
  return normalize(initial + p.apellidoPaterno);
}

type WorkerDecision =
  | { kind: 'MATCH'; username: string; existingId: string | null }
  | { kind: 'NEW'; username: string; nearDuplicateOf: string | null };

interface WorkerPlan {
  idTrab: string;
  nombreTrab: string;
  emailTrab: string | null;
  candidate: string;
  decision: WorkerDecision;
  parsed: ParsedName;
}

function buildWorkerPlans(payload: JsonPayload, existing: ExistingUser[]): WorkerPlan[] {
  const byUsername = new Map(existing.map((u) => [u.username, u] as const));
  const byFullName = new Map(existing.map((u) => [normalize(u.fullName), u] as const));
  const usedUsernames = new Set(existing.map((u) => u.username));
  const plans: WorkerPlan[] = [];

  for (const t of payload.trabajadores) {
    const nombre = t.nombreTrab ?? t.idTrab;
    const candidate = candidateUsername(nombre);
    const parsed = parseName(nombre);

    const matchByUsername = byUsername.get(candidate);
    const matchByName = byFullName.get(normalize(nombre));
    const matched = matchByUsername ?? matchByName;

    let decision: WorkerDecision;
    if (matched) {
      decision = { kind: 'MATCH', username: matched.username, existingId: matched.id };
    } else {
      let username = candidate;
      let n = 2;
      while (usedUsernames.has(username) || username === '') {
        username = `${candidate}-${n}`;
        n += 1;
      }
      usedUsernames.add(username);
      // Heurística de casi-duplicado: prefijo compartido con un usuario existente.
      const near =
        existing.find(
          (u) => u.username !== username && (u.username.startsWith(candidate) || candidate.startsWith(u.username)),
        )?.username ?? null;
      decision = { kind: 'NEW', username, nearDuplicateOf: near };
    }
    plans.push({ idTrab: t.idTrab, nombreTrab: nombre, emailTrab: t.emailTrab, candidate, decision, parsed });
  }
  return plans;
}

// ---------------------------------------------------------------------------
// Construcción de respuestas (answers) de una submission
// ---------------------------------------------------------------------------

function buildAnswers(r: JsonRespuesta): { answers: ChecklistAnswer[]; hasMalo: boolean } {
  const answers: ChecklistAnswer[] = [];
  let hasMalo = false;

  for (const { key, label } of ESTADO_DEFS) {
    const estado = r.estados[key] ?? null;
    const obs = r.obs[key] ?? null;
    if (estado !== null) {
      if (normalize(estado) === 'malo') hasMalo = true;
      const answer: ChecklistAnswer = { itemId: key, label, value: estado };
      if (obs !== null) answer.comment = obs;
      answers.push(answer);
    } else if (obs !== null) {
      // ESTADO vacío pero con observación: se preserva como TEXTO companion.
      answers.push({ itemId: obsItemId(key), label: obsItemLabel(label), value: obs });
    }
  }

  if (r.kilometraje !== null) {
    answers.push({ itemId: KM_ITEM_ID, label: 'Kilometraje actual (odómetro)', value: r.kilometraje });
  }

  const capacidad = parseBool(r.capacidadConducir);
  if (capacidad !== null) {
    answers.push({ itemId: 'capacidadConducir', label: '¿En condiciones de conducir?', value: capacidad });
  }
  const medicamentos = parseBool(r.medicamentosSueno);
  if (medicamentos !== null) {
    answers.push({
      itemId: 'medicamentosSueno',
      label: '¿Consumió medicamentos que provoquen sueño?',
      value: medicamentos,
    });
  }
  const problemas = parseBool(r.problemasInquietan);
  if (problemas !== null) {
    answers.push({ itemId: 'problemasInquietan', label: '¿Tiene problemas que lo inquieten?', value: problemas });
  }
  if (r.horasDescanso !== null) {
    answers.push({ itemId: HORAS_DESCANSO_ITEM.key, label: HORAS_DESCANSO_ITEM.label, value: r.horasDescanso });
  }

  let obsGeneral = r.observaciones;
  if (r.obsCarr) {
    obsGeneral = obsGeneral ? `${obsGeneral} | Carrocería: ${r.obsCarr}` : `Carrocería: ${r.obsCarr}`;
  }
  if (obsGeneral) {
    answers.push({ itemId: OBSERVACIONES_ITEM_ID, label: 'Observaciones generales', value: obsGeneral });
  }

  if (r.pngFirma) {
    answers.push({ itemId: FIRMA_ITEM_ID, label: 'Firma (URL)', value: r.pngFirma });
  }

  return { answers, hasMalo };
}

// ---------------------------------------------------------------------------
// Resolución de submissions
// ---------------------------------------------------------------------------

interface SubmissionPlan {
  idVehExcel: string;
  idTrab: string | null;
  usedFallbackUser: boolean;
  createdAt: Date;
  answers: ChecklistAnswer[];
  hasMalo: boolean;
}

interface ProblemRow {
  idForm: string | null;
  reason: string;
  detail: string;
}

interface ResolveResult {
  submissions: SubmissionPlan[];
  problems: ProblemRow[];
  fallbackUserCount: number;
  unknownTrabCount: number;
}

function resolveSubmissions(
  payload: JsonPayload,
  byIdVeh: Map<string, VehiclePlan>,
  byPlate: Map<string, VehiclePlan>,
  trabIds: Set<string>,
): ResolveResult {
  const submissions: SubmissionPlan[] = [];
  const problems: ProblemRow[] = [];
  let fallbackUserCount = 0;
  let unknownTrabCount = 0;

  for (const r of payload.respuestas) {
    // Vehículo: idVeh manda; patente solo como fallback.
    let vehicle: VehiclePlan | undefined;
    if (r.idVeh) {
      vehicle = byIdVeh.get(r.idVeh);
    } else if (r.patente) {
      vehicle = byPlate.get(plateKey(r.patente));
    }
    if (!vehicle) {
      problems.push({
        idForm: r.idForm,
        reason: 'SIN_VEHICULO',
        detail: `idVeh=${r.idVeh ?? '∅'} patente=${r.patente ?? '∅'}`,
      });
      continue;
    }

    if (!r.datetimeIso) {
      problems.push({ idForm: r.idForm, reason: 'FECHA_INVALIDA', detail: `idVeh=${vehicle.idVehExcel}` });
      continue;
    }
    const createdAt = new Date(r.datetimeIso);
    if (Number.isNaN(createdAt.getTime())) {
      problems.push({ idForm: r.idForm, reason: 'FECHA_INVALIDA', detail: r.datetimeIso });
      continue;
    }

    // Usuario: idTrab -> mapa; si falta o es desconocido -> fallback.
    let usedFallbackUser = false;
    if (!r.idTrab) {
      usedFallbackUser = true;
      fallbackUserCount += 1;
    } else if (!trabIds.has(r.idTrab)) {
      usedFallbackUser = true;
      fallbackUserCount += 1;
      unknownTrabCount += 1;
    }

    const { answers, hasMalo } = buildAnswers(r);
    submissions.push({
      idVehExcel: vehicle.idVehExcel,
      idTrab: r.idTrab,
      usedFallbackUser,
      createdAt,
      answers,
      hasMalo,
    });
  }

  return { submissions, problems, fallbackUserCount, unknownTrabCount };
}

// ---------------------------------------------------------------------------
// Reporte (dry-run)
// ---------------------------------------------------------------------------

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function printReport(
  payload: JsonPayload,
  templateItems: ChecklistTemplateItem[],
  vehiclePlans: VehiclePlan[],
  workerPlans: WorkerPlan[],
  resolve: ResolveResult,
  existingSource: string,
  templateValid: boolean,
  answerFailures: number,
): void {
  const line = '─'.repeat(78);
  console.log(line);
  console.log('IMPORT VEHÍCULOS + CHECKLISTS + TRABAJADORES  —  DRY-RUN (no escribe)');
  console.log(line);
  console.log(`Entrada JSON      : ${INPUT_PATH}`);
  console.log(`Fuente Excel      : ${payload.meta.source}`);
  console.log(`Zona horaria      : ${payload.meta.timezone}`);
  console.log(`Usuarios existentes: ${existingSource}`);
  console.log(`Fallback (sin idTrab): username="${FALLBACK_USERNAME}"`);

  // Vehículos
  console.log(`\n${line}\nVEHÍCULOS\n${line}`);
  const nuevos = vehiclePlans.length;
  console.log(`Total a considerar: ${nuevos} (maestro + mínimos por idVeh faltante)`);
  console.log(`${pad('idVeh', 8)}${pad('subtype', 9)}${pad('patente(id)', 14)}${pad('name', 26)}op`);
  for (const v of vehiclePlans) {
    const idp = v.identifier ?? (v.patenteObservada ? `(${v.patenteObservada})` : '∅');
    const op = v.operativa === null ? '?' : v.operativa ? 'sí' : 'no';
    console.log(`${pad(v.idVehExcel, 8)}${pad(v.subtype, 9)}${pad(idp, 14)}${pad(v.name.slice(0, 25), 26)}${op}${v.minimal ? '  [MÍNIMO]' : ''}`);
  }
  const sinId = vehiclePlans.filter((v) => v.identifier === null);
  if (sinId.length > 0) {
    console.log(`\nNota: ${sinId.length} vehículo(s) sin patente como identifier (colisión). Patente observada en metadata:`);
    for (const v of sinId) console.log(`   ${v.idVehExcel}: patenteObservada=${v.patenteObservada ?? '∅'}`);
  }

  // Template
  console.log(`\n${line}\nPLANTILLA (una por activo, status=APROBADO)\n${line}`);
  console.log(`Nombre: "${TEMPLATE_NAME}"`);
  const byType = new Map<string, number>();
  for (const it of templateItems) byType.set(it.type, (byType.get(it.type) ?? 0) + 1);
  console.log(`Ítems: ${templateItems.length} -> ${[...byType.entries()].map(([t, n]) => `${t}:${n}`).join('  ')}`);
  console.log(`Validación Zod (parseTemplateItems): ${templateValid ? 'OK' : 'FALLÓ'}`);
  console.log(`Se crearía 1 plantilla por cada uno de los ${vehiclePlans.length} activos.`);

  // Trabajadores
  console.log(`\n${line}\nTRABAJADORES -> USUARIOS (dedup)\n${line}`);
  console.log(`${pad('idTrab', 8)}${pad('nombre', 24)}${pad('resultado', 12)}username / nota`);
  let matched = 0;
  let created = 0;
  for (const w of workerPlans) {
    if (w.decision.kind === 'MATCH') {
      matched += 1;
      console.log(`${pad(w.idTrab, 8)}${pad(w.nombreTrab.slice(0, 23), 24)}${pad('MATCH', 12)}${w.decision.username}`);
    } else {
      created += 1;
      const near = w.decision.nearDuplicateOf ? `  ⚠ posible duplicado de "${w.decision.nearDuplicateOf}"` : '';
      const mail = w.emailTrab ? '' : '  (sin correo → placeholder)';
      console.log(`${pad(w.idTrab, 8)}${pad(w.nombreTrab.slice(0, 23), 24)}${pad('NEW', 12)}${w.decision.username}${near}${mail}`);
    }
  }
  console.log(`\nResumen trabajadores: ${matched} MATCH (reusa) · ${created} NEW (crea, sin credenciales)`);
  const nears = workerPlans.filter((w) => w.decision.kind === 'NEW' && w.decision.nearDuplicateOf);
  if (nears.length > 0) {
    console.log(`Casi-duplicados a revisar: ${nears.map((w) => `${w.decision.kind === 'NEW' ? w.decision.username : ''}~${w.decision.kind === 'NEW' ? w.decision.nearDuplicateOf : ''}`).join(', ')}`);
  }

  // Submissions
  console.log(`\n${line}\nSUBMISSIONS\n${line}`);
  const subs = resolve.submissions;
  const dates = subs.map((s) => s.createdAt.getTime());
  const min = dates.length ? new Date(Math.min(...dates)) : null;
  const max = dates.length ? new Date(Math.max(...dates)) : null;
  const conMalo = subs.filter((s) => s.hasMalo).length;
  console.log(`A crear: ${subs.length}  (de ${payload.respuestas.length} filas)`);
  console.log(`Rango de fechas: ${min ? min.toISOString() : '∅'}  ->  ${max ? max.toISOString() : '∅'}`);
  console.log(`Con al menos un "Malo": ${conMalo}`);
  console.log(`Usan usuario fallback ("${FALLBACK_USERNAME}"): ${resolve.fallbackUserCount}  (de ellos, idTrab desconocido: ${resolve.unknownTrabCount})`);
  console.log(`Validación Zod de answers (submitAnswersSchema): ${answerFailures === 0 ? 'OK (todas)' : `${answerFailures} con error`}`);

  // por vehículo
  const perVeh = new Map<string, number>();
  for (const s of subs) perVeh.set(s.idVehExcel, (perVeh.get(s.idVehExcel) ?? 0) + 1);
  console.log('Submissions por vehículo:');
  console.log('   ' + [...perVeh.entries()].sort().map(([k, n]) => `${k}:${n}`).join('  '));

  // Problemas
  console.log(`\n${line}\nFILAS PROBLEMÁTICAS (omitidas): ${resolve.problems.length}\n${line}`);
  const byReason = new Map<string, number>();
  for (const p of resolve.problems) byReason.set(p.reason, (byReason.get(p.reason) ?? 0) + 1);
  for (const [reason, n] of byReason) console.log(`   ${reason}: ${n}`);
  for (const p of resolve.problems.slice(0, 30)) {
    console.log(`     - idForm=${p.idForm ?? '∅'}  ${p.reason}  ${p.detail}`);
  }
  if (resolve.problems.length > 30) console.log(`     ... (+${resolve.problems.length - 30} más)`);

  console.log(`\n${line}`);
  console.log('DRY-RUN completo. No se escribió nada. Para escribir: agrega --commit');
  console.log(`(con DATABASE_URL apuntando a la BD destino; NUNCA a producción por accidente).`);
  console.log(line);
}

// ---------------------------------------------------------------------------
// Commit (escritura real)
// ---------------------------------------------------------------------------

async function runCommit(
  payload: JsonPayload,
  templateItems: ChecklistTemplateItem[],
  vehiclePlans: VehiclePlan[],
): Promise<void> {
  const { PrismaClient, AssetType, AssetStatus, AssetIdentifierType, VehicleSubtype, DocumentStatus } =
    await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    // Usuarios existentes reales.
    const dbUsers = await prisma.user.findMany({
      select: { id: true, username: true, firstName: true, secondName: true, lastName: true, secondLastName: true },
    });
    const existing: ExistingUser[] = dbUsers.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: [u.firstName, u.secondName, u.lastName, u.secondLastName].filter((s): s is string => !!s).join(' '),
    }));
    const workerPlans = buildWorkerPlans(payload, existing);

    // Código de activo secuencial (replica generateAssetCode para VEHICULO).
    const existingVehicleCount = await prisma.asset.count({ where: { type: AssetType.VEHICULO } });
    let vhSerial = existingVehicleCount;
    const nextVehicleCode = async (): Promise<string> => {
      vhSerial += 1;
      let code = `GMT-VH-${String(vhSerial).padStart(4, '0')}`;
      while (await prisma.asset.findUnique({ where: { code } })) {
        vhSerial += 1;
        code = `GMT-VH-${String(vhSerial).padStart(4, '0')}`;
      }
      return code;
    };

    const subtypeEnum: Record<VehicleSubtypeName, (typeof VehicleSubtype)[keyof typeof VehicleSubtype]> = {
      PICKUP: VehicleSubtype.PICKUP,
      FURGON: VehicleSubtype.FURGON,
    };

    await prisma.$transaction(async (tx) => {
      // 1) Usuarios NEW (sin credenciales).
      const usernameToId = new Map<string, string>();
      for (const e of existing) usernameToId.set(e.username, e.id ?? '');
      for (const w of workerPlans) {
        if (w.decision.kind !== 'NEW') continue;
        const email = w.emailTrab ?? `${w.decision.username}@${PLACEHOLDER_EMAIL_DOMAIN}`;
        const created = await tx.user.create({
          data: {
            firstName: w.parsed.firstName,
            secondName: w.parsed.secondName,
            lastName: w.parsed.lastName,
            secondLastName: w.parsed.secondLastName,
            email,
            username: w.decision.username,
            emailInstitucional: w.emailTrab ?? null,
            status: 'PENDING_FIRST_LOGIN',
            passwordHash: null,
            cargo: null,
          },
          select: { id: true, username: true },
        });
        usernameToId.set(created.username, created.id);
      }

      // idTrab -> userId
      const trabToUserId = new Map<string, string>();
      for (const w of workerPlans) {
        const uname = w.decision.username;
        const uid = usernameToId.get(uname);
        if (uid) trabToUserId.set(w.idTrab, uid);
      }
      const fallbackUserId = usernameToId.get(FALLBACK_USERNAME);
      if (!fallbackUserId) {
        throw new Error(`Usuario fallback "${FALLBACK_USERNAME}" no existe en la BD. Aborta.`);
      }

      // 2) Vehículos (dedup por patente vs BD) + plantilla 1:1.
      const idVehToAsset = new Map<string, { assetId: string; templateId: string }>();
      for (const v of vehiclePlans) {
        let assetId: string;
        // Dedup: si ya existe un activo con esa patente, reusar.
        const existingAsset =
          v.identifier != null
            ? await tx.asset.findFirst({
                where: { identifier: v.identifier, identifierType: AssetIdentifierType.PATENTE },
                select: { id: true },
              })
            : null;
        if (existingAsset) {
          assetId = existingAsset.id;
        } else {
          const code = await nextVehicleCode();
          const metadata: Prisma.InputJsonValue = {
            idVehExcel: v.idVehExcel,
            tipoVeh: v.tipoVeh,
            operativa: v.operativa,
            ...(v.patenteObservada ? { patenteObservada: v.patenteObservada } : {}),
          };
          const asset = await tx.asset.create({
            data: {
              code,
              type: AssetType.VEHICULO,
              name: v.name,
              manufacturer: v.manufacturer,
              identifier: v.identifier,
              identifierType: v.identifier ? AssetIdentifierType.PATENTE : null,
              vehicleSubtype: subtypeEnum[v.subtype],
              status: AssetStatus.DISPONIBLE,
              projectId: null,
              metadata,
            },
            select: { id: true },
          });
          assetId = asset.id;
        }

        // Plantilla 1:1 (assetId es @unique): upsert por assetId.
        const template = await tx.checklistTemplate.upsert({
          where: { assetId },
          create: {
            assetId,
            name: TEMPLATE_NAME,
            items: templateItems as unknown as Prisma.InputJsonValue,
            status: DocumentStatus.APROBADO,
          },
          update: {},
          select: { id: true },
        });
        idVehToAsset.set(v.idVehExcel, { assetId, templateId: template.id });
      }

      // 3) Submissions.
      const trabIds = new Set(payload.trabajadores.map((t) => t.idTrab));
      const byIdVeh = new Map(vehiclePlans.map((v) => [v.idVehExcel, v] as const));
      const byPlate = new Map<string, VehiclePlan>();
      for (const v of vehiclePlans) if (v.identifier) byPlate.set(plateKey(v.identifier), v);

      const submissionData: Prisma.ChecklistSubmissionCreateManyInput[] = [];
      for (const r of payload.respuestas) {
        let vehicle: VehiclePlan | undefined;
        if (r.idVeh) vehicle = byIdVeh.get(r.idVeh);
        else if (r.patente) vehicle = byPlate.get(plateKey(r.patente));
        if (!vehicle || !r.datetimeIso) continue;
        const createdAt = new Date(r.datetimeIso);
        if (Number.isNaN(createdAt.getTime())) continue;

        const target = idVehToAsset.get(vehicle.idVehExcel);
        if (!target) continue;

        let userId = fallbackUserId;
        if (r.idTrab && trabIds.has(r.idTrab)) {
          userId = trabToUserId.get(r.idTrab) ?? fallbackUserId;
        }

        const { answers } = buildAnswers(r);
        submissionData.push({
          assetId: target.assetId,
          templateId: target.templateId,
          userId,
          answers: answers as unknown as Prisma.InputJsonValue,
          createdAt,
        });
      }
      // Inserción masiva: ~2000 `create` sueltos en una transacción interactiva
      // superan el timeout por defecto de Prisma (5s). createMany es una sola query.
      await tx.checklistSubmission.createMany({ data: submissionData });
      const written = submissionData.length;
      console.log(`[commit] usuarios NEW creados, activos/plantillas procesados: ${vehiclePlans.length}, submissions escritas: ${written}`);
    }, { maxWait: 15000, timeout: 180000 });
    console.log('[commit] OK. Transacción confirmada.');
  } finally {
    await prisma.$disconnect();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadPayload(path: string): JsonPayload {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as JsonPayload;
}

async function main(): Promise<void> {
  const payload = loadPayload(INPUT_PATH);

  // Cross-check: las claves de ESTADO del JSON coinciden con las de la plantilla.
  const jsonKeys = new Set(payload.meta.estadoItems.map((e) => e.key));
  const defKeys = new Set(ESTADO_DEFS.map((d) => d.key));
  const missingInJson = [...defKeys].filter((k) => !jsonKeys.has(k));
  const missingInDefs = [...jsonKeys].filter((k) => !defKeys.has(k));
  if (missingInJson.length || missingInDefs.length) {
    console.warn(
      `[WARN] Desalineación de claves ESTADO. Faltan en JSON: [${missingInJson.join(', ')}] · ` +
        `Faltan en el script: [${missingInDefs.join(', ')}]`,
    );
  }

  const templateItems = buildTemplateItems();

  // Verificación fuerte: la plantilla pasa el Zod real del backend.
  let templateValid = true;
  try {
    parseTemplateItems(templateItems);
  } catch (err) {
    templateValid = false;
    console.error('[ERROR] La plantilla NO valida contra parseTemplateItems:', err);
  }

  const { plans: vehiclePlans, byIdVeh, byPlate } = buildVehiclePlan(payload);
  const trabIds = new Set(payload.trabajadores.map((t) => t.idTrab));
  const resolve = resolveSubmissions(payload, byIdVeh, byPlate, trabIds);

  // Verificación fuerte: cada set de answers valida contra submitAnswersSchema.
  let answerFailures = 0;
  for (const s of resolve.submissions) {
    const res = submitAnswersSchema.safeParse(s.answers);
    if (!res.success) answerFailures += 1;
  }

  if (!COMMIT) {
    const workerPlans = buildWorkerPlans(payload, EXISTING_USERS_FALLBACK);
    printReport(
      payload,
      templateItems,
      vehiclePlans,
      workerPlans,
      resolve,
      `${EXISTING_USERS_FALLBACK.length} conocidos (hardcode, sin BD)`,
      templateValid,
      answerFailures,
    );
    return;
  }

  if (!templateValid || answerFailures > 0) {
    throw new Error(`Verificación fallida (templateValid=${templateValid}, answerFailures=${answerFailures}). Aborta commit.`);
  }
  await runCommit(payload, templateItems, vehiclePlans);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
