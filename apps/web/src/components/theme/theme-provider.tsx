import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getSettings, updateSettings } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import type { ThemePreference } from '@/types/settings';

/** Valor expuesto por el contexto de tema. */
interface ThemeContextValue {
  /** Preferencia elegida por el usuario (`system` sigue al SO). */
  theme: ThemePreference;
  /**
   * Cambia la preferencia: la aplica al instante (DoM) y la persiste vía
   * `PATCH /settings/me`. Si el guardado falla, revierte la preferencia local.
   */
  setTheme: (theme: ThemePreference) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/** ¿El SO prefiere modo oscuro? (false en SSR / entornos sin matchMedia). */
function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

/** Resuelve si una preferencia debe pintar oscuro, considerando el SO. */
function resolveIsDark(theme: ThemePreference): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemPrefersDark();
}

/** Aplica/quita la clase `dark` en <html> y sincroniza `color-scheme`. */
function applyTheme(theme: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = resolveIsDark(theme);
  root.classList.toggle('dark', dark);
  // Ayuda a que controles nativos (scrollbars, selects) usen el esquema correcto.
  root.style.colorScheme = dark ? 'dark' : 'light';
}

/**
 * Provider de tema (§6-2.3). Cuando hay sesión, carga `GET /settings/me` y
 * aplica el tema sobre <html> (clase `.dark` ya tokenizada en index.css).
 *
 * - `light` → sin `.dark`; `dark` → con `.dark`; `system` → según el SO, con un
 *   listener de `prefers-color-scheme` que reacciona a cambios en vivo.
 * - Sin sesión NO fuerza nada: el login queda en claro (el default del CSS).
 * - `setTheme` aplica al instante y persiste; revierte si el backend rechaza.
 *
 * Debe montarse dentro de <AuthProvider> y envolver al router.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const { user } = useAuth();
  // `system` es el punto de partida razonable mientras no haya datos del backend.
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * Carga las preferencias cuando hay sesión y las aplica. Si no hay usuario,
   * no tocamos <html>: la página de login se ve en claro (default del CSS) y
   * evitamos parpadeos hacia un tema que aún no conocemos.
   */
  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      try {
        const settings = await getSettings();
        if (active && mountedRef.current) {
          setThemeState(settings.theme);
          applyTheme(settings.theme);
        }
      } catch {
        // Si falla la carga, mantenemos el default; no rompemos la app.
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  /*
   * Con `system`, reaccionamos a cambios del SO en vivo. El listener solo está
   * activo mientras la preferencia sea `system`, así que cambiar a light/dark
   * lo desmonta y deja de reaccionar.
   */
  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback(
    async (next: ThemePreference): Promise<void> => {
      const previous = theme;
      // Aplicación inmediata: el cambio se ve en vivo aunque el PATCH tarde.
      setThemeState(next);
      applyTheme(next);
      try {
        await updateSettings({ theme: next });
      } catch (err) {
        // Revertimos si el backend rechaza, para no mentirle al usuario.
        if (mountedRef.current) {
          setThemeState(previous);
          applyTheme(previous);
        }
        throw err;
      }
    },
    [theme],
  );

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Hook de acceso al tema. Falla si se usa fuera de <ThemeProvider>. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme debe usarse dentro de <ThemeProvider>.');
  }
  return ctx;
}
