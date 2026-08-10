/**
 * Clasifica los archivos de documentos de un recurso a partir de su nombre.
 *
 * Los documentos de la flota vienen en carpetas por vehículo, con nombres
 * escritos a mano a lo largo de los años: "Permiso circulación, VGWB-71
 * 31-08-2026.pdf", "SOAP VGWB71.pdf", "Certificado barra exterior SKRF-88.pdf".
 * De ahí hay que sacar tres cosas: de qué TIPO es, cómo llamarlo, y cuándo
 * vence si el nombre lo dice.
 *
 * ── Qué hace y qué NO ──────────────────────────────────────────────────────
 *
 * Reconoce el tipo por palabras clave, y cuando no lo logra devuelve `OTRO` en
 * vez de forzar una categoría: un permiso de circulación clasificado como SOAP
 * dispararía avisos de vencimiento equivocados y daría por cubierto un
 * documento que falta.
 *
 * La fecha SOLO se toma cuando el nombre la trae explícita. No se infiere de la
 * fecha del archivo ni de nada más: un vencimiento inventado es peor que ninguno,
 * porque el sistema avisaría (o dejaría de avisar) por una fecha que nadie puso.
 *
 * Módulo PURO: sin Prisma ni Nest.
 */

/** Tipos que la ficha del vehículo reconoce y vigila. */
export type TipoDocumento =
  | 'PERMISO_CIRCULACION'
  | 'REVISION_TECNICA'
  | 'SOAP'
  | 'BARRA_ANTIVUELCO'
  | 'CUNAS'
  | 'HOMOLOGACION'
  | 'GPS'
  | 'MANTENCION'
  | 'FACTURA'
  | 'POLIZA'
  | 'PADRON'
  | 'OTRO';

export interface DocumentoClasificado {
  tipo: TipoDocumento;
  /** Nombre legible para la ficha. */
  nombre: string;
  /** Vencimiento leído del nombre del archivo; `null` si no lo trae. */
  vencimiento: Date | null;
}

/** Quita tildes y baja a minúsculas para comparar sin sorpresas. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Reglas de clasificación, EN ORDEN: la primera que calza gana.
 *
 * El orden importa. "Certificado de mantención" trae "certificado", así que
 * mantención tiene que evaluarse antes que cualquier regla que mire esa
 * palabra suelta. Las reglas específicas van primero y las genéricas al final.
 */
interface Regla {
  tipo: TipoDocumento;
  nombre: string;
  claves: readonly string[];
  /**
   * ¿La fecha que trae el nombre es un VENCIMIENTO?
   *
   * No siempre lo es, y la diferencia importa. En "Permiso circulación
   * 31-08-2026" la fecha dice hasta cuándo vale. En "Certificado mantención
   * SRPB-37 02-04-2024" dice cuándo se hizo el servicio: guardarla como
   * vencimiento haría que la plataforma avise que un certificado de 2024 está
   * vencido, que no significa nada, y llenaría de ruido los avisos reales.
   *
   * Cuando la fecha NO es vencimiento se conserva en el NOMBRE, porque ahí es
   * lo único que distingue un certificado de otro del mismo vehículo.
   */
  fechaEsVencimiento: boolean;
}

const REGLAS: readonly Regla[] = [
  { tipo: 'PERMISO_CIRCULACION', nombre: 'Permiso de circulación', claves: ['permiso circulacion', 'permiso de circulacion', 'permiso circulaci'], fechaEsVencimiento: true },
  { tipo: 'REVISION_TECNICA', nombre: 'Revisión técnica', claves: ['revision tecnica', 'revision tecnic', 'rev tecnica'], fechaEsVencimiento: true },
  { tipo: 'SOAP', nombre: 'SOAP', claves: ['soap', 'seguro obligatorio'], fechaEsVencimiento: true },
  // ROPS = Roll-Over Protection Structure, que es exactamente la barra
  // antivuelco. Los certificados vienen con las dos nomenclaturas.
  { tipo: 'BARRA_ANTIVUELCO', nombre: 'Certificación de barra antivuelco', claves: ['barra antivuelco', 'barra exterior', 'barra interior', 'antivuelco', 'rops'], fechaEsVencimiento: true },
  { tipo: 'CUNAS', nombre: 'Certificación de cuñas', claves: ['cuna', 'cuña'], fechaEsVencimiento: true },
  // La fecha es cuándo se hizo el servicio, no un vencimiento.
  { tipo: 'MANTENCION', nombre: 'Certificado de mantención', claves: ['mantencion', 'mantenimiento', 'cert mant'], fechaEsVencimiento: false },
  { tipo: 'HOMOLOGACION', nombre: 'Homologación', claves: ['homologacion'], fechaEsVencimiento: false },
  { tipo: 'GPS', nombre: 'Certificado GPS', claves: ['gps'], fechaEsVencimiento: false },
  { tipo: 'POLIZA', nombre: 'Póliza de seguro', claves: ['poliza', 'polizas'], fechaEsVencimiento: true },
  { tipo: 'FACTURA', nombre: 'Factura de compra', claves: ['factura'], fechaEsVencimiento: false },
  { tipo: 'PADRON', nombre: 'Padrón / inscripción', claves: ['padron', 'inscripcion', 'inscripccion', 'primera inscrip'], fechaEsVencimiento: false },
  // ÚLTIMO recurso, después de todas las reglas específicas: un archivo que solo
  // dice "permiso" dentro de una carpeta de documentos de vehículo es un permiso
  // de circulación. Cubre los que vienen mal escritos ("Permiso curculación"),
  // que de otro modo caerían en OTRO y dejarían al vehículo sin ese documento.
  { tipo: 'PERMISO_CIRCULACION', nombre: 'Permiso de circulación', claves: ['permiso'], fechaEsVencimiento: true },
];

/**
 * Fecha de vencimiento escrita en el nombre.
 *
 * Se aceptan `31-08-2026`, `31/08/2026` y `31-8-26`. El día va primero, que es
 * como se escribe en Chile. Se descarta cualquier cosa que no sea una fecha
 * válida para no convertir un número de serie en un vencimiento.
 */
export function vencimientoDelNombre(nombre: string): Date | null {
  const m = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(nombre);
  if (!m) return null;

  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let anio = Number(m[3]);
  if (anio < 100) anio += 2000;

  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  // Solo fechas plausibles para un vencimiento de documento vehicular. Un
  // "2015" en el nombre suele ser el año del modelo, no un vencimiento.
  if (anio < 2020 || anio > 2040) return null;

  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  // Rebote del mes: 31-02 daría 3 de marzo, señal de que no era una fecha.
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;
  return fecha;
}

/**
 * Nombre legible: sin extensión y sin la patente repetida.
 *
 * La fecha se quita SOLO cuando es un vencimiento (ya viaja en su propio campo).
 * Cuando es la fecha del servicio se conserva, porque es lo único que distingue
 * un certificado de mantención de los otros siete del mismo vehículo: quitarla
 * los colapsaba en un solo nombre y siete documentos se perdían.
 */
function nombreLegible(
  archivo: string,
  base: string,
  patente: string | null,
  quitarFecha: boolean,
): string {
  const sinExt = archivo.replace(/\.[^.]+$/, '');
  let limpio = sinExt;
  if (patente) {
    // La patente se escribe con y sin guion; se quitan las dos formas.
    const conGuion = `${patente.slice(0, 4)}-${patente.slice(4)}`;
    for (const p of [patente, conGuion]) {
      limpio = limpio.replace(new RegExp(p, 'gi'), '');
    }
  }
  if (quitarFecha) {
    limpio = limpio.replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '');
  }
  limpio = limpio
    .replace(/[,_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s-]+|[\s-]+$/g, '')
    .trim();

  // Si al limpiar no queda nada útil, manda el nombre del tipo.
  return limpio.length >= 4 ? limpio : base;
}

/**
 * Clasifica un archivo. `patente` se usa solo para limpiar el nombre visible.
 */
export function clasificarDocumento(archivo: string, patente: string | null = null): DocumentoClasificado {
  const norm = normalizar(archivo);
  const regla = REGLAS.find((r) => r.claves.some((c) => norm.includes(c)));
  const base = regla?.nombre ?? 'Documento';
  const fecha = vencimientoDelNombre(archivo);
  // Sin regla (OTRO) no se sabe qué significa la fecha, así que NO se guarda
  // como vencimiento: inventarlo dispararía avisos por algo que nadie declaró.
  const esVencimiento = regla?.fechaEsVencimiento === true;

  return {
    tipo: regla?.tipo ?? 'OTRO',
    nombre: nombreLegible(archivo, base, patente, esVencimiento),
    vencimiento: esVencimiento ? fecha : null,
  };
}

/**
 * Patente que nombra una carpeta de documentos.
 *
 * Las carpetas se llaman "Documentos Camioneta Great Wall VGWB-71 Roja", así que
 * hay que rescatar la placa de una frase. Devuelve `null` cuando no hay ninguna
 * reconocible, para que el llamador lo reporte en vez de adivinar.
 */
export function patenteDeCarpeta(carpeta: string): string | null {
  const texto = normalizar(carpeta).toUpperCase();
  const m = /\b([A-Z]{4})[\s.-]?(\d{2})\b/.exec(texto) ?? /\b([A-Z]{2})[\s.-]?(\d{4})\b/.exec(texto);
  return m ? `${m[1]}${m[2]}` : null;
}
