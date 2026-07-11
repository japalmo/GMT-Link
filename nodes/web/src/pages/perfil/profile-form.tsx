import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, CheckCircle2, Pencil, Plus, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { EmailKind, ProfileMe, UpdateProfileInput } from '@gmt-platform/contracts';
import { errorToMessage } from '@/lib/api';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';

/** Estado editable del formulario (strings; los opcionales viajan como ''). */
interface FormState {
  firstName: string;
  secondName: string;
  lastName: string;
  secondLastName: string;
  avatarUrl: string;
}

/** Mapea el perfil del backend al estado del formulario (null → ''). */
function toFormState(profile: ProfileMe): FormState {
  return {
    firstName: profile.firstName,
    secondName: profile.secondName ?? '',
    lastName: profile.lastName ?? '',
    secondLastName: profile.secondLastName ?? '',
    avatarUrl: profile.avatarUrl ?? '',
  };
}

/** Validación básica client-side. Devuelve mensaje o `null` si es válido. */
function validate(state: FormState): string | null {
  if (state.firstName.trim().length === 0) return 'El primer nombre es obligatorio.';
  if (state.lastName.trim().length === 0) return 'El primer apellido es obligatorio.';
  if (state.avatarUrl.trim().length > 0) {
    try {
      const url = new URL(state.avatarUrl.trim());
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'La URL del avatar debe empezar con http:// o https://';
      }
    } catch {
      return 'La URL del avatar no es válida.';
    }
  }
  return null;
}

/** Etiqueta legible (minúscula) del tipo de correo, para textos en línea. */
function kindLabel(kind: EmailKind): string {
  return kind === 'INSTITUCIONAL' ? 'institucional' : 'personal';
}

/** Validación de correo mínima (client-side; el backend valida en serio). */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/* -------------------------------------------------------------------------- */
/* Bloque de un correo (institucional / personal) + su badge de verificación   */
/* -------------------------------------------------------------------------- */

function EmailBlock({
  kind,
  profile,
  onOpen,
}: {
  kind: EmailKind;
  profile: ProfileMe;
  onOpen: (kind: EmailKind) => void;
}): ReactNode {
  const isInstitucional = kind === 'INSTITUCIONAL';
  const email = isInstitucional ? profile.emailInstitucional : profile.emailPersonal;
  const verified = isInstitucional
    ? profile.emailInstitucionalVerified
    : profile.emailPersonalVerified;
  const pending = profile.pendingEmailKind === kind ? profile.pendingEmail : null;
  const label = isInstitucional ? 'Correo institucional' : 'Correo personal';
  const buttonLabel = pending ? 'Ingresar código' : email ? 'Cambiar' : 'Agregar';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {email ? (
          verified ? (
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" aria-hidden />
              Verificado
            </Badge>
          ) : (
            <Badge variant="warning">Sin verificar</Badge>
          )
        ) : (
          <Badge variant="neutral">Sin configurar</Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          {email ? (
            <p className="truncate text-sm text-foreground">{email}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aún no agregaste este correo.
            </p>
          )}
          {pending && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Verificación pendiente: {pending}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onOpen(kind)}
        >
          {email ? <Pencil aria-hidden /> : <Plus aria-hidden />}
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal de verificación de correo — 2 pasos (enviar código → confirmar)        */
/* -------------------------------------------------------------------------- */

function EmailVerifyDialog({
  kind,
  currentEmail,
  pendingEmail,
  onClose,
  onRequest,
  onConfirm,
}: {
  kind: EmailKind;
  currentEmail: string | null;
  pendingEmail: string | null;
  onClose: () => void;
  onRequest: (newEmail: string, kind: EmailKind) => Promise<void>;
  onConfirm: (code: string) => Promise<void>;
}): ReactNode {
  const [step, setStep] = useState<'email' | 'code'>(
    pendingEmail !== null ? 'code' : 'email',
  );
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState(pendingEmail ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title =
    step === 'email'
      ? `${currentEmail ? 'Cambiar' : 'Agregar'} correo ${kindLabel(kind)}`
      : 'Verificar correo';

  async function handleRequest(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = email.trim();
    if (!isValidEmail(trimmed)) {
      setError('Ingresá un correo electrónico válido.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onRequest(trimmed, kind);
      setSentTo(trimmed);
      setCode('');
      setStep('code');
      toast.success(`Te enviamos un código a ${trimmed}`);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo enviar el código.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('El código son 6 dígitos.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      toast.success('Correo verificado');
      onClose();
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo verificar el código.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !submitting) onClose();
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{title}</ModalTitle>
          <ModalDescription>
            {step === 'email'
              ? `Te enviaremos un código de 6 dígitos al correo ${kindLabel(kind)} nuevo para verificarlo.`
              : `Ingresá el código de 6 dígitos que enviamos a ${sentTo}.`}
          </ModalDescription>
        </ModalHeader>

        {step === 'email' ? (
          <form
            id="email-request-form"
            onSubmit={(e) => void handleRequest(e)}
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-new">Correo {kindLabel(kind)} nuevo</Label>
              <Input
                id="email-new"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="nombre@dominio.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                disabled={submitting}
                aria-invalid={error !== null || undefined}
                required
                autoFocus
              />
            </div>

            {error && (
              <Alert variant="destructive" live icon={TriangleAlert}>
                {error}
              </Alert>
            )}

            <ModalFooter>
              <ModalClose asChild>
                <Button type="button" variant="outline" disabled={submitting}>
                  Cancelar
                </Button>
              </ModalClose>
              <Button type="submit" form="email-request-form" loading={submitting}>
                Enviar código
              </Button>
            </ModalFooter>
          </form>
        ) : (
          <form
            id="email-confirm-form"
            onSubmit={(e) => void handleConfirm(e)}
            className="flex flex-col gap-4"
            noValidate
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email-code">Código de verificación</Label>
              <Input
                id="email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, ''));
                  setError(null);
                }}
                disabled={submitting}
                aria-invalid={error !== null || undefined}
                required
                autoFocus
              />
            </div>

            {error && (
              <Alert variant="destructive" live icon={TriangleAlert}>
                {error}
              </Alert>
            )}

            <ModalFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setStep('email');
                  setError(null);
                }}
                disabled={submitting}
              >
                Cambiar correo
              </Button>
              <Button type="submit" form="email-confirm-form" loading={submitting}>
                Confirmar
              </Button>
            </ModalFooter>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}

/**
 * Formulario de "Mis datos" (§6-1.3). Muestra los dos correos del usuario
 * (institucional / personal) con su estado de verificación y un flujo de 2 pasos
 * (enviar código → confirmar) para cambiarlos/agregarlos vía OTP. Debajo, el
 * formulario editable de nombre y avatar. Persiste vía `onSave`; el cambio de
 * correo vía `onRequestEmailChange` / `onConfirmEmailChange`.
 */
export function ProfileForm({
  profile,
  onSave,
  onRequestEmailChange,
  onConfirmEmailChange,
}: {
  profile: ProfileMe;
  onSave: (input: UpdateProfileInput) => Promise<ProfileMe>;
  onRequestEmailChange: (newEmail: string, kind: EmailKind) => Promise<void>;
  onConfirmEmailChange: (code: string) => Promise<ProfileMe>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(() => toFormState(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [openKind, setOpenKind] = useState<EmailKind | null>(null);

  // Si el perfil cambia (refetch / guardado externo), re-sincroniza el form.
  useEffect(() => {
    setForm(toFormState(profile));
  }, [profile]);

  function update<K extends keyof FormState>(key: K, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
    setError(null);
  }

  function trimmedOrUndefined(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const validationError = validate(form);
    if (validationError) {
      setSuccess(false);
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await onSave({
        firstName: form.firstName.trim(),
        secondName: trimmedOrUndefined(form.secondName),
        lastName: form.lastName.trim(),
        secondLastName: trimmedOrUndefined(form.secondLastName),
        avatarUrl: trimmedOrUndefined(form.avatarUrl),
      });
      setSuccess(true);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudieron guardar los cambios.'));
    } finally {
      setSaving(false);
    }
  }

  const hasAnyVerified =
    profile.emailInstitucionalVerified || profile.emailPersonalVerified;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium text-foreground">Correos</h3>
          <p className="text-xs text-muted-foreground">
            Necesitás al menos un correo verificado. Cambiar o agregar un correo
            requiere confirmarlo con un código que enviamos al correo nuevo.
          </p>
        </div>

        {!hasAnyVerified && (
          <Alert variant="warning" icon={TriangleAlert}>
            No tenés ningún correo verificado. Verificá al menos uno para asegurar
            el acceso y recibir notificaciones.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EmailBlock kind="INSTITUCIONAL" profile={profile} onOpen={setOpenKind} />
          <EmailBlock kind="PERSONAL" profile={profile} onOpen={setOpenKind} />
        </div>
      </section>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-firstName">Primer nombre</Label>
            <Input
              id="profile-firstName"
              value={form.firstName}
              onChange={(e) => update('firstName', e.target.value)}
              autoComplete="given-name"
              required
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-secondName">Segundo nombre</Label>
            <Input
              id="profile-secondName"
              value={form.secondName}
              onChange={(e) => update('secondName', e.target.value)}
              autoComplete="additional-name"
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-lastName">Primer apellido</Label>
            <Input
              id="profile-lastName"
              value={form.lastName}
              onChange={(e) => update('lastName', e.target.value)}
              autoComplete="family-name"
              required
              disabled={saving}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-secondLastName">Segundo apellido</Label>
            <Input
              id="profile-secondLastName"
              value={form.secondLastName}
              onChange={(e) => update('secondLastName', e.target.value)}
              disabled={saving}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-avatarUrl">URL del avatar</Label>
          <Input
            id="profile-avatarUrl"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={form.avatarUrl}
            onChange={(e) => update('avatarUrl', e.target.value)}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Opcional. Si lo dejas vacío, se usarán tus iniciales.
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
            Tus datos se guardaron correctamente.
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            Guardar cambios
          </Button>
        </div>
      </form>

      {openKind !== null && (
        <EmailVerifyDialog
          key={openKind}
          kind={openKind}
          currentEmail={
            openKind === 'INSTITUCIONAL'
              ? profile.emailInstitucional
              : profile.emailPersonal
          }
          pendingEmail={
            profile.pendingEmailKind === openKind ? profile.pendingEmail : null
          }
          onClose={() => setOpenKind(null)}
          onRequest={onRequestEmailChange}
          onConfirm={async (code) => {
            await onConfirmEmailChange(code);
          }}
        />
      )}
    </div>
  );
}
