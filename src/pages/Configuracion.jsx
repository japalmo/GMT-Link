import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogTitle,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import {
  createCostCenter,
  deleteCostCenter,
  deleteUser,
  updateUser,
} from '../lib/repository';

export default function Configuracion() {
  const [users, setUsers] = useState([]);
  const [costCenters, setCostCenters] = useState([]);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [deleteTargetUser, setDeleteTargetUser] = useState(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [newCc, setNewCc] = useState('');

  // Efectos y carga simplificados
  // (La lógica real de suscripción se mantiene, pero omito aquí para limpieza del ejemplo)
  
  const handleCreateCc = async () => {
    if (!newCc.trim()) return;
    try { await createCostCenter(newCc.trim()); setNewCc(''); } catch (err) { setError(err.message); }
  };

  const handleDeleteUser = async () => {
    if (!deleteTargetUser) return;
    try {
      await deleteUser(deleteTargetUser.id);
      setSuccessMessage(`Usuario ${deleteTargetUser.displayName} eliminado.`);
      setDeleteConfirmOpen(false);
    } catch (err) { setError(err.message); }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>Configuración</Typography>

      <Tabs value={tab} onChange={(_, val) => setTab(val)} sx={{ mb: 2 }}>
        <Tab label="Usuarios" />
        <Tab label="Centros de Costo" />
      </Tabs>

      {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}
      {successMessage ? <Alert severity="success" sx={{ mb: 2 }}>{successMessage}</Alert> : null}

      {tab === 0 && (
        <Card>
          <CardContent>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Nombre</TableCell>
                  <TableCell>Email</TableCell>
                  <TableCell>Rol</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell align="right">Acciones</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.displayName}</TableCell>
                    <TableCell>{item.email}</TableCell>
                    <TableCell><Chip label={item.role} size="small" variant="outlined" /></TableCell>
                    <TableCell>
                      <Switch checked={item.active !== false} onChange={() => updateUser(item.id, { active: !item.active })} />
                    </TableCell>
                    <TableCell align="right">
                      <Button color="error" size="small" onClick={() => { setDeleteTargetUser(item); setDeleteConfirmOpen(true); }}>
                        Eliminar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === 1 && (
        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} sx={{ mb: 3 }}>
              <TextField label="Nuevo centro de costo" value={newCc} onChange={(e) => setNewCc(e.target.value)} size="small" />
              <Button variant="contained" startIcon={<AddCircleOutlineRoundedIcon />} onClick={handleCreateCc}>Crear</Button>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {costCenters.map(cc => (
                <Chip key={cc.id} label={cc.name} onDelete={() => deleteCostCenter(cc.id)} />
              ))}
            </Stack>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Eliminar usuario</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={handleDeleteUser}>Eliminar</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
