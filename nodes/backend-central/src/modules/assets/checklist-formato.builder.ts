import { CHECKLIST_VEHICULO_GMT } from '@gmt-platform/contracts';

import { isFailure } from './checklist.schema';
import { formatSvgAnswerValue } from './checklist-pdf.util';
import {
  FILAS_CONDUCTOR,
  FILAS_EMERGENCIA,
  FILAS_GENERAL,
  type ChecklistFormatoData,
  type DatoCabecera,
  type DocumentoFormato,
  type FilaFormato,
} from './checklist-formato-pdf.util';

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
  /**
   * Licencias del conductor, ya resueltas entre lo declarado y RRHH. El
   * llamador las arma con `construirDatosConductor`; acá solo se copian al
   * bloque que el PDF reserva.
   */
  datosConductor?: readonly DatoCabecera[];
  /** `'SHEETS'` cuando el checklist vino de la planilla, `null` si se hizo acá. */
  origen: string | null;
  /** Lo llenó alguien sin cuenta desde el QR: el nombre es el que escribió. */
  sinVerificar?: boolean;
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

/** Fecha como la escribe la planilla del formato: dd/mm/aaaa. */
function fechaPlanilla(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Número tal cual, sin separador de miles: el formato muestra "25792". */
function numeroPlano(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '';
  return String(valor);
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
const DOCS_CABECERA = {
  permiso: ['circulacion', 'circulación', 'permiso'],
  revision: ['revision', 'revisión', 'tecnica', 'técnica'],
  seguro: ['soap', 'seguro'],
  extintor: ['extintor'],
} as const;

/** Filas que el formato impreso tiene, por sección. */
const FILAS_DEL_FORMATO: Record<string, ReadonlySet<string>> = {
  'estado-general': new Set(FILAS_GENERAL),
  'equipos-emergencia': new Set(FILAS_EMERGENCIA),
  'condiciones-conductor': new Set(FILAS_CONDUCTOR),
};

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

  const kilometraje = numeroPlano(respuestaDe('kilometraje'));
  const proxMant = numeroPlano(respuestaDe('proxMant'));
  // Respuestas sin fila en el formato impreso: van a observaciones generales.
  const extras: string[] = [];
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
      id,
      etiqueta: etiquetaDeActivo.get(id) ?? canonico.label,
      valor: textoValor(valor),
      ...(comentario ? { observacion: comentario } : {}),
      esFalla:
        valor !== undefined && valor !== null && valor !== ''
          ? isFailure(canonico, valor as string | number | boolean | null)
          : false,
    };

    // Un ítem que el formato impreso no trae (el AdBlue se agregó después) no
    // tiene fila donde ir: si se respondió, se lleva a observaciones generales.
    const seccionDelFormato = FILAS_DEL_FORMATO[seccion] ?? FILAS_DEL_FORMATO['estado-general'];
    if (!seccionDelFormato?.has(id)) {
      if (fila.valor || fila.observacion) {
        extras.push(
          `${fila.etiqueta}: ${[fila.valor, fila.observacion].filter(Boolean).join(' — ')}`,
        );
      }
      continue;
    }

    if (seccion === 'equipos-emergencia') equiposEmergencia.push(fila);
    else if (seccion === 'condiciones-conductor') condicionesConductor.push(fila);
    else estadoGeneral.push(fila);
  }

  // Respuestas a ítems que ni siquiera están en la plantilla canónica (una
  // plantilla hecha a mano, por ejemplo). Tampoco se pierden.
  const canonicos = new Set(CHECKLIST_VEHICULO_GMT.map((c) => c.id));
  for (const item of entrada.items) {
    const id = item.id === undefined || item.id === null ? '' : String(item.id);
    if (!id || canonicos.has(id) || item.type === 'FIRMA' || id.startsWith('obs_')) continue;
    const valor = textoValor(respuestaDe(id));
    if (valor) extras.push(`${etiquetaDeActivo.get(id) ?? id}: ${valor}`);
  }

  const documento = (claves: readonly string[]): DocumentoFormato => {
    const doc = buscarDocumento(entrada.documentos, claves);
    if (!doc) return { presente: false };
    return doc.expirationDate
      ? { presente: true, vencimiento: fechaCorta(doc.expirationDate) }
      : { presente: true };
  };

  const avisos: string[] = [];
  if (entrada.origen === 'SHEETS') {
    avisos.push(
      'Importado desde la planilla de checklists: el conductor es el nombre que traía ese registro, no una firma hecha en GMT Link.',
    );
  } else if (entrada.sinVerificar) {
    avisos.push(
      'Llenado sin cuenta en GMT Link (sin verificar): el nombre y los datos del conductor son los que declaró quien lo llenó.',
    );
  }

  return {
    proyecto: entrada.proyecto ?? 'Global / sin proyecto',
    fecha: fechaPlanilla(entrada.fecha),
    conductor: entrada.conductor ?? 'Sin registrar',
    datosConductor: entrada.datosConductor ?? [],
    vehiculo: {
      patente: entrada.patente ?? 'Sin patente',
      kilometraje,
      proxMant,
      permiso: documento(DOCS_CABECERA.permiso),
      revision: documento(DOCS_CABECERA.revision),
      seguro: documento(DOCS_CABECERA.seguro),
      extintor: documento(DOCS_CABECERA.extintor),
    },
    estadoGeneral,
    equiposEmergencia,
    condicionesConductor,
    extras,
    avisos,
    carroceria,
    observaciones,
  };
}
