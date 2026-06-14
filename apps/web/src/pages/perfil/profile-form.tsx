import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, TriangleAlert } from 'lucide-react';
import type { ProfileMe, UpdateProfileInput } from '@gtm-link/shared-types';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

/** Mensaje legible a partir de un error desconocido. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
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

/**
 * Formulario de edición de "Mis datos" (§6-1.3). El `email` se muestra solo
 * lectura (identidad Firebase). Persiste vía `onSave` y muestra feedback de
 * éxito/error. Los campos opcionales vacíos se envían como `undefined`.
 */
export function ProfileForm({
  profile,
  onSave,
}: {
  profile: ProfileMe;
  onSave: (input: UpdateProfileInput) => Promise<ProfileMe>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(() => toFormState(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      setError(toMessage(err, 'No se pudieron guardar los cambios.'));
    } finally {
      setSaving(false);
    }
  }

  return (
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
        <Label htmlFor="profile-email">Correo electrónico</Label>
        <Input
          id="profile-email"
          type="email"
          value={profile.email}
          readOnly
          disabled
          aria-describedby="profile-email-help"
        />
        <p id="profile-email-help" className="text-xs text-muted-foreground">
          El correo es tu identidad de acceso y no se puede modificar.
        </p>
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
          Tus datos se guardaron correctamente.
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={saving}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
