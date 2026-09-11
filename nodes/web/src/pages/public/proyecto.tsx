import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, errorToMessage, getPublicObraDashboard } from '@/lib/api';
import { PuertaClave, leerPase, olvidarPase } from './obra-puerta';
import type { ObraDashboard } from '@gmt-platform/contracts';
import { ObraTablero, fechaLarga } from '@/pages/proyectos/obra-tablero';
import gmtLogo from '@/assets/branding/gmt-corporativo-blanco.png';
import isoLogo from '@/assets/branding/certificacion-iso-9001-bureau-veritas.png';

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
  // El tablero pide clave cuando el proyecto la tiene configurada y quien mira
  // no trae sesión con permiso. El pase se guarda por pestaña.
  const [pideClave, setPideClave] = useState(false);

  const load = useCallback(
    (silencioso = false) => {
      if (!token) return;
      if (!silencioso) setLoading(true);
      getPublicObraDashboard(token, leerPase(token))
        .then((d) => {
          setData(d);
          setError(null);
          setPideClave(false);
          setActualizado(new Date());
        })
        .catch((e: unknown) => {
          // 401 no es un error de red: es un tablero protegido. Puede aparecer
          // en un refresco silencioso si el pase venció durante el turno, y ahí
          // sí corresponde volver a pedirla.
          if (e instanceof ApiError && e.status === 401) {
            olvidarPase(token);
            setPideClave(true);
            setData(null);
            setError(null);
            return;
          }
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
    <div className="relative flex min-h-dvh flex-col bg-slate-900 lg:h-dvh lg:overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-slate-950 px-4 py-2.5 text-white sm:px-6">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          {/* Versión en blanco de la marca: va directo sobre el fondo oscuro,
              sin el recuadro blanco que antes hacía falta para que se leyera. */}
          <img src={gmtLogo} alt="GMT" className="h-8 w-auto shrink-0 sm:h-12 2xl:h-16" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-bold leading-tight sm:text-lg 2xl:text-xl">
              {data?.projectName ?? 'Avance de obra'}
            </h1>
            <p className="truncate text-xs text-white/60 sm:text-sm">
              {data?.clientName ? `${data.clientName} · ` : ''}Avance de obra
            </p>
          </div>
        </div>

        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-white/60 2xl:text-xs">
            {data?.control ? 'Corte del informe' : 'Datos al'}
          </p>
          <p className="text-sm font-bold tabular-nums sm:text-base 2xl:text-lg">
            {fechaLarga(data?.control?.cutoff ?? data?.asOf ?? null)}
          </p>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col p-2 sm:p-3">
        {pideClave && token && (
          <PuertaClave token={token} onAbierto={() => load()} />
        )}
        {!pideClave && loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-white/70">
            Cargando el avance de la obra…
          </div>
        )}
        {!pideClave && !loading && error && (
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
        {!pideClave && !loading && !error && data && <ObraTablero data={data} />}
      </main>

      <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-white/10 bg-slate-950 px-4 py-2 text-white sm:px-6">
        <div className="min-w-0 text-[11px] text-white/60 2xl:text-xs">
          <p className="truncate">GMT Link · avance físico informado por el equipo de obra.</p>
          <p className="truncate tabular-nums">
            {hora ? `Pantalla actualizada a las ${hora} · ` : ''}se actualiza sola cada 5 minutos.
          </p>
        </div>
        {/* La certificación cierra la pantalla abajo a la derecha, que es donde
            se lee al final. Es el sello de Bureau Veritas tal como se entrega:
            placa blanca con el borde recortado, sin fondo alrededor. */}
        <img
          src={isoLogo}
          alt="Certificación ISO 9001 otorgada por Bureau Veritas"
          className="h-5 w-auto shrink-0 sm:h-8 lg:h-10 2xl:h-14"
        />
      </footer>
    </div>
  );
}
