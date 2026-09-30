import { describe, expect, it } from 'vitest';
import {
  UMBRALES_CLIMA,
  alertasDe,
  componerClima,
  rumbo,
  type LecturaClima,
} from '../../src/modules/projects/clima.util';

/** Un día tranquilo en faena: nada supera umbral. */
function lectura(over: Partial<LecturaClima> = {}): LecturaClima {
  return {
    observedAt: '2026-09-10T14:00',
    temperature: 18,
    apparentTemperature: 17,
    humidity: 40,
    windSpeed: 12,
    windGusts: 20,
    windDirection: 250,
    uvIndex: 4,
    uvIndexMax: 6,
    windSpeedMax: 20,
    ...over,
  };
}

describe('alertas climáticas de faena', () => {
  it('un día tranquilo no genera ninguna alerta', () => {
    expect(alertasDe(lectura())).toEqual([]);
  });

  it('el viento avisa sobre el umbral y pasa a crítico cuando suspende izaje', () => {
    const aviso = alertasDe(lectura({ windSpeed: UMBRALES_CLIMA.vientoAviso }));
    expect(aviso[0]).toMatchObject({ key: 'VIENTO', level: 'AVISO' });

    const critico = alertasDe(lectura({ windSpeed: UMBRALES_CLIMA.vientoCritico }));
    expect(critico[0]).toMatchObject({ key: 'VIENTO', level: 'CRITICO' });
    expect(critico[0]?.message).toContain('suspender izaje');
  });

  it('la ráfaga no repite la alerta cuando el viento medio ya la disparó', () => {
    const alertas = alertasDe(lectura({ windSpeed: 60, windGusts: 90 }));
    expect(alertas.filter((a) => a.key === 'RAFAGA')).toHaveLength(0);
    expect(alertas.filter((a) => a.key === 'VIENTO')).toHaveLength(1);
  });

  it('la ráfaga sí avisa por su cuenta si el viento medio está tranquilo', () => {
    const alertas = alertasDe(lectura({ windSpeed: 15, windGusts: 80 }));
    expect(alertas.find((a) => a.key === 'RAFAGA')).toMatchObject({ level: 'CRITICO' });
  });

  it('el UV se juzga por el máximo del día, no por el de este minuto', () => {
    // A las 9 de la mañana el índice es bajo, pero al mediodía va a ser extremo:
    // la cuadrilla necesita saberlo AHORA, cuando aún puede prepararse.
    const alertas = alertasDe(lectura({ uvIndex: 2, uvIndexMax: 12 }));
    expect(alertas.find((a) => a.key === 'UV')).toMatchObject({ level: 'CRITICO' });
  });

  it('UV alto avisa sin llegar a extremo', () => {
    const alertas = alertasDe(lectura({ uvIndex: 9, uvIndexMax: 9 }));
    expect(alertas.find((a) => a.key === 'UV')).toMatchObject({ level: 'AVISO' });
  });

  it('los extremos de temperatura avisan por sensación térmica, no por la real', () => {
    expect(
      alertasDe(lectura({ temperature: 30, apparentTemperature: 1 })).find((a) => a.key === 'FRIO'),
    ).toBeDefined();
    expect(
      alertasDe(lectura({ temperature: 20, apparentTemperature: 35 })).find(
        (a) => a.key === 'CALOR',
      ),
    ).toBeDefined();
  });

  it('varias condiciones malas conviven como alertas separadas', () => {
    const alertas = alertasDe(
      lectura({ windSpeed: 58, uvIndex: 12, uvIndexMax: 12, apparentTemperature: 34 }),
    );
    expect(alertas.map((a) => a.key).sort()).toEqual(['CALOR', 'UV', 'VIENTO']);
  });
});

describe('composición del bloque de clima', () => {
  it('redondea para la pantalla sin arrastrar decimales del proveedor', () => {
    const w = componerClima(lectura({ temperature: 17.6321, windSpeed: 15.349, humidity: 57.8 }));
    expect(w.temperature).toBe(17.6);
    expect(w.windSpeed).toBe(15.3);
    expect(w.humidity).toBe(58);
  });

  it('conserva la hora de observación tal cual la entrega el proveedor', () => {
    expect(componerClima(lectura()).observedAt).toBe('2026-09-10T14:00');
  });
});

describe('rumbo del viento', () => {
  it('traduce grados a punto cardinal', () => {
    expect(rumbo(0)).toBe('N');
    expect(rumbo(90)).toBe('E');
    expect(rumbo(225)).toBe('SO');
    expect(rumbo(257)).toBe('O');
  });

  it('aguanta grados fuera de rango sin romperse', () => {
    expect(rumbo(360)).toBe('N');
    expect(rumbo(-90)).toBe('O');
  });
});
