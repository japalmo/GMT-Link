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
  FormControl,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PersonAddAltOutlinedIcon from '@mui/icons-material/PersonAddAltOutlined';
import { useAuth } from '../contexts/AuthContext';
import { createInternalUser } from '../lib/admin';
import {
  createWorker,
  deleteUser,
  subscribeCostCenters,
  subscribeUsers,
  subscribeWorkers,
  updateUser,
} from '../lib/repository';

const USER_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'finance_clerk', label: 'Finanzas' },
  { value: 'worker', label: 'Trabajador' },
];

const EMPTY_FORM = {
  displayName: '',
  email: '',
  rut: '',
  role: 'supervisor',
  centerCosts: [],
  bankName: '',
  bankAccountType: '',
  bankAccountNumber: '',
  workerMode: 'existing',
  workerId: '',
  workerFullName: '',
  workerEmail: '',
  workerCenterCost: '',
  workerSupervisorId: '',
};

export default function Configuracion() {
  const { profile, user } = useAuth();
  const [users, setUsers] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [editingUserId, setEditingUserId] = useState('');
  const [formState, setFormState] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
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

  const assignedWorkerIds = useMemo(
    () => new Set(users.filter((item) => item.role === 'worker').map((item) => item.workerId).filter(Boolean)),
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

  const openEditModal = (target) => {
    const linkedWorker = workers.find((worker) => worker.id === target.workerId) ?? null;
    setError('');
    setSuccessMessage('');
    setModalMode('edit');
    setEditingUserId(target.id);
    setFormState({
      ...EMPTY_FORM,
      displayName: target.displayName ?? '',
      email: target.email ?? '',
      rut: target.rut ?? '',
      role: target.role ?? 'supervisor',
      centerCosts: target.centerCosts ?? [],
      bankName: target.bankName ?? '',
      bankAccountType: target.bankAccountType ?? '',
      bankAccountNumber: target.bankAccountNumber ?? '',
      workerMode: target.role === 'worker' && target.workerId ? 'existing' : 'new',
      workerId: target.workerId ?? '',
      workerFullName: linkedWorker?.fullName ?? target.displayName ?? '',
      workerEmail: linkedWorker?.email ?? target.email ?? '',
      workerCenterCost: linkedWorker?.centerCost ?? target.centerCosts?.[0] ?? '',
      workerSupervisorId: linkedWorker?.supervisorId ?? '',
    });
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

  const handleSubmitUser = async () => {
    setSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const uid = editingUserId || crypto.randomUUID();
      const workerId = `wkr-${uid.slice(0, 8)}`;
      
      const payload = {
        email: normalizeCompanyEmail(formState.email),
        displayName: formState.displayName,
        role: formState.role,
        rut: formState.rut.trim(),
        centerCosts: formState.role === 'supervisor' ? formState.centerCosts : [],
        bankName: formState.bankName.trim(),
        bankAccountType: formState.bankAccountType.trim(),
        bankAccountNumber: formState.bankAccountNumber.trim(),
        workerId: workerId,
      };

      if (modalMode === 'edit') {
        await updateUser(editingUserId, payload);
        setSuccessMessage('Usuario actualizado.');
      } else {
        // Parte B: Crear usuario + worker doc siempre
        await createWorker({
          id: workerId,
          fullName: formState.displayName,
          rut: formState.rut.trim(),
          email: normalizeCompanyEmail(formState.email),
          centerCost: formState.centerCosts?.[0] || '',
          active: true,
        });
        
        const result = await createInternalUser({
          ...payload,
          createdBy: user?.uid || 'admin',
        });
        setSuccessMessage(
          `Usuario creado. UID: ${result.uid}. Clave temporal: ${result.temporaryPassword}`,
        );
      }

      resetModal();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTargetUser) return;

    setDeleting(true);
    setError('');
    setSuccessMessage('');

    try {
      await deleteUser(deleteTargetUser.id);
      setSuccessMessage(`Usuario ${deleteTargetUser.displayName} eliminado del perfil Firestore.`);
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
            Gestión de usuarios, roles, activación y vínculo con trabajadores.
          </Typography>
        </Box>

        {canManageUsers ? (
          <Button
            variant="contained"
            startIcon={<PersonAddAltOutlinedIcon />}
            onClick={openCreateModal}
          >
            Crear usuario
          </Button>
        ) : null}
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
                              variant="outlined"
                              startIcon={<EditOutlinedIcon />}
                              onClick={() => openEditModal(item)}
                            >
                              Editar
                            </Button>
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

      <Dialog open={modalOpen} onClose={() => !submitting && resetModal()} fullWidth maxWidth="sm">
        <DialogTitle>{modalMode === 'edit' ? 'Editar usuario' : 'Crear usuario'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Nombre"
              value={formState.displayName}
              onChange={(event) => setFormState((current) => ({ ...current, displayName: event.target.value }))}
              fullWidth
            />
            <TextField
              label="Email"
              type="email"
              value={formState.email}
              onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
              fullWidth
              helperText={modalMode === 'edit'
                ? 'Se normaliza a @gmtingenieria.com si ingresas un dominio antiguo. Cambiarlo aquí no actualiza Firebase Auth.'
                : 'Se normaliza a @gmtingenieria.com si ingresas un dominio antiguo.'}
            />
            <TextField
              label="RUT"
              value={resolvedRut}
              onChange={(event) => setFormState((current) => ({ ...current, rut: event.target.value }))}
              fullWidth
              disabled={formState.role === 'worker'}
            />
            <TextField
              select
              label="Rol"
              value={formState.role}
              onChange={(event) => setFormState((current) => ({
                ...current,
                role: event.target.value,
                centerCosts: event.target.value === 'supervisor' ? current.centerCosts : [],
              }))}
              fullWidth
            >
              {USER_ROLES.map((role) => (
                <MenuItem key={role.value} value={role.value}>{role.label}</MenuItem>
              ))}
            </TextField>

            {formState.role === 'supervisor' ? (
              <TextField
                select
                label="Centros de costo"
                value={formState.centerCosts}
                onChange={(event) => setFormState((current) => ({
                  ...current,
                  centerCosts: typeof event.target.value === 'string'
                    ? event.target.value.split(',')
                    : event.target.value,
                }))}
                fullWidth
                SelectProps={{ multiple: true }}
              >
                {costCenters.map((item) => (
                  <MenuItem key={item.id} value={item.name}>{item.name}</MenuItem>
                ))}
              </TextField>
            ) : null}

            <TextField
              label="Banco"
              value={resolvedBankName}
              onChange={(event) => setFormState((current) => ({ ...current, bankName: event.target.value }))}
              fullWidth
              disabled={formState.role === 'worker'}
            />
            <TextField
              label="Tipo de cuenta"
              value={resolvedBankAccountType}
              onChange={(event) => setFormState((current) => ({ ...current, bankAccountType: event.target.value }))}
              fullWidth
              disabled={formState.role === 'worker'}
            />
            <TextField
              label="Número de cuenta"
              value={resolvedBankAccountNumber}
              onChange={(event) => setFormState((current) => ({ ...current, bankAccountNumber: event.target.value }))}
              fullWidth
              disabled={formState.role === 'worker'}
            />

            <Alert severity="info">
              {modalMode === 'edit'
                ? 'Este flujo actualiza solo el documento `users`. Para `worker`, mantiene o reasigna el vínculo técnico `workerId` según el modo seleccionado.'
                : 'Este flujo crea el usuario en Auth y dispara correo de reset. Para `worker`, solo vincula un trabajador existente y copia sus datos base al doc `users`.'}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={resetModal} disabled={submitting}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleSubmitUser}
            disabled={submitting
              || !formState.displayName
              || !formState.email
              || !resolvedRut
              || (formState.role === 'worker' && formState.workerMode === 'existing' && !formState.workerId)
              || (formState.role === 'worker' && formState.workerMode === 'new' && (
                !formState.workerFullName
                || !formState.workerCenterCost
                || !formState.workerSupervisorId
              ))}
          >
            {modalMode === 'edit' ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </DialogActions>
      </Dialog>

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
