import type { HrEstado, HrVigencia } from '@gmt-platform/contracts';
import { AVISO_TEMPRANO_DIAS, diasHasta } from '../assets/expiry-notices.util';

/**
 * Vigencia de un requisito de RRHH según su fecha de vencimiento.
 *
 * La ventana de "por vencer" NO se inventa acá: son los mismos 30 días que la
 * plataforma ya usa para avisar por la documentación de los vehículos
 * (`expiry-notices.util`). Tener dos umbrales distintos para la misma pregunta
 * —"¿esto está por vencer?"— sería una trampa para quien mira los dos tableros.
 *
 * Módulo PURO: es aritmética de fechas, que es donde se cometen los errores, y
 * así se prueba sin base de datos.
 */

/** Días de anticipación con que un vencimiento pasa a contarse como próximo. */
export const DIAS_POR_VENCER = AVISO_TEMPRANO_DIAS;

/**
 * Estado de un requisito.
 *
 * `expiresAt` en `null` es ambiguo por sí solo, así que el llamador declara con
 * `caduca` de qué caso se trata: un documento que no vence nunca no es lo mismo
 * que uno al que todavía no le cargaron la fecha, y confundirlos haría pasar un
 * dato faltante por uno tranquilizador.
 */
export function estadoDe(expiresAt: Date | null | undefined, hoy: Date, caduca = true): HrEstado {
  if (!expiresAt) {
    return {
      vigencia: caduca ? 'SIN_FECHA' : 'SIN_VENCIMIENTO',
      diasRestantes: null,
    };
  }
  const diasRestantes = diasHasta(expiresAt, hoy);
  let vigencia: HrVigencia;
  if (diasRestantes < 0) vigencia = 'VENCIDO';
  else if (diasRestantes <= DIAS_POR_VENCER) vigencia = 'POR_VENCER';
  else vigencia = 'VIGENTE';
  return { vigencia, diasRestantes };
}

/** ¿Este estado merece aparecer en las alertas? */
export function esAlerta(estado: HrEstado): boolean {
  return estado.vigencia === 'VENCIDO' || estado.vigencia === 'POR_VENCER';
}

/**
 * Orden de las alertas: primero lo vencido y, dentro de cada grupo, lo más
 * urgente. Lo que lleva más tiempo vencido va antes que lo que venció ayer.
 */
export function porUrgencia(a: HrEstado, b: HrEstado): number {
  const da = a.diasRestantes ?? Number.MAX_SAFE_INTEGER;
  const db = b.diasRestantes ?? Number.MAX_SAFE_INTEGER;
  return da - db;
}

/**
 * Horas entre dos marcas de tiempo, redondeadas a dos decimales.
 *
 * Un registro sin cierre (`endedAt` null) vale 0: la actividad está en curso y
 * contarla hasta "ahora" haría que el mismo período diera distinto según cuándo
 * se consulte el gráfico. El total se acompaña de cuántos registros quedaron
 * abiertos para que eso quede dicho y no escondido.
 */
export function horasEntre(startedAt: Date, endedAt: Date | null): number {
  if (!endedAt) return 0;
  const ms = endedAt.getTime() - startedAt.getTime();
  if (ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}
