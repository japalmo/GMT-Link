import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/context/auth-context';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { ProtectedRoute } from '@/routes/protected-route';
import { PublicRoute } from '@/routes/public-route';
import { RequireModule } from '@/routes/require-access';
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
const RolesPage = lazy(() => import('@/pages/roles'));
const PerfilPage = lazy(() => import('@/pages/perfil'));
const CvPage = lazy(() => import('@/pages/perfil/cv'));
const DocumentsPage = lazy(() => import('@/pages/documentos'));
const DirectorioPage = lazy(() => import('@/pages/directorio'));
const FinanzasPage = lazy(() => import('@/pages/finanzas'));
const NotificacionesPage = lazy(() => import('@/pages/notificaciones'));
const ConfiguracionPage = lazy(() => import('@/pages/configuracion'));
const OperacionesPage = lazy(() => import('@/pages/operaciones'));
// Proyectos — jerarquía A0 Cliente → Faena → Proyecto → Vista (cimientos A1).
const ProyectosClientesPage = lazy(() => import('@/pages/proyectos'));
const ProyectosFaenasPage = lazy(() => import('@/pages/proyectos/faenas'));
const ProyectosListaPage = lazy(() => import('@/pages/proyectos/faena-proyectos'));
const ProyectoDetallePage = lazy(() => import('@/pages/proyectos/vista-proyecto'));
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
          // Inicio, Perfil, Config, Notificaciones y Roles no se gatean por módulo:
          // son siempre visibles (`/roles` ya se gatea por `canManageRoles` en el nav).
          { path: '/usuarios', element: <RequireModule module="usuarios">{lazyRoute(<UsuariosPage />)}</RequireModule> },
          { path: '/roles', element: lazyRoute(<RolesPage />) },
          { path: '/perfil', element: lazyRoute(<PerfilPage />) },
          { path: '/perfil/cv', element: lazyRoute(<CvPage />) },
          { path: '/perfil/documentos', element: lazyRoute(<DocumentsPage />) },
          { path: '/directorio', element: <RequireModule module="directorio">{lazyRoute(<DirectorioPage />)}</RequireModule> },
          { path: '/notificaciones', element: lazyRoute(<NotificacionesPage />) },
          { path: '/configuracion', element: lazyRoute(<ConfiguracionPage />) },
          { path: '/finanzas', element: <RequireModule module="finanzas">{lazyRoute(<FinanzasPage />)}</RequireModule> },
          { path: '/finanzas/:tab', element: <RequireModule module="finanzas">{lazyRoute(<FinanzasPage />)}</RequireModule> },
          { path: '/operaciones', element: <RequireModule module="operaciones">{lazyRoute(<OperacionesPage />)}</RequireModule> },
          { path: '/operaciones/:tab', element: <RequireModule module="operaciones">{lazyRoute(<OperacionesPage />)}</RequireModule> },
          // Proyectos: jerarquía A0 (rutas exactas que consumen las páginas reales
          // de la fase siguiente). :clientId / :faenaId / :projectId via useParams.
          { path: '/proyectos', element: <RequireModule module="proyectos">{lazyRoute(<ProyectosClientesPage />)}</RequireModule> },
          { path: '/proyectos/cliente/:clientId', element: <RequireModule module="proyectos">{lazyRoute(<ProyectosFaenasPage />)}</RequireModule> },
          {
            path: '/proyectos/cliente/:clientId/faena/:faenaId',
            element: <RequireModule module="proyectos">{lazyRoute(<ProyectosListaPage />)}</RequireModule>,
          },
          { path: '/proyectos/proyecto/:projectId', element: <RequireModule module="proyectos">{lazyRoute(<ProyectoDetallePage />)}</RequireModule> },
          { path: '/recursos', element: <RequireModule module="recursos">{lazyRoute(<RecursosPage />)}</RequireModule> },
          { path: '/herramientas', element: <RequireModule module="herramientas">{lazyRoute(<GisToolsPage />)}</RequireModule> },
          { path: '/v-metric', element: <RequireModule module="v-metric">{lazyRoute(<MetricsDashboard />)}</RequireModule> },
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
