import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateIncidentDto } from '../../src/modules/hse/dto/hse.dto';

/**
 * El DTO del formulario público, validado igual que en la API.
 *
 * El `ValidationPipe` del módulo corre con `whitelist` y `forbidNonWhitelisted`,
 * así que una propiedad que solo tiene `@Transform` (sin ninguna regla) NO entra
 * en la lista blanca y tumba el envío entero con "property should not exist".
 * Pasó en producción con las casillas de consecuencias: esta prueba replica el
 * pipe para que no vuelva a pasar.
 */

/** Mismas opciones que el ValidationPipe de `HseController`. */
function validar(payload: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateIncidentDto, payload, {
    enableImplicitConversion: false,
  });
  return validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
    skipMissingProperties: false,
  }).flatMap((e) => Object.values(e.constraints ?? {}));
}

/** Lo que manda el formulario del celular: todo texto, las casillas incluidas. */
const ENVIO_REAL: Record<string, unknown> = {
  fecha: '2026-09-23',
  hora: '11:15',
  sitio: 'Casa matriz',
  area: "Calle O'Higgins",
  turno: 'DÍA',
  lesionPersonas: 'false',
  danoInfraestructura: 'true',
  danoDetalle: 'Parachoque delantero',
  fugaDerrame: 'false',
  emisionesAire: 'false',
  instalaciones: 'false',
  cuasiAccidente: 'false',
  procesoAfectado: 'false',
  tiempoPerdido: 'SIN',
  descripcion: 'Un bus adelanta por la izquierda y golpea el parachoque de la camioneta.',
  accionesInmediatas: '.- Se informa a la jefatura',
  preparaNombre: 'Jorge Osorio',
  preparaCargo: 'APR',
};

describe('CreateIncidentDto', () => {
  it('acepta el envío tal como lo manda el formulario', () => {
    expect(validar(ENVIO_REAL)).toEqual([]);
  });

  it('convierte las casillas de texto a booleano', () => {
    const dto = plainToInstance(CreateIncidentDto, ENVIO_REAL);
    expect(dto.danoInfraestructura).toBe(true);
    expect(dto.lesionPersonas).toBe(false);
    // Ausente equivale a no marcada: el formato imprime la casilla vacía.
    expect(
      plainToInstance(CreateIncidentDto, { ...ENVIO_REAL, cuasiAccidente: undefined })
        .cuasiAccidente,
    ).toBe(false);
  });

  it('convierte los números de la fuga, con coma o con punto', () => {
    const dto = plainToInstance(CreateIncidentDto, {
      ...ENVIO_REAL,
      fugaDerrame: 'true',
      fugaVolumenM3: '1,5',
      fugaPh: '7.2',
      fugaDuracionMin: '20',
      fugaSuperficieM2: '',
    });
    expect(dto.fugaVolumenM3).toBe(1.5);
    expect(dto.fugaPh).toBe(7.2);
    expect(dto.fugaDuracionMin).toBe(20);
    expect(dto.fugaSuperficieM2).toBeNull();
    expect(validar({ ...ENVIO_REAL, fugaVolumenM3: '1,5' })).toEqual([]);
  });

  it('exige una descripción con sustancia', () => {
    const errores = validar({ ...ENVIO_REAL, descripcion: 'chocaron' });
    expect(errores.join(' ')).toContain('al menos 20 caracteres');
  });

  it('rechaza una hora inventada', () => {
    expect(validar({ ...ENVIO_REAL, hora: '25:99' }).join(' ')).toContain('formato HH:MM');
  });

  it('rechaza campos que no son del formato', () => {
    expect(validar({ ...ENVIO_REAL, sueldo: '1000' }).join(' ')).toContain('should not exist');
  });
});
