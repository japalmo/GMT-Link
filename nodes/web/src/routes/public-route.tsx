import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/auth-context';
import { FullPageLoader } from '@/components/layout/full-page-loader';

/**
 * Guard de rutas públicas (login). Si ya hay sesión, redirige según el estado:
 * PENDING_FIRST_LOGIN → /first-login, en otro caso → /. Evita ver el login
 * estando autenticado.
 */
export function PublicRoute() {
  const { user, loading } = useAuth();

  if (loading) return <FullPageLoader label="Cargando…" />;
  if (user) {
    const to =
      user.status === 'PENDING_FIRST_LOGIN'
        ? '/first-login'
        : user.status === 'ACTIVE'
          ? '/'
          : '/suspended';
    return <Navigate to={to} replace />;
  }

  return <Outlet />;
}
