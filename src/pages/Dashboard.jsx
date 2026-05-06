import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Grid,
  LinearProgress,
  Typography,
  Stack,
  Avatar,
  Paper,
  Divider,
} from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import PendingActionsOutlinedIcon from '@mui/icons-material/PendingActionsOutlined';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import {
  subscribeDashboardRollup,
  subscribeReimbursements,
} from '../lib/repository';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrencyCLP } from '../lib/formatters';

// --- Components ---

const AnimatedCounter = ({ value, duration = 1.5 }) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let start = 0;
    const end = typeof value === 'number' ? value : parseInt(String(value).replace(/[^0-9]/g, '')) || 0;
    if (start === end) return;

    const totalMiliseconds = duration * 1000;
    const increment = end / (totalMiliseconds / 16);
    
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) {
        setCount(end);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);

    return () => clearInterval(timer);
  }, [value, duration]);

  const displayValue = typeof value === 'string' && value.includes('$') 
    ? formatCurrencyCLP(count) 
    : count;

  return <span>{displayValue}</span>;
};

const MotionCard = motion(Card);

const KPICard = ({ label, value, icon, color, delay }) => (
  <MotionCard
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay }}
    whileHover={{ y: -5, boxShadow: '0 8px 16px rgba(0,0,0,0.1)' }}
    sx={{ height: '100%' }}
  >
    <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Box sx={{
        p: 1.5, borderRadius: 3, bgcolor: `${color}18`,
        color, display: 'flex',
      }}>
        {icon}
      </Box>
      <Box>
        <Typography variant="h5" fontWeight={800}>
          <AnimatedCounter value={value} />
        </Typography>
        <Typography variant="caption" color="text.secondary" fontWeight={500}>
          {label}
        </Typography>
      </Box>
    </CardContent>
  </MotionCard>
);

const KanbanColumn = ({ title, items, color }) => (
  <Box sx={{ flex: 1, minWidth: 280, bgcolor: 'rgba(0,0,0,0.01)', borderRadius: 3, p: 2 }}>
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
      <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title} ({items.length})
      </Typography>
    </Stack>
    <Stack spacing={1.5}>
      <AnimatePresence>
        {items.map((item, idx) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.05 }}
            layout
          >
            <Paper
              elevation={0}
              sx={{
                p: 2,
                borderRadius: 2,
                border: '1px solid rgba(0,0,0,0.05)',
                '&:hover': {
                  borderColor: 'primary.light',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                  transform: 'scale(1.02)',
                },
                transition: 'all 0.2s ease-in-out',
                cursor: 'pointer',
              }}
            >
              <Typography variant="subtitle2" fontWeight={700} noWrap>{item.workerName}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{item.merchantName || 'Sin comercio'}</Typography>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  {item.submittedAt ? new Date(item.submittedAt.seconds * 1000).toLocaleDateString() : 'N/A'}
                </Typography>
                <Typography variant="subtitle2" fontWeight={800} color="primary.main">
                  {formatCurrencyCLP(item.amount)}
                </Typography>
              </Stack>
            </Paper>
          </motion.div>
        ))}
      </AnimatePresence>
      {items.length === 0 && (
        <Typography variant="caption" color="text.disabled" sx={{ textAlign: 'center', py: 4 }}>
          No hay solicitudes
        </Typography>
      )}
    </Stack>
  </Box>
);

// --- Main Page ---

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

  // --- Derived Data ---

  const metrics = useMemo(() => {
    const pending = reimbursementItems.filter((item) => item.status === 'pending_approval');
    const approvedUnpaid = reimbursementItems.filter((item) => item.status === 'approved' && item.paymentStatus === 'unpaid');
    const unpaidAmount = approvedUnpaid.reduce((sum, item) => sum + Number(item.amount ?? 0), 0);

    return {
      pendingCount: rollup?.pendingCount ?? pending.length,
      approvedUnpaidCount: rollup?.approvedUnpaidCount ?? approvedUnpaid.length,
      approvedUnpaidAmount: rollup?.approvedUnpaidAmount ?? unpaidAmount,
    };
  }, [reimbursementItems, rollup]);

  const kanbanData = useMemo(() => {
    return {
      draft: reimbursementItems.filter(item => item.status === 'draft'),
      pending: reimbursementItems.filter(item => item.status === 'pending_approval'),
      approved: reimbursementItems.filter(item => item.status === 'approved' && item.paymentStatus === 'unpaid'),
      paid: reimbursementItems.filter(item => item.status === 'paid'),
    };
  }, [reimbursementItems]);

  const chartData = useMemo(() => {
    const validItems = reimbursementItems.filter(item => item.status !== 'draft' && item.status !== 'rejected');
    const grouped = validItems.reduce((acc, item) => {
      const cat = item.category || 'Otros';
      acc[cat] = (acc[cat] || 0) + Number(item.amount || 0);
      return acc;
    }, {});

    return Object.entries(grouped).map(([name, value]) => ({ name, value }));
  }, [reimbursementItems]);

  const topSpenders = useMemo(() => {
    const validItems = reimbursementItems.filter(item => item.status !== 'rejected');
    const grouped = validItems.reduce((acc, item) => {
      const name = item.workerName || 'Desconocido';
      acc[name] = (acc[name] || 0) + Number(item.amount || 0);
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [reimbursementItems]);

  const costCenterStats = useMemo(() => {
    const validItems = reimbursementItems.filter(item => item.status === 'pending_approval' || (item.status === 'approved' && item.paymentStatus === 'unpaid'));
    const grouped = validItems.reduce((acc, item) => {
      const cc = item.centerCost || 'Sin Centro de Costo';
      acc[cc] = (acc[cc] || 0) + Number(item.amount || 0);
      return acc;
    }, {});

    return Object.entries(grouped)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [reimbursementItems]);

  const COLORS = ['#1C3A6B', '#2563EB', '#D97706', '#059669', '#7C3AED', '#475569'];

  return (
    <Box sx={{ pb: 6 }}>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Typography variant="h5" gutterBottom fontWeight={800}>Dashboard</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          Resumen operativo y análisis de gastos en tiempo real.
        </Typography>
      </motion.div>

      {loading ? <LinearProgress sx={{ mb: 4, borderRadius: 2 }} /> : null}
      {error ? <Alert severity="error" sx={{ mb: 4, borderRadius: 3 }}>{error}</Alert> : null}

      {/* KPI Cards */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <KPICard
            label="Pendientes de aprobación"
            value={metrics.pendingCount}
            icon={<PendingActionsOutlinedIcon />}
            color="#2563EB"
            delay={0.1}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <KPICard
            label="Aprobadas sin pagar"
            value={metrics.approvedUnpaidCount}
            icon={<TrendingUpIcon />}
            color="#D97706"
            delay={0.2}
          />
        </Grid>
        <Grid item xs={12} sm={4}>
          <KPICard
            label="Monto por pagar"
            value={formatCurrencyCLP(metrics.approvedUnpaidAmount)}
            icon={<PaymentsOutlinedIcon />}
            color="#059669"
            delay={0.3}
          />
        </Grid>
      </Grid>

      {/* Kanban Section */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.4 }}
      >
        <Typography variant="h6" sx={{ mb: 2, px: 1 }}>Flujo de Solicitudes (Kanban)</Typography>
        <Box sx={{ 
          display: 'flex', 
          gap: 2, 
          overflowX: 'auto', 
          pb: 2, 
          px: 1,
          '&::-webkit-scrollbar': { height: 8 },
          '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 10 }
        }}>
          <KanbanColumn title="Borradores" items={kanbanData.draft} color="#94A3B8" />
          <KanbanColumn title="Pendientes" items={kanbanData.pending} color="#2563EB" />
          <KanbanColumn title="Aprobados" items={kanbanData.approved} color="#D97706" />
          <KanbanColumn title="Pagados" items={kanbanData.paid} color="#059669" />
        </Box>
      </motion.div>

      {/* Charts and Rankings */}
      <Grid container spacing={3} sx={{ mt: 2 }}>
        {/* Category Chart */}
        <Grid item xs={12} lg={7}>
          <MotionCard
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            sx={{ height: '100%' }}
          >
            <CardContent>
              <Typography variant="h6" sx={{ mb: 3 }}>Gastos por Categoría</Typography>
              <Box sx={{ width: '100%', height: 320 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12 }} tickFormatter={(val) => `$${val/1000}k`} />
                    <RechartsTooltip 
                      formatter={(value) => formatCurrencyCLP(value)}
                      contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                    />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </CardContent>
          </MotionCard>
        </Grid>

        {/* Top Spenders */}
        <Grid item xs={12} lg={5}>
          <MotionCard
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            sx={{ height: '100%' }}
          >
            <CardContent>
              <Typography variant="h6" sx={{ mb: 3 }}>Top Spenders (Ranking)</Typography>
              <Stack spacing={2.5}>
                {topSpenders.map((spender, idx) => (
                  <Box key={spender.name}>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Avatar sx={{ bgcolor: COLORS[idx % COLORS.length], fontWeight: 800, width: 40, height: 40, fontSize: 14 }}>
                        {idx + 1}
                      </Avatar>
                      <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="subtitle2" fontWeight={700}>{spender.name}</Typography>
                        <LinearProgress 
                          variant="determinate" 
                          value={(spender.total / (topSpenders[0]?.total || 1)) * 100} 
                          sx={{ height: 6, borderRadius: 3, mt: 0.5, bgcolor: 'rgba(0,0,0,0.05)' }} 
                        />
                      </Box>
                      <Typography variant="subtitle2" fontWeight={800}>
                        {formatCurrencyCLP(spender.total)}
                      </Typography>
                    </Stack>
                  </Box>
                ))}
                {topSpenders.length === 0 && (
                  <Typography variant="body2" color="text.disabled" sx={{ textAlign: 'center', py: 4 }}>
                    Sin datos de gastos
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </MotionCard>
        </Grid>

        {/* Cost Centers */}
        <Grid item xs={12}>
          <MotionCard
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
          >
            <CardContent>
              <Typography variant="h6" sx={{ mb: 3 }}>Compromiso por Centro de Costo (Pendiente + Aprobado)</Typography>
              <Grid container spacing={2}>
                {costCenterStats.map((cc) => (
                  <Grid item xs={12} sm={6} md={4} lg={3} key={cc.name}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.01)' }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase' }}>
                        {cc.name}
                      </Typography>
                      <Typography variant="h6" fontWeight={800} color="primary.main">
                        {formatCurrencyCLP(cc.value)}
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
                {costCenterStats.length === 0 && (
                  <Grid item xs={12}>
                    <Typography variant="body2" color="text.disabled" sx={{ textAlign: 'center', py: 4 }}>
                      No hay compromisos pendientes por centro de costo
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </CardContent>
          </MotionCard>
        </Grid>
      </Grid>
    </Box>
  );
}
