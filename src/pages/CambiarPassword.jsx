import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Box, Button, Card, CardContent, TextField, Typography, Alert, CircularProgress, Stack, useTheme,
} from '@mui/material';
import { motion } from 'framer-motion';
import { updatePassword } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { verifyCode, resetPassword } from '../lib/auth';
import { useSnackbar } from '../contexts/useSnackbar';
import logoWide from '../assets/branding/logo-wide-login.png';

export default function CambiarPassword() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const showSnackbar = useSnackbar();
  
  const oobCode = searchParams.get('oobCode');
  
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(!!oobCode);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  // Si hay oobCode, verificarlo al montar
  useEffect(() => {
    if (oobCode) {
      verifyCode(oobCode)
        .then((emailAddress) => {
          setEmail(emailAddress);
          setVerifying(false);
        })
        .catch((err) => {
          setError('El enlace de recuperación es inválido o ha expirado.');
          setVerifying(false);
          console.error(err);
        });
    } else {
        // Si no hay oobCode y no hay usuario, redirigir a login
        if (!auth.currentUser) {
            navigate('/login', { replace: true });
        }
    }
  }, [oobCode, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pass.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (pass !== confirmPass) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      if (oobCode) {
        // Flujo de Reset vía Link (público)
        await resetPassword(oobCode, pass);
        showSnackbar('Contraseña restablecida correctamente. Ya puedes iniciar sesión.');
        navigate('/login', { replace: true });
      } else {
        // Flujo de Cambio obligatorio (autenticado)
        if (!auth.currentUser) throw new Error('Usuario no autenticado.');
        
        await updatePassword(auth.currentUser, pass);
        await updateDoc(doc(db, 'users', auth.currentUser.uid), {
          mustChangePassword: false,
        });
        
        showSnackbar('Contraseña actualizada correctamente.');
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.message || 'Error al actualizar contraseña.');
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">Verificando enlace...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: 'background.default', p: 2 }}>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ width: '100%', maxWidth: 400 }}
      >
        <Card sx={{ width: '100%', borderRadius: 4, boxShadow: '0 20px 40px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <CardContent sx={{ p: 4 }}>
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ delay: 0.2 }}>
                <Box component="img" src={logoWide} alt="GMT Link" sx={{ width: '100%', maxWidth: 160, mb: 2 }} />
              </motion.div>
              <Typography variant="h5" sx={{ mb: 1 }} fontWeight={800}>
                {oobCode ? 'Restablecer contraseña' : 'Cambiar contraseña'}
              </Typography>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                {oobCode 
                  ? `Estás restableciendo la contraseña para ${email}` 
                  : 'Tu contraseña ha expirado o es tu primer ingreso. Por favor, crea una nueva.'}
              </Typography>
            </Box>

            {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert>}

            <Stack spacing={2.5} component="form" onSubmit={handleSubmit}>
              <TextField
                label="Nueva contraseña"
                type="password"
                fullWidth
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                required
                autoFocus
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField
                label="Confirmar contraseña"
                type="password"
                fullWidth
                value={confirmPass}
                onChange={(e) => setConfirmPass(e.target.value)}
                required
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <Button
                variant="contained"
                size="large"
                type="submit"
                disabled={loading || !!error}
                fullWidth
                sx={{ 
                  mt: 1, 
                  borderRadius: 3, 
                  py: 1.5, 
                  fontWeight: 800,
                  boxShadow: theme.shadows[4],
                  '&:hover': { boxShadow: theme.shadows[8] }
                }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Guardar contraseña'}
              </Button>
              
              {oobCode && (
                  <Button 
                    variant="text" 
                    onClick={() => navigate('/login')}
                    sx={{ fontWeight: 600, textTransform: 'none' }}
                  >
                      Volver al inicio de sesión
                  </Button>
              )}
            </Stack>
          </CardContent>
        </Card>
      </motion.div>
    </Box>
  );
}
