import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, BellOff, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">Notificaciones</p>
          <h1 className="text-2xl font-bold tracking-tight">
            Tus notificaciones
          </h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount > 0
              ? `Tienes ${unreadCount} sin leer.`
              : 'Estás al día.'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleMarkAll()}
          loading={markingAll}
          disabled={unreadCount === 0 || loading}
          className="self-start sm:self-auto"
        >
          <CheckCheck className="size-4" aria-hidden />
          Marcar todas como leídas
        </Button>
      </header>

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Cargando notificaciones…
        </div>
      ) : error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertCircle className="size-8 text-destructive" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Reintentar
            </Button>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <BellOff className="size-8 text-muted-foreground" aria-hidden />
            <p className="max-w-sm text-sm text-muted-foreground">
              No tienes notificaciones por ahora. Te avisaremos cuando ocurra algo
              que necesites revisar.
            </p>
          </CardContent>
        </Card>
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
    </div>
  );
}
