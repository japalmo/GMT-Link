/**
 * Preferencias de configuración del usuario (§6-2.3).
 * Vista pública de `UserPreferences`: solo los campos que el front necesita
 * (tema + canales de notificación). Sin `id`/`userId`/`updatedAt`.
 */
export interface UserPreferencesView {
  /** Tema de la interfaz: system | light | dark. */
  theme: ThemePreference;
  /** Recibir notificaciones in-app (overlay + sección). Default true. */
  notifyInApp: boolean;
  /** Recibir notificaciones por email (canal aún no integrado). Default false. */
  notifyEmail: boolean;
}

/** Valores válidos de `theme` (§6-2.3 "preferencias de diseño"). */
export const THEME_VALUES = ['system', 'light', 'dark'] as const;

/** Unión de temas válidos. */
export type ThemePreference = (typeof THEME_VALUES)[number];
