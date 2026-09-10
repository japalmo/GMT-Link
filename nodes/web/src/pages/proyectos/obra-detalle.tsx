import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SearchInput } from '@/components/ui/search-input';
import type { ObraActivityLine, ObraDashboard, ObraLine } from '@gmt-platform/contracts';

/**
 * Detalle navegable del avance: fase → actividad → etapa. Es la mitad de abajo
 * de la pestaña dentro de la plataforma, la que el tablero de faena no muestra
 * porque en una TV nadie va a leer 63 cercos con sus 7 etapas cada uno.
 */

function cantidad(n: number): string {
  return n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
}

export function ObraDetalle({ data }: { data: ObraDashboard }): ReactNode {
  const [busqueda, setBusqueda] = useState('');

  const fases = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return data.phases;
    return data.phases
      .map((f) => ({
        ...f,
        activities: f.activities.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            a.steps.some((s) => s.name.toLowerCase().includes(q)),
        ),
      }))
      .filter((f) => f.activities.length > 0);
  }, [data.phases, busqueda]);

  const totalActividades = data.phases.reduce((s, f) => s + f.activities.length, 0);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">Detalle por fase y actividad</CardTitle>
        <SearchInput
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar un cerco, sector o etapa…"
          className="sm:max-w-72"
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {fases.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Search className="size-4" aria-hidden />
            Ninguna actividad coincide con «{busqueda}».
          </p>
        ) : (
          fases.map((fase) => (
            <Fase
              key={fase.id}
              nombre={fase.name}
              porcentaje={fase.percent}
              actividades={fase.activities}
              // Con búsqueda activa se abre todo: si no, el resultado queda escondido.
              abiertaPorDefecto={busqueda.trim().length > 0 || totalActividades <= 12}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Fase({
  nombre,
  porcentaje,
  actividades,
  abiertaPorDefecto,
}: {
  nombre: string;
  porcentaje: number;
  actividades: ObraActivityLine[];
  abiertaPorDefecto: boolean;
}): ReactNode {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);
  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <Flecha abierta={abierta} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate text-sm font-semibold">{nombre}</span>
            <span className="shrink-0 text-sm font-bold tabular-nums">
              {porcentaje.toLocaleString('es-CL')}%
            </span>
          </div>
          <Barra percent={porcentaje} />
          <p className="mt-1 text-xs text-muted-foreground">
            {actividades.length} {actividades.length === 1 ? 'actividad' : 'actividades'}
          </p>
        </div>
      </button>

      {abierta && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {actividades.map((a) => (
            <Actividad key={a.id} actividad={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Actividad({ actividad }: { actividad: ObraActivityLine }): ReactNode {
  const [abierta, setAbierta] = useState(false);
  const tieneEtapas = actividad.steps.length > 0;

  const resumen = tieneEtapas
    ? `${actividad.stepsDone} de ${actividad.stepsTotal} etapas`
    : `${cantidad(actividad.quantityDone)} / ${cantidad(actividad.quantityTotal)}${
        actividad.unit ? ` ${actividad.unit}` : ''
      }`;

  const fila = (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm">{actividad.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{resumen}</span>
        <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">
          {actividad.percent.toLocaleString('es-CL')}%
        </span>
      </div>
      <Barra percent={actividad.percent} delgada />
    </div>
  );

  if (!tieneEtapas) {
    return <li className="flex items-center gap-3 px-3 py-2.5 pl-10">{fila}</li>;
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-3 px-3 py-2.5 pl-6 text-left transition-colors hover:bg-muted/40"
      >
        <Flecha abierta={abierta} />
        {fila}
      </button>
      {abierta && (
        <ul className="flex flex-col gap-2 bg-muted/30 px-3 py-3 pl-14">
          {actividad.steps.map((e) => (
            <Etapa key={e.id} etapa={e} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Etapa({ etapa }: { etapa: ObraLine }): ReactNode {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{etapa.name}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {cantidad(etapa.quantityDone)} / {cantidad(etapa.quantityTotal)}
          {etapa.unit ? ` ${etapa.unit}` : ''}
        </span>
        <span className="w-12 shrink-0 text-right font-semibold tabular-nums">
          {etapa.percent.toLocaleString('es-CL')}%
        </span>
      </div>
      <Barra percent={etapa.percent} delgada />
    </li>
  );
}

function Flecha({ abierta }: { abierta: boolean }): ReactNode {
  return (
    <ChevronDown
      className={`size-4 shrink-0 text-muted-foreground transition-transform ${
        abierta ? '' : '-rotate-90'
      }`}
      aria-hidden
    />
  );
}

function Barra({ percent, delgada = false }: { percent: number; delgada?: boolean }): ReactNode {
  return (
    <div
      className={`mt-1.5 w-full overflow-hidden rounded-full bg-muted ${delgada ? 'h-1' : 'h-2'}`}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}
