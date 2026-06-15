import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { AuthProvider } from '@/context/auth-context';
import { ProtectedRoute } from '@/routes/protected-route';
import { PublicRoute } from '@/routes/public-route';
import { AppShell } from '@/components/layout/app-shell';
import LoginPage from '@/pages/login';
import FirstLoginPage from '@/pages/first-login';
import DashboardPage from '@/pages/dashboard';
import UsuariosPage from '@/pages/usuarios';
import PerfilPage from '@/pages/perfil';
import CvPage from '@/pages/perfil/cv';
import DocumentsPage from '@/pages/documentos';
import DirectorioPage from '@/pages/directorio';
import NotificacionesPage from '@/pages/notificaciones';
import PlaceholderPage from '@/pages/placeholder';
import SuspendedPage from '@/pages/suspended';
import DesignDemo from '@/pages/DesignDemo';
import RoleScopedListDemo from '@/pages/primitives/role-scoped-list-demo';
import ImportWizardDemo from '@/pages/primitives/import-wizard-demo';
import ApprovalWorkflowDemo from '@/pages/primitives/approval-workflow-demo';

/** Redirección de rutas inexistentes a la raíz (que aplica los guards). */
function NotFoundRedirect() {
  return <Navigate to="/" replace />;
}

/**
 * Routing de la app (Etapas 0.5 + 0.7).
 *
 * - `/login` es pública (PublicRoute rebota a quien ya tiene sesión).
 * - `/first-login` exige sesión + status PENDING_FIRST_LOGIN, sin shell.
 * - El resto vive dentro del AppShell y exige sesión + status ACTIVE
 *   (ProtectedRoute hace los redirects por estado).
 */
const router = createBrowserRouter([
  {
    element: <PublicRoute />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  // Cuenta suspendida: se auto-guarda (requiere sesión + status SUSPENDED),
  // fuera de ProtectedRoute para no entrar en bucle de redirección.
  { path: '/suspended', element: <SuspendedPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      // Cambio de clave forzado: protegido pero fuera del shell.
      { path: '/first-login', element: <FirstLoginPage /> },
      // App con shell (sidebar + topbar).
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <DashboardPage /> },
          { path: '/usuarios', element: <UsuariosPage /> },
          { path: '/perfil', element: <PerfilPage /> },
          { path: '/perfil/cv', element: <CvPage /> },
          { path: '/perfil/documentos', element: <DocumentsPage /> },
          { path: '/directorio', element: <DirectorioPage /> },
          { path: '/notificaciones', element: <NotificacionesPage /> },
          {
            path: '/finanzas',
            element: (
              <PlaceholderPage
                title="Finanzas"
                description="Reembolsos, horas extra y liquidaciones."
              />
            ),
          },
          {
            path: '/operaciones',
            element: (
              <PlaceholderPage
                title="Operaciones"
                description="Proyectos, backlog y documentos."
              />
            ),
          },
          {
            path: '/recursos',
            element: (
              <PlaceholderPage
                title="Recursos"
                description="Insumos, proveedores, equipos, vehículos y bodegas."
              />
            ),
          },
          {
            path: '/herramientas',
            element: (
              <PlaceholderPage
                title="Herramientas"
                description="Transformación de coordenadas y utilidades técnicas."
              />
            ),
          },
          {
            path: '/v-metric',
            element: (
              <PlaceholderPage
                title="V-metric"
                description="Módulo en evaluación."
              />
            ),
          },
          // QA del design system.
          { path: '/design', element: <DesignDemo /> },
          // Demos aisladas de las primitivas §5 (Etapa 0.8, QA).
          { path: '/primitives/role-scoped-list', element: <RoleScopedListDemo /> },
          { path: '/primitives/import-wizard', element: <ImportWizardDemo /> },
          { path: '/primitives/approval-workflow', element: <ApprovalWorkflowDemo /> },
        ],
      },
    ],
  },
  // Cualquier ruta desconocida cae a la raíz (que a su vez aplica los guards).
  { path: '*', element: <NotFoundRedirect /> },
]);

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
