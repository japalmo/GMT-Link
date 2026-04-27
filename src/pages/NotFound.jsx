import { Box, Typography, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <Box sx={{ textAlign: 'center', py: 8 }}>
      <Typography variant="h2" fontWeight={700} color="text.secondary">404</Typography>
      <Typography variant="h6" sx={{ mt: 1, mb: 3 }}>Página no encontrada</Typography>
      <Button variant="contained" onClick={() => navigate('/')}>Volver al inicio</Button>
    </Box>
  );
}
