import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Longitud mínima de la contraseña (contrato backend). */
const MIN_LENGTH = 8;

/** Mensaje legible a partir de un error desconocido. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/**
 * Sección "Cambiar contraseña" (§6-1.3). Pide la nueva clave y su confirmación,
 * valida largo mínimo y coincidencia, y persiste vía `onChangePassword`. La
 * contraseña nunca se registra ni se expone fuera de este componente.
 */
export function ChangePasswordForm({
  onChangePassword,
}: {
  onChangePassword: (newPassword: string) => Promise<void>;
}): ReactNode {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset(): void {
    setPassword('');
    setConfirm('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (password.length < MIN_LENGTH) {
      setSuccess(false);
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setSuccess(false);
      setError('Las contraseñas no coinciden.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await onChangePassword(password);
      reset();
      setSuccess(true);
    } catch (err) {
      setError(toMessage(err, 'No se pudo cambiar la contraseña.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-password">Nueva contraseña</Label>
        <div className="relative">
          <Input
            id="new-password"
            type={reveal ? 'text' : 'password'}
            className="pr-10"
            value={password}
            minLength={MIN_LENGTH}
            autoComplete="new-password"
            onChange={(e) => {
              setPassword(e.target.value);
              setSuccess(false);
              setError(null);
            }}
            disabled={submitting}
            required
            aria-describedby="new-password-help"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            aria-pressed={reveal}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {reveal ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        </div>
        <p id="new-password-help" className="text-xs text-muted-foreground">
          Mínimo {MIN_LENGTH} caracteres.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-password">Confirmar nueva contraseña</Label>
        <Input
          id="confirm-password"
          type={reveal ? 'text' : 'password'}
          value={confirm}
          minLength={MIN_LENGTH}
          autoComplete="new-password"
          onChange={(e) => {
            setConfirm(e.target.value);
            setSuccess(false);
            setError(null);
          }}
          disabled={submitting}
          required
        />
      </div>

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {error}
        </p>
      )}

      {success && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          <Check className="size-4 shrink-0" aria-hidden />
          Tu contraseña se actualizó correctamente.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Actualizar contraseña
        </Button>
      </div>
    </form>
  );
}
