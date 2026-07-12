import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Un estado del carrusel (una "cara" de la card). */
export interface CarouselState {
  /** Título del estado (p. ej. "Reembolsos por trabajador"). */
  title: string;
  /** Contenido renderizado (ranking, lista, número). */
  content: ReactNode;
}

export interface StatCarouselProps {
  /** Estados a alternar (típicamente 2). */
  states: CarouselState[];
  /** Intervalo de autoalternado en ms (default 5000). */
  intervalMs?: number;
  className?: string;
}

/**
 * Card de 2 (o N) estados que autoalterna cada `intervalMs` (§5.2). Un clic (o
 * Enter/Espacio con foco) en la card **congela** el estado actual; las flechas y
 * los puntitos permiten navegar manualmente. Las flechas aparecen en hover, al
 * tabular dentro de la card (focus-within) y siempre en pantallas táctiles
 * (pointer:coarse). Cuando está congelada, el autoalternado se detiene.
 */
export function StatCarousel({
  states,
  intervalMs = 5000,
  className,
}: StatCarouselProps): ReactNode {
  const [index, setIndex] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const count = states.length;

  useEffect(() => {
    if (frozen || count <= 1) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [frozen, count, intervalMs]);

  const go = (next: number, e: React.MouseEvent): void => {
    e.stopPropagation();
    setFrozen(true);
    setIndex((next + count) % count);
  };

  const current = states[index];
  if (!current) return null;

  return (
    <Card
      className={cn('group relative flex flex-col gap-3 p-5 cursor-pointer select-none', className)}
      onClick={() => setFrozen((f) => !f)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setFrozen((f) => !f);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`${current.title}. Clic para ${frozen ? 'reanudar' : 'congelar'} el carrusel.`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground">{current.title}</p>
        {count > 1 && (
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(pointer:coarse)]:opacity-100">
            <button
              type="button"
              aria-label="Anterior"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => go(index - 1, e)}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Siguiente"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={(e) => go(index + 1, e)}
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div className="min-h-16">{current.content}</div>

      {count > 1 && (
        <div className="flex items-center justify-center gap-1.5">
          {states.map((s, i) => (
            <span
              key={s.title}
              className={cn(
                'size-1.5 rounded-full transition-colors',
                i === index ? 'bg-primary' : 'bg-muted-foreground/30',
              )}
              aria-hidden
            />
          ))}
        </div>
      )}
    </Card>
  );
}
