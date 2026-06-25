import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Award, Mail, RotateCw } from 'lucide-react';
import type {
  DirectoryEntry,
  DirectoryEntryExtended,
} from '@gmt-platform/contracts';
import {
  ApiError,
  getDirectoryEntry,
  getDirectoryExtended,
} from '@/lib/api';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { RoleChips } from '@/pages/usuarios/role-chips';
import { StatusBadge } from '@/pages/usuarios/status-badge';
import { PersonAvatar } from './person-avatar';
import { TypeBadge } from './type-badge';

/** Mensaje legible a partir de un error desconocido. */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Compone el nombre completo a partir de los campos disponibles. */
function fullName(
  entry: DirectoryEntry,
  extended: DirectoryEntryExtended | null,
): string {
  const parts = [
    entry.firstName,
    extended?.secondName ?? null,
    entry.lastName,
    extended?.secondLastName ?? null,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));
  return parts.join(' ');
}

/** Fila etiqueta/valor del detalle. */
function DetailRow({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex flex-col gap-1 border-t border-border py-3 first:border-t-0 first:pt-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

/**
 * Diálogo de detalle de una entrada del directorio (§6-1.6).
 *
 * Al abrirse con un `id`, carga el detalle BÁSICO (`getDirectoryEntry`) y, en
 * paralelo, INTENTA el extendido (`getDirectoryExtended`). Si el extendido
 * responde 403 (sin `directory:view:extended`), se ignora silenciosamente y se
 * muestra solo el básico. Cualquier otro fallo del básico se muestra como error.
 */
export function DirectoryDetailDialog({
  entryId,
  fallbackEntry,
  onClose,
}: {
  entryId: string | null;
  /** Datos ya disponibles en la fila, para pintar al instante mientras carga. */
  fallbackEntry: DirectoryEntry | null;
  onClose: () => void;
}): ReactNode {
  const [entry, setEntry] = useState<DirectoryEntry | null>(null);
  const [extended, setExtended] = useState<DirectoryEntryExtended | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // El `fallbackEntry` solo siembra el pintado inicial; lo leemos por ref para
  // que el efecto dependa únicamente del `id` seleccionado y del reintento.
  const fallbackRef = useRef(fallbackEntry);
  fallbackRef.current = fallbackEntry;

  useEffect(() => {
    if (!entryId) return;

    let active = true;
    setLoading(true);
    setError(null);
    setExtended(null);
    setEntry(fallbackRef.current);

    async function load(id: string): Promise<void> {
      try {
        const basic = await getDirectoryEntry(id);
        if (active) setEntry(basic);
      } catch (err) {
        if (active) setError(toMessage(err, 'No se pudo cargar el detalle.'));
        if (active) setLoading(false);
        return;
      }

      // El extendido es opcional: 403 (sin permiso) se maneja en silencio.
      try {
        const ext = await getDirectoryExtended(id);
        if (active) setExtended(ext);
      } catch {
        // Sin permiso o no disponible → solo detalle básico.
      } finally {
        if (active) setLoading(false);
      }
    }

    void load(entryId);
    return () => {
      active = false;
    };
  }, [entryId, reloadKey]);

  const open = entryId !== null;
  const name = entry ? fullName(entry, extended) : '';

  return (
    <Modal open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <ModalContent aria-describedby={undefined}>
        <ModalHeader>
          <ModalTitle>Detalle de contacto</ModalTitle>
          <ModalDescription>Información del directorio.</ModalDescription>
        </ModalHeader>

        {error && !entry ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-10 text-center"
          >
            <AlertCircle className="size-8 text-destructive" aria-hidden />
            <p className="max-w-sm text-sm text-destructive">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              <RotateCw aria-hidden />
              Reintentar
            </Button>
          </div>
        ) : (
          entry && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center gap-4">
                <PersonAvatar
                  firstName={entry.firstName}
                  lastName={entry.lastName}
                  avatarUrl={entry.avatarUrl}
                  size="xl"
                />
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-lg font-semibold tracking-tight">{name}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <TypeBadge isClientUser={entry.isClientUser} />
                    {extended && <StatusBadge status={extended.status} />}
                  </div>
                </div>
              </div>

              <dl className="flex flex-col">
                <DetailRow
                  label="Correo"
                  value={
                    <a
                      href={`mailto:${entry.email}`}
                      className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
                    >
                      <Mail className="size-4" aria-hidden />
                      {entry.email}
                    </a>
                  }
                />
                <DetailRow label="Roles" value={<RoleChips roleKeys={entry.roleKeys} />} />
                {extended && (
                  <DetailRow
                    label="Puntos"
                    value={
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Award className="size-4 text-muted-foreground" aria-hidden />
                        {extended.points}
                      </span>
                    }
                  />
                )}
              </dl>

              {loading && (
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Cargando información adicional…
                </p>
              )}
            </div>
          )
        )}
      </ModalContent>
    </Modal>
  );
}
