/**
 * Avance real por semana, ponderado por horas hombre.
 *
 * Es como lo calcula el informe que GMT le entrega al cliente: una actividad
 * pesa lo que pesan sus HH en el programa, no lo mismo que cualquier otra.
 * Contar actividades respondería otra pregunta ("cuántas van"), no la del
 * contrato ("cuánto del trabajo va ejecutado").
 *
 * Los hitos (`hh = 0`) no pesan: marcan fechas, no trabajo.
 *
 * ── Por qué `null` y no cero ───────────────────────────────────────────────
 *
 * `realByWeek` es el acumulado 0-1 por semana desde S-1, sin huecos: su largo
 * dice hasta qué semana hay informe. Una semana sin informe devuelve `null`,
 * nunca cero. Cero significa "no se avanzó", que es otra cosa: dibujado en la
 * curva, haría que el avance real se desplome a plano en vez de terminar donde
 * termina el último corte.
 *
 * Módulo PURO: sin Prisma ni Nest, para poder contrastarlo con los números de
 * un informe firmado.
 */

/** Una actividad del programa con su peso y su avance informado. */
export interface ActividadConHh {
  hh: number;
  /** Acumulado 0-1 por semana desde S-1. Índice 0 = S-1. */
  realByWeek: number[];
}

export interface AvanceDeSemana {
  /** Acumulado 0-1, o `null` si esa semana todavía no tiene informe. */
  acm: number | null;
  /** Avance de la semana (acumulado menos el anterior), o `null`. */
  par: number | null;
}

export function avanceSemanal(
  actividades: readonly ActividadConHh[],
  semanas: number,
): AvanceDeSemana[] {
  const conPeso = actividades.filter((a) => a.hh > 0);
  const hhTotal = conPeso.reduce((suma, a) => suma + a.hh, 0);

  const acumulados: Array<number | null> = [];
  for (let semana = 0; semana < semanas; semana += 1) {
    // La semana tiene informe si ALGUNA actividad con peso lo trae. Una que
    // todavía no reportó cuenta como cero y no excluye la semana entera: en un
    // programa de 38 actividades siempre hay alguna que aún no empieza.
    const hayInforme = conPeso.some((a) => a.realByWeek.length > semana);
    if (hhTotal === 0 || !hayInforme) {
      acumulados.push(null);
      continue;
    }
    const ponderado = conPeso.reduce(
      (suma, a) => suma + a.hh * (a.realByWeek[semana] ?? 0),
      0,
    );
    acumulados.push(ponderado / hhTotal);
  }

  return acumulados.map((acm, i) => {
    if (acm === null) return { acm: null, par: null };
    // La semana anterior sin informe se trata como 0: es el arranque del
    // programa, donde no había nada ejecutado.
    const previo = i === 0 ? 0 : (acumulados[i - 1] ?? 0);
    return { acm, par: acm - previo };
  });
}
