/**
 * Enmascara una dirección de correo para mostrarla sin revelarla por completo,
 * p. ej. `juanapalmo@gmail.com` -> `jua*****@gmail.com`. Se usa en el flujo de
 * recuperación de contraseña: al usuario le confirmamos A DÓNDE enviamos el
 * código/credencial sin exponer el correo entero a quien haya escrito su usuario.
 *
 * Reglas:
 *  - Se conserva el dominio completo (`@gmail.com`) — es lo que espera ver el
 *    dueño de la cuenta para reconocer su correo.
 *  - De la parte local se muestran los primeros caracteres (máx. 3) y SIEMPRE se
 *    oculta al menos uno; el resto se reemplaza por una corrida FIJA de 5
 *    asteriscos (fija, no proporcional, para no filtrar el largo real).
 *  - Entrada inválida o vacía -> devuelve una máscara genérica sin lanzar.
 */
const MASK = '*****';

export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? '').trim();
  const at = value.lastIndexOf('@');
  // Sin '@' o sin parte local/dominio: no hay nada seguro que mostrar.
  if (at <= 0 || at === value.length - 1) {
    return MASK;
  }
  const local = value.slice(0, at);
  const domain = value.slice(at); // incluye la '@'
  // Muestra hasta 3 chars, pero SIEMPRE oculta al menos uno. Para una parte local
  // de 1 char, visibleCount = 0 -> no se muestra nada (queda `*****@dominio`), sin
  // romper el invariante "oculta >= 1".
  const visibleCount = Math.min(3, local.length - 1);
  const visible = local.slice(0, visibleCount);
  return `${visible}${MASK}${domain}`;
}
