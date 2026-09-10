import { useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';
import { KeyRound, Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle, ModalDescription } from '@/components/ui/modal';
import { Alert } from '@/components/ui/alert';
import { errorToMessage, setProjectPublicPassword } from '@/lib/api';

/**
 * Clave del enlace público del proyecto, para configurarla desde GMT Link.
 *
 * Sin clave el enlace queda abierto, que es como funcionaba hasta ahora y como
 * siguen los enlaces ya compartidos. Con clave, quien abra el enlace debe
 * escribirla o iniciar sesión con un usuario que ya pueda ver la obra.
 */
export function ObraClavePublica({
  projectId,
  protegido,
  onCambio,
}: {
  projectId: string;
  protegido: boolean;
  onCambio: (protegido: boolean) => void;
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cerrar(): void {
    setAbierto(false);
    setClave('');
    setRepetida('');
    setError(null);
  }

  async function guardar(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (guardando) return;
    if (clave.length < 6) {
      setError('La clave debe tener al menos 6 caracteres.');
      return;
    }
    if (clave !== repetida) {
      setError('Las dos claves no coinciden.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const { publicPasswordSet } = await setProjectPublicPassword(projectId, clave);
      onCambio(publicPasswordSet);
      toast.success('El enlace público quedó protegido con clave.');
      cerrar();
    } catch (err) {
      setError(errorToMessage(err, 'No se pudo guardar la clave.'));
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(): Promise<void> {
    setGuardando(true);
    try {
      const { publicPasswordSet } = await setProjectPublicPassword(projectId, null);
      onCambio(publicPasswordSet);
      toast.success('El enlace público quedó abierto, sin clave.');
      cerrar();
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo quitar la clave.'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        {protegido ? (
          <Lock className="mr-2 size-4" aria-hidden />
        ) : (
          <LockOpen className="mr-2 size-4" aria-hidden />
        )}
        {protegido ? 'Enlace con clave' : 'Enlace sin clave'}
      </Button>

      <Modal open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : cerrar())}>
        <ModalContent>
          <form onSubmit={guardar} className="flex flex-col gap-4">
            <ModalHeader>
              <ModalTitle className="flex items-center gap-2">
                <KeyRound className="size-4" aria-hidden />
                Clave del enlace público
              </ModalTitle>
              <ModalDescription>
                {protegido
                  ? 'El enlace pide clave. Puedes cambiarla o dejar el tablero abierto.'
                  : 'Hoy el enlace está abierto: cualquiera con la dirección ve el avance. Ponle una clave para restringirlo.'}
              </ModalDescription>
            </ModalHeader>

            {error && (
              <Alert variant="destructive" live>
                {error}
              </Alert>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clave-publica">Clave nueva</Label>
              <Input
                id="clave-publica"
                type="password"
                value={clave}
                autoComplete="new-password"
                onChange={(e) => setClave(e.target.value)}
                placeholder="Al menos 6 caracteres"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clave-publica-2">Repite la clave</Label>
              <Input
                id="clave-publica-2"
                type="password"
                value={repetida}
                autoComplete="new-password"
                onChange={(e) => setRepetida(e.target.value)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Quien tenga sesión en GMT Link y permiso sobre esta obra entra sin escribir la clave.
            </p>

            <ModalFooter>
              {protegido && (
                <Button type="button" variant="ghost" onClick={quitar} disabled={guardando}>
                  Quitar la clave
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={cerrar} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar clave'}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}
