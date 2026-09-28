import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, Clock } from 'lucide-react';

/**
 * Rueda de hora para los formularios de terreno.
 *
 * El `input type="time"` del sistema obliga a escribir dígitos con el teclado o
 * a pelear con un selector diminuto. Acá hay dos columnas que se desplazan, con
 * la fila elegida marcada al centro, y un atajo "Ahora mismo" que resuelve el
 * caso más común de un tirón.
 *
 * Los minutos van de cinco en cinco: en terreno nadie declara el minuto exacto,
 * y una rueda de 60 filas se vuelve imposible de acertar con el pulgar.
 *
 * El valor viaja como texto `hh:mm` en 24 horas.
 */

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTOS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export function SelectorHora({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (v: string) => void;
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const [hh, mm] = valor.split(':');
  const colHora = useRef<HTMLDivElement>(null);
  const colMin = useRef<HTMLDivElement>(null);

  // Al abrir, cada columna muestra su valor actual: abrir en 00:00 obligaría a
  // desplazar a ciegas hasta la hora del incidente.
  useEffect(() => {
    if (!abierto) return;
    for (const col of [colHora.current, colMin.current]) {
      col?.querySelector('[data-elegido="true"]')?.scrollIntoView({ block: 'center' });
    }
  }, [abierto]);

  function ahora(): void {
    const d = new Date();
    const minuto = String(Math.round(d.getMinutes() / 5) * 5 === 60 ? 55 : Math.round(d.getMinutes() / 5) * 5).padStart(2, '0');
    onChange(`${String(d.getHours()).padStart(2, '0')}:${minuto}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left transition active:scale-[0.99]"
      >
        <Clock className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          <span className="block text-[17px] font-medium tabular-nums leading-tight">{valor}</span>
          <span className="block text-[13px] text-muted-foreground">Hora del incidente</span>
        </span>
        <ChevronRight
          className={`size-5 text-muted-foreground transition-transform ${abierto ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 duration-200 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none">
          <button
            type="button"
            onClick={() => {
              ahora();
              setAbierto(false);
            }}
            className="h-9 rounded-xl bg-muted text-[14px] font-medium transition active:scale-[0.98]"
          >
            Ahora mismo
          </button>
          <div className="relative grid grid-cols-2 gap-2">
            {/* Franja del centro: marca cuál es la fila elegida, como una rueda. */}
            <span
              className="pointer-events-none absolute inset-x-0 top-1/2 h-11 -translate-y-1/2 rounded-xl bg-primary/10"
              aria-hidden
            />
            <Columna
              ref={colHora}
              etiqueta="Hora"
              valores={HORAS}
              elegido={hh ?? '00'}
              onElegir={(v) => onChange(`${v}:${mm ?? '00'}`)}
            />
            <Columna
              ref={colMin}
              etiqueta="Minutos"
              valores={MINUTOS}
              elegido={mm ?? '00'}
              onElegir={(v) => onChange(`${hh ?? '00'}:${v}`)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Columna({
  ref,
  etiqueta,
  valores,
  elegido,
  onElegir,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  etiqueta: string;
  valores: readonly string[];
  elegido: string;
  onElegir: (v: string) => void;
}): ReactNode {
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={etiqueta}
      className="h-44 snap-y snap-mandatory overflow-y-auto scroll-py-16 py-16 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {valores.map((v) => (
        <button
          key={v}
          type="button"
          role="option"
          aria-selected={v === elegido}
          data-elegido={v === elegido}
          onClick={() => onElegir(v)}
          className={`flex h-11 w-full snap-center items-center justify-center rounded-xl text-[20px] tabular-nums transition ${
            v === elegido ? 'font-semibold text-foreground' : 'text-muted-foreground'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
