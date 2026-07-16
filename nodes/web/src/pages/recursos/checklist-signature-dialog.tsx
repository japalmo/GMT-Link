import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { startAuthentication, WebAuthnError } from '@simplewebauthn/browser';
import { toast } from 'sonner';
import { Fingerprint, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import {
  errorToMessage,
  listWebAuthnCredentials,
  prepareChecklistSignature,
} from '@/lib/api';
import type { ChecklistAnswer, ChecklistSignatureInput } from '@/types/assets';

/** Contexto de la firma en curso: lo que se envía sin cambios a sign-options y submit. */
interface SignatureContext {
  assetId: string;
  templateId: string;
  answers: ChecklistAnswer[];
}

/** Pantalla activa del diálogo de firma. */
type SignatureMode = 'loading' | 'choose' | 'otp';

export interface UseChecklistSignatureResult {
  /**
   * Abre el diálogo y resuelve con la firma verificada, o `null` si el usuario
   * cancela. Se le pasa el MISMO `{ templateId, answers }` que irá al submit/confirm
   * (el servidor los hashea; deben coincidir).
   */
  requestSignature: (
    assetId: string,
    templateId: string,
    answers: ChecklistAnswer[],
  ) => Promise<ChecklistSignatureInput | null>;
  /** Nodo del diálogo. Renderízalo una sola vez en la página. */
  dialog: ReactNode;
}

/** ¿El error de la ceremonia es una cancelación del usuario? (no amerita toast de error). */
function isUserCancel(error: unknown): boolean {
  if (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED') return true;
  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

/**
 * Firma verificada del checklist (#68 Fase 2). Ofrece biometría (WebAuthn) cuando
 * el usuario tiene un dispositivo registrado, con respaldo por código al correo
 * (OTP). El hook expone `requestSignature` (promesa que resuelve con la firma o
 * `null` si se cancela) y `dialog`, que se renderiza una sola vez en la página.
 */
export function useChecklistSignature(): UseChecklistSignatureResult {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SignatureMode>('loading');
  const [busy, setBusy] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const otpId = useId();
  const resolverRef = useRef<((sig: ChecklistSignatureInput | null) => void) | null>(null);
  const ctxRef = useRef<SignatureContext | null>(null);

  /** Cierra el diálogo resolviendo la promesa una sola vez. */
  const finish = useCallback((sig: ChecklistSignatureInput | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    // Limpia el contexto en curso: si se cancela durante "Preparando…", los guards
    // `if (!ctx) return` de detect/sendOtp/handleBiometric abortan y no se dispara un
    // OTP fantasma al correo tras cerrar el diálogo.
    ctxRef.current = null;
    setOpen(false);
    if (resolve) resolve(sig);
  }, []);

  /** Pide un código al correo (arranca o reenvía el OTP) y muestra la pantalla OTP. */
  const sendOtp = useCallback(async (opts?: { resend?: boolean }): Promise<void> => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    setMode('otp');
    setBusy(true);
    setError(null);
    try {
      const result = await prepareChecklistSignature(ctx.assetId, {
        templateId: ctx.templateId,
        answers: ctx.answers,
        method: 'EMAIL_OTP',
      });
      if (result.method === 'EMAIL_OTP') {
        setMaskedEmail(result.maskedEmail);
        if (opts?.resend) toast.success('Te reenviamos un nuevo código.');
      }
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo enviar el código a tu correo.'));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Detecta si el usuario tiene un dispositivo biométrico; si no, cae al correo. */
  const detect = useCallback(async (): Promise<void> => {
    try {
      const devices = await listWebAuthnCredentials();
      if (devices.length > 0) {
        setMode('choose');
        return;
      }
    } catch {
      // No pudimos saber: usamos el respaldo por correo.
    }
    await sendOtp();
  }, [sendOtp]);

  const requestSignature = useCallback(
    (assetId: string, templateId: string, answers: ChecklistAnswer[]) =>
      new Promise<ChecklistSignatureInput | null>((resolve) => {
        resolverRef.current = resolve;
        ctxRef.current = { assetId, templateId, answers };
        setCode('');
        setMaskedEmail('');
        setError(null);
        setBusy(false);
        setMode('loading');
        setOpen(true);
        void detect();
      }),
    [detect],
  );

  /** Firma con biometría: pide las opciones al servidor y corre la ceremonia WebAuthn. */
  async function handleBiometric(): Promise<void> {
    const ctx = ctxRef.current;
    if (!ctx) return;
    setBusy(true);
    setError(null);
    try {
      const result = await prepareChecklistSignature(ctx.assetId, {
        templateId: ctx.templateId,
        answers: ctx.answers,
        method: 'WEBAUTHN',
      });
      if (result.method !== 'WEBAUTHN') {
        throw new Error('Respuesta inesperada del servidor.');
      }
      const response = await startAuthentication({ optionsJSON: result.options });
      finish({ method: 'WEBAUTHN', response: response as unknown as Record<string, unknown> });
    } catch (err) {
      if (isUserCancel(err)) return; // el usuario canceló el gesto: se queda abierto
      if (err instanceof WebAuthnError) {
        toast.error('No se pudo firmar con biometría. Intenta de nuevo o usa el código al correo.');
      } else {
        toast.error(
          errorToMessage(
            err,
            'No se pudo firmar con biometría. Intenta de nuevo o usa el código al correo.',
          ),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  /** Confirma la firma con el código de 6 dígitos ingresado. */
  function handleConfirmOtp(): void {
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Ingresa el código de 6 dígitos que enviamos a tu correo.');
      return;
    }
    finish({ method: 'EMAIL_OTP', code: trimmed });
  }

  const dialog = (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) finish(null);
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Firma la inspección</ModalTitle>
          <ModalDescription>
            Confirma tu identidad para dejar registrada la firma de este checklist.
          </ModalDescription>
        </ModalHeader>

        {mode === 'loading' && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Preparando la firma…
          </div>
        )}

        {mode === 'choose' && (
          <div className="flex flex-col gap-3">
            <Button onClick={() => void handleBiometric()} loading={busy} className="w-full">
              <Fingerprint className="size-4" aria-hidden />
              Firmar con biometría
            </Button>
            <button
              type="button"
              onClick={() => void sendOtp()}
              disabled={busy}
              className="text-sm text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              Firmar con código al correo
            </button>
          </div>
        )}

        {mode === 'otp' && (
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="size-4 shrink-0" aria-hidden />
              {maskedEmail
                ? `Enviamos un código a ${maskedEmail}.`
                : 'Enviamos un código a tu correo.'}
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor={otpId}>Código de verificación</Label>
              <Input
                id={otpId}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                value={code}
                disabled={busy}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                  if (error) setError(null);
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => void sendOtp({ resend: true })}
              disabled={busy}
              className="self-start text-sm text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
            >
              Reenviar código
            </button>
          </div>
        )}

        {error && (
          <Alert variant="destructive" live>
            {error}
          </Alert>
        )}

        <ModalFooter>
          <Button type="button" variant="outline" onClick={() => finish(null)} disabled={busy}>
            Cancelar
          </Button>
          {mode === 'otp' && (
            <Button type="button" onClick={handleConfirmOtp} loading={busy}>
              Confirmar firma
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );

  return { requestSignature, dialog };
}
