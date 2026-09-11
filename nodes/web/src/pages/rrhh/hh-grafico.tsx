import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Clock } from 'lucide-react';
import type { HrHours } from '@gmt-platform/contracts';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorToMessage, getHrHours } from '@/lib/api';
import { fechaCorta } from './rrhh-shared';

/**
 * Horas hombre del trabajador por fecha.
 *
 * Los datos salen de los registros de tiempo de Operaciones, que es la única
 * fuente: acá no se carga nada a mano. Por eso hay tres estados distintos y la
 * pantalla no los confunde:
 *
 *  - No se pudo consultar (error).
 *  - El período no tiene actividad registrada (cero registros).
 *  - Hay actividad y se dibuja.
 *
 * Rellenar los días sin registro con cero haría el gráfico más "completo" y
 * mentiría: un día sin marcar no es un día de cero horas.
 */

/** aaaa-mm-dd de hoy en hora local, sin pasar por UTC. */
function hoyISO(desplazamientoDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + desplazamientoDias);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function HhGrafico({ userId }: { userId: string }): ReactNode {
  const [desde, setDesde] = useState(() => hoyISO(-29));
  const [hasta, setHasta] = useState(() => hoyISO());
  const [datos, setDatos] = useState<HrHours | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    getHrHours(userId, desde, hasta)
      .then((d) => vivo && setDatos(d))
      .catch((err) => vivo && setError(errorToMessage(err, 'No se pudieron consultar las HH.')))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [userId, desde, hasta]);

  const maximo = useMemo(
    () => Math.max(1, ...(datos?.points ?? []).map((p) => p.hours)),
    [datos],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 opacity-70" aria-hidden />
            Horas hombre
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Calculadas sobre las actividades registradas en Operaciones.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="hh-desde" className="text-xs">
              Desde
            </Label>
            <Input
              id="hh-desde"
              type="date"
              value={desde}
              max={hasta}
              onChange={(e) => setDesde(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="hh-hasta" className="text-xs">
              Hasta
            </Label>
            <Input
              id="hh-hasta"
              type="date"
              value={hasta}
              min={desde}
              onChange={(e) => setHasta(e.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
        </div>
      </div>

      <div className="mt-4">
        {cargando ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Consultando las HH…</p>
        ) : error ? (
          <p className="py-10 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : !datos || datos.entries === 0 ? (
          <p className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Sin actividad registrada entre el {fechaCorta(desde)} y el {fechaCorta(hasta)}.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">
                {datos.totalHours.toLocaleString('es-CL', { maximumFractionDigits: 1 })}
              </span>
              <span className="text-sm text-muted-foreground">
                HH en {datos.points.length} {datos.points.length === 1 ? 'día' : 'días'} con
                actividad
              </span>
            </div>
            {datos.openEntries > 0 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                {datos.openEntries}{' '}
                {datos.openEntries === 1 ? 'actividad sigue abierta' : 'actividades siguen abiertas'}
                : sus horas todavía no se cuentan.
              </p>
            )}

            <ul className="mt-4 flex items-end gap-1 overflow-x-auto pb-1" aria-hidden>
              {datos.points.map((p) => (
                <li
                  key={p.date}
                  className="flex min-w-[14px] flex-1 flex-col items-center justify-end"
                  title={`${fechaCorta(p.date)}: ${p.hours} HH`}
                >
                  <span
                    className="w-full rounded-t bg-sky-500/80"
                    style={{ height: `${Math.max(3, (p.hours / maximo) * 110)}px` }}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{fechaCorta(datos.points[0]?.date ?? desde)}</span>
              <span>{fechaCorta(datos.points.at(-1)?.date ?? hasta)}</span>
            </div>

            {/* El gráfico es decorativo para un lector de pantalla; la tabla es
                la que lleva el dato. */}
            <table className="sr-only">
              <caption>Horas hombre por fecha</caption>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Horas</th>
                </tr>
              </thead>
              <tbody>
                {datos.points.map((p) => (
                  <tr key={p.date}>
                    <td>{fechaCorta(p.date)}</td>
                    <td>{p.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </section>
  );
}
