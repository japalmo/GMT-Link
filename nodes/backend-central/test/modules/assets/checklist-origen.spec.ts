import { describe, expect, it } from 'vitest';
import { autorDelEnvio, origenDelEnvio } from '../../../src/modules/assets/checklist-origen.util';

/**
 * De dónde viene un checklist y a nombre de quién se muestra.
 *
 * Importa porque el historial es la evidencia de que el vehículo se revisó: un
 * nombre escrito por alguien sin cuenta no vale lo mismo que uno con sesión, y
 * la pantalla no puede presentarlos igual.
 */
describe('origenDelEnvio', () => {
  it('con usuario es un envío de GMT Link, aunque traiga nombre declarado', () => {
    expect(origenDelEnvio({ userId: 'u-1', externalSource: null })).toBe('GMT_LINK');
  });

  it('importado de la planilla', () => {
    expect(origenDelEnvio({ userId: null, externalSource: 'SHEETS' })).toBe('PLANILLA');
  });

  it('sin usuario ni planilla: lo llenó alguien sin cuenta desde el QR', () => {
    expect(origenDelEnvio({ userId: null, externalSource: null })).toBe('SIN_VERIFICAR');
  });
});

describe('autorDelEnvio', () => {
  it('prefiere el usuario con cuenta', () => {
    expect(
      autorDelEnvio({ user: { firstName: 'Ana', lastName: 'Rojas' }, declaredName: 'Otro', externalAuthor: null }),
    ).toBe('Ana Rojas');
  });

  it('usa el nombre declarado en el enlace público', () => {
    expect(autorDelEnvio({ user: null, declaredName: '  Pedro Soto ', externalAuthor: null })).toBe('Pedro Soto');
  });

  it('usa el autor de la planilla', () => {
    expect(autorDelEnvio({ user: null, declaredName: null, externalAuthor: 'jperez' })).toBe('jperez');
  });

  it('sin ningún dato no inventa un nombre', () => {
    expect(autorDelEnvio({ user: null, declaredName: '  ', externalAuthor: null })).toBeNull();
  });
});
