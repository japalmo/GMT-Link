import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  listAssets,
  createAsset,
  getAsset,
  getPublicAsset,
  updateAssetStatus,
  assignAsset,
  takeAssetUse,
  releaseAssetUse,
  uploadAssetDocument,
  listAssetDocuments,
  reviewAssetDocument,
  getAssetHistory,
  listAssetAccessories,
  addAssetAccessory,
  updateAssetAccessory,
  removeAssetAccessory,
  getChecklistTemplate,
  updateChecklistTemplate,
  reviewChecklistTemplate,
  submitChecklist,
  listChecklistSubmissions,
  downloadChecklistPdf,
  submitTelemetry,
} from '@/lib/api';
import type {
  AssetView,
  AssetPublicView,
  AssetDocumentView,
  AssetHistoryEntryView,
  AssetType,
  AssetStatus,
  CreateAssetInput,
  ReviewAssetDocInput,
  AssetAccessoryView,
  ChecklistTemplateView,
  ChecklistSubmissionView,
  CreateAccessoryInput,
  UpdateAccessoryInput,
  UpdateChecklistTemplateInput,
  ReviewChecklistTemplateInput,
  SubmitChecklistInput,
  SubmitTelemetryInput,
} from '@/types/assets';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Filtros estructurales de la lista (se aplican server-side, reinician a página 1). */
export interface AssetListFilters {
  type?: AssetType;
  status?: AssetStatus;
  projectId?: string;
}

export interface UseAssetsResult {
  /** Items de las páginas ya cargadas (página 1 + los `loadMore` acumulados). */
  items: AssetView[];
  /** Carga de la página 1 (cambio de filtros/búsqueda). */
  loading: boolean;
  /** Carga de una página siguiente vía `loadMore` (no bloquea la lista visible). */
  loadingMore: boolean;
  error: string | null;
  /** ¿Hay más páginas? (nextCursor != null). */
  hasMore: boolean;
  /** Carga y agrega la siguiente página al final de `items`. */
  loadMore: () => Promise<void>;
  /** Fija el término de búsqueda (debounce ~300ms) y reinicia a la página 1. */
  setSearch: (term: string) => void;
  /** Fija los filtros type/status/projectId y reinicia a la página 1. */
  setFilters: (filters: AssetListFilters) => void;
  create: (input: CreateAssetInput) => Promise<AssetView>;
  updateStatus: (id: string, status: AssetStatus, description?: string) => Promise<AssetView>;
  assign: (id: string, assignedToId: string | null) => Promise<AssetView>;
  takeUse: (id: string) => Promise<AssetView>;
  releaseUse: (id: string) => Promise<AssetView>;
  uploadDoc: (id: string, name: string, type: string, file: File, expirationDate?: string) => Promise<AssetDocumentView>;
  listDocs: (id: string) => Promise<AssetDocumentView[]>;
  reviewDoc: (id: string, docId: string, input: ReviewAssetDocInput) => Promise<AssetDocumentView>;
  getHistory: (id: string) => Promise<AssetHistoryEntryView[]>;
  getById: (id: string) => Promise<AssetView>;
  getPublic: (token: string) => Promise<AssetPublicView>;
  listAccessories: (id: string) => Promise<AssetAccessoryView[]>;
  addAccessory: (id: string, input: CreateAccessoryInput) => Promise<AssetAccessoryView>;
  updateAccessory: (id: string, accId: string, input: UpdateAccessoryInput) => Promise<AssetAccessoryView>;
  deleteAccessory: (id: string, accId: string) => Promise<void>;
  getTemplate: (id: string) => Promise<ChecklistTemplateView>;
  updateTemplate: (id: string, input: UpdateChecklistTemplateInput) => Promise<ChecklistTemplateView>;
  reviewTemplate: (id: string, input: ReviewChecklistTemplateInput) => Promise<ChecklistTemplateView>;
  submitChecklistAnswers: (id: string, input: SubmitChecklistInput) => Promise<ChecklistSubmissionView>;
  listSubmissions: (id: string) => Promise<ChecklistSubmissionView[]>;
  getSubmissionPdf: (id: string, submissionId: string) => Promise<Blob>;
  submitTelemetryAnswers: (id: string, input: SubmitTelemetryInput) => Promise<AssetView>;
}

export function useAssets(): UseAssetsResult {
  const [items, setItems] = useState<AssetView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros estructurales y término de búsqueda (con debounce). Al cambiar
  // cualquiera se recarga la página 1.
  const [filters, setFiltersState] = useState<AssetListFilters>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Generación de carga: cada recarga de página 1 la incrementa. `loadMore`
  // captura la generación vigente y descarta su respuesta si los filtros/búsqueda
  // cambiaron mientras estaba en vuelo (evita mezclar páginas de consultas
  // distintas).
  const genRef = useRef(0);

  // Debounce de la búsqueda (~300ms).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Carga la página 1 cada vez que cambian los filtros o el término debounced.
  const loadFirstPage = useCallback(async () => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listAssets({
        ...filters,
        search: debouncedSearch || undefined,
      });
      if (!mountedRef.current || genRef.current !== gen) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar los activos.'));
      }
    } finally {
      if (mountedRef.current && genRef.current === gen) setLoading(false);
    }
  }, [filters, debouncedSearch]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // Carga la siguiente página (keyset con el cursor vigente) y la agrega al final.
  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    const gen = genRef.current;
    setLoadingMore(true);
    try {
      const page = await listAssets({
        ...filters,
        search: debouncedSearch || undefined,
        cursor: nextCursor,
      });
      // Si mientras tanto cambió la consulta (página 1 recargada), descartamos.
      if (!mountedRef.current || genRef.current !== gen) return;
      setItems((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      if (mountedRef.current && genRef.current === gen) {
        setError(toMessage(err, 'No se pudieron cargar más activos.'));
      }
    } finally {
      if (mountedRef.current && genRef.current === gen) setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, filters, debouncedSearch]);

  const setSearch = useCallback((term: string) => {
    setSearchTerm(term);
  }, []);

  const setFilters = useCallback((next: AssetListFilters) => {
    setFiltersState(next);
  }, []);

  // Reemplaza (o inserta) un activo en el estado local sin refetch total.
  const upsertAsset = useCallback((asset: AssetView) => {
    if (!mountedRef.current) return;
    setItems((prev) => {
      const idx = prev.findIndex((a) => a.id === asset.id);
      if (idx === -1) return [asset, ...prev];
      const next = prev.slice();
      next[idx] = asset;
      return next;
    });
  }, []);

  const create = useCallback(async (input: CreateAssetInput) => {
    const asset = await createAsset(input);
    // Recarga la página 1: el nuevo activo aparece en su orden real (code asc) y
    // respetando los filtros vigentes (p. ej. no se cuela un tipo que no toca).
    void loadFirstPage();
    return asset;
  }, [loadFirstPage]);

  const updateStatus = useCallback(async (id: string, status: AssetStatus, description?: string) => {
    let previous: AssetView[] = [];
    if (mountedRef.current) {
      setItems((prev) => {
        previous = prev;
        return prev.map((a) => (a.id === id ? { ...a, status } : a));
      });
    }
    try {
      const asset = await updateAssetStatus(id, status, description);
      upsertAsset(asset);
      return asset;
    } catch (err) {
      if (mountedRef.current) setItems(previous);
      throw err;
    }
  }, [upsertAsset]);

  const assign = useCallback(async (id: string, assignedToId: string | null) => {
    let previous: AssetView[] = [];
    if (mountedRef.current) {
      setItems((prev) => {
        previous = prev;
        return prev.map((a) => (a.id === id ? { ...a, assignedToId } : a));
      });
    }
    try {
      const asset = await assignAsset(id, assignedToId);
      upsertAsset(asset);
      return asset;
    } catch (err) {
      if (mountedRef.current) setItems(previous);
      throw err;
    }
  }, [upsertAsset]);

  const takeUse = useCallback(async (id: string) => {
    let previous: AssetView[] = [];
    if (mountedRef.current) {
      setItems((prev) => {
        previous = prev;
        return prev;
      });
    }
    try {
      const asset = await takeAssetUse(id);
      upsertAsset(asset);
      return asset;
    } catch (err) {
      if (mountedRef.current) setItems(previous);
      throw err;
    }
  }, [upsertAsset]);

  const releaseUse = useCallback(async (id: string) => {
    let previous: AssetView[] = [];
    if (mountedRef.current) {
      setItems((prev) => {
        previous = prev;
        return prev;
      });
    }
    try {
      const asset = await releaseAssetUse(id);
      upsertAsset(asset);
      return asset;
    } catch (err) {
      if (mountedRef.current) setItems(previous);
      throw err;
    }
  }, [upsertAsset]);

  const uploadDoc = useCallback(async (id: string, name: string, type: string, file: File, expirationDate?: string) => {
    const doc = await uploadAssetDocument(id, name, type, file, expirationDate);
    return doc;
  }, []);

  const listDocs = useCallback(async (id: string) => {
    const docs = await listAssetDocuments(id);
    return docs;
  }, []);

  const reviewDoc = useCallback(async (id: string, docId: string, input: ReviewAssetDocInput) => {
    const doc = await reviewAssetDocument(id, docId, input);
    return doc;
  }, []);

  const getHistory = useCallback(async (id: string) => {
    const history = await getAssetHistory(id);
    return history;
  }, []);

  const getById = useCallback(async (id: string) => {
    const asset = await getAsset(id);
    return asset;
  }, []);

  const getPublic = useCallback(async (token: string) => {
    const asset = await getPublicAsset(token);
    return asset;
  }, []);

  const listAccessories = useCallback(async (id: string) => {
    const data = await listAssetAccessories(id);
    return data;
  }, []);

  const addAccessory = useCallback(async (id: string, input: CreateAccessoryInput) => {
    const data = await addAssetAccessory(id, input);
    return data;
  }, []);

  const updateAccessory = useCallback(async (id: string, accId: string, input: UpdateAccessoryInput) => {
    const data = await updateAssetAccessory(id, accId, input);
    return data;
  }, []);

  const deleteAccessory = useCallback(async (id: string, accId: string) => {
    await removeAssetAccessory(id, accId);
  }, []);

  const getTemplate = useCallback(async (id: string) => {
    const data = await getChecklistTemplate(id);
    return data;
  }, []);

  const updateTemplate = useCallback(async (id: string, input: UpdateChecklistTemplateInput) => {
    const data = await updateChecklistTemplate(id, input);
    return data;
  }, []);

  const reviewTemplate = useCallback(async (id: string, input: ReviewChecklistTemplateInput) => {
    const data = await reviewChecklistTemplate(id, input);
    return data;
  }, []);

  const submitChecklistAnswers = useCallback(async (id: string, input: SubmitChecklistInput) => {
    const data = await submitChecklist(id, input);
    return data;
  }, []);

  const listSubmissions = useCallback(async (id: string) => {
    const data = await listChecklistSubmissions(id);
    return data;
  }, []);

  const getSubmissionPdf = useCallback(async (id: string, submissionId: string) => {
    const blob = await downloadChecklistPdf(id, submissionId);
    return blob;
  }, []);

  const submitTelemetryAnswers = useCallback(async (id: string, input: SubmitTelemetryInput) => {
    const data = await submitTelemetry(id, input);
    return data;
  }, []);

  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: nextCursor !== null,
    loadMore,
    setSearch,
    setFilters,
    create,
    updateStatus,
    assign,
    takeUse,
    releaseUse,
    uploadDoc,
    listDocs,
    reviewDoc,
    getHistory,
    getById,
    getPublic,
    listAccessories,
    addAccessory,
    updateAccessory,
    deleteAccessory,
    getTemplate,
    updateTemplate,
    reviewTemplate,
    submitChecklistAnswers,
    listSubmissions,
    getSubmissionPdf,
    submitTelemetryAnswers,
  };
}
