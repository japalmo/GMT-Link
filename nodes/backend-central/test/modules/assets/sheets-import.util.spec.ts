import { describe, expect, it } from 'vitest';

import {
  indexarCabecera,
  mapearFila,
  parsearObservacionesCarroceria,
} from '../../../src/modules/assets/sheets-import.util';

/**
 * Contra la planilla real (2.137 filas) este mapeo produce 2.120 registros y
 * descarta 17: 13 sin patente, una con la patente literal "Prueba" y tres sin
 * ninguna respuesta legible. Estas pruebas fijan ese comportamiento.
 */

const CABECERA = [
  'idForm',
  'datetime',
  'nombreTrab',
  'patente',
  'kilometraje',
  'proxMant',
  'sistemaFrenos',
  'obsSistemaFrenos',
  'luces',
  'obsLuces',
  'nivelAdBlue',
  'capacidadConducir',
  'horasDescanso',
  'medicamentosSueno',
  'problemasInquietan',
  'obsCarr',
  'observaciones',
];

const COL = indexarCabecera(CABECERA);

/** Fila completa y sana, sobre la que cada prueba cambia lo suyo. */
function fila(cambios: Partial<Record<string, string>> = {}): string[] {
  const base: Record<string, string> = {
    idForm: 'F0004',
    datetime: '14/05/2025 9:34:27',
    nombreTrab: 'yerko jara',
    patente: 'SK RF 88',
    kilometraje: '103699',
    proxMant: '110000',
    sistemaFrenos: 'Bueno',
    obsSistemaFrenos: '',
    luces: 'Regular',
    obsLuces: 'Foco derecho quemado',
    nivelAdBlue: '1/4',
    capacidadConducir: 'Si',
    horasDescanso: '7',
    medicamentosSueno: 'No',
    problemasInquietan: 'No',
    obsCarr: '',
    observaciones: '',
  };
  return CABECERA.map((c) => cambios[c] ?? base[c] ?? '');
}

function mapear(cambios?: Partial<Record<string, string>>) {
  return mapearFila(fila(cambios), COL, 2);
}

function respuesta(res: ReturnType<typeof mapear>, itemId: string) {
  if (!('registro' in res)) throw new Error('se esperaba un registro');
  return res.registro.answers.find((a) => a.itemId === itemId);
}

describe('mapearFila', () => {
  it('traduce una fila sana a un registro importable', () => {
    const res = mapear();
    if (!('registro' in res)) throw new Error('debió mapear');

    expect(res.registro.externalId).toBe('F0004');
    // La patente llega sucia y sale normalizada.
    expect(res.registro.patente).toBe('SKRF88');
    expect(res.registro.fecha.getDate()).toBe(14);
    expect(res.registro.conductor).toBe('Yerko Jara');
  });

  it('usa la fecha REAL del checklist, no la de importación', () => {
    // Si tomara la fecha de importación, los 2.120 registros históricos
    // aterrizarían todos hoy y el gráfico de uso quedaría inservible.
    const res = mapear({ datetime: '03/02/2025 14:05:00' });
    if (!('registro' in res)) throw new Error('debió mapear');
    expect(res.registro.fecha.getFullYear()).toBe(2025);
    expect(res.registro.fecha.getMonth()).toBe(1);
    expect(res.registro.fecha.getDate()).toBe(3);
  });

  it('lleva la observación como comentario del ítem que explica', () => {
    const luces = respuesta(mapear(), 'luces');
    expect(luces?.value).toBe('Regular');
    expect(luces?.comment).toBe('Foco derecho quemado');
  });

  it('no inventa comentario cuando la observación viene vacía', () => {
    expect(respuesta(mapear(), 'sistemaFrenos')?.comment).toBeUndefined();
  });

  it('cada respuesta trae la etiqueta de la PLANTILLA, no el id crudo', () => {
    // Es lo que se ve en el historial y en el PDF.
    expect(respuesta(mapear(), 'sistemaFrenos')?.label).toContain('frenos');
    expect(respuesta(mapear(), 'kilometraje')?.label).toContain('dómetro');
  });

  it('convierte números y booleanos a su tipo', () => {
    expect(respuesta(mapear(), 'kilometraje')?.value).toBe(103699);
    expect(respuesta(mapear(), 'horasDescanso')?.value).toBe(7);
    expect(respuesta(mapear(), 'capacidadConducir')?.value).toBe(true);
    expect(respuesta(mapear(), 'medicamentosSueno')?.value).toBe(false);
  });

  it('acepta los niveles fraccionarios de AdBlue', () => {
    expect(respuesta(mapear(), 'nivelAdBlue')?.value).toBe('1/4');
  });

  it('omite los ítems que la fila no responde, en vez de guardarlos vacíos', () => {
    expect(respuesta(mapear({ luces: '' }), 'luces')).toBeUndefined();
  });

  // ── descartes ──

  it('descarta la fila sin idForm: sin él no hay forma de no duplicarla', () => {
    const res = mapear({ idForm: '' });
    expect('descarte' in res && res.descarte.motivo).toContain('Sin idForm');
  });

  it('descarta la fila cuya patente no se reconoce', () => {
    const res = mapear({ patente: 'Prueba' });
    expect('descarte' in res && res.descarte.motivo).toContain('Patente no reconocible');
    expect('descarte' in res && res.descarte.externalId).toBe('F0004');
  });

  it('descarta la fila sin fecha interpretable', () => {
    const res = mapear({ datetime: 'ayer' });
    expect('descarte' in res && res.descarte.motivo).toContain('Fecha no interpretable');
  });

  it('descarta la fila que no aporta NINGUNA respuesta', () => {
    // No es un checklist: es una fila a medio llenar. Guardarla contaría como un
    // checklist hecho que nunca se hizo.
    const vacia: Partial<Record<string, string>> = {};
    for (const c of CABECERA) {
      if (!['idForm', 'datetime', 'patente', 'nombreTrab'].includes(c)) vacia[c] = '';
    }
    const res = mapear(vacia);
    expect('descarte' in res && res.descarte.motivo).toContain('ninguna respuesta');
  });

  it('sobrevive a una fila más corta que la cabecera', () => {
    // Google recorta las filas por la derecha cuando las últimas columnas están
    // vacías: indexar a ciegas reventaría con "undefined no es una función".
    const corta = fila().slice(0, 8);
    expect(() => mapearFila(corta, COL, 2)).not.toThrow();
  });
});

// ── carrocería ──

describe('parsearObservacionesCarroceria', () => {
  it('convierte la lista en marcas sobre el diagrama', () => {
    const { mapa } = parsearObservacionesCarroceria(
      '• Parachoques trasero: Chocado\n• Portón pickup: Chocado',
    );
    expect(mapa['pchq_t']?.comment).toBe('Chocado');
    expect(mapa['pickup_comp']?.comment).toBe('Chocado');
  });

  it('entiende los nombres ANTIGUOS con los que la planilla escribió durante años', () => {
    // "Farro derecho" es el nombre mal escrito del original. Si el mapa solo
    // conociera el corregido, estas observaciones históricas se perderían.
    const { mapa } = parsearObservacionesCarroceria('• Farro derecho: Quemado');
    expect(mapa['faro_dd']?.comment).toBe('Quemado');
    // Se guarda con el nombre YA corregido.
    expect(mapa['faro_dd']?.part).toBe('Faro derecho');
  });

  it('no pierde lo que no logra ubicar en una parte', () => {
    // Perder el registro de un daño es peor que guardarlo en un lugar menos
    // preciso, así que se devuelve aparte para colgarlo de las observaciones.
    const { mapa, sinUbicar } = parsearObservacionesCarroceria('• Pieza rara: Rota\nalgo suelto');
    expect(Object.keys(mapa)).toHaveLength(0);
    expect(sinUbicar).toEqual(['Pieza rara: Rota', 'algo suelto']);
  });

  it('el texto sin ubicar termina en las observaciones generales, marcado', () => {
    const res = mapear({ obsCarr: '• Pieza rara: Rota', observaciones: 'Todo normal' });
    const obs = respuesta(res, 'observaciones');
    expect(obs?.value).toContain('Todo normal');
    expect(obs?.value).toContain('Carrocería: Pieza rara: Rota');
  });

  it('una carrocería sin observaciones no agrega el ítem del diagrama', () => {
    expect(respuesta(mapear({ obsCarr: '' }), 'Carrsvg')).toBeUndefined();
  });

  it('el diagrama se guarda como mapa de comentarios, que es lo que la UI lee', () => {
    const res = mapear({ obsCarr: '• Capó: Abollado' });
    const svg = respuesta(res, 'Carrsvg');
    expect(JSON.parse(String(svg?.value))).toEqual({
      capo: { part: 'Capó', comment: 'Abollado' },
    });
  });
});
