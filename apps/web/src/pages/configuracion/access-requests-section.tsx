import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Loader2, ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { roleLabel } from '@/lib/role-labels';
import { ROLE_KEYS, type RoleKey } from '@gtm-link/shared-types';
import type { PermissionRequestView } from '@/types/settings';
import { RequestStatusBadge } from './request-status-badge';

interface AccessRequestsSectionProps {
  mine: PermissionRequestView[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: (roleKey: RoleKey, reason?: string) => Promise<void>;
}

/**
 * Sección "Mis solicitudes de acceso" (§6-2.3c). Formulario para pedir un rol
 * (select de roles + motivo opcional) y la lista de las propias con su estado.
 * Maneja el 409 ("ya tienes una pendiente") con el mensaje del backend.
 */
export function AccessRequestsSection({
  mine,
  loading,
  error,
  onRetry,
  onCreate,
}: AccessRequestsSectionProps): ReactNode {
  const roleSelectId = useId();
  const reasonId = useId();
  const [roleKey, setRoleKey] = useState<RoleKey | ''>('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!roleKey) {
      setFormError('Elige un rol para solicitar.');
      return;
    }
    setFormError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await onCreate(roleKey, reason);
      setSuccess(`Solicitud enviada: ${roleLabel(roleKey)}.`);
      setRoleKey('');
      setReason('');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'No se pudo enviar la solicitud. Intenta de nuevo.';
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mis solicitudes de acceso</CardTitle>
        <CardDescription>
          Pide un rol adicional. Un administrador lo revisará y decidirá.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor={roleSelectId}>Rol solicitado</Label>
              <select
                id={roleSelectId}
                value={roleKey}
                onChange={(e) => setRoleKey(e.target.value as RoleKey | '')}
                disabled={submitting}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Selecciona un rol…</option>
                {ROLE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {roleLabel(key)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={reasonId}>Motivo (opcional)</Label>
              <Input
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Por qué necesitas este rol"
                disabled={submitting}
                maxLength={500}
              />
            </div>
          </div>

          {formError && (
            <p className="text-sm text-destructive" role="alert">
              {formError}
            </p>
          )}
          {success && (
            <p className="text-sm text-emerald-700" role="status">
              {success}
            </p>
          )}

          <div>
            <Button type="submit" loading={submitting} disabled={!roleKey}>
              Solicitar acceso
            </Button>
          </div>
        </form>

        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">
            Solicitudes enviadas
          </h3>

          {loading && mine.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Cargando solicitudes…
            </div>
          ) : error ? (
            <div className="flex flex-col items-start gap-3 py-6">
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle className="size-4 text-destructive" aria-hidden />
                {error}
              </p>
              <Button variant="outline" size="sm" onClick={onRetry}>
                Reintentar
              </Button>
            </div>
          ) : mine.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-10 text-center">
              <ShieldQuestion className="size-7 text-muted-foreground" aria-hidden />
              <p className="max-w-sm text-sm text-muted-foreground">
                Aún no has solicitado ningún rol. Usa el formulario de arriba para
                pedir acceso.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {mine.map((req) => (
                <li
                  key={req.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {roleLabel(req.roleKey)}
                    </p>
                    {req.reason && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {req.reason}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Enviada el {formatDate(req.createdAt)}
                      {req.decidedAt
                        ? ` · Decidida el ${formatDate(req.decidedAt)}`
                        : ''}
                    </p>
                  </div>
                  <RequestStatusBadge status={req.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
