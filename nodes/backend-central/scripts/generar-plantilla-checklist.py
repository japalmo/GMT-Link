# -*- coding: utf-8 -*-
"""
Genera la plantilla EN BLANCO del formato "CHECKLIST DE VEHICULOS LIVIANOS".

El PDF del checklist debe salir IGUAL al formato que exportaba la planilla de
Google (logo, dibujo de la camioneta, colores, una hoja carta). Redibujarlo con
pdf-lib era una reinterpretacion que nunca calzaba del todo; en vez de eso se
toma el formato real, se le borran los datos y la plataforma escribe encima.

Entrada: un PDF exportado de la planilla ("CHECK LIST CAMIONETAS - FORMATO
CHECKLIST.pdf"). Trae datos de un conductor real, asi que NO se versiona: se
pasa por argumento y solo se sube la plantilla ya limpia.

Se borra SOLO lo variable:
  - los textos de valores (nombre, patente, fechas, estados, respuestas...);
  - la imagen de la firma;
  - las 6 casillas de verificacion (la plataforma las dibuja segun el dato).
Quedan intactos las etiquetas, las franjas, el logo y el dibujo.

Uso:
    python scripts/generar-plantilla-checklist.py <formato.pdf> <salida.ts>
Requiere PyMuPDF (pip install pymupdf).
"""
import base64
import sys

import fitz  # PyMuPDF

# Etiquetas fijas del formato: todo texto que NO este aqui es un valor y se borra.
ETIQUETAS = {
    'CHECKLIST DE VEHICULOS LIVIANOS', 'PROYECTO:', 'FECHA:', 'DATOS DEL CONDUCTOR',
    'DATOS DEL VEHÍCULO', 'Nombre del Conductor:', 'Patente:', 'Kilometraje:',
    'Proxima Mantención:', 'Permiso de Circulación:', 'Vencimiento:', 'Revisión Técnica:',
    'FIRMA', 'Seguro:', 'Licencia Municipal:', 'Extintor:', 'Licencia Interna:',
    'ESTADO GENERAL DEL VEHÍCULO', 'ITEM', 'ESTADO', 'OBSERVACIONES', 'EQUIPOS DE EMERGENCIA',
    'CONDICIONES DEL CONDUCTOR', 'PREGUNTA', 'RESPUESTA',
    'OBSERVACIONES DE LA CARROCERIA (ralladuras, abolladuras, etc)', 'OBSERVACIONES GENERALES',
    # Filas de las tablas.
    'Sistema de Frenos (pedal y freno de mano)', 'Dirección', 'Estado de funcionamiento del motor',
    'Neumáticos', 'Neumático de repuesto',
    'Luces (conducción, estacionamiento, intermitente, freno, retroceso)', 'Bocina',
    'Velocímetro y otros indicadores', 'Parabrisas, vidrios laterales y posterior',
    'Limpiaparabrisas', 'Espejos interno y laterales', 'Protección entre pickup y cabina',
    'Carrocería y estructura', 'Velocidad Crucero', 'Radio base', 'Sistema de Monitoreo GPS',
    'Verificación de pernos (Trabatuercas / Check Point / Safelock)',
    'Logotipo Empresa ambos costados y trasero', 'N° de identificación trasero y lateral',
    'Logo autorización de tránsito en faena', 'Cinturón de seguridad', 'Alarma de Retroceso',
    'Triángulos reflectantes', 'Extintores', 'Botiquín de primeros auxilios', 'Llave de ruedas',
    'Gata hidráulica', 'Baliza (Amarilla o Azul)', 'Barra Antivuelco Exterior e Interior',
    'Pértiga / Bandera / Luz', 'Cuñas (2)',
    '¿Se siente física y mentalmente capaz de conducir?', '¿Cuantas horas descanso?',
    '¿Consume algún medicamento que induzca sueño?',
    '¿Presenta algún problema que lo inquiete o distraiga?',
}


def main(origen, destino):
    doc = fitz.open(origen)
    if doc.page_count != 1:
        raise SystemExit('El formato debe tener exactamente una pagina.')
    pagina = doc[0]

    borrados = []
    for bloque in pagina.get_text('dict')['blocks']:
        for linea in bloque.get('lines', []):
            for span in linea['spans']:
                texto = span['text'].strip()
                if texto and texto not in ETIQUETAS:
                    pagina.add_redact_annot(fitz.Rect(span['bbox']), fill=False)
                    borrados.append(texto)

    # La firma: la unica imagen dentro del bloque del conductor.
    for img in pagina.get_images(full=True):
        for rect in pagina.get_image_rects(img[0]):
            if 100 < rect.x0 < 300 and 120 < rect.y0 < 185:
                pagina.add_redact_annot(rect, fill=False)

    # Las casillas: dibujos pequenos y cuadrados.
    casillas = 0
    for dibujo in pagina.get_drawings():
        r = dibujo['rect']
        if 6 < r.width < 14 and 6 < r.height < 14:
            pagina.add_redact_annot(r, fill=False)
            casillas += 1

    # Solo se borra lo que queda CUBIERTO: las franjas de color de las celdas,
    # que solo tocan los rectangulos, sobreviven.
    pagina.apply_redactions(
        images=fitz.PDF_REDACT_IMAGE_REMOVE,
        graphics=fitz.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED,
        text=fitz.PDF_REDACT_TEXT_REMOVE,
    )
    doc.set_metadata({'title': 'CHECKLIST DE VEHICULOS LIVIANOS', 'creator': 'GMT Link'})

    # Comprobacion: no puede quedar ningun valor del original.
    restantes = [t.strip() for t in pagina.get_text().splitlines() if t.strip()]
    sobran = [t for t in restantes if t not in ETIQUETAS]
    if sobran:
        raise SystemExit('Quedaron valores sin borrar: %r' % sobran)
    if len(pagina.get_images()) != 2:
        raise SystemExit('Se esperaban 2 imagenes (logo y camioneta), hay %d' % len(pagina.get_images()))

    datos = doc.tobytes(garbage=4, deflate=True, clean=True)
    b64 = base64.b64encode(datos).decode()
    trozos = [b64[i:i + 100] for i in range(0, len(b64), 100)]
    with open(destino, 'w', encoding='utf-8', newline='\n') as f:
        f.write('/**\n')
        f.write(' * Formato "CHECKLIST DE VEHICULOS LIVIANOS" EN BLANCO, tal como lo\n')
        f.write(' * exportaba la planilla de Google, en base64. La plataforma escribe\n')
        f.write(' * los datos encima (ver checklist-formato-pdf.util.ts).\n')
        f.write(' *\n')
        f.write(' * GENERADO por scripts/generar-plantilla-checklist.py. No editar a mano.\n')
        f.write(' * Va en el codigo y no como archivo porque el build no copia binarios.\n')
        f.write(' */\n')
        # Arreglo + join y no una cadena de '...' + '...': miles de sumas
        # anidadas desbordan la pila del compilador de TypeScript.
        f.write('export const PLANTILLA_CHECKLIST_PDF_BASE64 = [\n')
        f.write('\n'.join("  '%s'," % t for t in trozos))
        f.write("\n].join('');\n")
    print('valores borrados: %d | casillas: %d | plantilla: %d KB' % (len(borrados), casillas, len(datos) // 1024))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
