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
  useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
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
  submitAuthenticatedReimbursementBatch,
  submitDraftGroup,
  subscribeWorkerReimbursements,
} from '../lib/repository';
import { formatCurrencyCLP, toDateValue } from '../lib/formatters';
import { storage } from '../lib/firebase';
import { extractReceiptData, hasLowConfidenceReceiptData } from '../lib/ocrService';

const MotionBox = motion(Box);
const MotionCard = motion(Card);

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
    documentType: item.documentType || 'boleta',
    concept: item.concept || '',
    amount: item.amount != null ? String(item.amount) : '',
    expenseDate: toDateValue(item.expenseDate)?.toISOString().split('T')[0] || '',
    receiptNumber: item.receiptNumber || '',
    merchantName: item.merchantName || '',
    notes: item.notes || '',
    file: null,
    fileName: item.fileName || getFileNameFromUrl(item.fileUrl || item.attachmentUrls?.[0]),
    fileUrl: item.fileUrl || item.attachmentUrls?.[0] || '',
    previewUrl: '',
    attachmentUrls: item.attachmentUrls || [],
    aiProcessing: false,
    aiError: '',
    aiWarning: '',
  };
}

function createEmptyReceipt(groupId = '') {
  return normalizeReceipt({
    groupId,
  });
}

export default function SolicitarGastos() {
  const theme = useTheme();
  const { profile, user } = useAuth();
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
  const isInternalUser = Boolean(profile && !profile.workerId);
  const submitTarget = isInternalUser ? '/reembolsos' : '/mis-solicitudes';
  const editGroupId = searchParams.get('edit');
  const hasReceiptProcessing = receipts.some((r) => r.aiProcessing);
  const isBusy = loading || submitting || savingDraft || hasReceiptProcessing;

  useEffect(() => {
    if (!profile) return;

    // Redirigir si debe cambiar contraseña (lógica Gemini Prompt 5)
    if (profile?.mustChangePassword) {
      navigate('/perfil');
      return;
    }

    let unsubscribe;

    async function init() {
      try {
        if (editGroupId) {
          // Nota: El flujo de edición sigue requiriendo workerId por consistencia con repositorio
          if (!profile.workerId) {
             setError('Los borradores solo están disponibles para perfiles de trabajador.');
             setLoading(false);
             return;
          }
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
          // Nuevo flujo sin workerId: trabajar en memoria
          if (isInternalUser) {
            setGroupId(`SOL-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-000`);
            setReceipts([createEmptyReceipt()]);
            setLoading(false);
          } else {
            const createdReceipt = await createDraftReceipt(profile);
            setGroupId(createdReceipt.groupId);
            setReceipts([normalizeReceipt(createdReceipt)]);
            setLoading(false);
          }
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
  }, [profile, navigate, editGroupId, isInternalUser]);

  const flushDraft = async (nextReceipts) => {
    if (isInternalUser || !profile?.workerId || nextReceipts.length === 0) return;
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
      if (isInternalUser) {
        setReceipts((current) => [...current, createEmptyReceipt(groupId)]);
      } else {
        const created = await createDraftReceipt(profile, groupId);
        setReceipts((current) => [...current, normalizeReceipt(created)]);
      }
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
      if (!isInternalUser) {
        await deleteDraftReceipt(id);
      }
      setReceipts((current) => current.filter((r) => r.id !== id));
    } catch {
      setError('Error al enviar la solicitud.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleFileChange = async (id, file) => {
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    updateReceipt(id, {
      file,
      fileName: file.name,
      previewUrl,
      aiProcessing: true,
      aiError: '',
      aiWarning: '',
    });

    try {
      const storageRef = ref(storage, `reimbursements/drafts/${groupId}/${id}_${file.name.replace(/\s+/g, '_')}`);
      const [extracted, snapshot] = await Promise.all([
        extractReceiptData(file).catch((err) => { console.error('[OCR error]', err); return null; }),
        uploadBytes(storageRef, file),
      ]);
      const fileUrl = await getDownloadURL(snapshot.ref);
      const aiWarning = extracted && hasLowConfidenceReceiptData(extracted)
        ? 'Revisá los datos — la lectura puede ser incompleta'
        : '';

      updateReceipt(id, {
        category: extracted?.category ?? '',
        documentType: extracted?.documentType ?? 'boleta',
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
      if (isInternalUser) {
        await submitAuthenticatedReimbursementBatch(receipts, {
          ...profile,
          uid: user?.uid ?? profile?.uid ?? '',
        });
      } else {
        await flushDraft(receipts);
        await submitDraftGroup(receipts, profile);
      }
      navigate(submitTarget);
    } catch {
      setError('Error al enviar la solicitud.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (isInternalUser) return;
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

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', py: 2, pb: 6 }}>
      <MotionBox
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Typography variant="h5" fontWeight={800} sx={{ mb: 3 }}>
          Nueva Solicitud de Reembolso
        </Typography>
      </MotionBox>

      <MotionBox
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Stepper 
          activeStep={activeStep} 
          sx={{ 
            mb: 4,
            '& .MuiStepLabel-label': { fontWeight: 600, fontSize: '0.85rem' },
            '& .MuiStepIcon-root.Mui-active': { color: 'primary.main' },
            '& .MuiStepIcon-root.Mui-completed': { color: 'success.main' }
          }}
        >
          {STEPS.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </MotionBox>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <Alert severity="error" sx={{ mb: 3, borderRadius: 2 }}>{error}</Alert>
          </motion.div>
        )}
      </AnimatePresence>

      <MotionCard 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        sx={{ borderRadius: 4, mb: 4, boxShadow: '0 4px 20px rgba(0,0,0,0.05)' }}
      >
        <CardContent sx={{ p: { xs: 2, md: 4 } }}>
          <AnimatePresence mode="wait">
            {activeStep === 0 && (
              <MotionBox
                key="step0"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.4 }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <Typography variant="h6" fontWeight={700}>Información del Solicitante</Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField 
                      label="Nombre" 
                      fullWidth 
                      disabled 
                      value={profile?.displayName || ''} 
                      variant="outlined"
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField 
                      label="RUT" 
                      fullWidth 
                      disabled 
                      value={profile?.rut || ''} 
                      variant="outlined"
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField 
                      label="Centro de Costo" 
                      fullWidth 
                      disabled 
                      value={profile?.centerCosts?.[0] || 'N/A'} 
                      variant="outlined"
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField 
                      label="Email" 
                      fullWidth 
                      disabled 
                      value={profile?.email || ''} 
                      variant="outlined"
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 3 } }}
                    />
                  </Grid>
                </Grid>
                <Alert severity="info" sx={{ borderRadius: 2 }}>
                  Los reembolsos se procesan según la información de tu perfil. Si hay errores, contacta a RRHH.
                </Alert>
                {isInternalUser ? (
                  <Alert severity="info" sx={{ borderRadius: 2 }}>
                    Tu perfil no tiene `workerId`. Esta solicitud se enviará directamente al confirmar y no tendrá borrador ni autoguardado.
                  </Alert>
                ) : null}
              </MotionBox>
            )}

            {activeStep === 1 && (
              <MotionBox
                key="step1"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.4 }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="h6" fontWeight={700}>Detalle de Gastos</Typography>
                  <Chip label={`ID: ${groupId}`} size="small" variant="outlined" sx={{ borderRadius: 1.5, fontWeight: 700 }} />
                </Box>

                <Stack spacing={2}>
                  {receipts.map((receipt, idx) => (
                    <MotionCard 
                      key={receipt.id} 
                      variant="outlined" 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      sx={{ borderRadius: 3, p: 2, position: 'relative', border: '1px solid rgba(0,0,0,0.08)' }}
                    >
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
                              borderRadius: 3,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              bgcolor: receipt.fileUrl ? `${theme.palette.success.main}08` : `${theme.palette.primary.main}04`,
                              cursor: 'pointer',
                              p: 1,
                              transition: 'all 0.2s',
                              '&:hover': {
                                bgcolor: receipt.fileUrl ? `${theme.palette.success.main}12` : `${theme.palette.primary.main}08`,
                                borderColor: 'primary.main',
                              }
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
                            ) : receipt.previewUrl ? (
                              <>
                                <Box
                                  component="img"
                                  src={receipt.previewUrl}
                                  alt="preview"
                                  sx={{
                                    width: '100%',
                                    height: 100,
                                    objectFit: 'cover',
                                    borderRadius: 2,
                                    mb: 0.5,
                                  }}
                                />
                                <Typography variant="caption" fontWeight={600}>Cambiar archivo</Typography>
                              </>
                            ) : receipt.fileUrl ? (
                              <>
                                <CheckCircleOutlinedIcon color="success" />
                                <Typography variant="caption" sx={{ mt: 1 }} fontWeight={600}>Cambiar archivo</Typography>
                              </>
                            ) : (
                              <>
                                <UploadFileIcon color="primary" />
                                <Typography variant="caption" sx={{ mt: 1 }} fontWeight={600}>Subir boleta</Typography>
                              </>
                            )}
                          </Box>
                        </Grid>
                        <Grid item xs={12} md={8}>
                          <Stack spacing={2}>
                            <Grid container spacing={1}>
                              <Grid item xs={12} sm={4}>
                                <TextField
                                  select
                                  label="Tipo"
                                  size="small"
                                  fullWidth
                                  value={receipt.documentType}
                                  onChange={(e) => updateReceipt(receipt.id, { documentType: e.target.value })}
                                  variant="outlined"
                                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
                                >
                                  <MenuItem value="boleta">Boleta</MenuItem>
                                  <MenuItem value="factura">Factura</MenuItem>
                                </TextField>
                              </Grid>
                              <Grid item xs={12} sm={4}>
                                <TextField
                                  select
                                  label="Categoría"
                                  size="small"
                                  fullWidth
                                  value={receipt.category}
                                  onChange={(e) => updateReceipt(receipt.id, { category: e.target.value })}
                                  variant="outlined"
                                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
                                >
                                  {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                                </TextField>
                              </Grid>
                              <Grid item xs={12} sm={4}>
                                <TextField
                                  label="Monto"
                                  size="small"
                                  fullWidth
                                  type="number"
                                  value={receipt.amount}
                                  onChange={(e) => updateReceipt(receipt.id, { amount: e.target.value })}
                                  variant="outlined"
                                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 }, '& input': { fontWeight: 700, color: 'primary.main' } }}
                                />
                              </Grid>
                            </Grid>
                            <TextField
                              label="Descripción / Comercio"
                              size="small"
                              fullWidth
                              value={receipt.concept}
                              onChange={(e) => updateReceipt(receipt.id, { concept: e.target.value })}
                              variant="outlined"
                              sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
                            />
                          </Stack>
                        </Grid>
                      </Grid>
                      {receipt.aiWarning && (
                        <Alert severity="warning" sx={{ mt: 2, borderRadius: 2, py: 0 }}>
                          <Typography variant="caption" fontWeight={600}>{receipt.aiWarning}</Typography>
                        </Alert>
                      )}
                      {receipt.aiError && <Typography variant="caption" color="error" fontWeight={600}>{receipt.aiError}</Typography>}
                    </MotionCard>
                  ))}
                </Stack>

                <Button
                  variant="outlined"
                  fullWidth
                  startIcon={<AddIcon />}
                  onClick={addReceipt}
                  disabled={isBusy}
                  sx={{ borderStyle: 'dashed', py: 1.5, borderRadius: 3, fontWeight: 700 }}
                >
                  Agregar otro ítem
                </Button>
              </MotionBox>
            )}

            {activeStep === 2 && (
              <MotionBox
                key="step2"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.4 }}
                sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}
              >
                <Typography variant="h6" fontWeight={700}>Revisión Final</Typography>
                <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: 'rgba(0,0,0,0.02)' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 700 }}>Descripción</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 700 }}>Monto</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {receipts.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell sx={{ fontWeight: 500 }}>{r.concept || r.category || 'Sin descripción'}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>{formatCurrencyCLP(r.amount)}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow sx={{ bgcolor: `${theme.palette.primary.main}04` }}>
                        <TableCell sx={{ fontWeight: 800 }}>TOTAL</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 900, color: 'primary.main', fontSize: '1.1rem' }}>
                          {formatCurrencyCLP(totalAmount)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </Paper>
                <Alert severity="info" sx={{ borderRadius: 2 }}>
                  Al enviar, la solicitud pasará a revisión por tu supervisor. Puedes guardarla como borrador para continuar después.
                </Alert>
              </MotionBox>
            )}
          </AnimatePresence>
        </CardContent>
      </MotionCard>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="text"
            startIcon={<ArrowBackIcon />}
            onClick={activeStep === 0 ? () => navigate(submitTarget) : handleBack}
            disabled={submitting}
            sx={{ fontWeight: 600, textTransform: 'none' }}
          >
            {activeStep === 0 ? 'Cancelar' : 'Atrás'}
          </Button>
          {!isInternalUser && (
            <Button
              variant="outlined"
              startIcon={<SaveIcon />}
              onClick={handleSaveDraft}
              disabled={isBusy || receipts.length === 0}
              sx={{ borderRadius: 2, fontWeight: 600, textTransform: 'none' }}
            >
              Guardar Borrador
            </Button>
          )}
        </Box>
        
        {activeStep < 2 ? (
          <Button
            variant="contained"
            endIcon={<ArrowForwardIcon />}
            onClick={handleNext}
            disabled={isBusy || receipts.length === 0}
            sx={{ borderRadius: 2.5, px: 4, fontWeight: 700, textTransform: 'none' }}
          >
            Siguiente
          </Button>
        ) : (
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={isBusy}
            sx={{ px: 5, py: 1.2, fontWeight: 800, borderRadius: 3, textTransform: 'none' }}
          >
            {submitting ? <CircularProgress size={24} color="inherit" /> : 'Confirmar y Enviar'}
          </Button>
        )}
      </Box>
    </Box>
  );
}
