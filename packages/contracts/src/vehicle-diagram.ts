/**
 * Diagrama de carrocería de camioneta para el ítem SVG del checklist.
 *
 * Vista superior con las zonas que la flota comenta de verdad. Las partes salen
 * de los comentarios reales de la planilla (`obsCarr`): "Parachoques trasero:
 * Chocado", "Portón pickup", "Faro derecho: Quemado", "Rasguños en carrocería y
 * parachoque trasero".
 *
 * Es un diagrama GENÉRICO, no el plano oficial de GMT: no venía en el libro que
 * se usó para reconstruir el formulario. Sirve para operar desde el primer día y
 * se puede reemplazar por el real desde el editor de plantillas sin tocar código,
 * mientras conserve los mismos `id` de parte.
 *
 * Cada zona es un `<g id="...">`: es lo que el input interactivo usa para saber
 * dónde hizo clic el conductor y a qué parte pertenece el comentario.
 */

export interface ParteDiagrama {
  id: string;
  name: string;
}

export const PARTES_CARROCERIA: ParteDiagrama[] = [
  { id: 'parachoque-delantero', name: 'Parachoque delantero' },
  { id: 'faro-izquierdo', name: 'Faro izquierdo' },
  { id: 'faro-derecho', name: 'Faro derecho' },
  { id: 'capo', name: 'Capó' },
  { id: 'parabrisas', name: 'Parabrisas' },
  { id: 'techo', name: 'Techo' },
  { id: 'puerta-del-izq', name: 'Puerta delantera izquierda' },
  { id: 'puerta-del-der', name: 'Puerta delantera derecha' },
  { id: 'puerta-tras-izq', name: 'Puerta trasera izquierda' },
  { id: 'puerta-tras-der', name: 'Puerta trasera derecha' },
  { id: 'costado-izq', name: 'Costado izquierdo' },
  { id: 'costado-der', name: 'Costado derecho' },
  { id: 'pickup', name: 'Pickup (batea)' },
  { id: 'porton', name: 'Portón' },
  { id: 'parachoque-trasero', name: 'Parachoque trasero' },
  { id: 'rueda-del-izq', name: 'Rueda delantera izquierda' },
  { id: 'rueda-del-der', name: 'Rueda delantera derecha' },
  { id: 'rueda-tras-izq', name: 'Rueda trasera izquierda' },
  { id: 'rueda-tras-der', name: 'Rueda trasera derecha' },
];

/**
 * El marcado. Sin estilos de color propios: el input le aplica el resaltado de
 * la aplicación a la parte marcada, así el diagrama funciona igual en tema claro
 * y oscuro.
 */
export const DIAGRAMA_CAMIONETA = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 560" width="320" height="560">
  <g id="parachoque-delantero"><rect x="70" y="18" width="180" height="26" rx="8"/></g>
  <g id="faro-izquierdo"><rect x="76" y="48" width="46" height="20" rx="6"/></g>
  <g id="faro-derecho"><rect x="198" y="48" width="46" height="20" rx="6"/></g>
  <g id="capo"><rect x="70" y="72" width="180" height="70" rx="10"/></g>
  <g id="parabrisas"><path d="M78 146 h164 l-14 44 h-136 z"/></g>
  <g id="techo"><rect x="82" y="194" width="156" height="120" rx="8"/></g>

  <g id="costado-izq"><rect x="52" y="150" width="18" height="240" rx="6"/></g>
  <g id="costado-der"><rect x="250" y="150" width="18" height="240" rx="6"/></g>

  <g id="puerta-del-izq"><rect x="70" y="198" width="14" height="56" rx="4"/></g>
  <g id="puerta-del-der"><rect x="236" y="198" width="14" height="56" rx="4"/></g>
  <g id="puerta-tras-izq"><rect x="70" y="258" width="14" height="56" rx="4"/></g>
  <g id="puerta-tras-der"><rect x="236" y="258" width="14" height="56" rx="4"/></g>

  <g id="pickup"><rect x="82" y="326" width="156" height="150" rx="8"/></g>
  <g id="porton"><rect x="82" y="482" width="156" height="26" rx="6"/></g>
  <g id="parachoque-trasero"><rect x="70" y="514" width="180" height="26" rx="8"/></g>

  <g id="rueda-del-izq"><rect x="30" y="176" width="22" height="58" rx="9"/></g>
  <g id="rueda-del-der"><rect x="268" y="176" width="22" height="58" rx="9"/></g>
  <g id="rueda-tras-izq"><rect x="30" y="392" width="22" height="58" rx="9"/></g>
  <g id="rueda-tras-der"><rect x="268" y="392" width="22" height="58" rx="9"/></g>
</svg>`;
