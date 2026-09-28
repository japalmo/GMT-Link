import type { ReactNode } from 'react';

/**
 * Avance del formulario: "Paso X de N" y una barrita por paso.
 *
 * Es el mismo marcado que estaba en línea dentro del reporte de incidentes. Va
 * aparte porque el checklist de vehículos muestra el mismo indicador y porque
 * así el `role="progressbar"` y sus `aria-value*` quedan en un solo lugar.
 *
 * `paso` es un índice basado en cero; lo que se muestra es `paso + 1`.
 */
export function BarraPasos({ paso, total }: { paso: number; total: number }): ReactNode {
  return (
    <div
      className="flex gap-1.5"
      role="progressbar"
      aria-valuenow={paso + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label="Avance del formulario"
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
            i <= paso ? 'bg-primary' : 'bg-muted'
          }`}
        />
      ))}
    </div>
  );
}
