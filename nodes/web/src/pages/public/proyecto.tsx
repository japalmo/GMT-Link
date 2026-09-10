import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { errorToMessage, getPublicObraDashboard } from '@/lib/api';
import type { ObraDashboard } from '@gmt-platform/contracts';
import { ObraTablero, fechaLarga } from '@/pages/proyectos/obra-tablero';
import gmtLogo from '@/assets/branding/gmt-corporativo.png';
import isoLogo from '@/assets/branding/iso-9001-bureau-veritas.png';

/** Cada cuánto se refresca solo. La TV de faena queda encendida todo el día. */
const REFRESCO_MS = 5 * 60_000;

/**
 * Tablero público de una obra, por token opaco. Sin sesión y sin datos
 * internos: solo avance físico, hitos y fechas. Se proyecta en la TV de faena
 * y se comparte con el cliente.
 *
 * En TV y notebook entra completo en una pantalla (`h-dvh`, sin scroll); en
 * móvil el alto se suelta, porque comprimirlo ahí lo dejaría ilegible.
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
   * El tablero es público pero NO indexable: si Google lo rastrea, el avance de
   * cada obra queda buscable sin que nadie comparta el enlace. Como es una SPA,
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

  const hora = actualizado
    ? actualizado.toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : null;

  return (
    <div className="relative flex min-h-dvh flex-col bg-slate-900 md:h-dvh md:overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-slate-950 px-4 py-2.5 text-white sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {/* El logo corporativo va sobre blanco: el isotipo es navy sobre
              transparente y se perdería contra el fondo oscuro. */}
          <span className="flex shrink-0 items-center rounded-md bg-white px-2 py-1">
            <img src={gmtLogo} alt="GMT" className="h-7 w-auto sm:h-8" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight sm:text-xl">
              {data?.projectName ?? 'Avance de obra'}
            </h1>
            <p className="truncate text-xs text-white/60 sm:text-sm">
              {data?.clientName ? `${data.clientName} · ` : ''}Avance físico de obra
            </p>
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/60">Datos al</p>
          <p className="text-sm font-bold tabular-nums sm:text-base">
            {fechaLarga(data?.asOf ?? null)}
          </p>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-white/70">
            Cargando el avance de la obra…
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-white/80">{error}</p>
            <button
              type="button"
              onClick={() => load()}
              className="rounded-md bg-white/15 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/25"
            >
              Reintentar
            </button>
          </div>
        )}
        {!loading && !error && data && <ObraTablero data={data} />}
      </main>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-white/10 bg-slate-950 px-4 py-2 text-white sm:px-6">
        <div className="min-w-0 text-[11px] text-white/60">
          <p className="truncate">GMT Link · avance físico informado por el equipo de obra.</p>
          <p className="truncate tabular-nums">
            {hora ? `Pantalla actualizada a las ${hora} · ` : ''}se actualiza sola cada 5 minutos.
          </p>
        </div>
        {/* La certificación cierra la pantalla abajo a la derecha, que es donde
            se lee al final. Va sobre blanco: el sello es gris sobre transparente. */}
        <span className="flex shrink-0 items-center rounded-md bg-white px-3 py-1.5">
          <img
            src={isoLogo}
            alt="Certificación ISO 9001 otorgada por Bureau Veritas"
            className="h-11 w-auto sm:h-14"
          />
        </span>
      </footer>
    </div>
  );
}
