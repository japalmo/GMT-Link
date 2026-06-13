import { Loader2 } from 'lucide-react';

/** Estado de carga global (mientras se resuelve la sesión). */
export function FullPageLoader({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-dvh items-center justify-center bg-background text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="ml-2 text-sm">{label}</span>
    </div>
  );
}
