import { Navigate, useLocation } from 'react-router-dom';
import { Box, CircularProgress, Typography, Button, Container } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children, allowedRoles, redirectTo = '/' }) {
  const { user, profile, loading, logout } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!profile || profile.active === false) {
    return (
      <Container maxWidth="xs" sx={{ mt: 8, textAlign: 'center' }}>
        <Typography variant="h5" gutterBottom>Tu cuenta no está configurada</Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          No se ha encontrado un perfil activo para este usuario. Por favor, contacta al administrador.
        </Typography>
        <Button variant="contained" onClick={() => logout()}>Cerrar sesión</Button>
      </Container>
    );
  }

  // GMT-05: Redirigir siempre a cambiar contraseña si es necesario
  if (profile?.mustChangePassword && location.pathname !== '/cambiar-password') {
    return <Navigate to="/cambiar-password" replace />;
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
