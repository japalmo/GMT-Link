import type { ReactNode } from 'react';
import { usePermissionRequests } from '@/hooks/use-permission-requests';
import { AppearanceSection } from './appearance-section';
import { NotificationsSection } from './notifications-section';
import { AccessRequestsSection } from './access-requests-section';
import { PendingRequestsSection } from './pending-requests-section';

/**
 * Página de Configuración (§6-2.3). Reúne en tarjetas: Apariencia (tema),
 * Notificaciones (preferencias), Mis solicitudes de acceso (pedir un rol) y,
 * solo para administradores, Solicitudes pendientes (aprobar/rechazar).
 *
 * El hook de solicitudes vive aquí (una sola carga) y se reparte a las secciones
 * que lo necesitan. La sección de admin se monta solo si el probe silencioso de
 * pendientes no dio 403 (`isAdmin`). Apariencia y Notificaciones gestionan su
 * propio estado (tema vía useTheme, preferencias vía useSettings).
 */
export default function ConfiguracionPage(): ReactNode {
  const { mine, pending, isAdmin, loading, error, refetch, create, approve, reject } =
    usePermissionRequests();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">Configuración</p>
        <h1 className="text-2xl font-bold tracking-tight">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Personaliza tu interfaz, tus notificaciones y solicita accesos.
        </p>
      </header>

      <AppearanceSection />
      <NotificationsSection />
      <AccessRequestsSection
        mine={mine}
        loading={loading}
        error={error}
        onRetry={() => void refetch()}
        onCreate={create}
      />
      {isAdmin && (
        <PendingRequestsSection
          pending={pending}
          onApprove={approve}
          onReject={reject}
        />
      )}
    </div>
  );
}
