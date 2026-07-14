import { useCallback, useEffect, useRef, useState } from 'react';
import type { SortDir, TablePage, TableRequest } from '@gmt-platform/contracts';
import { errorToMessage } from '@/lib/api';

/**
 * Motor de tablas server-side (offset). Mantiene el estado de la query
 * (búsqueda, orden, filtros, página, page-size), llama al `fetcher` del endpoint
 * y expone los datos + setters. La búsqueda se debouncea; cualquier cambio de
 * búsqueda/orden/filtro/page-size resetea a la página 1. Las respuestas obsoletas
 * se descartan con un contador de generación. Como todo se resuelve en el server,
 * filtro y orden afectan al dataset COMPLETO, no solo a la página cargada.
 */

export interface UseDataTableOptions {
  /** Filas por página inicial (default 10). */
  initialPageSize?: number;
  initialSortBy?: string;
  initialSortDir?: SortDir;
  initialFilters?: Record<string, string>;
  /** Debounce del buscador en ms (default 300). */
  searchDebounceMs?: number;
}

export interface UseDataTableResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  loading: boolean;
  error: string | null;
  search: string;
  sortBy: string | undefined;
  sortDir: SortDir;
  filters: Record<string, string>;
  setSearch: (value: string) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Click en un encabezado ordenable: alterna asc/desc o fija la columna. */
  toggleSort: (key: string) => void;
  /** Fija/limpia un filtro estructurado por columna (undefined lo quita). */
  setFilter: (key: string, value: string | undefined) => void;
  refetch: () => void;
}

export function useDataTable<T>(
  fetcher: (req: TableRequest) => Promise<TablePage<T>>,
  opts: UseDataTableOptions = {},
): UseDataTableResult<T> {
  const { initialPageSize = 10, initialSortBy, initialSortDir = 'desc', initialFilters = {}, searchDebounceMs = 300 } = opts;

  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [search, setSearchState] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<string | undefined>(initialSortBy);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // `fetcher` suele venir inline; lo guardamos en un ref para no re-disparar por
  // identidad en cada render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Debounce del buscador.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), searchDebounceMs);
    return () => clearTimeout(id);
  }, [search, searchDebounceMs]);

  const genRef = useRef(0);
  useEffect(() => {
    const gen = ++genRef.current;
    setLoading(true);
    void fetcherRef
      .current({ page, pageSize, search: debouncedSearch.trim() || undefined, sortBy, sortDir, filters })
      .then((res) => {
        if (gen !== genRef.current) return;
        // Auto-clamp: si la página quedó fuera de rango (p. ej. tras borrar la
        // última fila de la última página), volvemos a la última página válida y
        // dejamos que el efecto recargue. Sin esto la tabla queda en blanco y el
        // rango "Mostrando X-Y" se invierte. Lógica del motor, no de cada tabla.
        if (page > 1 && res.items.length === 0 && res.total > 0) {
          const lastPage = Math.max(1, Math.ceil(res.total / pageSize));
          if (page > lastPage) {
            setPageState(lastPage);
            return;
          }
        }
        setItems(res.items);
        setTotal(res.total);
        setError(null);
      })
      .catch((err: unknown) => {
        if (gen !== genRef.current) return;
        setError(errorToMessage(err, 'No se pudieron cargar los datos.'));
        setItems([]);
        setTotal(0);
      })
      .finally(() => {
        if (gen === genRef.current) setLoading(false);
      });
  }, [page, pageSize, debouncedSearch, sortBy, sortDir, filters, reloadKey]);

  const setSearch = useCallback((value: string) => {
    setSearchState(value);
    setPageState(1);
  }, []);

  const setPage = useCallback((next: number) => {
    setPageState((prev) => (next >= 1 ? next : prev));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size >= 1 ? size : 10);
    setPageState(1);
  }, []);

  const toggleSort = useCallback((key: string) => {
    setSortBy((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('asc');
      return key;
    });
    setPageState(1);
  }, []);

  const setFilter = useCallback((key: string, value: string | undefined) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      return next;
    });
    setPageState(1);
  }, []);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  const pageCount = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

  return {
    items, total, page, pageSize, pageCount, loading, error,
    search, sortBy, sortDir, filters,
    setSearch, setPage, setPageSize, toggleSort, setFilter, refetch,
  };
}
