import { describe, expect, it } from 'vitest';

import {
  clasificarDocumento,
  patenteDeCarpeta,
  vencimientoDelNombre,
} from '../../../src/modules/assets/documento-archivo.util';

/**
 * Los casos NO son inventados: son nombres de archivo reales de las carpetas de
 * documentos de la flota. Clasificar mal tiene consecuencias concretas: un
 * permiso de circulación guardado como otra cosa deja al vehículo marcado como
 * "falta el permiso", y un vencimiento inventado dispara avisos por una fecha
 * que nadie puso.
 */

describe('clasificarDocumento: los cinco documentos que la ficha vigila', () => {
  it('reconoce el permiso de circulación', () => {
    expect(clasificarDocumento('Permiso circulación, VGWB-71 31-08-2026.pdf').tipo).toBe(
      'PERMISO_CIRCULACION',
    );
    expect(
      clasificarDocumento('1ra cuota Permiso circulación 2026 SKRF-88 31-08-2026.pdf').tipo,
    ).toBe('PERMISO_CIRCULACION');
  });

  it('reconoce el permiso aunque venga MAL ESCRITO', () => {
    // "3. Permiso curculación.pdf" existe tal cual en la carpeta del minibús.
    // Sin esta tolerancia caía en OTRO y el vehículo quedaba sin su permiso.
    expect(clasificarDocumento('3. Permiso curculación.pdf').tipo).toBe('PERMISO_CIRCULACION');
  });

  it('reconoce la revisión técnica y el SOAP', () => {
    expect(clasificarDocumento('Revisión técnica Toyota SKRF-88.pdf').tipo).toBe('REVISION_TECNICA');
    expect(clasificarDocumento('2. Revisión Técnica.pdf').tipo).toBe('REVISION_TECNICA');
    expect(clasificarDocumento('SOAP VGWB71.pdf').tipo).toBe('SOAP');
    expect(clasificarDocumento('4. Seguro obligatorio SOAP.pdf').tipo).toBe('SOAP');
  });

  it('reconoce la barra antivuelco, incluida la nomenclatura ROPS', () => {
    // ROPS = Roll-Over Protection Structure: es la misma barra. Los
    // certificados llegan con las dos formas y ambas tienen que contar.
    expect(clasificarDocumento('Barra antivuelco-exterior, VGWB-71.pdf').tipo).toBe(
      'BARRA_ANTIVUELCO',
    );
    expect(clasificarDocumento('Certificado barra interior SKRF-88.pdf').tipo).toBe(
      'BARRA_ANTIVUELCO',
    );
    expect(clasificarDocumento('8. Certificado ROPS.pdf').tipo).toBe('BARRA_ANTIVUELCO');
  });

  it('reconoce las cuñas', () => {
    expect(clasificarDocumento('10. Certificado cuñas.pdf').tipo).toBe('CUNAS');
  });
});

describe('clasificarDocumento: lo que NO reconoce', () => {
  it('deja en OTRO lo que no calza, en vez de forzar una categoría', () => {
    // Clasificar un acta de entrega como permiso de circulación daría por
    // cubierto un documento que en realidad falta.
    for (const a of [
      'ACTA DE ENTREGA.pdf',
      'Certificado Leasing.pdf',
      'Decreto 80 VHBC22.pdf',
      'Fact FLETE_RETAIL.pdf',
      'WhatsApp Image 2025-06-09 at 9.38.41 AM.jpeg',
    ]) {
      expect(clasificarDocumento(a).tipo, a).toBe('OTRO');
    }
  });

  it('el orden de las reglas evita que "certificado" se coma a mantención', () => {
    expect(clasificarDocumento('Certificado mantención 47.000km SKRF-88 7-6-25.pdf').tipo).toBe(
      'MANTENCION',
    );
    expect(clasificarDocumento('CERT MANTENIMIENTO KOLVOK 8.5 KVA GMT SPA .pdf').tipo).toBe(
      'MANTENCION',
    );
  });
});

describe('vencimientoDelNombre', () => {
  it('lee la fecha cuando el nombre la trae, con el día primero', () => {
    const d = vencimientoDelNombre('Permiso circulación, VGWB-71 31-08-2026.pdf')!;
    expect(d.toISOString().slice(0, 10)).toBe('2026-08-31');
  });

  it('acepta el año de dos dígitos y las barras', () => {
    expect(vencimientoDelNombre('Cert torque 7-6-25.pdf')?.toISOString().slice(0, 10)).toBe(
      '2025-06-07',
    );
    expect(vencimientoDelNombre('Poliza 15/03/2027.pdf')?.toISOString().slice(0, 10)).toBe(
      '2027-03-15',
    );
  });

  it('NO inventa una fecha cuando el nombre no la trae', () => {
    // Un vencimiento inventado es peor que ninguno: el sistema avisaría (o
    // dejaría de avisar) por algo que nadie escribió.
    for (const a of ['SOAP VGWB71.pdf', 'Certificado GPS.pdf', 'ACREDITACION.pdf']) {
      expect(vencimientoDelNombre(a), a).toBeNull();
    }
  });

  it('descarta números que NO son fechas', () => {
    // "47.000km" y un año de modelo suelto no son vencimientos.
    expect(vencimientoDelNombre('Certificado mantención 47.000km.pdf')).toBeNull();
    expect(vencimientoDelNombre('Camioneta modelo 2015.pdf')).toBeNull();
    // 31 de febrero no existe: el rebote de mes lo delata.
    expect(vencimientoDelNombre('Doc 31-02-2026.pdf')).toBeNull();
  });
});

describe('patenteDeCarpeta', () => {
  it('rescata la patente de la frase que nombra la carpeta', () => {
    expect(patenteDeCarpeta('Documentos Camioneta Great Wall VGWB-71 Roja')).toBe('VGWB71');
    expect(patenteDeCarpeta('Documentos camioneta Toyota SKRF-88')).toBe('SKRF88');
    expect(patenteDeCarpeta('Documentos Bus VHBC22')).toBe('VHBC22');
    expect(patenteDeCarpeta('Documentos Furgón JAC SRPB-37')).toBe('SRPB37');
  });

  it('devuelve null cuando la carpeta no nombra ninguna', () => {
    // "Acreditacion minibus GMT" no la trae: su vehículo se resolvió leyendo el
    // contenido de sus PDF, no adivinando.
    expect(patenteDeCarpeta('Acreditacion minibus GMT')).toBeNull();
    expect(patenteDeCarpeta('equipos')).toBeNull();
  });
});

describe('la fecha del nombre: vencimiento o fecha de emisión', () => {
  /**
   * No toda fecha en el nombre es un vencimiento, y confundirlas tiene dos
   * consecuencias: la plataforma avisaría que un certificado de mantención de
   * 2023 "está vencido" (ruido que tapa los avisos reales), y al quitar la
   * fecha del nombre los ocho certificados del mismo vehículo colapsaban en uno
   * y siete documentos se perdían.
   */
  it('en un permiso de circulación la fecha SÍ es vencimiento', () => {
    const c = clasificarDocumento('Permiso circulación, VGWB-71 31-08-2026.pdf', 'VGWB71');
    expect(c.vencimiento?.toISOString().slice(0, 10)).toBe('2026-08-31');
    // Y sale del nombre, porque ya viaja en su propio campo.
    expect(c.nombre).toBe('Permiso circulación');
  });

  it('en un certificado de mantención la fecha NO es vencimiento', () => {
    const c = clasificarDocumento('Certificado mantención SRPB-37 02-04-2024.pdf', 'SRPB37');
    expect(c.vencimiento).toBeNull();
    // Y se CONSERVA en el nombre: es lo único que lo distingue de los otros.
    expect(c.nombre).toContain('02-04-2024');
  });

  it('ocho certificados de mantención dan ocho nombres distintos', () => {
    const nombres = [
      'Certificado mantención SRPB-37 02-04-2024.pdf',
      'Certificado mantención SRPB-37 02-04-2025.pdf',
      'Certificado mantención SRPB-37 05-07-2024.pdf',
      'Certificado mantención SRPB-37 15-06-2023.pdf',
    ].map((a) => clasificarDocumento(a, 'SRPB37').nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it('un tipo desconocido nunca declara vencimiento', () => {
    // Sin saber qué es el documento, no se puede saber qué significa su fecha.
    const c = clasificarDocumento('ACTA DE ENTREGA 10-05-2025.pdf');
    expect(c.tipo).toBe('OTRO');
    expect(c.vencimiento).toBeNull();
  });
});

describe('nombre visible del documento', () => {
  it('quita la extensión, la patente repetida y la fecha', () => {
    const c = clasificarDocumento('Permiso circulación, VGWB-71 31-08-2026.pdf', 'VGWB71');
    expect(c.nombre).toBe('Permiso circulación');
  });

  it('cae al nombre del tipo cuando al limpiar no queda nada útil', () => {
    expect(clasificarDocumento('SOAP VGWB71.pdf', 'VGWB71').nombre).toBe('SOAP');
  });
});
