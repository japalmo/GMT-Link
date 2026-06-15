import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  deleteLiquidation,
  listAllLiquidations,
  listMyLiquidations,
  uploadLiquidation,
} from '@/lib/api';
import type { LiquidationView } from '@/types/finance';

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export interface UseLiquidationsResult {
  mine: LiquidationView[];
  managerItems: LiquidationView[];
  isManager: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  upload: (userId: string, period: string, file: File) => Promise<void>;
  remove: (id: string) => Promise<void>;
  downloadBatch: (limit: number | 'all') => Promise<void>;
}

export function useLiquidations(): UseLiquidationsResult {
  const [mine, setMine] = useState<LiquidationView[]>([]);
  const [managerItems, setManagerItems] = useState<LiquidationView[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadManager = useCallback(async () => {
    try {
      const list = await listAllLiquidations();
      if (mountedRef.current) {
        setManagerItems(list);
        setIsManager(true);
      }
    } catch {
      if (mountedRef.current) {
        setManagerItems([]);
        setIsManager(false);
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMyLiquidations();
      if (mountedRef.current) setMine(list);
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar tus liquidaciones de sueldo.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    await loadManager();
  }, [loadManager]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAll = useCallback(async () => {
    const list = await listMyLiquidations();
    if (mountedRef.current) setMine(list);
    if (isManager) await loadManager();
  }, [isManager, loadManager]);

  const upload = useCallback(
    async (userId: string, period: string, file: File) => {
      await uploadLiquidation(userId, period, file);
      await refreshAll();
    },
    [refreshAll],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteLiquidation(id);
      await refreshAll();
    },
    [refreshAll],
  );

  const downloadBatch = useCallback(
    async (limit: number | 'all') => {
      const items = limit === 'all' ? mine : mine.slice(0, limit);
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (!item) continue;
        const link = document.createElement('a');
        link.href = item.fileUrl;
        link.setAttribute('download', `liquidacion-${item.period}.pdf`);
        link.setAttribute('target', '_blank');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (items.length > 1) {
          // 400ms buffer prevents browser from blocking multiple simultaneous downloads
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    },
    [mine],
  );

  return {
    mine,
    managerItems,
    isManager,
    loading,
    error,
    refetch: load,
    upload,
    remove,
    downloadBatch,
  };
}
