import type { ObraWeather, ObraWeatherAlert } from '@gmt-platform/contracts';

/**
 * Condiciones en faena y sus alertas. La derivación es PURA para poder probarla
 * con valores fijos; la llamada al servicio meteorológico vive aparte.
 */

/**
 * Umbrales de alerta, todos en un solo lugar para que Prevención los ajuste sin
 * tocar la lógica. Están calibrados para faena minera en el norte de Chile:
 *
 * - Viento: sobre 40 km/h se avisa; sobre 55 no se iza carga. Es el criterio
 *   habitual de operación de grúas y de trabajo en altura.
 * - Ráfaga: pesa más que el viento medio para izaje, por eso va más alto.
 * - UV: la escala OMS marca "muy alto" en 8 y "extremo" en 11. En Atacama el
 *   índice pasa de 11 en verano, así que no es un caso teórico.
 * - Temperatura: los extremos que gatillan pausas y control de hidratación.
 *
 * Si Prevención define otros valores, se cambian acá y nada más.
 */
export const UMBRALES_CLIMA = {
  vientoAviso: 40,
  vientoCritico: 55,
  rafagaAviso: 60,
  rafagaCritico: 75,
  uvAlto: 8,
  uvExtremo: 11,
  frio: 2,
  calor: 32,
} as const;

/** Lo que necesita el cálculo, ya normalizado desde el proveedor. */
export interface LecturaClima {
  observedAt: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  windGusts: number;
  windDirection: number;
  uvIndex: number;
  uvIndexMax: number;
  windSpeedMax: number;
}

function redondear(n: number, decimales = 1): number {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

/**
 * Alertas vigentes según los umbrales. El mensaje dice qué hacer, no solo qué
 * pasa: en la TV de faena un número sin consecuencia no cambia una decisión.
 */
export function alertasDe(l: LecturaClima): ObraWeatherAlert[] {
  const alertas: ObraWeatherAlert[] = [];
  const u = UMBRALES_CLIMA;

  if (l.windSpeed >= u.vientoCritico) {
    alertas.push({
      key: 'VIENTO',
      level: 'CRITICO',
      message: `Viento ${redondear(l.windSpeed)} km/h: suspender izaje y trabajo en altura.`,
    });
  } else if (l.windSpeed >= u.vientoAviso) {
    alertas.push({
      key: 'VIENTO',
      level: 'AVISO',
      message: `Viento ${redondear(l.windSpeed)} km/h: evaluar izaje antes de continuar.`,
    });
  }

  // La ráfaga solo se informa aparte si supera su propio umbral y el viento
  // medio no disparó ya la alerta crítica: si no, se repite el mismo aviso.
  if (l.windGusts >= u.rafagaCritico && l.windSpeed < u.vientoCritico) {
    alertas.push({
      key: 'RAFAGA',
      level: 'CRITICO',
      message: `Ráfagas de ${redondear(l.windGusts)} km/h: asegurar cargas y estructuras sueltas.`,
    });
  } else if (
    l.windGusts >= u.rafagaAviso &&
    l.windGusts < u.rafagaCritico &&
    l.windSpeed < u.vientoAviso
  ) {
    alertas.push({
      key: 'RAFAGA',
      level: 'AVISO',
      message: `Ráfagas de ${redondear(l.windGusts)} km/h: precaución con material liviano.`,
    });
  }

  // Para UV manda el máximo del día: a las 9 de la mañana el índice todavía es
  // bajo, pero la cuadrilla necesita saber que al mediodía va a ser extremo.
  const uv = Math.max(l.uvIndex, l.uvIndexMax);
  if (uv >= u.uvExtremo) {
    alertas.push({
      key: 'UV',
      level: 'CRITICO',
      message: `UV extremo (índice ${redondear(uv)}): bloqueador cada 2 horas y sombra al mediodía.`,
    });
  } else if (uv >= u.uvAlto) {
    alertas.push({
      key: 'UV',
      level: 'AVISO',
      message: `UV muy alto (índice ${redondear(uv)}): bloqueador, lentes y cubrir la piel.`,
    });
  }

  if (l.apparentTemperature <= u.frio) {
    alertas.push({
      key: 'FRIO',
      level: 'AVISO',
      message: `Sensación térmica ${redondear(l.apparentTemperature)} °C: riesgo de hipotermia.`,
    });
  } else if (l.apparentTemperature >= u.calor) {
    alertas.push({
      key: 'CALOR',
      level: 'AVISO',
      message: `Sensación térmica ${redondear(l.apparentTemperature)} °C: pausas e hidratación.`,
    });
  }

  return alertas;
}

/** Arma el bloque de clima que viaja en el dashboard. */
export function componerClima(l: LecturaClima): ObraWeather {
  return {
    observedAt: l.observedAt,
    temperature: redondear(l.temperature),
    apparentTemperature: redondear(l.apparentTemperature),
    humidity: Math.round(l.humidity),
    windSpeed: redondear(l.windSpeed),
    windGusts: redondear(l.windGusts),
    windDirection: Math.round(l.windDirection),
    uvIndex: redondear(l.uvIndex),
    uvIndexMax: redondear(l.uvIndexMax),
    windSpeedMax: redondear(l.windSpeedMax),
    alerts: alertasDe(l),
  };
}

/** Punto cardinal desde el que sopla el viento, para leerlo sin grados. */
export function rumbo(grados: number): string {
  const puntos = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return puntos[Math.round((((grados % 360) + 360) % 360) / 45) % 8] ?? 'N';
}
