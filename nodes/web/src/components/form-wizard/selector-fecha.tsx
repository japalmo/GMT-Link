import { useState, type ReactNode } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Calendario propio para los formularios de terreno.
 *
 * El `input type="date"` del sistema abre un diálogo distinto en cada teléfono,
 * con letra chica y objetivos de toque de pocos milímetros. Este está pensado
 * para el pulgar: atajos arriba, días grandes y la semana empezando en lunes.
 *
 * OJO — solo sirve para fechas PASADAS: bloquea el futuro y sus atajos son
 * "Hoy / Ayer / Antes de ayer", porque se escribió para la fecha de un
 * incidente. Un vencimiento de licencia necesita lo contrario; cuando haga
 * falta, hay que darle un rango en vez de asumir que el tope es hoy.
 *
 * El valor viaja SIEMPRE como texto `aaaa-mm-dd` y nunca como `Date`: pasar por
 * `Date` corre el día según la zona horaria del teléfono.
 */

const DIAS = ['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'] as const;
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

function iso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** aaaa-mm-dd a sus partes, sin pasar por `Date` (que corre el día por zona). */
function partes(valor: string): { anio: number; mes: number; dia: number } {
  const [a, m, d] = valor.split('-').map(Number);
  return { anio: a ?? 2026, mes: (m ?? 1) - 1, dia: d ?? 1 };
}

function hoyIso(offsetDias = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return iso(d.getFullYear(), d.getMonth(), d.getDate());
}

/** "martes 23 de septiembre". Con el día de la semana, que es como se recuerda. */
function fechaLarga(valor: string): string {
  const { anio, mes, dia } = partes(valor);
  const d = new Date(anio, mes, dia);
  const semana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return `${semana[d.getDay()]} ${dia} de ${MESES[mes]}`;
}

/** Lunes = 0. El calendario chileno empieza la semana en lunes. */
function primerDiaSemana(anio: number, mes: number): number {
  return (new Date(anio, mes, 1).getDay() + 6) % 7;
}

function diasDelMes(anio: number, mes: number): number {
  return new Date(anio, mes + 1, 0).getDate();
}

export function SelectorFecha({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (v: string) => void;
}): ReactNode {
  const [abierto, setAbierto] = useState(false);
  const [mesVisible, setMesVisible] = useState(() => {
    const { anio, mes } = partes(valor);
    return { anio, mes };
  });
  const hoy = hoyIso();

  const { anio, mes } = mesVisible;
  const huecos = primerDiaSemana(anio, mes);
  const total = diasDelMes(anio, mes);
  const esMesFuturo = iso(anio, mes, 1) > hoy;

  function elegir(dia: number): void {
    const elegido = iso(anio, mes, dia);
    if (elegido > hoy) return;
    onChange(elegido);
    setAbierto(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left transition active:scale-[0.99]"
      >
        <CalendarDays className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="flex-1">
          <span className="block text-[17px] font-medium capitalize leading-tight">
            {valor === hoy ? 'Hoy' : valor === hoyIso(-1) ? 'Ayer' : fechaLarga(valor)}
          </span>
          <span className="block text-[13px] text-muted-foreground">
            {valor === hoy || valor === hoyIso(-1) ? fechaLarga(valor) : partes(valor).anio}
          </span>
        </span>
        <ChevronRight
          className={`size-5 text-muted-foreground transition-transform ${abierto ? 'rotate-90' : ''}`}
          aria-hidden
        />
      </button>

      {abierto && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 duration-200 animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none">
          <div className="flex gap-2">
            {[
              { label: 'Hoy', v: hoy },
              { label: 'Ayer', v: hoyIso(-1) },
              { label: 'Antes de ayer', v: hoyIso(-2) },
            ].map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => {
                  onChange(a.v);
                  setMesVisible(partes(a.v));
                  setAbierto(false);
                }}
                className={`h-9 flex-1 rounded-xl text-[14px] font-medium transition active:scale-[0.97] ${
                  valor === a.v ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Mes anterior"
              onClick={() =>
                setMesVisible(mes === 0 ? { anio: anio - 1, mes: 11 } : { anio, mes: mes - 1 })
              }
              className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition active:scale-[0.95] hover:bg-muted"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>
            <span className="text-[15px] font-semibold capitalize">
              {MESES[mes]} {anio}
            </span>
            <button
              type="button"
              aria-label="Mes siguiente"
              disabled={esMesFuturo || iso(anio, mes, total) >= hoy}
              onClick={() =>
                setMesVisible(mes === 11 ? { anio: anio + 1, mes: 0 } : { anio, mes: mes + 1 })
              }
              className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition active:scale-[0.95] hover:bg-muted disabled:opacity-30"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center">
            {DIAS.map((d) => (
              <span key={d} className="pb-1 text-[11px] font-medium uppercase text-muted-foreground">
                {d}
              </span>
            ))}
            {Array.from({ length: huecos }, (_, i) => (
              <span key={`hueco-${i}`} />
            ))}
            {Array.from({ length: total }, (_, i) => i + 1).map((dia) => {
              const fecha = iso(anio, mes, dia);
              const futuro = fecha > hoy;
              const elegido = fecha === valor;
              return (
                <button
                  key={dia}
                  type="button"
                  disabled={futuro}
                  onClick={() => elegir(dia)}
                  aria-current={elegido ? 'date' : undefined}
                  className={`flex aspect-square items-center justify-center rounded-xl text-[15px] tabular-nums transition active:scale-[0.94] ${
                    elegido
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : futuro
                        ? 'text-muted-foreground/30'
                        : fecha === hoy
                          ? 'bg-muted font-semibold'
                          : 'hover:bg-muted'
                  }`}
                >
                  {dia}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
