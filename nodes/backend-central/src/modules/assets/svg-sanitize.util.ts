import DOMPurify from 'isomorphic-dompurify';
import type { Config } from 'isomorphic-dompurify';

/**
 * Saneamiento server-side del marcado SVG de un ítem de checklist (defensa en
 * profundidad). El frontend ya sanea con DOMPurify al subir el diagrama, pero un
 * guardado por API directa podría persistir un SVG malicioso; por eso el backend
 * vuelve a sanear ANTES de persistir la plantilla.
 *
 * Se apoya en `isomorphic-dompurify` (DOMPurify + jsdom en Node), NO en regex
 * frágil. Elimina del marcado los elementos peligrosos (`<script>`,
 * `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `<style>`, `<a>`,
 * `<image>`, `<use>`, `<animate*>`, `<set>`) y los atributos de escape
 * (`on*`, `href`, `xlink:href`, `src`, `data`). Conserva la estructura del
 * diagrama y el atributo `id` de las partes (`<g id>`), que el inspector necesita
 * para dejar observaciones.
 */
const SVG_SANITIZE_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: [
    'foreignObject',
    'iframe',
    'object',
    'embed',
    'script',
    'style',
    'a',
    'image',
    'use',
    'audio',
    'video',
    'animate',
    'animateColor',
    'animateTransform',
    'animateMotion',
    'set',
  ],
  FORBID_ATTR: ['href', 'xlink:href', 'src', 'data'],
};

// El atributo `style` sobrevive el perfil svg (lo necesitan diagramas legítimos con
// fill/stroke), pero su CSS puede cargar recursos externos vía url(...) (beacon de
// tracking) o expression() (IE viejo). Se despojan esas construcciones del valor
// conservando el resto del estilo, cerrando el canal sin romper el diagrama.
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style' && data.attrValue) {
    data.attrValue = data.attrValue
      .replace(/url\s*\([^)]*\)/gi, '')
      .replace(/expression\s*\([^)]*\)/gi, '');
  }
});

/**
 * Sanea el marcado SVG de un diagrama de checklist. Los atributos `on*` los
 * remueve DOMPurify por defecto. Devuelve el marcado saneado (string). No lanza
 * ante un marcado inválido: DOMPurify devuelve lo que logra parsear.
 */
export function sanitizeSvgMarkup(svg: string): string {
  return DOMPurify.sanitize(svg, SVG_SANITIZE_CONFIG);
}
