import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  deleteDocument as apiDeleteDocument,
  listDocuments,
  uploadDocument as apiUploadDocument,
  uploadDocumentVersion as apiUploadDocumentVersion,
} from '@/lib/api';
import type {
  DocumentFilters,
  PersonalDocumentView,
  UploadDocumentFields,
} from '@/types/documents';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useDocuments}. */
export interface UseDocumentsResult {
  /** Documentos personales cargados, ya filtrados por el backend. */
  documents: PersonalDocumentView[];
  /** Filtros actualmente aplicados (se envían al backend). */
  filters: DocumentFilters;
  /** `true` mientras se carga / recarga la lista. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Cambia los filtros (status / por vencer) y recarga desde el backend. */
  setFilters: (filters: DocumentFilters) => void;
  /** Vuelve a cargar la lista con los filtros actuales. */
  refetch: () => Promise<void>;
  /** Sube un documento nuevo (PDF/imagen) y refresca la lista. */
  uploadDocument: (fields: UploadDocumentFields, file: File) => Promise<void>;
  /** Sube una versión nueva de un documento y refresca la lista. */
  uploadVersion: (id: string, file: File) => Promise<void>;
  /** Elimina un documento y refresca la lista. */
  deleteDocument: (id: string) => Promise<void>;
}

/**
 * Hook de datos de la página "Mis documentos" (§6-1.5).
 *
 * Envuelve las funciones tipadas de `lib/api.ts` (JWT de sesión). El
 * filtrado por estado y "por vencer" se delega al backend vía query params, de
 * modo que cambiar `filters` dispara una recarga. Las mutaciones (subir,
 * versionar, eliminar) refrescan la lista y propagan el error al llamador.
 */
export function useDocuments(): UseDocumentsResult {
  const [documents, setDocuments] = useState<PersonalDocumentView[]>([]);
  const [filters, setFiltersState] = useState<DocumentFilters>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Leemos los filtros por ref para que `load` no cambie de identidad con cada
  // cambio de filtro (evita recrear callbacks de las mutaciones).
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listDocuments(filtersRef.current);
      if (mountedRef.current) setDocuments(data);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar tus documentos.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, filters]);

  const setFilters = useCallback((next: DocumentFilters) => {
    setFiltersState(next);
  }, []);

  const uploadDocument = useCallback(
    async (fields: UploadDocumentFields, file: File) => {
      await apiUploadDocument(fields, file);
      await load();
    },
    [load],
  );

  const uploadVersion = useCallback(
    async (id: string, file: File) => {
      await apiUploadDocumentVersion(id, file);
      await load();
    },
    [load],
  );

  const deleteDocument = useCallback(
    async (id: string) => {
      await apiDeleteDocument(id);
      await load();
    },
    [load],
  );

  return {
    documents,
    filters,
    loading,
    error,
    setFilters,
    refetch: load,
    uploadDocument,
    uploadVersion,
    deleteDocument,
  };
}
