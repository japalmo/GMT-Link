import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { BrandLogo } from '@/components/branding/brand-logo';
import { errorToMessage, forgotPassword, resetPassword } from '@/lib/api';

const MIN_LENGTH = 8;

/**
 * Valida la nueva contraseña + su confirmación en el paso de OTP. Devuelve un
 * mensaje de error (para mostrar) o `null` si es válida. Pura, para testear el
 * criterio sin montar el componente.
 */
export function recoverPasswordError(password: string, confirm: string): string | null {
  if (password.length < MIN_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`;
  }
  if (password !== confirm) {
    return 'Las contraseñas no coinciden.';
  }
  return null;
}

/** Fase del flujo de recuperación. */
type Phase = 'request' | 'otp' | 'done-credential' | 'done-reset';

/** Enlace de vuelta al login (pie de las tarjetas). */
function BackToLogin() {
  return (
    <Link to="/login" className="text-sm font-medium text-primary hover:underline">
      Volver a iniciar sesión
    </Link>
  );
}

/**
 * Recuperación de contraseña (#66). Un solo formulario que bifurca según lo que
 * responda el servidor:
 *  - Cuenta pendiente (nunca ingresó): se le reenvía la credencial provisoria al
 *    correo enmascarado y termina el flujo (ingresa con la nueva clave provisoria).
 *  - Cuenta activa: se envía un código de 6 dígitos al correo; el usuario lo canjea
 *    aquí mismo por una contraseña nueva (ingresada dos veces).
 * Nunca se revela el correo completo: solo su versión enmascarada.
 */
export default function RecoverPasswordPage() {
  const [phase, setPhase] = useState<Phase>('request');
  const [username, setUsername] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRequest(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!username.trim()) {
      setError('Ingresa tu usuario.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await forgotPassword(username.trim());
      setMaskedEmail(result.maskedEmail);
      setPhase(result.kind === 'CREDENTIAL_RESENT' ? 'done-credential' : 'otp');
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo iniciar la recuperación. Inténtalo de nuevo.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReset(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Ingresa el código de 6 dígitos que te enviamos.');
      return;
    }
    const invalid = recoverPasswordError(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ username: username.trim(), code: code.trim(), newPassword: password });
      setPhase('done-reset');
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo restablecer la contraseña. Inténtalo de nuevo.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResendCode(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const result = await forgotPassword(username.trim());
      setMaskedEmail(result.maskedEmail);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo reenviar el código. Inténtalo de nuevo.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <BrandLogo variant="logo" className="h-24" />
        </div>

        {phase === 'request' && (
          <Card>
            <CardHeader>
              <CardTitle>Recupera tu contraseña</CardTitle>
              <CardDescription>
                Ingresa tu usuario. Te enviaremos las instrucciones al correo
                registrado en tu cuenta.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={handleRequest} noValidate>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="recover-username">Usuario</Label>
                  <Input
                    id="recover-username"
                    type="text"
                    autoComplete="username"
                    placeholder="tu.usuario"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    disabled={submitting}
                    autoFocus
                  />
                </div>

                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" loading={submitting} className="w-full">
                  {submitting ? 'Enviando…' : 'Enviar instrucciones'}
                </Button>
              </form>
            </CardContent>
            <CardFooter className="justify-center">
              <BackToLogin />
            </CardFooter>
          </Card>
        )}

        {phase === 'otp' && (
          <Card>
            <CardHeader>
              <CardTitle>Ingresa el código</CardTitle>
              <CardDescription>
                Enviamos un código de 6 dígitos a <strong>{maskedEmail}</strong>. Ingrésalo
                junto con tu nueva contraseña. El código vence en 5 minutos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={handleReset} noValidate>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="recover-code">Código</Label>
                  <Input
                    id="recover-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    aria-invalid={error ? true : undefined}
                    disabled={submitting}
                    autoFocus
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="recover-password">Nueva contraseña</Label>
                  <Input
                    id="recover-password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby="recover-password-hint"
                    disabled={submitting}
                  />
                  <p id="recover-password-hint" className="text-xs text-muted-foreground">
                    Al menos {MIN_LENGTH} caracteres.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="recover-confirm">Confirmar contraseña</Label>
                  <Input
                    id="recover-confirm"
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
                  {submitting ? 'Guardando…' : 'Restablecer contraseña'}
                </Button>
                <button
                  type="button"
                  onClick={handleResendCode}
                  disabled={submitting}
                  className="text-sm text-muted-foreground hover:text-foreground hover:underline disabled:opacity-50"
                >
                  Reenviar código
                </button>
              </form>
            </CardContent>
            <CardFooter className="justify-center">
              <BackToLogin />
            </CardFooter>
          </Card>
        )}

        {phase === 'done-credential' && (
          <Card>
            <CardHeader>
              <CardTitle>Revisa tu correo</CardTitle>
              <CardDescription>
                Te reenviamos una clave provisoria nueva a <strong>{maskedEmail}</strong>.
                Ingresa con ella y define tu contraseña definitiva en el primer acceso.
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
                Ir a iniciar sesión
              </Link>
            </CardFooter>
          </Card>
        )}

        {phase === 'done-reset' && (
          <Card>
            <CardHeader>
              <CardTitle>Contraseña actualizada</CardTitle>
              <CardDescription>
                Tu contraseña se restableció correctamente. Ya puedes ingresar con tu
                nueva clave.
              </CardDescription>
            </CardHeader>
            <CardFooter className="justify-center">
              <Link to="/login" className={buttonVariants({ className: 'w-full' })}>
                Ir a iniciar sesión
              </Link>
            </CardFooter>
          </Card>
        )}
      </div>
    </main>
  );
}
