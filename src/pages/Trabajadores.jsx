import { useEffect, useMemo, useState } from 'react';
import { createInternalUser, sendPasswordSetupEmail } from '../lib/admin';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ReportProblem';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {
  createWorker,
  createWorkersBatch,
  subscribeCostCenters,
  subscribeReimbursements,
  subscribeUsers,
  subscribeWorkers,
  updateWorker,
} from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatShortDate } from '../lib/formatters';

const MotionBox = motion(Box);
const MotionCard = motion(Card);

const CSV_STEPS = ['Descargar plantilla', 'Subir archivo', 'Vista previa', 'Finalizar'];

const INITIAL_MANUAL_FORM = {
  fullName: '',
  rut: '',
  email: '',
  centerCost: '',
  supervisorId: '',
  active: true,
  // Campos extendidos
  employeeCode: '',
  department: '',
  phone: '',
  // Datos bancarios
  bankName: '',
  bankAccountType: '',
  bankAccountNumber: '',
};

export default function Trabajadores() {
  const theme = useTheme();
  const { profile, user } = useAuth();
  const [manualOpen, setManualOpen] = useState(false);
  const [manualForm, setManualForm] = useState(INITIAL_MANUAL_FORM);
  const [creating, setCreating] = useState(false);
  const [manualError, setManualError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState(INITIAL_MANUAL_FORM);
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activateLoading, setActivateLoading] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [parsedRows, setParsedRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  const [workers, setWorkers] = useState([]);
  const [reimbursements, setReimbursements] = useState([]);
  const [users, setUsers] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState(null);
  const [showSensitive, setShowSensitive] = useState(false);

  const importSummary = useMemo(() => {
    if (!selectedFileName) return 'Aún no hay archivo cargado para validar.';
    const validCount = parsedRows.filter((r) => !r.error).length;
    const errorCount = parsedRows.filter((r) => r.error).length;
    return `Archivo: ${selectedFileName} (${validCount} válidos, ${errorCount} con error)`;
  }, [selectedFileName, parsedRows]);

  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.id === selectedWorkerId) ?? null,
    [selectedWorkerId, workers],
  );

  const linkedUser = useMemo(
    () => users.find((user) => user.email === selectedWorker?.email || user.workerId === selectedWorker?.id) ?? null,
    [selectedWorker, users],
  );

  const handleCreateCredentials = async () => {
    try {
      await createInternalUser({
        email: selectedWorker.email,
        displayName: selectedWorker.fullName,
        role: 'worker',
        rut: selectedWorker.rut || '',
        centerCosts: selectedWorker.centerCost ? [selectedWorker.centerCost] : [],
        workerId: selectedWorker.id,
        createdBy: user?.uid || 'admin',
      });
      alert(`Credenciales creadas. Email enviado a ${selectedWorker.email}`);
    } catch (err) {
      if (err.message.includes('EMAIL_EXISTS')) {
        alert('Este correo ya tiene credenciales asociadas.');
      } else {
        alert('Error creando credenciales: ' + err.message);
      }
    }
  };

  const handleSendCredentials = async (type) => {
    try {
      await sendPasswordSetupEmail(linkedUser.email);
      alert(`Enlace de ${type === 'setup' ? 'configuración' : 'cambio de contraseña'} enviado a ${linkedUser.email}`);
    } catch (err) {
      alert('Error enviando correo: ' + err.message);
    }
  };

  // TODO: diferenciación gerencia vs admin
  const isAdmin = profile?.role === 'admin' || profile?.role === 'gerencia';

  const maskSensitiveValue = (value) => {
    if (!value) return '•••••••';
    return '•••••••';
  };

  const sensitiveTextSx = showSensitive ? {} : {
    filter: 'blur(4px)',
    userSelect: 'none',
    pointerEvents: 'none',
  };

  useEffect(() => {
    const unsubscribeWorkers = subscribeWorkers(
      { profile },
      (items) => { setWorkers(items); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );

    const unsubscribeReimbursements = subscribeReimbursements(
      { profile },
      (items) => setReimbursements(items),
      (err) => setError(err.message),
    );

    const unsubscribeUsers = subscribeUsers(
      {},
      (items) => setUsers(items),
    );

    const unsubscribeCostCenters = subscribeCostCenters(
      (items) => setCostCenters(items),
      (err) => setError(err.message),
    );

    return () => {
      unsubscribeWorkers();
      unsubscribeReimbursements();
      unsubscribeUsers();
      unsubscribeCostCenters();
    };
  }, [profile]);

  const handleManualSave = async () => {
    setCreating(true);
    setManualError('');
    try {
      const workerId = `wkr-${crypto.randomUUID().slice(0, 8)}`;
      const supervisor = users.find((u) => u.id === manualForm.supervisorId);
      
      await createWorker({
        ...manualForm,
        id: workerId,
        supervisorName: supervisor?.displayName || '',
      });
      
      await createInternalUser({
        email: manualForm.email,
        displayName: manualForm.fullName,
        role: manualForm.role || 'worker',
        rut: manualForm.rut,
        centerCosts: manualForm.centerCost ? [manualForm.centerCost] : [],
        bankName: manualForm.bankName,
        bankAccountType: manualForm.bankAccountType,
        bankAccountNumber: manualForm.bankAccountNumber,
        workerId: workerId,
        createdBy: user?.uid || 'admin',
      });

      alert(`Se envió un correo a ${manualForm.email} para que el usuario configure su contraseña`);
      setManualOpen(false);
      setManualForm(INITIAL_MANUAL_FORM);
    } catch (err) {
      setManualError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const resetEditDialog = () => {
    setEditOpen(false);
    setEditing(false);
    setEditError('');
    setEditForm(INITIAL_MANUAL_FORM);
  };

  const handleOpenEditDialog = () => {
    if (!selectedWorker) return;

    setEditForm({
      fullName: selectedWorker.fullName || '',
      rut: selectedWorker.rut || '',
      email: selectedWorker.email || '',
      centerCost: selectedWorker.centerCost || '',
      supervisorId: selectedWorker.supervisorId || '',
      active: selectedWorker.active !== false,
      employeeCode: selectedWorker.employeeCode || '',
      department: selectedWorker.department || '',
      phone: selectedWorker.phone || '',
      bankName: selectedWorker.bankName || '',
      bankAccountType: selectedWorker.bankAccountType || '',
      bankAccountNumber: selectedWorker.bankAccountNumber || '',
    });
    setEditError('');
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    if (!selectedWorker) return;

    setEditing(true);
    setEditError('');

    try {
      const supervisor = users.find((item) => item.id === editForm.supervisorId);
      await updateWorker(selectedWorker.id, {
        ...editForm,
        supervisorName: supervisor?.displayName || '',
      });
      resetEditDialog();
    } catch (editSaveError) {
      setEditError(editSaveError.message);
    } finally {
      setEditing(false);
    }
  };

  const handleSoftDelete = async () => {
    if (!selectedWorker) return;

    setDeleting(true);
    try {
      await updateWorker(selectedWorker.id, { active: false });
      setDeleteConfirmOpen(false);
      setSelectedWorkerId(null);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedWorker) return;

    setActivateLoading(true);
    try {
      await updateWorker(selectedWorker.id, { active: true });
      setSelectedWorkerId(null);
    } catch (activateError) {
      setError(activateError.message);
    } finally {
      setActivateLoading(false);
    }
  };

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].toLowerCase().split(',').map((h) => h.trim());
    const dataRows = lines.slice(1);

    return dataRows.map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const row = {};
      headers.forEach((header, index) => {
        row[header] = values[index];
      });

      // Validation logic
      let rowError = '';
      if (!row.rut || !row.nombre_completo) {
        rowError = 'RUT y Nombre son obligatorios';
      } else if (workers.some((w) => w.rut === row.rut)) {
        rowError = 'RUT ya existe en el sistema';
      } else if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        rowError = 'Formato de email corporativo inválido';
      } else if (row.email_personal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email_personal)) {
        rowError = 'Formato de email personal inválido';
      }

      // Match supervisor by email or name
      const supervisor = users.find(
        (u) => u.email === row.supervisor || u.displayName === row.supervisor,
      );

      return {
        ...row,
        supervisorId: supervisor?.id || '',
        supervisorName: supervisor?.displayName || row.supervisor || '',
        error: rowError,
      };
    });
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const rows = parseCSV(text);
      setParsedRows(rows);
      setSelectedFileName(file.name);
      setActiveStep(2);
    };
    reader.readAsText(file);
  };

  const handleFinalImport = async () => {
    setImporting(true);
    setImportError('');
    const validRows = parsedRows.filter((r) => !r.error);

    try {
      const workersData = validRows.map((row) => ({
        fullName: row.nombre_completo,
        rut: row.rut,
        email: row.email || '',
        centerCost: row.centro_costo || '',
        supervisorId: row.supervisorId,
        supervisorName: row.supervisorName,
        employeeCode: row.codigo_empleado || '',
        department: row.departamento || '',
        phone: row.telefono || '',
        bankName: row.banco || '',
        bankAccountType: row.tipo_cuenta || '',
        bankAccountNumber: row.numero_cuenta || '',
      }));

      await createWorkersBatch(workersData);
      setActiveStep(3);
    } catch (err) {
      setImportError(`Error durante la importación: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const resetImportDialog = () => {
    setImportOpen(false);
    setActiveStep(0);
    setSelectedFileName('');
    setParsedRows([]);
    setImportError('');
  };

  const nextStep = () => {
    if (activeStep === 2) {
      handleFinalImport();
    } else {
      setActiveStep((current) => Math.min(current + 1, CSV_STEPS.length - 1));
    }
  };
  const previousStep = () => setActiveStep((current) => Math.max(current - 1, 0));

  const requestCountByWorker = useMemo(() => reimbursements.reduce((accumulator, item) => {
    accumulator.set(item.workerId, (accumulator.get(item.workerId) ?? 0) + 1);
    return accumulator;
  }, new Map()), [reimbursements]);

  const handleDownloadTemplate = () => {
    const content = [
      'rut,nombre_completo,email,centro_costo,supervisor,codigo_empleado,departamento,telefono,banco,tipo_cuenta,numero_cuenta',
      '11.111.111-1,Ana Perez,ana.perez@gmtingenieria.com,Operaciones Norte,Mauricio Diaz,EMP001,Mantenimiento,+56912345678,Banco Estado,Cuenta RUT,111111111',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plantilla_trabajadores_gmt.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box sx={{ pb: 4 }}>
      <MotionBox
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={800}>Trabajadores</Typography>
          <Typography variant="body2" color="text.secondary">Maestro de trabajadores de GMT</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button 
            variant="contained" 
            startIcon={<AddOutlinedIcon />} 
            onClick={() => setManualOpen(true)}
            sx={{ borderRadius: 2.5, fontWeight: 700, textTransform: 'none', px: 3 }}
          >
            Crear manualmente
          </Button>
          <Button 
            variant="outlined" 
            startIcon={<UploadFileOutlinedIcon />} 
            onClick={() => setImportOpen(true)}
            sx={{ borderRadius: 2.5, fontWeight: 600, textTransform: 'none' }}
          >
            Importar CSV
          </Button>
        </Stack>
      </MotionBox>

      <Stack spacing={3}>
        <MotionCard
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
        >
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
              <Box>
                <Typography variant="h6" sx={{ mb: 0.75 }} fontWeight={700}>
                  Gestión integral de trabajadores
                </Typography>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  Carga individual o masiva con validación automática de duplicados y asignación de supervisores.
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </MotionCard>

        <MotionCard
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
        >
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }} fontWeight={700}>
              Trabajadores cargados
            </Typography>
            {loading ? <LinearProgress sx={{ mb: 2, borderRadius: 2 }} /> : null}
            {error ? <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert> : null}
            
            {!loading && workers.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Typography color="text.secondary">No hay trabajadores registrados.</Typography>
              </Box>
            ) : (
              <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>RUT</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Área</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Supervisor</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Solicitudes</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <AnimatePresence mode="wait">
                      {workers.map((row, idx) => (
                        <TableRow
                          key={row.id}
                          hover
                          onClick={() => {
                            setShowSensitive(false);
                            setSelectedWorkerId(row.id);
                          }}
                          sx={{ 
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'rgba(0,0,0,0.02) !important' },
                            transition: 'background-color 0.2s'
                          }}
                          component={motion.tr}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: idx * 0.03 }}
                        >
                          <TableCell sx={{ fontWeight: 600 }}>{row.fullName}</TableCell>
                          <TableCell sx={{ fontWeight: 500 }}>{row.rut}</TableCell>
                          <TableCell sx={{ fontWeight: 500 }}>{row.centerCost}</TableCell>
                          <TableCell sx={{ fontWeight: 500 }}>{row.supervisorName}</TableCell>
                          <TableCell align="center">
                            <Chip 
                              label={requestCountByWorker.get(row.id) ?? 0} 
                              size="small" 
                              sx={{ borderRadius: 1.5, fontWeight: 700, minWidth: 32 }} 
                            />
                          </TableCell>
                          <TableCell>
                            <Chip 
                              label={row.active ? 'Activo' : 'Inactivo'} 
                              color={row.active ? 'success' : 'default'}
                              size="small"
                              variant="outlined"
                              sx={{ borderRadius: 1.5, fontWeight: 700, fontSize: '0.7rem' }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </AnimatePresence>
                  </TableBody>
                </Table>
              </Paper>
            )}
          </CardContent>
        </MotionCard>
      </Stack>

      <Dialog
        open={Boolean(selectedWorker)}
        onClose={() => {
          setShowSensitive(false);
          setSelectedWorkerId(null);
        }}
        fullWidth
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Detalle del trabajador</DialogTitle>
        <DialogContent>
          {selectedWorker ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {!showSensitive ? (
                <Alert severity="warning" sx={{ borderRadius: 2, fontWeight: 500 }}>
                  Datos bancarios sensibles. Visibilidad restringida.
                </Alert>
              ) : null}

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.01)', borderColor: 'rgba(0,0,0,0.05)' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Nombre</Typography>
                    <Typography variant="body1" fontWeight={700} sx={{ mb: 1 }}>{selectedWorker.fullName}</Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>RUT</Typography>
                    <Typography variant="body1" sx={{ ...sensitiveTextSx, fontWeight: 500, mb: 1 }}>
                      {showSensitive ? (selectedWorker.rut || '—') : maskSensitiveValue(selectedWorker.rut)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Ingreso</Typography>
                    <Typography variant="body1" fontWeight={500}>{formatShortDate(selectedWorker.joinedAt)}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Acceso al sistema</Typography>
                    {linkedUser ? (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        <Chip 
                          label={`Con credenciales (${linkedUser.role})`} 
                          color="success" 
                          size="small" 
                          sx={{ borderRadius: 1.5, fontWeight: 700 }}
                        />
                        <Button 
                          size="small" 
                          variant="outlined" 
                          onClick={() => handleSendCredentials('setup')}
                          sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600 }}
                        >
                          Reenviar credenciales
                        </Button>
                        <Button 
                          size="small" 
                          variant="outlined" 
                          onClick={() => handleSendCredentials('reset')}
                          sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 600 }}
                        >
                          Cambio de contraseña
                        </Button>
                      </Stack>
                    ) : (
                      <Stack spacing={1} sx={{ mt: 1 }}>
                        <Chip 
                          label="Sin credenciales" 
                          color="default" 
                          size="small" 
                          sx={{ borderRadius: 1.5, fontWeight: 700 }}
                        />
                        <Button 
                          size="small" 
                          variant="contained" 
                          onClick={handleCreateCredentials}
                          sx={{ borderRadius: 1.5, textTransform: 'none', fontWeight: 700 }}
                        >
                          Crear credenciales
                        </Button>
                      </Stack>
                    )}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Correo corporativo</Typography>
                    <Typography variant="body1" fontWeight={500} sx={{ mb: 1 }}>{selectedWorker.email}</Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Teléfono</Typography>
                    <Typography variant="body1" fontWeight={500}>{selectedWorker.phone || '—'}</Typography>
                  </Box>
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.01)', borderColor: 'rgba(0,0,0,0.05)' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" fontWeight={700}>
                    Cuenta bancaria
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => setShowSensitive((current) => !current)}
                    aria-label={showSensitive ? 'Ocultar datos sensibles' : 'Mostrar datos sensibles'}
                  >
                    {showSensitive ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}
                  </IconButton>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ ...sensitiveTextSx, fontWeight: 500 }}>
                  {showSensitive
                    ? `${selectedWorker.bankName || '—'} · ${selectedWorker.bankAccountType || '—'}`
                    : `${maskSensitiveValue(selectedWorker.bankName)} · ${maskSensitiveValue(selectedWorker.bankAccountType)}`}
                </Typography>
                <Typography variant="h6" sx={{ ...sensitiveTextSx, fontWeight: 800 }}>
                  {showSensitive ? (selectedWorker.bankAccountNumber || '—') : maskSensitiveValue(selectedWorker.bankAccountNumber)}
                </Typography>
              </Paper>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {isAdmin ? (
            <>
              <Button 
                startIcon={<EditOutlinedIcon />} 
                onClick={handleOpenEditDialog}
                sx={{ fontWeight: 600 }}
              >
                Editar
              </Button>
              {selectedWorker?.active === false ? (
                <Button
                  color="success"
                  startIcon={<CheckCircleOutlineIcon />}
                  onClick={handleActivate}
                  disabled={activateLoading}
                  sx={{ fontWeight: 700 }}
                >
                  {activateLoading ? <CircularProgress size={24} color="inherit" /> : 'Activar'}
                </Button>
              ) : (
                <Button
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={() => setDeleteConfirmOpen(true)}
                  sx={{ fontWeight: 700 }}
                >
                  Eliminar
                </Button>
              )}
            </>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button
            onClick={() => {
              setShowSensitive(false);
              setSelectedWorkerId(null);
            }}
            sx={{ fontWeight: 600 }}
          >
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={editOpen} 
        onClose={() => !editing && resetEditDialog()} 
        fullWidth 
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Editar trabajador</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {editError ? <Alert severity="error" sx={{ borderRadius: 2 }}>{editError}</Alert> : null}
            
            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }} fontWeight={700}>Información General</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Nombre completo"
                  fullWidth
                  value={editForm.fullName}
                  onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))}
                  disabled={editing}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
                <TextField
                  label="RUT"
                  fullWidth
                  placeholder="12.345.678-9"
                  value={editForm.rut}
                  onChange={(event) => setEditForm((current) => ({ ...current, rut: event.target.value }))}
                  disabled={editing}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
              </Stack>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Correo corporativo"
                type="email"
                fullWidth
                value={editForm.email}
                onChange={(event) => setEditForm((current) => ({ ...current, email: event.target.value }))}
                disabled={editing}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Centro de costo"
                fullWidth
                value={editForm.centerCost}
                onChange={(event) => setEditForm((current) => ({ ...current, centerCost: event.target.value }))}
                disabled={editing}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                {costCenters.map((cc) => (
                  <MenuItem key={cc.id} value={cc.name}>
                    {cc.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Supervisor"
                fullWidth
                value={editForm.supervisorId}
                onChange={(event) => setEditForm((current) => ({ ...current, supervisorId: event.target.value }))}
                disabled={editing}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                {users.map((item) => (
                  <MenuItem key={item.id} value={item.id}>
                    {item.displayName}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }} fontWeight={700}>Información Adicional</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Departamento / Área"
                  fullWidth
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  disabled={editing}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
                <TextField
                  label="Teléfono"
                  fullWidth
                  value={editForm.phone}
                  onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  disabled={editing}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }} fontWeight={700}>Datos Bancarios</Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Banco"
                    fullWidth
                    value={editForm.bankName}
                    onChange={(e) => setEditForm({ ...editForm, bankName: e.target.value })}
                    disabled={editing}
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                  />
                  <TextField
                    select
                    label="Tipo de cuenta"
                    fullWidth
                    value={editForm.bankAccountType}
                    onChange={(e) => setEditForm({ ...editForm, bankAccountType: e.target.value })}
                    disabled={editing}
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                  >
                    <MenuItem value="Cuenta Corriente">Cuenta Corriente</MenuItem>
                    <MenuItem value="Cuenta Vista">Cuenta Vista</MenuItem>
                    <MenuItem value="Cuenta RUT">Cuenta RUT</MenuItem>
                    <MenuItem value="Cuenta de Ahorro">Cuenta de Ahorro</MenuItem>
                  </TextField>
                </Stack>
                <TextField
                  label="Número de cuenta"
                  fullWidth
                  value={editForm.bankAccountNumber}
                  onChange={(e) => setEditForm({ ...editForm, bankAccountNumber: e.target.value })}
                  disabled={editing}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
              </Stack>
            </Box>

          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={resetEditDialog} disabled={editing} sx={{ fontWeight: 600 }}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleEditSave}
            disabled={editing || !editForm.fullName || !editForm.rut}
            sx={{ borderRadius: 3, fontWeight: 800, px: 3 }}
          >
            {editing ? <CircularProgress size={24} color="inherit" /> : 'Guardar cambios'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={deleteConfirmOpen} 
        onClose={() => !deleting && setDeleteConfirmOpen(false)} 
        fullWidth 
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Desactivar trabajador</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1, fontWeight: 500 }}>
            ¿Seguro que quieres desactivar a <strong>{selectedWorker?.fullName || 'este trabajador'}</strong>? No se borrará el historial; solo quedará inactivo.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={deleting} sx={{ fontWeight: 600 }}>Atrás</Button>
          <Button color="error" variant="contained" onClick={handleSoftDelete} disabled={deleting} sx={{ borderRadius: 2, fontWeight: 700 }}>
            {deleting ? <CircularProgress size={24} color="inherit" /> : 'Confirmar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={manualOpen} 
        onClose={() => !creating && setManualOpen(false)} 
        fullWidth 
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Crear trabajador manualmente</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {manualError && <Alert severity="error" sx={{ borderRadius: 2 }}>{manualError}</Alert>}
            
            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }} fontWeight={700}>Información General</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Nombre completo"
                  fullWidth
                  value={manualForm.fullName}
                  onChange={(e) => setManualForm({ ...manualForm, fullName: e.target.value })}
                  disabled={creating}
                  required
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
                <TextField
                  label="RUT"
                  fullWidth
                  placeholder="12.345.678-9"
                  value={manualForm.rut}
                  onChange={(e) => setManualForm({ ...manualForm, rut: e.target.value })}
                  disabled={creating}
                  required
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
              </Stack>
            </Box>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Correo corporativo"
                type="email"
                fullWidth
                value={manualForm.email}
                onChange={(e) => setManualForm({ ...manualForm, email: e.target.value })}
                disabled={creating}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField
                select
                label="Rol"
                fullWidth
                value={manualForm.role || 'worker'}
                onChange={(e) => setManualForm({ ...manualForm, role: e.target.value })}
                disabled={creating}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                <MenuItem value="worker">Trabajador</MenuItem>
                <MenuItem value="supervisor">Supervisor</MenuItem>
                <MenuItem value="admin">Admin</MenuItem>
                <MenuItem value="gerencia">Gerencia</MenuItem>
                <MenuItem value="finance_clerk">Finanzas</MenuItem>
              </TextField>
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Centro de costo"
                fullWidth
                value={manualForm.centerCost}
                onChange={(e) => setManualForm({ ...manualForm, centerCost: e.target.value })}
                disabled={creating}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                {costCenters.map((cc) => (
                  <MenuItem key={cc.id} value={cc.name}>
                    {cc.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Supervisor"
                fullWidth
                value={manualForm.supervisorId}
                onChange={(e) => setManualForm({ ...manualForm, supervisorId: e.target.value })}
                disabled={creating}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                {users.map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.displayName}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }} fontWeight={700}>Información Adicional</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Departamento / Área"
                  fullWidth
                  value={manualForm.department}
                  onChange={(e) => setManualForm({ ...manualForm, department: e.target.value })}
                  disabled={creating}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
                <TextField
                  label="Teléfono"
                  fullWidth
                  value={manualForm.phone}
                  onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })}
                  disabled={creating}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }} fontWeight={700}>Datos Bancarios</Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Banco"
                    fullWidth
                    value={manualForm.bankName}
                    onChange={(e) => setManualForm({ ...manualForm, bankName: e.target.value })}
                    disabled={creating}
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                  />
                  <TextField
                    select
                    label="Tipo de cuenta"
                    fullWidth
                    value={manualForm.bankAccountType}
                    onChange={(e) => setManualForm({ ...manualForm, bankAccountType: e.target.value })}
                    disabled={creating}
                    variant="outlined"
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                  >
                    <MenuItem value="Cuenta Corriente">Cuenta Corriente</MenuItem>
                    <MenuItem value="Cuenta Vista">Cuenta Vista</MenuItem>
                    <MenuItem value="Cuenta RUT">Cuenta RUT</MenuItem>
                    <MenuItem value="Cuenta de Ahorro">Cuenta de Ahorro</MenuItem>
                  </TextField>
                </Stack>
                <TextField
                  label="Número de cuenta"
                  fullWidth
                  value={manualForm.bankAccountNumber}
                  onChange={(e) => setManualForm({ ...manualForm, bankAccountNumber: e.target.value })}
                  disabled={creating}
                  variant="outlined"
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                />
              </Stack>
            </Box>

          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setManualOpen(false)} disabled={creating} sx={{ fontWeight: 600 }}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleManualSave}
            disabled={creating || !manualForm.fullName || !manualForm.rut}
            sx={{ borderRadius: 3, fontWeight: 800, px: 3 }}
          >
            {creating ? <CircularProgress size={24} color="inherit" /> : 'Guardar trabajador'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={importOpen} 
        onClose={resetImportDialog} 
        fullWidth 
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Importar trabajadores por CSV</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} sx={{ py: 1.5 }}>
            {CSV_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel sx={{ '& .MuiStepLabel-label': { fontWeight: 600, fontSize: '0.8rem' } }}>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Box sx={{ minHeight: 200, mt: 2 }}>
            <AnimatePresence mode="wait">
              {activeStep === 0 && (
                <MotionBox
                  key="step0"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  spacing={2}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontWeight: 500 }}>
                    Descarga la plantilla base antes de preparar el archivo definitivo.
                  </Typography>
                  <Button 
                    variant="outlined" 
                    startIcon={<UploadFileOutlinedIcon />} 
                    onClick={handleDownloadTemplate}
                    sx={{ borderRadius: 2, fontWeight: 600, textTransform: 'none' }}
                  >
                    Descargar plantilla
                  </Button>
                </MotionBox>
              )}

              {activeStep === 1 && (
                <MotionBox
                  key="step1"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  spacing={2}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontWeight: 500 }}>
                    Sube el archivo preparado. El siguiente paso mostrará una tabla de validación previa.
                  </Typography>
                  <Button component="label" variant="contained" sx={{ borderRadius: 2, fontWeight: 700, textTransform: 'none' }}>
                    Seleccionar archivo CSV
                    <input hidden type="file" accept=".csv" onChange={handleFileChange} />
                  </Button>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, fontWeight: 600 }}>
                    {selectedFileName || 'Sin archivo seleccionado'}
                  </Typography>
                </MotionBox>
              )}

              {activeStep === 2 && (
                <MotionBox
                  key="step2"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  spacing={2}
                >
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontWeight: 500 }}>
                    {importSummary}
                  </Typography>
                  {importError && <Alert severity="error" sx={{ borderRadius: 2, mb: 2 }}>{importError}</Alert>}
                  <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>RUT</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Nombre</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Centro de costo</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {parsedRows.map((row, index) => (
                          <TableRow key={index} sx={{ bgcolor: row.error ? 'error.light' : 'inherit' }}>
                            <TableCell sx={{ fontWeight: 500 }}>{row.rut}</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{row.nombre_completo}</TableCell>
                            <TableCell sx={{ fontWeight: 500 }}>{row.centro_costo}</TableCell>
                            <TableCell>
                              {row.error ? (
                                <Chip
                                  icon={<ErrorOutlineIcon />}
                                  label={row.error}
                                  color="error"
                                  size="small"
                                  variant="outlined"
                                  sx={{ borderRadius: 1.5, fontWeight: 700 }}
                                />
                              ) : (
                                <Chip label="Válido" color="success" size="small" variant="outlined" sx={{ borderRadius: 1.5, fontWeight: 700 }} />
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Paper>
                </MotionBox>
              )}

              {activeStep === 3 && (
                <MotionBox
                  key="step3"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  sx={{ py: 4, alignItems: 'center', textAlign: 'center' }}
                >
                  <CheckCircleOutlineIcon color="success" sx={{ fontSize: 64, mb: 2 }} />
                  <Typography variant="h6" fontWeight={800}>Importación completada</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3, fontWeight: 500 }}>
                    Los trabajadores válidos han sido incorporados al maestro exitosamente.
                  </Typography>
                  <Button variant="contained" onClick={resetImportDialog} sx={{ borderRadius: 2, fontWeight: 700, px: 4 }}>Entendido</Button>
                </MotionBox>
              )}
            </AnimatePresence>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, visibility: activeStep === 3 ? 'hidden' : 'visible' }}>
          <Button onClick={resetImportDialog} disabled={importing} sx={{ fontWeight: 600 }}>Cerrar</Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={previousStep} disabled={activeStep === 0 || importing} sx={{ fontWeight: 600 }}>
            Atrás
          </Button>
          <Button
            variant="contained"
            onClick={nextStep}
            disabled={(activeStep === 1 && !selectedFileName) || importing || (activeStep === 2 && parsedRows.filter(r => !r.error).length === 0)}
            sx={{ borderRadius: 2, fontWeight: 800, px: 3 }}
          >
            {importing ? <CircularProgress size={24} color="inherit" /> : activeStep === 2 ? 'Importar válidos' : 'Siguiente'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
