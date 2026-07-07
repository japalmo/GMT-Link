import { useId, useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/utils';
import { errorToMessage } from '@/lib/api';
import { useSettings } from '@/hooks/use-settings';

/** Conmutador accesible (role=switch) controlado. */
function Toggle({
  checked,
  onChange,
  disabled,
  labelId,
}: {
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  labelId: string;
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 transform rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
        aria-hidden
      />
    </button>
  );
}

/** Una fila de toggle con su etiqueta + descripción. */
function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
}): ReactNode {
  const labelId = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0">
        <p id={labelId} className="text-sm font-medium text-foreground">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Toggle
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        labelId={labelId}
      />
    </div>
  );
}

/**
 * Sección "Notificaciones" (§6-2.3b). Toggles para `notifyInApp` y `notifyEmail`
 * que persisten vía PATCH. El correo aún no se envía (decisión §9: sin email),
 * la preferencia se guarda igual para cuando se enchufe un proveedor real.
 */
export function NotificationsSection(): ReactNode {
  const { settings, loading, error, refetch, save } = useSettings();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<'notifyInApp' | 'notifyEmail' | null>(null);

  const handleToggle = async (
    key: 'notifyInApp' | 'notifyEmail',
  ): Promise<void> => {
    if (!settings) return;
    setSaveError(null);
    setSavingKey(key);
    try {
      await save({ [key]: !settings[key] });
    } catch (err) {
      setSaveError(errorToMessage(err, 'No se pudo guardar la preferencia.'));
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notificaciones</CardTitle>
        <CardDescription>
          Elige cómo quieres enterarte de lo que pasa en tu cuenta.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !settings ? (
          <LoadingState rows={2} label="Cargando preferencias…" />
        ) : error && !settings ? (
          <ErrorState message={error} onRetry={() => void refetch()} />
        ) : settings ? (
          <>
            <div className="divide-y divide-border">
              <ToggleRow
                title="Notificaciones en la app"
                description="Avisos dentro de GMT Link (campana del menú)."
                checked={settings.notifyInApp}
                onChange={() => void handleToggle('notifyInApp')}
                disabled={savingKey !== null}
              />
              <ToggleRow
                title="Notificaciones por correo"
                description="Aún no enviamos correos; tu preferencia queda guardada para cuando se active."
                checked={settings.notifyEmail}
                onChange={() => void handleToggle('notifyEmail')}
                disabled={savingKey !== null}
              />
            </div>
            {saveError && (
              <Alert variant="destructive" live className="mt-3">
                {saveError}
              </Alert>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
