/**
 * Plantilla real del checklist de vehículos livianos de GMT.
 *
 * Es la transcripción del formulario que la flota llena hoy en AppScript, que
 * descarga a una planilla de cálculo. Se reconstruyó desde el libro
 * "CHECK LIST CAMIONETAS", pestañas RESPUESTAS (2.136 checklists, 92 columnas) y
 * FORMATO CHECKLIST (el molde del PDF firmado).
 *
 * ── Por qué los ids son los de la planilla ─────────────────────────────────
 *
 * Cada `id` de ítem es EXACTAMENTE el nombre de la columna en RESPUESTAS
 * (`sistemaFrenos`, `obsSistemaFrenos`, `neumaticoRepuesto`, …). Así la
 * importación desde la planilla es un mapeo directo columna→ítem, sin tabla de
 * equivalencias que mantener ni forma de que se desalinee en silencio. La única
 * excepción es `kilometraje`, que ya se llamaba igual en las dos partes.
 *
 * ── Fuente única ───────────────────────────────────────────────────────────
 *
 * Vive en `contracts` y no duplicada en el front y en el back, que era el estado
 * anterior: dos copias con un comentario en cada una pidiendo que coincidieran.
 */

import type { ChecklistSection, ChecklistTemplateItem } from './index.js';
import { DIAGRAMA_CAMIONETA, PARTES_CARROCERIA } from './vehicle-diagram.js';

/** Valores de un ítem de estado, tal como los emite el formulario actual. */
export const ESTADO_OPCIONES = ['Bueno', 'Regular', 'Malo'] as const;

/**
 * "Malo" es la única falla. "Regular" NO lo es a propósito: sobre los 2.136
 * checklists reales hay 947 respuestas "Regular" contra 750 "Malo" (y 62.047
 * "Bueno"), y varias de las "Regular" son cosas como un piquete en el
 * parabrisas. Marcarlas como falla llenaría la pantalla de rojo y la señal
 * dejaría de significar nada. La observación igual queda registrada.
 */
export const ESTADO_FALLA = ['Malo'] as const;

/** Ids de las secciones, en el orden del formato impreso. */
const SEC_DATOS = 'datos-vehiculo';
const SEC_GENERAL = 'estado-general';
const SEC_EMERGENCIA = 'equipos-emergencia';
const SEC_CONDUCTOR = 'condiciones-conductor';
const SEC_CIERRE = 'cierre';

/**
 * Un ítem de estado con su observación acompañante.
 *
 * La observación va en la MISMA sección que su ítem: el motor las une por
 * `obsItemId` al renderizar, y dejarlas en otra página las separaría del campo
 * que explican.
 */
function estado(
  seccion: string,
  id: string,
  label: string,
  opciones: readonly string[] = ESTADO_OPCIONES,
): ChecklistTemplateItem[] {
  const obsId = `obs${id.charAt(0).toUpperCase()}${id.slice(1)}`;
  return [
    {
      id,
      label,
      type: 'ESTADO',
      required: true,
      section: seccion,
      config: {
        options: [...opciones],
        failOptions: [...ESTADO_FALLA],
        requireObs: false,
        obsItemId: obsId,
      },
    },
    {
      id: obsId,
      label: `Observación · ${label}`,
      type: 'TEXTO',
      required: false,
      section: seccion,
    },
  ];
}

/** Sección 1 del formato: ESTADO GENERAL DEL VEHÍCULO (21 ítems). */
const ESTADO_GENERAL: ChecklistTemplateItem[] = [
  ...estado(SEC_GENERAL, 'sistemaFrenos', 'Sistema de frenos (pedal y freno de mano)'),
  ...estado(SEC_GENERAL, 'direccion', 'Dirección'),
  ...estado(SEC_GENERAL, 'estadoMotor', 'Estado de funcionamiento del motor'),
  ...estado(SEC_GENERAL, 'neumaticos', 'Neumáticos'),
  ...estado(SEC_GENERAL, 'neumaticoRepuesto', 'Neumático de repuesto'),
  ...estado(SEC_GENERAL, 'luces', 'Luces (conducción, estacionamiento, intermitente, freno, retroceso)'),
  ...estado(SEC_GENERAL, 'bocina', 'Bocina'),
  ...estado(SEC_GENERAL, 'velocimetroIndicadores', 'Velocímetro y otros indicadores'),
  ...estado(SEC_GENERAL, 'parabrisasVidrios', 'Parabrisas, vidrios laterales y posterior'),
  ...estado(SEC_GENERAL, 'limpiaparabrisas', 'Limpiaparabrisas'),
  ...estado(SEC_GENERAL, 'espejos', 'Espejos interno y laterales'),
  ...estado(SEC_GENERAL, 'proteccionPickupCabina', 'Protección entre pickup y cabina'),
  ...estado(SEC_GENERAL, 'carroceriaEstructura', 'Carrocería y estructura'),
  ...estado(SEC_GENERAL, 'velocidadCrucero', 'Velocidad crucero'),
  ...estado(SEC_GENERAL, 'radioBase', 'Radio base'),
  ...estado(SEC_GENERAL, 'sistemaMonitoreoGPS', 'Sistema de monitoreo GPS'),
  ...estado(
    SEC_GENERAL,
    'trabatuercasCheckpointSafelock',
    'Verificación de pernos (trabatuercas / check point / safelock)',
  ),
  ...estado(SEC_GENERAL, 'logotipoEmpresa', 'Logotipo de la empresa, ambos costados y trasero'),
  ...estado(SEC_GENERAL, 'numeroIdentificacion', 'N° de identificación trasero y lateral'),
  ...estado(SEC_GENERAL, 'logoAutorizacionTransito', 'Logo de autorización de tránsito en faena'),
  // AdBlue no se mide Bueno/Regular/Malo sino por nivel: son los valores que
  // efectivamente trae la planilla ("1/4" aparece 17 veces), y varios vehículos
  // no lo llevan, de ahí el N/A.
  ...estado(SEC_GENERAL, 'nivelAdBlue', 'Nivel de AdBlue', [
    'Lleno',
    '3/4',
    'Medio',
    '1/4',
    'Bajo',
    'N/A',
  ]),
];

/** Sección 2 del formato: EQUIPOS DE EMERGENCIA (11 ítems). */
const EQUIPOS_EMERGENCIA: ChecklistTemplateItem[] = [
  ...estado(SEC_EMERGENCIA, 'cinturonSeguridad', 'Cinturón de seguridad'),
  ...estado(SEC_EMERGENCIA, 'alarmaRetroceso', 'Alarma de retroceso'),
  ...estado(SEC_EMERGENCIA, 'triangulosReflectantes', 'Triángulos reflectantes'),
  ...estado(SEC_EMERGENCIA, 'extintores', 'Extintores'),
  ...estado(SEC_EMERGENCIA, 'botiquinPrimerosAuxilios', 'Botiquín de primeros auxilios'),
  ...estado(SEC_EMERGENCIA, 'llaveRuedas', 'Llave de ruedas'),
  ...estado(SEC_EMERGENCIA, 'gataHidraulica', 'Gata hidráulica'),
  ...estado(SEC_EMERGENCIA, 'baliza', 'Baliza (amarilla o azul)'),
  ...estado(SEC_EMERGENCIA, 'barraAntivuelco', 'Barra antivuelco exterior e interior'),
  ...estado(SEC_EMERGENCIA, 'pertigaBanderaLuz', 'Pértiga / bandera / luz'),
  ...estado(SEC_EMERGENCIA, 'cunas', 'Cuñas (2)'),
];

/** Sección 3 del formato: CONDICIONES DEL CONDUCTOR (4 preguntas). */
const CONDICIONES_CONDUCTOR: ChecklistTemplateItem[] = [
  {
    id: 'capacidadConducir',
    label: '¿Se siente física y mentalmente capaz de conducir?',
    type: 'BOOLEAN',
    required: true,
    section: SEC_CONDUCTOR,
    // Responder que NO es una falla: es la pregunta que puede detener una salida.
    config: { failOptions: ['false'] },
  },
  {
    id: 'horasDescanso',
    label: '¿Cuántas horas descansó?',
    type: 'ENTERO',
    required: true,
    section: SEC_CONDUCTOR,
  },
  {
    id: 'medicamentosSueno',
    label: '¿Consume algún medicamento que induzca sueño?',
    type: 'BOOLEAN',
    required: true,
    section: SEC_CONDUCTOR,
    config: { failOptions: ['true'] },
  },
  {
    id: 'problemasInquietan',
    label: '¿Presenta algún problema que lo inquiete o distraiga?',
    type: 'BOOLEAN',
    required: true,
    section: SEC_CONDUCTOR,
    config: { failOptions: ['true'] },
  },
];

/** Sección 0: los datos del vehículo que el conductor confirma al llenar. */
const DATOS_VEHICULO: ChecklistTemplateItem[] = [
  {
    id: 'kilometraje',
    label: 'Kilometraje actual (odómetro)',
    type: 'ENTERO',
    required: true,
    section: SEC_DATOS,
    config: { isOdometer: true },
  },
  {
    id: 'proxMant',
    label: 'Próxima mantención (km)',
    type: 'ENTERO',
    required: false,
    section: SEC_DATOS,
  },
];

/** Sección 4: carrocería (diagrama) y observaciones generales. */
const CIERRE: ChecklistTemplateItem[] = [
  {
    id: 'Carrsvg',
    label: 'Observaciones de la carrocería (ralladuras, abolladuras, etc.)',
    type: 'SVG',
    required: false,
    section: SEC_CIERRE,
    config: { svg: DIAGRAMA_CAMIONETA, parts: PARTES_CARROCERIA },
  },
  {
    id: 'observaciones',
    label: 'Observaciones generales',
    type: 'TEXTO',
    required: false,
    section: SEC_CIERRE,
  },
];

/** Plantilla completa, en el orden del formato impreso. */
export const CHECKLIST_VEHICULO_GMT: ChecklistTemplateItem[] = [
  ...DATOS_VEHICULO,
  ...ESTADO_GENERAL,
  ...EQUIPOS_EMERGENCIA,
  ...CONDICIONES_CONDUCTOR,
  ...CIERRE,
];

/** Secciones, en el mismo orden y con los mismos títulos que el PDF firmado. */
export const SECCIONES_CHECKLIST_VEHICULO: ChecklistSection[] = [
  { id: SEC_DATOS, title: 'Datos del vehículo' },
  { id: SEC_GENERAL, title: 'Estado general del vehículo' },
  { id: SEC_EMERGENCIA, title: 'Equipos de emergencia' },
  { id: SEC_CONDUCTOR, title: 'Condiciones del conductor' },
  { id: SEC_CIERRE, title: 'Carrocería y observaciones' },
];

/** Ids de los 32 ítems de estado, sin sus observaciones acompañantes. */
export const ITEMS_DE_ESTADO: string[] = [...ESTADO_GENERAL, ...EQUIPOS_EMERGENCIA]
  .filter((i) => i.type === 'ESTADO')
  .map((i) => i.id);
