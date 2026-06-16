import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  completeFirstLogin as apiCompleteFirstLogin,
  getMe,
} from '@/lib/api';
import type { AuthedUser } from '@/types/auth';

/** Valor expuesto por el contexto de autenticación. */
interface AuthContextValue {
  /** Usuario de Postgres si hay sesión válida; `null` si no. */
  user: AuthedUser | null;
  /** `true` mientras se resuelve el estado inicial de la sesión. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  completeFirstLogin: (newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);

  /*
   * Fuente de verdad de la sesión: el observer de Firebase. Cuando hay un
   * `firebaseUser`, traemos el `User` de Postgres (con su status) vía /auth/me.
   * Si /auth/me falla (token inválido, usuario inexistente), tratamos la sesión
   * como cerrada. El cleanup ignora respuestas que llegan tras desmontar.
   */
  useEffect(() => {
    let active = true;

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      if (active) setLoading(true);
      getMe()
        .then((me) => {
          if (active) setUser(me);
        })
        .catch(() => {
          if (active) setUser(null);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  /** Inicia sesión; el observer de arriba poblará `user` con el perfil real. */
  const login = useCallback(async (email: string, password: string): Promise<void> => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await signOut(auth);
  }, []);

  /** Completa el primer login y refresca el `user` para que el routing avance. */
  const completeFirstLogin = useCallback(async (newPassword: string): Promise<void> => {
    const email = auth.currentUser?.email;
    if (!email) throw new Error('No hay sesión activa. Recarga la página.');
    await apiCompleteFirstLogin(newPassword);
    // Re-autenticar con la nueva contraseña para obtener token fresco
    await signInWithEmailAndPassword(auth, email, newPassword);
    const me = await getMe();
    setUser(me);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, completeFirstLogin }),
    [user, loading, login, logout, completeFirstLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Hook de acceso al contexto de auth. Falla si se usa fuera del Provider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  }
  return ctx;
}
