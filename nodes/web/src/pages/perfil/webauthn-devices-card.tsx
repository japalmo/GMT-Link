import { useEffect, useState } from 'react';
import {
  browserSupportsWebAuthn,
  startRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';
import { toast } from 'sonner';
import { Fingerprint, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  deleteWebAuthnCredential,
  errorToMessage,
  getWebAuthnRegistrationOptions,
  listWebAuthnCredentials,
  verifyWebAuthnRegistration,
  type WebAuthnDeviceView,
} from '@/lib/api';

/** Formatea una fecha ISO como fecha local corta. */
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

/** ¿El error de la ceremonia es una cancelación del usuario? (no amerita toast de error). */
function isUserCancel(error: unknown): boolean {
  return (
    error instanceof WebAuthnError &&
    (error.code === 'ERROR_CEREMONY_ABORTED' || error.name === 'NotAllowedError' || error.name === 'AbortError')
  );
}

/**
 * Mensaje en español para un error del registro. Los `WebAuthnError` del navegador
 * traen texto en inglés: se mapean a copy en español (nunca se filtra el crudo). Los
 * errores de la API (ApiError) ya vienen en español desde el backend.
 */
function registrationErrorMessage(error: unknown): string {
  if (error instanceof WebAuthnError) {
    switch (error.code) {
      case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
        return 'Este dispositivo ya está registrado.';
      case 'ERROR_AUTHENTICATOR_GENERAL_ERROR':
        return 'Tu dispositivo no pudo completar la operación. Intenta de nuevo.';
      default:
        return 'No se pudo registrar el dispositivo con este equipo. Intenta de nuevo.';
    }
  }
  return errorToMessage(error, 'No se pudo registrar el dispositivo.');
}

/**
 * Firma con biometría (#68). Registra este dispositivo (Windows Hello / Touch ID /
 * biometría del celular) como firma, lista los ya registrados y permite quitarlos.
 * La llave privada nunca sale del equipo. Si el navegador no soporta WebAuthn, se
 * explica y se ofrece el respaldo por código al correo (que llega en la Fase 2).
 */
export function WebAuthnDevicesCard() {
  const [supported] = useState<boolean>(() => browserSupportsWebAuthn());
  const [devices, setDevices] = useState<WebAuthnDeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listWebAuthnCredentials();
        if (active) setDevices(list);
      } catch (err) {
        if (active) toast.error(errorToMessage(err, 'No se pudieron cargar tus dispositivos.'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleRegister(): Promise<void> {
    setRegistering(true);
    try {
      const options = await getWebAuthnRegistrationOptions();
      const response = await startRegistration({ optionsJSON: options });
      const device = await verifyWebAuthnRegistration(response, deviceName.trim() || undefined);
      setDevices((prev) => [device, ...prev]);
      setDeviceName('');
      toast.success('Dispositivo registrado para firmar.');
    } catch (err) {
      if (isUserCancel(err)) return; // el usuario canceló el gesto biométrico
      toast.error(registrationErrorMessage(err));
    } finally {
      setRegistering(false);
    }
  }

  async function handleRemove(id: string): Promise<void> {
    setRemovingId(id);
    try {
      await deleteWebAuthnCredential(id);
      setDevices((prev) => prev.filter((d) => d.id !== id));
      toast.success('Dispositivo eliminado.');
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo eliminar el dispositivo.'));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="size-5 text-primary" aria-hidden />
          Firma con biometría
        </CardTitle>
        <CardDescription>
          Registra este equipo para firmar checklists con tu huella, rostro o PIN
          (Windows Hello, Touch ID o la biometría de tu celular). La firma queda
          asociada a ti y al dispositivo. La llave nunca sale del equipo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!supported && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            Este navegador o dispositivo no admite firma con biometría. Podrás firmar
            con un código enviado a tu correo.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Dispositivos registrados</p>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
            </div>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no registras ningún dispositivo.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {d.deviceName || 'Dispositivo sin nombre'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Registrado el {fmtDate(d.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(d.id)}
                    loading={removingId === d.id}
                    aria-label={`Eliminar ${d.deviceName || 'dispositivo'}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {supported && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <Label htmlFor="webauthn-device-name">Nombre del dispositivo (opcional)</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="webauthn-device-name"
                type="text"
                placeholder="Mi celular"
                maxLength={60}
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                disabled={registering}
              />
              <Button onClick={handleRegister} loading={registering} className="shrink-0">
                {registering ? 'Registrando…' : 'Registrar este dispositivo'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
