import { CHECKLIST_VEHICULO_GMT } from '@gmt-platform/contracts';

import { isFailure } from './checklist.schema';
import { formatSvgAnswerValue } from './checklist-pdf.util';
import type { ChecklistFormatoData, DatoCabecera, FilaFormato } from './checklist-formato-pdf.util';

/**
 * Arma los datos del PDF con formato real a partir de un checklist enviado.
 *
 * ── Por qué agrupa por la plantilla CANÓNICA y no por la del activo ────────
 *
 * El formato impreso separa "estado general", "equipos de emergencia" y
 * "condiciones del conductor", pero las plantillas que viven en producción se
 * sembraron SIN secciones (su columna `sections` está vacía). Agrupar por lo que
 * dice la plantilla del activo dejaría los 32 ítems en una sola tabla y el PDF
 * no calzaría con el molde.
 *
 * La definición canónica sí trae la sección de cada ítem y comparte los ids con
 * las plantillas desplegadas, así que sirve de mapa. Un ítem desconocido cae a
 * "estado general" en vez de desaparecer: perder una respuesta de un documento
 * que se firma es peor que ponerla en la tabla de al lado.
 *
 * Módulo PURO: sin Prisma ni Nest.
 */

/** Una respuesta tal como se guarda en el JSON del checklist. */
export interface RespuestaGuardada {
  itemId?: unknown;
  label?: unknown;
  value?: unknown;
  comment?: unknown;
}

/** Un ítem de la plantilla del activo. */
export interface ItemPlantilla {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  config?: { obsItemId?: string; options?: string[]; failOptions?: string[] };
}

/** Documento del activo que aporta un vencimiento a la cabecera. */
export interface DocumentoVencimiento {
  name: string;
  type: string;
  expirationDate: Date | null;
}

export interface EntradaFormato {
  proyecto: string | null;
  fecha: Date;
  conductor: string | null;
  /** `'SHEETS'` cuando el checklist vino de la planilla, `null` si se hizo acá. */
  origen: string | null;
  patente: string | null;
  items: readonly ItemPlantilla[];
  answers: readonly RespuestaGuardada[];
  documentos: readonly DocumentoVencimiento[];
}

/** Fecha corta para el documento: día-mes-año, que es como se lee en faena. */
function fechaCorta(d: Date | null): string {
  if (!d) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function fechaHora(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${fechaCorta(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Valor legible de una respuesta. */
function textoValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if (typeof valor === 'number') return valor.toLocaleString('es-CL');
  return String(valor);
}

/**
 * Documentos que el formato muestra en el bloque del vehículo, en su orden.
 * La clave se busca DENTRO del tipo y del nombre porque el tipo lo escribe
 * quien sube el documento y no está normalizado.
 */
const DOCS_CABECERA: ReadonlyArray<{ etiqueta: string; claves: readonly string[] }> = [
  { etiqueta: 'Permiso de circulación:', claves: ['circulacion', 'circulación', 'permiso'] },
  { etiqueta: 'Revisión técnica:', claves: ['revision', 'revisión', 'tecnica', 'técnica'] },
  { etiqueta: 'Seguro:', claves: ['soap', 'seguro'] },
  { etiqueta: 'Extintor:', claves: ['extintor'] },
];

function buscarDocumento(
  documentos: readonly DocumentoVencimiento[],
  claves: readonly string[],
): DocumentoVencimiento | undefined {
  return documentos.find((d) => {
    const texto = `${d.type} ${d.name}`.toLowerCase();
    return claves.some((c) => texto.includes(c));
  });
}

/** Traduce un checklist enviado a los datos que dibuja el PDF del formato. */
export function construirFormato(entrada: EntradaFormato): ChecklistFormatoData {
  const porItem = new Map<string, RespuestaGuardada>();
  for (const a of entrada.answers) {
    if (a.itemId !== undefined && a.itemId !== null) porItem.set(String(a.itemId), a);
  }

  // Etiqueta de la plantilla DEL ACTIVO, que es la que vio quien llenó el
  // checklist. Si el ítem no está en esa plantilla se cae a la canónica.
  const etiquetaDeActivo = new Map<string, string>();
  for (const item of entrada.items) {
    const id = item.id === undefined || item.id === null ? '' : String(item.id);
    if (id && item.label !== undefined && item.label !== null) {
      etiquetaDeActivo.set(id, String(item.label));
    }
  }

  const estadoGeneral: FilaFormato[] = [];
  const equiposEmergencia: FilaFormato[] = [];
  const condicionesConductor: FilaFormato[] = [];

  const respuestaDe = (id: string): unknown => porItem.get(id)?.value;

  const kilometraje = textoValor(respuestaDe('kilometraje'));
  const proxMant = textoValor(respuestaDe('proxMant'));
  const observaciones = textoValor(respuestaDe('observaciones'));
  const carroceria = formatSvgAnswerValue(respuestaDe('Carrsvg'))?.lines ?? [];

  // Se recorre la definición CANÓNICA y no la del activo: trae el orden del
  // molde impreso y la lista completa. Un ítem sin responder sale con la celda
  // vacía, igual que en el formulario de papel: se ve que no se marcó, en vez
  // de desaparecer y dar la impresión de que el checklist estaba completo.
  for (const canonico of CHECKLIST_VEHICULO_GMT) {
    const id = canonico.id;
    const seccion = canonico.section ?? 'estado-general';
    if (seccion === 'datos-vehiculo' || seccion === 'cierre') continue;
    // Las observaciones acompañantes son una COLUMNA del molde, no una fila.
    if (canonico.type === 'TEXTO' && id.startsWith('obs_')) continue;

    const respuesta = porItem.get(id);
    const valor = respuesta?.value;
    const comentario =
      respuesta?.comment !== undefined && respuesta.comment !== null && respuesta.comment !== ''
        ? String(respuesta.comment)
        : undefined;

    const fila: FilaFormato = {
      etiqueta: etiquetaDeActivo.get(id) ?? canonico.label,
      valor: textoValor(valor),
      ...(comentario ? { observacion: comentario } : {}),
      esFalla:
        valor !== undefined && valor !== null && valor !== ''
          ? isFailure(canonico, valor as string | number | boolean | null)
          : false,
    };

    if (seccion === 'equipos-emergencia') equiposEmergencia.push(fila);
    else if (seccion === 'condiciones-conductor') condicionesConductor.push(fila);
    else estadoGeneral.push(fila);
  }

  const datosVehiculo: DatoCabecera[] = [
    { etiqueta: 'Patente:', valor: entrada.patente ?? 'Sin patente' },
    { etiqueta: 'Kilometraje:', valor: kilometraje || 'Sin dato' },
  ];
  if (proxMant) datosVehiculo.push({ etiqueta: 'Próxima mantención:', valor: proxMant });
  for (const d of DOCS_CABECERA) {
    const doc = buscarDocumento(entrada.documentos, d.claves);
    datosVehiculo.push({
      etiqueta: d.etiqueta,
      valor: doc ? 'Sí' : 'No registrado',
      ...(doc?.expirationDate ? { vencimiento: fechaCorta(doc.expirationDate) } : {}),
    });
  }

  return {
    proyecto: entrada.proyecto ?? 'Global / sin proyecto',
    fecha: fechaHora(entrada.fecha),
    conductor: entrada.conductor ?? 'Sin registrar',
    ...(entrada.origen === 'SHEETS'
      ? {
          origenExterno:
            'Importado desde la planilla de checklists. El conductor es el nombre que traía ese ' +
            'registro y no una firma hecha en GMT Link.',
        }
      : {}),
    datosConductor: [],
    datosVehiculo,
    estadoGeneral,
    equiposEmergencia,
    condicionesConductor,
    carroceria,
    observaciones,
  };
}
