import { Suspense, lazy } from 'react';
import { Navigate, createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import theme from './theme';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { SnackbarProvider } from './contexts/SnackbarProvider';

const AppShell = lazy(() => import('./components/AppShell'));
const ProtectedRoute = lazy(() => import('./components/ProtectedRoute'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const MisSolicitudes = lazy(() => import('./pages/MisSolicitudes'));
const Reembolsos = lazy(() => import('./pages/Reembolsos'));
const Pagos = lazy(() => import('./pages/Pagos'));
const Trabajadores = lazy(() => import('./pages/Trabajadores'));
const Configuracion = lazy(() => import('./pages/Configuracion'));
const Perfil = lazy(() => import('./pages/Perfil'));
const SolicitarGastos = lazy(() => import('./pages/SolicitarGastos'));
const Login = lazy(() => import('./pages/Login'));
const CambiarPassword = lazy(() => import('./pages/CambiarPassword'));
const VerificarDatos = lazy(() => import('./pages/VerificarDatos'));
const NotFound = lazy(() => import('./pages/NotFound'));

function withSuspense(element) {
  return <Suspense fallback={null}>{element}</Suspense>;
}

function HomeRedirect() {
  const { profile, loading } = useAuth();

  if (loading) return null;
  if (profile?.role === 'worker' || profile?.role === 'trabajador') {
    return <Navigate to="/mis-solicitudes" replace />;
  }

  return withSuspense(<Dashboard />);
}

const router = createBrowserRouter([
  // Rutas internas — requieren sesión activa
  {
    element: withSuspense(
      <ProtectedRoute>
        <AppShell />
      </ProtectedRoute>
    ),
    children: [
      { path: '/', element: <HomeRedirect /> },
      {
        path: '/mis-solicitudes',
        element: withSuspense(
          <ProtectedRoute allowedRoles={['worker', 'trabajador']}>
            <MisSolicitudes />
          </ProtectedRoute>
        ),
      },
      {
        path: '/reembolsos',
        element: withSuspense(
          <ProtectedRoute allowedRoles={['admin', 'gerencia', 'supervisor', 'finance_clerk']} redirectTo="/mis-solicitudes">
            <Reembolsos />
          </ProtectedRoute>
        ),
      },
      {
        path: '/pagos',
        element: withSuspense(
          <ProtectedRoute allowedRoles={['admin', 'gerencia', 'finance_clerk']} redirectTo="/mis-solicitudes">
            <Pagos />
          </ProtectedRoute>
        ),
      },
      {
        path: '/trabajadores',
        element: withSuspense(
          <ProtectedRoute allowedRoles={['admin', 'gerencia', 'supervisor', 'finance_clerk']} redirectTo="/mis-solicitudes">
            <Trabajadores />
          </ProtectedRoute>
        ),
      },
      {
        path: '/configuracion',
        element: withSuspense(
          <ProtectedRoute allowedRoles={['admin', 'gerencia']} redirectTo="/mis-solicitudes">
            <Configuracion />
          </ProtectedRoute>
        ),
      },
      {
        path: '/perfil',
        element: withSuspense(
          <ProtectedRoute>
            <Perfil />
          </ProtectedRoute>
        ),
      },
      { path: '*',               element: withSuspense(<NotFound />) },
    ],
  },
  // Rutas públicas — sin auth
  { path: '/login',     element: withSuspense(<Login />) },
  { path: '/cambiar-password', element: withSuspense(<CambiarPassword />) },
  { path: '/verificar-datos', element: withSuspense(
    <ProtectedRoute>
      <VerificarDatos />
    </ProtectedRoute>
  )},
  {
    path: '/solicitar',
    element: withSuspense(
      <ProtectedRoute redirectTo="/">
        <SolicitarGastos />
      </ProtectedRoute>
    ),
  },
], {
  basename: import.meta.env.BASE_URL,
});

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <SnackbarProvider>
          <RouterProvider router={router} />
        </SnackbarProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
