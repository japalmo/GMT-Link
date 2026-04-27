import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, CardContent, TextField, Typography, Alert, CircularProgress,
} from '@mui/material';
import { updatePassword, EmailAuthProvider } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

export default function CambiarPassword() {
  const navigate = useNavigate();
  const [pass, setPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
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
      // 1. Actualizar en Firebase Auth
      await updatePassword(auth.currentUser, pass);
      
      // 2. Actualizar en Firestore
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        mustChangePassword: false,
      });

      navigate('/');
    } catch (err) {
      setError(err.message || 'Error al actualizar contraseña.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 2 }}>
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ mb: 2, textAlign: 'center' }}>
            Cambiar contraseña
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
            Tu contraseña ha expirado o es tu primer ingreso. Por favor, crea una nueva.
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={2}>
            <TextField
              label="Nueva contraseña"
              type="password"
              fullWidth
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <TextField
              label="Confirmar contraseña"
              type="password"
              fullWidth
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
            />
            <Button
              variant="contained"
              size="large"
              onClick={handleSubmit}
              disabled={loading}
              fullWidth
            >
              {loading ? <CircularProgress size={24} /> : 'Guardar nueva contraseña'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
