import { CHECKLIST_VEHICULO_GMT } from '@gmt-platform/contracts';
import { describe, expect, it } from 'vitest';

import { construirFormato } from '../../../src/modules/assets/checklist-formato.builder';
import type { EntradaFormato } from '../../../src/modules/assets/checklist-formato.builder';
import { composeChecklistFormatoPdf, envolver } from '../../../src/modules/assets/checklist-formato-pdf.util';

/**
 * El PDF es el documento que se firma y se archiva. Lo que se prueba acá es que
 * no PIERDA información y que respete el orden del molde impreso, porque una
 * observación cortada o un ítem que desaparece dejan un registro que parece
 * completo sin serlo.
 */

const PLANTILLA_ACTIVO = [
  { id: 'sistemaFrenos', label: 'Sistema de frenos', type: 'ESTADO' },
  { id: 'obs_sistemaFrenos', label: 'Observación', type: 'TEXTO' },
  { id: 'cunas', label: 'Cuñas', type: 'ESTADO' },
  { id: 'kilometraje', label: 'Kilometraje', type: 'ENTERO' },
];

function entrada(cambios: Partial<EntradaFormato> = {}): EntradaFormato {
  return {
    proyecto: 'Mantos Blancos',
    fecha: new Date(2026, 4, 14, 9, 34),
    conductor: 'Yerko Jara',
    origen: null,
    patente: 'SKRF88',
    items: PLANTILLA_ACTIVO,
    answers: [
      { itemId: 'sistemaFrenos', value: 'Bueno' },
      { itemId: 'kilometraje', value: 103699 },
    ],
    documentos: [],
    ...cambios,
  };
}

function todas(d: ReturnType<typeof construirFormato>) {
  return [...d.estadoGeneral, ...d.equiposEmergencia, ...d.condicionesConductor];
}

describe('construirFormato: estructura del molde', () => {
  it('reparte los ítems en las tres tablas del formato impreso', () => {
    const d = construirFormato(entrada());
    // 21 de estado general + 11 de equipos de emergencia + 4 preguntas.
    expect(d.estadoGeneral).toHaveLength(21);
    expect(d.equiposEmergencia).toHaveLength(11);
    expect(d.condicionesConductor).toHaveLength(4);
  });

  it('lista TODOS los ítems, no solo los respondidos', () => {
    // El formulario de papel muestra la línea aunque nadie la haya marcado. Si
    // se omitieran, el checklist parecería completo cuando no lo está.
    const d = construirFormato(entrada());
    const sinResponder = d.estadoGeneral.filter((f) => f.valor === '');
    expect(sinResponder.length).toBeGreaterThan(0);
    expect(d.estadoGeneral.find((f) => f.etiqueta === 'Sistema de frenos')?.valor).toBe('Bueno');
  });

  it('respeta el ORDEN del molde, no el de la plantilla del activo', () => {
    // En el molde "¿cuántas horas descansó?" va SEGUNDA. La plantilla del activo
    // la trae al final, y seguir ese orden desalinearía el documento firmado.
    const d = construirFormato(entrada());
    expect(d.condicionesConductor[1]?.etiqueta.toLowerCase()).toContain('horas');
  });

  it('usa la etiqueta que vio quien llenó el checklist', () => {
    // La plantilla del activo es la que la persona tuvo en pantalla.
    const d = construirFormato(entrada());
    expect(d.estadoGeneral[0]?.etiqueta).toBe('Sistema de frenos');
    // Y cae a la canónica para lo que esa plantilla no define.
    expect(d.equiposEmergencia.find((f) => f.etiqueta.includes('Baliza'))).toBeDefined();
  });

  it('las observaciones acompañantes son COLUMNA, no fila propia', () => {
    const d = construirFormato(entrada());
    expect(todas(d).some((f) => f.etiqueta.startsWith('Observación'))).toBe(false);
  });

  it('el comentario viaja en la columna de observaciones del ítem que explica', () => {
    const d = construirFormato(
      entrada({
        answers: [{ itemId: 'sistemaFrenos', value: 'Regular', comment: 'Freno de mano largo' }],
      }),
    );
    const fila = d.estadoGeneral.find((f) => f.etiqueta === 'Sistema de frenos');
    expect(fila?.observacion).toBe('Freno de mano largo');
  });
});

describe('construirFormato: fallas y datos del vehículo', () => {
  it('marca como falla lo que el motor considera falla', () => {
    const d = construirFormato(entrada({ answers: [{ itemId: 'cunas', value: 'Malo' }] }));
    expect(d.equiposEmergencia.find((f) => f.valor === 'Malo')?.esFalla).toBe(true);
  });

  it('"Regular" NO es falla, y un ítem sin responder tampoco', () => {
    const d = construirFormato(
      entrada({ answers: [{ itemId: 'sistemaFrenos', value: 'Regular' }] }),
    );
    expect(d.estadoGeneral.find((f) => f.valor === 'Regular')?.esFalla).toBe(false);
    expect(todas(d).filter((f) => f.valor === '' && f.esFalla)).toEqual([]);
  });

  it('la respuesta peligrosa del conductor sale marcada', () => {
    // "sí consumo medicamentos que dan sueño" es la falla, no el "no".
    const d = construirFormato(entrada({ answers: [{ itemId: 'medicamentosSueno', value: true }] }));
    const fila = d.condicionesConductor.find((f) => f.valor === 'Sí');
    expect(fila?.esFalla).toBe(true);
  });

  it('lleva patente y kilometraje al bloque del vehículo, no a las tablas', () => {
    const d = construirFormato(entrada());
    expect(d.datosVehiculo[0]).toEqual({ etiqueta: 'Patente:', valor: 'SKRF88' });
    expect(d.datosVehiculo[1]?.valor).toBe('103.699');
    expect(todas(d).some((f) => f.etiqueta.toLowerCase().includes('kilometraje'))).toBe(false);
  });

  it('toma el vencimiento de los documentos del vehículo', () => {
    const d = construirFormato(
      entrada({
        documentos: [
          { name: 'Permiso 2026', type: 'PERMISO_CIRCULACION', expirationDate: new Date(2027, 2, 31) },
        ],
      }),
    );
    const permiso = d.datosVehiculo.find((x) => x.etiqueta.includes('Permiso'));
    expect(permiso?.valor).toBe('Sí');
    expect(permiso?.vencimiento).toBe('31-03-2027');
  });

  it('dice "No registrado" cuando el documento falta, en vez de dejarlo en blanco', () => {
    const d = construirFormato(entrada());
    expect(d.datosVehiculo.find((x) => x.etiqueta.includes('Seguro'))?.valor).toBe('No registrado');
  });
});

describe('construirFormato: procedencia', () => {
  it('advierte en el documento cuando el checklist vino de la planilla', () => {
    // El PDF no puede presentar como firma acá un nombre que vino de una hoja
    // de cálculo.
    const d = construirFormato(entrada({ origen: 'SHEETS' }));
    expect(d.origenExterno).toContain('planilla');
  });

  it('no advierte nada cuando se hizo en la plataforma', () => {
    expect(construirFormato(entrada()).origenExterno).toBeUndefined();
  });
});

describe('construirFormato: carrocería y observaciones', () => {
  it('expande el diagrama a una línea por parte marcada', () => {
    const d = construirFormato(
      entrada({
        answers: [
          {
            itemId: 'Carrsvg',
            value: JSON.stringify({
              faro_dd: { part: 'Faro derecho', comment: 'Quemado' },
              pchq_t: { part: 'Parachoques trasero', comment: 'Chocado' },
            }),
          },
        ],
      }),
    );
    expect(d.carroceria).toEqual(['Faro derecho: Quemado', 'Parachoques trasero: Chocado']);
    // Y NO aparece como una fila con un JSON crudo dentro.
    expect(todas(d).some((f) => f.valor.includes('{'))).toBe(false);
  });

  it('lleva las observaciones generales a su bloque', () => {
    const d = construirFormato(
      entrada({ answers: [{ itemId: 'observaciones', value: 'Gancho suelto' }] }),
    );
    expect(d.observaciones).toBe('Gancho suelto');
  });
});

describe('composeChecklistFormatoPdf', () => {
  it('produce un PDF válido', async () => {
    const bytes = await composeChecklistFormatoPdf(construirFormato(entrada()));
    expect(bytes.length).toBeGreaterThan(1000);
    // Firma de archivo PDF.
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });

  it('no revienta con una observación larguísima ni con un checklist vacío', async () => {
    const largo = 'RAYADURAS Y ABOLLADURAS '.repeat(40);
    await expect(
      composeChecklistFormatoPdf(
        construirFormato(
          entrada({ answers: [{ itemId: 'sistemaFrenos', value: 'Malo', comment: largo }] }),
        ),
      ),
    ).resolves.toBeInstanceOf(Uint8Array);

    await expect(
      composeChecklistFormatoPdf(construirFormato(entrada({ answers: [], items: [] }))),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('la plantilla canónica cubre las tres tablas sin dejar ítems fuera', () => {
    // Si alguien agrega un ítem a la plantilla sin sección, caería en "estado
    // general" en silencio; esto lo deja a la vista.
    const sinSeccion = CHECKLIST_VEHICULO_GMT.filter((i) => !i.section);
    expect(sinSeccion).toEqual([]);
  });
});

describe('las observaciones se ENVUELVEN, nunca se recortan', () => {
  /**
   * Es la garantía que importa en un documento firmado: una observación cortada
   * ("vibración de motor a partir de 50 km p…") deja un registro que parece
   * completo y no lo está. Se prueba la función directamente porque el PDF
   * generado no permite recuperar el texto para compararlo.
   */
  it('parte el texto en varias líneas en vez de truncarlo', async () => {
    const { StandardFonts, PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const fuente = await doc.embedFont(StandardFonts.Helvetica);

    const texto = 'VIBRACION DE MOTOR A PARTIR DE 50 KM POR HORA Y RUIDO AL FRENAR EN BAJADA';
    const lineas = envolver(texto, fuente, 7.5, 120);

    expect(lineas.length).toBeGreaterThan(1);
    // Ni una sola palabra se pierde por el camino.
    expect(lineas.join(' ').split(/\s+/)).toEqual(texto.split(/\s+/));
    // Y ninguna línea trae los puntos suspensivos del recorte.
    expect(lineas.some((l) => l.includes('…'))).toBe(false);
  });

  it('respeta los saltos de línea del texto original', async () => {
    const { StandardFonts, PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.create();
    const fuente = await doc.embedFont(StandardFonts.Helvetica);
    expect(envolver('uno\ndos', fuente, 7.5, 200)).toEqual(['uno', 'dos']);
  });

  it('una observación larga hace crecer el documento, no lo deja igual', async () => {
    const corta = await composeChecklistFormatoPdf(
      construirFormato(entrada({ answers: [{ itemId: 'sistemaFrenos', value: 'Malo', comment: 'ok' }] })),
    );
    const larga = await composeChecklistFormatoPdf(
      construirFormato(
        entrada({
          answers: [
            { itemId: 'sistemaFrenos', value: 'Malo', comment: 'RAYADURAS Y ABOLLADURAS '.repeat(30) },
          ],
        }),
      ),
    );
    // Si se recortara, los dos documentos pesarían prácticamente lo mismo.
    expect(larga.length).toBeGreaterThan(corta.length + 200);
  });
});
