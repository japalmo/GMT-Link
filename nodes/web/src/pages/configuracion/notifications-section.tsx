import { useId, useState, type ReactNode } from 'react';
import type { EmailKind } from '@gmt-platform/contracts';
import { Info } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/utils';
import { errorToMessage } from '@/lib/api';
import { useSettings } from '@/hooks/use-settings';
import { useProfile } from '@/hooks/use-profile';

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
  children,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  /** Contenido adicional (p. ej. el selector de correo destino). */
  children?: ReactNode;
}): ReactNode {
  const labelId = useId();
  return (
    <div className="py-4">
      <div className="flex items-start justify-between gap-4">
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
      {children}
    </div>
  );
}

/**
 * Selector "Enviar a:" (institucional / personal) para el destino de las
 * notificaciones por correo. Deshabilita la opción cuyo correo NO esté verificado
 * y, si ninguno lo está, muestra un aviso para verificar un correo en el perfil.
 * Persiste vía PATCH `settings` con `notifyEmailTarget`.
 */
function EmailTargetSelector({
  institucionalVerified,
  personalVerified,
  value,
  saving,
  onChange,
}: {
  institucionalVerified: boolean;
  personalVerified: boolean;
  value: EmailKind | null;
  saving: boolean;
  onChange: (target: EmailKind) => void;
}): ReactNode {
  const selectId = useId();

  if (!institucionalVerified && !personalVerified) {
    return (
      <Alert variant="info" icon={Info} className="mt-3">
        Verificá un correo en tu perfil para recibir notificaciones por correo.
      </Alert>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <Label htmlFor={selectId}>Enviar a:</Label>
      <Select
        id={selectId}
        aria-label="Correo destino de las notificaciones por email"
        className="sm:max-w-xs"
        value={value ?? ''}
        disabled={saving}
        onChange={(e) => {
          const next = e.target.value;
          if (next === 'INSTITUCIONAL' || next === 'PERSONAL') onChange(next);
        }}
      >
        <option value="" disabled>
          Elegí un correo
        </option>
        <option value="INSTITUCIONAL" disabled={!institucionalVerified}>
          Institucional{!institucionalVerified ? ' — verificá este correo primero' : ''}
        </option>
        <option value="PERSONAL" disabled={!personalVerified}>
          Personal{!personalVerified ? ' — verificá este correo primero' : ''}
        </option>
      </Select>
      <p className="text-xs text-muted-foreground">
        Solo podés elegir un correo verificado. Verificá el otro en tu perfil para
        habilitarlo.
      </p>
    </div>
  );
}

/**
 * Sección "Notificaciones" (§6-2.3b). Toggles para `notifyInApp` y `notifyEmail`
 * que persisten vía PATCH. Cuando el correo está activado, muestra un selector del
 * correo destino (`notifyEmailTarget`) restringido a los correos verificados del
 * perfil. El correo aún no se envía (decisión §9); la preferencia se guarda igual.
 */
export function NotificationsSection(): ReactNode {
  const { settings, loading, error, refetch, save } = useSettings();
  const { profile, loading: profileLoading } = useProfile();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<'notifyInApp' | 'notifyEmail' | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);

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

  const handleTargetChange = async (target: EmailKind): Promise<void> => {
    setSaveError(null);
    setSavingTarget(true);
    try {
      await save({ notifyEmailTarget: target });
    } catch (err) {
      setSaveError(errorToMessage(err, 'No se pudo guardar el correo destino.'));
    } finally {
      setSavingTarget(false);
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
                description="Elige a qué correo verificado enviarlas."
                checked={settings.notifyEmail}
                onChange={() => void handleToggle('notifyEmail')}
                disabled={savingKey !== null}
              >
                {settings.notifyEmail &&
                  (profileLoading && !profile ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Cargando tus correos…
                    </p>
                  ) : profile ? (
                    <EmailTargetSelector
                      institucionalVerified={profile.emailInstitucionalVerified}
                      personalVerified={profile.emailPersonalVerified}
                      value={settings.notifyEmailTarget}
                      saving={savingTarget}
                      onChange={(target) => void handleTargetChange(target)}
                    />
                  ) : (
                    <Alert variant="info" icon={Info} className="mt-3">
                      No pudimos cargar tus correos. Verificá un correo en tu perfil
                      para recibir notificaciones por correo.
                    </Alert>
                  ))}
              </ToggleRow>
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
