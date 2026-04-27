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
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import { useAuth } from '../contexts/AuthContext';
import {
  createCostCenter,
  deleteCostCenter,
  deleteUser,
  subscribeCostCenters,
  subscribeUsers,
  updateUser,
} from '../lib/repository';

export default function Configuracion() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState(0);
  const [newCc, setNewCc] = useState('');
  const [creatingCc, setCreatingCc] = useState(false);

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
    return () => { unsubscribeUsers(); unsubscribeCostCenters(); };
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

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Configuración</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Gestión de usuarios, roles y centros de costo.
      </Typography>

      <Tabs value={tab} onChange={(_, val) => setTab(val)} sx={{ mb: 2 }}>
        <Tab label="Usuarios" />
        <Tab label="Centros de Costo" />
      </Tabs>

      {loading && tab === 0 ? <LinearProgress sx={{ mb: 2 }} /> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {successMessage ? <Alert severity="success" sx={{ mb: 2 }}>{successMessage}</Alert> : null}

      {tab === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Usuarios del sistema</Typography>
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Nombre</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>RUT</TableCell>
                    <TableCell>Rol</TableCell>
                    <TableCell>Estado</TableCell>
                    <TableCell align="right">Acciones</TableCell>
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
                    sortedUsers.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.displayName}</TableCell>
                        <TableCell>{item.email}</TableCell>
                        <TableCell>{item.rut || '—'}</TableCell>
                        <TableCell>
                          <Chip label={item.role} size="small" variant="outlined" />
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
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              startIcon={<DeleteOutlineRoundedIcon />}
                              onClick={() => openDeleteConfirm(item)}
                            >
                              Eliminar
                            </Button>
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
      )}

      {tab === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>Centros de Costo</Typography>
            {canManageUsers && (
              <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
                <TextField
                  label="Nuevo centro de costo"
                  value={newCc}
                  onChange={(e) => setNewCc(e.target.value)}
                  size="small"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreateCc(); }}
                />
                <Button
                  variant="contained"
                  startIcon={<AddCircleOutlineRoundedIcon />}
                  onClick={handleCreateCc}
                  disabled={creatingCc || !newCc.trim()}
                >
                  Crear
                </Button>
              </Stack>
            )}
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {costCenters.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No hay centros de costo registrados.
                </Typography>
              ) : (
                costCenters.map((cc) => (
                  <Chip
                    key={cc.id}
                    label={cc.name}
                    onDelete={canManageUsers ? () => handleDeleteCc(cc.id) : undefined}
                  />
                ))
              )}
            </Stack>
          </CardContent>
        </Card>
      )}

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
          <Button color="error" variant="contained" onClick={handleDeleteUser} disabled={deleting}>
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
