import type { BadgeProps } from '@/components/ui/badge';
import type {
  TicketFrequency,
  TicketLane,
  TicketPeopleAffected,
  TicketPriority,
  TicketSize,
  TicketStatus,
  TicketType,
} from '@/lib/api';

type Variant = NonNullable<BadgeProps['variant']>;

/**
 * Etiquetas legibles de Soporte TI. El backend guarda los estados en
 * UPPERCASE_SNAKE y NUNCA la etiqueta: se resuelve acá, que es la convención del
 * proyecto. Un estado nuevo en Prisma obliga a agregarlo en estos Record, y el
 * typecheck lo caza.
 */
export const TICKET_STATUS_META: Record<TicketStatus, { label: string; variant: Variant }> = {
  BORRADOR: { label: 'Borrador', variant: 'neutral' },
  ENVIADO: { label: 'Enviado', variant: 'warning' },
  EN_TRIAGE: { label: 'En triage', variant: 'info' },
  REQUIERE_INFO: { label: 'Requiere información', variant: 'warning' },
  RECHAZADO: { label: 'Rechazado', variant: 'danger' },
  EN_BACKLOG: { label: 'En backlog', variant: 'neutral' },
  EN_LEVANTAMIENTO: { label: 'En levantamiento', variant: 'info' },
  EN_DISENO: { label: 'En diseño', variant: 'info' },
  EN_DESARROLLO: { label: 'En desarrollo', variant: 'info' },
  EN_QA: { label: 'En QA', variant: 'info' },
  EN_UAT: { label: 'En validación', variant: 'warning' },
  ENTREGADO: { label: 'Entregado', variant: 'success' },
  CERRADO: { label: 'Cerrado', variant: 'success' },
};

export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  REQUERIMIENTO: 'Requerimiento',
  INCIDENCIA: 'Incidencia',
  MEJORA: 'Mejora',
  ACCESO: 'Acceso',
};

/** Qué significa cada tipo, para que el área elija bien y no por descarte. */
export const TICKET_TYPE_HINTS: Record<TicketType, string> = {
  REQUERIMIENTO: 'Algo que el sistema todavía no hace y necesitas que haga.',
  INCIDENCIA: 'Algo que debería funcionar y hoy está fallando.',
  MEJORA: 'Algo que ya funciona pero podría ser más rápido o más simple.',
  ACCESO: 'Permisos, cuentas o visibilidad sobre información.',
};

export const TICKET_LANE_LABELS: Record<TicketLane, string> = {
  PROYECTO: 'Proyecto',
  RAPIDA: 'Vía rápida',
};

export const TICKET_SIZE_LABELS: Record<TicketSize, string> = {
  S: 'S (chico)',
  M: 'M (mediano)',
  L: 'L (grande)',
};

export const TICKET_PRIORITY_META: Record<TicketPriority, { label: string; variant: Variant }> = {
  CRITICA: { label: 'Crítica', variant: 'danger' },
  ALTA: { label: 'Alta', variant: 'warning' },
  NORMAL: { label: 'Normal', variant: 'info' },
  BAJA: { label: 'Baja', variant: 'neutral' },
};

export const TICKET_PEOPLE_LABELS: Record<TicketPeopleAffected, string> = {
  RANGO_1_3: '1 a 3 personas',
  RANGO_4_10: '4 a 10 personas',
  RANGO_11_30: '11 a 30 personas',
  RANGO_31_MAS: 'Más de 30 personas',
};

export const TICKET_FREQUENCY_LABELS: Record<TicketFrequency, string> = {
  DIARIA: 'Diaria',
  SEMANAL: 'Semanal',
  MENSUAL: 'Mensual',
  PUNTUAL: 'Puntual',
};

/** Módulos del sistema sobre los que se puede pedir algo. */
export const TICKET_MODULES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'proyectos', label: 'Proyectos' },
  { value: 'operaciones', label: 'Operaciones' },
  { value: 'finanzas', label: 'Finanzas' },
  { value: 'recursos', label: 'Recursos y vehículos' },
  { value: 'usuarios', label: 'Usuarios y accesos' },
  { value: 'directorio', label: 'Directorio' },
  { value: 'v-metric', label: 'V-Metric' },
  { value: 'otro', label: 'Otro' },
];

/** Texto legible del módulo; si es uno desconocido, se muestra tal cual. */
export function moduleLabel(value: string): string {
  return TICKET_MODULES.find((m) => m.value === value)?.label ?? value;
}

/**
 * ¿El plazo de triage está vencido? Solo aplica mientras el ticket sigue
 * esperando que Informática lo tome; después el plazo deja de correr.
 */
export function slaVencido(status: TicketStatus, slaTriageDueAt: string | null): boolean {
  if (status !== 'ENVIADO' || !slaTriageDueAt) return false;
  return new Date(slaTriageDueAt).getTime() < Date.now();
}
