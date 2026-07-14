import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, ExternalLink, FileText, History, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { approveDocument, errorToMessage, fetchUserDocuments, rejectDocument } from '@/lib/api';
import type { PersonalDocumentView } from '@/types/documents';
import { toast } from 'sonner';
import { ExpiryCell } from '../documentos/expiry-cell';

/**
 * Pestaña Documentos del detalle del trabajador (admin). Lista los documentos del
 * trabajador (`GET /documents/user/:id`) y permite revisarlos: aprobar / rechazar
 * (`POST /documents/:id/approve|reject`) y abrir el archivo. La subida y el
 * versionado siguen siendo del propio trabajador (Mis documentos); aquí el admin
 * solo revisa. Estados de carga / error / vacío siempre presentes.
 */
export function UserDocumentsTab({ userId }: { userId: string }): ReactNode {
  const [docs, setDocs] = useState<PersonalDocumentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchUserDocuments(userId)
      .then((data) => {
        if (alive) setDocs(data);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorToMessage(err, 'No se pudieron cargar los documentos.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => load(), [load]);

  /** Reemplaza en el sitio el documento devuelto tras aprobar/rechazar. */
  function patch(updated: PersonalDocumentView): void {
    setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }

  async function handleReview(doc: PersonalDocumentView, action: 'approve' | 'reject'): Promise<void> {
    setBusyId(doc.id);
    try {
      const updated =
        action === 'approve' ? await approveDocument(doc.id) : await rejectDocument(doc.id);
      patch(updated);
      toast.success(action === 'approve' ? 'Documento aprobado.' : 'Documento rechazado.');
    } catch (err) {
      toast.error(errorToMessage(err, 'No se pudo actualizar el documento.'));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <LoadingState rows={4} label="Cargando documentos…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (docs.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Sin documentos"
        message="Este trabajador todavía no ha subido documentos."
      />
    );
  }

  return (
    <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
      {docs.map((doc) => {
        const busy = busyId === doc.id;
        return (
          <li
            key={doc.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
                <p className="text-xs text-muted-foreground">{doc.type}</p>
              </div>
              <StatusBadge type="document" status={doc.status} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <ExpiryCell document={doc} />
              <a
                href={doc.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
              >
                <FileText className="size-4" aria-hidden />
                Ver archivo
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
              {doc.previousFileUrl && (
                <a
                  href={doc.previousFileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  <History className="size-3.5" aria-hidden />
                  Versión anterior
                </a>
              )}
            </div>

            <div className="flex justify-end gap-2">
              {doc.status !== 'APROBADO' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleReview(doc, 'approve')}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
                  Aprobar
                </Button>
              )}
              {doc.status !== 'RECHAZADO' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => void handleReview(doc, 'reject')}
                  disabled={busy}
                >
                  {busy ? <Loader2 className="animate-spin" aria-hidden /> : <X aria-hidden />}
                  Rechazar
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
