import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { login as apiLogin, getMe, completeFirstLogin as apiCompleteFirstLogin } from '@/lib/api';
import { getToken, setToken, clearToken } from '@/lib/auth-token';
import type { AuthedUser } from '@/types/auth';

interface AuthContextValue {
  user: AuthedUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeFirstLogin: (currentPassword: string, newPassword: string) => Promise<void>;
  /**
   * Refresca el perfil (getMe) y devuelve el usuario actualizado. Útil para leer
   * flags que pueden cambiar en el servidor durante una sesión larga (p. ej. si la
   * firma del checklist pasa a ser obligatoria a mitad de un rollout). Devuelve el
   * usuario o `null` si no hay sesión; ante un error transitorio conserva el actual.
   */
  refreshUser: () => Promise<AuthedUser | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // `user` es el AuthedUser completo devuelto por getMe() — desde la matriz RBAC
  // incluye `canManageRoles` (relación FGA can_manage_roles) sin cambios de lógica:
  // el objeto se reenvía tal cual, el campo viaja solo gracias al tipo actualizado.
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: si hay token guardado, validarlo trayendo el perfil.
  useEffect(() => {
    let active = true;
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    getMe()
      .then((me) => { if (active) setUser(me); })
      .catch(() => { if (active) { clearToken(); setUser(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const { token } = await apiLogin(username, password);
    setToken(token);
    try {
      const me = await getMe();
      setUser(me);
    } catch (err) {
      clearToken();
      setUser(null);
      throw err;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    clearToken();
    setUser(null);
  }, []);

  // Tras fijar la clave, el MISMO token sigue válido (solo cambia el status); refrescamos el perfil.
  const completeFirstLogin = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      await apiCompleteFirstLogin(currentPassword, newPassword);
      const me = await getMe();
      setUser(me);
    },
    [],
  );

  const refreshUser = useCallback(async (): Promise<AuthedUser | null> => {
    if (!getToken()) {
      setUser(null);
      return null;
    }
    try {
      const me = await getMe();
      setUser(me);
      return me;
    } catch {
      // Error transitorio (no 401): conserva el usuario actual en vez de expulsar.
      return user;
    }
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, completeFirstLogin, refreshUser }),
    [user, loading, login, logout, completeFirstLogin, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
}
