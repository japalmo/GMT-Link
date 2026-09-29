/**
 * De dónde viene un checklist enviado, y a nombre de quién se muestra.
 *
 * Se DERIVA, no se guarda: sale de `userId` y `externalSource`, que ya están en
 * cada registro. Guardarlo aparte sería una segunda fuente que tarde o temprano
 * discrepa de la primera.
 *
 * Importa porque el historial es la evidencia de que el vehículo se revisó. Un
 * nombre escrito por alguien sin cuenta no vale lo mismo que uno con sesión, y
 * la pantalla no puede presentarlos igual.
 */

export type OrigenChecklist =
  /** Lo llenó un usuario con sesión: la identidad está verificada. */
  | 'GMT_LINK'
  /** Importado de la planilla de AppScript, antes de la migración. */
  | 'PLANILLA'
  /** Desde el QR sin cuenta: el nombre es el que la persona escribió. */
  | 'SIN_VERIFICAR';

export function origenDelEnvio(envio: {
  userId: string | null;
  externalSource: string | null;
}): OrigenChecklist {
  if (envio.userId) return 'GMT_LINK';
  if (envio.externalSource === 'SHEETS') return 'PLANILLA';
  return 'SIN_VERIFICAR';
}

/**
 * Nombre a mostrar: el del usuario, el declarado en el enlace público o el de
 * la planilla, en ese orden. `null` si no hay ninguno: mejor decir que no se
 * sabe que inventar un nombre.
 */
export function autorDelEnvio(envio: {
  user: { firstName: string; lastName: string } | null | undefined;
  declaredName: string | null;
  externalAuthor: string | null;
}): string | null {
  if (envio.user) return `${envio.user.firstName} ${envio.user.lastName}`.trim();
  const declarado = envio.declaredName?.trim();
  if (declarado) return declarado;
  const planilla = envio.externalAuthor?.trim();
  return planilla ? planilla : null;
}
