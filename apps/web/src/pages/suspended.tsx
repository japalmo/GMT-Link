import { Navigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FullPageLoader } from '@/components/layout/full-page-loader';
import { useAuth } from '@/context/auth-context';

/**
 * Pantalla de cuenta suspendida (status SUSPENDED, §4.2 UserStatus).
 * Un usuario suspendido tiene sesión Firebase válida pero acceso bloqueado por
 * un admin: no debe alcanzar el shell ni ningún módulo. Solo puede cerrar sesión.
 *
 * Se auto-guarda (no va bajo ProtectedRoute, que la redirigiría en bucle): sin
 * sesión → /login; cualquier estado distinto de SUSPENDED → /.
 */
export default function SuspendedPage() {
  const { user, loading, logout } = useAuth();

  if (loading) return <FullPageLoader label="Cargando…" />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.status !== 'SUSPENDED') return <Navigate to="/" replace />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <ShieldAlert className="size-6 text-destructive" aria-hidden />
          </div>
          <CardTitle>Cuenta suspendida</CardTitle>
          <CardDescription>
            Tu acceso a GTM Link fue suspendido por un administrador. Si crees que
            es un error, contacta al equipo de administración.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void logout()} className="w-full">
            Cerrar sesión
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
