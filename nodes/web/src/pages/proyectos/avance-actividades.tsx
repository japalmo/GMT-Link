import { Fragment, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { AvanceObraEditable } from '@gmt-platform/contracts';
import { aTexto, CeldaEditable } from '@/components/ui/celda-editable';
import { editarAvanceActividad, errorToMessage } from '@/lib/api';
import {
  acumuladoAl,
  aFraccion,
  aPorcentaje,
  fechaCorta,
  formatoPct,
  porFase,
  ponderado,
} from './avance-comun';

/**
 * La FUENTE del informe: el acumulado de cada actividad en cada semana.
 *
 * El total al pie es el número que llega al informe y al tablero. Se muestra
 * una columna más que las ya informadas, vacía, para cargar el corte que viene.
 */
export function AvanceActividades({
  projectId,
  datos,
  onCambio,
}: {
  projectId: string;
  datos: AvanceObraEditable;
  /** Se llama después de guardar: el recálculo mueve las semanas. */
  onCambio: () => Promise<void>;
}): ReactNode {
  const { actividades, semanas, puedeEditar } = datos;
  const fases = porFase(actividades);
  // Orden de pantalla, para que el pegado sepa qué actividad va en cada fila.
  const filas = fases.flatMap((f) => f.actividades);

  const informadas = Math.max(0, ...actividades.map((a) => a.realByWeek.length));
  // Una columna extra para el próximo corte, sin pasarse del programa (S-0 no
  // lleva columna: es el arranque).
  const columnas = Math.min(Math.max(0, semanas.length - 1), informadas + (puedeEditar ? 1 : 0));
  const indices = Array.from({ length: columnas }, (_, w) => w);
  const semanaDe = (w: number) => semanas.find((s) => s.index === w + 1);

  async function guardar(wbsId: number, semana: number, porcentaje: number): Promise<void> {
    await editarAvanceActividad(projectId, { wbsId, semana, valor: aFraccion(porcentaje) });
    await onCambio();
  }

  async function pegar(desde: number, semana: number, valores: number[]): Promise<void> {
    const destino = valores
      .map((v, i) => ({ actividad: filas[desde + i], v }))
      .filter((x): x is { actividad: NonNullable<typeof x.actividad>; v: number } => !!x.actividad);
    // Uno por uno y no en paralelo: cada guardado dispara un recálculo de todo
    // el proyecto, y 38 en paralelo se pisarían entre sí.
    let hechos = 0;
    try {
      for (const { actividad, v } of destino) {
        await editarAvanceActividad(projectId, {
          wbsId: actividad.wbsId,
          semana,
          valor: aFraccion(v),
        });
        hechos += 1;
      }
      toast.success(`Se pegaron ${hechos} valores.`);
    } catch (e) {
      toast.error(`Se pegaron ${hechos} de ${destino.length}. ${errorToMessage(e, 'Falló el resto.')}`);
    } finally {
      await onCambio();
    }
  }

  if (actividades.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este proyecto no tiene programa de actividades cargado.
      </p>
    );
  }

  let fila = -1;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] border-collapse text-[13px]">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-10 bg-muted px-3 py-2 font-medium">Actividad</th>
            <th className="px-2 py-2 text-right font-medium">HH</th>
            {indices.map((w) => {
              const s = semanaDe(w);
              const nueva = w >= informadas;
              return (
                <th key={w} className="w-20 px-1 py-2 text-right font-medium">
                  <span className={nueva ? 'text-primary' : 'text-foreground'}>{s?.code ?? `S-${w + 1}`}</span>
                  <span className="block text-[11px] font-normal">
                    {nueva ? 'nuevo corte' : s ? fechaCorta(s.closeDate) : ''}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {fases.map(({ fase, actividades: grupo }) => (
            <Fragment key={fase}>
              <tr className="border-t border-border bg-muted/30">
                <th
                  colSpan={2 + indices.length}
                  className="sticky left-0 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {fase}
                </th>
              </tr>
              {grupo.map((a) => {
                fila += 1;
                const f = fila;
                const hito = a.hh <= 0;
                return (
                  <tr key={a.wbsId} className="border-t border-border/60">
                    <td className="sticky left-0 z-10 max-w-[18rem] bg-card px-3 py-1">
                      <span className="line-clamp-2">{a.name}</span>
                      {hito && <span className="text-[11px] text-muted-foreground">Hito · no pesa</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                      {hito ? '—' : a.hh.toLocaleString('es-CL', { maximumFractionDigits: 0 })}
                    </td>
                    {indices.map((w) => {
                      const informado = w < a.realByWeek.length;
                      return (
                        <td key={w} className="px-0.5 py-0.5">
                          <CeldaEditable
                            grupo="actividades"
                            fila={f}
                            columna={w}
                            valor={informado ? aPorcentaje(a.realByWeek[w]) : null}
                            // Sin dato, la semana vale lo último informado: se
                            // muestra en gris para que se vea qué se arrastra.
                            marcador={
                              a.realByWeek.length > 0
                                ? aTexto(acumuladoAl(a.realByWeek, w) * 100)
                                : '—'
                            }
                            soloLectura={!puedeEditar}
                            aria-label={`${a.name}, ${semanaDe(w)?.code ?? ''}, % acumulado`}
                            onGuardar={(v) => guardar(a.wbsId, w, v)}
                            onPegarColumna={(desde, col, valores) => void pegar(desde, col, valores)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              <tr className="border-t border-border text-xs text-muted-foreground">
                <td className="sticky left-0 z-10 bg-card px-3 py-1.5 font-medium">Avance {fase}</td>
                <td />
                {indices.map((w) => (
                  <td key={w} className="px-2 py-1.5 text-right tabular-nums">
                    {formatoPct(aPorcentaje(ponderado(grupo, w)))}
                  </td>
                ))}
              </tr>
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/40 font-semibold">
            <td className="sticky left-0 z-10 bg-muted px-3 py-2">Total del proyecto</td>
            <td className="px-2 py-2 text-right tabular-nums">
              {actividades
                .reduce((s, a) => s + Math.max(0, a.hh), 0)
                .toLocaleString('es-CL', { maximumFractionDigits: 0 })}
            </td>
            {indices.map((w) => (
              // El total es el calculado que devuelve el SERVIDOR, no uno
              // recalculado acá: es el número que va al informe.
              <td key={w} className="px-2 py-2 text-right tabular-nums">
                {formatoPct(aPorcentaje(semanaDe(w)?.acmRealCalculado))}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
