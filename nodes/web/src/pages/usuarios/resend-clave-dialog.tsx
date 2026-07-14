import { useEffect, useId, useState, type ReactNode } from 'react';
import { KeyRound, Loader2, Mail, Send } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import {
  errorToMessage,
  resendUserInvite,
  resendUserInvitePreview,
  type ResendInvitePreview,
  type UserListItem,
} from '@/lib/api';
import type { ProvisionalCredential } from './credential-dialog';

/**
 * Diálogo de reenvío de clave con VISTA PREVIA EDITABLE del correo. La clave
 * NUNCA se muestra ni viaja al front: se regenera y se inyecta en el servidor al
 * enviar (aquí se ve enmascarada). El admin puede editar el asunto y el mensaje y
 * el servidor envía el correo. Si el usuario no tiene correo (o no hay proveedor),
 * cae al camino manual: genera la clave y la entrega para compartirla a mano
 * (vía `onManualCredential`, que abre el diálogo de credenciales).
 */
export function ResendClaveDialog({
  user,
  onOpenChange,
  onSent,
  onManualCredential,
}: {
  user: UserListItem | null;
  onOpenChange: (open: boolean) => void;
  onSent: (to: string) => void;
  onManualCredential: (cred: ProvisionalCredential) => void;
}): ReactNode {
  const baseId = useId();
  const [preview, setPreview] = useState<ResendInvitePreview | null>(null);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Al abrir con un usuario, pide la vista previa (asunto/mensaje por defecto).
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setPreview(null);
    resendUserInvitePreview(user.id)
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        setSubject(p.subject);
        setMessage(p.message);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorToMessage(err, 'No se pudo preparar el reenvío de clave.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  async function handleSend(): Promise<void> {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await resendUserInvite(user.id, { sendEmail: true, subject, message });
      if (result.sent) {
        onSent(result.to ?? preview?.to ?? '');
        onOpenChange(false);
      }
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo enviar el correo.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManual(): Promise<void> {
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await resendUserInvite(user.id, { sendEmail: false });
      if (result.provisionalPassword) {
        onManualCredential({
          username: preview?.username ?? user.username,
          email: preview?.to || user.emailInstitucional || user.emailPersonal || user.email,
          provisionalPassword: result.provisionalPassword,
        });
        onOpenChange(false);
      }
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo generar la clave.'));
    } finally {
      setSubmitting(false);
    }
  }

  const canEmail = preview?.canEmail ?? false;

  return (
    <Modal open={user !== null} onOpenChange={onOpenChange}>
      <ModalContent className="sm:max-w-lg">
        <ModalHeader>
          <ModalTitle>Reenviar clave</ModalTitle>
          <ModalDescription>
            Revisa y ajusta el correo antes de enviarlo. La clave se genera y se
            incluye automáticamente; por seguridad no se muestra aquí.
          </ModalDescription>
        </ModalHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Preparando la vista previa…
          </div>
        )}

        {!loading && error && !preview && (
          <Alert variant="destructive" live>
            {error}
          </Alert>
        )}

        {!loading && preview && (
          <div className="flex flex-col gap-4">
            {canEmail ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${baseId}-to`}>Para</Label>
                  <Input id={`${baseId}-to`} value={preview.to} readOnly disabled />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${baseId}-subject`}>Asunto</Label>
                  <Input
                    id={`${baseId}-subject`}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={200}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${baseId}-message`}>Mensaje</Label>
                  <Textarea
                    id={`${baseId}-message`}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    maxLength={4000}
                  />
                  <p className="text-xs text-muted-foreground">
                    Este es el texto de introducción. Debajo, el correo incluye el
                    usuario y la clave provisoria automáticamente.
                  </p>
                </div>

                {/* Vista previa enmascarada del bloque de credenciales (no editable). */}
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Se incluirá al final del correo
                  </p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-muted-foreground">Usuario</dt>
                    <dd className="font-mono">{preview.username}</dd>
                    <dt className="text-muted-foreground">Clave provisoria</dt>
                    <dd className="flex items-center gap-1.5 font-mono text-muted-foreground">
                      <KeyRound className="size-3.5" aria-hidden />
                      ••••••••
                    </dd>
                  </dl>
                </div>
              </>
            ) : (
              <Alert variant="warning">
                Este usuario no tiene correo registrado o no hay un proveedor de
                correo configurado. Genera la clave y compártela manualmente.
              </Alert>
            )}

            {error && (
              <Alert variant="destructive" live>
                {error}
              </Alert>
            )}

            <ModalFooter className="sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancelar
              </Button>
              {canEmail ? (
                <>
                  {/* Recuperación: si el envío falla, la clave ya se regeneró; este
                      atajo la entrega para compartirla a mano y no dejar al usuario sin acceso. */}
                  {error && (
                    <Button type="button" variant="outline" onClick={() => void handleManual()} disabled={submitting}>
                      <KeyRound aria-hidden />
                      Compartir a mano
                    </Button>
                  )}
                  <Button type="button" onClick={() => void handleSend()} disabled={submitting}>
                    {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                    Enviar correo
                  </Button>
                </>
              ) : (
                <Button type="button" onClick={() => void handleManual()} disabled={submitting}>
                  {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
                  Generar clave
                </Button>
              )}
            </ModalFooter>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
