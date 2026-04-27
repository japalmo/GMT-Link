import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useAuth } from '../contexts/AuthContext';
import {
  deleteUser,
  subscribeCostCenters,
  subscribeUsers,
  subscribeWorkers,
  updateUser,
} from '../lib/repository';

const EMPTY_FORM = {
  displayName: '',
  email: '',
  rut: '',
  role: 'supervisor',
  centerCosts: [],
  bankName: '',
  bankAccountType: '',
  bankAccountNumber: '',
};

export default function Configuracion() {
  const { profile, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // TODO: diferenciación gerencia vs admin
  const canManageUsers = profile?.role === 'admin' || profile?.role === 'gerencia';

  useEffect(() => {
    const unsubscribeUsers = subscribeUsers(
      {},
      (items) => {
        setUsers(items);
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );

    const unsubscribeCostCenters = subscribeCostCenters(
      setCostCenters,
      (snapshotError) => setError(snapshotError.message),
    );

    const unsubscribeWorkers = subscribeWorkers(
      { onlyActive: true },
      setWorkers,
      (snapshotError) => setError(snapshotError.message),
    );

    return () => {
      unsubscribeUsers();
      unsubscribeCostCenters();
      unsubscribeWorkers();
    };
  }, []);

  const sortedUsers = useMemo(
    () => [...users].sort((left, right) => left.displayName.localeCompare(right.displayName, 'es-CL')),
    [users],
  );

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.id === formState.workerId) ?? null,
    [formState.workerId, workers],
  );

  const resolvedRut = formState.role === 'worker'
    ? (formState.workerMode === 'existing' ? (selectedWorker?.rut || '') : formState.rut)
    : formState.rut;

  const resolvedBankName = formState.role === 'worker'
    ? (formState.workerMode === 'existing' ? (selectedWorker?.bankName || '') : formState.bankName)
    : formState.bankName;

  const resolvedBankAccountType = formState.role === 'worker'
    ? (formState.workerMode === 'existing' ? (selectedWorker?.bankAccountType || '') : formState.bankAccountType)
    : formState.bankAccountType;

  const resolvedBankAccountNumber = formState.role === 'worker'
    ? (formState.workerMode === 'existing' ? (selectedWorker?.bankAccountNumber || '') : formState.bankAccountNumber)
    : formState.bankAccountNumber;

  const normalizeCompanyEmail = (email) => email
    .trim()
    .toLowerCase()
    .replace(/@gmt\.cl$/i, '@gmtingenieria.com')
    .replace(/@gmt\.com$/i, '@gmtingenieria.com');

  const resetModal = () => {
    setModalOpen(false);
    setModalMode('create');
    setEditingUserId('');
    setFormState(EMPTY_FORM);
  };

  const openCreateModal = () => {
    setError('');
    setSuccessMessage('');
    setModalMode('create');
    setEditingUserId('');
    setFormState(EMPTY_FORM);
    setModalOpen(true);
  };

  const openDeleteConfirm = (target) => {
    setError('');
    setSuccessMessage('');
    setDeleteTargetUser(target);
    setDeleteConfirmOpen(true);
  };

  const closeDeleteConfirm = () => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
    setDeleteTargetUser(null);
  };

  const handleToggleActive = async (target) => {
    try {
      await updateUser(target.id, { active: !target.active });
    } catch (toggleError) {
      setError(toggleError.message);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTargetUser) return;

    setDeleting(true);
    setError('');
    setSuccessMessage('');

    try {
      await deleteUser(deleteTargetUser.id);
      setSuccessMessage(`Usuario ${deleteTargetUser.displayName} eliminado.`);
      setDeleteConfirmOpen(false);
      setDeleteTargetUser(null);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h5" gutterBottom>Configuración</Typography>
          <Typography variant="body2" color="text.secondary">
            Gestión de usuarios, roles y activación.
          </Typography>
        </Box>
      </Stack>

      {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {successMessage ? <Alert severity="success" sx={{ mb: 2 }}>{successMessage}</Alert> : null}

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Usuarios del sistema
          </Typography>

          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nombre</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>RUT</TableCell>
                  <TableCell>Rol</TableCell>
                  <TableCell>Banco</TableCell>
                  <TableCell>Centros de costo</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedUsers.length === 0 && !loading ? (
                  <TableRow>
                    <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                      <Typography color="text.secondary">
                        No hay usuarios cargados.
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedUsers.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.displayName}</TableCell>
                      <TableCell>{item.email}</TableCell>
                      <TableCell>{item.rut || '—'}</TableCell>
                      <TableCell>
                        <Chip label={item.role} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        {item.bankName || item.bankAccountType || item.bankAccountNumber ? (
                          <Stack spacing={0.25}>
                            <Typography variant="caption" color="text.secondary">
                              {item.bankName || 'Banco'}
                            </Typography>
                            <Typography variant="caption">
                              {[item.bankAccountType, item.bankAccountNumber].filter(Boolean).join(' · ') || '—'}
                            </Typography>
                          </Stack>
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            Sin datos
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                          {(item.centerCosts ?? []).length === 0 ? (
                            <Typography variant="caption" color="text.secondary">
                              Sin restricción
                            </Typography>
                          ) : (
                            item.centerCosts.map((costCenter) => (
                              <Chip key={costCenter} label={costCenter} size="small" />
                            ))
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <FormControlLabel
                          control={(
                            <Switch
                              checked={item.active !== false}
                              onChange={() => handleToggleActive(item)}
                              disabled={!canManageUsers}
                            />
                          )}
                          label={item.active !== false ? 'Activo' : 'Inactivo'}
                        />
                      </TableCell>
                      <TableCell align="right">
                        {canManageUsers ? (
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              startIcon={<DeleteOutlineRoundedIcon />}
                              onClick={() => openDeleteConfirm(item)}
                            >
                              Eliminar
                            </Button>
                          </Stack>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Paper>
        </CardContent>
      </Card>

      <Dialog open={deleteConfirmOpen} onClose={closeDeleteConfirm} fullWidth maxWidth="xs">
        <DialogTitle>Eliminar usuario</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">
              ¿Eliminar el perfil de <strong>{deleteTargetUser?.displayName || 'este usuario'}</strong>?
            </Typography>
            <Alert severity="warning">
              La cuenta de acceso puede seguir activa hasta que se elimine manualmente en Firebase Auth.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteConfirm} disabled={deleting}>Cancelar</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteUser}
            disabled={deleting}
          >
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
