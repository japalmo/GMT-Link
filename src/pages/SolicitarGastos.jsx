import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Tooltip,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SaveIcon from '@mui/icons-material/Save';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useAuth } from '../contexts/AuthContext';
import {
  createDraftReceipt,
  deleteDraftReceipt,
  saveDraftReceipt,
  submitDraftGroup,
  subscribeWorkerReimbursements,
} from '../lib/repository';
import { formatCurrencyCLP, toDateValue } from '../lib/formatters';
import { storage } from '../lib/firebase';
import { extractReceiptData, hasLowConfidenceReceiptData } from '../lib/ocrService';

const STEPS = ['Información', 'Carga de Gastos', 'Revisión'];
const CATEGORIES = ['Bencina', 'Peajes', 'Alimentación', 'Alojamiento', 'Otros'];

function createReceiptId() {
  return crypto.randomUUID();
}

function getFileNameFromUrl(url) {
  if (!url) return '';
  const lastSegment = url.split('/').pop() || '';
  return decodeURIComponent(lastSegment.split('?')[0]);
}

function normalizeReceipt(item) {
  return {
    id: item.id || createReceiptId(),
    groupId: item.groupId || '',
    requestNumber: item.requestNumber || '',
    category: item.category || '',
    concept: item.concept || '',
    amount: item.amount != null ? String(item.amount) : '',
    expenseDate: toDateValue(item.expenseDate)?.toISOString().split('T')[0] || '',
    receiptNumber: item.receiptNumber || '',
    merchantName: item.merchantName || '',
    notes: item.notes || '',
    file: null,
    fileName: item.fileName || getFileNameFromUrl(item.fileUrl || item.attachmentUrls?.[0]),
    fileUrl: item.fileUrl || item.attachmentUrls?.[0] || '',
    attachmentUrls: item.attachmentUrls || [],
    aiProcessing: false,
    aiError: '',
    aiWarning: '',
  };
}

export default function SolicitarGastos() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [activeStep, setActiveStep] = useState(0);
  const [receipts, setReceipts] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [error, setError] = useState('');
  const autosaveTimeoutRef = useRef(null);
  const missingWorkerProfile = Boolean(profile && !profile.workerId);

  const editGroupId = searchParams.get('edit');
  const hasReceiptProcessing = receipts.some((r) => r.aiProcessing);
  const isBusy = loading || submitting || savingDraft || hasReceiptProcessing;

  useEffect(() => {
    if (!profile) return;
    if (!profile.workerId) return;

    // Redirigir si debe cambiar contraseña (lógica Gemini Prompt 5)
    if (profile?.mustChangePassword) {
      navigate('/perfil');
      return;
    }

    let unsubscribe;

    async function init() {
      try {
        if (editGroupId) {
          unsubscribe = subscribeWorkerReimbursements(
            profile.workerId,
            (items) => {
              const groupItems = items.filter((item) => item.groupId === editGroupId);
              if (groupItems.length > 0) {
                setGroupId(editGroupId);
                setReceipts(groupItems.map(normalizeReceipt));
                setLoading(false);
              } else {
                setError('No se encontró el borrador especificado.');
                setLoading(false);
              }
            },
            (err) => {
              setError(err.message);
              setLoading(false);
            }
          );
        } else {
          const createdReceipt = await createDraftReceipt(profile);
          setGroupId(createdReceipt.groupId);
          setReceipts([normalizeReceipt(createdReceipt)]);
          setLoading(false);
        }
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    }

    init();

    return () => {
      if (unsubscribe) unsubscribe();
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [profile, navigate, editGroupId]);

  const flushDraft = async (nextReceipts) => {
    if (!profile?.workerId || nextReceipts.length === 0) return;
    await Promise.all(nextReceipts.map((receipt) => saveDraftReceipt(receipt, profile)));
  };

  const scheduleAutosave = (nextReceipts) => {
    if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
    autosaveTimeoutRef.current = setTimeout(async () => {
      try {
        await flushDraft(nextReceipts);
      } catch {
        console.error('Autosave failed');
      }
    }, 1000);
  };

  const updateReceipt = (id, fields) => {
    setReceipts((current) => {
      const next = current.map((r) => (r.id === id ? { ...r, ...fields } : r));
      scheduleAutosave(next);
      return next;
    });
  };

  const addReceipt = async () => {
    setSavingDraft(true);
    try {
      const created = await createDraftReceipt(profile, groupId);
      setReceipts((current) => [...current, normalizeReceipt(created)]);
    } catch {
      setError('Error al enviar la solicitud.');
    } finally {
      setSavingDraft(false);
    }
  };

  const removeReceipt = async (id) => {
    if (receipts.length === 1) return;
    setSavingDraft(true);
    try {
      await deleteDraftReceipt(id);
      setReceipts((current) => current.filter((r) => r.id !== id));
    } catch {
      setError('Error al enviar la solicitud.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleFileChange = async (id, file) => {
    if (!file) return;

    updateReceipt(id, {
      file,
      fileName: file.name,
      aiProcessing: true,
      aiError: '',
      aiWarning: '',
    });

    try {
      const storageRef = ref(storage, `reimbursements/drafts/${groupId}/${id}_${file.name.replace(/\s+/g, '_')}`);
      const [extracted, snapshot] = await Promise.all([
        extractReceiptData(file).catch(() => null),
        uploadBytes(storageRef, file),
      ]);
      const fileUrl = await getDownloadURL(snapshot.ref);
      const aiWarning = extracted && hasLowConfidenceReceiptData(extracted)
        ? 'Revisá los datos — la lectura puede ser incompleta'
        : '';

      updateReceipt(id, {
        category: extracted?.category ?? '',
        concept: extracted?.concept ?? '',
        amount: extracted?.amount != null ? String(extracted.amount) : '',
        expenseDate: extracted?.expenseDate ?? '',
        merchantName: extracted?.merchantName ?? '',
        receiptNumber: extracted?.receiptNumber ?? '',
        fileUrl,
        attachmentUrls: [fileUrl],
        aiProcessing: false,
        aiError: extracted ? '' : 'No se pudo leer la boleta. Completá los campos manualmente.',
        aiWarning,
      });
    } catch {
      updateReceipt(id, {
        aiProcessing: false,
        aiError: 'Error al procesar archivo.',
        aiWarning: '',
      });
    }
  };

  const totalAmount = useMemo(
    () => receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0),
    [receipts]
  );

  const handleNext = () => {
    if (activeStep === 1) {
      if (receipts.some((r) => !r.amount || !r.fileUrl)) {
        setError('Cada gasto debe tener monto y comprobante.');
        return;
      }
    }
    setError('');
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => setActiveStep((prev) => prev - 1);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await flushDraft(receipts);
      await submitDraftGroup(receipts, profile);
      navigate('/mis-solicitudes');
    } catch {
      setError('Error al enviar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      await flushDraft(receipts);
      navigate('/mis-solicitudes');
    } catch {
      setError('Error al enviar la solicitud.');
    } finally {
      setSavingDraft(false);
    }
  };

  if (missingWorkerProfile) {
    return (
      <Box sx={{ maxWidth: 800, mx: 'auto', py: 2 }}>
        <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
          Nueva Solicitud de Reembolso
        </Typography>
        <Alert severity="warning">
          Tu perfil no tiene un trabajador asociado — contacta a RRHH.
        </Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', py: 2 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        Nueva Solicitud de Reembolso
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

      <Card sx={{ borderRadius: 3, mb: 4 }}>
        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
          {activeStep === 0 && (
            <Stack spacing={3}>
              <Typography variant="h6" fontWeight={700}>Información del Solicitante</Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField label="Nombre" fullWidth disabled value={profile?.displayName || ''} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="RUT" fullWidth disabled value={profile?.rut || ''} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Centro de Costo" fullWidth disabled value={profile?.centerCosts?.[0] || 'N/A'} />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField label="Email" fullWidth disabled value={profile?.email || ''} />
                </Grid>
              </Grid>
              <Alert severity="info">
                Los reembolsos se procesan según la información de tu perfil. Si hay errores, contacta a RRHH.
              </Alert>
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack spacing={3}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" fontWeight={700}>Detalle de Gastos</Typography>
                <Chip label={`ID: ${groupId}`} size="small" variant="outlined" />
              </Box>

              {receipts.map((receipt) => (
                <Card key={receipt.id} variant="outlined" sx={{ borderRadius: 2, p: 2, position: 'relative' }}>
                  {receipts.length > 1 && (
                    <IconButton
                      size="small"
                      color="error"
                      sx={{ position: 'absolute', top: 8, right: 8 }}
                      onClick={() => removeReceipt(receipt.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                  
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={4}>
                      <Box
                        component="label"
                        sx={{
                          height: '100%',
                          minHeight: 140,
                          border: '2px dashed',
                          borderColor: receipt.fileUrl ? 'success.main' : 'primary.light',
                          borderRadius: 2,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          bgcolor: receipt.fileUrl ? 'rgba(16,185,129,0.04)' : 'rgba(37,99,235,0.02)',
                          cursor: 'pointer',
                          p: 1,
                        }}
                      >
                        <input
                          type="file"
                          hidden
                          accept="image/*,.pdf"
                          onChange={(e) => handleFileChange(receipt.id, e.target.files?.[0])}
                        />
                        {receipt.aiProcessing ? (
                          <CircularProgress size={30} />
                        ) : receipt.fileUrl ? (
                          <>
                            <CheckCircleOutlineIcon color="success" />
                            <Typography variant="caption" sx={{ mt: 1 }}>Cambiar archivo</Typography>
                          </>
                        ) : (
                          <>
                            <UploadFileIcon color="primary" />
                            <Typography variant="caption" sx={{ mt: 1 }}>Subir boleta</Typography>
                          </>
                        )}
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={8}>
                      <Stack spacing={2}>
                        <Stack direction="row" spacing={1}>
                          <TextField
                            select
                            label="Categoría"
                            size="small"
                            fullWidth
                            value={receipt.category}
                            onChange={(e) => updateReceipt(receipt.id, { category: e.target.value })}
                          >
                            {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                          </TextField>
                          <TextField
                            label="Monto"
                            size="small"
                            fullWidth
                            type="number"
                            value={receipt.amount}
                            onChange={(e) => updateReceipt(receipt.id, { amount: e.target.value })}
                          />
                        </Stack>
                        <TextField
                          label="Descripción"
                          size="small"
                          fullWidth
                          value={receipt.concept}
                          onChange={(e) => updateReceipt(receipt.id, { concept: e.target.value })}
                        />
                      </Stack>
                    </Grid>
                  </Grid>
                  {receipt.aiWarning && (
                    <Alert severity="warning" sx={{ mt: 2 }}>
                      {receipt.aiWarning}
                    </Alert>
                  )}
                  {receipt.aiError && <Typography variant="caption" color="error">{receipt.aiError}</Typography>}
                </Card>
              ))}

              <Button
                variant="outlined"
                fullWidth
                startIcon={<AddIcon />}
                onClick={addReceipt}
                disabled={isBusy}
                sx={{ borderStyle: 'dashed', py: 1.5 }}
              >
                Agregar otro ítem
              </Button>
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack spacing={3}>
              <Typography variant="h6" fontWeight={700}>Revisión Final</Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>Descripción</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>Monto</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {receipts.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.concept || r.category || 'Sin descripción'}</TableCell>
                      <TableCell align="right">{formatCurrencyCLP(r.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>TOTAL</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: 'primary.main' }}>
                      {formatCurrencyCLP(totalAmount)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Alert severity="info">
                Al enviar, la solicitud pasará a revisión por tu supervisor. Puedes guardarla como borrador para continuar después.
              </Alert>
            </Stack>
          )}
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="text"
            startIcon={<ArrowBackIcon />}
            onClick={activeStep === 0 ? () => navigate('/mis-solicitudes') : handleBack}
            disabled={submitting}
          >
            {activeStep === 0 ? 'Cancelar' : 'Atrás'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<SaveIcon />}
            onClick={handleSaveDraft}
            disabled={isBusy || receipts.length === 0}
          >
            Guardar Borrador
          </Button>
        </Box>
        
        {activeStep < 2 ? (
          <Button
            variant="contained"
            endIcon={<ArrowForwardIcon />}
            onClick={handleNext}
            disabled={isBusy || receipts.length === 0}
          >
            Siguiente
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isBusy}
            sx={{ px: 4, fontWeight: 700 }}
          >
            {submitting ? <CircularProgress size={24} color="inherit" /> : 'Confirmar y Enviar'}
          </Button>
        )}
      </Box>
    </Box>
  );
}
