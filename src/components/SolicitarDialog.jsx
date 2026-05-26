import { useEffect, useMemo, useRef, useState } from 'react';
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
  Grid,
  IconButton,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SaveIcon from '@mui/icons-material/Save';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { getGenerativeModel } from 'firebase/ai';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { useAuth } from '../contexts/AuthContext';
import {
  createDraftReceipt,
  deleteDraftReceipt,
  saveDraftReceipt,
  submitDraftGroup,
} from '../lib/repository';
import { formatCurrencyCLP, toDateValue } from '../lib/formatters';
import { firebaseAI, storage } from '../lib/firebase';
import { randomUUID } from '../lib/uuid';

const CATEGORIES = ['Bencina', 'Peajes', 'Alimentación', 'Alojamiento', 'Otros'];

function createReceiptId() {
  return randomUUID();
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
    attachmentUrls: item.attachmentUrls || [],
    aiProcessing: false,
    aiError: '',
  };
}

function isReceiptEmpty(receipt) {
  return !receipt.category
    && !receipt.concept
    && !receipt.amount
    && !receipt.expenseDate
    && !receipt.receiptNumber
    && !receipt.merchantName
    && !receipt.notes
    && !receipt.fileUrl;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractReceiptData(file) {
  const base64 = await fileToBase64(file);
  const model = getGenerativeModel(firebaseAI, { model: 'gemini-2.0-flash' });
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: file.type || 'image/jpeg',
        data: base64,
      },
    },
    `Analiza esta boleta o factura chilena y extrae los datos. Responde SOLO con un objeto JSON válido con exactamente estos campos:
{"category":"Bencina|Peajes|Alimentación|Alojamiento|Otros","documentType":"boleta|factura","concept":"descripción breve del gasto","amount":número_entero_en_CLP_sin_puntos,"expenseDate":"YYYY-MM-DD","merchantName":"nombre del comercio","receiptNumber":"número de boleta o factura o vacío"}
Si no puedes leer un campo, usa null. Solo JSON, sin texto adicional ni bloques de código.`,
  ]);

  const text = result.response.text().trim().replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

export default function SolicitarDialog({ open, onClose, initialGroup = null }) {
  const { profile, user } = useAuth();
  const autosaveTimeoutRef = useRef(null);
  const [receipts, setReceipts] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [draftLoading, setDraftLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submittedGroupId, setSubmittedGroupId] = useState('');
  const [error, setError] = useState('');

  const isEditingExistingDraft = Boolean(initialGroup?.id);
  const hasReceiptProcessing = receipts.some((receipt) => receipt.aiProcessing);
  const isBusy = draftLoading || submitting || savingDraft || hasReceiptProcessing;

  useEffect(() => {
    if (!open || !profile?.workerId) return undefined;

    let active = true;

    async function initializeDialog() {
      setDraftLoading(true);
      setPreviewOpen(false);
      setSubmitting(false);
      setSavingDraft(false);
      setSuccess(false);
      setSubmittedGroupId('');
      setError('');

      try {
        if (initialGroup?.items?.length) {
          if (!active) return;
          setGroupId(initialGroup.id);
          setReceipts(initialGroup.items.map(normalizeReceipt));
        } else {
          const createdReceipt = await createDraftReceipt(profile);
          if (!active) return;
          setGroupId(createdReceipt.groupId);
          setReceipts([normalizeReceipt(createdReceipt)]);
        }
      } catch (initializationError) {
        if (!active) return;
        setError(initializationError.message);
        setReceipts([]);
        setGroupId('');
      } finally {
        if (active) {
          setDraftLoading(false);
        }
      }
    }

    initializeDialog();

    return () => {
      active = false;
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
    };
  }, [initialGroup, open, profile]);

  const persistToLocalStorage = (nextReceipts) => {
    if (!user?.uid) return;
    localStorage.setItem(
      `gmt-link-draft-${user.uid}`,
      JSON.stringify(nextReceipts.map((receipt) => ({ ...receipt, file: null }))),
    );
  };

  const flushDraft = async (nextReceipts) => {
    if (!profile?.workerId || nextReceipts.length === 0) return;
    await Promise.all(nextReceipts.map((receipt) => saveDraftReceipt(receipt, profile)));
  };

  const scheduleAutosave = (nextReceipts) => {
    if (!profile?.workerId || nextReceipts.length === 0) return;
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(async () => {
      try {
        await flushDraft(nextReceipts);
      } catch {
        persistToLocalStorage(nextReceipts);
        setError('No se pudo guardar el borrador en línea. Dejamos una copia local de respaldo.');
      }
    }, 600);
  };

  const updateReceipt = (id, fields) => {
    setReceipts((current) => {
      const nextReceipts = current.map((receipt) => (
        receipt.id === id ? { ...receipt, ...fields } : receipt
      ));
      scheduleAutosave(nextReceipts);
      return nextReceipts;
    });
  };

  const addReceipt = async () => {
    if (!groupId) return;
    setSavingDraft(true);
    setError('');

    try {
      const createdReceipt = await createDraftReceipt(profile, groupId);
      setReceipts((current) => [...current, normalizeReceipt(createdReceipt)]);
    } catch (creationError) {
      setError(creationError.message);
    } finally {
      setSavingDraft(false);
    }
  };

  const removeReceipt = async (receiptId) => {
    if (receipts.length === 1) return;
    setSavingDraft(true);
    setError('');

    try {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
      await deleteDraftReceipt(receiptId);
      setReceipts((current) => current.filter((receipt) => receipt.id !== receiptId));
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setSavingDraft(false);
    }
  };

  const handleFileChange = async (receiptId, file) => {
    if (!file || !groupId) return;

    updateReceipt(receiptId, {
      file,
      fileName: file.name,
      aiProcessing: true,
      aiError: '',
    });

    try {
      const storageRef = ref(storage, `reimbursements/drafts/${groupId}/${receiptId}_${file.name.replace(/\s+/g, '_')}`);
      const [extracted, snapshot] = await Promise.all([
        extractReceiptData(file).catch(() => null),
        uploadBytes(storageRef, file),
      ]);
      const fileUrl = await getDownloadURL(snapshot.ref);

      updateReceipt(receiptId, {
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
        aiError: extracted ? '' : 'No se pudo leer la boleta. Complete los campos manualmente.',
      });
    } catch {
      updateReceipt(receiptId, {
        aiProcessing: false,
        aiError: 'No se pudo subir el comprobante. Intenta nuevamente.',
      });
    }
  };

  const totalAmount = useMemo(
    () => receipts.reduce((sum, receipt) => sum + (Number(receipt.amount) || 0), 0),
    [receipts],
  );

  const validateForm = () => {
    if (receipts.some((receipt) => !receipt.amount || !receipt.expenseDate || !receipt.fileUrl)) {
      setError('Complete monto, fecha y comprobante en cada boleta antes de enviar.');
      return false;
    }

    setError('');
    return true;
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    setError('');

    try {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }
      await flushDraft(receipts);
      onClose();
    } catch {
      persistToLocalStorage(receipts);
      setError('No se pudo sincronizar el borrador en línea. Dejamos una copia local.');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');

    try {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
        autosaveTimeoutRef.current = null;
      }

      await flushDraft(receipts);
      const nextGroupId = await submitDraftGroup(receipts, profile);
      setSubmittedGroupId(nextGroupId);
      setSuccess(true);
    } catch {
      persistToLocalStorage(receipts);
      setError('No se pudo enviar la solicitud. Tu borrador quedó respaldado localmente.');
    } finally {
      setSubmitting(false);
      setPreviewOpen(false);
    }
  };

  const handleClose = async () => {
    if (isBusy) return;

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = null;
    }

    if (!isEditingExistingDraft && receipts.length > 0 && receipts.every(isReceiptEmpty)) {
      try {
        await Promise.all(receipts.map((receipt) => deleteDraftReceipt(receipt.id)));
      } catch {
        // If cleanup fails, keep the draft in Firestore rather than blocking the user.
      }
    } else {
      try {
        await flushDraft(receipts);
      } catch {
        persistToLocalStorage(receipts);
      }
    }

    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        fullWidth
        maxWidth="lg"
        scroll="paper"
      >
        <DialogTitle sx={{ fontWeight: 800 }}>
          {success ? 'Solicitud enviada' : 'Nuevo reembolso'}
        </DialogTitle>

        <DialogContent dividers>
          {draftLoading ? (
            <Box sx={{ py: 8, textAlign: 'center' }}>
              <CircularProgress size={36} sx={{ mb: 2 }} />
              <Typography variant="body1" fontWeight={600}>Preparando borrador en línea...</Typography>
            </Box>
          ) : success ? (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <CheckCircleOutlinedIcon color="success" sx={{ fontSize: 90, mb: 2 }} />
              <Typography variant="h5" fontWeight={800} gutterBottom>Enviado con éxito</Typography>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
                Su solicitud <strong>{submittedGroupId}</strong> fue enviada para revisión.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                  La encontrará en esta misma sección de reembolsos.
              </Typography>
            </Box>
          ) : (
            <Stack spacing={3} sx={{ pt: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">Solicitante</Typography>
                  <Typography variant="subtitle1" fontWeight={700}>{profile?.displayName}</Typography>
                  <Typography variant="caption" color="text.secondary">
                        El formulario se guarda como borrador de forma automática.
                  </Typography>
                </Box>
                <Chip label={profile?.centerCosts?.[0] || 'Sin Centro de Costo'} size="small" variant="outlined" />
              </Box>

              {error ? <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert> : null}

              {receipts.map((receipt, index) => (
                <Card
                  key={receipt.id}
                  sx={{ borderRadius: 3, position: 'relative', overflow: 'visible', border: '1px solid', borderColor: 'divider' }}
                >
                  {receipts.length > 1 ? (
                    <Tooltip title="Eliminar boleta">
                      <IconButton
                        onClick={() => removeReceipt(receipt.id)}
                        size="small"
                        sx={{
                          position: 'absolute',
                          top: -14,
                          right: -14,
                          bgcolor: 'error.main',
                          color: 'white',
                          '&:hover': { bgcolor: 'error.dark' },
                          boxShadow: 2,
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  ) : null}

                  <CardContent sx={{ p: 3 }}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }}>
                      <Box
                        sx={{
                          width: 28,
                          height: 28,
                          borderRadius: '50%',
                          bgcolor: 'primary.main',
                          color: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: 14,
                        }}
                      >
                        {index + 1}
                      </Box>
                      <Typography variant="h6" fontWeight={700} color="primary">Boleta / comprobante</Typography>
                    </Stack>

                    {receipt.aiError ? (
                      <Alert severity="warning" sx={{ mb: 2, borderRadius: 2 }}>
                        {receipt.aiError}
                      </Alert>
                    ) : null}

                    <Grid container spacing={4}>
                      <Grid item xs={12} md={4}>
                        <Box
                          component="label"
                          sx={{
                            height: '100%',
                            minHeight: 200,
                            border: '2px dashed',
                            borderColor: receipt.fileUrl ? 'success.main' : 'primary.light',
                            borderRadius: 3,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            p: 3,
                            bgcolor: receipt.fileUrl ? 'rgba(16,185,129,0.04)' : 'rgba(37,99,235,0.02)',
                            cursor: 'pointer',
                            transition: '0.3s',
                            '&:hover': { bgcolor: 'rgba(37,99,235,0.06)', borderColor: 'primary.main' },
                          }}
                        >
                          <input
                            type="file"
                            hidden
                            accept="image/*,.pdf"
                            onChange={(event) => handleFileChange(receipt.id, event.target.files?.[0])}
                          />
                          {receipt.aiProcessing ? (
                            <>
                              <CircularProgress size={48} sx={{ mb: 2 }} />
                              <Typography variant="body2" fontWeight={700}>Procesando comprobante...</Typography>
                              <Typography variant="caption" color="text.secondary">Subiendo archivo y leyendo datos</Typography>
                            </>
                          ) : receipt.fileUrl ? (
                            <>
                              <CheckCircleOutlinedIcon color="success" sx={{ fontSize: 56, mb: 1 }} />
                              <Typography variant="body2" fontWeight={700} align="center" noWrap sx={{ maxWidth: '100%' }}>
                                {receipt.fileName || 'Comprobante cargado'}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">Clic para reemplazar</Typography>
                            </>
                          ) : (
                            <>
                              <UploadFileIcon sx={{ fontSize: 56, mb: 1, color: 'primary.light' }} />
                              <Typography variant="body2" fontWeight={700}>Subir imagen o PDF</Typography>
                              <Typography variant="caption" color="text.secondary" align="center">
                                El borrador se guarda en línea mientras avanzas
                              </Typography>
                            </>
                          )}
                        </Box>
                      </Grid>

                      <Grid item xs={12} md={8}>
                        <Stack spacing={2.5}>
                          <Grid container spacing={2}>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                select
                                label="Tipo"
                                fullWidth
                                value={receipt.documentType}
                                onChange={(event) => updateReceipt(receipt.id, { documentType: event.target.value })}
                              >
                                <MenuItem value="boleta">Boleta</MenuItem>
                                <MenuItem value="factura">Factura</MenuItem>
                              </TextField>
                            </Grid>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                select
                                label="Categoría"
                                fullWidth
                                value={receipt.category}
                                onChange={(event) => updateReceipt(receipt.id, { category: event.target.value })}
                                InputProps={{
                                  startAdornment: receipt.aiProcessing
                                    ? <AutoFixHighIcon color="primary" sx={{ mr: 1, opacity: 0.5 }} />
                                    : null,
                                }}
                              >
                                {CATEGORIES.map((category) => (
                                  <MenuItem key={category} value={category}>{category}</MenuItem>
                                ))}
                              </TextField>
                            </Grid>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                label="Monto (CLP)"
                                fullWidth
                                type="number"
                                value={receipt.amount}
                                onChange={(event) => updateReceipt(receipt.id, { amount: event.target.value })}
                                placeholder="Ej: 15000"
                              />
                            </Grid>
                          </Grid>

                          <TextField
                            label="Descripción / concepto"
                            fullWidth
                            multiline
                            rows={2}
                            value={receipt.concept}
                            onChange={(event) => updateReceipt(receipt.id, { concept: event.target.value })}
                            placeholder="Ej: Almuerzo en terreno Faena X"
                          />

                          <Grid container spacing={2}>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                label="Fecha"
                                fullWidth
                                type="date"
                                slotProps={{ inputLabel: { shrink: true } }}
                                value={receipt.expenseDate}
                                onChange={(event) => updateReceipt(receipt.id, { expenseDate: event.target.value })}
                              />
                            </Grid>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                label="Comercio"
                                fullWidth
                                value={receipt.merchantName}
                                onChange={(event) => updateReceipt(receipt.id, { merchantName: event.target.value })}
                                placeholder="Ej: Shell"
                              />
                            </Grid>
                            <Grid item xs={12} sm={4}>
                              <TextField
                                label="Nº boleta"
                                fullWidth
                                value={receipt.receiptNumber}
                                onChange={(event) => updateReceipt(receipt.id, { receiptNumber: event.target.value })}
                                placeholder="Opcional"
                              />
                            </Grid>
                          </Grid>
                        </Stack>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              ))}

              <Button
                variant="outlined"
                fullWidth
                startIcon={savingDraft ? <CircularProgress size={18} /> : <AddIcon />}
                onClick={addReceipt}
                disabled={isBusy || !groupId}
                sx={{ borderStyle: 'dashed', py: 2, borderRadius: 3, borderWidth: 2, fontWeight: 700 }}
              >
                Agregar otra boleta
              </Button>
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          {success ? (
            <Button variant="contained" onClick={onClose} sx={{ px: 4 }}>
              Volver a reembolsos
            </Button>
          ) : (
            <>
              <Box sx={{ flex: 1 }}>
                <Typography variant="caption" color="text.secondary" display="block">Total a reembolsar</Typography>
                <Typography variant="h6" fontWeight={800} color="primary">{formatCurrencyCLP(totalAmount)}</Typography>
              </Box>
              <Button onClick={handleClose} disabled={isBusy}>Cerrar</Button>
              <Button
                variant="outlined"
                startIcon={savingDraft ? <CircularProgress size={18} /> : <SaveIcon />}
                disabled={isBusy || receipts.length === 0}
                onClick={handleSaveDraft}
              >
                Guardar borrador
              </Button>
              <Button
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                disabled={isBusy || receipts.length === 0}
                onClick={() => validateForm() && setPreviewOpen(true)}
                sx={{ fontWeight: 700 }}
              >
                Revisar y enviar
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={previewOpen} onClose={() => !submitting && setPreviewOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 800 }}>Confirmar envío</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3}>
            <Box>
              <Typography variant="caption" color="text.secondary">SOLICITANTE</Typography>
              <Typography variant="body1" fontWeight={700}>{profile?.displayName}</Typography>
              <Typography variant="body2">{profile?.centerCosts?.[0]}</Typography>
            </Box>

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Descripción</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Categoría</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Monto</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {receipts.map((receipt, index) => (
                  <TableRow key={receipt.id}>
                    <TableCell>{receipt.concept || `Ítem ${index + 1}`}</TableCell>
                    <TableCell>{receipt.category || '—'}</TableCell>
                    <TableCell align="right">{formatCurrencyCLP(receipt.amount)}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={2} sx={{ fontWeight: 900 }}>TOTAL</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 900, color: 'primary.main' }}>
                    {formatCurrencyCLP(totalAmount)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>

            <Divider />

            <Alert severity="info" sx={{ borderRadius: 2 }}>
              Al confirmar, todas las boletas del borrador pasarán a estado pendiente de aprobación.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setPreviewOpen(false)} disabled={submitting}>Atrás</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={submitting || hasReceiptProcessing}
            sx={{ px: 4, fontWeight: 700 }}
          >
            {submitting ? <CircularProgress size={24} color="inherit" /> : 'Confirmar envío'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
