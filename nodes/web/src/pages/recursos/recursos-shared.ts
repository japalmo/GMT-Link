import type { AssetStatus, ChecklistTemplateItem } from '@/types/assets';

// Tipos y constantes compartidas por la página de Recursos y sus vistas
// (`activos-catalog-view`, `asset-detail-view`). Se extrajeron del monolito
// `index.tsx` para que cada vista viva en su propio archivo sin duplicar estas
// definiciones (fuente única).

// Types for select users
export interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

export type RecursosTab = 'equipos' | 'vehiculos' | 'maquinaria';

/**
 * Destino inicial del detalle de un activo:
 * - 'checklist': pestaña Ficha con scroll al checklist (poner en uso desde la tabla);
 * - 'documentos': pestaña Ficha con scroll a Documentos (deep-link "Ver documentos");
 * - 'reportar-uso': pestaña Información y auto-abre el diálogo de reportar uso si aplica
 *   (deep-link "Registrar uso").
 */
export type AssetDetailTarget = 'checklist' | 'documentos' | 'reportar-uso';

// Plantilla estándar de inspección de camioneta. Fuente única del front (mismo
// contenido que el default del backend). Cada punto crítico es un ESTADO
// Bueno/Regular/Malo con "Malo" = falla y un ítem TEXTO companion para la
// observación exigida al fallar (vinculado por `obsItemId`).
export const VEHICLE_CHECKLIST_DEFAULT: ChecklistTemplateItem[] = [
  {
    id: 'motor',
    label: 'Motor: nivel de aceite e inspección visual',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_motor',
    },
  },
  { id: 'obs_motor', label: 'Observación motor', type: 'TEXTO', required: false },
  {
    id: 'frenos',
    label: 'Frenos: nivel de líquido e inspección visual',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_frenos',
    },
  },
  { id: 'obs_frenos', label: 'Observación frenos', type: 'TEXTO', required: false },
  {
    id: 'neumaticos',
    label: 'Neumáticos: presión y estado general',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_neumaticos',
    },
  },
  { id: 'obs_neumaticos', label: 'Observación neumáticos', type: 'TEXTO', required: false },
  {
    id: 'luces',
    label: 'Luces: altas, bajas, intermitentes y freno',
    type: 'ESTADO',
    required: true,
    config: {
      options: ['Bueno', 'Regular', 'Malo'],
      failOptions: ['Malo'],
      requireObs: false,
      obsItemId: 'obs_luces',
    },
  },
  { id: 'obs_luces', label: 'Observación luces', type: 'TEXTO', required: false },
  {
    id: 'kilometraje',
    label: 'Kilometraje actual (odómetro)',
    type: 'ENTERO',
    required: true,
    config: { isOdometer: true },
  },
  { id: 'observaciones', label: 'Observaciones generales', type: 'TEXTO', required: false },
];

// Etiquetas es-CL de los estados de un activo. Se usan en los labels sueltos del
// detalle (donde no va el Badge). Incluye EN_PREPARACION (alguien reportó uso y
// está llenando el checklist inicial) para no mostrar el enum crudo.
export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  DISPONIBLE: 'Disponible',
  EN_PREPARACION: 'En preparación',
  EN_USO: 'En uso',
  MANTENIMIENTO: 'Mantenimiento',
  BAJA: 'De baja',
  DEFECTUOSO: 'Defectuoso',
  NO_DISPONIBLE: 'No disponible',
};
