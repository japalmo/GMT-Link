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
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useAuth } from '../contexts/AuthContext';
import {
  createCostCenter,
  deleteCostCenter,
  deleteUser,
  subscribeCostCenters,
  subscribeUsers,
  subscribeWorkers,
  updateCostCenter,
  updateUser,
} from '../lib/repository';

const MotionBox = motion(Box);
const MotionCard = motion(Card);

export default function Configuracion() {
  const theme = useTheme();
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState(0);
  const [newCc, setNewCc] = useState('');
  const [creatingCc, setCreatingCc] = useState(false);
  const [editingCcId, setEditingCcId] = useState(null);
  const [editingCcName, setEditingCcName] = useState('');
  const [savingCcId, setSavingCcId] = useState(null);

  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserTarget, setEditUserTarget] = useState(null);
  const [savingUser, setSavingUser] = useState(false);
  const [userForm, setUserForm] = useState({
    role: 'worker',
    active: true,
    centerCosts: [],
    workerId: '',
    displayName: '',
    rut: '',
  });

  const canManageUsers = profile?.role === 'admin' || profile?.role === 'gerencia';

  useEffect(() => {
    const unsubscribeUsers = subscribeUsers(
      {},
      (items) => { setUsers(items); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
    const unsubscribeCostCenters = subscribeCostCenters(
      setCostCenters,
      (err) => setError(err.message),
    );
    const unsubscribeWorkers = subscribeWorkers(
      { profile },
      (items) => setWorkers(items),
      (err) => setError(err.message),
    );
    return () => { unsubscribeUsers(); unsubscribeCostCenters(); unsubscribeWorkers(); };
  }, []);

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => a.displayName.localeCompare(b.displayName, 'es-CL')),
    [users],
  );

  const handleToggleActive = async (target) => {
    try {
      await updateUser(target.id, { active: !target.active });
    } catch (err) {
      setError(err.message);
    }
  };

  const openDeleteConfirm = (target) => {
    setError('');
    setSuccessMessage('');
    setDeleteTargetUser(target);
    setDeleteConfirmOpen(true);
  };

  const openEditUser = (target) => {
    setError('');
    setSuccessMessage('');
    setEditUserTarget(target);
    setUserForm({
      role: target?.role || 'worker',
      active: target?.active !== false,
      centerCosts: Array.isArray(target?.centerCosts) ? target.centerCosts.filter(Boolean) : [],
      workerId: target?.workerId || '',
      displayName: target?.displayName || '',
      rut: target?.rut || '',
    });
    setEditUserOpen(true);
  };

  const closeEditUser = () => {
    if (savingUser) return;
    setEditUserOpen(false);
    setEditUserTarget(null);
  };

  const handlePickWorker = (workerId) => {
    const worker = workers.find((item) => item.id === workerId) ?? null;
    if (!worker) {
      setUserForm((current) => ({ ...current, workerId: '' }));
      return;
    }

    setUserForm((current) => ({
      ...current,
      workerId: worker.id,
      displayName: worker.fullName || current.displayName,
      rut: worker.rut || current.rut,
      centerCosts: worker.centerCost ? [worker.centerCost] : current.centerCosts,
    }));
  };

  const handleSaveUserPermissions = async () => {
    if (!editUserTarget?.id) return;

    setSavingUser(true);
    setError('');
    setSuccessMessage('');

    try {
      const nextRole = userForm.role;

      const patch = {
        role: nextRole,
        active: Boolean(userForm.active),
      };

      if (nextRole === 'supervisor') {
        patch.centerCosts = userForm.centerCosts ?? [];
      } else if (nextRole === 'worker' || nextRole === 'trabajador') {
        patch.workerId = userForm.workerId || null;
        patch.displayName = (userForm.displayName || '').trim();
        patch.rut = (userForm.rut || '').trim();
        patch.centerCosts = userForm.centerCosts ?? [];
      } else {
        patch.centerCosts = [];
        patch.workerId = null;
      }

      await updateUser(editUserTarget.id, patch);
      setSuccessMessage(`Permisos actualizados para ${editUserTarget.displayName}.`);
      setEditUserOpen(false);
      setEditUserTarget(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingUser(false);
    }
  };

  const closeDeleteConfirm = () => {
    if (deleting) return;
    setDeleteConfirmOpen(false);
    setDeleteTargetUser(null);
  };

  const handleDeleteUser = async () => {
    if (!deleteTargetUser) return;
    setDeleting(true);
    setError('');
    try {
      await deleteUser(deleteTargetUser.id);
      setSuccessMessage(`Usuario ${deleteTargetUser.displayName} eliminado.`);
      setDeleteConfirmOpen(false);
      setDeleteTargetUser(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateCc = async () => {
    if (!newCc.trim()) return;
    setCreatingCc(true);
    setError('');
    try {
      await createCostCenter(newCc.trim());
      setNewCc('');
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingCc(false);
    }
  };

  const handleDeleteCc = async (id) => {
    setError('');
    try {
      await deleteCostCenter(id);
    } catch (err) {
      setError(err.message);
    }
  };

  const startEditingCc = (cc) => {
    setError('');
    setEditingCcId(cc.id);
    setEditingCcName(cc.name || '');
  };

  const cancelEditingCc = () => {
    if (savingCcId) return;
    setEditingCcId(null);
    setEditingCcName('');
  };

  const saveEditingCc = async () => {
    if (!editingCcId) return;
    const nextName = editingCcName.trim();
    if (!nextName) return;
    setSavingCcId(editingCcId);
    setError('');
    try {
      await updateCostCenter(editingCcId, { name: nextName });
      setEditingCcId(null);
      setEditingCcName('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCcId(null);
    }
  };

  const toggleCcActive = async (cc) => {
    if (!canManageUsers) return;
    setSavingCcId(cc.id);
    setError('');
    try {
      await updateCostCenter(cc.id, { active: !(cc.active !== false) });
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingCcId(null);
    }
  };

  return (
    <Box sx={{ pb: 4 }}>
      <MotionBox
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Typography variant="h5" fontWeight={800}>Configuración</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Gestión de usuarios, roles y centros de costo.
        </Typography>
      </MotionBox>

      <Tabs 
        value={tab} 
        onChange={(_, val) => setTab(val)} 
        sx={{ 
          mb: 2,
          '& .MuiTab-root': { fontWeight: 700, textTransform: 'none', minWidth: 140 },
          '& .MuiTabs-indicator': { height: 3, borderRadius: '3px 3px 0 0' }
        }}
      >
        <Tab label="Usuarios" />
        <Tab label="Centros de Costo" />
      </Tabs>

      {loading && tab === 0 ? <LinearProgress sx={{ mb: 2, borderRadius: 2 }} /> : null}
      {error ? <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert> : null}
      {successMessage ? <Alert severity="success" sx={{ mb: 2, borderRadius: 2 }}>{successMessage}</Alert> : null}

      <AnimatePresence mode="wait">
        {tab === 0 && (
          <MotionCard
            key="tab-users"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
          >
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }} fontWeight={700}>Usuarios del sistema</Typography>
              <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Email</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>RUT</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Rol</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>Acciones</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedUsers.length === 0 && !loading ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                          <Typography color="text.secondary">No hay usuarios cargados.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedUsers.map((item, idx) => (
                        <TableRow 
                          key={item.id}
                          component={motion.tr}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: idx * 0.03 }}
                          sx={{ 
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.01) !important' },
                            transition: 'background-color 0.2s'
                          }}
                        >
                          <TableCell sx={{ fontWeight: 600 }}>{item.displayName}</TableCell>
                          <TableCell sx={{ fontWeight: 500 }}>{item.email}</TableCell>
                          <TableCell sx={{ fontWeight: 500 }}>{item.rut || '—'}</TableCell>
                          <TableCell>
                            <Chip 
                              label={item.role} 
                              size="small" 
                              variant="outlined" 
                              color="primary"
                              sx={{ borderRadius: 1.5, fontWeight: 700, textTransform: 'capitalize', fontSize: '0.7rem' }}
                            />
                          </TableCell>
                          <TableCell>
                            <FormControlLabel
                              control={(
                                <Switch
                                  checked={item.active !== false}
                                  onChange={() => handleToggleActive(item)}
                                  disabled={!canManageUsers}
                                  color="success"
                                />
                              )}
                              label={item.active !== false ? 'Activo' : 'Inactivo'}
                              sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.8rem', fontWeight: 600 } }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            {canManageUsers ? (
                              <Stack direction="row" spacing={1} justifyContent="flex-end">
                                <Button
                                  size="small"
                                  variant="text"
                                  startIcon={<EditRoundedIcon />}
                                  onClick={() => openEditUser(item)}
                                  sx={{ borderRadius: 2, fontWeight: 700, textTransform: 'none' }}
                                >
                                  Permisos
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  variant="text"
                                  startIcon={<DeleteOutlineRoundedIcon />}
                                  onClick={() => openDeleteConfirm(item)}
                                  sx={{ borderRadius: 2, fontWeight: 700, textTransform: 'none' }}
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
          </MotionCard>
        )}

        {tab === 1 && (
          <MotionCard
            key="tab-cc"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
          >
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }} fontWeight={700}>Centros de Costo</Typography>
              {canManageUsers && (
                <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
                  <TextField
                    label="Nuevo centro de costo"
                    value={newCc}
                    onChange={(e) => setNewCc(e.target.value)}
                    size="small"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCc(); }}
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                  />
                  <Button
                    variant="contained"
                    startIcon={<AddCircleOutlineRoundedIcon />}
                    onClick={handleCreateCc}
                    disabled={creatingCc || !newCc.trim()}
                    sx={{ borderRadius: 2.5, fontWeight: 700, textTransform: 'none' }}
                  >
                    Crear
                  </Button>
                </Stack>
              )}
              <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                      <TableCell sx={{ fontWeight: 700, width: 160 }}>Estado</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, width: 160 }}>Acciones</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {costCenters.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} align="center" sx={{ py: 6 }}>
                          <Typography variant="body2" color="text.secondary">
                            No hay centros de costo registrados.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      costCenters.map((cc) => {
                        const isActive = cc.active !== false;
                        const isEditing = editingCcId === cc.id;
                        const isRowBusy = savingCcId === cc.id;

                        return (
                          <TableRow
                            key={cc.id}
                            sx={{ '&:hover': { bgcolor: 'rgba(0,0,0,0.01) !important' }, transition: 'background-color 0.2s' }}
                          >
                            <TableCell sx={{ fontWeight: 600 }}>
                              {isEditing ? (
                                <TextField
                                  value={editingCcName}
                                  onChange={(e) => setEditingCcName(e.target.value)}
                                  size="small"
                                  variant="outlined"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveEditingCc();
                                    if (e.key === 'Escape') cancelEditingCc();
                                  }}
                                  disabled={!canManageUsers || isRowBusy}
                                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 }, minWidth: 260 }}
                                />
                              ) : (
                                <Stack direction="row" spacing={1} alignItems="center">
                                  <Typography fontWeight={600}>{cc.name || '—'}</Typography>
                                  {!isActive ? (
                                    <Chip label="Inactivo" size="small" variant="outlined" color="default" sx={{ borderRadius: 1.5, fontWeight: 700, fontSize: '0.7rem' }} />
                                  ) : null}
                                </Stack>
                              )}
                            </TableCell>

                            <TableCell>
                              <FormControlLabel
                                control={(
                                  <Switch
                                    checked={isActive}
                                    onChange={() => toggleCcActive(cc)}
                                    disabled={!canManageUsers || isRowBusy}
                                    color="success"
                                  />
                                )}
                                label={isActive ? 'Activo' : 'Inactivo'}
                                sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.8rem', fontWeight: 600 } }}
                              />
                            </TableCell>

                            <TableCell align="right">
                              {canManageUsers ? (
                                isEditing ? (
                                  <>
                                    <IconButton onClick={saveEditingCc} disabled={isRowBusy || !editingCcName.trim()} aria-label="Guardar" size="small">
                                      <CheckRoundedIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton onClick={cancelEditingCc} disabled={isRowBusy} aria-label="Cancelar" size="small">
                                      <CloseRoundedIcon fontSize="small" />
                                    </IconButton>
                                  </>
                                ) : (
                                  <>
                                    <IconButton onClick={() => startEditingCc(cc)} disabled={isRowBusy} aria-label="Editar" size="small">
                                      <EditRoundedIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton onClick={() => handleDeleteCc(cc.id)} disabled={isRowBusy} aria-label="Eliminar" size="small" color="error">
                                      <DeleteOutlineRoundedIcon fontSize="small" />
                                    </IconButton>
                                  </>
                                )
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </Paper>
            </CardContent>
          </MotionCard>
        )}
      </AnimatePresence>

      <Dialog 
        open={deleteConfirmOpen} 
        onClose={closeDeleteConfirm} 
        fullWidth 
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Eliminar usuario</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" fontWeight={500}>
              ¿Eliminar el perfil de <strong>{deleteTargetUser?.displayName || 'este usuario'}</strong>?
            </Typography>
            <Alert severity="warning" sx={{ borderRadius: 2, fontWeight: 500 }}>
              La cuenta de acceso puede seguir activa hasta que se elimine manualmente en Firebase Auth.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeDeleteConfirm} disabled={deleting} sx={{ fontWeight: 600 }}>Cancelar</Button>
          <Button 
            color="error" 
            variant="contained" 
            onClick={handleDeleteUser} 
            disabled={deleting}
            sx={{ borderRadius: 2, fontWeight: 700 }}
          >
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={editUserOpen}
        onClose={closeEditUser}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Permisos de usuario</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
              Ajusta rol y permisos. Esto resuelve errores como <strong>Missing or insufficient permissions</strong>.
            </Typography>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Usuario</Typography>
              <Typography variant="body1" fontWeight={700}>{editUserTarget?.displayName || '—'}</Typography>
              <Typography variant="body2" color="text.secondary">{editUserTarget?.email || '—'}</Typography>
            </Paper>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                select
                label="Rol"
                value={userForm.role}
                onChange={(e) => setUserForm((current) => ({ ...current, role: e.target.value }))}
                fullWidth
                disabled={!canManageUsers || savingUser}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                <MenuItem value="worker">worker</MenuItem>
                <MenuItem value="trabajador">trabajador</MenuItem>
                <MenuItem value="supervisor">supervisor</MenuItem>
                <MenuItem value="finance_clerk">finance_clerk</MenuItem>
                <MenuItem value="gerencia">gerencia</MenuItem>
                <MenuItem value="admin">admin</MenuItem>
              </TextField>

              <FormControlLabel
                control={(
                  <Switch
                    checked={Boolean(userForm.active)}
                    onChange={(e) => setUserForm((current) => ({ ...current, active: e.target.checked }))}
                    disabled={!canManageUsers || savingUser}
                    color="success"
                  />
                )}
                label={userForm.active ? 'Activo' : 'Inactivo'}
                sx={{ '& .MuiFormControlLabel-label': { fontSize: '0.9rem', fontWeight: 700 } }}
              />
            </Stack>

            {(userForm.role === 'supervisor') && (
              <TextField
                select
                label="Centros de costo (supervisor)"
                value={userForm.centerCosts}
                onChange={(e) => setUserForm((current) => ({ ...current, centerCosts: e.target.value }))}
                fullWidth
                disabled={!canManageUsers || savingUser}
                SelectProps={{
                  multiple: true,
                  renderValue: (selected) => (selected?.length ? selected.join(', ') : '—'),
                }}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                {costCenters
                  .filter((cc) => cc?.active !== false)
                  .map((cc) => (
                    <MenuItem key={cc.id} value={cc.name}>{cc.name}</MenuItem>
                  ))}
              </TextField>
            )}

            {(userForm.role === 'worker' || userForm.role === 'trabajador') && (
              <>
                <TextField
                  select
                  label="Vincular a trabajador"
                  value={userForm.workerId || ''}
                  onChange={(e) => handlePickWorker(e.target.value)}
                  fullWidth
                  disabled={!canManageUsers || savingUser}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                >
                  <MenuItem value="">Sin vincular</MenuItem>
                  {workers.map((w) => (
                    <MenuItem key={w.id} value={w.id}>
                      {w.fullName} {w.rut ? `· ${w.rut}` : ''} {w.centerCost ? `· ${w.centerCost}` : ''}
                    </MenuItem>
                  ))}
                </TextField>

                <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                  <TextField
                    label="Nombre visible"
                    value={userForm.displayName}
                    onChange={(e) => setUserForm((current) => ({ ...current, displayName: e.target.value }))}
                    fullWidth
                    disabled={!canManageUsers || savingUser}
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                  />
                  <TextField
                    label="RUT"
                    value={userForm.rut}
                    onChange={(e) => setUserForm((current) => ({ ...current, rut: e.target.value }))}
                    fullWidth
                    disabled={!canManageUsers || savingUser}
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                  />
                </Stack>

                <TextField
                  select
                  label="Centro(s) de costo (worker)"
                  value={userForm.centerCosts}
                  onChange={(e) => setUserForm((current) => ({ ...current, centerCosts: e.target.value }))}
                  fullWidth
                  disabled={!canManageUsers || savingUser}
                  SelectProps={{
                    multiple: true,
                    renderValue: (selected) => (selected?.length ? selected.join(', ') : '—'),
                  }}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                >
                  {costCenters
                    .filter((cc) => cc?.active !== false)
                    .map((cc) => (
                      <MenuItem key={cc.id} value={cc.name}>{cc.name}</MenuItem>
                    ))}
                </TextField>

                <Alert severity="info" sx={{ borderRadius: 2, fontWeight: 500 }}>
                  Para crear borradores y solicitudes como trabajador, el usuario debe estar <strong>Activo</strong> y tener <strong>workerId</strong> vinculado.
                </Alert>
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeEditUser} disabled={savingUser} sx={{ fontWeight: 600 }}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleSaveUserPermissions}
            disabled={!canManageUsers || savingUser}
            sx={{ borderRadius: 2, fontWeight: 800 }}
          >
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
