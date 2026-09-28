import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Piezas visuales de los formularios públicos por pasos.
 *
 * Salieron tal cual de `pages/public/incidente.tsx`, donde vivían como funciones
 * locales del reporte de incidentes. Ahora las comparten ese formulario y el
 * checklist de vehículos, que deben verse como el mismo producto.
 *
 * El marcado es idéntico al original a propósito: cualquier diferencia visual en
 * el reporte de incidentes después de la extracción es un error, no una mejora.
 */

/** Lienzo de pantalla completa, centrado y angosto: se llena con el pulgar. */
export function Pantalla({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-5">{children}</div>
    </div>
  );
}

/** Mensaje de error del formulario. Va con `role="alert"`: se anuncia solo. */
export function Aviso({ mensaje }: { mensaje: string }): ReactNode {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-2xl bg-destructive/10 px-4 py-3 text-[14px] text-destructive"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {mensaje}
    </p>
  );
}

/** Etiqueta + control + pista opcional. El `<label>` envuelve todo: toque grande. */
export function Campo({
  etiqueta,
  children,
  hint,
}: {
  etiqueta: string;
  children: ReactNode;
  hint?: string;
}): ReactNode {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-muted-foreground">{etiqueta}</span>
      {children}
      {hint && <span className="text-[12px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Clases del campo de texto de estos formularios.
 *
 * Los 16px del tamaño de letra NO son decorativos: por debajo de ese valor,
 * Safari en iPhone hace zoom automático al enfocar el campo y descoloca la
 * pantalla entera.
 */
export const ENTRADA =
  'h-12 w-full rounded-2xl border border-border bg-card px-4 text-[16px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15';

/** Control de opciones excluyentes, al estilo de los segmentados del teléfono. */
export function Segmentado({
  valor,
  onChange,
  opciones,
}: {
  valor: string;
  onChange: (v: string) => void;
  opciones: ReadonlyArray<{ valor: string; label: string }>;
}): ReactNode {
  return (
    <div className="flex rounded-2xl bg-muted p-1" role="group">
      {opciones.map((o) => (
        <button
          key={o.label}
          type="button"
          aria-pressed={valor === o.valor}
          onClick={() => onChange(o.valor)}
          className={`h-10 flex-1 rounded-xl text-[15px] font-medium transition ${
            valor === o.valor
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground active:scale-[0.97]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
