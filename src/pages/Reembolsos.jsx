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
  useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import AddIcon from '@mui/icons-material/Add';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { subscribeReimbursements, updateReimbursementStatus } from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP, formatDateTime, formatShortDate, toDateValue } from '../lib/formatters';
import ImpresionLoteDialog from '../components/ImpresionLoteDialog';

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

const MotionBox = motion(Box);
const MotionCard = motion(Card);

export default function Reembolsos() {
  const theme = useTheme();
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedStatus = searchParams.get('status');
  const [importOpen, setImportOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
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
  const [typeFilter, setTypeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedRequest, setSelectedRequest] = useState(null);

  const [actionComment, setActionComment] = useState('');
  const [processing, setProcessing] = useState(false);

  const requestIdFromUrl = searchParams.get('request');

  useEffect(() => {
    const unsubscribe = subscribeReimbursements(
      { profile },
      (items) => {
        setReimbursements(items);
        setLoading(false);

        // Si venimos del dashboard con un ID específico, abrirlo
        if (requestIdFromUrl && !selectedRequest) {
          const found = items.find((r) => r.id === requestIdFromUrl);
          if (found) {
            setSelectedRequest(found);
          }
        }
      },
      (err) => { setError(err.message); setLoading(false); },
    );
    return unsubscribe;
  }, [profile, requestIdFromUrl, selectedRequest]);

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
      && (typeFilter === 'all' || item.documentType === typeFilter)
      && (!fromDate || (dateOnly && dateOnly >= fromDate))
      && (!toDateValueParsed || (expenseDate && expenseDate <= toDateValueParsed));
  }), [activeStatus, categoryFilter, centerCostFilter, dateFrom, dateTo, reimbursements, workerFilter, typeFilter]);

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

  const canPrintBatch = profile?.role === 'admin' || profile?.role === 'finance_clerk';

  return (
    <Box sx={{ pb: 4 }}>
      <MotionBox
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
        sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={800}>Reembolsos</Typography>
          <Typography variant="body2" color="text.secondary">Gestión de solicitudes de reembolso</Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          {canPrintBatch && (
            <Button 
              variant="outlined" 
              color="primary" 
              startIcon={<PictureAsPdfIcon />} 
              onClick={() => setPrintOpen(true)}
              sx={{ borderRadius: 2.5, textTransform: 'none', fontWeight: 600 }}
            >
              Impresión por lote
            </Button>
          )}
          <Button 
            variant="contained" 
            startIcon={<AddIcon />} 
            onClick={() => navigate('/solicitar')}
            sx={{ borderRadius: 2.5, textTransform: 'none', fontWeight: 700, px: 3 }}
          >
            Nueva solicitud
          </Button>
          <Button 
            variant="outlined" 
            startIcon={<UploadFileOutlinedIcon />} 
            onClick={() => setImportOpen(true)}
            sx={{ borderRadius: 2.5, textTransform: 'none', fontWeight: 600 }}
          >
            Importar registro
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
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap>
              {[
                { label: `${summary.pending} pendientes`, status: 'pending_approval', color: 'warning' },
                { label: `${summary.approvedUnpaid} aprobadas sin pagar`, status: 'approved_unpaid', color: 'success' },
                { label: `${summary.paid} pagadas`, status: 'paid', color: 'info' },
                { label: 'Ver todas', status: 'all', color: 'default' },
              ].map((filter) => (
                <Chip
                  key={filter.status}
                  clickable
                  label={filter.label}
                  color={filter.color !== 'default' ? filter.color : 'primary'}
                  variant={activeStatus === filter.status ? 'filled' : 'outlined'}
                  onClick={() => setActiveStatus(filter.status)}
                  sx={{ 
                    borderRadius: 2, 
                    fontWeight: 600,
                    transition: 'all 0.2s',
                    '&:hover': { transform: 'translateY(-1px)' }
                  }}
                />
              ))}
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
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <TextField
                select
                label="Trabajador"
                value={workerFilter}
                onChange={(event) => setWorkerFilter(event.target.value)}
                fullWidth
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
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
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
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
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                <MenuItem value="all">Todas</MenuItem>
                {categoryOptions.map((item) => (
                  <MenuItem key={item} value={item}>{item}</MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Tipo"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                fullWidth
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                <MenuItem value="all">Todos</MenuItem>
                <MenuItem value="boleta">Boleta</MenuItem>
                <MenuItem value="factura">Factura</MenuItem>
              </TextField>
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
              <TextField
                label="Desde"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <TextField
                label="Hasta"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />
              <Button
                variant="text"
                onClick={() => {
                  setWorkerFilter('all');
                  setCenterCostFilter('all');
                  setCategoryFilter('all');
                  setTypeFilter('all');
                  setDateFrom('');
                  setDateTo('');
                  setActiveStatus('all');
                }}
                sx={{ fontWeight: 600, minWidth: 140 }}
              >
                Limpiar filtros
              </Button>
            </Stack>
          </CardContent>
        </MotionCard>

        <MotionCard
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
        >
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }} fontWeight={700}>
              Solicitudes registradas
            </Typography>
            {loading ? <LinearProgress sx={{ mb: 2, borderRadius: 2 }} /> : null}
            {error ? <Alert severity="error" sx={{ mb: 2, borderRadius: 2 }}>{error}</Alert> : null}
            <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Solicitud</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Trabajador</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Concepto</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Estado</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Fecha</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Monto</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <AnimatePresence mode="wait">
                    {filteredReimbursements.length === 0 && !loading ? (
                      <TableRow>
                        <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                          <Typography color="text.secondary">No se encontraron solicitudes.</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredReimbursements.map((row, idx) => (
                        <TableRow
                          key={row.id}
                          hover
                          onClick={() => {
                            setSelectedRequest(row);
                            setActionComment('');
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
                          <TableCell sx={{ fontWeight: 600 }}>{row.requestNumber}</TableCell>
                          <TableCell>
                            <Typography variant="body2" fontWeight={600}>{row.workerName}</Typography>
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
                                variant="filled"
                                sx={{ borderRadius: 1.5, fontWeight: 700, fontSize: '0.7rem' }}
                              />
                              <Chip
                                label={row.documentType === 'factura' ? 'Factura' : 'Boleta'}
                                size="small"
                                variant="outlined"
                                sx={{ borderRadius: 1.5, fontWeight: 600, fontSize: '0.7rem' }}
                              />
                              {row.paymentStatus === 'unpaid' && row.status !== 'rejected' ? (
                                <Chip 
                                  label="No pagada" 
                                  size="small" 
                                  variant="outlined" 
                                  color="error"
                                  sx={{ borderRadius: 1.5, fontWeight: 600, fontSize: '0.7rem' }}
                                />
                              ) : null}
                            </Stack>
                          </TableCell>
                          <TableCell>{formatDateTime(row.submittedAt)}</TableCell>
                          <TableCell align="right">
                            <Typography variant="subtitle2" fontWeight={800} color="primary.main">
                              {formatCurrencyCLP(row.amount)}
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </AnimatePresence>
                </TableBody>
              </Table>
            </Paper>
          </CardContent>
        </MotionCard>
      </Stack>

      <Dialog 
        open={Boolean(selectedRequest)} 
        onClose={() => !processing && setSelectedRequest(null)} 
        fullWidth 
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Detalle de solicitud</DialogTitle>
        <DialogContent>
          {selectedRequest ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap>
                <Chip
                  label={STATUS_LABEL[selectedRequest.status] ?? selectedRequest.status}
                  color={STATUS_TONE[selectedRequest.status] ?? 'default'}
                  sx={{ fontWeight: 700 }}
                />
                {selectedRequest.status !== 'rejected' && (
                  <Chip 
                    label={selectedRequest.paymentStatus === 'paid' ? 'Pagada' : 'Pendiente de pago'} 
                    variant="outlined" 
                    sx={{ fontWeight: 600 }}
                  />
                )}
                <Chip 
                  label={selectedRequest.documentType === 'factura' ? 'Factura' : 'Boleta'} 
                  variant="outlined" 
                  color="primary" 
                  sx={{ fontWeight: 600 }}
                />
                <Chip label={selectedRequest.category} variant="outlined" sx={{ fontWeight: 600 }} />
              </Stack>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.01)', borderColor: 'rgba(0,0,0,0.05)' }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Solicitud</Typography>
                    <Typography variant="body1" fontWeight={700} sx={{ mb: 1 }}>{selectedRequest.requestNumber}</Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Trabajador</Typography>
                    <Typography variant="body1" fontWeight={500} sx={{ mb: 1 }}>{selectedRequest.workerName}</Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Centro de costo</Typography>
                    <Typography variant="body1" fontWeight={500}>{selectedRequest.centerCost}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Monto</Typography>
                    <Typography variant="h6" color="primary.main" fontWeight={800}>{formatCurrencyCLP(selectedRequest.amount)}</Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Fecha de gasto</Typography>
                    <Typography variant="body1" fontWeight={500} sx={{ mb: 1 }}>{formatShortDate(selectedRequest.expenseDate ?? selectedRequest.submittedAt)}</Typography>
                    <Typography variant="caption" color="text.secondary" fontWeight={600}>Boleta / comercio</Typography>
                    <Typography variant="body1" fontWeight={500}>{selectedRequest.receiptNumber} · {selectedRequest.merchantName}</Typography>
                  </Box>
                </Stack>
              </Paper>

              <Box>
                <Typography variant="subtitle2" fontWeight={700}>Concepto</Typography>
                <Typography variant="body2" color="text.secondary">{selectedRequest.concept}</Typography>
              </Box>

              {selectedRequest.attachmentUrls?.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }} fontWeight={700}>Comprobantes</Typography>
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
                        sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                      >
                        Ver adjunto {idx + 1}
                      </Button>
                    ))}
                  </Stack>
                </Box>
              )}

              <Box>
                <Typography variant="subtitle2" fontWeight={700}>Notas del trabajador</Typography>
                <Typography variant="body2" color="text.secondary">{selectedRequest.notes || 'Sin observaciones'}</Typography>
              </Box>

              <Box sx={{ p: 2, borderRadius: 2, bgcolor: 'rgba(0,0,0,0.02)' }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Trazabilidad</Typography>
                <Typography variant="caption" display="block" color="text.secondary">
                  Enviada: {formatDateTime(selectedRequest.submittedAt)}
                </Typography>
                {selectedRequest.approvedAt ? (
                  <Typography variant="caption" display="block" color="text.secondary">
                    Aprobada por {selectedRequest.approvedByName} el {formatDateTime(selectedRequest.approvedAt)}
                  </Typography>
                ) : null}
                {selectedRequest.paidAt ? (
                  <Typography variant="caption" display="block" color="text.secondary">
                    Pagada el {formatDateTime(selectedRequest.paidAt)}
                  </Typography>
                ) : null}
                {selectedRequest.rejectedAt ? (
                  <Typography variant="caption" display="block" color="error.main" fontWeight={600}>
                    Rechazada por {selectedRequest.rejectedByName} el {formatDateTime(selectedRequest.rejectedAt)}
                  </Typography>
                ) : null}
              </Box>

              <Divider />
              
              {canReviewSelectedRequest ? (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1.5 }} fontWeight={700}>Acciones de revisión</Typography>
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
                    sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
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
                      sx={{ borderRadius: 3, fontWeight: 700, py: 1.2 }}
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
                      sx={{ borderRadius: 3, fontWeight: 700, py: 1.2 }}
                    >
                      Rechazar
                    </Button>
                  </Stack>
                </Box>
              ) : (
                <Box>
                  <Typography variant="subtitle2" fontWeight={700}>Comentarios de revisión</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedRequest.approvalComment || selectedRequest.rejectionReason || 'Sin comentario registrado'}
                  </Typography>
                </Box>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setSelectedRequest(null)} disabled={processing} sx={{ fontWeight: 600 }}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      <Dialog 
        open={importOpen} 
        onClose={resetImport} 
        fullWidth 
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Importar registro de reembolsos</DialogTitle>
        <DialogContent>
          <Stepper activeStep={activeStep} sx={{ py: 1.5 }}>
            {IMPORT_STEPS.map((label) => (
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
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Descarga el formato base para preparar la carga masiva de registros.
                  </Typography>
                  <Button 
                    variant="outlined" 
                    startIcon={<UploadFileOutlinedIcon />} 
                    onClick={handleDownloadTemplate}
                    sx={{ borderRadius: 2, fontWeight: 600 }}
                  >
                    Descargar formato
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
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Sube el archivo CSV con los registros a incorporar al módulo de reembolsos.
                  </Typography>
                  <Button component="label" variant="contained" sx={{ borderRadius: 2, fontWeight: 700 }}>
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
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {selectedFileName ? `Archivo listo para revisión: ${selectedFileName}` : 'Aún no hay archivo cargado.'}
                  </Typography>
                  <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700 }}>ID</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Trabajador</TableCell>
                          <TableCell sx={{ fontWeight: 700 }}>Concepto</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 700 }}>Monto</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {IMPORT_ROWS.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell>{row.id}</TableCell>
                            <TableCell>{row.trabajador}</TableCell>
                            <TableCell>{row.concepto}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 700, color: 'primary.main' }}>{row.monto}</TableCell>
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
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  spacing={1.5}
                >
                  <Typography variant="body1" fontWeight={600}>
                    Importación preparada y pendiente de la conexión backend.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    El recorrido de plantilla, carga, revisión y confirmación ya quedó visible en la UI.
                  </Typography>
                </MotionBox>
              )}
            </AnimatePresence>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={resetImport} sx={{ fontWeight: 600 }}>Cerrar</Button>
          <Box sx={{ flex: 1 }} />
          <Button 
            onClick={() => setActiveStep((current) => Math.max(current - 1, 0))} 
            disabled={activeStep === 0}
            sx={{ fontWeight: 600 }}
          >
            Atrás
          </Button>
          <Button
            variant="contained"
            onClick={() => setActiveStep((current) => Math.min(current + 1, IMPORT_STEPS.length - 1))}
            disabled={activeStep === 1 && !selectedFileName}
            sx={{ borderRadius: 2, fontWeight: 700 }}
          >
            {activeStep === IMPORT_STEPS.length - 1 ? 'Listo' : 'Siguiente'}
          </Button>
        </DialogActions>
      </Dialog>

      <ImpresionLoteDialog open={printOpen} onClose={() => setPrintOpen(false)} />
    </Box>
  );
}
