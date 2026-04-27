import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import LockResetRoundedIcon from '@mui/icons-material/LockResetRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import { useAuth } from '../contexts/AuthContext';
import { sendPasswordResetLink } from '../lib/auth';
import { subscribeWorker, updateUser, updateWorker } from '../lib/repository';

const EMPTY_WORKER_FORM = {
  personalEmail: '',
  phone: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};

export default function Perfil() {
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
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" fontWeight={700} gutterBottom>Mi perfil</Typography>
        <Typography variant="body2" color="text.secondary">
          Revisa tu cuenta, actualiza tus datos y gestiona tu contraseña.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {workerError ? <Alert severity="error">{workerError}</Alert> : null}
      {successMessage ? <Alert severity="success">{successMessage}</Alert> : null}

      <Grid container spacing={3}>
        <Grid item xs={12} lg={7}>
          <Card>
            <CardContent>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="h6" gutterBottom>Cuenta</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Estos datos se usan para identificar tu sesión en GMT Link.
                  </Typography>
                </Box>

                <TextField
                  label="Nombre visible"
                  value={displayNameValue}
                  onChange={(event) => setAccountDisplayName(event.target.value)}
                  fullWidth
                />

                <TextField
                  label="Correo"
                  value={user?.email || profile?.email || ''}
                  fullWidth
                  disabled
                />
                <TextField
                  label="RUT"
                  value={profile?.rut || ''}
                  fullWidth
                  disabled
                />

                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  <Chip label={profile?.role || 'usuario'} variant="outlined" />
                  {(profile?.centerCosts ?? []).map((costCenter) => (
                    <Chip key={costCenter} label={costCenter} size="small" />
                  ))}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} lg={5}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack spacing={2.5}>
                <Box>
                  <Typography variant="h6" gutterBottom>Seguridad y banco</Typography>
                  <Typography variant="body2" color="text.secondary">
                    El cambio de contraseña se hace vía correo seguro de Firebase. Los datos bancarios quedan en tu usuario para autocompletar flujos futuros.
                  </Typography>
                </Box>

                <TextField
                  label="Banco"
                  value={bankNameValue}
                  onChange={(event) => setBankForm((current) => ({ ...current, bankName: event.target.value }))}
                  fullWidth
                />
                <TextField
                  label="Tipo de cuenta"
                  value={bankAccountTypeValue}
                  onChange={(event) => setBankForm((current) => ({ ...current, bankAccountType: event.target.value }))}
                  fullWidth
                />
                <TextField
                  label="Número de cuenta"
                  value={bankAccountNumberValue}
                  onChange={(event) => setBankForm((current) => ({ ...current, bankAccountNumber: event.target.value }))}
                  fullWidth
                />

                <Button
                  variant="outlined"
                  startIcon={sendingReset ? <CircularProgress size={18} /> : <LockResetRoundedIcon />}
                  onClick={handlePasswordReset}
                  disabled={sendingReset || !user?.email}
                >
                  Enviar correo de cambio de contraseña
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {profile?.workerId ? (
          <Grid item xs={12}>
            <Card>
              <CardContent>
                <Stack spacing={2.5}>
                  <Box>
                    <Typography variant="h6" gutterBottom>Datos personales</Typography>
                    <Typography variant="body2" color="text.secondary">
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
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Teléfono"
                          value={workerForm.phone}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, phone: event.target.value }))}
                          fullWidth
                        />
                      </Grid>
                      <Grid item xs={12}>
                        <TextField
                          label="Dirección"
                          value={workerForm.address}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, address: event.target.value }))}
                          fullWidth
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Contacto de emergencia"
                          value={workerForm.emergencyContactName}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, emergencyContactName: event.target.value }))}
                          fullWidth
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="Teléfono emergencia"
                          value={workerForm.emergencyContactPhone}
                          onChange={(event) => setWorkerForm((current) => ({ ...current, emergencyContactPhone: event.target.value }))}
                          fullWidth
                        />
                      </Grid>
                    </Grid>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ) : null}
      </Grid>

      <Box>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveRoundedIcon />}
          onClick={handleSave}
          disabled={saving || !displayNameValue.trim()}
        >
          Guardar cambios
        </Button>
      </Box>
    </Stack>
  );
}
