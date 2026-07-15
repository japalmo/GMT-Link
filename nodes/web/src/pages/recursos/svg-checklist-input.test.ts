import { describe, it, expect } from 'vitest';
import { parseSvgUpload, parseCommentMap, sanitizeSvg } from './svg-checklist-input';

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
