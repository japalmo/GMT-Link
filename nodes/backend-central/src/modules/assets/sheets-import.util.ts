import {
  CHECKLIST_VEHICULO_GMT,
  ITEMS_DE_ESTADO,
  PARTES_CARROCERIA,
  type ChecklistAnswer,
} from '@gmt-platform/contracts';

import {
  normalizarBooleano,
  normalizarEstado,
  normalizarFecha,
  normalizarNombre,
  normalizarNumero,
  normalizarPatente,
  normalizarTexto,
} from './sheets-normalize.util';

/**
 * Traduce una fila de la planilla al formato de respuestas de GMT Link.
 *
 * El mapeo es directo columna→ítem porque la plantilla se construyó con los
 * mismos ids que usa la planilla (ver `vehicle-checklist.ts`). No hay tabla de
 * equivalencias que mantener.
 *
 * Módulo PURO: sin Prisma ni Nest, para poder probarlo contra las filas reales
 * sin base de datos.
 */

/** Lo que se necesita de una fila para poder guardarla. */
export interface RegistroImportado {
  /** `idForm` de la planilla: lo que da idempotencia a la importación. */
  externalId: string;
  /** Patente ya normalizada, para buscar el vehículo. */
  patente: string;
  /** Fecha real del checklist, NO la de importación. */
  fecha: Date;
  /** Nombre del conductor tal como venía. Informativo, no es autoría. */
  conductor: string | null;
  answers: ChecklistAnswer[];
}

/** Por qué una fila no se pudo importar, en texto que una persona entienda. */
export interface FilaDescartada {
  fila: number;
  externalId: string | null;
  motivo: string;
}

const ITEMS = new Map(CHECKLIST_VEHICULO_GMT.map((i) => [i.id, i]));

/** Nombre de la columna de observación en la PLANILLA: `sistemaFrenos` -> `obsSistemaFrenos`. */
function columnaObservacion(idItem: string): string {
  return `obs${idItem.charAt(0).toUpperCase()}${idItem.slice(1)}`;
}

/**
 * Nombre de parte de carrocería -> id, incluyendo los nombres ANTIGUOS con los
 * que la planilla los escribió durante años.
 *
 * Los cuatro alias con nombre equivocado se mantienen para poder leer lo ya
 * registrado: las observaciones históricas dicen "Farro derecho" y si el mapa
 * solo conociera "Faro derecho" se perderían en silencio.
 */
const PARTE_POR_NOMBRE = new Map<string, string>();
for (const p of PARTES_CARROCERIA) {
  PARTE_POR_NOMBRE.set(p.name.toLowerCase(), p.id);
}
// Alias históricos. Los tres primeros son AMBIGUOS en el origen: dos zonas
// distintas compartían el mismo nombre, así que un comentario viejo no dice a
// cuál de las dos se refería. Se resuelve hacia la que el nombre describe bien.
PARTE_POR_NOMBRE.set('farro derecho', 'faro_dd');
PARTE_POR_NOMBRE.set('espejo izquierdo', 'espj_i');
PARTE_POR_NOMBRE.set('ventana delantera derecha', 'ventana_dd');
PARTE_POR_NOMBRE.set('ventana trasera derecha', 'ventana_td');

/**
 * Convierte las observaciones de carrocería en el mapa de comentarios del
 * diagrama.
 *
 * La planilla las guarda como una lista: "• Parachoques trasero: Chocado".
 * Lo que no calce con ninguna parte conocida NO se descarta: se devuelve aparte
 * para colgarlo de las observaciones generales, porque perder el registro de un
 * daño es peor que guardarlo en un lugar menos preciso.
 */
export function parsearObservacionesCarroceria(crudo: unknown): {
  mapa: Record<string, { part: string; comment: string }>;
  sinUbicar: string[];
} {
  const mapa: Record<string, { part: string; comment: string }> = {};
  const sinUbicar: string[] = [];
  const texto = normalizarTexto(String(crudo ?? '').replace(/\r/g, ''));
  if (!texto) return { mapa, sinUbicar };

  for (const linea of String(crudo).split(/[\n•]/)) {
    const t = linea.trim().replace(/^[-•*]\s*/, '');
    if (!t) continue;
    const sep = t.indexOf(':');
    if (sep === -1) {
      sinUbicar.push(t);
      continue;
    }
    const nombre = t.slice(0, sep).trim().toLowerCase();
    const comentario = t.slice(sep + 1).trim();
    const id = PARTE_POR_NOMBRE.get(nombre);
    if (id && comentario) {
      const parte = PARTES_CARROCERIA.find((p) => p.id === id);
      mapa[id] = { part: parte?.name ?? nombre, comment: comentario };
    } else {
      sinUbicar.push(t);
    }
  }
  return { mapa, sinUbicar };
}

/** Índice de columna por nombre, a partir de la cabecera de la planilla. */
export function indexarCabecera(cabecera: string[]): Map<string, number> {
  const mapa = new Map<string, number>();
  cabecera.forEach((c, i) => {
    if (c) mapa.set(c.trim(), i);
  });
  return mapa;
}

/**
 * Traduce una fila a un registro importable.
 *
 * Devuelve `null` con su motivo cuando la fila no sirve. Se exige `idForm`,
 * patente reconocible y fecha: sin id no hay forma de evitar duplicarla al
 * reimportar, sin patente no se sabe de qué vehículo es, y sin fecha el registro
 * desordenaría la serie del odómetro.
 */
export function mapearFila(
  fila: string[],
  col: Map<string, number>,
  numeroFila: number,
): { registro: RegistroImportado } | { descarte: FilaDescartada } {
  const leer = (nombre: string): string | undefined => {
    const i = col.get(nombre);
    // Google recorta las filas por la derecha cuando las últimas columnas están
    // vacías, así que el índice puede quedar fuera del arreglo.
    return i === undefined ? undefined : fila[i];
  };

  const externalId = normalizarTexto(leer('idForm'));
  if (!externalId) {
    return { descarte: { fila: numeroFila, externalId: null, motivo: 'Sin idForm.' } };
  }

  const patente = normalizarPatente(leer('patente'));
  if (!patente) {
    return {
      descarte: {
        fila: numeroFila,
        externalId,
        motivo: `Patente no reconocible: ${JSON.stringify(leer('patente') ?? '')}.`,
      },
    };
  }

  const fecha = normalizarFecha(leer('datetime'));
  if (!fecha) {
    return {
      descarte: {
        fila: numeroFila,
        externalId,
        motivo: `Fecha no interpretable: ${JSON.stringify(leer('datetime') ?? '')}.`,
      },
    };
  }

  const answers: ChecklistAnswer[] = [];
  // El `label` viaja con cada respuesta (así lo define el contrato) y sale de la
  // plantilla, no de la planilla: es la etiqueta que verá quien lea el checklist
  // en GMT Link o en el PDF.
  const etiqueta = (id: string): string => ITEMS.get(id)?.label ?? id;

  // Los 32 ítems de estado con su observación.
  for (const id of ITEMS_DE_ESTADO) {
    const valor = normalizarEstado(leer(id));
    if (valor === null) continue;
    // La COLUMNA de la planilla, que no es lo mismo que el id del ítem: la
    // planilla escribe `obsSistemaFrenos` y la plantilla usa `obs_sistemaFrenos`.
    // Antes se usaba `config.obsItemId` para leer la columna, lo que funcionaba
    // solo mientras las dos convenciones coincidieran por casualidad.
    const comentario = normalizarTexto(leer(columnaObservacion(id)));
    answers.push({
      itemId: id,
      label: etiqueta(id),
      value: valor,
      ...(comentario ? { comment: comentario } : {}),
    });
  }

  // Números.
  for (const id of ['kilometraje', 'proxMant', 'horasDescanso']) {
    const n = normalizarNumero(leer(id));
    if (n !== null) answers.push({ itemId: id, label: etiqueta(id), value: n });
  }

  // Preguntas del conductor.
  for (const id of ['capacidadConducir', 'medicamentosSueno', 'problemasInquietan']) {
    const b = normalizarBooleano(leer(id));
    if (b !== null) answers.push({ itemId: id, label: etiqueta(id), value: b });
  }

  // Carrocería: el diagrama marcado.
  const { mapa, sinUbicar } = parsearObservacionesCarroceria(leer('obsCarr'));
  if (Object.keys(mapa).length > 0) {
    answers.push({ itemId: 'Carrsvg', label: etiqueta('Carrsvg'), value: JSON.stringify(mapa) });
  }

  // Observaciones generales, más lo de carrocería que no se pudo ubicar en una
  // parte concreta (se anota de dónde viene para que no parezca un comentario
  // suelto del conductor).
  const generales = normalizarTexto(leer('observaciones'));
  const extra = sinUbicar.length > 0 ? `Carrocería: ${sinUbicar.join('; ')}` : null;
  const observaciones = [generales, extra].filter(Boolean).join('\n');
  if (observaciones) {
    answers.push({ itemId: 'observaciones', label: etiqueta('observaciones'), value: observaciones });
  }

  // Una fila que no aportó NINGUNA respuesta legible no es un checklist: es una
  // fila a medio llenar o un resto de la planilla. Guardarla mostraría un
  // registro vacío en el historial del vehículo y contaría como un checklist
  // hecho que en realidad nunca se hizo.
  if (answers.length === 0) {
    return {
      descarte: { fila: numeroFila, externalId, motivo: 'No trae ninguna respuesta legible.' },
    };
  }

  return {
    registro: {
      externalId,
      patente,
      fecha,
      conductor: normalizarNombre(leer('nombreTrab')),
      answers,
    },
  };
}
