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
} from '@mui/material';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { subscribeReimbursements, markReimbursementsAsPrinted } from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP, formatDateTime } from '../lib/formatters';
import { generateReceiptsBatchPDF } from '../lib/pdfService';

export default function ImpresionLoteDialog({ open, onClose }) {
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
    <Dialog open={open} onClose={() => !processing && onClose()} fullWidth maxWidth="lg">
      <DialogTitle sx={{ fontWeight: 800 }}>Impresión de boletas por lote</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info">
            Selecciona las boletas pagadas para generar el archivo PDF (4 boletas por hoja) para registro físico.
          </Alert>

          {loading && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}

          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button variant="outlined" size="small" onClick={selectNotPrinted} disabled={loading || processing}>
              Seleccionar no impresas
            </Button>
            <Button variant="text" size="small" onClick={() => setSelectedIds([])} disabled={loading || processing}>
              Limpiar selección
            </Button>
          </Stack>

          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Table size="small" stickyHeader sx={{ maxHeight: 400 }}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      indeterminate={selectedIds.length > 0 && selectedIds.length < reimbursements.length}
                      checked={selectedIds.length === reimbursements.length && reimbursements.length > 0}
                      onChange={toggleAll}
                    />
                  </TableCell>
                  <TableCell>Solicitud</TableCell>
                  <TableCell>Trabajador</TableCell>
                  <TableCell>Concepto</TableCell>
                  <TableCell align="right">Monto</TableCell>
                  <TableCell align="center">Estado Impresión</TableCell>
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
                  reimbursements.map((row) => (
                    <TableRow 
                      key={row.id} 
                      hover 
                      onClick={() => toggleRow(row.id)} 
                      sx={{ cursor: 'pointer' }}
                      selected={selectedIds.includes(row.id)}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox checked={selectedIds.includes(row.id)} />
                      </TableCell>
                      <TableCell>{row.requestNumber}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{row.workerName}</Typography>
                      </TableCell>
                      <TableCell>{row.concept}</TableCell>
                      <TableCell align="right">{formatCurrencyCLP(row.amount)}</TableCell>
                      <TableCell align="center">
                        {row.printedAt ? (
                          <Chip 
                            icon={<CheckCircleIcon />} 
                            label={`Impresa ${formatDateTime(row.printedAt)}`} 
                            size="small" 
                            color="success" 
                            variant="outlined" 
                          />
                        ) : (
                          <Chip label="No impresa" size="small" variant="outlined" />
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Paper>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 3 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {selectedIds.length} boletas seleccionadas
          </Typography>
        </Box>
        <Button onClick={onClose} disabled={processing}>Cerrar</Button>
        <Button
          variant="contained"
          startIcon={processing ? <CircularProgress size={20} color="inherit" /> : <PictureAsPdfIcon />}
          disabled={selectedIds.length === 0 || processing}
          onClick={handleExport}
          sx={{ px: 4, fontWeight: 700 }}
        >
          Exportar PDF y marcar impresas
        </Button>
      </DialogActions>
    </Dialog>
  );
}
