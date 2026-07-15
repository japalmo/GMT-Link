import { Navigate, Outlet, useLocation, type Location } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { FullPageLoader } from '@/components/layout/full-page-loader';

/**
 * Guard de rutas públicas (login). Si ya hay sesión, redirige según el estado:
 * PENDING_FIRST_LOGIN → /first-login, SUSPENDED → /suspended, ACTIVE → destino
 * preservado (deep-link) si existe, o /. Evita ver el login estando autenticado.
 *
 * Deep-link: ProtectedRoute manda a `/login` con `state.from` (la vista que se
 * intentó abrir sin sesión). Tras loguear, un usuario ACTIVE aterriza en ese
 * destino. Los estados PENDING_FIRST_LOGIN/SUSPENDED IGNORAN el `from` a
 * propósito: deben completar su flujo (/first-login o /suspended) primero.
 */
export function PublicRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader label="Cargando…" />;
  if (user) {
    const from = (location.state as { from?: Location } | null)?.from;
    const to =
      user.status === 'PENDING_FIRST_LOGIN'
        ? '/first-login'
        : user.status === 'ACTIVE'
          ? from
            ? `${from.pathname}${from.search}`
            : '/'
          : '/suspended';
    return <Navigate to={to} replace />;
  }

  return <Outlet />;
}
