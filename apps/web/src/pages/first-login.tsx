import { useState, type FormEvent } from 'react';
import { ShieldCheck } from 'lucide-react';
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
import { useAuth } from '@/context/auth-context';
import { ApiError } from '@/lib/api';

const MIN_LENGTH = 8;

/**
 * Cambio de clave forzado en el primer ingreso (Etapa 0.5). Al completar, el
 * `status` pasa a ACTIVE y el routing lleva al usuario a /. Se le explica por
 * qué debe hacerlo: ingresó con una clave provisoria asignada por el admin.
 */
export default function FirstLoginPage() {
  const { user, completeFirstLogin } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    try {
      await completeFirstLogin(password);
      // Al refrescar el user a ACTIVE, el router redirige a /.
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'No se pudo actualizar la contraseña. Inténtalo de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h1 className="text-xl font-bold tracking-tight">GTM Link</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Define tu contraseña</CardTitle>
            <CardDescription>
              {user ? `Hola ${user.firstName}. ` : ''}
              Es tu primer ingreso. Por seguridad, reemplaza la clave provisoria
              por una nueva (mínimo {MIN_LENGTH} caracteres) antes de continuar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-password">Nueva contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby="new-password-hint"
                  disabled={submitting}
                  autoFocus
                />
                <p id="new-password-hint" className="text-xs text-muted-foreground">
                  Al menos {MIN_LENGTH} caracteres.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  disabled={submitting}
                />
              </div>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" loading={submitting} className="w-full">
                {submitting ? 'Guardando…' : 'Guardar y continuar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
