/**
 * Catálogo estático de logros/badges del sistema de gamificación (§6-7.1).
 *
 * Cada logro define su condición de desbloqueo. El GamificationService evalúa
 * estas condiciones periódicamente (tras cada awardPoints) contra las
 * estadísticas del usuario.
 */

export interface AchievementDefinition {
  /** Clave única del logro (persistida en UserAchievement.achievementKey). */
  key: string;
  /** Nombre visible del logro. */
  title: string;
  /** Descripción corta para tooltip/card. */
  description: string;
  /** Emoji/icono del badge. */
  icon: string;
  /** Tipo de condición para evaluación automática. */
  condition:
    | { type: 'action_count'; action: string; threshold: number }
    | { type: 'total_points'; threshold: number }
    | { type: 'account_age_days'; threshold: number }
    | { type: 'first_action'; action: string };
}

export const ACHIEVEMENTS_CATALOG: readonly AchievementDefinition[] = [
  {
    key: 'first_day',
    title: 'Primer Día',
    description: 'Completaste tu primer inicio de sesión.',
    icon: '🏅',
    condition: { type: 'first_action', action: 'FIRST_LOGIN' },
  },
  {
    key: 'cv_complete',
    title: 'CV Completo',
    description: 'Llenaste el 100% de tu hoja de vida.',
    icon: '📝',
    condition: { type: 'first_action', action: 'COMPLETE_CV' },
  },
  {
    key: 'star_operator',
    title: 'Operador Estrella',
    description: 'Completaste 25 o más tareas asignadas.',
    icon: '🔧',
    condition: { type: 'action_count', action: 'COMPLETE_TASK', threshold: 25 },
  },
  {
    key: 'veteran_500',
    title: 'Veterano',
    description: 'Acumulaste 500 o más puntos de experiencia.',
    icon: '🏆',
    condition: { type: 'total_points', threshold: 500 },
  },
  {
    key: 'old_guard_365',
    title: 'Guardia Antigua',
    description: 'Llevas más de 1 año en el sistema. ¡Gracias por tu fidelidad!',
    icon: '🛡️',
    condition: { type: 'account_age_days', threshold: 365 },
  },
  {
    key: 'old_guard_730',
    title: 'Leyenda',
    description: 'Llevas más de 2 años en el sistema. Eres parte del legado de GMT.',
    icon: '👑',
    condition: { type: 'account_age_days', threshold: 730 },
  },
] as const;

/** Mapa de acción → puntos estándar otorgados. */
export const POINTS_TABLE: Readonly<Record<string, number>> = {
  FIRST_LOGIN: 50,
  COMPLETE_CV: 100,
  UPLOAD_DOC: 10,
  CREATE_TASK: 5,
  COMPLETE_TASK: 15,
  RUN_CHECKLIST: 10,
};
