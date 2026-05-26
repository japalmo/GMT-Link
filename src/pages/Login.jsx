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
  useTheme,
} from '@mui/material';
import { motion } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { sendPasswordResetLink } from '../lib/auth';
import { useSnackbar } from '../contexts/useSnackbar';
import logoWide from '../assets/branding/logo-wide-login.png';

export default function Login() {
  const { login } = useAuth();
  const theme = useTheme();
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
      setError('Por favor ingrese su correo para recuperar la contraseña.');
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
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <Card sx={{ 
          width: '100%', 
          maxWidth: 400, 
          borderRadius: 4, 
          boxShadow: '0 20px 40px rgba(0,0,0,0.06)',
          overflow: 'hidden'
        }}>
          <CardContent sx={{ p: 4 }}>
            <Stack spacing={3} component="form" onSubmit={handleSubmit}>
              <Box sx={{ textAlign: 'center', mb: 1 }}>
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.2, duration: 0.5 }}
                >
                  <Box component="img" src={logoWide} alt="GMT Link" sx={{ width: '100%', maxWidth: 180, mb: 2 }} />
                </motion.div>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  Acceso para usuarios internos
                </Typography>
              </Box>

              {error ? (
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
                  <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>
                </motion.div>
              ) : null}

              <TextField
                label="Correo corporativo"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
                autoFocus
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />

              <TextField
                label="Contraseña"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={loading || !email || !password}
                fullWidth
                sx={{ 
                  borderRadius: 3, 
                  py: 1.5,
                  fontWeight: 700,
                  boxShadow: theme.shadows[4],
                  '&:hover': { boxShadow: theme.shadows[8] }
                }}
              >
                {loading ? <CircularProgress size={22} color="inherit" /> : 'Ingresar'}
              </Button>
              
              <Link 
                  component="button" 
                  type="button"
                  variant="body2" 
                  onClick={handleForgotPassword} 
                  sx={{ 
                    alignSelf: 'center', 
                    mt: 1, 
                    fontWeight: 600,
                    textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' }
                  }}
              >
                  ¿Olvidó su contraseña?
              </Link>
            </Stack>
          </CardContent>
        </Card>
      </motion.div>
    </Box>
  );
}
