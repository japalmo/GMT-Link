import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { login as apiLogin, getMe, completeFirstLogin as apiCompleteFirstLogin } from '@/lib/api';
import { getToken, setToken, clearToken } from '@/lib/auth-token';
import type { AuthedUser } from '@/types/auth';

interface AuthContextValue {
  user: AuthedUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeFirstLogin: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
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

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const { token } = await apiLogin(email, password);
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
  const completeFirstLogin = useCallback(async (newPassword: string): Promise<void> => {
    await apiCompleteFirstLogin(newPassword);
    const me = await getMe();
    setUser(me);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, completeFirstLogin }),
    [user, loading, login, logout, completeFirstLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
}
