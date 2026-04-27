import { useEffect, useMemo, useState } from 'react';
import { createInternalUser } from '../lib/admin';
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
} from '@mui/material';
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
  location: '',
  personalEmail: '',
  phone: '',
  address: '',
  // Datos bancarios
  bankName: '',
  bankAccountType: '',
  bankAccountNumber: '',
  // Emergencia
  emergencyContactName: '',
  emergencyContactPhone: '',
};

export default function Trabajadores() {
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
      { onlyRole: 'supervisor' },
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
      location: selectedWorker.location || '',
      personalEmail: selectedWorker.personalEmail || '',
      phone: selectedWorker.phone || '',
      address: selectedWorker.address || '',
      bankName: selectedWorker.bankName || '',
      bankAccountType: selectedWorker.bankAccountType || '',
      bankAccountNumber: selectedWorker.bankAccountNumber || '',
      emergencyContactName: selectedWorker.emergencyContactName || '',
      emergencyContactPhone: selectedWorker.emergencyContactPhone || '',
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
        location: row.ubicacion || '',
        personalEmail: row.email_personal || '',
        phone: row.telefono || '',
        address: row.direccion || '',
        bankName: row.banco || '',
        bankAccountType: row.tipo_cuenta || '',
        bankAccountNumber: row.numero_cuenta || '',
        emergencyContactName: row.contacto_emergencia_nombre || '',
        emergencyContactPhone: row.contacto_emergencia_telefono || '',
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
      'rut,nombre_completo,email,centro_costo,supervisor,codigo_empleado,departamento,ubicacion,email_personal,telefono,direccion,banco,tipo_cuenta,numero_cuenta,contacto_emergencia_nombre,contacto_emergencia_telefono',
      '11.111.111-1,Ana Perez,ana.perez@gmtingenieria.com,Operaciones Norte,Mauricio Diaz,EMP001,Mantenimiento,Antofagasta,ana.p@gmail.com,+56912345678,Av. Principal 123,Banco Estado,Cuenta RUT,111111111,Pedro Perez,+56987654321',
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
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5">Trabajadores</Typography>
          <Typography variant="body2" color="text.secondary">Maestro de trabajadores de GMT</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button variant="contained" startIcon={<AddOutlinedIcon />} onClick={() => setManualOpen(true)}>
            Crear manualmente
          </Button>
          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => setImportOpen(true)}>
            Importar CSV
          </Button>
        </Stack>
      </Box>

      <Stack spacing={3}>
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
              <Box>
                <Typography variant="h6" sx={{ mb: 0.75 }}>
                  Gestión integral de trabajadores
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Carga individual o masiva con validación automática de duplicados y asignación de supervisores.
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Trabajadores cargados
            </Typography>
            {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            
            {!loading && workers.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 8 }}>
                <Typography color="text.secondary">No hay trabajadores registrados.</Typography>
              </Box>
            ) : (
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Nombre</TableCell>
                      <TableCell>RUT</TableCell>
                      <TableCell>Área</TableCell>
                      <TableCell>Supervisor</TableCell>
                      <TableCell>Solicitudes</TableCell>
                      <TableCell>Estado</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workers.map((row) => (
                      <TableRow
                        key={row.id}
                        hover
                        onClick={() => {
                          setShowSensitive(false);
                          setSelectedWorkerId(row.id);
                        }}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell>{row.fullName}</TableCell>
                        <TableCell>{row.rut}</TableCell>
                        <TableCell>{row.centerCost}</TableCell>
                        <TableCell>{row.supervisorName}</TableCell>
                        <TableCell>{requestCountByWorker.get(row.id) ?? 0}</TableCell>
                        <TableCell>{row.active ? 'Activo' : 'Inactivo'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            )}
          </CardContent>
        </Card>
      </Stack>

      <Dialog
        open={Boolean(selectedWorker)}
        onClose={() => {
          setShowSensitive(false);
          setSelectedWorkerId(null);
        }}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Detalle del trabajador</DialogTitle>
        <DialogContent>
          {selectedWorker ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {!showSensitive ? (
                <Alert severity="warning">
                  Datos bancarios sensibles. Visibilidad restringida.
                </Alert>
              ) : null}

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                  <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary">Nombre</Typography>
                  <Typography variant="body1">{selectedWorker.fullName}</Typography>
                  <Typography variant="caption" color="text.secondary">RUT</Typography>
                  <Typography variant="body1" sx={sensitiveTextSx}>
                    {showSensitive ? (selectedWorker.rut || '—') : maskSensitiveValue(selectedWorker.rut)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">Ubicación</Typography>
                  <Typography variant="body1">{selectedWorker.location || 'N/A'}</Typography>
                  <Typography variant="caption" color="text.secondary">Ingreso</Typography>
                  <Typography variant="body1">{formatShortDate(selectedWorker.joinedAt)}</Typography>
                  </Box>

                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Correo corporativo</Typography>
                    <Typography variant="body1">{selectedWorker.email}</Typography>
                    <Typography variant="caption" color="text.secondary">Correo personal / teléfono</Typography>
                    <Typography variant="body1">{selectedWorker.personalEmail || '—'} · {selectedWorker.phone || '—'}</Typography>
                    <Typography variant="caption" color="text.secondary">Dirección</Typography>
                    <Typography variant="body1">{selectedWorker.address || '—'}</Typography>
                  </Box>
                </Stack>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2">
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
                <Typography variant="body2" color="text.secondary" sx={sensitiveTextSx}>
                  {showSensitive
                    ? `${selectedWorker.bankName || '—'} · ${selectedWorker.bankAccountType || '—'}`
                    : `${maskSensitiveValue(selectedWorker.bankName)} · ${maskSensitiveValue(selectedWorker.bankAccountType)}`}
                </Typography>
                <Typography variant="body1" sx={sensitiveTextSx}>
                  {showSensitive ? (selectedWorker.bankAccountNumber || '—') : maskSensitiveValue(selectedWorker.bankAccountNumber)}
                </Typography>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Contacto de emergencia
                </Typography>
                <Typography variant="body1">{selectedWorker.emergencyContactName || '—'}</Typography>
                <Typography variant="body2" color="text.secondary">{selectedWorker.emergencyContactPhone || '—'}</Typography>
              </Paper>
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          {isAdmin ? (
            <>
              <Button startIcon={<EditOutlinedIcon />} onClick={handleOpenEditDialog}>
                Editar
              </Button>
              {selectedWorker?.active === false ? (
                <Button
                  color="success"
                  startIcon={<CheckCircleOutlineIcon />}
                  onClick={handleActivate}
                  disabled={activateLoading}
                >
                  {activateLoading ? <CircularProgress size={24} color="inherit" /> : 'Activar'}
                </Button>
              ) : (
                <Button
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Eliminar
                </Button>
              )}
            </>
          ) : null}
          <Button
            onClick={() => {
              setShowSensitive(false);
              setSelectedWorkerId(null);
            }}
          >
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={editOpen} onClose={() => !editing && resetEditDialog()} fullWidth maxWidth="md">
        <DialogTitle>Editar trabajador</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {editError ? <Alert severity="error">{editError}</Alert> : null}
            
            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Información General</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Nombre completo"
                  fullWidth
                  value={editForm.fullName}
                  onChange={(event) => setEditForm((current) => ({ ...current, fullName: event.target.value }))}
                  disabled={editing}
                />
                <TextField
                  label="RUT"
                  fullWidth
                  placeholder="12.345.678-9"
                  value={editForm.rut}
                  onChange={(event) => setEditForm((current) => ({ ...current, rut: event.target.value }))}
                  disabled={editing}
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
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Contacto y Ubicación</Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Departamento / Área"
                    fullWidth
                    value={editForm.department}
                    onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                    disabled={editing}
                  />
                  <TextField
                    label="Ubicación / Ciudad"
                    fullWidth
                    value={editForm.location}
                    onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                    disabled={editing}
                  />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Email personal"
                    fullWidth
                    value={editForm.personalEmail}
                    onChange={(e) => setEditForm({ ...editForm, personalEmail: e.target.value })}
                    disabled={editing}
                  />
                  <TextField
                    label="Teléfono"
                    fullWidth
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                    disabled={editing}
                  />
                </Stack>
                <TextField
                  label="Dirección"
                  fullWidth
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                  disabled={editing}
                />
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Datos Bancarios</Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Banco"
                    fullWidth
                    value={editForm.bankName}
                    onChange={(e) => setEditForm({ ...editForm, bankName: e.target.value })}
                    disabled={editing}
                  />
                  <TextField
                    select
                    label="Tipo de cuenta"
                    fullWidth
                    value={editForm.bankAccountType}
                    onChange={(e) => setEditForm({ ...editForm, bankAccountType: e.target.value })}
                    disabled={editing}
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
                />
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Contacto de Emergencia</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Nombre contacto"
                  fullWidth
                  value={editForm.emergencyContactName}
                  onChange={(e) => setEditForm({ ...editForm, emergencyContactName: e.target.value })}
                  disabled={editing}
                />
                <TextField
                  label="Teléfono contacto"
                  fullWidth
                  value={editForm.emergencyContactPhone}
                  onChange={(e) => setEditForm({ ...editForm, emergencyContactPhone: e.target.value })}
                  disabled={editing}
                />
              </Stack>
            </Box>

          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={resetEditDialog} disabled={editing}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleEditSave}
            disabled={editing || !editForm.fullName || !editForm.rut}
          >
            {editing ? <CircularProgress size={24} color="inherit" /> : 'Guardar cambios'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => !deleting && setDeleteConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Desactivar trabajador</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            ¿Seguro que quieres desactivar a <strong>{selectedWorker?.fullName || 'este trabajador'}</strong>? No se borrará el historial; solo quedará inactivo.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>Atrás</Button>
          <Button color="error" variant="contained" onClick={handleSoftDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={24} color="inherit" /> : 'Confirmar'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={manualOpen} onClose={() => !creating && setManualOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Crear trabajador manualmente</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {manualError && <Alert severity="error">{manualError}</Alert>}
            
            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Información General</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Nombre completo"
                  fullWidth
                  value={manualForm.fullName}
                  onChange={(e) => setManualForm({ ...manualForm, fullName: e.target.value })}
                  disabled={creating}
                  required
                />
                <TextField
                  label="RUT"
                  fullWidth
                  placeholder="12.345.678-9"
                  value={manualForm.rut}
                  onChange={(e) => setManualForm({ ...manualForm, rut: e.target.value })}
                  disabled={creating}
                  required
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
              />
              <TextField
                select
                label="Rol"
                fullWidth
                value={manualForm.role || 'worker'}
                onChange={(e) => setManualForm({ ...manualForm, role: e.target.value })}
                disabled={creating}
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
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Contacto y Ubicación</Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Departamento / Área"
                    fullWidth
                    value={manualForm.department}
                    onChange={(e) => setManualForm({ ...manualForm, department: e.target.value })}
                    disabled={creating}
                  />
                  <TextField
                    label="Ubicación / Ciudad"
                    fullWidth
                    value={manualForm.location}
                    onChange={(e) => setManualForm({ ...manualForm, location: e.target.value })}
                    disabled={creating}
                  />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Email personal"
                    fullWidth
                    value={manualForm.personalEmail}
                    onChange={(e) => setManualForm({ ...manualForm, personalEmail: e.target.value })}
                    disabled={creating}
                  />
                  <TextField
                    label="Teléfono"
                    fullWidth
                    value={manualForm.phone}
                    onChange={(e) => setManualForm({ ...manualForm, phone: e.target.value })}
                    disabled={creating}
                  />
                </Stack>
                <TextField
                  label="Dirección"
                  fullWidth
                  value={manualForm.address}
                  onChange={(e) => setManualForm({ ...manualForm, address: e.target.value })}
                  disabled={creating}
                />
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Datos Bancarios</Typography>
              <Stack spacing={2}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Banco"
                    fullWidth
                    value={manualForm.bankName}
                    onChange={(e) => setManualForm({ ...manualForm, bankName: e.target.value })}
                    disabled={creating}
                  />
                  <TextField
                    select
                    label="Tipo de cuenta"
                    fullWidth
                    value={manualForm.bankAccountType}
                    onChange={(e) => setManualForm({ ...manualForm, bankAccountType: e.target.value })}
                    disabled={creating}
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
                />
              </Stack>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>Contacto de Emergencia</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Nombre contacto"
                  fullWidth
                  value={manualForm.emergencyContactName}
                  onChange={(e) => setManualForm({ ...manualForm, emergencyContactName: e.target.value })}
                  disabled={creating}
                />
                <TextField
                  label="Teléfono contacto"
                  fullWidth
                  value={manualForm.emergencyContactPhone}
                  onChange={(e) => setManualForm({ ...manualForm, emergencyContactPhone: e.target.value })}
                  disabled={creating}
                />
              </Stack>
            </Box>

          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManualOpen(false)} disabled={creating}>Cancelar</Button>
          <Button
            variant="contained"
            onClick={handleManualSave}
            disabled={creating || !manualForm.fullName || !manualForm.rut}
          >
            {creating ? <CircularProgress size={24} color="inherit" /> : 'Guardar trabajador'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={resetImportDialog} fullWidth maxWidth="md">
        <DialogTitle>Importar trabajadores por CSV</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} sx={{ py: 1.5 }}>
            {CSV_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {activeStep === 0 && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Descarga la plantilla base antes de preparar el archivo definitivo.
              </Typography>
              <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={handleDownloadTemplate}>
                Descargar plantilla
              </Button>
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Sube el archivo preparado. El siguiente paso mostrará una tabla de validación previa.
              </Typography>
              <Button component="label" variant="contained">
                Seleccionar archivo CSV
                <input hidden type="file" accept=".csv" onChange={handleFileChange} />
              </Button>
              <Typography variant="caption" color="text.secondary">
                {selectedFileName || 'Sin archivo seleccionado'}
              </Typography>
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {importSummary}
              </Typography>
              {importError && <Alert severity="error">{importError}</Alert>}
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>RUT</TableCell>
                      <TableCell>Nombre</TableCell>
                      <TableCell>Centro de costo</TableCell>
                      <TableCell>Estado</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {parsedRows.map((row, index) => (
                      <TableRow key={index} sx={{ bgcolor: row.error ? 'error.light' : 'inherit' }}>
                        <TableCell>{row.rut}</TableCell>
                        <TableCell>{row.nombre_completo}</TableCell>
                        <TableCell>{row.centro_costo}</TableCell>
                        <TableCell>
                          {row.error ? (
                            <Chip
                              icon={<ErrorOutlineIcon />}
                              label={row.error}
                              color="error"
                              size="small"
                              variant="outlined"
                            />
                          ) : (
                            <Chip label="Válido" color="success" size="small" variant="outlined" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Stack>
          )}

          {activeStep === 3 && (
            <Stack spacing={2} sx={{ pt: 2, alignItems: 'center', textAlign: 'center' }}>
              <Typography variant="h6">Importación completada</Typography>
              <Typography variant="body2" color="text.secondary">
                Los trabajadores válidos han sido incorporados al maestro exitosamente.
              </Typography>
              <Button variant="contained" onClick={resetImportDialog}>Entendido</Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ visibility: activeStep === 3 ? 'hidden' : 'visible' }}>
          <Button onClick={resetImportDialog} disabled={importing}>Cerrar</Button>
          <Button onClick={previousStep} disabled={activeStep === 0 || importing}>
            Atrás
          </Button>
          <Button
            variant="contained"
            onClick={nextStep}
            disabled={(activeStep === 1 && !selectedFileName) || importing || (activeStep === 2 && parsedRows.filter(r => !r.error).length === 0)}
          >
            {importing ? <CircularProgress size={24} color="inherit" /> : activeStep === 2 ? 'Importar válidos' : 'Siguiente'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
