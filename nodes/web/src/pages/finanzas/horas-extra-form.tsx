import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import {
  Modal,
  ModalClose,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { useDirectory } from '@/hooks/use-directory';
import { useHasPermission } from '@/hooks/use-has-permission';
import { useFinanceProjects } from './use-finance-projects';
import { todaySantiagoString } from '@/lib/santiago-time';
import type { CreateOvertimeInput } from '@/types/finance';

/** Roles habilitados como "Autorizado por" (admin de contrato / gerencias). */
const AUTHORIZER_ROLES: ReadonlySet<string> = new Set([
  'admin_contrato',
  'gerencia_proyectos',
  'gerencia_rh',
  'gerencia_general',
]);

/** Valor centinela del select de proyecto para "Otro" (texto libre). */
const OTHER_PROJECT = '__OTHER__';

/** Fecha de hoy (día calendario de Chile) en formato YYYY-MM-DD. */
function getTodayString(): string {
  return todaySantiagoString();
}

export interface HorasExtraFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Crea la solicitud. Debe propagar el error (el diálogo lo muestra). */
  onSubmit: (input: CreateOvertimeInput) => Promise<void>;
}

/**
 * Formulario de solicitud de horas extra (overlay, §5.6). Hora de inicio
 * obligatoria; hora de término opcional (si falta, se guarda como borrador
 * `isDraft` y no es aprobable hasta cerrarlo, resolución #3). Trabajador fijo a
 * "hoy" salvo permiso `finance:overtime:create:onbehalf`, que además habilita
 * crear a nombre de otro trabajador y con fecha libre. Proyecto: los asignados
 * más "Otro" (texto libre). "Autorizado por": usuarios con rol admin_contrato o
 * gerencias. El botón que lo abre es visible para todos (resolución #2).
 */
export function HorasExtraFormDialog({
  open,
  onOpenChange,
  onSubmit,
}: HorasExtraFormDialogProps): ReactNode {
  const canOnBehalf = useHasPermission('finance:overtime:create:onbehalf');
  const { projects } = useFinanceProjects();
  const { entries } = useDirectory();

  const [date, setDate] = useState(getTodayString());
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [projectValue, setProjectValue] = useState('');
  const [projectOther, setProjectOther] = useState('');
  const [authorizedById, setAuthorizedById] = useState('');
  const [onBehalfOfUserId, setOnBehalfOfUserId] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDate(getTodayString());
      setStartTime('');
      setEndTime('');
      setProjectValue('');
      setProjectOther('');
      setAuthorizedById('');
      setOnBehalfOfUserId('');
      setReason('');
      setError(null);
    }
  }, [open]);

  /** Usuarios que pueden autorizar (admin_contrato / gerencias). */
  const authorizers = useMemo(
    () =>
      entries
        .filter((e) => e.roleKeys.some((r) => AUTHORIZER_ROLES.has(r)))
        .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  );

  /** Trabajadores para "a nombre de" (solo con permiso onbehalf). */
  const workers = useMemo(
    () =>
      entries
        .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entries],
  );

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!date) return setError('La fecha es obligatoria.');
    if (!startTime) return setError('La hora de inicio es obligatoria.');
    if (endTime && endTime <= startTime) {
      return setError('La hora de término debe ser posterior a la de inicio.');
    }
    if (projectValue === OTHER_PROJECT && !projectOther.trim()) {
      return setError('Indica el nombre del proyecto ("Otro").');
    }

    const isOther = projectValue === OTHER_PROJECT;
    const input: CreateOvertimeInput = {
      date,
      startTime,
      endTime: endTime || undefined,
      projectId: !isOther && projectValue ? projectValue : undefined,
      projectOther: isOther ? projectOther.trim() : undefined,
      authorizedById: authorizedById || undefined,
      onBehalfOfUserId: canOnBehalf && onBehalfOfUserId ? onBehalfOfUserId : undefined,
      reason: reason.trim() || undefined,
    };

    setSubmitting(true);
    try {
      await onSubmit(input);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  const isDraft = !endTime;

  return (
    <Modal open={open} onOpenChange={(next) => (submitting ? undefined : onOpenChange(next))}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Reportar horas extra</ModalTitle>
          <ModalDescription>
            Ingresa la hora de inicio. Si aún no terminas, deja la hora de término vacía y la
            solicitud quedará como borrador.
          </ModalDescription>
        </ModalHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4" noValidate>
          {canOnBehalf && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-onbehalf">A nombre de</Label>
              <Select
                id="ot-onbehalf"
                aria-label="Registrar a nombre de otro trabajador"
                value={onBehalfOfUserId}
                onChange={(e) => setOnBehalfOfUserId(e.target.value)}
                disabled={submitting}
              >
                <option value="">Yo mismo</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-date">Fecha de trabajo</Label>
            <Input
              id="ot-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              disabled={submitting || !canOnBehalf}
            />
            {!canOnBehalf && (
              <p className="text-xs text-muted-foreground">Solo puedes registrar horas extra de hoy.</p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-start">Hora de inicio</Label>
              <Input
                id="ot-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                disabled={submitting}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-end">Hora de término (opcional)</Label>
              <Input
                id="ot-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {isDraft && startTime && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Sin hora de término la solicitud se guardará como <strong>borrador</strong>.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-project">Proyecto</Label>
            <Select
              id="ot-project"
              aria-label="Proyecto de las horas extra"
              value={projectValue}
              onChange={(e) => setProjectValue(e.target.value)}
              disabled={submitting}
            >
              <option value="">Sin proyecto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.clientName ? ` · ${p.clientName}` : ''}
                </option>
              ))}
              <option value={OTHER_PROJECT}>Otro...</option>
            </Select>
          </div>

          {projectValue === OTHER_PROJECT && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ot-project-other">Nombre del proyecto</Label>
              <Input
                id="ot-project-other"
                value={projectOther}
                onChange={(e) => setProjectOther(e.target.value)}
                placeholder="Escribe el proyecto"
                maxLength={200}
                required
                disabled={submitting}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-authorizer">Autorizado por (opcional)</Label>
            <Select
              id="ot-authorizer"
              aria-label="Autorizado por"
              value={authorizedById}
              onChange={(e) => setAuthorizedById(e.target.value)}
              disabled={submitting}
            >
              <option value="">Sin especificar</option>
              {authorizers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ot-reason">Motivo (opcional)</Label>
            <Textarea
              id="ot-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explica el trabajo realizado durante estas horas extra."
              rows={2}
              maxLength={500}
              disabled={submitting}
            />
          </div>

          {error && (
            <Alert variant="destructive" live>
              {error}
            </Alert>
          )}

          <ModalFooter>
            <ModalClose asChild>
              <Button type="button" variant="outline" disabled={submitting}>
                Cancelar
              </Button>
            </ModalClose>
            <Button type="submit" loading={submitting}>
              {isDraft ? 'Guardar borrador' : 'Enviar solicitud'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
