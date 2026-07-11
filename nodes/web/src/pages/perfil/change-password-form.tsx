import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, Eye, EyeOff, Mail, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { errorToMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Longitud mínima de la contraseña (contrato backend). */
const MIN_LENGTH = 8;

/**
 * Sección "Cambiar contraseña" (§6-1.3, endurecida). Exige la contraseña actual,
 * la nueva (mín. 8) + su confirmación, y un código OTP que se envía al correo
 * verificado del usuario con el botón "Enviar código a mi correo". Valida
 * client-side y propaga los errores del backend (401 clave actual incorrecta,
 * código inválido). Las contraseñas nunca se registran ni se exponen fuera de
 * este componente.
 */
export function ChangePasswordForm({
  onChangePassword,
  onRequestCode,
}: {
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
    code: string,
  ) => Promise<void>;
  onRequestCode: () => Promise<void>;
}): ReactNode {
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [reveal, setReveal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset(): void {
    setCurrentPassword('');
    setPassword('');
    setConfirm('');
    setCode('');
    setCodeSent(false);
  }

  function clearFeedback(): void {
    setSuccess(false);
    setError(null);
  }

  async function handleSendCode(): Promise<void> {
    setSendingCode(true);
    clearFeedback();
    try {
      await onRequestCode();
      setCodeSent(true);
      toast.success('Te enviamos un código a tu correo');
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo enviar el código.'));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (currentPassword.length === 0) {
      setSuccess(false);
      setError('Ingresá tu contraseña actual.');
      return;
    }
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
    if (!/^\d{6}$/.test(code.trim())) {
      setSuccess(false);
      setError('Ingresá el código de 6 dígitos que enviamos a tu correo.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await onChangePassword(currentPassword, password, code.trim());
      reset();
      setSuccess(true);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo cambiar la contraseña.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="current-password">Contraseña actual</Label>
        <Input
          id="current-password"
          type={reveal ? 'text' : 'password'}
          value={currentPassword}
          autoComplete="current-password"
          onChange={(e) => {
            setCurrentPassword(e.target.value);
            clearFeedback();
          }}
          disabled={submitting}
          required
        />
      </div>

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
              clearFeedback();
            }}
            disabled={submitting}
            required
            aria-describedby="new-password-help"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}
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
            clearFeedback();
          }}
          disabled={submitting}
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password-code">Código de verificación</Label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            id="password-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000000"
            maxLength={6}
            className="sm:max-w-40"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''));
              clearFeedback();
            }}
            disabled={submitting}
            required
          />
          <Button
            type="button"
            variant="outline"
            loading={sendingCode}
            disabled={submitting}
            onClick={() => void handleSendCode()}
          >
            <Mail aria-hidden />
            Enviar código a mi correo
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {codeSent
            ? 'Revisá tu correo verificado e ingresá el código de 6 dígitos.'
            : 'Enviamos un código de 6 dígitos a tu correo verificado para confirmar el cambio.'}
        </p>
      </div>

      {error && (
        <Alert variant="destructive" live icon={TriangleAlert}>
          {error}
        </Alert>
      )}

      {success && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300"
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
