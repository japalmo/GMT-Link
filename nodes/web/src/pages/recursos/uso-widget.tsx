import { type ReactNode, useState } from 'react';
import { AlertTriangle, BarChart3, CalendarClock, Gauge, LineChart, Loader2 } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useVehicleUsage } from '@/hooks/use-vehicle-usage';
import type { UsoGranularidad, UsoPromedios, UsoProyeccionMantencion } from '@/types/assets';
import { UsoChart } from './uso-chart';

const fmt = new Intl.NumberFormat('es-CL');
const fmt1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });

const GRANULARIDADES: ReadonlyArray<{ valor: UsoGranularidad; etiqueta: string }> = [
  { valor: 'dia', etiqueta: 'Día' },
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
];

/** Fecha ISO a formato chileno (DD/MM/AAAA). */
function fecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Grupo de botones tipo segmento, usado para los tres selectores del widget. */
function Segmentado<T extends string>({
  opciones,
  valor,
  onChange,
  etiquetaAria,
}: {
  opciones: ReadonlyArray<{ valor: T; etiqueta: string; icono?: ReactNode }>;
  valor: T;
  onChange: (v: T) => void;
  etiquetaAria: string;
}): ReactNode {
  return (
    <div className="inline-flex rounded-md border bg-muted/40 p-0.5" role="group" aria-label={etiquetaAria}>
      {opciones.map((o) => (
        <button
          key={o.valor}
          type="button"
          onClick={() => onChange(o.valor)}
          aria-pressed={valor === o.valor}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            valor === o.valor
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {o.icono}
          {o.etiqueta}
        </button>
      ))}
    </div>
  );
}

/** Una métrica destacada: número grande arriba, contexto abajo. */
function Metrica({
  icono,
  titulo,
  valor,
  detalle,
  alerta = false,
}: {
  icono: ReactNode;
  titulo: string;
  valor: string;
  detalle: ReactNode;
  alerta?: boolean;
}): ReactNode {
  return (
    <div className={`rounded-lg border p-4 ${alerta ? 'border-amber-500/50 bg-amber-500/5' : ''}`}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icono}
        {titulo}
      </div>
      <p className="mt-1.5 text-2xl font-semibold text-foreground [font-variant-numeric:tabular-nums]">
        {valor}
      </p>
      <div className="mt-1 text-xs text-muted-foreground">{detalle}</div>
    </div>
  );
}

function PromedioMetrica({ promedios }: { promedios: UsoPromedios }): ReactNode {
  const [unidad, setUnidad] = useState<'dia' | 'semana' | 'mes'>('dia');
  const km =
    unidad === 'dia'
      ? promedios.kmPorDia
      : unidad === 'semana'
        ? promedios.kmPorSemana
        : promedios.kmPorMes;
  const sufijo = unidad === 'dia' ? 'km/día' : unidad === 'semana' ? 'km/semana' : 'km/mes';

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Gauge className="size-3.5" /> Promedio de uso
        </div>
        <Segmentado
          etiquetaAria="Unidad del promedio"
          valor={unidad}
          onChange={setUnidad}
          opciones={GRANULARIDADES.map((g) => ({ valor: g.valor, etiqueta: g.etiqueta }))}
        />
      </div>
      <p className="mt-1.5 text-2xl font-semibold text-foreground [font-variant-numeric:tabular-nums]">
        {fmt1.format(Math.round(km * 10) / 10)}{' '}
        <span className="text-base font-normal text-muted-foreground">{sufijo}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {fmt.format(promedios.kmTotales)} km en {fmt.format(promedios.diasCubiertos)} días de
        registro
      </p>
    </div>
  );
}

function ProyeccionMetrica({ proyeccion }: { proyeccion: UsoProyeccionMantencion }): ReactNode {
  const estimada = new Date(proyeccion.fechaEstimada);
  const ultima = new Date(proyeccion.fechaUltimaLectura);
  const hoy = new Date();
  const vencida = estimada.getTime() < hoy.getTime();
  const diasSinLectura = Math.floor((hoy.getTime() - ultima.getTime()) / 86_400_000);
  // Una fecha pasada puede significar dos cosas muy distintas: la mantención se
  // pasó de verdad, o el vehículo lleva tiempo sin checklist y la proyección se
  // calculó desde una lectura vieja. Hay que decir cuál.
  const desactualizada = vencida && diasSinLectura > 30;

  return (
    <Metrica
      alerta={vencida}
      icono={<CalendarClock className="size-3.5" />}
      titulo={`Próxima mantención (cada ${fmt.format(proyeccion.intervaloKm)} km)`}
      valor={`${fmt.format(proyeccion.kmObjetivo)} km`}
      detalle={
        <>
          <p>
            Faltan {fmt.format(proyeccion.kmRestantes)} km desde los{' '}
            {fmt.format(proyeccion.kmActual)} km actuales.
          </p>
          <p className={vencida ? 'font-medium text-amber-600 dark:text-amber-500' : ''}>
            {desactualizada
              ? `Sin checklist hace ${fmt.format(diasSinLectura)} días: la proyección quedó vieja.`
              : `Estimada para el ${fecha(proyeccion.fechaEstimada)}.`}
          </p>
          <p className="mt-1 opacity-80">
            Última lectura el {fecha(proyeccion.fechaUltimaLectura)}.
            {proyeccion.baseEstimada
              ? ' Sin registro de la última mantención, así que el punto de partida es aproximado.'
              : ''}
          </p>
        </>
      }
    />
  );
}

export interface UsoWidgetProps {
  assetId: string;
}

/**
 * Uso del vehículo: gráfico de kilómetros por período más las métricas que se
 * derivan de él. Todo sale del odómetro que capturan los checklists.
 */
export function UsoWidget({ assetId }: UsoWidgetProps): ReactNode {
  const { datos, cargando, error, filtro, setFiltro } = useVehicleUsage(assetId);
  const [tipo, setTipo] = useState<'barras' | 'linea'>('barras');

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="size-4 text-primary" /> Uso del vehículo
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Segmentado
              etiquetaAria="Tipo de gráfico"
              valor={tipo}
              onChange={setTipo}
              opciones={[
                { valor: 'barras', etiqueta: 'Barras', icono: <BarChart3 className="size-3.5" /> },
                { valor: 'linea', etiqueta: 'Línea', icono: <LineChart className="size-3.5" /> },
              ]}
            />
            <Segmentado
              etiquetaAria="Agrupación del gráfico"
              valor={filtro.granularidad}
              onChange={(g) => setFiltro({ granularidad: g })}
              opciones={GRANULARIDADES}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
          <label className="flex items-center gap-1.5">
            Desde
            <input
              type="date"
              value={filtro.desde ?? ''}
              max={filtro.hasta ?? undefined}
              onChange={(e) => setFiltro({ desde: e.target.value || null })}
              className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5">
            Hasta
            <input
              type="date"
              value={filtro.hasta ?? ''}
              min={filtro.desde ?? undefined}
              onChange={(e) => setFiltro({ hasta: e.target.value || null })}
              className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
            />
          </label>
          {filtro.desde || filtro.hasta ? (
            <button
              type="button"
              onClick={() => setFiltro({ desde: null, hasta: null })}
              className="text-primary underline-offset-4 hover:underline"
            >
              Quitar filtro
            </button>
          ) : null}
          {cargando ? <Loader2 className="size-3.5 animate-spin" /> : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {datos ? (
          <>
            <UsoChart puntos={datos.serie} granularidad={datos.granularidad} tipo={tipo} />

            <div className="grid gap-3 md:grid-cols-2">
              {datos.promedios ? (
                <PromedioMetrica promedios={datos.promedios} />
              ) : (
                <Metrica
                  icono={<Gauge className="size-3.5" />}
                  titulo="Promedio de uso"
                  valor="Sin datos"
                  detalle="Se necesitan al menos dos checklists con kilometraje para calcularlo."
                />
              )}
              {datos.proyeccion ? (
                <ProyeccionMetrica proyeccion={datos.proyeccion} />
              ) : (
                <Metrica
                  icono={<CalendarClock className="size-3.5" />}
                  titulo="Próxima mantención"
                  valor="Sin datos"
                  detalle="No hay kilometraje suficiente para proyectar una fecha."
                />
              )}
            </div>

            {datos.descartadas.length > 0 ? <Descartadas datos={datos} /> : null}
          </>
        ) : cargando ? (
          <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Cargando el uso del vehículo…
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Lecturas de odómetro que no calzan. No es un detalle escondido: cuando son
 * muchas, el problema son los datos y no el cálculo, y quien mira la pantalla
 * tiene que saberlo antes de creerse los promedios de arriba.
 */
function Descartadas({
  datos,
}: {
  datos: { descartadas: ReadonlyArray<{ fecha: string; km: number; motivo: string; conductor: string | null }>; checklistsConsiderados: number };
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const total = datos.checklistsConsiderados;
  const n = datos.descartadas.length;
  const porcentaje = total > 0 ? Math.round((n / total) * 100) : 0;
  const grave = porcentaje >= 20;

  return (
    <div
      className={`rounded-lg border p-3 ${grave ? 'border-amber-500/50 bg-amber-500/5' : 'bg-muted/30'}`}
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-sm"
      >
        <AlertTriangle
          className={`size-4 shrink-0 ${grave ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground'}`}
        />
        <span className="flex-1">
          <span className="font-medium text-foreground">
            {n} de {total} lecturas de kilometraje no calzan
          </span>{' '}
          <span className="text-muted-foreground">
            ({porcentaje}%){' '}
            {grave
              ? '· revisa que los checklists estén cargados en el vehículo correcto'
              : '· quedaron fuera del cálculo'}
          </span>
        </span>
        <span className="text-xs text-primary">{abierto ? 'Ocultar' : 'Ver detalle'}</span>
      </button>

      {abierto ? (
        <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto text-xs">
          {datos.descartadas.map((d, i) => (
            <li key={`${d.fecha}-${d.km}-${i}`} className="rounded border bg-background p-2">
              <span className="font-medium text-foreground [font-variant-numeric:tabular-nums]">
                {fecha(d.fecha)} · {fmt.format(d.km)} km
              </span>
              {d.conductor ? (
                <span className="text-muted-foreground"> · {d.conductor}</span>
              ) : null}
              <p className="text-muted-foreground">{d.motivo}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
