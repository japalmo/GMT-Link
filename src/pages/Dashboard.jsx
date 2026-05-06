import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Grid,
  LinearProgress,
  Typography,
} from '@mui/material';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import {
  subscribeDashboardRollup,
  subscribeReimbursements,
} from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP } from '../lib/formatters';

export default function Dashboard() {
  const { profile } = useAuth();
  const [rollup, setRollup] = useState();
  const [reimbursements, setReimbursements] = useState();
  const [error, setError] = useState('');

  const reimbursementItems = useMemo(() => reimbursements ?? [], [reimbursements]);
  const loading = rollup === undefined || reimbursements === undefined;

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

    return () => {
      unsubscribeRollup();
      unsubscribeReimbursements();
    };
  }, [profile]);

  const fallbackMetrics = useMemo(() => ({
    pendingCount: reimbursementItems.filter((item) => item.status === 'pending_approval').length,
    approvedUnpaidCount: reimbursementItems.filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid').length,
    approvedUnpaidAmount: reimbursementItems
      .filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid')
      .reduce((sum, item) => sum + Number(item.amount ?? 0), 0),
  }), [reimbursementItems]);

  const metrics = useMemo(() => ({
    pendingCount: rollup?.pendingCount ?? fallbackMetrics.pendingCount,
    approvedUnpaidCount: rollup?.approvedUnpaidCount ?? fallbackMetrics.approvedUnpaidCount,
    approvedUnpaidAmount: rollup?.approvedUnpaidAmount ?? fallbackMetrics.approvedUnpaidAmount,
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
  ]), [metrics]);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Dashboard</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Resumen operativo de reembolsos y pagos
      </Typography>

      {loading ? <LinearProgress sx={{ mb: 2 }} /> : null}
      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

      <Grid container spacing={2} sx={{ mb: 4 }}>
        {kpiCards.map(({ label, value, icon, color }) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={label}>
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
    </Box>
  );
}
