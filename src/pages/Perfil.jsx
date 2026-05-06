import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import LockResetRoundedIcon from '@mui/icons-material/LockResetRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import { useAuth } from '../contexts/AuthContext';
import { sendPasswordResetLink } from '../lib/auth';
import { subscribeWorker, updateUser, updateWorker } from '../lib/repository';

const MotionBox = motion(Box);
const MotionCard = motion(Card);

const EMPTY_WORKER_FORM = {
  personalEmail: '',
  phone: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};

export default function Perfil() {
  const theme = useTheme();
  const { profile, user } = useAuth();
  const [accountDisplayName, setAccountDisplayName] = useState(null);
  const [bankForm, setBankForm] = useState({
    bankName: null,
    bankAccountType: null,
    bankAccountNumber: null,
  });
  const [workerForm, setWorkerForm] = useState(EMPTY_WORKER_FORM);
  const [workerState, setWorkerState] = useState({
    loadedWorkerId: null,
    error: '',
  });
  const [saving, setSaving] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!profile?.workerId) return undefined;

    const unsubscribe = subscribeWorker(
      profile.workerId,
      (worker) => {
        setWorkerForm({
          personalEmail: worker?.personalEmail || '',
          phone: worker?.phone || '',
          address: worker?.address || '',
          emergencyContactName: worker?.emergencyContactName || '',
          emergencyContactPhone: worker?.emergencyContactPhone || '',
        });
        setWorkerState({
          loadedWorkerId: profile.workerId,
          error: '',
        });
      },
      (workerError) => {
        setWorkerState({
          loadedWorkerId: profile.workerId,
          error: workerError.message,
        });
      },
    );

    return () => unsubscribe();
  }, [profile?.workerId]);

  const displayNameValue = accountDisplayName ?? profile?.displayName ?? '';
  const workerLoading = Boolean(profile?.workerId) && workerState.loadedWorkerId !== profile.workerId;
  const workerError = workerState.loadedWorkerId === profile?.workerId ? workerState.error : '';
  const bankNameValue = bankForm.bankName ?? profile?.bankName ?? '';
  const bankAccountTypeValue = bankForm.bankAccountType ?? profile?.bankAccountType ?? '';
  const bankAccountNumberValue = bankForm.bankAccountNumber ?? profile?.bankAccountNumber ?? '';

  const handleSave = async () => {
    if (!user?.uid) return;

    setSaving(true);
    setError('');
    setSuccessMessage('');

    try {
      await updateUser(user.uid, {
        displayName: displayNameValue.trim(),
        bankName: bankNameValue.trim(),
        bankAccountType: bankAccountTypeValue.trim(),
        bankAccountNumber: bankAccountNumberValue.trim(),
      });

      if (profile?.workerId) {
        await updateWorker(profile.workerId, workerForm);
      }

      setSuccessMessage('Perfil actualizado correctamente.');
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) return;

    setSendingReset(true);
    setError('');
    setSuccessMessage('');

    try {
      await sendPasswordResetLink(user.email);
      setSuccessMessage(`Enviamos un correo de cambio de contraseña a ${user.email}.`);
    } catch (resetError) {
      setError(resetError.message);
    } finally {
      setSendingReset(false);
    }
  };

  return (
    <Stack spacing={3} sx={{ pb: 6 }}>
      <MotionBox
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Typography variant="h5" fontWeight={800} gutterBottom>Mi perfil</Typography>
        <Typography variant="body2" color="text.secondary" fontWeight={500}>
          Revisa tu cuenta, actualiza tus datos y gestiona tu contraseña.
        </Typography>
      </MotionBox>

      <AnimatePresence mode="wait">
        {(error || workerError || successMessage) && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {error || workerError ? (
              <Alert severity="error" sx={{ borderRadius: 2 }}>{error || workerError}</Alert>
            ) : (
              <Alert severity="success" sx={{ borderRadius: 2 }}>{successMessage}</Alert>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Grid container spacing={3}>
        <Grid item xs={12} lg={7}>
          <MotionCard 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            sx={{ height: '100%', borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
          >
            <CardContent sx={{ p: 3 }}>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="h6" fontWeight={700} gutterBottom>Cuenta y Seguridad</Typography>
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    Datos de identidad y gestión de acceso. El cambio de contraseña se hace vía correo seguro.
                  </Typography>
                </Box>

                <TextField
                  label="Nombre visible"
                  value={displayNameValue}
                  onChange={(event) => setAccountDisplayName(event.target.value)}
                  fullWidth
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />

                <TextField
                  label="Correo"
                  value={user?.email || profile?.email || ''}
                  fullWidth
                  disabled
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
                <TextField
                  label="RUT"
                  value={profile?.rut || ''}
                  fullWidth
                  disabled
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />

                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip 
                    label={profile?.role || 'usuario'} 
                    variant="filled" 
                    color="primary" 
                    sx={{ borderRadius: 1.5, fontWeight: 700, textTransform: 'capitalize' }}
                  />
                  {(profile?.centerCosts ?? []).map((costCenter) => (
                    <Chip 
                      key={costCenter} 
                      label={costCenter} 
                      size="small" 
                      variant="outlined" 
                      sx={{ borderRadius: 1.5, fontWeight: 600 }}
                    />
                  ))}
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Button
                  variant="outlined"
                  fullWidth
                  startIcon={sendingReset ? <CircularProgress size={18} /> : <LockResetRoundedIcon />}
                  onClick={handlePasswordReset}
                  disabled={sendingReset || !user?.email}
                  sx={{ borderRadius: 2.5, fontWeight: 600, textTransform: 'none', py: 1 }}
                >
                  Enviar correo de cambio de contraseña
                </Button>
              </Stack>
            </CardContent>
          </MotionCard>
        </Grid>

        <Grid item xs={12} lg={5}>
          <MotionCard 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            sx={{ height: '100%', borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
          >
            <CardContent sx={{ p: 3 }}>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="h6" fontWeight={700} gutterBottom>Datos Bancarios</Typography>
                  <Typography variant="body2" color="text.secondary" fontWeight={500}>
                    Información utilizada para el pago de tus reembolsos aprobados.
                  </Typography>
                </Box>

                <TextField
                  label="Banco"
                  value={bankNameValue}
                  onChange={(event) => setBankForm((current) => ({ ...current, bankName: event.target.value }))}
                  fullWidth
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
                <TextField
                  label="Tipo de cuenta"
                  value={bankAccountTypeValue}
                  onChange={(event) => setBankForm((current) => ({ ...current, bankAccountType: event.target.value }))}
                  fullWidth
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
                <TextField
                  label="Número de cuenta"
                  value={bankAccountNumberValue}
                  onChange={(event) => setBankForm((current) => ({ ...current, bankAccountNumber: event.target.value }))}
                  fullWidth
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
              </Stack>
            </CardContent>
          </MotionCard>
        </Grid>

        {profile?.workerId ? (
          <Grid item xs={12}>
            <MotionCard 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
            >
              <CardContent sx={{ p: 3 }}>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h6" fontWeight={700} gutterBottom>Datos personales</Typography>
                    <Typography variant="body2" color="text.secondary" fontWeight={500}>
                      Mantén actualizados tus datos de contacto para pagos y soporte.
                    </Typography>
                  </Box>

                  {workerLoading ? <CircularProgress size={24} /> : (
                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Correo personal"
                          value={workerForm.personalEmail}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, personalEmail: event.target.value }))}
                          fullWidth
                          variant="outlined"
                          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Teléfono"
                          value={workerForm.phone}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, phone: event.target.value }))}
                          fullWidth
                          variant="outlined"
                          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          label="Dirección"
                          value={workerForm.address}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, address: event.target.value }))}
                          fullWidth
                          variant="outlined"
                          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Contacto de emergencia"
                          value={workerForm.emergencyContactName}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, emergencyContactName: event.target.value }))}
                          fullWidth
                          variant="outlined"
                          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Teléfono emergencia"
                          value={workerForm.emergencyContactPhone}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))}
                          fullWidth
                          variant="outlined"
                          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                        />
                      </Grid>
                    </Grid>
                  )}
                </Stack>
              </CardContent>
            </MotionCard>
          </Grid>
        ) : null}
      </Grid>

      <MotionBox 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveRoundedIcon />}
          onClick={handleSave}
          disabled={saving || !displayNameValue.trim()}
          sx={{ borderRadius: 3, px: 4, py: 1.2, fontWeight: 800, textTransform: 'none' }}
        >
          Guardar cambios
        </Button>
      </MotionBox>
    </Stack>
  );
}
