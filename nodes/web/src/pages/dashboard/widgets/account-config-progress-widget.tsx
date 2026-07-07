import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { UserCog } from 'lucide-react';
import { errorToMessage, getProfile, getCv, listDocuments } from '@/lib/api';
import { buttonVariants } from '@/components/ui/button';
import type { ProfileMe } from '@gmt-platform/contracts';
import type { CvView } from '@/types/cv';
import type { PersonalDocumentView } from '@/types/documents';
import { WidgetShell } from './widget-shell';

/** Un criterio de completitud de la cuenta: etiqueta, si está hecho, y a dónde ir. */
interface CompletionCheck {
  label: string;
  done: boolean;
}

/**
 * Deriva los criterios de completitud a partir de las tres fuentes disponibles:
 * el perfil propio (`GET /profile/me`), el CV (`GET /cv/me`) y los documentos
 * personales (`GET /documents`). El perfil no expone teléfono, así que la parte
 * de "datos de contacto" se aproxima con los campos de nombre presentes.
 */
function buildChecks(
  profile: ProfileMe,
  cv: CvView,
  documents: PersonalDocumentView[],
): CompletionCheck[] {
  const hasAvatar = Boolean(profile.avatarUrl && profile.avatarUrl.trim().length > 0);
  const hasContact =
    profile.firstName.trim().length > 0 &&
    profile.lastName.trim().length > 0 &&
    Boolean(profile.secondLastName && profile.secondLastName.trim().length > 0);
  const hasDocuments = documents.length > 0;
  const hasCv =
    Boolean(cv.summary && cv.summary.trim().length > 0) ||
    cv.experiences.length > 0 ||
    cv.education.length > 0 ||
    cv.certifications.length > 0;

  return [
    { label: 'Foto de perfil', done: hasAvatar },
    { label: 'Datos de contacto', done: hasContact },
    { label: 'Documentos personales', done: hasDocuments },
    { label: 'Hoja de vida', done: hasCv },
  ];
}

/**
 * Widget "Configuración de la cuenta" (§6-2.1). Calcula el porcentaje de
 * completitud del perfil del trabajador combinando avatar, datos de contacto,
 * documentos personales y CV, mostrando una barra de progreso, el % y un hint
 * de lo que falta con un enlace para completarlo.
 */
export function AccountConfigProgressWidget(): ReactNode {
  const [checks, setChecks] = useState<CompletionCheck[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, cv, documents] = await Promise.all([
        getProfile(),
        getCv(),
        listDocuments(),
      ]);
      if (mountedRef.current) {
        setChecks(buildChecks(profile, cv, documents));
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(errorToMessage(err, 'No se pudo calcular tu configuración.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = checks ? checks.filter((c) => c.done).length : 0;
  const total = checks ? checks.length : 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const pending = checks ? checks.filter((c) => !c.done) : [];

  return (
    <WidgetShell
      title="Configuración de la cuenta"
      description="Completitud de tu perfil"
      icon={UserCog}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-3xl font-bold tracking-tight tabular-nums">
              {pct}%
            </span>
            <span className="text-xs text-muted-foreground">
              {done} de {total}
            </span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Completitud de la cuenta"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {pending.length === 0
              ? 'Tu cuenta está completa.'
              : `Falta: ${pending.map((c) => c.label.toLowerCase()).join(', ')}.`}
          </p>
        </div>
        <Link
          to="/perfil"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {pct === 100 ? 'Ver mi perfil' : 'Completar mi perfil'}
        </Link>
      </div>
    </WidgetShell>
  );
}
