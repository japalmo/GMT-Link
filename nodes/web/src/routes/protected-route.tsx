import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { FullPageLoader } from '@/components/layout/full-page-loader';

/**
 * Guard de rutas protegidas. Política FAIL-CLOSED por estado (§4.2 UserStatus):
 * - mientras se resuelve la sesión → loader global;
 * - sin usuario → /login;
 * - SUSPENDED → /suspended (acceso bloqueado por admin; nunca alcanza el shell);
 * - PENDING_FIRST_LOGIN → /first-login (y solo ahí);
 * - ACTIVE → acceso normal (excepto /first-login, que rebota a /);
 * - cualquier estado futuro no contemplado → bloqueado en /suspended (cierra
 *   en falso ante nuevas variantes del enum).
 * Las rutas hijas se renderizan vía <Outlet/> solo cuando el acceso es válido.
 */
export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { pathname } = location;

  if (loading) return <FullPageLoader label="Verificando sesión…" />;
  // Sin sesión: manda a login PRESERVANDO el destino (deep-link). PublicRoute lo
  // usa para aterrizar ahí tras loguear (p.ej. la ficha pública del QR abre
  // `/recursos?asset=…&accion=…` sin sesión → login → de vuelta a esa vista).
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  if (user.status === 'PENDING_FIRST_LOGIN') {
    return pathname === '/first-login' ? <Outlet /> : <Navigate to="/first-login" replace />;
  }

  if (user.status === 'ACTIVE') {
    // ACTIVE no debe quedarse en el flujo de primer login.
    return pathname === '/first-login' ? <Navigate to="/" replace /> : <Outlet />;
  }

  // SUSPENDED y cualquier estado desconocido: acceso denegado (whitelist).
  return <Navigate to="/suspended" replace />;
}
