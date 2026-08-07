import { type ReactNode, useMemo, useState } from 'react';

import type { UsoGranularidad, UsoPunto } from '@/types/assets';

/**
 * Gráfico de kilómetros por período, en SVG a mano.
 *
 * Sin librería de gráficos a propósito: el proyecto no tiene ninguna y este es
 * el único gráfico de la aplicación. Traer recharts (y su copia de d3) para
 * dibujar barras y una línea sería más peso de descarga que todo el módulo de
 * recursos junto.
 */

const ALTO = 220;
const ANCHO = 900;
const MARGEN = { arriba: 16, derecha: 12, abajo: 34, izquierda: 56 };

const AREA_ANCHO = ANCHO - MARGEN.izquierda - MARGEN.derecha;
const AREA_ALTO = ALTO - MARGEN.arriba - MARGEN.abajo;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Etiqueta corta del período según la agrupación. */
function etiqueta(periodo: string, granularidad: UsoGranularidad): string {
  const [anio, mes, dia] = periodo.split('-');
  const nombreMes = MESES[Number(mes) - 1] ?? '';
  if (granularidad === 'mes') return `${nombreMes} ${anio?.slice(2) ?? ''}`;
  return `${dia} ${nombreMes}`;
}

/** Etiqueta completa para el detalle al pasar el cursor. */
function etiquetaLarga(periodo: string, granularidad: UsoGranularidad): string {
  const [anio, mes, dia] = periodo.split('-');
  const nombreMes = MESES[Number(mes) - 1] ?? '';
  if (granularidad === 'mes') return `${nombreMes} de ${anio}`;
  const fecha = `${dia} de ${nombreMes} de ${anio}`;
  return granularidad === 'semana' ? `Semana del ${fecha}` : fecha;
}

/**
 * Techo del eje redondeado hacia arriba a una cifra "redonda", para que las
 * líneas de referencia caigan en números que alguien pueda leer de un vistazo.
 */
function techoDelEje(maximo: number): number {
  if (maximo <= 0) return 100;
  const magnitud = 10 ** Math.floor(Math.log10(maximo));
  for (const paso of [1, 2, 2.5, 5, 10]) {
    const techo = paso * magnitud;
    if (techo >= maximo) return techo;
  }
  return 10 * magnitud;
}

const fmt = new Intl.NumberFormat('es-CL');

export interface UsoChartProps {
  puntos: UsoPunto[];
  granularidad: UsoGranularidad;
  tipo: 'barras' | 'linea';
}

export function UsoChart({ puntos, granularidad, tipo }: UsoChartProps): ReactNode {
  const [activo, setActivo] = useState<number | null>(null);

  const { techo, coords, pasoX } = useMemo(() => {
    const maximo = Math.max(0, ...puntos.map((p) => p.km));
    const t = techoDelEje(maximo);
    const paso = puntos.length > 0 ? AREA_ANCHO / puntos.length : AREA_ANCHO;
    const c = puntos.map((p, i) => ({
      // Centro de la banda: sirve igual para el centro de la barra y para el
      // vértice de la línea, así ambos modos quedan alineados entre sí.
      x: MARGEN.izquierda + paso * i + paso / 2,
      y: MARGEN.arriba + AREA_ALTO - (p.km / t) * AREA_ALTO,
    }));
    return { techo: t, coords: c, pasoX: paso };
  }, [puntos]);

  if (puntos.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Todavía no hay kilometraje suficiente para dibujar el gráfico.
      </div>
    );
  }

  const referencias = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    valor: techo * f,
    y: MARGEN.arriba + AREA_ALTO - f * AREA_ALTO,
  }));

  // Con muchos períodos las etiquetas se pisarían: se muestra una cada N, con N
  // calculado para que nunca queden a menos de ~70px.
  const cadaCuantas = Math.max(1, Math.ceil(puntos.length / Math.floor(AREA_ANCHO / 70)));
  const anchoBarra = Math.max(2, Math.min(38, pasoX * 0.62));
  const punto = activo !== null ? puntos[activo] : undefined;
  const coord = activo !== null ? coords[activo] : undefined;

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${ANCHO} ${ALTO}`}
        className="w-full min-w-[560px]"
        role="img"
        aria-label={`Kilómetros recorridos por ${granularidad}`}
      >
        {referencias.map((r) => (
          <g key={r.y}>
            <line
              x1={MARGEN.izquierda}
              x2={ANCHO - MARGEN.derecha}
              y1={r.y}
              y2={r.y}
              className="stroke-border"
              strokeWidth={1}
              strokeDasharray={r.valor === 0 ? undefined : '3 4'}
            />
            <text
              x={MARGEN.izquierda - 8}
              y={r.y + 4}
              textAnchor="end"
              className="fill-muted-foreground text-[11px] [font-variant-numeric:tabular-nums]"
            >
              {fmt.format(Math.round(r.valor))}
            </text>
          </g>
        ))}

        {tipo === 'barras'
          ? puntos.map((p, i) => (
              <rect
                key={p.periodo}
                x={coords[i]!.x - anchoBarra / 2}
                y={coords[i]!.y}
                width={anchoBarra}
                height={Math.max(0, MARGEN.arriba + AREA_ALTO - coords[i]!.y)}
                rx={2}
                className={
                  activo === i ? 'fill-primary' : 'fill-primary/70 transition-colors'
                }
              />
            ))
          : (
            <>
              <polyline
                points={coords.map((c) => `${c.x},${c.y}`).join(' ')}
                fill="none"
                className="stroke-primary"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {coords.map((c, i) => (
                <circle
                  key={puntos[i]!.periodo}
                  cx={c.x}
                  cy={c.y}
                  r={activo === i ? 4.5 : 2.5}
                  className="fill-primary"
                />
              ))}
            </>
          )}

        {puntos.map((p, i) =>
          i % cadaCuantas === 0 ? (
            <text
              key={`et-${p.periodo}`}
              x={coords[i]!.x}
              y={ALTO - 12}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {etiqueta(p.periodo, granularidad)}
            </text>
          ) : null,
        )}

        {/* Bandas invisibles que capturan el cursor: cubren toda la altura, así
            no hay que apuntarle a una barra de dos píxeles. */}
        {puntos.map((p, i) => (
          <rect
            key={`hit-${p.periodo}`}
            x={MARGEN.izquierda + pasoX * i}
            y={MARGEN.arriba}
            width={pasoX}
            height={AREA_ALTO}
            fill="transparent"
            onMouseEnter={() => setActivo(i)}
            onMouseLeave={() => setActivo(null)}
          />
        ))}

        {coord ? (
          <line
            x1={coord.x}
            x2={coord.x}
            y1={MARGEN.arriba}
            y2={MARGEN.arriba + AREA_ALTO}
            className="stroke-primary/40"
            strokeWidth={1}
          />
        ) : null}
      </svg>

      {punto ? (
        <div
          className="pointer-events-none absolute top-2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{
            // El detalle sigue al cursor pero se frena en los bordes para no
            // salirse del gráfico en el primer y el último período.
            left: `${Math.min(88, Math.max(2, ((coord!.x - MARGEN.izquierda) / AREA_ANCHO) * 100))}%`,
          }}
        >
          <p className="font-medium text-foreground">
            {fmt.format(punto.km)} km
          </p>
          <p className="text-muted-foreground">{etiquetaLarga(punto.periodo, granularidad)}</p>
        </div>
      ) : null}
    </div>
  );
}
