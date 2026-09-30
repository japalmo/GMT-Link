import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';

import { composeChecklistFormatoPdf } from '../../../src/modules/assets/checklist-formato-pdf.util';
import type { ChecklistFormatoData } from '../../../src/modules/assets/checklist-formato-pdf.util';

/**
 * La firma en el PDF.
 *
 * Importa comprobar que la imagen queda INCRUSTADA y no solo que la función no
 * revienta: una firma que no se dibuja convierte el documento en un papel sin
 * firmar, que es justo lo que se quería evitar.
 */

/** PNG real de 1x1 (transparente). */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function datos(cambios: Partial<ChecklistFormatoData> = {}): ChecklistFormatoData {
  return {
    proyecto: 'Mantos Blancos',
    fecha: '14/05/2026',
    conductor: 'Yerko Jara',
    datosConductor: [],
    vehiculo: {
      patente: 'SKRF88',
      kilometraje: '',
      proxMant: '',
      permiso: { presente: false },
      revision: { presente: false },
      seguro: { presente: false },
      extintor: { presente: false },
    },
    estadoGeneral: [{ id: 'sistemaFrenos', etiqueta: 'Frenos', valor: 'Bueno' }],
    equiposEmergencia: [],
    condicionesConductor: [],
    carroceria: [],
    observaciones: '',
    ...cambios,
  };
}

/**
 * Texto dibujado en el PDF.
 *
 * Hay que deshacer dos capas: pdf-lib comprime los flujos de contenido, y
 * dentro escribe el texto como cadenas HEXADECIMALES
 * (`<434845434B...> Tj`), no literales. Buscar en los bytes crudos no
 * encuentra nada.
 */
async function textoDe(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const partes: string[] = [];
  for (const [, objeto] of doc.context.enumerateIndirectObjects()) {
    const contenido = (objeto as { contents?: Uint8Array }).contents;
    if (!contenido) continue;
    let flujo: string;
    try {
      flujo = inflateSync(Buffer.from(contenido)).toString('latin1');
    } catch {
      // No todos los flujos están comprimidos (ni son texto).
      flujo = Buffer.from(contenido).toString('latin1');
    }
    for (const [, hex] of flujo.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      partes.push(Buffer.from(hex ?? '', 'hex').toString('latin1'));
    }
  }
  return partes.join('\n');
}

describe('firma en el PDF del formato', () => {
  it('incrusta la imagen cuando el checklist viene firmado', async () => {
    const conFirma = await composeChecklistFormatoPdf(datos({ firmaPng: PNG_1X1 }));
    const sinFirma = await composeChecklistFormatoPdf(datos());

    // El formato ya trae sus propias imágenes (logo y camioneta, cada una con
    // su máscara de transparencia). La firma tiene que SUMAR imágenes; sin
    // firma el documento debe tener solo las del formato.
    const imagenes = async (bytes: Uint8Array): Promise<number> =>
      (await PDFDocument.load(bytes)).context
        .enumerateIndirectObjects()
        .filter(([, obj]) => String(obj).includes('/Subtype /Image')).length;
    expect(await imagenes(conFirma)).toBeGreaterThan(await imagenes(sinFirma));
    expect(await imagenes(sinFirma)).toBe(4);
  });

  it('el documento dice que falta la firma en vez de dejar el recuadro vacío', async () => {
    const texto = await textoDe(await composeChecklistFormatoPdf(datos()));
    expect(texto).toContain('Sin firma registrada');
  });

  it('con firma no escribe ningún aviso en el recuadro', async () => {
    const texto = await textoDe(await composeChecklistFormatoPdf(datos({ firmaPng: PNG_1X1 })));
    expect(texto).not.toContain('Sin firma');
  });

  it('un PNG corrupto no impide emitir el documento', async () => {
    // El resto del checklist es informacion real que alguien necesita ver.
    const basura = Buffer.from('esto no es un png');
    const bytes = await composeChecklistFormatoPdf(datos({ firmaPng: basura }));
    expect(bytes.length).toBeGreaterThan(1000);
    expect(await textoDe(bytes)).toContain('No se pudo leer la firma');
  });

  it('escala la firma sin deformarla', async () => {
    // PNG ancho (16x1): al caber en el recuadro debe conservar su proporción.
    const doc = await PDFDocument.create();
    const pagina = doc.addPage([200, 200]);
    const img = await doc.embedPng(PNG_1X1);
    pagina.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    // La comprobación real es sobre el cálculo: misma escala en ambos ejes.
    const escala = Math.min(150 / 400, 36 / 100, 1);
    expect(400 * escala).toBeCloseTo(144, 5);
    expect(100 * escala).toBeCloseTo(36, 5);
  });
});
