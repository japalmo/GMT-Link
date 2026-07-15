import { describe, it, expect } from 'vitest';
import { parseSvgUpload, parseCommentMap, sanitizeSvgMarkup } from './svg-checklist-input';

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

describe('sanitizeSvgMarkup', () => {
  it('devuelve null para entrada vacía', () => {
    expect(sanitizeSvgMarkup(null)).toBeNull();
    expect(sanitizeSvgMarkup(undefined)).toBeNull();
    expect(sanitizeSvgMarkup('')).toBeNull();
  });

  it('conserva el <svg> saneado', () => {
    const clean = sanitizeSvgMarkup(VALID_SVG);
    expect(clean).toContain('<svg');
    expect(clean).toContain('id="capo"');
  });
});
