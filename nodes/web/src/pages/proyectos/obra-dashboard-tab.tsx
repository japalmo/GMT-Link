import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Link2, RefreshCw } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, getObraDashboard } from '@/lib/api';
import type { ObraDashboard } from '@gmt-platform/contracts';
import { ObraDashboardPanel } from './obra-dashboard-panel';

/**
 * Pestaña Dashboard para proyectos de OBRAS CIVILES: avance físico contra la
 * carta Gantt. Muestra exactamente el mismo panel que el enlace público, para
 * que nadie discuta dos versiones del mismo porcentaje.
 */
export function ObraDashboardTab({
  projectId,
  publicToken,
}: {
  projectId: string;
  publicToken?: string | null;
}): ReactNode {
  const [data, setData] = useState<ObraDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let vivo = true;
    setLoading(true);
    setError(null);
    getObraDashboard(projectId)
      .then((d) => {
        if (vivo) setData(d);
      })
      .catch((e: unknown) => {
        if (vivo) setError(errorToMessage(e, 'No se pudo cargar el avance de obra.'));
      })
      .finally(() => {
        if (vivo) setLoading(false);
      });
    return () => {
      vivo = false;
    };
  }, [projectId]);

  useEffect(() => load(), [load]);

  const publicUrl = publicToken ? `${window.location.origin}/public/proyecto/${publicToken}` : null;

  async function copiarEnlace(): Promise<void> {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success('Enlace público copiado.');
    } catch {
      // Sin permiso de portapapeles (o contexto no seguro): mostrarlo para copiar a mano.
      toast.info(publicUrl, { duration: 10_000 });
    }
  }

  if (loading) return <LoadingState rows={5} label="Cargando el avance de obra…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="mr-2 size-4" aria-hidden />
          Actualizar
        </Button>
        {publicUrl && (
          <>
            <Button variant="outline" size="sm" onClick={copiarEnlace}>
              <Link2 className="mr-2 size-4" aria-hidden />
              Copiar enlace público
            </Button>
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ExternalLink className="mr-2 size-4" aria-hidden />
              Abrir vista de faena
            </a>
          </>
        )}
      </div>

      <ObraDashboardPanel data={data} />
    </div>
  );
}
