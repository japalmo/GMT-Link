import { useEffect, useMemo, useState } from 'react';
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
import AddIcon from '@mui/icons-material/Add';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import { useSearchParams } from 'react-router-dom';
import { subscribeReimbursements, updateReimbursementStatus } from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP, formatDateTime, formatShortDate, toDateValue } from '../lib/formatters';

const IMPORT_STEPS = ['Descargar formato', 'Subir archivo', 'Vista previa', 'Confirmar'];

const IMPORT_ROWS = [
  { id: 'R-2401', trabajador: 'Fernanda Rojas', concepto: 'Peajes', monto: '$ 18.500' },
  { id: 'R-2402', trabajador: 'Tomás Vega', concepto: 'Bencina', monto: '$ 32.900' },
];

const STATUS_TONE = {
  pending_approval: 'warning',
  approved: 'success',
  paid: 'info',
  rejected: 'default',
};

const STATUS_LABEL = {
  pending_approval: 'Pendiente',
  approved: 'Aprobada',
  paid: 'Pagada',
  rejected: 'Rechazada',
};

export default function Reembolsos() {
  const { profile, user } = useAuth();
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status');
  const [importOpen, setImportOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [reimbursements, setReimbursements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStatus, setActiveStatus] = useState(
    requestedStatus === 'pending_approval' || requestedStatus === 'approved_unpaid' || requestedStatus === 'paid'
      ? requestedStatus
      : 'all',
  );
  const [workerFilter, setWorkerFilter] = useState('all');
  const [centerCostFilter, setCenterCostFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);

  const [actionComment, setActionComment] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeReimbursements(
      { profile },
      (items) => { setReimbursements(items); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
    return unsubscribe;
  }, [profile]);

  const handleStatusUpdate = async (status) => {
    if (status === 'rejected' && !actionComment.trim()) {
      alert('Debe ingresar un motivo para el rechazo.');
      return;
    }

    setProcessing(true);
    try {
      await updateReimbursementStatus(selectedRequest.id, {
        status,
        profile,
        comment: actionComment,
      });
      setSelectedRequest(null);
      setActionComment('');
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const summary = useMemo(() => ({
    pending: reimbursements.filter((item) => item.status === 'pending_approval').length,
    approvedUnpaid: reimbursements.filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid').length,
    paid: reimbursements.filter((item) => item.status === 'paid').length,
  }), [reimbursements]);

  const workerOptions = useMemo(
    () => [...new Set(reimbursements.map((item) => item.workerName).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'es-CL')),
    [reimbursements],
  );

  const centerCostOptions = useMemo(
    () => [...new Set(reimbursements.map((item) => item.centerCost).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'es-CL')),
    [reimbursements],
  );

  const categoryOptions = useMemo(
    () => [...new Set(reimbursements.map((item) => item.category).filter(Boolean))].sort((left, right) => left.localeCompare(right, 'es-CL')),
    [reimbursements],
  );

  const filteredReimbursements = useMemo(() => reimbursements.filter((item) => {
    const expenseDate = toDateValue(item.expenseDate ?? item.submittedAt);
    const dateOnly = expenseDate ? new Date(expenseDate.getFullYear(), expenseDate.getMonth(), expenseDate.getDate()) : null;
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const toDateValueParsed = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
    const matchesStatus = activeStatus === 'all'
      ? true
      : activeStatus === 'approved_unpaid'
        ? item.status === 'approved' && item.paymentStatus === 'unpaid'
        : item.status === activeStatus;

    return matchesStatus
      && (workerFilter === 'all' || item.workerName === workerFilter)
      && (centerCostFilter === 'all' || item.centerCost === centerCostFilter)
      && (categoryFilter === 'all' || item.category === categoryFilter)
      && (!fromDate || (dateOnly && dateOnly >= fromDate))
      && (!toDateValueParsed || (expenseDate && expenseDate <= toDateValueParsed));
  }), [activeStatus, categoryFilter, centerCostFilter, dateFrom, dateTo, reimbursements, workerFilter]);

  const handleDownloadTemplate = () => {
    const content = [
      'trabajador_rut,fecha,concepto,monto,centro_costo',
      '16.432.890-2,2026-04-18,Peajes,18500,Operaciones Norte',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'plantilla_reembolsos_gmt.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    setActiveStep(2);
  };

  const resetImport = () => {
    setImportOpen(false);
    setActiveStep(0);
    setSelectedFileName('');
  };

  const canReviewSelectedRequest = Boolean(
    selectedRequest
    && selectedRequest.status === 'pending_approval'
    && (
      profile?.role === 'admin'
      || profile?.role === 'gerencia'
      || (
        profile?.role === 'supervisor'
        && (profile.centerCosts ?? []).includes(selectedRequest.centerCost)
      )
    ),
  );

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h5">Reembolsos</Typography>
          <Typography variant="body2" color="text.secondary">Gestión de solicitudes de reembolso</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <Button variant="contained" startIcon={<AddIcon />} disabled>
            Nueva solicitud
          </Button>
          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={() => setImportOpen(true)}>
            Importar registro
          </Button>
        </Stack>
      </Box>

      <Stack spacing={3}>
        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap>
              <Chip
                clickable
                label={`${summary.pending} pendientes`}
                color="warning"
                variant={activeStatus === 'pending_approval' ? 'filled' : 'outlined'}
                onClick={() => setActiveStatus('pending_approval')}
              />
              <Chip
                clickable
                label={`${summary.approvedUnpaid} aprobadas sin pagar`}
                color="success"
                variant={activeStatus === 'approved_unpaid' ? 'filled' : 'outlined'}
                onClick={() => setActiveStatus('approved_unpaid')}
              />
              <Chip
                clickable
                label={`${summary.paid} pagadas`}
                color="info"
                variant={activeStatus === 'paid' ? 'filled' : 'outlined'}
                onClick={() => setActiveStatus('paid')}
              />
              <Chip
                clickable
                label="Ver todas"
                variant={activeStatus === 'all' ? 'filled' : 'outlined'}
                onClick={() => setActiveStatus('all')}
              />
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <TextField
                select
                label="Trabajador"
                value={workerFilter}
                onChange={(event) => setWorkerFilter(event.target.value)}
                fullWidth
              >
                <MenuItem value="all">Todos</MenuItem>
                {workerOptions.map((item) => (
                  <MenuItem key={item} value={item}>{item}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Centro de costo"
                value={centerCostFilter}
                onChange={(event) => setCenterCostFilter(event.target.value)}
                fullWidth
              >
                <MenuItem value="all">Todos</MenuItem>
                {centerCostOptions.map((item) => (
                  <MenuItem key={item} value={item}>{item}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Categoría"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                fullWidth
              >
                <MenuItem value="all">Todas</MenuItem>
                {categoryOptions.map((item) => (
                  <MenuItem key={item} value={item}>{item}</MenuItem>
                ))}
              </TextField>
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                label="Desde"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Hasta"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Button
                variant="text"
                onClick={() => {
                  setWorkerFilter('all');
                  setCenterCostFilter('all');
                  setCategoryFilter('all');
                  setDateFrom('');
                  setDateTo('');
                  setActiveStatus('all');
                }}
              >
                Limpiar filtros
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Solicitudes registradas
            </Typography>
            {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}
            {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Solicitud</TableCell>
                    <TableCell>Trabajador</TableCell>
                    <TableCell>Concepto</TableCell>
                    <TableCell>Estado</TableCell>
                    <TableCell>Fecha</TableCell>
                    <TableCell align="right">Monto</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredReimbursements.length === 0 && !loading ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                        <Typography color="text.secondary">No se encontraron solicitudes.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredReimbursements.map((row) => (
                      <TableRow
                        key={row.id}
                        hover
                        onClick={() => {
                          setSelectedRequest(row);
                          setActionComment('');
                        }}
                        sx={{ cursor: 'pointer' }}
                      >
                        <TableCell>{row.requestNumber}</TableCell>
                        <TableCell>
                          <Typography variant="body2">{row.workerName}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {row.centerCost}
                          </Typography>
                        </TableCell>
                        <TableCell>{row.concept}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                            <Chip
                              label={STATUS_LABEL[row.status] ?? row.status}
                              color={STATUS_TONE[row.status] ?? 'default'}
                              size="small"
                              variant="outlined"
                            />
                            {row.paymentStatus === 'unpaid' && row.status !== 'rejected' ? (
                              <Chip label="No pagada" size="small" variant="outlined" />
                            ) : null}
                          </Stack>
                        </TableCell>
                        <TableCell>{formatDateTime(row.submittedAt)}</TableCell>
                        <TableCell align="right">{formatCurrencyCLP(row.amount)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Paper>
          </CardContent>
        </Card>
      </Stack>

      <Dialog open={Boolean(selectedRequest)} onClose={() => !processing && setSelectedRequest(null)} fullWidth maxWidth="md">
        <DialogTitle>Detalle de solicitud</DialogTitle>
        <DialogContent>
          {selectedRequest ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap>
                <Chip
                  label={STATUS_LABEL[selectedRequest.status] ?? selectedRequest.status}
                  color={STATUS_TONE[selectedRequest.status] ?? 'default'}
                />
                {selectedRequest.status !== 'rejected' && (
                  <Chip label={selectedRequest.paymentStatus === 'paid' ? 'Pagada' : 'Pendiente de pago'} variant="outlined" />
                )}
                <Chip label={selectedRequest.category} variant="outlined" />
              </Stack>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Solicitud</Typography>
                    <Typography variant="body1">{selectedRequest.requestNumber}</Typography>
                    <Typography variant="caption" color="text.secondary">Trabajador</Typography>
                    <Typography variant="body1">{selectedRequest.workerName}</Typography>
                    <Typography variant="caption" color="text.secondary">Centro de costo</Typography>
                    <Typography variant="body1">{selectedRequest.centerCost}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary">Monto</Typography>
                    <Typography variant="h6">{formatCurrencyCLP(selectedRequest.amount)}</Typography>
                    <Typography variant="caption" color="text.secondary">Fecha de gasto</Typography>
                    <Typography variant="body1">{formatShortDate(selectedRequest.expenseDate ?? selectedRequest.submittedAt)}</Typography>
                    <Typography variant="caption" color="text.secondary">Boleta / comercio</Typography>
                    <Typography variant="body1">{selectedRequest.receiptNumber} · {selectedRequest.merchantName}</Typography>
                  </Box>
                </Stack>
              </Paper>

              <Box>
                <Typography variant="subtitle2">Concepto</Typography>
                <Typography variant="body2" color="text.secondary">{selectedRequest.concept}</Typography>
              </Box>

              {selectedRequest.attachmentUrls?.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Comprobantes</Typography>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                    {selectedRequest.attachmentUrls.map((url, idx) => (
                      <Button
                        key={idx}
                        variant="outlined"
                        size="small"
                        startIcon={<UploadFileOutlinedIcon />}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Ver adjunto {idx + 1}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              )}

              <Box>
                <Typography variant="subtitle2">Notas del trabajador</Typography>
                <Typography variant="body2" color="text.secondary">{selectedRequest.notes || 'Sin observaciones'}</Typography>
              </Box>

              <Box>
                <Typography variant="subtitle2">Trazabilidad</Typography>
                <Typography variant="body2" color="text.secondary">
                  Enviada: {formatDateTime(selectedRequest.submittedAt)}
                </Typography>
                {selectedRequest.approvedAt ? (
                  <Typography variant="body2" color="text.secondary">
                    Aprobada por {selectedRequest.approvedByName} el {formatDateTime(selectedRequest.approvedAt)}
                  </Typography>
                ) : null}
                {selectedRequest.paidAt ? (
                  <Typography variant="body2" color="text.secondary">
                    Pagada el {formatDateTime(selectedRequest.paidAt)}
                  </Typography>
                ) : null}
                {selectedRequest.rejectedAt ? (
                  <Typography variant="body2" color="text.secondary" sx={{ color: 'error.main' }}>
                    Rechazada por {selectedRequest.rejectedByName} el {formatDateTime(selectedRequest.rejectedAt)}
                  </Typography>
                ) : null}
              </Box>

              <Divider />
              
              {canReviewSelectedRequest ? (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Acciones de revisión</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Operación realizada por {profile?.displayName || profile?.email || user?.email}.
                  </Typography>
                  <TextField
                    fullWidth
                    label="Comentario o motivo de rechazo"
                    multiline
                    rows={2}
                    value={actionComment}
                    onChange={(e) => setActionComment(e.target.value)}
                    placeholder="Ingrese un comentario para el trabajador..."
                    sx={{ mb: 2 }}
                    disabled={processing}
                  />
                  <Stack direction="row" spacing={2}>
                    <Button
                      fullWidth
                      variant="contained"
                      color="success"
                      startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <CheckCircleOutlineIcon />}
                      onClick={() => handleStatusUpdate('approved')}
                      disabled={processing}
                    >
                      Aprobar
                    </Button>
                    <Button
                      fullWidth
                      variant="contained"
                      color="error"
                      startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <HighlightOffIcon />}
                      onClick={() => handleStatusUpdate('rejected')}
                      disabled={processing}
                    >
                      Rechazar
                    </Button>
                  </Stack>
                </Box>
              ) : (
                <Box>
                  <Typography variant="subtitle2">Comentarios de revisión</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedRequest.approvalComment || selectedRequest.rejectionReason || 'Sin comentario registrado'}
                  </Typography>
                </Box>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedRequest(null)} disabled={processing}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={importOpen} onClose={resetImport} fullWidth maxWidth="md">
        <DialogTitle>Importar registro de reembolsos</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} sx={{ py: 1.5 }}>
            {IMPORT_STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {activeStep === 0 && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Descarga el formato base para preparar la carga masiva de registros.
              </Typography>
              <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} onClick={handleDownloadTemplate}>
                Descargar formato
              </Button>
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Sube el archivo CSV con los registros a incorporar al módulo de reembolsos.
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
                {selectedFileName ? `Archivo listo para revisión: ${selectedFileName}` : 'Aún no hay archivo cargado.'}
              </Typography>
              <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>ID</TableCell>
                      <TableCell>Trabajador</TableCell>
                      <TableCell>Concepto</TableCell>
                      <TableCell align="right">Monto</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {IMPORT_ROWS.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.id}</TableCell>
                        <TableCell>{row.trabajador}</TableCell>
                        <TableCell>{row.concepto}</TableCell>
                        <TableCell align="right">{row.monto}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Paper>
            </Stack>
          )}

          {activeStep === 3 && (
            <Stack spacing={1.5} sx={{ pt: 1 }}>
              <Typography variant="body1">
                Importación preparada y pendiente de la conexión backend.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                El recorrido de plantilla, carga, revisión y confirmación ya quedó visible en la UI.
              </Typography>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={resetImport}>Cerrar</Button>
          <Button onClick={() => setActiveStep((current) => Math.max(current - 1, 0))} disabled={activeStep === 0}>
            Atrás
          </Button>
          <Button
            variant="contained"
            onClick={() => setActiveStep((current) => Math.min(current + 1, IMPORT_STEPS.length - 1))}
            disabled={activeStep === 1 && !selectedFileName}
          >
            {activeStep === IMPORT_STEPS.length - 1 ? 'Listo' : 'Siguiente'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
