import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
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
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { useNavigate } from 'react-router-dom';
import {
  subscribeDashboardRollup,
  subscribePaymentBatches,
  subscribeReimbursements,
  subscribeWorkers,
} from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP, formatDateTime, formatShortDate, toDateValue } from '../lib/formatters';

function isSameMonth(date, now = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function buildReimbursementActivity(items) {
  return items.flatMap((item) => {
    const events = [];
    const submittedAt = toDateValue(item.submittedAt);
    const approvedAt = toDateValue(item.approvedAt);
    const rejectedAt = toDateValue(item.rejectedAt);

    if (submittedAt) {
      events.push({
        id: `${item.id}-submitted`,
        type: 'submitted',
        title: 'Solicitud enviada',
        actor: item.workerName || 'Trabajador',
        amount: item.amount,
        requestNumber: item.requestNumber,
        happenedAt: submittedAt,
        color: 'info',
        target: '/reembolsos',
      });
    }

    if (approvedAt) {
      events.push({
        id: `${item.id}-approved`,
        type: 'approved',
        title: 'Solicitud aprobada',
        actor: item.approvedByName || item.workerName || 'Usuario',
        amount: item.amount,
        requestNumber: item.requestNumber,
        happenedAt: approvedAt,
        color: 'success',
        target: '/reembolsos?status=approved',
      });
    }

    if (rejectedAt) {
      events.push({
        id: `${item.id}-rejected`,
        type: 'rejected',
        title: 'Solicitud rechazada',
        actor: item.rejectedByName || item.workerName || 'Usuario',
        amount: item.amount,
        requestNumber: item.requestNumber,
        happenedAt: rejectedAt,
        color: 'error',
        target: '/reembolsos?status=rejected',
      });
    }

    return events;
  });
}

function buildPaymentActivity(items) {
  return items.flatMap((item) => {
    const paidAt = toDateValue(item.paidAt);
    if (!paidAt) return [];

    return [{
      id: `${item.id}-paid`,
      type: 'paid',
      title: 'Pago registrado',
      actor: item.paidByName || item.workerName || 'Usuario',
      amount: item.totalAmount,
      requestNumber: item.batchNumber,
      happenedAt: paidAt,
      color: 'secondary',
      target: `/pagos?worker=${encodeURIComponent(item.workerId || '')}&open=1`,
      extraLabel: `${item.requestCount ?? 0} solicitudes`,
    }];
  });
}

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [rollup, setRollup] = useState();
  const [reimbursements, setReimbursements] = useState();
  const [workers, setWorkers] = useState();
  const [paymentBatches, setPaymentBatches] = useState();
  const [error, setError] = useState('');

  // TODO: diferenciación gerencia vs admin
  const canReadPaymentBatches = profile?.role === 'admin'
    || profile?.role === 'gerencia'
    || profile?.role === 'finance_clerk';
  const reimbursementItems = useMemo(() => reimbursements ?? [], [reimbursements]);
  const workerItems = useMemo(() => workers ?? [], [workers]);
  const paymentBatchItems = useMemo(() => paymentBatches ?? [], [paymentBatches]);
  const loading = rollup === undefined
    || reimbursements === undefined
    || workers === undefined
    || (canReadPaymentBatches && paymentBatches === undefined);

  useEffect(() => {
    const unsubscribeRollup = subscribeDashboardRollup(
      (data) => { setRollup(data ?? null); },
      (err) => { setError(err.message); setRollup(null); },
    );

    const unsubscribeReimbursements = subscribeReimbursements(
      { profile },
      (items) => { setReimbursements(items); },
      (err) => { setError(err.message); setReimbursements([]); },
    );

    const unsubscribeWorkers = subscribeWorkers(
      { profile, onlyActive: true },
      (items) => { setWorkers(items); },
      (err) => { setError(err.message); setWorkers([]); },
    );

    const unsubscribePaymentBatches = canReadPaymentBatches
      ? subscribePaymentBatches(
        { profile, limitTo: 20 },
        (items) => { setPaymentBatches(items); },
        (err) => { setError(err.message); setPaymentBatches([]); },
      )
      : () => {};

    return () => {
      unsubscribeRollup();
      unsubscribeReimbursements();
      unsubscribeWorkers();
      unsubscribePaymentBatches();
    };
  }, [canReadPaymentBatches, profile]);

  const fallbackMetrics = useMemo(() => {
    const paidThisMonthItems = reimbursementItems.filter((item) => {
      const paidAt = toDateValue(item.paidAt);
      return item.status === 'paid' && isSameMonth(paidAt);
    });

    return {
      pendingCount: reimbursementItems.filter((item) => item.status === 'pending_approval').length,
      approvedUnpaidCount: reimbursementItems.filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid').length,
      approvedUnpaidAmount: reimbursementItems
        .filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid')
        .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      paidThisMonthCount: paidThisMonthItems.length,
      paidThisMonthAmount: paidThisMonthItems.reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
      totalWorkersActive: workerItems.filter((item) => item.active !== false).length,
    };
  }, [reimbursementItems, workerItems]);

  const metrics = useMemo(() => ({
    pendingCount: rollup?.pendingCount ?? fallbackMetrics.pendingCount,
    approvedUnpaidCount: rollup?.approvedUnpaidCount ?? fallbackMetrics.approvedUnpaidCount,
    approvedUnpaidAmount: rollup?.approvedUnpaidAmount ?? fallbackMetrics.approvedUnpaidAmount,
    paidThisMonthCount: rollup?.paidThisMonthCount ?? fallbackMetrics.paidThisMonthCount,
    paidThisMonthAmount: rollup?.paidThisMonthAmount ?? fallbackMetrics.paidThisMonthAmount,
    totalWorkersActive: rollup?.totalWorkersActive ?? fallbackMetrics.totalWorkersActive,
  }), [fallbackMetrics, rollup]);

  const kpiCards = useMemo(() => ([
    {
      label: 'Pendientes de aprobación',
      value: metrics.pendingCount,
      icon: <PendingActionsOutlinedIcon />,
      color: '#2563EB',
    },
    {
      label: 'Aprobadas sin pagar',
      value: metrics.approvedUnpaidCount,
      icon: <TrendingUpIcon />,
      color: '#D97706',
    },
    {
      label: 'Monto por pagar',
      value: formatCurrencyCLP(metrics.approvedUnpaidAmount),
      icon: <PaymentsOutlinedIcon />,
      color: '#059669',
    },
    {
      label: 'Pagadas este mes',
      value: metrics.paidThisMonthCount,
      icon: <TaskAltOutlinedIcon />,
      color: '#7C3AED',
    },
    {
      label: 'Monto pagado este mes',
      value: formatCurrencyCLP(metrics.paidThisMonthAmount),
      icon: <PaymentsOutlinedIcon />,
      color: '#0F766E',
    },
    {
      label: 'Trabajadores activos',
      value: metrics.totalWorkersActive,
      icon: <GroupOutlinedIcon />,
      color: '#475569',
    },
  ]), [metrics]);

  const pendingApprovalCards = useMemo(
    () => reimbursementItems
      .filter((item) => item.status === 'pending_approval')
      .slice(0, 8),
    [reimbursementItems],
  );

  const unpaidApprovedCards = useMemo(
    () => reimbursementItems
      .filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid')
      .slice(0, 8),
    [reimbursementItems],
  );

  const categorySummary = useMemo(() => {
    const grouped = reimbursementItems.reduce((accumulator, item) => {
      const key = item.category || 'Sin categoría';
      const current = accumulator.get(key) ?? { category: key, count: 0, total: 0 };
      current.count += 1;
      current.total += Number(item.amount ?? 0);
      accumulator.set(key, current);
      return accumulator;
    }, new Map());

    return [...grouped.values()]
      .sort((left, right) => right.total - left.total)
      .slice(0, 4);
  }, [reimbursementItems]);

  const recentActivity = useMemo(() => {
    const reimbursementEvents = buildReimbursementActivity(reimbursementItems);
    const paymentEvents = canReadPaymentBatches ? buildPaymentActivity(paymentBatchItems) : [];

    return [...reimbursementEvents, ...paymentEvents]
      .sort((left, right) => right.happenedAt.getTime() - left.happenedAt.getTime())
      .slice(0, 8);
  }, [canReadPaymentBatches, paymentBatchItems, reimbursementItems]);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Dashboard</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Resumen operativo de reembolsos, pagos y actividad reciente
      </Typography>

      {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Grid container spacing={2} sx={{ mb: 4 }}>
        {kpiCards.map(({ label, value, icon, color }) => (
          <Grid size={{ xs: 12, sm: 6, lg: 3 }} key={label}>
            <Card>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{
                  p: 1.5, borderRadius: 2, bgcolor: `${color}18`,
                  color, display: 'flex',
                }}>
                  {icon}
                </Box>
                <Box>
                  <Typography variant="h5" fontWeight={700}>{value}</Typography>
                  <Typography variant="caption" color="text.secondary">{label}</Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, xl: 8 }}>
          <Card sx={{ minHeight: 320 }}>
            <CardContent sx={{ height: '100%' }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Kanban operativo
              </Typography>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper
                    variant="outlined"
                    sx={{ p: 2, bgcolor: 'rgba(217, 119, 6, 0.04)', minHeight: 244 }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                      <Typography variant="subtitle1">Pendientes de aprobación</Typography>
                      <Chip label={pendingApprovalCards.length} color="warning" size="small" />
                    </Stack>
                    <Stack spacing={1.25}>
                      {pendingApprovalCards.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No hay solicitudes pendientes.
                        </Typography>
                      ) : (
                        pendingApprovalCards.map((item) => (
                          <Paper
                            key={item.id}
                            variant="outlined"
                            onClick={() => navigate('/reembolsos?status=pending_approval')}
                            sx={{
                              p: 1.5,
                              cursor: 'pointer',
                              transition: 'transform 120ms ease, box-shadow 120ms ease',
                              '&:hover': {
                                transform: 'translateY(-1px)',
                                boxShadow: 2,
                              },
                            }}
                          >
                            <Stack spacing={0.5}>
                              <Typography variant="subtitle2">{item.workerName}</Typography>
                              <Stack direction="row" justifyContent="space-between" spacing={1}>
                                <Typography variant="body2" color="text.secondary">
                                  {formatShortDate(item.submittedAt)}
                                </Typography>
                                <Typography variant="subtitle2">{formatCurrencyCLP(item.amount)}</Typography>
                              </Stack>
                            </Stack>
                          </Paper>
                        ))
                      )}
                    </Stack>
                  </Paper>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Paper
                    variant="outlined"
                    sx={{ p: 2, bgcolor: 'rgba(5, 150, 105, 0.04)', minHeight: 244 }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                      <Typography variant="subtitle1">Por pagar</Typography>
                      <Chip label={unpaidApprovedCards.length} color="success" size="small" />
                    </Stack>
                    <Stack spacing={1.25}>
                      {unpaidApprovedCards.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          No hay solicitudes aprobadas sin pagar.
                        </Typography>
                      ) : (
                        unpaidApprovedCards.map((item) => (
                          <Paper
                            key={item.id}
                            variant="outlined"
                            onClick={() => navigate(`/pagos?worker=${encodeURIComponent(item.workerId)}&open=1`)}
                            sx={{
                              p: 1.5,
                              cursor: 'pointer',
                              transition: 'transform 120ms ease, box-shadow 120ms ease',
                              '&:hover': {
                                transform: 'translateY(-1px)',
                                boxShadow: 2,
                              },
                            }}
                          >
                            <Stack spacing={0.5}>
                              <Typography variant="subtitle2">{item.workerName}</Typography>
                              <Stack direction="row" justifyContent="space-between" spacing={1}>
                                <Typography variant="body2" color="text.secondary">
                                  {formatShortDate(item.submittedAt)}
                                </Typography>
                                <Typography variant="subtitle2">{formatCurrencyCLP(item.amount)}</Typography>
                              </Stack>
                            </Stack>
                          </Paper>
                        ))
                      )}
                    </Stack>
                  </Paper>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6, xl: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Top categorías
              </Typography>
              <Stack spacing={1.5}>
                {categorySummary.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No hay solicitudes visibles para resumir.
                  </Typography>
                ) : categorySummary.map((item) => (
                  <Box key={item.category}>
                    <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                      <Typography variant="body2">{item.category}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.count} solicitudes
                      </Typography>
                    </Stack>
                    <Typography variant="subtitle2">{formatCurrencyCLP(item.total)}</Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6, xl: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                <Box>
                  <Typography variant="h6">Actividad reciente</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {canReadPaymentBatches
                      ? 'Incluye solicitudes y pagos registrados.'
                      : 'Incluye solicitudes; los pagos se ocultan por permisos.'}
                  </Typography>
                </Box>
                <HistoryOutlinedIcon color="action" />
              </Stack>
              <Stack divider={<Divider flexItem />} spacing={1.5}>
                {recentActivity.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No hay eventos recientes para mostrar.
                  </Typography>
                ) : recentActivity.map((event) => (
                  <Box
                    key={event.id}
                    onClick={() => navigate(event.target)}
                    sx={{
                      cursor: 'pointer',
                      borderRadius: 2,
                      p: 1,
                      mx: -1,
                      transition: 'background-color 120ms ease',
                      '&:hover': {
                        backgroundColor: 'action.hover',
                      },
                    }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                      <Box>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                          <Typography variant="subtitle2">{event.title}</Typography>
                          <Chip label={event.type} size="small" color={event.color} variant="outlined" />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {event.requestNumber || 'Sin identificador'} · {event.actor}
                        </Typography>
                        {event.extraLabel ? (
                          <Typography variant="caption" color="text.secondary">
                            {event.extraLabel}
                          </Typography>
                        ) : null}
                      </Box>
                      <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                        <Typography variant="subtitle2">{formatCurrencyCLP(event.amount)}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(event.happenedAt)}
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
