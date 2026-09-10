import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { HardHat } from 'lucide-react';
import { BrandLogo } from '@/components/branding/brand-logo';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, getPublicObraDashboard } from '@/lib/api';
import type { ObraDashboard } from '@gmt-platform/contracts';
import { ObraDashboardPanel, fechaLarga } from '@/pages/proyectos/obra-dashboard-panel';

/** Cada cuánto se refresca solo. La TV de faena queda encendida todo el día. */
const REFRESCO_MS = 5 * 60_000;

/**
 * Dashboard público de una obra, por token opaco. Es el mismo panel de la
 * plataforma, sin sesión y sin datos internos: solo avance físico, hitos y
 * fechas. Se abre en la TV de faena y se comparte con el cliente.
 */
export default function PublicObraDashboardPage(): ReactNode {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ObraDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actualizado, setActualizado] = useState<Date | null>(null);

  const load = useCallback(
    (silencioso = false) => {
      if (!token) return;
      if (!silencioso) setLoading(true);
      getPublicObraDashboard(token)
        .then((d) => {
          setData(d);
          setError(null);
          setActualizado(new Date());
        })
        .catch((e: unknown) => {
          // En un refresco automático se conserva lo que ya está en pantalla:
          // un corte de red no debe dejar la TV de faena en blanco.
          if (!silencioso) {
            setError(errorToMessage(e, 'No se pudo cargar el avance de la obra.'));
          }
        })
        .finally(() => {
          if (!silencioso) setLoading(false);
        });
    },
    [token],
  );

  useEffect(() => load(), [load]);

  useEffect(() => {
    const id = window.setInterval(() => load(true), REFRESCO_MS);
    return () => window.clearInterval(id);
  }, [load]);

  /*
   * El panel es público pero NO indexable: si Google lo rastrea, el avance de
   * cada obra queda buscable sin que nadie comparta el link. Como es una SPA,
   * la etiqueta se pone al montar y se retira al salir para no dejar marcado el
   * resto de la aplicación.
   */
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HardHat className="size-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold sm:text-2xl">
                {data?.projectName ?? 'Avance de obra'}
              </h1>
              <p className="text-sm text-muted-foreground">
                {data?.clientName ? `${data.clientName} · ` : ''}Avance físico de obra
              </p>
            </div>
          </div>
          <BrandLogo className="h-12 shrink-0" />
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8 sm:py-8">
        {loading && <LoadingState rows={6} label="Cargando el avance de la obra…" />}
        {!loading && error && <ErrorState message={error} onRetry={() => load()} />}
        {!loading && !error && data && <ObraDashboardPanel data={data} size="tv" />}
      </main>

      <footer className="mx-auto max-w-[1600px] px-4 pb-8 text-xs text-muted-foreground sm:px-8">
        <p>
          Datos al {fechaLarga(data?.asOf ?? null)}
          {actualizado
            ? ` · pantalla actualizada a las ${actualizado.toLocaleTimeString('es-CL', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}`
            : ''}
          . Se actualiza solo cada 5 minutos.
        </p>
        <p className="mt-1">GMT Link · avance físico informado por el equipo de obra.</p>
      </footer>
    </div>
  );
}
