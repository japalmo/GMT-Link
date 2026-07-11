import type { EmailKind } from '@gmt-platform/contracts';

/**
 * Correo destino de las notificaciones por email. Reusa `EmailKind` del contrato
 * ('INSTITUCIONAL' | 'PERSONAL'); null = sin destino elegido.
 */
export type NotifyEmailTarget = EmailKind;

/**
 * Preferencias de configuración del usuario (§6-2.3).
 * Vista pública de `UserPreferences`: solo los campos que el front necesita
 * (tema + canales de notificación + destino de email). Sin `id`/`userId`/`updatedAt`.
 */
export interface UserPreferencesView {
  /** Tema de la interfaz: system | light | dark. */
  theme: ThemePreference;
  /** Recibir notificaciones in-app (overlay + sección). Default true. */
  notifyInApp: boolean;
  /** Recibir notificaciones por email (canal aún no integrado). Default false. */
  notifyEmail: boolean;
  /**
   * Correo destino de las notificaciones por email ('INSTITUCIONAL' | 'PERSONAL').
   * Solo se acepta apuntando a un correo VERIFICADO. null = sin destino elegido.
   */
  notifyEmailTarget: NotifyEmailTarget | null;
}

/** Valores válidos de `theme` (§6-2.3 "preferencias de diseño"). */
export const THEME_VALUES = ['system', 'light', 'dark'] as const;

/** Unión de temas válidos. */
export type ThemePreference = (typeof THEME_VALUES)[number];
