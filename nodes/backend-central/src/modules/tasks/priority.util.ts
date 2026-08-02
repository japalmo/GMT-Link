import { TaskPriority } from '@prisma/client';

/**
 * Función pura que calcula la prioridad escalada de una tarea.
 * 
 * Reglas (Plan Maestro / Plan B1):
 * - Si el usuario fijó la prioridad manual (priorityManual = true), se respeta la actual.
 * - Si no tiene fecha de entrega (dueDate = null), siempre es BAJA.
 * - En base al tiempo restante hasta la entrega (vs. 'now'):
 *   - > 7 días: BAJA
 *   - <= 7 y > 3 días: MEDIA
 *   - <= 3 y >= 0 días: ALTA
 *   - < 0 días (vencida): URGENTE
 */
import { startOfTodaySantiago } from '../finance/finance-time.util';

export function computeTaskPriority(
  currentPriority: TaskPriority,
  priorityManual: boolean,
  dueDate: Date | null,
  now: Date = new Date()
): TaskPriority {
  if (priorityManual) return currentPriority;
  if (!dueDate) return 'BAJA';

  // dueDate (cuando se manda date-only 'YYYY-MM-DD') se guarda como medianoche UTC.
  // Para comparar "días restantes" correctamente según la hora de Chile, anclamos 'now'
  // al día calendario de Santiago en formato medianoche UTC.
  const todayUtcAnchor = startOfTodaySantiago(now);
  
  // Normalizar dueDate a medianoche UTC por si viene con hora (para que sea solo fecha)
  const dueDateAnchor = new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()));

  const msToDue = dueDateAnchor.getTime() - todayUtcAnchor.getTime();
  const daysToDue = Math.round(msToDue / (1000 * 60 * 60 * 24));

  if (daysToDue < 0) return 'URGENTE';
  if (daysToDue <= 3) return 'ALTA';
  if (daysToDue <= 7) return 'MEDIA';
  
  return 'BAJA';
}
