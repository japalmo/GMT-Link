import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
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
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useSearchParams } from 'react-router-dom';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  createPaymentBatch,
  getReimbursements,
  subscribePaymentBatches,
  subscribeReimbursements,
  subscribeUsers,
  subscribeWorkers,
} from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { storage } from '../lib/firebase';
import { formatCurrencyCLP, formatDateTime } from '../lib/formatters';
import { generatePaymentPDF } from '../lib/pdfService';

const MotionBox = motion(Box);
const MotionCard = motion(Card);

function buildVoucherStoragePath(file) {
  const safeName = file.name.replace(/\s+/g, '_');
  return `vouchers/${file.lastModified}_${safeName}`;
}

export default function Pagos() {
  const theme = useTheme();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedWorkerId = searchParams.get('worker') ?? '';
  const shouldAutoOpenPayment = searchParams.get('open') === '1';
  const [reimbursements, setReimbursements] = useState([]);
  const [paymentBatches, setPaymentBatches] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedWorkerId, setSelectedWorkerId] = useState(() => requestedWorkerId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(() => shouldAutoOpenPayment);
  
  const [voucherFile, setVoucherFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [paymentReference, setPaymentReference] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState([]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const unsubscribeReimbursements = subscribeReimbursements(
      { profile, status: 'approved', paymentStatus: 'unpaid' },
      (items) => { setReimbursements(items); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );

    const unsubscribeBatches = subscribePaymentBatches(
      { profile },
      (items) => setPaymentBatches(items),
      (err) => setError(err.message),
    );

    const unsubscribeWorkers = subscribeWorkers(
      { profile },
      (items) => setWorkers(items),
    );

    const unsubscribeUsers = subscribeUsers(
      {},
      (items) => setUsers(items),
    );

    return () => {
      unsubscribeReimbursements();
      unsubscribeBatches();
      unsubscribeWorkers();
      unsubscribeUsers();
    };
  }, [profile]);

  const workerGroups = useMemo(() => {
    const grouped = reimbursements
      .filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid')
      .reduce((accumulator, item) => {
        const current = accumulator.get(item.workerId) ?? {
          workerId: item.workerId,
          workerName: item.workerName,
          workerRut: item.workerRut,
          centerCost: item.centerCost,
          rows: [],
          totalAmount: 0,
        };
        current.rows.push(item);
        current.totalAmount += Number(item.amount ?? 0);
        accumulator.set(item.workerId, current);
        return accumulator;
      }, new Map());

    return [...grouped.values()];
  }, [reimbursements]);

  const activeWorkerId = useMemo(() => {
    if (selectedWorkerId && workerGroups.some((item) => item.workerId === selectedWorkerId)) {
      return selectedWorkerId;
    }
    return workerGroups[0]?.workerId ?? '';
  }, [selectedWorkerId, workerGroups]);

  const selectedWorkerGroup = workerGroups.find((item) => item.workerId === activeWorkerId) ?? null;

  // Selection logic
  useEffect(() => {
    if (selectedWorkerGroup) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRows(selectedWorkerGroup.rows.map((r) => r.id));
    } else {
      setSelectedRows([]);
    }
  }, [selectedWorkerGroup]);

  const selectedRowsData = useMemo(() => {
    if (!selectedWorkerGroup) return [];
    return selectedWorkerGroup.rows.filter((r) => selectedRows.includes(r.id));
  }, [selectedRows, selectedWorkerGroup]);

  const selectedTotal = useMemo(() => {
    return selectedRowsData.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  }, [selectedRowsData]);

  const toggleRow = (id) => {
    setSelectedRows((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  const toggleAll = () => {
    if (selectedRows.length === selectedWorkerGroup?.rows.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(selectedWorkerGroup?.rows.map((r) => r.id) ?? []);
    }
  };

  const selectedWorker = workers.find((item) => item.id === activeWorkerId) ?? null;
  const supervisorUser = users.find((item) => item.id === selectedWorker?.supervisorId) ?? null;
  // TODO: diferenciación gerencia vs admin
  const adminEmails = users
    .filter((item) => item.role === 'admin' || item.role === 'gerencia')
    .map((item) => item.email);

  const recipientOptions = useMemo(() => {
    if (!selectedWorker) return [];
    const options = [
      selectedWorker?.email,
      selectedWorker?.personalEmail,
      supervisorUser?.email,
      ...adminEmails,
    ].filter(Boolean);

    return [...new Set(options)];
  }, [adminEmails, selectedWorker, supervisorUser?.email]);

  const latestPaidBatch = useMemo(() => {
    const items = [...paymentBatches];
    items.sort((left, right) => {
      const leftValue = left.paidAt?.seconds ?? 0;
      const rightValue = right.paidAt?.seconds ?? 0;
      return rightValue - leftValue;
    });
    return items[0] ?? null;
  }, [paymentBatches]);

  useEffect(() => {
    if (!shouldAutoOpenPayment) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('open');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, shouldAutoOpenPayment]);

  const handleVoucherChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setVoucherFile(file);
    setSuccess(false);
  };

  const toggleRecipient = (email) => {
    setSelectedRecipients((current) => (
      current.includes(email)
        ? current.filter((item) => item !== email)
        : [...current, email]
    ));
    setSuccess(false);
  };

  const handleProcessPayment = async () => {
    setProcessing(true);
    try {
      let voucherUrl = '';
      if (voucherFile) {
        const storageRef = ref(storage, buildVoucherStoragePath(voucherFile));
        const uploadResult = await uploadBytes(storageRef, voucherFile);
        voucherUrl = await getDownloadURL(uploadResult.ref);
      }

      const batchData = {
        workerId: selectedWorker.id,
        workerName: selectedWorker.fullName,
        workerRut: selectedWorker.rut,
        centerCost: selectedWorkerGroup.centerCost,
        totalAmount: selectedTotal,
        requestCount: selectedRows.length,
        bankName: selectedWorker.bankName || '',
        bankAccountType: selectedWorker.bankAccountType || '',
        bankAccountNumber: selectedWorker.bankAccountNumber || '',
        voucherUrl,
        paymentReference: paymentReference.trim(),
        emailSentTo: selectedRecipients,
        emailSentAt: null,
      };

      await createPaymentBatch(batchData, selectedRows, profile);
      
      setSuccess(true);
      // Wait a bit before reset to allow manual download if desired
      setTimeout(() => {
        resetPaymentDialog();
      }, 5000);
    } catch (err) {
      alert('Error al procesar pago: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownloadPDF = async (batch) => {
    setDownloading(true);
    try {
      // Fetch relevant reimbursements for this batch
      const requests = await getReimbursements({ 
        profile, 
        limitTo: 1000 
      });
      const batchRequests = requests.filter(r => r.paymentBatchId === batch.id);
      
      generatePaymentPDF(batch, batchRequests);
    } catch (err) {
      alert('Error al generar PDF: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  const isAuthorizedPayer = profile?.role === 'admin'
    || profile?.role === 'gerencia'
    || profile?.role === 'finance_clerk';

  const resetPaymentDialog = () => {
    setPaymentOpen(false);
    setVoucherFile(null);
    setPaymentReference('');
    setSelectedRecipients([]);
    setSuccess(false);
  };

  return (
    <Box sx={{ pb: 4 }}>
      <MotionBox
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Typography variant="h5" fontWeight={800}>Pagos</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Selección y consolidación de reembolsos aprobados para pago por trabajador
        </Typography>
      </MotionBox>

      <Stack spacing={3}>
        {loading ? <LinearProgress sx={{ borderRadius: 2 }} /> : null}
        {error ? <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert> : null}

        <MotionCard
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
        >
          <CardContent>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ xs: 'stretch', lg: 'center' }}>
              <TextField
                select
                label="Trabajador"
                value={activeWorkerId}
                onChange={(event) => setSelectedWorkerId(event.target.value)}
                fullWidth
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              >
                {workerGroups.length === 0 && !loading && (
                  <MenuItem value="">No hay pagos pendientes</MenuItem>
                )}
                {workerGroups.map((item) => (
                  <MenuItem key={item.workerId} value={item.workerId}>
                    {item.workerName}
                  </MenuItem>
                ))}
              </TextField>

              <Button
                variant="contained"
                size="large"
                startIcon={<PaymentsOutlinedIcon />}
                disabled={!selectedWorkerGroup || processing || selectedRows.length === 0}
                onClick={() => {
                  setSelectedRecipients(recipientOptions.filter(email => email === selectedWorker?.email || email === supervisorUser?.email));
                  setVoucherFile(null);
                  setSuccess(false);
                  setPaymentOpen(true);
                }}
                sx={{ borderRadius: 3, fontWeight: 700, minWidth: 240, py: 1.5 }}
              >
                Pagar Seleccionados ({selectedRows.length})
              </Button>
            </Stack>
          </CardContent>
        </MotionCard>

        {selectedWorkerGroup ? (
          <>
            <MotionBox
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <Paper 
                variant="outlined" 
                sx={{ 
                  p: 2, 
                  borderRadius: 3, 
                  bgcolor: 'rgba(0,0,0,0.01)', 
                  borderColor: 'rgba(0,0,0,0.05)',
                  mb: 2
                }}
              >
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700}>Trabajador seleccionado</Typography>
                    <Typography variant="body1" fontWeight={600}>{selectedWorkerGroup.workerName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {selectedWorkerGroup.centerCost} · {selectedWorkerGroup.workerRut}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
                    <Chip 
                      label={`${selectedRows.length} seleccionadas de ${selectedWorkerGroup.rows.length}`} 
                      sx={{ borderRadius: 2, fontWeight: 600 }}
                    />
                    <Chip 
                      label={`Total Seleccionado ${formatCurrencyCLP(selectedTotal)}`} 
                      color="secondary" 
                      sx={{ borderRadius: 2, fontWeight: 700 }}
                    />
                  </Stack>
                </Stack>
              </Paper>
            </MotionBox>

            <MotionCard
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}
            >
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }} fontWeight={700}>
                  Solicitudes aprobadas pendientes
                </Typography>
                <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            indeterminate={selectedRows.length > 0 && selectedRows.length < selectedWorkerGroup.rows.length}
                            checked={selectedRows.length === selectedWorkerGroup.rows.length && selectedWorkerGroup.rows.length > 0}
                            onChange={toggleAll}
                          />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Solicitud</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Fecha</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Concepto</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Monto</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      <AnimatePresence mode="wait">
                        {selectedWorkerGroup.rows.map((row, idx) => (
                          <TableRow 
                            key={row.id} 
                            hover 
                            onClick={() => toggleRow(row.id)} 
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
                            <TableCell padding="checkbox">
                              <Checkbox checked={selectedRows.includes(row.id)} />
                            </TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>{row.requestNumber}</TableCell>
                            <TableCell>{formatDateTime(row.submittedAt)}</TableCell>
                            <TableCell>{row.concept}</TableCell>
                            <TableCell align="right">
                              <Typography variant="subtitle2" fontWeight={800} color="primary.main">
                                {formatCurrencyCLP(row.amount)}
                              </Typography>
                            </TableCell>
                          </TableRow>
                        ))}
                      </AnimatePresence>
                    </TableBody>
                  </Table>
                </Paper>
              </CardContent>
            </MotionCard>
          </>
        ) : !loading && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography color="text.secondary">No hay solicitudes aprobadas pendientes de pago.</Typography>
          </Box>
        )}

        {latestPaidBatch ? (
          <MotionCard
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            sx={{ borderRadius: 3, boxShadow: '0 4px 12px rgba(0,0,0,0.03)', borderLeft: `6px solid ${theme.palette.success.main}` }}
          >
            <CardContent>
              <Typography variant="subtitle2" gutterBottom color="text.secondary" fontWeight={700}>Último lote pagado</Typography>
              <Typography variant="body1" fontWeight={700}>{latestPaidBatch.workerName}</Typography>
              <Typography variant="body2" color="text.secondary" fontWeight={500}>
                {latestPaidBatch.batchNumber} · {formatCurrencyCLP(latestPaidBatch.totalAmount)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Pagado el {formatDateTime(latestPaidBatch.paidAt)} por {latestPaidBatch.paidByName}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                {latestPaidBatch.voucherUrl && (
                  <Button
                    size="small"
                    variant="outlined"
                    href={latestPaidBatch.voucherUrl}
                    target="_blank"
                    startIcon={<UploadFileOutlinedIcon />}
                    sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                  >
                    Ver comprobante
                  </Button>
                )}
                {isAuthorizedPayer && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={downloading ? <CircularProgress size={16} /> : <PictureAsPdfIcon />}
                    onClick={() => handleDownloadPDF(latestPaidBatch)}
                    disabled={downloading}
                    sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                  >
                    Descargar PDF
                  </Button>
                )}
              </Stack>
            </CardContent>
          </MotionCard>
        ) : null}
      </Stack>

      <Dialog 
        open={paymentOpen} 
        onClose={() => !processing && resetPaymentDialog()} 
        fullWidth 
        maxWidth="md"
        PaperProps={{ sx: { borderRadius: 4 } }}
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Pagar lote del trabajador</DialogTitle>
        <DialogContent>
          {selectedWorkerGroup && selectedWorker ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Paper 
                variant="outlined" 
                sx={{ 
                  p: 3, 
                  bgcolor: `${theme.palette.primary.main}08`, 
                  borderRadius: 4, 
                  borderColor: `${theme.palette.primary.main}20`,
                  textAlign: 'center'
                }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                  Monto total a transferir
                </Typography>
                <Typography variant="h3" color="primary.main" fontWeight={900} sx={{ my: 1 }}>
                  {formatCurrencyCLP(selectedTotal)}
                </Typography>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  Consolidado de <strong>{selectedRows.length}</strong> solicitudes.
                </Typography>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }} fontWeight={700}>
                  Datos bancarios del trabajador
                </Typography>
                <Typography variant="body1" fontWeight={600}>{selectedWorker.fullName}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedWorker.bankName} · {selectedWorker.bankAccountType}
                </Typography>
                <Typography variant="h6" sx={{ mt: 0.5, letterSpacing: 1, color: 'text.primary', fontWeight: 800 }}>
                  {selectedWorker.bankAccountNumber}
                </Typography>
                <Typography variant="body2" color="text.secondary" fontWeight={500}>
                  RUT: {selectedWorker.rut}
                </Typography>
              </Paper>

              <TextField
                label="Número / referencia de transferencia *"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                fullWidth
                disabled={processing}
                placeholder="Ej: 123456789"
                helperText="Número de operación del banco"
                variant="outlined"
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
              />

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }} fontWeight={700}>
                  Comprobante de transferencia (Opcional)
                </Typography>
                <Button
                  component="label"
                  variant="outlined"
                  color={voucherFile ? 'success' : 'primary'}
                  startIcon={<UploadFileOutlinedIcon />}
                  disabled={processing}
                  sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
                >
                  {voucherFile ? 'Cambiar comprobante' : 'Subir comprobante'}
                  <input hidden type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleVoucherChange} />
                </Button>
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: voucherFile ? 'success.main' : 'text.secondary', fontWeight: 500 }}>
                  {voucherFile ? `Seleccionado: ${voucherFile.name}` : 'Ya no es obligatorio para registrar el pago'}
                </Typography>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }} fontWeight={700}>
                  Notificar por correo a:
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {recipientOptions.map((email) => (
                    <Chip
                      key={email}
                      label={email}
                      onClick={() => toggleRecipient(email)}
                      color={selectedRecipients.includes(email) ? 'primary' : 'default'}
                      variant={selectedRecipients.includes(email) ? 'filled' : 'outlined'}
                      size="small"
                      disabled={processing}
                      sx={{ borderRadius: 1.5, fontWeight: 600 }}
                    />
                  ))}
                </Stack>
              </Paper>

              {success && (
                <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                  <Alert severity="success" sx={{ mb: 2, borderRadius: 3, fontWeight: 600 }}>
                    ¡Pago registrado exitosamente! Las solicitudes han sido marcadas como pagadas y se ha generado el lote de control.
                  </Alert>
                  {isAuthorizedPayer && (
                    <Button
                      fullWidth
                      variant="contained"
                      color="secondary"
                      startIcon={downloading ? <CircularProgress size={20} color="inherit" /> : <PictureAsPdfIcon />}
                      onClick={() => handleDownloadPDF(latestPaidBatch)}
                      disabled={downloading || !latestPaidBatch}
                      sx={{ borderRadius: 3, fontWeight: 700, py: 1.2 }}
                    >
                      Descargar Comprobante PDF
                    </Button>
                  )}
                </motion.div>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={resetPaymentDialog} disabled={processing} sx={{ fontWeight: 600 }}>Cancelar</Button>
          <Button
            variant="contained"
            color="primary"
            size="large"
            disabled={!paymentReference.trim() || processing || success || selectedRows.length === 0}
            onClick={handleProcessPayment}
            startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <PaymentsOutlinedIcon />}
            sx={{ borderRadius: 3, fontWeight: 800, px: 4, py: 1.2 }}
          >
            Confirmar y registrar pago
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
