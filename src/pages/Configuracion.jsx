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
  useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
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

const MotionBox = motion(Box);
const MotionCard = motion(Card);

export default function Configuracion() {
  const theme = useTheme();
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
                      sx={{ borderRadius: 2, fontWeight: 600, bgcolor: 'rgba(0,0,0,0.04)' }}
                    />
                  ))
                )}
              </Stack>
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
    </Box>
  );
}
