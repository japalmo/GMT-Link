import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { CalendarClock, FileText, FolderOpen, Trash2, Loader2, User } from 'lucide-react';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs, tabPanelId, tabTriggerId, type TabItem } from '@/components/ui/tabs';
import {
  deleteUser,
  errorToMessage,
  updateUserAdmin,
  type UpdateUserAdminInput,
  type UserListItem,
} from '@/lib/api';
import { toast } from 'sonner';
import { RoleChips } from './role-chips';
import { UserCvTab } from './user-cv-tab';
import { UserScheduleTab } from './user-schedule-tab';
import { UserDocumentsTab } from './user-documents-tab';

/** Pestañas del detalle del trabajador. */
type DetailTab = 'datos' | 'cv' | 'horario' | 'documentos';

const DETAIL_TABS: ReadonlyArray<TabItem<DetailTab>> = [
  { value: 'datos', label: 'Datos', icon: User },
  { value: 'cv', label: 'CV', icon: FileText },
  { value: 'horario', label: 'Horario', icon: CalendarClock },
  { value: 'documentos', label: 'Documentos', icon: FolderOpen },
];

/** Estado editable del detalle (opcionales como string vacío para inputs controlados). */
interface FormState {
  firstName: string;
  secondName: string;
  lastName: string;
  secondLastName: string;
  username: string;
  emailInstitucional: string;
  emailPersonal: string;
  cargo: string;
  isClientUser: boolean;
}

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Estado inicial vacío (todos los inputs controlados desde el primer render). */
const EMPTY_FORM: FormState = {
  firstName: '',
  secondName: '',
  lastName: '',
  secondLastName: '',
  username: '',
  emailInstitucional: '',
  emailPersonal: '',
  cargo: '',
  isClientUser: false,
};

function seed(user: UserListItem): FormState {
  return {
    firstName: user.firstName,
    secondName: user.secondName ?? '',
    lastName: user.lastName,
    secondLastName: user.secondLastName ?? '',
    username: user.username,
    emailInstitucional: user.emailInstitucional ?? '',
    emailPersonal: user.emailPersonal ?? '',
    cargo: user.cargo ?? '',
    isClientUser: user.isClientUser,
  };
}

/** Fecha corta es-CL desde un ISO string. */
function formatDate(iso: string | null): string {
  if (!iso) return 'Sin registro';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Sin registro' : date.toLocaleDateString('es-CL');
}

/**
 * Diálogo de detalle de un usuario: campos editables (nombres, correos, usuario,
 * cargo, tipo) + borrado manual. Los roles y el estado se gestionan con los botones
 * de la fila (no aquí). Al guardar llama a `PATCH /users/:id`; al borrar, a
 * `DELETE /users/:id` (con confirmación inline; el backend responde 409 si el
 * usuario tiene registros asociados). Abierto cuando `user` no es `null`.
 */
export function UserDetailDialog({
  user,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  user: UserListItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (updated: UserListItem) => void;
  onDeleted: (id: string) => void;
}): ReactNode {
  const baseId = useId();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [seededId, setSeededId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('datos');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Re-siembra SÍNCRONA al abrir con otro usuario (patrón "ajustar estado en
  // cambio de prop"): corre durante el render, así no hay frame con datos del
  // usuario anterior ni warning de input no controlado. El guard por id evita
  // el bucle. También vuelve a la pestaña Datos al cambiar de usuario.
  if (user && user.id !== seededId) {
    setForm(seed(user));
    setSeededId(user.id);
    setActiveTab('datos');
    setError(null);
    setConfirmingDelete(false);
  }

  // Al cerrar (user null) olvida el usuario sembrado: así la próxima apertura
  // —incluso del MISMO trabajador— re-siembra el form y vuelve a la pestaña Datos.
  if (!user && seededId !== null) {
    setSeededId(null);
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string | null {
    if (form.firstName.trim().length === 0) return 'El nombre es obligatorio.';
    if (form.lastName.trim().length === 0) return 'El apellido es obligatorio.';
    if (!USERNAME_RE.test(form.username)) {
      return 'El usuario debe tener 3-30 caracteres: minúsculas, dígitos, punto, guion o guion bajo.';
    }
    if (form.emailInstitucional.trim() && !EMAIL_RE.test(form.emailInstitucional.trim())) {
      return 'El email institucional no es válido.';
    }
    if (form.emailPersonal.trim() && !EMAIL_RE.test(form.emailPersonal.trim())) {
      return 'El email personal no es válido.';
    }
    if (!form.emailInstitucional.trim() && !form.emailPersonal.trim()) {
      return 'El usuario debe conservar al menos un correo (institucional o personal).';
    }
    return null;
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!user) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const input: UpdateUserAdminInput = {
        firstName: form.firstName.trim(),
        secondName: form.secondName.trim() || null,
        lastName: form.lastName.trim(),
        secondLastName: form.secondLastName.trim() || null,
        username: form.username.trim(),
        emailInstitucional: form.emailInstitucional.trim() || null,
        emailPersonal: form.emailPersonal.trim() || null,
        cargo: form.cargo.trim() || null,
        isClientUser: form.isClientUser,
      };
      const updated = await updateUserAdmin(user.id, input);
      toast.success('Usuario actualizado.');
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar el usuario.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!user) return;
    setError(null);
    setDeleting(true);
    try {
      await deleteUser(user.id);
      toast.success('Usuario borrado.');
      onDeleted(user.id);
      onOpenChange(false);
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo borrar el usuario.'));
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  const fullName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '';

  return (
    <Modal open={user !== null} onOpenChange={onOpenChange}>
      <ModalContent className="sm:max-w-3xl">
        <ModalHeader>
          <ModalTitle>Detalle del trabajador</ModalTitle>
          <ModalDescription>
            {fullName || 'Trabajador'}: datos, CV, horario y documentos. Los roles y el
            estado se gestionan con los botones de la fila.
          </ModalDescription>
        </ModalHeader>

        {user && (
          <Tabs
            items={DETAIL_TABS}
            value={activeTab}
            onValueChange={setActiveTab}
            aria-label="Secciones del trabajador"
            className="mb-1"
            idBase={baseId}
          />
        )}

        {user && activeTab === 'datos' && (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4"
            role="tabpanel"
            id={tabPanelId(baseId, 'datos')}
            aria-labelledby={tabTriggerId(baseId, 'datos')}
            tabIndex={0}
          >
            {/* Metadatos de solo lectura. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Estado:</span>
                <StatusBadge type="user" status={user.status} />
              </span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">Roles:</span>
                <RoleChips memberships={user.memberships} />
              </span>
              <span className="text-muted-foreground">
                Creado: {formatDate(user.createdAt)}
              </span>
              <span className="text-muted-foreground">
                Primer ingreso: {formatDate(user.firstLoginAt)}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id={`${baseId}-firstName`} label="Nombre">
                <Input
                  id={`${baseId}-firstName`}
                  value={form.firstName}
                  onChange={(e) => update('firstName', e.target.value)}
                  required
                />
              </Field>
              <Field id={`${baseId}-secondName`} label="Segundo nombre">
                <Input
                  id={`${baseId}-secondName`}
                  value={form.secondName}
                  onChange={(e) => update('secondName', e.target.value)}
                />
              </Field>
              <Field id={`${baseId}-lastName`} label="Apellido">
                <Input
                  id={`${baseId}-lastName`}
                  value={form.lastName}
                  onChange={(e) => update('lastName', e.target.value)}
                  required
                />
              </Field>
              <Field id={`${baseId}-secondLastName`} label="Segundo apellido">
                <Input
                  id={`${baseId}-secondLastName`}
                  value={form.secondLastName}
                  onChange={(e) => update('secondLastName', e.target.value)}
                />
              </Field>
              <Field id={`${baseId}-username`} label="Usuario">
                <Input
                  id={`${baseId}-username`}
                  value={form.username}
                  onChange={(e) => update('username', e.target.value.toLowerCase())}
                  required
                />
              </Field>
              <Field id={`${baseId}-cargo`} label="Cargo">
                <Input
                  id={`${baseId}-cargo`}
                  value={form.cargo}
                  onChange={(e) => update('cargo', e.target.value)}
                  placeholder="Ej: Operador, Prevencionista…"
                />
              </Field>
              <Field id={`${baseId}-emailInst`} label="Email institucional">
                <Input
                  id={`${baseId}-emailInst`}
                  type="email"
                  value={form.emailInstitucional}
                  onChange={(e) => update('emailInstitucional', e.target.value)}
                />
              </Field>
              <Field id={`${baseId}-emailPers`} label="Email personal">
                <Input
                  id={`${baseId}-emailPers`}
                  type="email"
                  value={form.emailPersonal}
                  onChange={(e) => update('emailPersonal', e.target.value)}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 rounded border-input"
                checked={form.isClientUser}
                onChange={(e) => update('isClientUser', e.target.checked)}
              />
              Es usuario cliente (ITO)
            </label>

            {error && (
              <Alert variant="destructive" live>
                {error}
              </Alert>
            )}

            <ModalFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              {/* Zona de borrado: confirmación inline (sin modal anidado). */}
              {confirmingDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-destructive">¿Borrar definitivamente?</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDelete()}
                    disabled={deleting}
                  >
                    {deleting ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                    Sí, borrar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                  >
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 aria-hidden />
                  Borrar usuario
                </Button>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cerrar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving && <Loader2 className="animate-spin" aria-hidden />}
                  Guardar cambios
                </Button>
              </div>
            </ModalFooter>
          </form>
        )}

        {user && activeTab === 'cv' && (
          <TabPanel idBase={baseId} value="cv" onClose={() => onOpenChange(false)}>
            <UserCvTab userId={user.id} />
          </TabPanel>
        )}
        {user && activeTab === 'horario' && (
          <TabPanel idBase={baseId} value="horario" onClose={() => onOpenChange(false)}>
            <UserScheduleTab userId={user.id} />
          </TabPanel>
        )}
        {user && activeTab === 'documentos' && (
          <TabPanel idBase={baseId} value="documentos" onClose={() => onOpenChange(false)}>
            <UserDocumentsTab userId={user.id} />
          </TabPanel>
        )}
      </ModalContent>
    </Modal>
  );
}

/** Campo etiquetado en una columna (label + control). */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Envoltura de una pestaña con contenido propio (CV / Horario / Documentos):
 * renderiza el contenido y un footer con "Cerrar". Guardar/Borrar viven solo en
 * la pestaña Datos; cada pestaña maneja sus propias acciones internamente. Cierra
 * el patrón WAI-ARIA: `role="tabpanel"` enlazado al botón de su pestaña vía
 * `id`/`aria-labelledby` y `tabIndex={0}` para recibir foco al navegar por teclado.
 */
function TabPanel({
  idBase,
  value,
  children,
  onClose,
}: {
  idBase: string;
  value: DetailTab;
  children: ReactNode;
  onClose: () => void;
}): ReactNode {
  return (
    <div
      role="tabpanel"
      id={tabPanelId(idBase, value)}
      aria-labelledby={tabTriggerId(idBase, value)}
      tabIndex={0}
      className="flex flex-col gap-4"
    >
      {children}
      <ModalFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      </ModalFooter>
    </div>
  );
}
