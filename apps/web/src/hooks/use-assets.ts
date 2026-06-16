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

export interface UseAssetsResult {
  assets: AssetView[];
  loading: boolean;
  error: string | null;
  refetch: (filters?: { type?: AssetType; status?: AssetStatus; projectId?: string }) => Promise<void>;
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
  getPublic: (code: string) => Promise<AssetPublicView>;
  listAccessories: (id: string) => Promise<AssetAccessoryView[]>;
  addAccessory: (id: string, input: CreateAccessoryInput) => Promise<AssetAccessoryView>;
  updateAccessory: (id: string, accId: string, input: UpdateAccessoryInput) => Promise<AssetAccessoryView>;
  deleteAccessory: (id: string, accId: string) => Promise<void>;
  getTemplate: (id: string) => Promise<ChecklistTemplateView>;
  updateTemplate: (id: string, input: UpdateChecklistTemplateInput) => Promise<ChecklistTemplateView>;
  reviewTemplate: (id: string, input: ReviewChecklistTemplateInput) => Promise<ChecklistTemplateView>;
  submitChecklistAnswers: (id: string, input: SubmitChecklistInput) => Promise<ChecklistSubmissionView>;
  listSubmissions: (id: string) => Promise<ChecklistSubmissionView[]>;
  submitTelemetryAnswers: (id: string, input: SubmitTelemetryInput) => Promise<AssetView>;
}

export function useAssets(): UseAssetsResult {
  const [assets, setAssets] = useState<AssetView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async (filters?: { type?: AssetType; status?: AssetStatus; projectId?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const list = await listAssets(filters);
      if (mountedRef.current) setAssets(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar los activos.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async (input: CreateAssetInput) => {
    const asset = await createAsset(input);
    void load();
    return asset;
  }, [load]);

  const updateStatus = useCallback(async (id: string, status: AssetStatus, description?: string) => {
    const asset = await updateAssetStatus(id, status, description);
    void load();
    return asset;
  }, [load]);

  const assign = useCallback(async (id: string, assignedToId: string | null) => {
    const asset = await assignAsset(id, assignedToId);
    void load();
    return asset;
  }, [load]);

  const takeUse = useCallback(async (id: string) => {
    const asset = await takeAssetUse(id);
    void load();
    return asset;
  }, [load]);

  const releaseUse = useCallback(async (id: string) => {
    const asset = await releaseAssetUse(id);
    void load();
    return asset;
  }, [load]);

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

  const getPublic = useCallback(async (code: string) => {
    const asset = await getPublicAsset(code);
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

  const submitTelemetryAnswers = useCallback(async (id: string, input: SubmitTelemetryInput) => {
    const data = await submitTelemetry(id, input);
    return data;
  }, []);

  return {
    assets,
    loading,
    error,
    refetch: load,
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
    submitTelemetryAnswers,
  };
}
