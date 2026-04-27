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
} from '@mui/material';
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

function buildVoucherStoragePath(file) {
  const safeName = file.name.replace(/\s+/g, '_');
  return `vouchers/${file.lastModified}_${safeName}`;
}

export default function Pagos() {
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
    if (!voucherFile) return;
    setProcessing(true);
    try {
      const storageRef = ref(storage, buildVoucherStoragePath(voucherFile));
      const uploadResult = await uploadBytes(storageRef, voucherFile);
      const voucherUrl = await getDownloadURL(uploadResult.ref);

      const batchData = {
        workerId: selectedWorker.id,
        workerName: selectedWorker.fullName,
        workerRut: selectedWorker.rut,
        centerCost: selectedWorkerGroup.centerCost,
        totalAmount: selectedWorkerGroup.totalAmount,
        requestCount: selectedWorkerGroup.rows.length,
        bankName: selectedWorker.bankName || '',
        bankAccountType: selectedWorker.bankAccountType || '',
        bankAccountNumber: selectedWorker.bankAccountNumber || '',
        voucherUrl,
        paymentReference: paymentReference.trim(),
        emailSentTo: selectedRecipients,
        emailSentAt: null,
      };

      const requestIds = selectedWorkerGroup.rows.map((row) => row.id);
      await createPaymentBatch(batchData, requestIds, profile);
      
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
    <Box>
      <Typography variant="h5" gutterBottom>Pagos</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Selección y consolidación de reembolsos aprobados para pago por trabajador
      </Typography>

      <Stack spacing={3}>
        {loading ? <LinearProgress /> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}

        <Card>
          <CardContent>
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2} alignItems={{ xs: 'stretch', lg: 'center' }}>
              <TextField
                select
                label="Trabajador"
                value={activeWorkerId}
                onChange={(event) => setSelectedWorkerId(event.target.value)}
                fullWidth
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
                disabled={!selectedWorkerGroup || processing}
                onClick={() => {
                  setSelectedRecipients(recipientOptions);
                  setVoucherFile(null);
                  setSuccess(false);
                  setPaymentOpen(true);
                }}
              >
                Pagar
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {selectedWorkerGroup ? (
          <>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                <Box>
                  <Typography variant="subtitle2">Trabajador seleccionado</Typography>
                  <Typography variant="body1">{selectedWorkerGroup.workerName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {selectedWorkerGroup.centerCost} · {selectedWorkerGroup.workerRut}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip label={`${selectedWorkerGroup.rows.length} solicitudes`} />
                  <Chip label={`Total ${formatCurrencyCLP(selectedWorkerGroup.totalAmount)}`} color="secondary" />
                </Stack>
              </Stack>
            </Paper>

            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 2 }}>
                  Solicitudes aprobadas pendientes
                </Typography>
                <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Solicitud</TableCell>
                        <TableCell>Fecha</TableCell>
                        <TableCell>Concepto</TableCell>
                        <TableCell align="right">Monto</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedWorkerGroup.rows.map((row) => (
                        <TableRow key={row.id} hover>
                          <TableCell>{row.requestNumber}</TableCell>
                          <TableCell>{formatDateTime(row.submittedAt)}</TableCell>
                          <TableCell>{row.concept}</TableCell>
                          <TableCell align="right">{formatCurrencyCLP(row.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Paper>
              </CardContent>
            </Card>
          </>
        ) : !loading && (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography color="text.secondary">No hay solicitudes aprobadas pendientes de pago.</Typography>
          </Box>
        )}

        {latestPaidBatch ? (
          <Card>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>Último lote pagado</Typography>
              <Typography variant="body1" fontWeight={600}>{latestPaidBatch.workerName}</Typography>
              <Typography variant="body2" color="text.secondary">
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
                  >
                    Descargar PDF
                  </Button>
                )}
              </Stack>
            </CardContent>
          </Card>
        ) : null}
      </Stack>

      <Dialog open={paymentOpen} onClose={() => !processing && resetPaymentDialog()} fullWidth maxWidth="md">
        <DialogTitle>Pagar lote del trabajador</DialogTitle>
        <DialogContent>
          {selectedWorkerGroup && selectedWorker ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'rgba(37, 99, 235, 0.04)' }}>
                <Typography variant="caption" color="text.secondary">Monto total a transferir</Typography>
                <Typography variant="h4" color="primary.main" fontWeight={700}>
                  {formatCurrencyCLP(selectedWorkerGroup.totalAmount)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Consolidado de {selectedWorkerGroup.rows.length} solicitudes.
                </Typography>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Datos bancarios del trabajador
                </Typography>
                <Typography variant="body1" fontWeight={500}>{selectedWorker.fullName}</Typography>
                <Typography variant="body2">
                  {selectedWorker.bankName} · {selectedWorker.bankAccountType}
                </Typography>
                <Typography variant="body1" sx={{ mt: 0.5, letterSpacing: 1 }}>
                  Cuenta: <strong>{selectedWorker.bankAccountNumber}</strong>
                </Typography>
                <Typography variant="body2" color="text.secondary">
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
              />

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Comprobante de transferencia *
                </Typography>
                <Button
                  component="label"
                  variant="contained"
                  color={voucherFile ? 'success' : 'primary'}
                  startIcon={<UploadFileOutlinedIcon />}
                  disabled={processing}
                >
                  {voucherFile ? 'Cambiar comprobante' : 'Subir comprobante'}
                  <input hidden type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleVoucherChange} />
                </Button>
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: voucherFile ? 'success.main' : 'text.secondary' }}>
                  {voucherFile ? `Seleccionado: ${voucherFile.name}` : 'Obligatorio para marcar como pagado'}
                </Typography>
              </Paper>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
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
                    />
                  ))}
                </Stack>
              </Paper>

              {success && (
                <>
                  <Alert severity="success" sx={{ mb: 2 }}>
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
                    >
                      Descargar Comprobante PDF
                    </Button>
                  )}
                </>
              )}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={resetPaymentDialog} disabled={processing}>Cancelar</Button>
          <Button
            variant="contained"
            color="primary"
            size="large"
            disabled={!voucherFile || !paymentReference.trim() || processing || success}
            onClick={handleProcessPayment}
            startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <PaymentsOutlinedIcon />}
          >
            Confirmar y registrar pago
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
