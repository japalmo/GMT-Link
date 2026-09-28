/**
 * Formularios públicos por pasos: piezas compartidas.
 *
 * Las usan el reporte de incidentes de HSE y el checklist de vehículos, que se
 * llenan en el mismo contexto (un teléfono, en faena, a veces sin sesión) y
 * tienen que verse como el mismo producto.
 */
export { Pantalla, Aviso, Campo, Segmentado, ENTRADA } from './pantalla';
export { BarraPasos } from './barra-pasos';
export { SelectorFecha } from './selector-fecha';
export { SelectorHora } from './selector-hora';
export { FirmaCanvas } from './firma-canvas';
