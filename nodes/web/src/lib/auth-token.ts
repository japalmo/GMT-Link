const KEY = 'gmt_token';

/** JWT de sesión guardado en localStorage. `null` si no hay sesión. */
export function getToken(): string | null {
  return localStorage.getItem(KEY);
}
export function setToken(token: string): void {
  localStorage.setItem(KEY, token);
}
export function clearToken(): void {
  localStorage.removeItem(KEY);
}
