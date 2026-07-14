import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Briefcase, ExternalLink, FileText, GraduationCap, ShieldCheck } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { errorToMessage, fetchUserCv } from '@/lib/api';
import type { CvView } from '@/types/cv';

/** Fecha corta "mmm yyyy" es-CL desde un ISO; cadena vacía si null/ inválida. */
function monthYear(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-CL', { month: 'short', year: 'numeric' });
}

/** Rango "desde – hasta" (hasta = "Actualidad" si no hay fin). */
function range(start: string | null, end: string | null): string {
  const from = monthYear(start);
  const to = end ? monthYear(end) : 'Actualidad';
  if (!from && !to) return '';
  if (!from) return to;
  return `${from} – ${to}`;
}

/**
 * Pestaña CV del detalle del trabajador — SOLO LECTURA (admin). Trae el CV del
 * trabajador (`GET /users/:id/cv`) y muestra resumen, experiencia, educación y
 * certificaciones. La edición del CV sigue siendo del propio trabajador (Perfil);
 * aquí el admin solo lo revisa. Estados de carga / error / vacío siempre presentes.
 */
export function UserCvTab({ userId }: { userId: string }): ReactNode {
  const [cv, setCv] = useState<CvView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchUserCv(userId)
      .then((data) => {
        if (alive) setCv(data);
      })
      .catch((err: unknown) => {
        if (alive) setError(errorToMessage(err, 'No se pudo cargar el CV.'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => load(), [load]);

  if (loading) return <LoadingState rows={4} label="Cargando CV…" />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const isEmpty =
    !cv ||
    (!cv.summary &&
      cv.experiences.length === 0 &&
      cv.education.length === 0 &&
      cv.certifications.length === 0);

  if (isEmpty) {
    return (
      <EmptyState
        icon={FileText}
        title="Sin CV"
        message="Este trabajador todavía no ha completado su CV."
      />
    );
  }

  return (
    <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
      {cv.summary && (
        <section>
          <SectionTitle icon={FileText}>Resumen</SectionTitle>
          <p className="whitespace-pre-line text-sm text-muted-foreground">{cv.summary}</p>
        </section>
      )}

      {cv.experiences.length > 0 && (
        <section>
          <SectionTitle icon={Briefcase}>Experiencia</SectionTitle>
          <ul className="flex flex-col gap-3">
            {cv.experiences.map((e) => (
              <li key={e.id} className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
                <p className="text-sm font-medium text-foreground">{e.role}</p>
                <p className="text-sm text-muted-foreground">{e.company}</p>
                <p className="text-xs text-muted-foreground">{range(e.startDate, e.endDate)}</p>
                {e.description && (
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{e.description}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {cv.education.length > 0 && (
        <section>
          <SectionTitle icon={GraduationCap}>Educación</SectionTitle>
          <ul className="flex flex-col gap-3">
            {cv.education.map((e) => (
              <li key={e.id} className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
                <p className="text-sm font-medium text-foreground">{e.degree}</p>
                <p className="text-sm text-muted-foreground">{e.institution}</p>
                <p className="text-xs text-muted-foreground">{range(e.startDate, e.endDate)}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cv.certifications.length > 0 && (
        <section>
          <SectionTitle icon={ShieldCheck}>Certificaciones</SectionTitle>
          <ul className="flex flex-col gap-3">
            {cv.certifications.map((c) => (
              <li key={c.id} className="rounded-md border border-border bg-muted/20 px-3 py-2.5">
                <p className="text-sm font-medium text-foreground">{c.name}</p>
                {c.issuer && <p className="text-sm text-muted-foreground">{c.issuer}</p>}
                <p className="text-xs text-muted-foreground">
                  {c.issuedAt && `Emitida ${monthYear(c.issuedAt)}`}
                  {c.issuedAt && c.expiresAt && ' · '}
                  {c.expiresAt && `Vence ${monthYear(c.expiresAt)}`}
                </p>
                {c.fileUrl && (
                  <a
                    href={c.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
                  >
                    <FileText className="size-4" aria-hidden />
                    Ver diploma
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Encabezado de sección con icono. */
function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof FileText;
  children: ReactNode;
}): ReactNode {
  return (
    <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </h4>
  );
}
