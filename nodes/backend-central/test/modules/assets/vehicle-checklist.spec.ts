import {
  CHECKLIST_VEHICULO_GMT,
  ITEMS_DE_ESTADO,
  SECCIONES_CHECKLIST_VEHICULO,
} from '@gmt-platform/contracts';
import { describe, expect, it } from 'vitest';

import {
  isFailure,
  sectionsSchema,
  templateItemSchema,
} from '../../../src/modules/assets/checklist.schema';

/**
 * La plantilla es la transcripción del formulario real que llena la flota. Si se
 * desalinea del formato impreso, el PDF firmado deja de calzar con lo que la
 * gente llenó, así que estas pruebas fijan su forma.
 */

function item(id: string) {
  return CHECKLIST_VEHICULO_GMT.find((i) => i.id === id);
}

describe('plantilla de checklist de vehículo', () => {
  it('cada ítem pasa la validación del propio motor', () => {
    for (const i of CHECKLIST_VEHICULO_GMT) {
      expect(() => templateItemSchema.parse(i), `ítem ${i.id}`).not.toThrow();
    }
  });

  it('las secciones son válidas y están en el orden del formato impreso', () => {
    expect(() => sectionsSchema.parse(SECCIONES_CHECKLIST_VEHICULO)).not.toThrow();
    expect(SECCIONES_CHECKLIST_VEHICULO.map((s) => s.id)).toEqual([
      'datos-vehiculo',
      'estado-general',
      'equipos-emergencia',
      'condiciones-conductor',
      'cierre',
    ]);
  });

  it('trae los 32 ítems de estado del formulario real', () => {
    // 21 en "estado general" + 11 en "equipos de emergencia".
    expect(ITEMS_DE_ESTADO).toHaveLength(32);
  });

  it('ningún ítem queda fuera de una sección ni con id repetido', () => {
    expect(CHECKLIST_VEHICULO_GMT.filter((i) => !i.section)).toEqual([]);
    const ids = CHECKLIST_VEHICULO_GMT.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada ítem de estado apunta a una observación que EXISTE', () => {
    // Sin esto, el motor buscaría un ítem companion inexistente y la observación
    // se perdería en silencio al enviar el checklist.
    for (const id of ITEMS_DE_ESTADO) {
      const obsId = item(id)?.config?.obsItemId;
      expect(obsId, `${id} sin obsItemId`).toBeTruthy();
      expect(item(obsId!), `${id} apunta a ${obsId}, que no existe`).toBeDefined();
      expect(item(obsId!)?.type).toBe('TEXTO');
    }
  });

  it('el odómetro conserva el id que consume el cálculo de uso', () => {
    // `vehicle-usage.util` busca el ítem `kilometraje`; renombrarlo dejaría los
    // gráficos en blanco sin ningún error visible.
    expect(item('kilometraje')?.type).toBe('ENTERO');
    expect(item('kilometraje')?.config?.isOdometer).toBe(true);
  });

  it('los ids son los de la planilla, para que la importación sea directa', () => {
    for (const id of ['sistemaFrenos', 'neumaticoRepuesto', 'trabatuercasCheckpointSafelock']) {
      expect(item(id), `falta ${id}`).toBeDefined();
    }
    expect(item('sistemaFrenos')?.config?.obsItemId).toBe('obsSistemaFrenos');
  });
});

describe('falla en las preguntas del conductor', () => {
  it('"no me siento capaz de conducir" es falla', () => {
    expect(isFailure(item('capacidadConducir'), false)).toBe(true);
    expect(isFailure(item('capacidadConducir'), true)).toBe(false);
  });

  it('"sí consumo medicamentos que dan sueño" es falla, y "no" NO lo es', () => {
    // Sin `failOptions` el motor daba esto vuelta: marcaba como falla la
    // respuesta tranquilizadora y dejaba pasar limpia la peligrosa.
    expect(isFailure(item('medicamentosSueno'), true)).toBe(true);
    expect(isFailure(item('medicamentosSueno'), false)).toBe(false);
  });

  it('"sí tengo un problema que me distrae" es falla, y "no" NO lo es', () => {
    expect(isFailure(item('problemasInquietan'), true)).toBe(true);
    expect(isFailure(item('problemasInquietan'), false)).toBe(false);
  });

  it('un BOOLEAN sin failOptions mantiene el comportamiento histórico', () => {
    const viejo = { id: 'x', label: 'x', type: 'BOOLEAN' as const, required: true };
    expect(isFailure(viejo, false)).toBe(true);
    expect(isFailure(viejo, true)).toBe(false);
  });
});

describe('falla en los ítems de estado', () => {
  it('"Malo" es falla y "Regular" no', () => {
    // Decisión deliberada: hay 947 "Regular" contra 750 "Malo" en los datos
    // reales, y varias son cosas como un piquete en el parabrisas.
    expect(isFailure(item('sistemaFrenos'), 'Malo')).toBe(true);
    expect(isFailure(item('sistemaFrenos'), 'Regular')).toBe(false);
    expect(isFailure(item('sistemaFrenos'), 'Bueno')).toBe(false);
  });

  it('el diagrama de carrocería nunca es falla', () => {
    expect(isFailure(item('Carrsvg'), '{"puerta":{"part":"Puerta","comment":"rayada"}}')).toBe(
      false,
    );
  });
});
