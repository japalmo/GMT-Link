import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
  Link,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { sendPasswordResetLink } from '../lib/auth';
import { useSnackbar } from '../contexts/useSnackbar';
import logoWide from '../assets/branding/logo-wide-login.png';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const showSnackbar = useSnackbar();
  const from = location.state?.from?.pathname ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch {
      setError('Correo o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Por favor ingresa tu correo para recuperar la contraseña.');
      return;
    }
    try {
      await sendPasswordResetLink(email);
      showSnackbar('Correo de recuperación enviado.');
    } catch (err) {
      setError('Error al enviar correo de recuperación: ' + err.message);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={3} component="form" onSubmit={handleSubmit}>
            <Box sx={{ textAlign: 'center', mb: 1 }}>
              <Box component="img" src={logoWide} alt="GMT Link" sx={{ width: '100%', maxWidth: 180, mb: 2 }} />
              <Typography variant="body2" color="text.secondary">
                Acceso para usuarios internos
              </Typography>
            </Box>

            {error ? <Alert severity="error">{error}</Alert> : null}

            <TextField
              label="Correo corporativo"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              fullWidth
              autoFocus
            />

            <TextField
              label="Contraseña"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              fullWidth
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={loading || !email || !password}
              fullWidth
            >
              {loading ? <CircularProgress size={22} color="inherit" /> : 'Ingresar'}
            </Button>
            
            <Link 
                component="button" 
                type="button"
                variant="body2" 
                onClick={handleForgotPassword} 
                sx={{ alignSelf: 'center', mt: 1 }}
            >
                ¿Olvidaste tu contraseña?
            </Link>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
