import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  addCertification as apiAddCertification,
  addEducation as apiAddEducation,
  addExperience as apiAddExperience,
  deleteCertification as apiDeleteCertification,
  deleteEducation as apiDeleteEducation,
  deleteExperience as apiDeleteExperience,
  getCv,
  patchCv as apiPatchCv,
  updateCertification as apiUpdateCertification,
  updateEducation as apiUpdateEducation,
  updateExperience as apiUpdateExperience,
  uploadDiploma as apiUploadDiploma,
} from '@/lib/api';
import type {
  CvCertificationInput,
  CvCertificationView,
  CvEducationInput,
  CvExperienceInput,
  CvView,
} from '@/types/cv';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useCv}. */
export interface UseCvResult {
  /** CV propio cargado, o `null` mientras no haya respuesta exitosa. */
  cv: CvView | null;
  /** `true` mientras se carga / recarga el CV. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Vuelve a cargar el CV desde el backend. */
  refetch: () => Promise<void>;
  /** Actualiza el resumen. Refresca el estado local con el CV devuelto. */
  saveSummary: (summary: string) => Promise<void>;
  // Experiencia
  addExperience: (input: CvExperienceInput) => Promise<void>;
  updateExperience: (id: string, input: CvExperienceInput) => Promise<void>;
  deleteExperience: (id: string) => Promise<void>;
  // Educación
  addEducation: (input: CvEducationInput) => Promise<void>;
  updateEducation: (id: string, input: CvEducationInput) => Promise<void>;
  deleteEducation: (id: string) => Promise<void>;
  // Certificaciones (add/update devuelven la cert guardada para encadenar el diploma)
  addCertification: (input: CvCertificationInput) => Promise<CvCertificationView>;
  updateCertification: (
    id: string,
    input: CvCertificationInput,
  ) => Promise<CvCertificationView>;
  deleteCertification: (id: string) => Promise<void>;
  /** Sube el diploma PDF de una certificación y refresca el CV. */
  uploadDiploma: (id: string, file: File) => Promise<void>;
}

/**
 * Hook de datos de la página "Mi CV" (§6-1.4).
 *
 * Envuelve las funciones tipadas de `lib/api.ts` (que adjuntan el JWT de
 * sesión). Gestiona loading/error de la carga y expone `refetch`. Cada
 * mutador llama al endpoint correspondiente y refresca el CV completo para que
 * la UI quede consistente. Los errores se propagan al llamador para que cada
 * formulario muestre feedback contextual.
 */
export function useCv(): UseCvResult {
  const [cv, setCv] = useState<CvView | null>(null);
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
      const data = await getCv();
      if (mountedRef.current) setCv(data);
    } catch (err) {
      if (mountedRef.current) setError(toMessage(err, 'No se pudo cargar tu CV.'));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Recarga el CV completo tras una mutación que no devuelve el agregado. */
  const refresh = useCallback(async () => {
    const data = await getCv();
    if (mountedRef.current) setCv(data);
  }, []);

  const saveSummary = useCallback(async (summary: string) => {
    const updated = await apiPatchCv({ summary });
    if (mountedRef.current) setCv(updated);
  }, []);

  const addExperience = useCallback(
    async (input: CvExperienceInput) => {
      await apiAddExperience(input);
      await refresh();
    },
    [refresh],
  );

  const updateExperience = useCallback(
    async (id: string, input: CvExperienceInput) => {
      await apiUpdateExperience(id, input);
      await refresh();
    },
    [refresh],
  );

  const deleteExperience = useCallback(
    async (id: string) => {
      await apiDeleteExperience(id);
      await refresh();
    },
    [refresh],
  );

  const addEducation = useCallback(
    async (input: CvEducationInput) => {
      await apiAddEducation(input);
      await refresh();
    },
    [refresh],
  );

  const updateEducation = useCallback(
    async (id: string, input: CvEducationInput) => {
      await apiUpdateEducation(id, input);
      await refresh();
    },
    [refresh],
  );

  const deleteEducation = useCallback(
    async (id: string) => {
      await apiDeleteEducation(id);
      await refresh();
    },
    [refresh],
  );

  const addCertification = useCallback(
    async (input: CvCertificationInput) => {
      const saved = await apiAddCertification(input);
      await refresh();
      return saved;
    },
    [refresh],
  );

  const updateCertification = useCallback(
    async (id: string, input: CvCertificationInput) => {
      const saved = await apiUpdateCertification(id, input);
      await refresh();
      return saved;
    },
    [refresh],
  );

  const deleteCertification = useCallback(
    async (id: string) => {
      await apiDeleteCertification(id);
      await refresh();
    },
    [refresh],
  );

  const uploadDiploma = useCallback(
    async (id: string, file: File) => {
      await apiUploadDiploma(id, file);
      await refresh();
    },
    [refresh],
  );

  return {
    cv,
    loading,
    error,
    refetch: load,
    saveSummary,
    addExperience,
    updateExperience,
    deleteExperience,
    addEducation,
    updateEducation,
    deleteEducation,
    addCertification,
    updateCertification,
    deleteCertification,
    uploadDiploma,
  };
}
