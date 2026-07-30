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
export function computeTaskPriority(
  currentPriority: TaskPriority,
  priorityManual: boolean,
  dueDate: Date | null,
  now: Date = new Date()
): TaskPriority {
  if (priorityManual) return currentPriority;
  if (!dueDate) return 'BAJA';

  const msToDue = dueDate.getTime() - now.getTime();
  const daysToDue = msToDue / (1000 * 60 * 60 * 24);

  if (daysToDue < 0) return 'URGENTE';
  if (daysToDue <= 3) return 'ALTA';
  if (daysToDue <= 7) return 'MEDIA';
  
  return 'BAJA';
}
