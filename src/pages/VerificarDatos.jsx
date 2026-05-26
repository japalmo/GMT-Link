import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Button, Card, CardContent, TextField, Typography, Alert, CircularProgress, Stack, useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../contexts/AuthContext';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { updateWorker } from '../lib/repository';

export default function VerificarDatos() {
  const theme = useTheme();
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
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', p: 2, backgroundColor: 'background.default' }}>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{ width: '100%', maxWidth: 500 }}
      >
        <Card sx={{ width: '100%', borderRadius: 4, boxShadow: '0 20px 40px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
          <CardContent sx={{ p: 4 }}>
            <Typography variant="h5" sx={{ mb: 1, textAlign: 'center' }} fontWeight={800}>
              Verifique sus datos
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 4, textAlign: 'center' }} fontWeight={500}>
              Por favor, confirme o complete su información para continuar.
            </Typography>

            <AnimatePresence mode="wait">
              {error && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                  <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>{error}</Alert>
                </motion.div>
              )}
            </AnimatePresence>

            <Stack spacing={2.5}>
              <TextField 
                label="Nombre completo" 
                fullWidth 
                value={form.fullName} 
                onChange={(e) => setForm({...form, fullName: e.target.value})} 
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField 
                label="RUT" 
                fullWidth 
                value={form.rut} 
                onChange={(e) => setForm({...form, rut: e.target.value})} 
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField 
                label="Teléfono" 
                fullWidth 
                value={form.phone} 
                onChange={(e) => setForm({...form, phone: e.target.value})} 
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField 
                label="Banco" 
                fullWidth 
                value={form.bankName} 
                onChange={(e) => setForm({...form, bankName: e.target.value})} 
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField 
                label="Tipo de cuenta" 
                fullWidth 
                value={form.bankAccountType} 
                onChange={(e) => setForm({...form, bankAccountType: e.target.value})} 
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField 
                label="Número de cuenta" 
                fullWidth 
                value={form.bankAccountNumber} 
                onChange={(e) => setForm({...form, bankAccountNumber: e.target.value})} 
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <Button 
                variant="contained" 
                size="large" 
                onClick={handleSubmit} 
                disabled={loading} 
                fullWidth
                sx={{ 
                  borderRadius: 3, 
                  py: 1.5, 
                  fontWeight: 800,
                  boxShadow: theme.shadows[4],
                  '&:hover': { boxShadow: theme.shadows[8] }
                }}
              >
                {loading ? <CircularProgress size={24} color="inherit" /> : 'Confirmar datos'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </motion.div>
    </Box>
  );
}
