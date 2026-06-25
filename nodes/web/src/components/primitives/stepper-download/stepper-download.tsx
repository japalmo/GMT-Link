import type { ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface StepOption {
  value: number | 'all';
  label: string;
  description: string;
}

const DEFAULT_OPTIONS: ReadonlyArray<StepOption> = [
  { value: 1, label: 'Última', description: '1 mes' },
  { value: 3, label: '3 Meses', description: 'Trimestral' },
  { value: 6, label: '6 Meses', description: 'Semestral' },
  { value: 12, label: '12 Meses', description: 'Anual' },
  { value: 'all', label: 'Todas', description: 'Histórico' },
];

interface StepperDownloadProps {
  /** Valor seleccionado actualmente (número de periodos o 'all'). */
  value: number | 'all';
  /** Disparador al seleccionar una opción. */
  onChange: (val: number | 'all') => void;
  /** Callback al hacer clic en el botón de descarga. */
  onDownload: () => void;
  /** Estado de descarga activa (muestra spinner). */
  downloading?: boolean;
  /** Opciones de la barra de pasos (opcional). */
  options?: ReadonlyArray<StepOption>;
  /** Si está deshabilitado. */
  disabled?: boolean;
}

/**
 * StepperDownload — primitiva genérica (§5).
 *
 * Barra de pasos adaptativa horizontal con nodos interactivos y un conector visual.
 * Permite al usuario ajustar la densidad del lote a descargar de manera ágil.
 * Diseñado con variables HSL para integrarse con el modo oscuro y animaciones fluidas.
 */
export function StepperDownload({
  value,
  onChange,
  onDownload,
  downloading = false,
  options = DEFAULT_OPTIONS,
  disabled = false,
}: StepperDownloadProps): ReactNode {
  const selectedIdx = options.findIndex((o) => o.value === value);

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-card/65 p-6 shadow-xs backdrop-blur-xs">
      <div className="flex flex-col gap-1.5">
        <h4 className="text-sm font-semibold tracking-tight text-foreground">Descargar lote de liquidaciones</h4>
        <p className="text-xs text-muted-foreground">
          Selecciona el rango de tiempo deseado en la barra y haz clic en descargar.
        </p>
      </div>

      <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
        {/* Stepper track */}
        <div className="relative flex flex-1 items-center justify-between px-2 py-4">
          {/* Connector Line Background */}
          <div className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 bg-muted dark:bg-muted/40" />

          {/* Active Connector Progress */}
          <div
            className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 bg-primary transition-all duration-300 ease-in-out"
            style={{
              width: `${(selectedIdx / (options.length - 1)) * 100}%`,
            }}
          />

          {/* Step Nodes */}
          {options.map((opt, idx) => {
            const isCompletedOrActive = idx <= selectedIdx;
            const isActive = idx === selectedIdx;

            return (
              <button
                key={String(opt.value)}
                type="button"
                disabled={disabled || downloading}
                onClick={() => onChange(opt.value)}
                className="group relative z-10 flex flex-col items-center outline-none focus-visible:ring-0"
              >
                {/* Node circle */}
                <div
                  className={`flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-all duration-300 ${
                    isActive
                      ? 'border-primary bg-primary text-primary-foreground scale-110 shadow-md shadow-primary/20'
                      : isCompletedOrActive
                        ? 'border-primary bg-background text-primary hover:bg-primary/5'
                        : 'border-muted bg-background text-muted-foreground group-hover:border-muted-foreground group-hover:text-foreground'
                  }`}
                >
                  {idx + 1}
                </div>

                {/* Node labels */}
                <div className="absolute top-9 flex flex-col items-center whitespace-nowrap text-center">
                  <span
                    className={`text-xs font-semibold transition-colors duration-200 ${
                      isActive ? 'text-primary' : 'text-foreground group-hover:text-primary'
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{opt.description}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Action Button */}
        <div className="flex justify-end pt-8 md:pt-0 md:pl-6">
          <Button
            type="button"
            disabled={disabled || downloading}
            loading={downloading}
            onClick={onDownload}
            className="w-full md:w-auto shadow-sm"
          >
            {downloading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Generando lote...
              </>
            ) : (
              <>
                <Download className="size-4" aria-hidden />
                Descargar Lote
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
