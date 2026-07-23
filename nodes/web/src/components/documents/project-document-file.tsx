import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/utils';
import { errorToMessage, getProjectDocumentFileUrl } from '@/lib/api';

/**
 * Abre el PDF de un documento de proyecto en una pestaña nueva usando la URL
 * FRESCA de `GET /project-documents/:id/file-url` (Fase 1B). Nunca se navega
 * `fileUrl` crudo: para documentos nuevos es una clave de storage no navegable.
 *
 * La pestaña se abre de forma síncrona (dentro del gesto del usuario) para no
 * gatillar el bloqueador de ventanas emergentes; la URL se asigna al llegar.
 * Lanza el error para que el llamador lo informe (toast, etc.).
 */
export async function openProjectDocumentFileInNewTab(documentId: string): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const { url } = await getProjectDocumentFileUrl(documentId);
    if (win) {
      win.opener = null;
      win.location.replace(url);
    } else {
      // Bloqueador activo: intento directo (puede ser permitido al ser mismo gesto).
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch (error) {
    win?.close();
    throw error;
  }
}

export interface ProjectDocumentPdfViewerProps {
  /** Id del documento de proyecto cuyo PDF se muestra. */
  documentId: string;
  /**
   * Revisión vigente del documento. Al cambiar (nueva revisión subida) se
   * vuelve a pedir la URL fresca para mostrar el archivo correcto.
   */
  version?: number;
  /** Nombre visible del documento (título accesible del iframe). */
  title: string;
  /** Clase opcional del contenedor. */
  className?: string;
}

/**
 * Visor de PDF embebido para documentos de proyecto (Fase 1B, C1). Pide la URL
 * fresca al backend (presign R2 para claves nuevas; passthrough para URLs
 * legadas) y renderiza el PDF en un iframe responsive, con estados de carga y
 * error, y un enlace "Abrir en pestaña nueva" con la MISMA URL fresca.
 */
export function ProjectDocumentPdfViewer({
  documentId,
  version,
  title,
  className,
}: ProjectDocumentPdfViewerProps): ReactNode {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    getProjectDocumentFileUrl(documentId)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorToMessage(err, 'No se pudo obtener el archivo del documento.'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId, version, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate text-xs font-semibold text-foreground">Archivo PDF</span>
        </div>
        {url !== null && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-primary hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Abrir en pestaña nueva
          </a>
        )}
      </div>

      {loading ? (
        <div
          role="status"
          aria-busy
          className="flex h-64 w-full items-center justify-center rounded-lg border border-border bg-muted/20 sm:h-80"
        >
          <span className="sr-only">Cargando documento…</span>
          <div className="flex w-2/3 flex-col gap-3" aria-hidden>
            <div className="h-4 w-full animate-pulse rounded bg-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
            <div className="h-4 w-4/6 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ) : error !== null ? (
        <ErrorState
          message={error}
          onRetry={retry}
          className="h-auto p-6"
        />
      ) : url !== null ? (
        <iframe
          src={url}
          title={`PDF: ${title}`}
          className="h-64 w-full rounded-lg border border-border bg-muted/10 sm:h-80 lg:h-96"
        />
      ) : null}
    </div>
  );
}
