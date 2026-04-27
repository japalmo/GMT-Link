import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, CardContent, TextField, Typography, Alert, CircularProgress, Stack,
} from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { updateWorker } from '../lib/repository';

export default function VerificarDatos() {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    fullName: profile?.displayName || '',
    rut: profile?.rut || '',
    phone: profile?.phone || '',
    bankName: profile?.bankName || '',
    bankAccountType: profile?.bankAccountType || '',
    bankAccountNumber: profile?.bankAccountNumber || '',
  });

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      // 1. Actualizar perfil de usuario
      await updateDoc(doc(db, 'users', user.uid), {
        ...form,
        profileVerified: true,
      });

      // 2. Actualizar worker si existe
      if (profile?.workerId) {
        await updateWorker(profile.workerId, form);
      }

      navigate('/');
    } catch (err) {
      setError(err.message || 'Error al guardar datos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 2 }}>
      <Card sx={{ maxWidth: 500, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ mb: 2, textAlign: 'center' }}>
            Verifica tus datos
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, textAlign: 'center' }}>
            Por favor, confirma o completa tu información para continuar.
          </Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Stack spacing={2}>
            <TextField label="Nombre completo" fullWidth value={form.fullName} onChange={(e) => setForm({...form, fullName: e.target.value})} />
            <TextField label="RUT" fullWidth value={form.rut} onChange={(e) => setForm({...form, rut: e.target.value})} />
            <TextField label="Teléfono" fullWidth value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} />
            <TextField label="Banco" fullWidth value={form.bankName} onChange={(e) => setForm({...form, bankName: e.target.value})} />
            <TextField label="Tipo de cuenta" fullWidth value={form.bankAccountType} onChange={(e) => setForm({...form, bankAccountType: e.target.value})} />
            <TextField label="Número de cuenta" fullWidth value={form.bankAccountNumber} onChange={(e) => setForm({...form, bankAccountNumber: e.target.value})} />
            <Button variant="contained" size="large" onClick={handleSubmit} disabled={loading} fullWidth>
              {loading ? <CircularProgress size={24} /> : 'Confirmar datos'}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
