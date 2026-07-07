import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { useNotifications } from '@/hooks/use-notifications';
import { NotificationItem } from '@/components/notifications/notification-item';
import type { NotificationView } from '@/types/notifications';

/**
 * Página de Notificaciones (§6-2.2). Lista completa con leídas y no leídas
 * diferenciadas, botón "Marcar todas como leídas", y al activar una notificación
 * la marca leída y navega a su `link` si lo tiene. Estados vacío/carga/error.
 */
export default function NotificacionesPage(): ReactNode {
  const navigate = useNavigate();
  const { items, unreadCount, loading, error, refetch, markRead, markAllRead } =
    useNotifications();
  const [markingAll, setMarkingAll] = useState(false);

  const handleSelect = async (notification: NotificationView): Promise<void> => {
    try {
      await markRead(notification.id);
    } catch {
      // markRead revierte y registra el error; navegamos igual si hay link.
    }
    if (notification.link) navigate(notification.link);
  };

  const handleMarkAll = async (): Promise<void> => {
    setMarkingAll(true);
    try {
      await markAllRead();
    } catch {
      // El hook ya revierte y publica el error en `error`.
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <PageContainer maxWidth="3xl">
      <PageHeader
        label="Notificaciones"
        title="Tus notificaciones"
        description={
          unreadCount > 0 ? `Tienes ${unreadCount} sin leer.` : 'Estás al día.'
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleMarkAll()}
            loading={markingAll}
            disabled={unreadCount === 0 || loading}
          >
            <CheckCheck className="size-4" aria-hidden />
            Marcar todas como leídas
          </Button>
        }
      />

      {loading && items.length === 0 ? (
        <LoadingState label="Cargando notificaciones…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          message="No tienes notificaciones por ahora. Te avisaremos cuando ocurra algo que necesites revisar."
        />
      ) : (
        <Card className="overflow-hidden p-0">
          <ul className="divide-y divide-border">
            {items.map((notification) => (
              <li key={notification.id}>
                <NotificationItem
                  notification={notification}
                  onSelect={(n) => void handleSelect(n)}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageContainer>
  );
}
