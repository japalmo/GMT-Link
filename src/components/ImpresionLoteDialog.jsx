import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { subscribeReimbursements, markReimbursementsAsPrinted } from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP, formatDateTime } from '../lib/formatters';
import { generateReceiptsBatchPDF } from '../lib/pdfService';

export default function ImpresionLoteDialog({ open, onClose }) {
  const theme = useTheme();
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [reimbursements, setReimbursements] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // Fetch paid boletas
    const unsubscribe = subscribeReimbursements(
      { profile, status: 'paid' },
      (items) => {
        // Filter by boleta only
        const boletas = items.filter(item => (item.documentType || 'boleta') === 'boleta');
        setReimbursements(boletas);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [open, profile]);

  const toggleRow = (id) => {
    setSelectedIds((current) => (
      current.includes(id) ? current.filter(item => item !== id) : [...current, id]
    ));
  };

  const toggleAll = () => {
    if (selectedIds.length === reimbursements.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(reimbursements.map(r => r.id));
    }
  };

  const selectNotPrinted = () => {
    const notPrinted = reimbursements.filter(r => !r.printedAt).map(r => r.id);
    setSelectedIds(notPrinted);
  };

  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    
    setProcessing(true);
    try {
      const toPrint = reimbursements.filter(r => selectedIds.includes(r.id));
      await generateReceiptsBatchPDF(toPrint);
      await markReimbursementsAsPrinted(selectedIds, profile);
      onClose();
    } catch (err) {
      setError('Error al generar PDF o marcar como impresas: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog 
      open={open} 
      onClose={() => !processing && onClose()} 
      fullWidth 
      maxWidth="lg"
      PaperProps={{ sx: { borderRadius: 4, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' } }}
    >
      <DialogTitle sx={{ fontWeight: 800, pt: 3 }}>Impresión de boletas por lote</DialogTitle>
      <DialogContent dividers sx={{ borderColor: 'rgba(0,0,0,0.05)' }}>
        <Stack spacing={2.5}>
          <Alert severity="info" sx={{ borderRadius: 2, fontWeight: 500 }}>
            Selecciona las boletas pagadas para generar el archivo PDF (4 boletas por hoja) para registro físico.
          </Alert>

          {loading && <LinearProgress sx={{ borderRadius: 2 }} />}
          
          <AnimatePresence mode="wait">
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <Alert severity="error" sx={{ borderRadius: 2 }}>{error}</Alert>
              </motion.div>
            )}
          </AnimatePresence>

          <Stack direction="row" spacing={1.5}>
            <Button 
              variant="outlined" 
              size="small" 
              onClick={selectNotPrinted} 
              disabled={loading || processing}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
            >
              Seleccionar no impresas
            </Button>
            <Button 
              variant="text" 
              size="small" 
              onClick={() => setSelectedIds([])} 
              disabled={loading || processing}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
            >
              Limpiar selección
            </Button>
          </Stack>

          <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 3, borderColor: 'rgba(0,0,0,0.08)' }}>
            <Box sx={{ maxHeight: 440, overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                      <Checkbox
                        indeterminate={selectedIds.length > 0 && selectedIds.length < reimbursements.length}
                        checked={selectedIds.length === reimbursements.length && reimbursements.length > 0}
                        onChange={toggleAll}
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: 'rgba(0,0,0,0.01)' }}>Solicitud</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: 'rgba(0,0,0,0.01)' }}>Trabajador</TableCell>
                    <TableCell sx={{ fontWeight: 700, bgcolor: 'rgba(0,0,0,0.01)' }}>Concepto</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, bgcolor: 'rgba(0,0,0,0.01)' }}>Monto</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700, bgcolor: 'rgba(0,0,0,0.01)' }}>Estado Impresión</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reimbursements.length === 0 && !loading ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                        <Typography color="text.secondary">No hay boletas pagadas disponibles.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    reimbursements.map((row, idx) => (
                      <TableRow 
                        key={row.id} 
                        hover 
                        onClick={() => toggleRow(row.id)} 
                        sx={{ 
                          cursor: 'pointer',
                          '&:hover': { bgcolor: 'rgba(0,0,0,0.02) !important' },
                          transition: 'background-color 0.2s'
                        }}
                        selected={selectedIds.includes(row.id)}
                        component={motion.tr}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: idx * 0.01 }}
                      >
                        <TableCell padding="checkbox">
                          <Checkbox checked={selectedIds.includes(row.id)} />
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{row.requestNumber}</TableCell>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>{row.workerName}</Typography>
                        </TableCell>
                        <TableCell>{row.concept}</TableCell>
                        <TableCell align="right">
                          <Typography variant="subtitle2" fontWeight={800} color="primary.main">
                            {formatCurrencyCLP(row.amount)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          {row.printedAt ? (
                            <Chip 
                              icon={<CheckCircleIcon />} 
                              label={`Impresa ${formatDateTime(row.printedAt)}`} 
                              size="small" 
                              color="success" 
                              variant="filled" 
                              sx={{ borderRadius: 1.5, fontWeight: 700, fontSize: '0.7rem' }}
                            />
                          ) : (
                            <Chip 
                              label="No impresa" 
                              size="small" 
                              variant="outlined" 
                              sx={{ borderRadius: 1.5, fontWeight: 600, fontSize: '0.7rem' }}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 3 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color="text.secondary" fontWeight={600}>
            {selectedIds.length} boletas seleccionadas
          </Typography>
        </Box>
        <Button onClick={onClose} disabled={processing} sx={{ fontWeight: 600 }}>Cerrar</Button>
        <Button
          variant="contained"
          startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <PictureAsPdfIcon />}
          disabled={selectedIds.length === 0 || processing}
          onClick={handleExport}
          sx={{ px: 4, py: 1.2, fontWeight: 800, borderRadius: 3, textTransform: 'none' }}
        >
          Exportar PDF y marcar impresas
        </Button>
      </DialogActions>
    </Dialog>
  );
}
