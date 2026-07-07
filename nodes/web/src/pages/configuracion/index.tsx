import type { ReactNode } from 'react';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
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
    <PageContainer maxWidth="3xl">
      <PageHeader
        label="Configuración"
        title="Configuración"
        description="Personaliza tu interfaz, tus notificaciones y solicita accesos."
      />

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
    </PageContainer>
  );
}
