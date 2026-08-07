import { describe, it, expect } from 'vitest';
import { parseSvgUpload, parseCommentMap, sanitizeSvg } from './svg-checklist-input';
import { DIAGRAMA_CAMIONETA, PARTES_CARROCERIA } from '@gmt-platform/contracts';

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <g id="capo" data-part="Capó"><rect x="0" y="0" width="10" height="10" /></g>
  <g id="puerta"><rect x="20" y="0" width="10" height="10" /></g>
  <rect id="no-es-g" x="40" y="0" width="10" height="10" />
</svg>`;

describe('parseSvgUpload', () => {
  it('extrae los <g id> como partes, usando data-part o el id como nombre', () => {
    const result = parseSvgUpload(VALID_SVG);
    expect(result.error).toBeNull();
    expect(result.svg).toContain('<svg');
    expect(result.parts).toEqual([
      { id: 'capo', name: 'Capó' },
      { id: 'puerta', name: 'puerta' },
    ]);
  });

  it('sanitiza: remueve <script> y atributos on*', () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg">
      <script>alert(1)</script>
      <g id="x" onclick="steal()"><rect onload="x()" width="5" height="5"/></g>
    </svg>`;
    const result = parseSvgUpload(dirty);
    expect(result.svg).not.toContain('<script');
    expect(result.svg).not.toContain('onclick');
    expect(result.svg).not.toContain('onload');
    expect(result.parts).toEqual([{ id: 'x', name: 'x' }]);
  });

  it('devuelve el marcado pero con error/advertencia si no hay <g id>', () => {
    const noGroups = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>`;
    const result = parseSvgUpload(noGroups);
    expect(result.svg).toContain('<svg');
    expect(result.parts).toEqual([]);
    expect(result.error).not.toBeNull();
  });

  it('reporta error claro si el contenido no es un SVG', () => {
    const notSvg = `<html><body>hola</body></html>`;
    const result = parseSvgUpload(notSvg);
    expect(result.svg).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe('parseCommentMap', () => {
  it('devuelve {} para valor vacío o JSON inválido', () => {
    expect(parseCommentMap(undefined)).toEqual({});
    expect(parseCommentMap('')).toEqual({});
    expect(parseCommentMap('no-json')).toEqual({});
    expect(parseCommentMap('null')).toEqual({});
  });

  it('parsea entradas válidas y descarta las mal formadas', () => {
    const value = JSON.stringify({
      capo: { part: 'Capó', comment: 'Rayón' },
      malo: { part: 'Sin comentario' },
      puerta: { comment: 'Abolladura' },
    });
    expect(parseCommentMap(value)).toEqual({
      capo: { part: 'Capó', comment: 'Rayón' },
      puerta: { part: 'puerta', comment: 'Abolladura' },
    });
  });
});

describe('sanitizeSvg', () => {
  it('conserva el <svg>, los grupos de dibujo y el atributo id', () => {
    const clean = sanitizeSvg(VALID_SVG);
    expect(clean).toContain('<svg');
    expect(clean).toContain('id="capo"');
    expect(clean).toContain('id="puerta"');
    // El atributo data-part (usado para nombrar/ubicar partes) sobrevive.
    expect(clean).toContain('data-part="Capó"');
  });

  it('conserva un grupo de dibujo limpio con su id (<g id="techo">)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g id="techo"><path d="M0 0h10v10H0z"/></g></svg>`;
    const clean = sanitizeSvg(svg);
    expect(clean).toContain('<g id="techo"');
  });

  // --- Payloads XSS que la lista negra casera dejaba pasar (ahora neutralizados). ---

  it('neutraliza foreignObject + iframe (XSS zero-click)', () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="javascript:alert(1)"></iframe></foreignObject><g id="p1"/></svg>`;
    const clean = sanitizeSvg(payload);
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<foreignObject');
    expect(clean.toLowerCase()).not.toContain('foreignobject');
  });

  it('neutraliza <a xlink:href="javascript..."> con carácter de control', () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript&#10;:alert(1)"><rect width="5" height="5"/></a></svg>`;
    const clean = sanitizeSvg(payload);
    expect(clean).not.toContain('<a');
    expect(clean.toLowerCase()).not.toContain('javascript');
  });

  it('neutraliza <image> con referencia externa', () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil/x.png"/></svg>`;
    const clean = sanitizeSvg(payload);
    expect(clean).not.toContain('<image');
    expect(clean).not.toContain('https://evil');
  });

  it('elimina <script> y conserva el grupo con id', () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><g id="p1"/></svg>`;
    const clean = sanitizeSvg(payload);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
    expect(clean).toContain('<g id="p1"');
  });

  it('despoja url()/expression() del atributo style (beacon externo) conservando fill', () => {
    const payload = `<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:#ff0000;background:url(https://evil/x.png)" id="p1"/></svg>`;
    const clean = sanitizeSvg(payload);
    expect(clean).not.toContain('https://evil');
    expect(clean.toLowerCase()).not.toContain('url(');
    expect(clean).toContain('fill:#ff0000'); // el estilo legítimo se conserva
  });
});

describe('diagrama real de carrocería', () => {
  /**
   * El diagrama viene del formulario que la flota usa hoy en AppScript. Si el
   * saneado se comiera una parte, el conductor no podría marcarla y nadie se
   * enteraría: el diagrama seguiría dibujándose, solo que sin esa zona.
   */
  it('sobrevive el saneado con sus 40 zonas comentables', () => {
    const limpio = sanitizeSvg(DIAGRAMA_CAMIONETA);
    for (const parte of PARTES_CARROCERIA) {
      expect(limpio, `falta la zona ${parte.id}`).toContain(`id="${parte.id}"`);
    }
    expect(PARTES_CARROCERIA).toHaveLength(40);
  });

  it('conserva TODO el trazado, no solo los grupos', () => {
    // Se compara entrada contra salida en vez de contra un número fijo: así la
    // prueba sigue valiendo si algún día se redibuja el diagrama, y falla solo
    // cuando el saneado de verdad se come algo. Sin trazos quedarían los <g>
    // vacíos y el diagrama saldría en blanco sin ningún error.
    const dibujo = /<(path|polyline|polygon|circle|rect|ellipse|line)\b/g;
    const antes = (DIAGRAMA_CAMIONETA.match(dibujo) ?? []).length;
    const despues = (sanitizeSvg(DIAGRAMA_CAMIONETA).match(dibujo) ?? []).length;

    expect(antes).toBeGreaterThan(0);
    expect(despues).toBe(antes);
    expect(sanitizeSvg(DIAGRAMA_CAMIONETA)).toContain('viewBox="0 0 1567.66 877.34"');
  });

  it('hereda el color en vez de fijar el navy, para servir en ambos temas', () => {
    expect(DIAGRAMA_CAMIONETA).toContain('fill="currentColor"');
    expect(DIAGRAMA_CAMIONETA).not.toContain('#26326b');
  });

  it('no arrastra el <style> ni los scripts del original', () => {
    const limpio = sanitizeSvg(DIAGRAMA_CAMIONETA);
    expect(limpio).not.toContain('<style');
    expect(limpio).not.toContain('<script');
  });

  it('las cuatro etiquetas equivocadas del original quedaron corregidas', () => {
    // El sufijo _i es izquierdo y _d derecho: en el original estas cuatro se
    // contradecían, y marcar la ventana izquierda salía impreso como derecha.
    const nombre = (id: string) => PARTES_CARROCERIA.find((p) => p.id === id)?.name;
    expect(nombre('ventana_di')).toBe('Ventana delantera izquierda');
    expect(nombre('ventana_ti')).toBe('Ventana trasera izquierda');
    expect(nombre('espj_d')).toBe('Espejo derecho');
    expect(nombre('faro_dd')).toBe('Faro derecho');
  });

  it('ninguna zona queda con el nombre repetido', () => {
    const nombres = PARTES_CARROCERIA.map((p) => p.name);
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
