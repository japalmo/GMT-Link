import { useEffect, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import logoWideLogin from '@/assets/branding/logo-wide-login.png';
import { useAuth } from '@/context/auth-context';

/** Traduce los errores de la API de login a mensajes claros en español. */
function authErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Usuario o contraseña incorrectos.';
    if (error.status === 0) return 'Sin conexión con el servidor.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}

/**
 * Pantalla de inicio de sesión (Etapa 0.5). Al autenticar, el routing decide el
 * destino (/ o /first-login) según el `status` del usuario; aquí no navegamos.
 */
export default function LoginPage() {
  const { login } = useAuth();
  // Prefill de usuario y clave desde el link del correo de credenciales (?u=&p=). Se
  // leen una sola vez; ver el useEffect que limpia la URL enseguida para que las
  // credenciales NO queden en el historial ni en la barra de direcciones.
  const [initialCreds] = useState(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return { u: q.get('u')?.trim() ?? '', p: q.get('p') ?? '' };
    } catch {
      return { u: '', p: '' };
    }
  });
  const [username, setUsername] = useState(initialCreds.u);
  const [password, setPassword] = useState(initialCreds.p);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Borra usuario/clave de la URL apenas se cargan (no quedan en historial/barra).
  useEffect(() => {
    if ((initialCreds.u || initialCreds.p) && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  }, [initialCreds]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError('Ingresa tu usuario y contraseña.');
      return;
    }

    setSubmitting(true);
    try {
      await login(username.trim(), password);
      // El observer de auth-context poblará el usuario y el router redirige.
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <img src={logoWideLogin} alt="GMT Link" className="h-16 w-auto object-contain" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Iniciar sesión</CardTitle>
            <CardDescription>Accede con tu usuario.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="login-username">Usuario</Label>
                <Input
                  id="login-username"
                  type="text"
                  autoComplete="username"
                  placeholder="tu.usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  disabled={submitting}
                  autoFocus={!initialCreds.u}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="login-password">Contraseña</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  disabled={submitting}
                  autoFocus={!!initialCreds.u && !initialCreds.p}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" loading={submitting} className="w-full">
                {submitting ? 'Ingresando…' : 'Ingresar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
