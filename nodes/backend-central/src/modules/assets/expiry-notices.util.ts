/**
 * Cuándo avisar que un documento de un activo está por vencer.
 *
 * Calendario decidido por el dueño: un aviso a los 30 días, otro a los 10,
 * diario durante los últimos 5, y luego cada 3 días mientras siga vencido. La
 * alerta solo se apaga renovando el documento, nunca por el paso del tiempo.
 *
 * Módulo PURO (sin Prisma ni Nest) para que las reglas se prueben sin base de
 * datos: son aritmética de fechas, y ahí es donde se cometen los errores.
 *
 * ── Por qué "hitos" y no "¿hoy toca?" ──────────────────────────────────────
 *
 * La implementación ingenua sería preguntar `diasRestantes === 30`. Eso falla en
 * cuanto el proceso no corre un día (despliegue, caída, fin de semana con el
 * servicio dormido): el día 30 pasa sin aviso y nadie se entera nunca, porque al
 * día siguiente ya son 29.
 *
 * En vez de eso, cada documento tiene un HITO VIGENTE según los días que le
 * queden, y el aviso se manda si ese hito todavía no se envió. Si el proceso se
 * salta días, al volver calcula el hito de HOY y lo manda; los intermedios que
 * ya no aplican se pierden a propósito, porque avisar "faltan 30 días" cuando
 * faltan 8 sería peor que no avisar.
 */

/** Umbral en días para el primer aviso. */
export const AVISO_TEMPRANO_DIAS = 30;
/** Umbral en días para el segundo aviso. */
export const AVISO_MEDIO_DIAS = 10;
/** Desde cuántos días restantes el aviso pasa a ser diario. */
export const AVISO_DIARIO_DESDE_DIAS = 5;
/** Cada cuántos días se insiste una vez vencido. */
export const AVISO_VENCIDO_CADA_DIAS = 3;

/** Urgencia del aviso, para ordenar en la bandeja y decidir el tono del texto. */
export type UrgenciaAviso = 'informativo' | 'proximo' | 'critico' | 'vencido';

export interface HitoAviso {
  /**
   * Clave única del aviso para ESTE documento. Es lo que da idempotencia: se
   * guarda al enviar y no se repite. Distinta por tramo, por día en el tramo
   * diario, y por bloque de 3 días en el tramo vencido.
   */
  clave: string;
  urgencia: UrgenciaAviso;
  /** Días que faltan (negativo si ya venció). */
  diasRestantes: number;
}

/**
 * Días completos entre `desde` y `hasta`, comparando por DÍA CALENDARIO.
 *
 * Se normalizan ambas fechas a medianoche a propósito: sin eso, un documento que
 * vence "hoy a las 23:00" daría 0 días si se consulta a las 22:00 y -1 a la
 * medianoche, y el hito cambiaría según la hora en que corriera el proceso.
 */
export function diasHasta(vencimiento: Date, hoy: Date): number {
  const a = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const b = Date.UTC(
    vencimiento.getFullYear(),
    vencimiento.getMonth(),
    vencimiento.getDate(),
  );
  return Math.round((b - a) / 86_400_000);
}

/**
 * Hito de aviso vigente hoy para un documento, o `null` si todavía no
 * corresponde avisar (falta más de un mes).
 */
export function hitoVigente(diasRestantes: number): HitoAviso | null {
  if (diasRestantes > AVISO_TEMPRANO_DIAS) {
    return null;
  }
  if (diasRestantes > AVISO_MEDIO_DIAS) {
    return { clave: 'antes-30', urgencia: 'informativo', diasRestantes };
  }
  if (diasRestantes > AVISO_DIARIO_DESDE_DIAS) {
    return { clave: 'antes-10', urgencia: 'proximo', diasRestantes };
  }
  if (diasRestantes >= 0) {
    // Tramo diario: la clave lleva el día, así que cada jornada manda uno.
    return { clave: `dia-${diasRestantes}`, urgencia: 'critico', diasRestantes };
  }
  // Vencido: se agrupa en bloques de 3 días. Usar el bloque y no "el día es
  // múltiplo de 3" hace que un proceso que se saltó una corrida igual avise, en
  // vez de esperar otros 3 días.
  const diasVencido = -diasRestantes;
  const bloque = Math.floor(diasVencido / AVISO_VENCIDO_CADA_DIAS) * AVISO_VENCIDO_CADA_DIAS;
  return { clave: `vencido-${bloque}`, urgencia: 'vencido', diasRestantes };
}

/** Título del aviso, en español chileno y diciendo el plazo real. */
export function tituloAviso(nombreDocumento: string, hito: HitoAviso): string {
  const d = hito.diasRestantes;
  if (d < 0) {
    const dias = -d;
    return `${nombreDocumento} está vencido hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  }
  if (d === 0) {
    return `${nombreDocumento} vence hoy`;
  }
  return `${nombreDocumento} vence en ${d} ${d === 1 ? 'día' : 'días'}`;
}

/** Cuerpo del aviso: identifica el vehículo y dice qué hacer. */
export function cuerpoAviso(
  patenteOCodigo: string,
  nombreVehiculo: string,
  hito: HitoAviso,
): string {
  const vehiculo = `${patenteOCodigo} (${nombreVehiculo})`;
  if (hito.diasRestantes < 0) {
    return (
      `El vehículo ${vehiculo} tiene documentación vencida. Sube el documento ` +
      `renovado para que deje de circular en falta.`
    );
  }
  return `Vehículo ${vehiculo}. Sube el documento renovado antes de la fecha de vencimiento.`;
}
