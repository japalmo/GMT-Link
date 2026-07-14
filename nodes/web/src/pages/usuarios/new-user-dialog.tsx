import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { RoleKey } from '@gmt-platform/contracts';
import { Modal, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CreateUserDto } from '@/lib/api';
import { RoleMultiSelect } from './role-multi-select';

/** Estado del formulario (campos opcionales como string vacío para inputs controlados). */
interface FormState {
  firstName: string;
  secondName: string;
  lastName: string;
  secondLastName: string;
  username: string;
  emailInstitucional: string;
  emailPersonal: string;
  cargo: string;
  /** Flag: el admin editó el username a mano → dejar de autosugerirlo. */
  usernameTouched: boolean;
  roleKeys: RoleKey[];
  isClientUser: boolean;
}

const EMPTY: FormState = {
  firstName: '',
  secondName: '',
  lastName: '',
  secondLastName: '',
  username: '',
  emailInstitucional: '',
  emailPersonal: '',
  cargo: '',
  usernameTouched: false,
  roleKeys: [],
  isClientUser: false,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/** Deriva un username sugerido del prefijo del email institucional (minúsculas, chars válidos). */
function suggestUsername(email: string): string {
  return (email.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 30);
}

/** Convierte el estado del formulario al DTO del backend (omite opcionales vacíos). */
function toDto(form: FormState): CreateUserDto {
  return {
    firstName: form.firstName.trim(),
    secondName: form.secondName.trim() || undefined,
    lastName: form.lastName.trim(),
    secondLastName: form.secondLastName.trim() || undefined,
    username: form.username.trim(),
    emailInstitucional: form.emailInstitucional.trim() || undefined,
    emailPersonal: form.emailPersonal.trim() || undefined,
    cargo: form.cargo.trim() || undefined,
    roleKeys: form.roleKeys,
    isClientUser: form.isClientUser,
  };
}

/**
 * Diálogo "Nuevo usuario" (§1.1). Formulario controlado con validación básica;
 * delega la creación al padre vía `onCreate` (que llama al backend y muestra la
 * clave provisoria). Muestra errores de servidor (409 email duplicado, etc.).
 */
export function NewUserDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (dto: CreateUserDto, avatarFile: File | null) => Promise<void>;
}): ReactNode {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0] || null;
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError('La imagen de perfil no debe superar los 2MB.');
        return;
      }
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        setError('La imagen de perfil debe ser JPEG o PNG.');
        return;
      }
      setAvatarFile(file);
      setError(null);

      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      setAvatarFile(null);
      setAvatarPreview(null);
    }
  }

  function reset(): void {
    setForm(EMPTY);
    setAvatarFile(null);
    setAvatarPreview(null);
    setError(null);
    setSubmitting(false);
    // Reset file input element
    const fileInput = document.getElementById('avatar-file') as HTMLInputElement | null;
    if (fileInput) fileInput.value = '';
  }

  function localError(): string | null {
    if (form.firstName.trim().length === 0) return 'El nombre es obligatorio.';
    if (form.lastName.trim().length === 0) return 'El apellido es obligatorio.';
    if (!USERNAME_RE.test(form.username.trim())) return 'El usuario debe tener 3-30 caracteres (minúsculas, dígitos, . _ -).';
    if (!form.emailInstitucional.trim() && !form.emailPersonal.trim()) return 'Indica al menos un email (institucional o personal).';
    if (form.emailInstitucional.trim() && !EMAIL_RE.test(form.emailInstitucional.trim())) return 'Email institucional inválido.';
    if (form.emailPersonal.trim() && !EMAIL_RE.test(form.emailPersonal.trim())) return 'Email personal inválido.';
    if (form.roleKeys.length === 0) return 'Selecciona al menos un rol.';
    return null;
  }

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const invalid = localError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(toDto(form), avatarFile);
      reset();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <ModalContent className="sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>Nuevo usuario</ModalTitle>
          <ModalDescription>
            Se generará una clave provisoria para entregar a la persona.
          </ModalDescription>
        </ModalHeader>

        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <div className="flex items-center gap-4 border border-dashed border-border rounded-lg p-3 bg-muted/20">
            <div className="size-14 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0 border border-border/80">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Preview" className="size-full object-cover" />
              ) : (
                <span className="text-[10px] text-muted-foreground font-semibold">Sin foto</span>
              )}
            </div>
            <div className="flex-1">
              <label className="flex flex-col gap-1.5 w-full">
                <span className="text-xs font-semibold text-foreground">
                  Foto de perfil (JPEG/PNG, máx 2MB)
                </span>
                <Input
                  id="avatar-file"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={handleAvatarChange}
                  disabled={submitting}
                  className="h-9 py-1 text-xs cursor-pointer"
                />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Primer nombre" required>
              <Input
                value={form.firstName}
                onChange={(e) => update('firstName', e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Segundo nombre">
              <Input
                value={form.secondName}
                onChange={(e) => update('secondName', e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Apellido paterno" required>
              <Input
                value={form.lastName}
                onChange={(e) => update('lastName', e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Apellido materno">
              <Input
                value={form.secondLastName}
                onChange={(e) => update('secondLastName', e.target.value)}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field label="Email institucional">
            <Input
              type="email"
              value={form.emailInstitucional}
              onChange={(e) => {
                const value = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  emailInstitucional: value,
                  username: prev.usernameTouched ? prev.username : suggestUsername(value),
                }));
              }}
              autoComplete="off"
            />
          </Field>

          <Field label="Usuario (login)" required>
            <Input
              value={form.username}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, username: e.target.value, usernameTouched: true }))
              }
              autoComplete="off"
              placeholder="ej: ana.perez"
            />
          </Field>

          <Field label="Email personal">
            <Input
              type="email"
              value={form.emailPersonal}
              onChange={(e) => update('emailPersonal', e.target.value)}
              autoComplete="off"
            />
          </Field>

          <Field label="Cargo">
            <Input
              value={form.cargo}
              onChange={(e) => update('cargo', e.target.value)}
              autoComplete="off"
              placeholder="Ej. Jefe de terreno"
            />
          </Field>

          <RoleMultiSelect
            value={form.roleKeys}
            onChange={(next) => update('roleKeys', next)}
            disabled={submitting}
          />

          <label className="flex items-center gap-2 text-sm select-none">
            <input
              type="checkbox"
              className="size-4 rounded border-input accent-primary cursor-pointer"
              checked={form.isClientUser}
              onChange={(e) => update('isClientUser', e.target.checked)}
            />
            Es usuario cliente (ITO)
          </label>

          {error && (
            <Alert id={errorId} variant="destructive" live>
              {error}
            </Alert>
          )}

          <ModalFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={submitting}>
              Crear usuario
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

/**
 * Campo de formulario. Usa un `<label>` ENVOLVENTE (asociación implícita) para
 * que el texto quede ligado al control sin necesidad de ids manuales.
 */
function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium leading-none text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
