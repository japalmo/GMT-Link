import { useCallback, useEffect, useRef, useState } from 'react';
import { getCv, listDocuments } from '@/lib/api';

/** Un paso del tour de onboarding (§6-1.2). */
export interface OnboardingStep {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
}

/** Estado del tour expuesto por {@link useOnboarding}. */
export interface UseOnboarding {
  steps: OnboardingStep[];
  completed: number;
  total: number;
  /** Todos los pasos cumplidos (derivado de datos reales). */
  allComplete: boolean;
  loading: boolean;
  /** Pospuesto en ESTA sesión ("Omitir" §9: no completa, solo oculta hasta el próximo ingreso). */
  dismissed: boolean;
  dismiss: () => void;
  refetch: () => Promise<void>;
}

/**
 * Clave de "pospuesto" en sessionStorage: el tour se oculta solo durante la
 * sesión actual; reaparece en el próximo ingreso mientras no se complete de
 * verdad (decisión §9 1.2: "Omitir" pospone, no marca como hecho).
 */
const DISMISS_KEY = 'gtm.onboarding.dismissed';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(DISMISS_KEY) === '1';
}

/**
 * Tour de onboarding (§6-1.2). El progreso NO se persiste en un flag: se DERIVA
 * de los datos reales del usuario (CV y documentos), de modo que "persiste hasta
 * completarse" por construcción — un paso queda hecho cuando el dato existe.
 */
export function useOnboarding(): UseOnboarding {
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cv, documents] = await Promise.all([getCv(), listDocuments()]);
      const hasCvEntries =
        cv.experiences.length > 0 || cv.education.length > 0 || cv.certifications.length > 0;
      const next: OnboardingStep[] = [
        {
          key: 'cv-summary',
          label: 'Agrega tu resumen profesional',
          description: 'Una breve descripción de tu trayectoria.',
          href: '/perfil/cv',
          done: (cv.summary ?? '').trim().length > 0,
        },
        {
          key: 'cv-entries',
          label: 'Registra experiencia, formación o certificaciones',
          description: 'Suma al menos un ítem a tu CV.',
          href: '/perfil/cv',
          done: hasCvEntries,
        },
        {
          key: 'first-document',
          label: 'Sube tu primer documento',
          description: 'Carga un documento personal (contrato, certificado, etc.).',
          href: '/perfil/documentos',
          done: documents.length > 0,
        },
      ];
      if (mountedRef.current) setSteps(next);
    } catch {
      // Sin datos (o error de red): no mostramos el tour para no estorbar.
      if (mountedRef.current) setSteps([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(DISMISS_KEY, '1');
    }
    setDismissed(true);
  }, []);

  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;

  return {
    steps,
    completed,
    total,
    allComplete: total > 0 && completed === total,
    loading,
    dismissed,
    dismiss,
    refetch: load,
  };
}
