import { useId, useRef, useState, type ReactNode } from 'react';
import { FileUp, Paperclip, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Tamaño máximo por defecto para subidas (10 MB). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** MIME types y extensiones aceptadas para CV/diplomas (solo PDF). */
export const PDF_ACCEPT = 'application/pdf';

/** MIME types aceptados para documentos personales (PDF o imagen). */
export const DOC_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

/**
 * Valida un archivo contra una lista de MIME types aceptados y un tamaño máximo.
 * Devuelve un mensaje de error legible o `null` si es válido. La validación de
 * tipo es además aplicada por el backend; esto es defensa en cliente.
 */
export function validateFile(
  file: File,
  accept: string,
  maxBytes: number = MAX_FILE_BYTES,
): string | null {
  const allowed = accept.split(',').map((t) => t.trim());
  if (allowed.length > 0 && !allowed.includes(file.type)) {
    const human = accept.includes('image')
      ? 'PDF o imagen (PNG, JPG o WebP)'
      : 'PDF';
    return `El archivo debe ser ${human}.`;
  }
  if (file.size > maxBytes) {
    return `El archivo supera el máximo de ${formatBytes(maxBytes)}.`;
  }
  return null;
}

/**
 * Campo de selección de archivo accesible con validación en cliente. Muestra el
 * archivo elegido con su tamaño y permite quitarlo. El `<input type="file">`
 * real queda oculto pero asociado al `Label`; el botón visible lo dispara.
 */
export function FileField({
  label,
  accept,
  maxBytes = MAX_FILE_BYTES,
  value,
  onChange,
  disabled = false,
  hint,
}: {
  label: string;
  accept: string;
  maxBytes?: number;
  value: File | null;
  onChange: (file: File | null, error: string | null) => void;
  disabled?: boolean;
  /** Texto de ayuda adicional bajo el campo. */
  hint?: string;
}): ReactNode {
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: FileList | null): void {
    const file = files?.[0] ?? null;
    if (!file) {
      setError(null);
      onChange(null, null);
      return;
    }
    const validationError = validateFile(file, accept, maxBytes);
    setError(validationError);
    onChange(validationError ? null : file, validationError);
  }

  function clear(): void {
    setError(null);
    onChange(null, null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={inputId}>{label}</Label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp aria-hidden />
          {value ? 'Cambiar archivo' : 'Elegir archivo'}
        </Button>
        {value && (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            <Paperclip className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{value.name}</span>
            <span className="shrink-0">({formatBytes(value.size)})</span>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              aria-label="Quitar archivo"
              className="rounded p-0.5 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" aria-hidden />
            </button>
          </span>
        )}
      </div>
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className={cn('text-xs text-destructive')}>
          {error}
        </p>
      )}
    </div>
  );
}
