import { Injectable, Logger } from '@nestjs/common';
import type { ObraWeather } from '@gmt-platform/contracts';
import { componerClima, type LecturaClima } from './clima.util';

/**
 * Condiciones en faena desde Open-Meteo. Se eligió porque no pide credenciales
 * ni tiene cuota que administrar, y entrega índice UV, que es justo el dato que
 * importa en el desierto de Atacama y que casi ningún proveedor gratuito da.
 *
 * El clima NUNCA puede voltear el dashboard: si el proveedor no responde, el
 * avance de obra se muestra igual y el bloque de clima viaja en `null`.
 */

const URL_BASE = 'https://api.open-meteo.com/v1/forecast';

/** Cada TV pide el dashboard cada 5 minutos; el clima no cambia tan rápido. */
const CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 4_000;

interface RespuestaOpenMeteo {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    wind_gusts_10m?: number;
    wind_direction_10m?: number;
    uv_index?: number;
  };
  daily?: {
    uv_index_max?: number[];
    wind_speed_10m_max?: number[];
  };
}

@Injectable()
export class ClimaService {
  private readonly log = new Logger(ClimaService.name);
  private readonly cache = new Map<string, { hasta: number; valor: ObraWeather | null }>();

  /**
   * Clima en un punto. Devuelve `null` ante cualquier problema: sin red, sin
   * respuesta a tiempo o con un cuerpo que no trae lo que se espera.
   */
  async enPunto(lat: number, lng: number): Promise<ObraWeather | null> {
    // Se redondea la clave: dos cercos a 300 m comparten pronóstico y no tiene
    // sentido pedir dos veces lo mismo.
    const clave = `${lat.toFixed(2)},${lng.toFixed(2)}`;
    const guardado = this.cache.get(clave);
    if (guardado && guardado.hasta > Date.now()) return guardado.valor;

    const valor = await this.pedir(lat, lng);
    this.cache.set(clave, { hasta: Date.now() + CACHE_MS, valor });
    return valor;
  }

  private async pedir(lat: number, lng: number): Promise<ObraWeather | null> {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lng.toFixed(4),
      current: [
        'temperature_2m',
        'apparent_temperature',
        'relative_humidity_2m',
        'wind_speed_10m',
        'wind_gusts_10m',
        'wind_direction_10m',
        'uv_index',
      ].join(','),
      daily: 'uv_index_max,wind_speed_10m_max',
      timezone: 'America/Santiago',
      wind_speed_unit: 'kmh',
      forecast_days: '1',
    });

    const corte = AbortSignal.timeout(TIMEOUT_MS);
    try {
      const res = await fetch(`${URL_BASE}?${params.toString()}`, { signal: corte });
      if (!res.ok) {
        this.log.warn(`Open-Meteo respondió ${res.status}; el tablero va sin clima.`);
        return null;
      }
      const cuerpo = (await res.json()) as RespuestaOpenMeteo;
      const c = cuerpo.current;
      if (!c || c.temperature_2m === undefined || c.wind_speed_10m === undefined) {
        this.log.warn('Open-Meteo respondió sin las variables esperadas.');
        return null;
      }

      const lectura: LecturaClima = {
        observedAt: c.time ?? new Date().toISOString().slice(0, 16),
        temperature: c.temperature_2m,
        apparentTemperature: c.apparent_temperature ?? c.temperature_2m,
        humidity: c.relative_humidity_2m ?? 0,
        windSpeed: c.wind_speed_10m,
        windGusts: c.wind_gusts_10m ?? c.wind_speed_10m,
        windDirection: c.wind_direction_10m ?? 0,
        uvIndex: c.uv_index ?? 0,
        uvIndexMax: cuerpo.daily?.uv_index_max?.[0] ?? c.uv_index ?? 0,
        windSpeedMax: cuerpo.daily?.wind_speed_10m_max?.[0] ?? c.wind_speed_10m,
      };
      return componerClima(lectura);
    } catch (e) {
      // Incluye el corte por timeout: la TV de faena no puede quedarse esperando.
      this.log.warn(`No se pudo consultar el clima: ${(e as Error).message}`);
      return null;
    }
  }
}
