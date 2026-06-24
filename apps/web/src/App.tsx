import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/context/auth-context';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { ProtectedRoute } from '@/routes/protected-route';
import { PublicRoute } from '@/routes/public-route';
import { AppShell } from '@/components/layout/app-shell';
// Páginas críticas (eager): login, first-login, dashboard y estados de sesión.
import LoginPage from '@/pages/login';
import FirstLoginPage from '@/pages/first-login';
import DashboardPage from '@/pages/dashboard';
import SuspendedPage from '@/pages/suspended';
import PublicAssetPage from '@/pages/public/activo';

// Páginas secundarias y pesadas (lazy): se cargan al navegar. Esto saca del
// bundle inicial las dependencias grandes (Three.js en v-metric, mapas en
// herramientas) y reduce el tiempo de carga inicial en producción.
const UsuariosPage = lazy(() => import('@/pages/usuarios'));
const PerfilPage = lazy(() => import('@/pages/perfil'));
const CvPage = lazy(() => import('@/pages/perfil/cv'));
const DocumentsPage = lazy(() => import('@/pages/documentos'));
const DirectorioPage = lazy(() => import('@/pages/directorio'));
const FinanzasPage = lazy(() => import('@/pages/finanzas'));
const NotificacionesPage = lazy(() => import('@/pages/notificaciones'));
const ConfiguracionPage = lazy(() => import('@/pages/configuracion'));
const OperacionesPage = lazy(() => import('@/pages/operaciones'));
const RecursosPage = lazy(() => import('@/pages/recursos'));
const GisToolsPage = lazy(() => import('@/pages/gis-tools'));
const MetricsDashboard = lazy(() => import('@/pages/v-metric'));
const DesignDemo = lazy(() => import('@/pages/DesignDemo'));
const RoleScopedListDemo = lazy(() => import('@/pages/primitives/role-scoped-list-demo'));
const ImportWizardDemo = lazy(() => import('@/pages/primitives/import-wizard-demo'));
const ApprovalWorkflowDemo = lazy(() => import('@/pages/primitives/approval-workflow-demo'));

/** Fallback mientras se descarga el chunk de una ruta lazy. */
function RouteFallback() {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center"
      role="status"
      aria-label="Cargando"
    >
      <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}

/** Envuelve un elemento lazy en un boundary de Suspense con su fallback. */
function lazyRoute(element: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>;
}

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
  { path: '/public/activos/:code', element: <PublicAssetPage /> },
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
          { path: '/usuarios', element: lazyRoute(<UsuariosPage />) },
          { path: '/perfil', element: lazyRoute(<PerfilPage />) },
          { path: '/perfil/cv', element: lazyRoute(<CvPage />) },
          { path: '/perfil/documentos', element: lazyRoute(<DocumentsPage />) },
          { path: '/directorio', element: lazyRoute(<DirectorioPage />) },
          { path: '/notificaciones', element: lazyRoute(<NotificacionesPage />) },
          { path: '/configuracion', element: lazyRoute(<ConfiguracionPage />) },
          { path: '/finanzas', element: lazyRoute(<FinanzasPage />) },
          { path: '/operaciones', element: lazyRoute(<OperacionesPage />) },
          { path: '/operaciones/:tab', element: lazyRoute(<OperacionesPage />) },
          { path: '/recursos', element: lazyRoute(<RecursosPage />) },
          { path: '/herramientas', element: lazyRoute(<GisToolsPage />) },
          { path: '/v-metric', element: lazyRoute(<MetricsDashboard />) },
          // QA del design system.
          { path: '/design', element: lazyRoute(<DesignDemo />) },
          // Demos aisladas de las primitivas §5 (Etapa 0.8, QA).
          { path: '/primitives/role-scoped-list', element: lazyRoute(<RoleScopedListDemo />) },
          { path: '/primitives/import-wizard', element: lazyRoute(<ImportWizardDemo />) },
          { path: '/primitives/approval-workflow', element: lazyRoute(<ApprovalWorkflowDemo />) },
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
      <ThemeProvider>
        <RouterProvider router={router} />
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </AuthProvider>
  );
}
