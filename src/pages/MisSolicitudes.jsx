import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ReportProblem';
import PaymentIcon from '@mui/icons-material/Payment';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP, formatShortDate } from '../lib/formatters';
import { subscribeWorkerReimbursements, deleteDraftReceipt } from '../lib/repository';

const STATUS_LABELS = {
  draft: 'Borrador',
  pending_approval: 'Pendiente',
  approved: 'Aprobada',
  paid: 'Pagada',
  rejected: 'Rechazada',
};

const STATUS_COLORS = {
  draft: 'default',
  pending_approval: 'warning',
  approved: 'success',
  paid: 'info',
  rejected: 'error',
};

const STATUS_ICONS = {
  draft: <ReceiptLongIcon fontSize="small" />,
  pending_approval: <AccessTimeIcon fontSize="small" />,
  approved: <CheckCircleOutlineIcon fontSize="small" />,
  paid: <PaymentIcon fontSize="small" />,
  rejected: <ErrorOutlineIcon fontSize="small" />,
};

export default function MisSolicitudes() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [requestsState, setRequestsState] = useState({
    items: [],
    loadedWorkerId: null,
    error: '',
  });

  useEffect(() => {
    if (!profile?.workerId) return undefined;

    const currentWorkerId = profile.workerId;
    const unsubscribe = subscribeWorkerReimbursements(
      currentWorkerId,
      (items) => {
        setRequestsState({
          items,
          loadedWorkerId: currentWorkerId,
          error: '',
        });
      },
      (snapshotError) => {
        setRequestsState({
          items: [],
          loadedWorkerId: currentWorkerId,
          error: snapshotError.message,
        });
      },
    );

    return () => unsubscribe();
  }, [profile?.workerId]);

  const requests = useMemo(
    () => (profile?.workerId === requestsState.loadedWorkerId ? requestsState.items : []),
    [profile?.workerId, requestsState.items, requestsState.loadedWorkerId],
  );
  const error = profile?.workerId === requestsState.loadedWorkerId ? requestsState.error : '';
  const loading = Boolean(profile?.workerId)
    && profile.workerId !== requestsState.loadedWorkerId
    && !error;

  const groupedRequests = useMemo(() => {
    const groups = requests.reduce((accumulator, item) => {
      const groupId = item.groupId || item.id;

      if (!accumulator[groupId]) {
        accumulator[groupId] = {
          id: groupId,
          items: [],
          total: 0,
          status: item.status,
          date: item.submittedAt || item.createdAt,
          requestNumber: item.groupId || item.requestNumber || groupId,
        };
      }

      accumulator[groupId].items.push(item);
      accumulator[groupId].total += Number(item.amount || 0);

      return accumulator;
    }, {});

    return Object.values(groups).sort((left, right) => {
      const dateLeft = left.date?.seconds || 0;
      const dateRight = right.date?.seconds || 0;
      return dateRight - dateLeft;
    });
  }, [requests]);

  const summary = useMemo(() => requests.reduce((accumulator, item) => {
    accumulator.total += 1;
    accumulator[item.status] = (accumulator[item.status] ?? 0) + 1;
    return accumulator;
  }, {
    total: 0,
    draft: 0,
    pending_approval: 0,
    approved: 0,
    paid: 0,
    rejected: 0,
  }), [requests]);

  const handleNewRequest = () => {
    navigate('/solicitar');
  };

  const handleDeleteDraft = async (group) => {
    if (!window.confirm('¿Estás seguro de que quieres eliminar este borrador? Esta acción no se puede deshacer.')) {
      return;
    }

    try {
      // Eliminar todos los ítems del grupo
      const deletePromises = group.items.map((item) => deleteDraftReceipt(item.id));
      await Promise.all(deletePromises);
    } catch (err) {
      alert('Error al eliminar borrador: ' + err.message);
    }
  };

  return (
    <Box sx={{ pb: 4 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        spacing={2}
        sx={{ mb: 4 }}
      >
        <Box>
          <Typography variant="h5" fontWeight={700} gutterBottom>Reembolsos</Typography>
          <Typography variant="body2" color="text.secondary">
            Hola, <strong>{profile?.displayName}</strong>. Desde aquí gestionas tus borradores y el estado de tus solicitudes.
          </Typography>
        </Box>

        <Button
          variant="contained"
          size="large"
          startIcon={<AddCircleOutlineRoundedIcon />}
          onClick={handleNewRequest}
          sx={{ borderRadius: 2, px: 3, py: 1, fontWeight: 700 }}
        >
          Nueva solicitud
        </Button>
      </Stack>

      {loading ? <LinearProgress sx={{ mb: 2, borderRadius: 1 }} /> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 2 }}>
            <Typography variant="h5" fontWeight={800} color="primary">{summary.total}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>Ítems</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 2, borderLeft: '4px solid #64748b' }}>
            <Typography variant="h5" fontWeight={800} color="text.primary">{summary.draft}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>Borradores</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 2, borderLeft: '4px solid #f59e0b' }}>
            <Typography variant="h5" fontWeight={800} color="warning.main">{summary.pending_approval}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>Pendientes</Typography>
          </Paper>
        </Grid>
        <Grid item xs={6} sm={3}>
          <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderRadius: 2, borderLeft: '4px solid #10b981' }}>
            <Typography variant="h5" fontWeight={800} color="success.main">{summary.approved + summary.paid}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>Aprobadas/Pagadas</Typography>
          </Paper>
        </Grid>
      </Grid>

      {!loading && groupedRequests.length === 0 ? (
        <Card sx={{ borderRadius: 3, border: '1px dashed', borderColor: 'divider' }}>
          <CardContent sx={{ py: 8, textAlign: 'center' }}>
            <ReceiptLongIcon sx={{ fontSize: 60, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" sx={{ mb: 1 }}>Todavía no tienes reembolsos</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 420, mx: 'auto' }}>
              Crea una solicitud y el sistema la dejará como borrador desde el primer momento para que puedas retomarla cuando quieras.
            </Typography>
            <Button variant="contained" onClick={handleNewRequest}>
              Crear mi primera solicitud
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Stack spacing={3}>
        {groupedRequests.map((group) => (
          <Card key={group.id} sx={{ borderRadius: 3, overflow: 'hidden', transition: '0.2s', '&:hover': { boxShadow: 4 } }}>
            <Box sx={{ bgcolor: 'rgba(15, 23, 42, 0.02)', px: 3, py: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle2" color="text.secondary" fontWeight={700}>
                SOLICITUD: {group.requestNumber}
              </Typography>
              <Chip
                size="small"
                icon={STATUS_ICONS[group.status]}
                color={STATUS_COLORS[group.status]}
                label={STATUS_LABELS[group.status]}
                sx={{ fontWeight: 700, borderRadius: 1 }}
              />
            </Box>
            <CardContent sx={{ px: 3, py: 2 }}>
              <Stack spacing={1.5}>
                {group.items.map((item, index) => (
                  <Box key={item.id}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                      <Box>
                        <Typography variant="body1" fontWeight={500}>{item.concept || 'Borrador sin descripción'}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {item.category || 'Sin categoría'} · {item.merchantName || 'Comercio pendiente'} · {formatShortDate(item.expenseDate || group.date)}
                        </Typography>
                      </Box>
                      <Typography variant="body1" fontWeight={700}>{formatCurrencyCLP(item.amount)}</Typography>
                    </Box>
                    {index < group.items.length - 1 ? <Divider sx={{ my: 1.5, opacity: 0.5 }} /> : null}
                  </Box>
                ))}
              </Stack>

              <Divider sx={{ my: 2 }} />

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">
                  {group.status === 'draft' ? 'Última edición' : 'Enviada'} el {formatShortDate(group.date)}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block" align="right">Total solicitud</Typography>
                    <Typography variant="h6" fontWeight={800} color="primary">{formatCurrencyCLP(group.total)}</Typography>
                  </Box>
                  {group.status === 'draft' ? (
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={() => handleDeleteDraft(group)}
                      >
                        Eliminar
                      </Button>
                      <Button
                        variant="contained"
                        onClick={() => {
                          navigate(`/solicitar?edit=${group.id}`);
                        }}
                      >
                        Continuar
                      </Button>
                    </Stack>
                  ) : null}
                </Box>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}
