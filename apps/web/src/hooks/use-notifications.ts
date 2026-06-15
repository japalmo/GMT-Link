import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api';
import type { NotificationView } from '@/types/notifications';

/** Mensaje legible a partir de un error desconocido (ApiError o genérico). */
function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

/** Valor expuesto por {@link useNotifications}. */
export interface UseNotificationsResult {
  /** Notificaciones del usuario (createdAt desc). */
  items: NotificationView[];
  /** Cantidad sin leer (espejo de la lista; consistente tras marcar). */
  unreadCount: number;
  /** `true` mientras se carga / recarga la lista. */
  loading: boolean;
  /** Mensaje de error de la última carga, o `null` si fue exitosa. */
  error: string | null;
  /** Vuelve a cargar lista + contador desde el backend. */
  refetch: () => Promise<void>;
  /**
   * Marca una notificación como leída (optimista) y persiste. Si falla, revierte
   * y propaga el error. Devuelve la notificación marcada para que el llamador
   * pueda, por ejemplo, navegar a su `link`.
   */
  markRead: (id: string) => Promise<NotificationView | null>;
  /** Marca todas las no leídas como leídas y refresca el estado local. */
  markAllRead: () => Promise<void>;
}

/**
 * Hook de datos de Notificaciones in-app (§6-2.2).
 *
 * Envuelve los endpoints de `lib/api.ts` (idToken de Firebase). Mantiene la
 * lista completa y deriva `unreadCount` de ella para que la campana y la página
 * queden consistentes tras marcar leídas. Las mutaciones son optimistas y
 * revierten ante error. El cleanup ignora respuestas que llegan tras desmontar.
 */
export function useNotifications(): UseNotificationsResult {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
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
      // El contador autoritativo viene del backend; la lista lo confirma.
      const [list, count] = await Promise.all([
        listNotifications(false),
        getUnreadCount(),
      ]);
      if (mountedRef.current) {
        setItems(list);
        setUnreadCount(count.count);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(toMessage(err, 'No se pudieron cargar las notificaciones.'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = useCallback(
    async (id: string): Promise<NotificationView | null> => {
      const target = items.find((n) => n.id === id);
      // Ya estaba leída: nada que persistir, pero devolvemos el item igual.
      if (target && target.readAt !== null) return target;

      const previous = items;
      const optimisticAt = new Date().toISOString();
      if (mountedRef.current) {
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: optimisticAt } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }

      try {
        const updated = await markNotificationRead(id);
        if (mountedRef.current) {
          setItems((prev) => prev.map((n) => (n.id === id ? updated : n)));
        }
        return updated;
      } catch (err) {
        // Revertimos el optimismo si el backend rechaza.
        if (mountedRef.current) {
          setItems(previous);
          setUnreadCount(previous.filter((n) => n.readAt === null).length);
          setError(toMessage(err, 'No se pudo marcar la notificación como leída.'));
        }
        throw err;
      }
    },
    [items],
  );

  const markAllRead = useCallback(async () => {
    const previous = items;
    const nowIso = new Date().toISOString();
    if (mountedRef.current) {
      setItems((prev) =>
        prev.map((n) => (n.readAt === null ? { ...n, readAt: nowIso } : n)),
      );
      setUnreadCount(0);
    }
    try {
      await markAllNotificationsRead();
      // Recargamos para traer los readAt reales del backend.
      await load();
    } catch (err) {
      if (mountedRef.current) {
        setItems(previous);
        setUnreadCount(previous.filter((n) => n.readAt === null).length);
        setError(toMessage(err, 'No se pudieron marcar todas como leídas.'));
      }
      throw err;
    }
  }, [items, load]);

  return {
    items,
    unreadCount,
    loading,
    error,
    refetch: load,
    markRead,
    markAllRead,
  };
}
