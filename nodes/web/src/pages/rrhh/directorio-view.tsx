import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Search, ShieldCheck, UserRound } from 'lucide-react';
import type { HrWorkerRow } from '@gmt-platform/contracts';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, listHrWorkers } from '@/lib/api';
import { PersonAvatar } from '@/pages/directorio/person-avatar';

/**
 * Directorio de RRHH.
 *
 * Sigue la misma disposición que el catálogo de Recursos: buscador y filtros
 * arriba, tabla densa abajo, y la fila entera abre la ficha. Las columnas son
 * las de la consulta diaria —quién es, qué hace, en qué turno, cómo está de
 * papeles—; los antecedentes largos viven en el detalle.
 */

const TURNOS = [
  { value: 'all', label: 'Todos los turnos' },
  { value: 'Administrativo', label: 'Administrativo' },
  { value: 'ciclico', label: 'Turno de faena' },
  { value: 'sin', label: 'Sin turno cargado' },
] as const;

const SITUACIONES = [
  { value: 'all', label: 'Toda situación' },
  { value: 'vencidos', label: 'Con requisitos vencidos' },
  { value: 'porVencer', label: 'Con requisitos por vencer' },
  { value: 'alDia', label: 'Sin vencimientos pendientes' },
] as const;

export function DirectorioView({
  onAbrir,
  busqueda,
  onBusqueda,
  version = 0,
}: {
  onAbrir: (userId: string) => void;
  /** La búsqueda vive en el padre para no perderla al volver de una ficha. */
  busqueda: string;
  onBusqueda: (v: string) => void;
  /** Cambia al volver de una ficha: lo editado ahí tiene que verse en la lista. */
  version?: number;
}): ReactNode {
  const [workers, setWorkers] = useState<HrWorkerRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [turno, setTurno] = useState<string>('all');
  const [situacion, setSituacion] = useState<string>('all');

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    listHrWorkers()
      .then((rows) => vivo && setWorkers(rows))
      .catch((err) => vivo && setError(errorToMessage(err, 'No se pudo cargar el directorio.')))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [version]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return workers.filter((w) => {
      if (
        q &&
        !`${w.firstName} ${w.lastName} ${w.cargo ?? ''} ${w.email}`.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (turno === 'sin' && w.turno !== null) return false;
      if (turno === 'Administrativo' && w.turno !== 'Administrativo') return false;
      if (turno === 'ciclico' && (w.turno === null || w.turno === 'Administrativo')) return false;
      if (situacion === 'vencidos' && w.vencidos === 0) return false;
      if (situacion === 'porVencer' && w.porVencer === 0) return false;
      if (situacion === 'alDia' && (w.vencidos > 0 || w.porVencer > 0)) return false;
      return true;
    });
  }, [workers, busqueda, turno, situacion]);

  const hayFiltro = busqueda.trim() !== '' || turno !== 'all' || situacion !== 'all';

  if (cargando) return <LoadingState rows={6} label="Cargando el directorio…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={busqueda}
            onChange={(e) => onBusqueda(e.target.value)}
            placeholder="Buscar por nombre, cargo o correo…"
            className="pl-8"
            aria-label="Buscar trabajador"
          />
        </div>
        <Select
          value={turno}
          onChange={(e) => setTurno(e.target.value)}
          aria-label="Filtrar por turno"
          className="w-[190px]"
        >
          {TURNOS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Select
          value={situacion}
          onChange={(e) => setSituacion(e.target.value)}
          aria-label="Filtrar por situación"
          className="w-[230px]"
        >
          {SITUACIONES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">
          {visibles.length} de {workers.length}
        </span>
        {hayFiltro && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onBusqueda('');
              setTurno('all');
              setSituacion('all');
            }}
          >
            Limpiar
          </Button>
        )}
      </div>

      {visibles.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={workers.length === 0 ? 'Sin trabajadores' : 'Nadie coincide'}
          message={
            workers.length === 0
              ? 'Todavía no hay trabajadores cargados en la plataforma.'
              : 'Prueba con otro nombre o quita los filtros para ver a todos.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Trabajador</th>
                <th className="px-3 py-2 font-medium">Cargo</th>
                <th className="px-3 py-2 font-medium">Turno</th>
                <th className="px-3 py-2 font-medium">Acreditado en</th>
                <th className="px-3 py-2 text-right font-medium">Requisitos</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((w) => (
                <tr
                  key={w.id}
                  onClick={() => onAbrir(w.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onAbrir(w.id);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Abrir la ficha de ${w.firstName} ${w.lastName}`}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <PersonAvatar
                        firstName={w.firstName}
                        lastName={w.lastName}
                        avatarUrl={w.avatarUrl}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {w.firstName} {w.lastName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {w.isFieldWorker ? 'Trabajador de faena · sin cuenta' : w.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{w.cargo ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {w.turno ?? <span className="italic">Sin cargar</span>}
                  </td>
                  <td className="px-3 py-2">
                    {w.acreditadoEn.length === 0 ? (
                      <span className="text-xs text-muted-foreground">
                        Sin acreditaciones vigentes
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <ShieldCheck className="size-3.5 text-emerald-600" aria-hidden />
                        {w.acreditadoEn.join(', ')}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {w.vencidos === 0 && w.porVencer === 0 ? (
                      <span className="text-xs text-muted-foreground">Nada por vencer</span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-xs">
                        {w.vencidos > 0 && (
                          <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300">
                            <AlertTriangle className="size-3.5" aria-hidden />
                            {w.vencidos} vencido{w.vencidos === 1 ? '' : 's'}
                          </span>
                        )}
                        {w.porVencer > 0 && (
                          <span className="font-medium text-amber-700 dark:text-amber-300">
                            {w.porVencer} por vencer
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
